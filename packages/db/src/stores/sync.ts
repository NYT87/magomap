import {
  type AnyRow,
  CLOCK_ALLOWANCE_MS,
  type ClientWritableTable,
  isLocationMove,
  type LocationFields,
  type Mutation,
  mergeLocation,
  mutationRowSchemas,
  type PlaceLocationRow,
  type PlaceRow,
  type PullResponse,
  type PushResponse,
  type PushResult,
  SYNC_TABLES,
  type SyncTable,
} from "@magomap/domain";
import {
  newId,
  ownItemRowId,
  placeRowId,
  placeSourceRowId,
  userListRowId,
  userPlaceRowId,
} from "@magomap/domain/ids";
import { LIMITS } from "@magomap/domain/limits";
import { sql } from "kysely";
import { bulkUpsertQuery, type Db, type Statement } from "../core";
import { inJson, PER_USER_TABLES, toAnyRow, toDbRow } from "../mapping";
import type { Database } from "../schema";
import { grantStatements, type Row, type WriteContext, withWrite, writeStatements } from "../write";

export { WriteConflictError } from "../write";

/** The account was deleted while a write was in flight; nothing was written. */
export class AccountGoneError extends Error {
  constructor() {
    super("This account no longer exists");
  }
}

/** True while the user still exists; every write for a user carries it in its claim. */
export function userExists(userId: string) {
  return sql<boolean>`EXISTS (SELECT 1 FROM users WHERE id = ${userId})`;
}

export async function assertUserExists(db: Db, userId: string): Promise<void> {
  const row = await db.kysely
    .selectFrom("users")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!row) throw new AccountGoneError();
}

const APPLY_ORDER: ClientWritableTable[] = [
  "places",
  "lists",
  "list_items",
  "visit_notes",
  "links",
];

