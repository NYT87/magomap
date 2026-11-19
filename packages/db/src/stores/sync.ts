import {
  type AnyRow,
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
import { kakaoPlaceRowId, newId, ownMembershipRowId } from "@magomap/domain/ids";
import { LIMITS } from "@magomap/domain/limits";
import { type RawBuilder, sql } from "kysely";
import { bulkUpsertQuery, type Db, type Statement } from "../core";
import { inJson, toAnyRow, toDbRow } from "../mapping";
import type { Database } from "../schema";

type Row = Record<string, unknown> & { id: string };
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
  detectedBy: "kakao_import" | "search",
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

async function readByIds(db: Db, userId: string, table: SyncTable, ids: Iterable<string>) {
  const list = [...new Set(ids)];
  const out = new Map<string, Row>();
  if (list.length === 0) return out;
  const rows = await db.kysely
    .selectFrom(table)
    .selectAll()
    .where("user_id", "=", userId)
    .where(inJson(db, "id", list))
    .execute();
  for (const r of rows) out.set((r as Row).id, r as Row);
  return out;
}

/** Latest `valid_until` per place, to chain the next history row. */
export async function latestValidUntil(db: Db, userId: string, placeIds: Iterable<string>) {
  const list = [...new Set(placeIds)];
  const out = new Map<string, number>();
  if (list.length === 0) return out;
  const rows = await db.kysely
    .selectFrom("place_locations")
    .select(["place_id", sql<number>`max(valid_until)`.as("until")])
    .where("user_id", "=", userId)
    .where(inJson(db, "place_id", list))
    .groupBy("place_id")
    .execute();
  for (const r of rows) out.set(r.place_id, Number(r.until));
  return out;
}

export interface TableWriteOptions {
  /** Columns overwritten on conflict (default: every column). */
  update?: string[];
  /** Extra condition on the DO UPDATE. */
  where?: RawBuilder<boolean>;
}

/**
 * Statements that write rows and stamp them with the user's new change_seq, as one batch:
 * bump change_seq, upsert, run `extra`, then stamp seq on every touched row.
 */
export function writeStatements(
  db: Db,
  userId: string,
  writes: Map<SyncTable, Map<string, Row>>,
  opts: {
    newerOnly: Set<SyncTable>;
    tableOptions?: Partial<Record<SyncTable, TableWriteOptions>>;
    /** Targeted statements whose rows also need a new seq. */
    extra?: { statements: Statement[]; touched: [SyncTable, string[]][] };
  },
): Statement[] {
  const statements: Statement[] = [];
  const touched = new Map<SyncTable, Set<string>>();
  const touch = (table: SyncTable, ids: string[]) => {
    if (!touched.has(table)) touched.set(table, new Set());
    for (const id of ids) touched.get(table)?.add(id);
  };
  for (const table of SYNC_TABLES) {
    const rows = [...(writes.get(table)?.values() ?? [])];
    if (rows.length === 0) continue;
    const tableOpts = opts.tableOptions?.[table];
    const columns = (tableOpts?.update ??
      Object.keys(rows[0] as Row).filter((c) => c !== "user_id" && c !== "id")) as never[];
    statements.push(
      ...bulkUpsertQuery(db, table, rows as never[], {
        conflict: ["user_id", "id"] as never[],
        update: columns,
        whereNewer: opts.newerOnly.has(table),
        ...(tableOpts?.where ? { where: tableOpts.where } : {}),
      }),
    );
    touch(
      table,
      rows.map((r) => r.id),
    );
  }
  statements.push(...(opts.extra?.statements ?? []));
  for (const [table, ids] of opts.extra?.touched ?? []) touch(table, ids);
  if (statements.length === 0) return [];
  const bump = db.kysely
    .updateTable("users")
    .set({ change_seq: sql`change_seq + 1` })
    .where("id", "=", userId);
  const stamps = [...touched].map(([table, ids]) =>
    db.kysely
      .updateTable(table)
      .set({ seq: sql`(SELECT change_seq FROM users WHERE id = ${userId})` } as never)
      .where("user_id", "=", userId)
      .where(inJson(db, "id", [...ids])),
  );
  return [bump, ...statements, ...stamps];
}

/** A device clock may run ahead; never accept a time more than this past the server's. */
export const CLOCK_ALLOWANCE_MS = 60_000;

async function readTombstones(db: Db, userId: string, keys: { table: SyncTable; id: string }[]) {
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  const rows = await db.kysely
    .selectFrom("tombstones")
    .select(["table_name", "id", "deleted_at"])
    .where("user_id", "=", userId)
    .where(inJson(db, "id", [...new Set(keys.map((k) => k.id))]))
    .execute();
  for (const r of rows) out.set(`${r.table_name}:${r.id}`, Number(r.deleted_at));
  return out;
}

export async function applyPush(
  db: Db,
  userId: string,
  mutations: Mutation[],
  now: number,
): Promise<PushResponse> {
  const results = new Map<string, PushResult>();
  const set = (m: Mutation, status: PushResult["status"], extra: Partial<PushResult> = {}) =>
    results.set(m.mutationId, { mutationId: m.mutationId, status, ...extra });
  // Clamp times from clocks that run ahead, so one bad device can't lock a row.
  const latest = now + CLOCK_ALLOWANCE_MS;
  const at = (m: Mutation) => Math.min(m.clientUpdatedAt, latest);

  // 1. Validate each mutation on its own.
  const valid: { m: Mutation; row?: Row }[] = [];
  for (const m of mutations) {
    if (m.op === "delete") {
      valid.push({ m });
      continue;
    }
    const parsed = mutationRowSchemas[m.table].safeParse(m.row);
    if (!parsed.success || parsed.data.id !== m.id) set(m, "rejected", { reason: "invalid" });
    else valid.push({ m, row: parsed.data as Row });
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

  // 3. Pre-read the rows, their parents, and tombstones.
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
  const validUntil = await latestValidUntil(db, userId, idsOf("places"));
  const tombstones = await readTombstones(
    db,
    userId,
    work.map((w) => ({ table: w.m.table, id: w.m.id })),
  );

  // 4. Decide each mutation, in parent-first order.
  const writes = new Map<SyncTable, Map<string, Row>>();
  const write = (table: SyncTable, row: Row) => {
    if (!writes.has(table)) writes.set(table, new Map());
    writes.get(table)?.set(row.id, row);
    if (table !== "place_locations") state.get(table)?.set(row.id, row);
  };
  const newTombstones: { user_id: string; table_name: string; id: string; deleted_at: number }[] =
    [];
  const restores = new Set<string>();
  const dbRow = (table: SyncTable, row: Row, m: Mutation) =>
    toDbRow(table, row as never, userId, { clientUpdatedAt: at(m) }) as unknown as Row;
  const isKakaoList = (listId: unknown) =>
    state.get("lists")?.get(String(listId))?.kind === "kakao";

  for (const { m, row } of work) {
    const table = m.table;
    const existing = state.get(table)?.get(m.id);

    // Kakao-owned data is never written by clients.
    if (table === "lists" && (existing?.kind === "kakao" || row?.kind === "kakao")) {
      set(m, "rejected", { reason: "kakao_owned" });
      continue;
    }
    if (
      table === "list_items" &&
      (isKakaoList(row?.listId) || (existing && isKakaoList(existing.list_id)))
    ) {
      set(m, "rejected", { reason: "kakao_owned" });
      continue;
    }

    // Last write wins per row (the SQL repeats this check, for races).
    if (existing && at(m) <= Number(existing.client_updated_at)) {
      set(m, "ignored_stale", { row: toAnyRow(table, existing) });
      continue;
    }
    // A row deleted before the server ever saw it stays deleted against older writes.
    const tombstone = existing ? undefined : tombstones.get(`${table}:${m.id}`);
    if (tombstone !== undefined && at(m) <= tombstone) {
      set(m, "ignored_stale");
      continue;
    }

    if (m.op === "delete") {
      if (!existing) {
        newTombstones.push({ user_id: userId, table_name: table, id: m.id, deleted_at: at(m) });
        set(m, "applied");
        continue;
      }
      const deleted: Row = {
        ...existing,
        deleted_at: at(m),
        updated_at: now,
        client_updated_at: at(m),
      };
      if (table === "visit_notes" && existing.origin === "kakao_list") deleted.edited_by_user = 1;
      write(table, deleted);
      set(m, "applied");
      continue;
    }

    const r = row as Row;
    if (table === "places") {
      if (!existing) {
        const ok =
          r.source === "search" &&
          typeof r.kakaoPlaceId === "string" &&
          m.id === kakaoPlaceRowId(r.kakaoPlaceId) &&
          r.lat != null &&
          r.lng != null;
        if (!ok) {
          set(m, "rejected", { reason: "not_allowed" });
          continue;
        }
        write(table, dbRow(table, { ...r, deletedAt: null, updatedAt: now }, m));
        set(m, "applied");
        continue;
      }
      const current = toAnyRow("places", existing) as PlaceRow;
      const update = applyLocationUpdate(
        current,
        {
          lat: r.lat as number | null,
          lng: r.lng as number | null,
          address: r.address as string | null,
          roadAddress: r.roadAddress as string | null,
          addressSource: r.addressSource as LocationFields["addressSource"],
        },
        "search",
        now,
        validUntil.get(m.id) ?? null,
      );
      write(
        table,
        dbRow(table, { ...update.place, deletedAt: null, updatedAt: now } as unknown as Row, m),
      );
      if (update.history) {
        write(
          "place_locations",
          dbRow("place_locations", update.history as unknown as Row, { ...m, clientUpdatedAt: 0 }),
        );
      }
      set(m, "applied");
      continue;
    }

    if (table === "lists") {
      write(
        table,
        dbRow(
          table,
          {
            ...r,
            kind: "own",
            kakaoFolderId: null,
            subscribed: false,
            removedFromKakaoAt: null,
            updatedAt: now,
          },
          m,
        ),
      );
      set(m, "applied");
      continue;
    }

    if (table === "list_items") {
      if (m.id !== ownMembershipRowId(String(r.listId), String(r.placeId))) {
        set(m, "rejected", { reason: "not_allowed" });
        continue;
      }
      if (
        !state.get("lists")?.get(String(r.listId)) ||
        !state.get("places")?.get(String(r.placeId))
      ) {
        set(m, "rejected", { reason: "missing_parent" });
        continue;
      }
      write(
        table,
        dbRow(
          table,
          {
            ...r,
            kakaoFavoriteSeq: null,
            kakaoNote: null,
            kakaoColor: null,
            removedFromKakaoAt: null,
            updatedAt: now,
          },
          m,
        ),
      );
      set(m, "applied");
      continue;
    }

    // visit_notes and links
    const place = state.get("places")?.get(String(r.placeId));
    if (!place) {
      set(m, "rejected", { reason: "missing_parent" });
      continue;
    }
    if (table === "visit_notes" && !existing && r.origin === "kakao_list") {
      set(m, "rejected", { reason: "not_allowed" });
      continue;
    }
    const next: Row = { ...r, updatedAt: now };
    if (table === "visit_notes" && existing?.origin === "kakao_list") {
      Object.assign(next, {
        origin: "kakao_list",
        originKey: existing.origin_key,
        editedByUser: true,
      });
    }
    write(table, dbRow(table, next, m));
    // A note or link written for a deleted place brings the place back, touching nothing else.
    if (place.deleted_at != null) restores.add(place.id);
    set(m, "applied");
  }

  // Superseded mutations report the outcome of the mutation that replaced them.
  for (const [key, earlier] of superseded) {
    const final = results.get(last.get(key)?.m.mutationId ?? "");
    for (const m of earlier) {
      if (final) results.set(m.mutationId, { ...final, mutationId: m.mutationId });
    }
  }

  // 5. One atomic batch: bump change_seq, write, tombstones, restores, stamp seq.
  const extra: Statement[] = [
    ...bulkUpsertQuery(db, "tombstones", newTombstones, {
      conflict: ["user_id", "table_name", "id"],
      update: ["deleted_at"],
      where: sql<boolean>`excluded.deleted_at > tombstones.deleted_at`,
    }),
  ];
  if (restores.size > 0) {
    extra.push(
      db.kysely
        .updateTable("places")
        .set({ deleted_at: null, updated_at: now })
        .where("user_id", "=", userId)
        .where(inJson(db, "id", [...restores]))
        .where("deleted_at", "is not", null),
    );
  }
  const statements = writeStatements(db, userId, writes, {
    newerOnly: new Set<SyncTable>(["places", "lists", "list_items", "visit_notes", "links"]),
    extra: { statements: extra, touched: [["places", [...restores]]] },
  });
  if (statements.length > 0) await db.atomic(statements);
  return { results: mutations.map((m) => results.get(m.mutationId) as PushResult) };
}

type Cursor = Partial<Record<SyncTable, [number, string]>>;

function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(value: string | null): Cursor {
  if (!value) return {};
  try {
    const parsed = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))) as Cursor;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

/** Rows changed after `cursor`, each table paged by keyset (seq, id). Tombstones included. */
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
      .where(sql<boolean>`user_id = ${userId}`)
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
