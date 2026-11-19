import type {
  ImportItem,
  ImportList,
  ImportListSummary,
  ImportRunInfo,
  ImportSummary,
  PlaceRow,
  SyncTable,
} from "@magomap/domain";
import {
  importedNoteRowId,
  newId,
  pinRowId,
  placeRowId,
  placeSourceRowId,
  providerItemRowId,
  providerListRowId,
  userListRowId,
  userPlaceRowId,
} from "@magomap/domain/ids";
import { CLOCK_ALLOWANCE_MS } from "@magomap/domain/limits";
import { type RawBuilder, sql } from "kysely";
import { bulkUpsertQuery, type Db, type Statement } from "../core";
import { inJson, toAnyRow, toDbRow } from "../mapping";
import { grantStatements, type Row, type WriteContext, withWrite, writeStatements } from "../write";
import {
  applyLocationUpdate,
  assertUserExists,
  latestValidUntil,
  readByIds,
  userExists,
} from "./sync";

export class RunClosedError extends Error {
  constructor() {
    super("This import run is no longer running");
  }
}
/** A list row with this id exists but isn't that provider's list; the import refuses to touch it. */
export class ImportConflictError extends Error {
  constructor() {
    super("A list with this id exists and isn't this provider's list");
  }
}

export class RunNotFoundError extends Error {
  constructor() {
    super("Import run not found");
  }
}

const EMPTY: ImportSummary = {
  listsAdded: 0,
  listsUpdated: 0,
  listsRemoved: 0,
  placesAdded: 0,
  placesMoved: 0,
  membershipsRemoved: 0,
  membershipsRestored: 0,
  notesImported: 0,
};

interface RunState {
  summary: ImportSummary;
  finishedLists: number;
  /** The provider's list summaries the server fetched when the run started. */
  lists?: ImportListSummary[];
}

function add(a: ImportSummary, b: Partial<ImportSummary>): ImportSummary {
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof ImportSummary)[]) out[k] += b[k] ?? 0;
  return out;
}

/** Place columns an import may refresh (never the sync clock or deletion state). */
const IMPORT_PLACE_COLUMNS = [
  "title",
  "category",
  "phone",
  "lat",
  "lng",
  "address",
  "address_source",
  "provider_snapshot_at",
  "updated_at",
];