/** Applies new location fields to a place; returns the history row when it counts as a move. */
export function applyLocationUpdate(
  current: PlaceRow,
  incoming: Partial<LocationFields>,
  detectedBy: "import" | "search",
  now: number,
  previousValidUntil: number | null,
): { place: PlaceRow; history?: PlaceLocationRow; changed: boolean } {
  const before: LocationFields = {
    lat: current.lat,
    lng: current.lng,
    address: current.address,
    roadAddress: current.roadAddress,
    addressSource: current.addressSource,
  };
  const after = mergeLocation(before, incoming);
  const changed = (Object.keys(before) as (keyof LocationFields)[]).some(
    (k) => before[k] !== after[k],
  );
  const place = { ...current, ...after };
  if (!isLocationMove(before, incoming)) return { place, changed };
  const history: PlaceLocationRow = {
    id: newId(),
    placeId: current.id,
    address: current.address,
    roadAddress: current.roadAddress,
    lat: current.lat,
    lng: current.lng,
    validFrom: previousValidUntil ?? current.createdAt,
    validUntil: now,
    detectedBy,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return { place, history, changed };
}

/** Rows by id; per-user tables are scoped to `userId`. */
export async function readByIds(db: Db, userId: string, table: SyncTable, ids: Iterable<string>) {
  const list = [...new Set(ids)];
  const out = new Map<string, Row>();
  if (list.length === 0) return out;
  let query = db.kysely
    .selectFrom(table as keyof Database)
    .selectAll()
    .where(inJson(db, "id", list));
  if (PER_USER_TABLES.has(table)) query = query.where(sql<boolean>`user_id = ${userId}`);
  for (const r of await query.execute()) out.set((r as Row).id, r as Row);
  return out;
}

/** Latest `valid_until` per place, to chain the next history row. */
export async function latestValidUntil(db: Db, placeIds: Iterable<string>) {
  const list = [...new Set(placeIds)];
  const out = new Map<string, number>();
  if (list.length === 0) return out;
  const rows = await db.kysely
    .selectFrom("place_locations")
    .select(["place_id", sql<number>`max(valid_until)`.as("until")])
    .where(inJson(db, "place_id", list))
    .groupBy("place_id")
    .execute();
  for (const r of rows) out.set(r.place_id, Number(r.until));
  return out;
}

async function readTombstones(db: Db, userId: string, ids: string[]) {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db.kysely
    .selectFrom("tombstones")
    .select(["table_name", "id", "deleted_at"])
    .where("user_id", "=", userId)
    .where(inJson(db, "id", [...new Set(ids)]))
    .execute();
  for (const r of rows) out.set(`${r.table_name}:${r.id}`, Number(r.deleted_at));
  return out;
}

export interface PushOptions {
  /** Verifies a pushed place's search signature (the API checks it with the server key). */
  verifySource: (place: Record<string, unknown>) => boolean;
}

export async function applyPush(
  db: Db,
  userId: string,
  mutations: Mutation[],
  now: number,
  options: PushOptions,
): Promise<PushResponse> {
  return withWrite(
    db,
    (ctx) => decidePush(db, userId, mutations, now, ctx, options),
    userExists(userId),
  );
}

async function decidePush(
  db: Db,
  userId: string,
  mutations: Mutation[],
  now: number,
  ctx: WriteContext,
  options: PushOptions,
): Promise<{ statements: Statement[]; result: PushResponse }> {
  await assertUserExists(db, userId);
  const results = new Map<string, PushResult>();
  const set = (m: Mutation, status: PushResult["status"], extra: Partial<PushResult> = {}) =>
    results.set(m.mutationId, { mutationId: m.mutationId, status, ...extra });

  // 1. Validate each mutation on its own; refuse times from clocks running ahead.
  const valid: { m: Mutation; row?: Row }[] = [];
  for (const m of mutations) {
    if (m.clientUpdatedAt > now + CLOCK_ALLOWANCE_MS) {
      set(m, "rejected", { reason: "clock_ahead" });
      continue;
    }
    if (m.op === "delete") {
      if (m.table === "places") set(m, "rejected", { reason: "not_allowed" });
      else valid.push({ m });
      continue;
    }
    const parsed = mutationRowSchemas[m.table].safeParse(m.row);
    if (!parsed.success || parsed.data.id !== m.id) set(m, "rejected", { reason: "invalid" });
    else if (m.table === "places" && !options.verifySource(parsed.data as Row)) {
      set(m, "rejected", { reason: "invalid" });
    } else valid.push({ m, row: parsed.data as Row });
  }

  // 2. Coalesce: keep the last mutation per row; earlier ones share its outcome.
  const last = new Map<string, { m: Mutation; row?: Row }>();
  const superseded = new Map<string, Mutation[]>();
  for (const v of valid) {
    const key = `${v.m.table}:${v.m.id}`;
    const previous = last.get(key);
    if (previous) superseded.set(key, [...(superseded.get(key) ?? []), previous.m]);
    last.set(key, v);
  }
  const work = [...last.values()].sort(
    (a, b) => APPLY_ORDER.indexOf(a.m.table) - APPLY_ORDER.indexOf(b.m.table),
  );

  // 3. Pre-read everything the decisions need (the write check keeps it current).
  const idsOf = (t: SyncTable) => work.filter((w) => w.m.table === t).map((w) => w.m.id);
  const existingItems = await readByIds(db, userId, "list_items", idsOf("list_items"));
  const placeIds = new Set(idsOf("places"));
  const listIds = new Set(idsOf("lists"));
  for (const w of work) {
    if (w.row?.placeId) placeIds.add(String(w.row.placeId));
    if (w.row?.listId) listIds.add(String(w.row.listId));
  }
  for (const item of existingItems.values()) listIds.add(String(item.list_id));
  const state = new Map<SyncTable, Map<string, Row>>([
    ["places", await readByIds(db, userId, "places", placeIds)],
    ["lists", await readByIds(db, userId, "lists", listIds)],
    ["list_items", existingItems],
    ["visit_notes", await readByIds(db, userId, "visit_notes", idsOf("visit_notes"))],
    ["links", await readByIds(db, userId, "links", idsOf("links"))],
  ]);
  const myLists = await readByIds(db, userId, "user_lists", [...listIds].map(userListRowId));
  const myPlaces = await readByIds(db, userId, "user_places", [...placeIds].map(userPlaceRowId));
  const validUntil = await latestValidUntil(db, idsOf("places"));
  // Places a user may attach notes, links and own-list items to: theirs, or in a list they have.
  const listedPlaces = new Set(
    placeIds.size === 0
      ? []
      : (
          await db.kysely
            .selectFrom("list_items")
            .select("place_id")
            .where(inJson(db, "place_id", [...placeIds]))
            .where(
              sql<boolean>`list_id IN (SELECT list_id FROM user_lists WHERE user_id = ${userId} AND removed_at IS NULL AND deleted_at IS NULL)`,
            )
            .execute()
        ).map((r) => r.place_id),
  );
  const tombstones = await readTombstones(
    db,
    userId,
    work.map((w) => w.m.id),
  );

  // 4. Decide each mutation, in parent-first order.
  const writes = new Map<SyncTable, Map<string, Row>>();
  const write = (table: SyncTable, row: Row) => {
    if (!writes.has(table)) writes.set(table, new Map());
    writes.get(table)?.set(row.id, row);
    state.get(table)?.set(row.id, row);
  };
  const granted: string[] = [];
  const ensureMyPlace = (placeId: string) => {
    const id = userPlaceRowId(placeId);
    if (myPlaces.has(id)) return;
    granted.push(placeId);
    const row: Row = {
      user_id: userId,
      id,
      place_id: placeId,
      saved_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      client_updated_at: 0,
      seq: 0,
    };
    myPlaces.set(id, row);
    write("user_places", row);
  };
  const newTombstones: { user_id: string; table_name: string; id: string; deleted_at: number }[] =
    [];
  const dbRow = (table: SyncTable, row: Row, m: Mutation) =>
    toDbRow(table, row, userId, { clientUpdatedAt: m.clientUpdatedAt }) as unknown as Row;
  const listOf = (listId: unknown) => state.get("lists")?.get(String(listId));
  const iOwn = (listId: unknown) => {
    const list = listOf(listId);
    const access = myLists.get(userListRowId(String(listId)));
    return Boolean(
      list && list.provider == null && access?.role === "owner" && access.removed_at == null,
    );
  };

  const canSeePlace = (placeId: unknown) => {
    const id = String(placeId);
    return Boolean(
      state.get("places")?.get(id) && (myPlaces.has(userPlaceRowId(id)) || listedPlaces.has(id)),
    );
  };

  for (const { m, row } of work) {
    const table = m.table;
    const existing = state.get(table)?.get(m.id);
    const r = row as Row;

    // An existing item is judged by the list it really belongs to.
    if (table === "list_items" && existing && r && String(r.listId) !== String(existing.list_id)) {
      set(m, "rejected", { reason: "not_allowed" });
      continue;
    }
    // Provider lists and their items are read-only; own lists belong to their owner.
    if (table === "lists" || table === "list_items") {
      const listId = table === "lists" ? m.id : (existing?.list_id ?? r?.listId);
      const list = listOf(listId);
      if (list && list.provider != null) {
        set(m, "rejected", { reason: "provider_owned" });
        continue;
      }
      if (table === "lists" && existing && !iOwn(m.id)) {
        set(m, "rejected", { reason: "not_allowed" });
        continue;
      }
      if (table === "list_items" && ((list && !iOwn(listId)) || (existing && !list))) {
        set(m, "rejected", { reason: "not_allowed" });
        continue;
      }
    }

    if (table === "places") {
      // Create from a search result, or refresh an existing shared place's location.
      const source = r.source as { provider: string; externalId: string; signedAt: number };
      if (
        source.externalId.startsWith("pin:") ||
        m.id !== placeRowId(source.provider, source.externalId)
      ) {
        set(m, "rejected", { reason: "not_allowed" });
        continue;
      }
      if (!existing) {
        if (r.lat == null || r.lng == null) {
          set(m, "rejected", { reason: "not_allowed" });
          continue;
        }
        write(
          "places",
          // The result's signing time is when the provider was observed: newer observations win.
          dbRow(
            "places",
            { ...r, deletedAt: null, updatedAt: now, providerSnapshotAt: source.signedAt },
            m,
          ),
        );
        write("place_sources", {
          id: placeSourceRowId(source.provider, source.externalId),
          place_id: m.id,
          provider: source.provider,
          external_id: source.externalId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          client_updated_at: 0,
          seq: 0,
        });
        ensureMyPlace(m.id);
        set(m, "applied");
        continue;
      }
      ensureMyPlace(m.id);
      // Ordered by when the provider was observed (the signed time), never by the client clock:
      // an older result, however recently pushed, can't undo a newer import or search.
      if (
        existing.provider_snapshot_at == null ||
        source.signedAt > Number(existing.provider_snapshot_at)
      ) {
        // Only the location follows a search result; Kakao-sourced titles are never renamed here.
        const update = applyLocationUpdate(
          toAnyRow("places", existing) as PlaceRow,
          {
            lat: r.lat as number | null,
            lng: r.lng as number | null,
            address: r.address as string | null,
            roadAddress: r.roadAddress as string | null,
            addressSource: "search",
          },
          "search",
          now,
          validUntil.get(m.id) ?? null,
        );
        if (update.changed) {
          write("places", {
            ...existing,
            ...toDbRow("places", update.place as unknown as Row, userId, {
              clientUpdatedAt: m.clientUpdatedAt,
            }),
            updated_at: now,
            provider_snapshot_at: source.signedAt,
          } as Row);
        } else {
          // Nothing moved, but this newer observation still outranks anything signed before it.
          write("places", { ...existing, provider_snapshot_at: source.signedAt });
        }
        if (update.history) {
          write(
            "place_locations",
            dbRow("place_locations", update.history as unknown as Row, {
              ...m,
              clientUpdatedAt: 0,
            }),
          );
        }
      }
      set(m, "applied");
      continue;
    }

    // Last write wins per row.
    if (existing && m.clientUpdatedAt <= Number(existing.client_updated_at)) {
      set(m, "ignored_stale", { row: toAnyRow(table, existing) });
      continue;
    }
    // A row deleted before the server ever saw it stays deleted against older writes.
    const tombstone = existing ? undefined : tombstones.get(`${table}:${m.id}`);
    if (tombstone !== undefined && m.clientUpdatedAt <= tombstone) {
      set(m, "ignored_stale");
      continue;
    }

    if (m.op === "delete") {
      if (!existing) {
        newTombstones.push({
          user_id: userId,
          table_name: table,
          id: m.id,
          deleted_at: m.clientUpdatedAt,
        });
        set(m, "applied");
        continue;
      }
      const deleted: Row = {
        ...existing,
        deleted_at: m.clientUpdatedAt,
        updated_at: now,
        client_updated_at: m.clientUpdatedAt,
      };
      if (table === "visit_notes" && existing.origin === "import") deleted.edited_by_user = 1;
      write(table, deleted);
      set(m, "applied");
      continue;
    }

    if (table === "lists") {
      write(
        "lists",
        dbRow(
          "lists",
          {
            ...r,
            provider: null,
            externalId: null,
            ownerName: null,
            removedAtProvider: null,
            providerSnapshotAt: null,
            updatedAt: now,
          },
          m,
        ),
      );
      if (!existing) {
        const access: Row = {
          user_id: userId,
          id: userListRowId(m.id),
          list_id: m.id,
          role: "owner",
          removed_at: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          client_updated_at: 0,
          seq: 0,
        };
        myLists.set(access.id, access);
        write("user_lists", access);
      }
      set(m, "applied");
      continue;
    }

    if (table === "list_items") {
      if (m.id !== ownItemRowId(String(r.listId), String(r.placeId))) {
        set(m, "rejected", { reason: "not_allowed" });
        continue;
      }
      if (!listOf(r.listId) || !canSeePlace(r.placeId)) {
        set(m, "rejected", { reason: "missing_parent" });
        continue;
      }
      write(
        "list_items",
        dbRow(
          "list_items",
          {
            ...r,
            externalId: null,
            providerNote: null,
            providerColor: null,
            removedAtProvider: null,
            providerSnapshotAt: null,
            updatedAt: now,
          },
          m,
        ),
      );
      ensureMyPlace(String(r.placeId));
      set(m, "applied");
      continue;
    }

    // visit_notes and links
    if (!canSeePlace(r.placeId)) {
      set(m, "rejected", { reason: "missing_parent" });
      continue;
    }
    if (table === "visit_notes" && !existing && r.origin === "import") {
      set(m, "rejected", { reason: "not_allowed" });
      continue;
    }
    const next: Row = { ...r, updatedAt: now };
    if (table === "visit_notes" && existing?.origin === "import") {
      Object.assign(next, { origin: "import", originKey: existing.origin_key, editedByUser: true });
    }
    write(table, dbRow(table, next, m));
    ensureMyPlace(String(r.placeId));
    set(m, "applied");
  }

  // Superseded mutations report the outcome of the mutation that replaced them.
  for (const [key, earlier] of superseded) {
    const final = results.get(last.get(key)?.m.mutationId ?? "");
    for (const m of earlier)
      if (final) results.set(m.mutationId, { ...final, mutationId: m.mutationId });
  }

  // 5. Statements, all guarded by the write check.
  const newer = { whereNewer: true };
  const statements = writeStatements(db, ctx, writes, {
    place_sources: { update: [] },
    lists: newer,
    list_items: newer,
    visit_notes: newer,
    links: newer,
  });
  statements.push(...grantStatements(db, ctx, { placeIds: granted }));
  statements.push(
    ...bulkUpsertQuery(db, "tombstones", newTombstones, {
      conflict: ["user_id", "table_name", "id"],
      update: ["deleted_at"],
      where: sql<boolean>`excluded.deleted_at > tombstones.deleted_at`,
      guard: ctx.guard,
    }),
  );
  return {
    statements,
    result: { results: mutations.map((m) => results.get(m.mutationId) as PushResult) },
  };
}

// ---------------------------------------------------------------------------------------------
// Pull

type Cursor = Partial<Record<SyncTable, [number, string]>>;

function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(value: string | null): Cursor {
  if (!value) return {};
  try {
    const parsed = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))) as Record<
      string,
      unknown
    >;
    const out: Cursor = {};
    for (const table of SYNC_TABLES) {
      const v = parsed?.[table];
      if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "string")
        out[table] = [v[0], v[1]];
    }
    return out;
  } catch {
    return {};
  }
}