async function runningRun(db: Db, userId: string, runId: string) {
  const run = await db.kysely
    .selectFrom("import_runs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("id", "=", runId)
    .executeTakeFirst();
  if (!run) throw new RunNotFoundError();
  if (run.status !== "running") throw new RunClosedError();
  const state: RunState = run.summary_json
    ? (JSON.parse(run.summary_json) as RunState)
    : { summary: { ...EMPTY }, finishedLists: 0 };
  return { run, state };
}

/** True while the run is the user's running import; checked at write time. */
function runIsRunning(userId: string, runId: string): RawBuilder<boolean> {
  return sql<boolean>`EXISTS (SELECT 1 FROM import_runs WHERE user_id = ${userId} AND id = ${runId} AND status = 'running')`;
}

function saveState(
  db: Db,
  userId: string,
  runId: string,
  state: RunState,
  ctx: WriteContext,
): Statement {
  return db.kysely
    .updateTable("import_runs")
    .set({ summary_json: JSON.stringify(state) })
    .where("user_id", "=", userId)
    .where("id", "=", runId)
    .where(ctx.guard);
}

/** Shared rows are only written from a snapshot at least as new as the one that last wrote them. */
const isNewer = (snapshotAt: number, row: Row | undefined) =>
  !row || row.provider_snapshot_at == null || snapshotAt >= Number(row.provider_snapshot_at);

const same = (a: Row, b: Row) => Object.keys(b).every((k) => k === "seq" || a[k] === b[k]);

export async function startImportRun(
  db: Db,
  userId: string,
  opts: {
    provider: string;
    complete: boolean;
    subscriptionKnown: boolean;
    importedAt: string;
    lists?: ImportListSummary[];
  },
  now: number,
): Promise<{ runId: string }> {
  const runId = newId();
  const snapshotAt = Date.parse(opts.importedAt);
  // Refused, never clamped: a future snapshot would freeze shared data for everyone.
  if (!Number.isFinite(snapshotAt) || snapshotAt > now + CLOCK_ALLOWANCE_MS) {
    throw new Error("Invalid importedAt");
  }
  await assertUserExists(db, userId);
  const summary = JSON.stringify({
    summary: EMPTY,
    finishedLists: 0,
    lists: opts.lists ?? [],
  } satisfies RunState);
  return withWrite(
    db,
    async (ctx) => ({
      statements: [
        db.kysely
          .updateTable("import_runs")
          .set({ status: "superseded", finished_at: now })
          .where("user_id", "=", userId)
          .where("status", "=", "running")
          .where(ctx.guard),
        {
          compile: () =>
            sql`INSERT INTO import_runs (user_id, id, provider, started_at, finished_at, status, complete, subscription_known, snapshot_at, summary_json, error)
            SELECT ${userId}, ${runId}, ${opts.provider}, ${now}, NULL, 'running', ${opts.complete ? 1 : 0},
              ${opts.subscriptionKnown ? 1 : 0}, ${Number.isFinite(snapshotAt) ? snapshotAt : now}, ${summary}, NULL
            WHERE ${ctx.guard}`.compile(db.kysely),
        },
      ],
      result: { runId },
    }),
    userExists(userId),
  );
}

/** Imports one chunk (≤ 500 items) of one provider list. */
export async function importListChunk(
  db: Db,
  userId: string,
  runId: string,
  meta: Omit<ImportList, "items">,
  items: ImportItem[],
  now: number,
): Promise<ImportSummary> {
  return withWrite(
    db,
    (ctx) => decideChunk(db, userId, runId, meta, items, now, ctx),
    runIsRunning(userId, runId),
  );
}

async function decideChunk(
  db: Db,
  userId: string,
  runId: string,
  meta: Omit<ImportList, "items">,
  items: ImportItem[],
  now: number,
  ctx: WriteContext,
): Promise<{ statements: Statement[]; result: ImportSummary }> {
  const { run, state } = await runningRun(db, userId, runId);
  const provider = run.provider;
  const snapshotAt = Number(run.snapshot_at);
  const counts: Partial<ImportSummary> = {};
  const inc = (k: keyof ImportSummary) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };

  const listId = providerListRowId(provider, meta.externalId);
  const placeIdOf = (i: ImportItem) =>
    i.placeExternalId
      ? placeRowId(provider, i.placeExternalId)
      : pinRowId(provider, meta.externalId, i.externalId);
  const sourceIdOf = (i: ImportItem) =>
    i.placeExternalId ?? `pin:${meta.externalId}:${i.externalId}`;
  const placeIds = items.map(placeIdOf);
  const itemIds = items.map((i) => providerItemRowId(provider, meta.externalId, i.externalId));
  const noteIds = items
    .filter((i) => i.localNote?.trim())
    .map((i) => importedNoteRowId(placeIdOf(i), listId));

  const [lists, places, members, notes, myLists, myPlaces, validUntil] = await Promise.all([
    readByIds(db, userId, "lists", [listId]),
    readByIds(db, userId, "places", placeIds),
    readByIds(db, userId, "list_items", itemIds),
    readByIds(db, userId, "visit_notes", noteIds),
    readByIds(db, userId, "user_lists", [userListRowId(listId)]),
    readByIds(db, userId, "user_places", placeIds.map(userPlaceRowId)),
    latestValidUntil(db, placeIds),
  ]);

  const writes = new Map<SyncTable, Map<string, Row>>();
  const write = (table: SyncTable, row: Row) => {
    if (!writes.has(table)) writes.set(table, new Map());
    writes.get(table)?.set(row.id, row);
  };
  const grantPlaces: string[] = [];
  const grantLists: string[] = [];
  // Rows whose content is unchanged only record the newer snapshot time, without a new seq.
  const touch = { places: [] as string[], lists: [] as string[], list_items: [] as string[] };

  // The shared list
  const existingList = lists.get(listId);
  if (
    existingList &&
    (existingList.provider !== provider || existingList.external_id !== meta.externalId)
  ) {
    throw new ImportConflictError();
  }
  // An older snapshot than the list's own never changes what's in the list (it still grants access).
  const listIsCurrent = !existingList || isNewer(snapshotAt, existingList);
  const listRow: Row = {
    id: listId,
    provider,
    external_id: meta.externalId,
    name: meta.name,
    description: meta.description ?? null,
    color: null,
    owner_name: meta.ownerName ?? null,
    removed_at_provider: null,
    provider_snapshot_at: snapshotAt,
    created_at: existingList?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    client_updated_at: 0,
    seq: 0,
  };
  if (!existingList) {
    write("lists", listRow);
    inc("listsAdded");
  } else if (isNewer(snapshotAt, existingList)) {
    const changed = !same(existingList, {
      ...listRow,
      updated_at: existingList.updated_at,
      provider_snapshot_at: existingList.provider_snapshot_at,
    });
    if (changed) {
      inc("listsUpdated");
      write("lists", listRow);
    } else if (Number(existingList.provider_snapshot_at) !== snapshotAt) touch.lists.push(listId);
  }

  // This user's access: owner only when the snapshot knows who follows what
  const accessId = userListRowId(listId);
  const access = myLists.get(accessId);
  const role = meta.followed
    ? "follower"
    : run.subscription_known === 1
      ? "owner"
      : (access?.role ?? "follower");
  if (!access || access.removed_at != null || access.deleted_at != null || access.role !== role) {
    write("user_lists", {
      user_id: userId,
      id: accessId,
      list_id: listId,
      role,
      removed_at: null,
      created_at: access?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      client_updated_at: 0,
      seq: 0,
    });
    if (!access || access.removed_at != null || access.deleted_at != null) grantLists.push(listId);
  }

  // Places, sources, memberships and imported notes
  const seenPlaces = new Map<string, Row>();
  for (const item of listIsCurrent ? items : []) {
    const placeId = placeIdOf(item);
    const existing = seenPlaces.get(placeId) ?? places.get(placeId);
    if (!existing) {
      const placeRow: Row = {
        id: placeId,
        title: item.title,
        address: item.address ?? null,
        road_address: null,
        address_source: item.address ? "import" : null,
        category: item.category ?? null,
        phone: item.phone ?? null,
        lat: item.lat ?? null,
        lng: item.lng ?? null,
        provider_snapshot_at: snapshotAt,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        client_updated_at: 0,
        seq: 0,
      };
      write("places", placeRow);
      write("place_sources", {
        id: placeSourceRowId(provider, sourceIdOf(item)),
        place_id: placeId,
        provider,
        external_id: sourceIdOf(item),
        created_at: now,
        updated_at: now,
        deleted_at: null,
        client_updated_at: 0,
        seq: 0,
      });
      seenPlaces.set(placeId, placeRow);
      inc("placesAdded");
    } else if (isNewer(snapshotAt, existing) && !seenPlaces.has(placeId)) {
      const current = toAnyRow("places", existing) as PlaceRow;
      const update = applyLocationUpdate(
        current,
        {
          lat: item.lat,
          lng: item.lng,
          address: item.address,
          addressSource: item.address ? "import" : undefined,
        },
        "import",
        now,
        validUntil.get(placeId) ?? null,
      );
      const refreshed = {
        ...existing,
        ...toDbRow(
          "places",
          {
            ...update.place,
            title: item.title || current.title,
            category: item.category ?? current.category,
            phone: item.phone ?? current.phone,
          },
          "",
          { clientUpdatedAt: Number(existing.client_updated_at) },
        ),
        provider_snapshot_at: snapshotAt,
      } as Row;
      if (
        !same(existing, {
          ...refreshed,
          updated_at: existing.updated_at,
          provider_snapshot_at: existing.provider_snapshot_at,
        })
      ) {
        write("places", { ...refreshed, updated_at: now });
      } else if (Number(existing.provider_snapshot_at) !== snapshotAt) touch.places.push(placeId);
      if (update.history) {
        write(
          "place_locations",
          toDbRow("place_locations", update.history, "", { clientUpdatedAt: 0 }) as unknown as Row,
        );
        validUntil.set(placeId, now);
        inc("placesMoved");
      }
      seenPlaces.set(placeId, refreshed);
    } else {
      seenPlaces.set(placeId, existing);
    }
    const myPlaceId = userPlaceRowId(placeId);
    if (!myPlaces.has(myPlaceId)) {
      const mine: Row = {
        user_id: userId,
        id: myPlaceId,
        place_id: placeId,
        saved_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        client_updated_at: 0,
        seq: 0,
      };
      myPlaces.set(myPlaceId, mine);
      write("user_places", mine);
      grantPlaces.push(placeId);
    }

    const memberId = providerItemRowId(provider, meta.externalId, item.externalId);
    const member = members.get(memberId);
    // Everyone who has this list now sees this place: re-stamp an existing one so they receive it.
    if (!member && places.has(placeId)) grantPlaces.push(placeId);
    if (isNewer(snapshotAt, member)) {
      const memberRow: Row = {
        id: memberId,
        list_id: listId,
        place_id: placeId,
        position: item.position,
        added_at: member?.added_at ?? now,
        external_id: item.externalId,
        provider_note: item.providerNote ?? null,
        provider_color: item.providerColor ?? null,
        removed_at_provider: null,
        provider_snapshot_at: snapshotAt,
        created_at: member?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
        client_updated_at: 0,
        seq: 0,
      };
      if (
        !member ||
        !same(member, {
          ...memberRow,
          updated_at: member.updated_at,
          provider_snapshot_at: member.provider_snapshot_at,
        })
      ) {
        write("list_items", memberRow);
      } else if (Number(member.provider_snapshot_at) !== snapshotAt)
        touch.list_items.push(memberId);
      if (member?.removed_at_provider != null) inc("membershipsRestored");
    }

    const body = item.localNote?.trim();
    if (body) {
      const noteId = importedNoteRowId(placeId, listId);
      const existingNote = notes.get(noteId);
      if (!existingNote) {
        write("visit_notes", {
          user_id: userId,
          id: noteId,
          place_id: placeId,
          visited_on: null,
          body,
          origin: "import",
          origin_key: listId,
          edited_by_user: 0,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          client_updated_at: 0,
          seq: 0,
        });
        inc("notesImported");
      } else if (
        Number(existingNote.edited_by_user) === 0 &&
        existingNote.deleted_at == null &&
        existingNote.body !== body
      ) {
        write("visit_notes", { ...existingNote, body, updated_at: now });
      }
    }
  }

  const seen = itemIds.map((id) => ({ user_id: userId, run_id: runId, list_item_id: id }));
  const statements: Statement[] = [
    ...writeStatements(db, ctx, writes, {
      places: { update: IMPORT_PLACE_COLUMNS },
      visit_notes: {
        update: ["body", "updated_at"],
        // Never overwrite an imported note the user edited or deleted, even concurrently.
        where: sql<boolean>`visit_notes.edited_by_user = 0 AND visit_notes.deleted_at IS NULL`,
      },
    }),
    ...grantStatements(db, ctx, { placeIds: grantPlaces, listIds: grantLists }),
    ...(Object.entries(touch) as [keyof typeof touch, string[]][])
      .filter(([, ids]) => ids.length > 0)
      .map(([table, ids]) =>
        db.kysely
          .updateTable(table)
          .set({ provider_snapshot_at: snapshotAt })
          .where(inJson(db, "id", ids))
          .where(ctx.guard),
      ),
    ...bulkUpsertQuery(db, "import_seen", seen, {
      conflict: ["user_id", "run_id", "list_item_id"],
      update: [],
      guard: ctx.guard,
    }),
    saveState(db, userId, runId, { ...state, summary: add(state.summary, counts) }, ctx),
  ];
  return { statements, result: { ...EMPTY, ...counts } };
}

/** After a list's last chunk: in a complete, current snapshot, its unseen items are removed at the provider. */
export async function finishImportList(
  db: Db,
  userId: string,
  runId: string,
  externalId: string,
  now: number,
): Promise<ImportSummary> {
  return withWrite(
    db,
    async (ctx) => {
      const { run, state } = await runningRun(db, userId, runId);
      const listId = providerListRowId(run.provider, externalId);
      const list = (await readByIds(db, userId, "lists", [listId])).get(listId);
      const snapshotAt = Number(run.snapshot_at);
      // Unseen items not already protected by a newer snapshot; the removal records this snapshot.
      const notSeen = sql<boolean>`list_id = ${listId} AND (provider_snapshot_at IS NULL OR provider_snapshot_at < ${snapshotAt}) AND id NOT IN (SELECT list_item_id FROM import_seen WHERE user_id = ${userId} AND run_id = ${runId})`;
      // An incomplete or older snapshot may hold a partial or outdated list: it never marks removals.
      const removing =
        run.complete === 1 && isNewer(Number(run.snapshot_at), list)
          ? Number(
              (
                await db.kysely
                  .selectFrom("list_items")
                  .select(sql<number>`count(*)`.as("n"))
                  .where(notSeen)
                  .where("removed_at_provider", "is", null)
                  .executeTakeFirst()
              )?.n ?? 0,
            )
          : 0;
      const counts = { membershipsRemoved: removing };
      const statements: Statement[] = [
        saveState(
          db,
          userId,
          runId,
          { ...state, summary: add(state.summary, counts), finishedLists: state.finishedLists + 1 },
          ctx,
        ),
      ];
      if (run.complete === 1 && isNewer(snapshotAt, list)) {
        statements.unshift(
          db.kysely
            .updateTable("list_items")
            .set({
              removed_at_provider: sql`COALESCE(removed_at_provider, ${now})`,
              provider_snapshot_at: snapshotAt,
              updated_at: now,
              seq: ctx.seq,
            })
            .where(notSeen)
            .where(ctx.guard),
        );
      }
      return { statements, result: { ...EMPTY, ...counts } };
    },
    runIsRunning(userId, runId),
  );
}