/** Which rows of each table user U may see. */
function scope(table: SyncTable, userId: string) {
  const myLists = sql`SELECT list_id FROM user_lists WHERE user_id = ${userId} AND removed_at IS NULL AND deleted_at IS NULL`;
  const myPlaces = sql`SELECT place_id FROM user_places WHERE user_id = ${userId} UNION SELECT place_id FROM list_items WHERE list_id IN (${myLists})`;
  switch (table) {
    case "places":
      return sql<boolean>`id IN (${myPlaces})`;
    case "place_sources":
    case "place_locations":
      return sql<boolean>`place_id IN (${myPlaces})`;
    case "lists":
      return sql<boolean>`id IN (${myLists})`;
    case "list_items":
      return sql<boolean>`list_id IN (${myLists})`;
    default:
      return sql<boolean>`user_id = ${userId}`;
  }
}

/** Rows changed after `cursor` within the user's scope, each table paged by keyset (seq, id). */
export async function pull(
  db: Db,
  userId: string,
  cursor: string | null,
  limitPerTable: number = LIMITS.pullPageRows,
): Promise<PullResponse> {
  const position = decodeCursor(cursor);
  const next: Cursor = { ...position };
  const rows: PullResponse["rows"] = [];
  let hasMore = false;
  for (const table of SYNC_TABLES) {
    const [seq, id] = position[table] ?? [-1, ""];
    const page = await db.kysely
      .selectFrom(table as keyof Database)
      .selectAll()
      .where(scope(table, userId))
      .where(sql<boolean>`(seq > ${seq} OR (seq = ${seq} AND id > ${id}))`)
      .orderBy("seq" as never)
      .orderBy("id" as never)
      .limit(limitPerTable + 1)
      .execute();
    if (page.length > limitPerTable) hasMore = true;
    const taken = page.slice(0, limitPerTable) as Row[];
    for (const r of taken) rows.push({ table, row: toAnyRow(table, r) as AnyRow });
    const lastRow = taken.at(-1);
    if (lastRow) next[table] = [Number(lastRow.seq), lastRow.id];
  }
  return { rows, cursor: encodeCursor(next), hasMore };
}