/**
 * Ends the run. In a complete snapshot that finished at least one list, lists this user has at
 * this provider but missing from the snapshot are removed: for everyone if the user owns them
 * (and the snapshot knows ownership), otherwise only for this user (they unfollowed).
 */
export async function completeImportRun(
  db: Db,
  userId: string,
  runId: string,
  externalIds: string[],
  now: number,
): Promise<ImportSummary> {
  return withWrite(
    db,
    async (ctx) => {
      const { run, state } = await runningRun(db, userId, runId);
      const statements: Statement[] = [];
      let removed = 0;
      if (run.complete === 1 && state.finishedLists > 0) {
        const keep = new Set(externalIds.map((e) => providerListRowId(run.provider, e)));
        const mine = await db.kysely
          .selectFrom("user_lists")
          .innerJoin("lists", "lists.id", "user_lists.list_id")
          .select([
            "user_lists.id as access_id",
            "user_lists.list_id",
            "user_lists.role",
            "lists.provider_snapshot_at",
          ])
          .where("user_lists.user_id", "=", userId)
          .where("user_lists.removed_at", "is", null)
          .where("lists.provider", "=", run.provider)
          .where("lists.removed_at_provider", "is", null)
          .execute();
        const missing = mine.filter((m) => !keep.has(m.list_id));
        const everyone = missing
          .filter((m) => m.role === "owner" && run.subscription_known === 1)
          .filter(
            (m) =>
              m.provider_snapshot_at == null ||
              Number(run.snapshot_at) >= Number(m.provider_snapshot_at),
          )
          .map((m) => m.list_id);
        const justMe = missing.filter((m) => !everyone.includes(m.list_id)).map((m) => m.access_id);
        removed = missing.length;
        if (everyone.length > 0) {
          statements.push(
            db.kysely
              .updateTable("lists")
              .set({
                removed_at_provider: now,
                provider_snapshot_at: Number(run.snapshot_at),
                updated_at: now,
                seq: ctx.seq,
              })
              .where(inJson(db, "id", everyone))
              .where(ctx.guard),
          );
        }
        if (justMe.length > 0) {
          statements.push(
            db.kysely
              .updateTable("user_lists")
              .set({ removed_at: now, updated_at: now, seq: ctx.seq })
              .where("user_id", "=", userId)
              .where(inJson(db, "id", justMe))
              .where(ctx.guard),
          );
        }
      }
      const summary = add(state.summary, { listsRemoved: removed });
      statements.push(
        db.kysely
          .deleteFrom("import_seen")
          .where("user_id", "=", userId)
          .where("run_id", "=", runId)
          .where(ctx.guard),
        db.kysely
          .updateTable("import_runs")
          .set({
            status: "completed",
            finished_at: now,
            summary_json: JSON.stringify({ ...state, summary }),
          })
          .where("user_id", "=", userId)
          .where("id", "=", runId)
          .where(ctx.guard),
      );
      return { statements, result: summary };
    },
    runIsRunning(userId, runId),
  );
}

export async function latestImportRun(db: Db, userId: string): Promise<ImportRunInfo | null> {
  const run = await db.kysely
    .selectFrom("import_runs")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("started_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!run) return null;
  const state = run.summary_json ? (JSON.parse(run.summary_json) as RunState) : null;
  return {
    runId: run.id,
    status: run.status as ImportRunInfo["status"],
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    summary: state?.summary ?? null,
  };
}

/** The running run's snapshot time and fetched list summaries (for the server-driven import). */
export async function runSnapshot(
  db: Db,
  userId: string,
  runId: string,
): Promise<{ provider: string; snapshotAt: number; lists: ImportListSummary[] }> {
  const { run, state } = await runningRun(db, userId, runId);
  return { provider: run.provider, snapshotAt: Number(run.snapshot_at), lists: state.lists ?? [] };
}
