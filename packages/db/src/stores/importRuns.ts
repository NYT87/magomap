import type {
  ImportItem,
  ImportList,
  ImportListSummary,
  ImportRunInfo,
  ImportSummary,
  PlaceRow,
  ResumeList,
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
import { CLOCK_ALLOWANCE_MS, LIMITS } from "@magomap/domain/limits";
import { type RawBuilder, sql } from "kysely";
import { bulkUpsertQuery, type Db, type Statement } from "../core";
import { inJson, toAnyRow, toDbRow } from "../mapping";
import { grantStatements, type Row, type WriteContext, withWrite, writeStatements } from "../write";
import {
  applyLocationUpdate,
  assertUserExists,
  latestValidUntil,
  newestListSnapshot,
  placeSnapshot,
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

/** A page arrived out of order, or a list or run was closed before all of its parts arrived. */
export class ImportIncompleteError extends Error {
  constructor(what: string) {
    super(`Import incomplete: ${what}`);
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
}

/** Pages a list needs: its summary's item count in pages, and always page 0 (the list's details). */
const pagesNeeded = (itemCount: number) =>
  Math.max(1, Math.ceil(itemCount / LIMITS.importChunkItems));

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
    : { summary: { ...EMPTY } };
  return { run, state };
}

/** This run's progress row for one of the lists the server fetched at the start. */
async function runList(db: Db, userId: string, runId: string, externalId: string) {
  const row = await db.kysely
    .selectFrom("import_run_lists")
    .selectAll()
    .where("user_id", "=", userId)
    .where("run_id", "=", runId)
    .where("external_id", "=", externalId)
    .executeTakeFirst();
  if (!row) throw new RunNotFoundError();
  return row;
}

const runLists = (db: Db, userId: string, runId: string) =>
  db.kysely
    .selectFrom("import_run_lists")
    .selectAll()
    .where("user_id", "=", userId)
    .where("run_id", "=", runId)
    .orderBy("position")
    .execute();

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

/** Where a run's snapshot came from: kakao-list (server-fetched) or a direct Kakao Map upload. */
export type ImportSource = "kakao_list" | "kakao_map";

/**
 * True when the user already completed an import of a newer snapshot from this provider (from
 * either source). Such an older run never changes the user's list roles or personal removals.
 */
async function olderForUser(db: Db, userId: string, provider: string, snapshotAt: number) {
  const row = await db.kysely
    .selectFrom("user_provider_snapshots")
    .select("snapshot_at")
    .where("user_id", "=", userId)
    .where("provider", "=", provider)
    .executeTakeFirst();
  return row !== undefined && snapshotAt < Number(row.snapshot_at);
}

const same = (a: Row, b: Row) => Object.keys(b).every((k) => k === "seq" || a[k] === b[k]);

export async function startImportRun(
  db: Db,
  userId: string,
  opts: {
    provider: string;
    source: ImportSource;
    complete: boolean;
    subscriptionKnown: boolean;
    importedAt: string;
    /** The provider's list summaries the server fetched; the run imports exactly these. */
    lists: ImportListSummary[];
  },
  now: number,
): Promise<{ runId: string }> {
  const runId = newId();
  const snapshotAt = Date.parse(opts.importedAt);
  // Refused, never clamped: a future snapshot would freeze shared data for everyone.
  if (!Number.isFinite(snapshotAt) || snapshotAt > now + CLOCK_ALLOWANCE_MS) {
    throw new Error("Invalid importedAt");
  }
  if (new Set(opts.lists.map((l) => l.externalId)).size !== opts.lists.length) {
    throw new Error("Duplicate list in the summaries");
  }
  await assertUserExists(db, userId);
  const summary = JSON.stringify({ summary: EMPTY } satisfies RunState);
  // One row per list (never one large value): progress is tracked per list.
  const listRows = opts.lists.map((l, position) => ({
    user_id: userId,
    run_id: runId,
    external_id: l.externalId,
    position,
    name: l.name,
    description: l.description ?? null,
    owner_name: l.ownerName ?? null,
    followed: l.followed ? 1 : 0,
    item_count: l.itemCount,
    pages_done: 0,
    finished: 0,
  }));
  return withWrite(
    db,
    async (ctx) => ({
      statements: [
        db.kysely
          .deleteFrom("import_run_pages")
          .where("user_id", "=", userId)
          .where(
            "run_id",
            "in",
            db.kysely
              .selectFrom("import_runs")
              .select("id")
              .where("user_id", "=", userId)
              .where("status", "=", "running"),
          )
          .where(ctx.guard),
        db.kysely
          .deleteFrom("import_run_lists")
          .where("user_id", "=", userId)
          .where(
            "run_id",
            "in",
            db.kysely
              .selectFrom("import_runs")
              .select("id")
              .where("user_id", "=", userId)
              .where("status", "=", "running"),
          )
          .where(ctx.guard),
        db.kysely
          .updateTable("import_runs")
          .set({ status: "superseded", finished_at: now })
          .where("user_id", "=", userId)
          .where("status", "=", "running")
          .where(ctx.guard),
        {
          compile: () =>
            sql`INSERT INTO import_runs (user_id, id, provider, source, started_at, finished_at, status, complete, subscription_known, snapshot_at, summary_json, error)
            SELECT ${userId}, ${runId}, ${opts.provider}, ${opts.source}, ${now}, NULL, 'running', ${opts.complete ? 1 : 0},
              ${opts.subscriptionKnown ? 1 : 0}, ${Number.isFinite(snapshotAt) ? snapshotAt : now}, ${summary}, NULL
            WHERE ${ctx.guard}`.compile(db.kysely),
        },
        ...bulkUpsertQuery(db, "import_run_lists", listRows, {
          conflict: ["user_id", "run_id", "external_id"],
          update: [],
          guard: ctx.guard,
        }),
      ],
      result: { runId },
    }),
    userExists(userId),
  );
}

/**
 * Imports page `pageIndex` (≤ 500 items) of one of the run's lists. Pages arrive in order;
 * a retried page is applied again (the writes are idempotent).
 */
export async function importListChunk(
  db: Db,
  userId: string,
  runId: string,
  externalId: string,
  pageIndex: number,
  items: ImportItem[],
  now: number,
): Promise<ImportSummary> {
  return withWrite(
    db,
    async (ctx) => {
      await runningRun(db, userId, runId);
      const progress = await runList(db, userId, runId, externalId);
      if (progress.finished === 1) throw new RunClosedError();
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex > progress.pages_done) {
        throw new ImportIncompleteError(`page ${pageIndex} before page ${progress.pages_done}`);
      }
      const meta: Omit<ImportList, "items"> = {
        externalId,
        name: progress.name,
        description: progress.description ?? undefined,
        ownerName: progress.owner_name ?? undefined,
        followed: progress.followed === 1,
      };
      const decided = await decideChunk(db, userId, runId, meta, pageIndex, items, now, ctx);
      decided.statements.push(
        db.kysely
          .updateTable("import_run_lists")
          .set({ pages_done: Math.max(progress.pages_done, pageIndex + 1) })
          .where("user_id", "=", userId)
          .where("run_id", "=", runId)
          .where("external_id", "=", externalId)
          .where(ctx.guard),
      );
      return decided;
    },
    runIsRunning(userId, runId),
  );
}

async function decideChunk(
  db: Db,
  userId: string,
  runId: string,
  meta: Omit<ImportList, "items">,
  pageIndex: number,
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

  const [lists, places, members, notes, myLists, myPlaces, validUntil, listSnapshots, older] =
    await Promise.all([
      readByIds(db, userId, "lists", [listId]),
      readByIds(db, userId, "places", placeIds),
      readByIds(db, userId, "list_items", itemIds),
      readByIds(db, userId, "visit_notes", noteIds),
      readByIds(db, userId, "user_lists", [userListRowId(listId)]),
      readByIds(db, userId, "user_places", placeIds.map(userPlaceRowId)),
      latestValidUntil(db, placeIds),
      newestListSnapshot(db, placeIds),
      olderForUser(db, userId, provider, snapshotAt),
    ]);

  const writes = new Map<SyncTable, Map<string, Row>>();
  const write = (table: SyncTable, row: Row) => {
    if (!writes.has(table)) writes.set(table, new Map());
    writes.get(table)?.set(row.id, row);
  };
  // Existing places newly in this list: everyone who already has the list needs them.
  const sharedPlaceIds: string[] = [];
  // An unchanged list only records the newer snapshot time, without a new seq. Unchanged places
  // and memberships are left alone: the list's snapshot vouches for them (see newestListSnapshot).
  const touchLists: string[] = [];
  // Existing places this user newly saves. A device pulls everything again only on gaining a list,
  // so those no list of theirs shows must be re-stamped for them (see below).
  const savedExisting: string[] = [];

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
    } else if (Number(existingList.provider_snapshot_at) !== snapshotAt) touchLists.push(listId);
  }

  // This user's access: owner only when the snapshot knows who follows what
  const accessId = userListRowId(listId);
  const access = myLists.get(accessId);
  const role = meta.followed
    ? "follower"
    : run.subscription_known === 1
      ? "owner"
      : (access?.role ?? "follower");
  // Gaining the list only writes this row: the user's device then pulls everything again once.
  const gainsList = !access || access.removed_at != null || access.deleted_at != null;
  // A snapshot older than the user's newest one only grants a list they never had: it can't
  // swap their role or bring back a list they removed since.
  const writesAccess = older ? !access : gainsList || access.role !== role;
  const grants = writesAccess && gainsList;
  if (writesAccess) {
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
  }

  // Places, sources, memberships and imported notes. From a list older than the shared one,
  // only this user's own notes (and the places they're about) are imported, never memberships.
  const seenPlaces = new Map<string, Row>();
  for (const item of listIsCurrent ? items : items.filter((i) => i.localNote?.trim())) {
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
    } else if (
      // A newer list holding the place confirmed it, even if the place itself wasn't rewritten.
      snapshotAt >= (placeSnapshot(existing, listSnapshots) ?? snapshotAt) &&
      !seenPlaces.has(placeId)
    ) {
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
      }
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
      if (places.has(placeId)) savedExisting.push(placeId);
    }

    const memberId = providerItemRowId(provider, meta.externalId, item.externalId);
    const member = members.get(memberId);
    // Everyone who has this list now sees this place: re-stamp an existing one so they receive it.
    if (listIsCurrent && places.has(placeId) && (!member || member.place_id !== placeId))
      sharedPlaceIds.push(placeId);
    if (listIsCurrent && isNewer(snapshotAt, member)) {
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
      }
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
        // An older snapshot than the shared list's may create a missing note, never change one.
        listIsCurrent &&
        Number(existingNote.edited_by_user) === 0 &&
        existingNote.deleted_at == null &&
        existingNote.body !== body
      ) {
        write("visit_notes", { ...existingNote, body, updated_at: now });
      }
    }
  }

  // A list the user is gaining brings everything in its full pull; otherwise a newly saved place
  // that no list the user already has shows (the older-snapshot notes path) is re-stamped.
  if (!grants && savedExisting.length > 0) {
    const listed = new Set(
      (
        await db.kysely
          .selectFrom("list_items")
          .select("place_id")
          .where(inJson(db, "place_id", savedExisting))
          .where(
            sql<boolean>`list_id IN (SELECT list_id FROM user_lists WHERE user_id = ${userId} AND removed_at IS NULL AND deleted_at IS NULL)`,
          )
          .execute()
      ).map((r) => r.place_id),
    );
    for (const id of savedExisting) if (!listed.has(id)) sharedPlaceIds.push(id);
  }

  // One row per page, whatever its size: a retried page replaces what it saw.
  const seen = {
    user_id: userId,
    run_id: runId,
    external_id: meta.externalId,
    page: pageIndex,
    item_ids: JSON.stringify(itemIds),
  };
  const statements: Statement[] = [
    ...writeStatements(db, ctx, writes, {
      places: { update: IMPORT_PLACE_COLUMNS },
      visit_notes: {
        update: ["body", "updated_at"],
        // Never overwrite an imported note the user edited or deleted, even concurrently.
        where: sql<boolean>`visit_notes.edited_by_user = 0 AND visit_notes.deleted_at IS NULL`,
      },
    }),
    ...grantStatements(db, ctx, { sharedPlaceIds }),
    ...(touchLists.length > 0
      ? [
          db.kysely
            .updateTable("lists")
            .set({ provider_snapshot_at: snapshotAt })
            .where(inJson(db, "id", touchLists))
            .where(ctx.guard),
        ]
      : []),
    ...bulkUpsertQuery(db, "import_run_pages", [seen], {
      conflict: ["user_id", "run_id", "external_id", "page"],
      update: ["item_ids"],
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
      const progress = await runList(db, userId, runId, externalId);
      // Retried: already finished, nothing more to do.
      if (progress.finished === 1) return { statements: [], result: { ...EMPTY } };
      if (progress.pages_done < pagesNeeded(progress.item_count)) {
        throw new ImportIncompleteError(`list ${externalId} has pages still to import`);
      }
      const listId = providerListRowId(run.provider, externalId);
      const list = (await readByIds(db, userId, "lists", [listId])).get(listId);
      const snapshotAt = Number(run.snapshot_at);
      // Unseen items not already protected by a newer snapshot; the removal records this snapshot.
      // The ids every page of this list held in this run.
      const thisList = sql`p.user_id = ${userId} AND p.run_id = ${runId} AND p.external_id = ${externalId}`;
      const seenIds =
        db.dialect === "sqlite"
          ? sql`SELECT j.value FROM import_run_pages p, json_each(p.item_ids) j WHERE ${thisList}`
          : sql`SELECT jsonb_array_elements_text(p.item_ids::jsonb) FROM import_run_pages p WHERE ${thisList}`;
      const notSeen = sql<boolean>`list_id = ${listId} AND (provider_snapshot_at IS NULL OR provider_snapshot_at < ${snapshotAt}) AND id NOT IN (${seenIds})`;
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
        saveState(db, userId, runId, { ...state, summary: add(state.summary, counts) }, ctx),
        db.kysely
          .updateTable("import_run_lists")
          .set({ finished: 1 })
          .where("user_id", "=", userId)
          .where("run_id", "=", runId)
          .where("external_id", "=", externalId)
          .where(ctx.guard),
      ];
      if (run.complete === 1 && isNewer(snapshotAt, list)) {
        statements.unshift(
          db.kysely
            .updateTable("list_items")
            .set({
              removed_at_provider: now,
              provider_snapshot_at: snapshotAt,
              updated_at: now,
              seq: ctx.seq,
            })
            .where(notSeen)
            // A membership already removed keeps the snapshot that removed it (newestListSnapshot).
            .where("removed_at_provider", "is", null)
            .where(ctx.guard),
        );
      }
      return { statements, result: { ...EMPTY, ...counts } };
    },
    runIsRunning(userId, runId),
  );
}

/**
 * Ends the run once every list in it finished. In a complete snapshot (even one with no lists),
 * lists this user has at this provider but missing from the snapshot are removed: for everyone
 * if the user owns them (and the snapshot knows ownership), otherwise only for this user.
 */
export async function completeImportRun(
  db: Db,
  userId: string,
  runId: string,
  now: number,
): Promise<ImportSummary> {
  return withWrite(
    db,
    async (ctx) => {
      const { run, state } = await runningRun(db, userId, runId);
      const progress = await runLists(db, userId, runId);
      const open = progress.filter((p) => p.finished !== 1);
      if (open.length > 0) {
        throw new ImportIncompleteError(`${open.length} list(s) not finished`);
      }
      const snapshotAt = Number(run.snapshot_at);
      const statements: Statement[] = [];
      let removed = 0;
      if (run.complete === 1) {
        const older = await olderForUser(db, userId, run.provider, snapshotAt);
        const keep = new Set(progress.map((p) => providerListRowId(run.provider, p.external_id)));
        const mine = await db.kysely
          .selectFrom("user_lists")
          .innerJoin("lists", "lists.id", "user_lists.list_id")
          .select([
            "user_lists.id as access_id",
            "user_lists.list_id",
            "user_lists.role",
            "lists.provider_snapshot_at",
            "lists.removed_at_provider",
          ])
          .where("user_lists.user_id", "=", userId)
          .where("user_lists.removed_at", "is", null)
          .where("lists.provider", "=", run.provider)
          .execute();
        const absent = mine.filter((m) => !keep.has(m.list_id));
        const authoritative = (m: (typeof absent)[number]) =>
          m.role === "owner" &&
          run.subscription_known === 1 &&
          (m.provider_snapshot_at == null || snapshotAt >= Number(m.provider_snapshot_at));
        // Already removed at the provider: a newer owner snapshot confirms it (a later, older
        // snapshot can't bring the list back). The removal time stays; nothing new to send.
        const confirmed = absent
          .filter((m) => m.removed_at_provider != null && authoritative(m))
          .filter((m) => Number(m.provider_snapshot_at) !== snapshotAt)
          .map((m) => m.list_id);
        if (confirmed.length > 0) {
          statements.push(
            db.kysely
              .updateTable("lists")
              .set({ provider_snapshot_at: snapshotAt })
              .where(inJson(db, "id", confirmed))
              .where(ctx.guard),
          );
        }
        const missing = absent.filter((m) => m.removed_at_provider == null);
        const everyone = missing.filter(authoritative).map((m) => m.list_id);
        // A snapshot older than the user's newest one never removes lists for them personally.
        const justMe = older
          ? []
          : missing.filter((m) => !everyone.includes(m.list_id)).map((m) => m.access_id);
        removed = everyone.length + justMe.length;
        if (everyone.length > 0) {
          statements.push(
            db.kysely
              .updateTable("lists")
              .set({
                removed_at_provider: now,
                provider_snapshot_at: snapshotAt,
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
        // The user's newest complete snapshot from this provider (never lowered).
        statements.push(
          ...bulkUpsertQuery(
            db,
            "user_provider_snapshots",
            [{ user_id: userId, provider: run.provider, snapshot_at: snapshotAt }],
            {
              conflict: ["user_id", "provider"],
              update: ["snapshot_at"],
              where: sql<boolean>`excluded.snapshot_at > user_provider_snapshots.snapshot_at`,
              guard: ctx.guard,
            },
          ),
        );
      }
      const summary = add(state.summary, { listsRemoved: removed });
      statements.push(
        db.kysely
          .deleteFrom("import_run_pages")
          .where("user_id", "=", userId)
          .where("run_id", "=", runId)
          .where(ctx.guard),
        db.kysely
          .deleteFrom("import_run_lists")
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
  const progress =
    run.status === "running"
      ? await runLists(db, userId, run.id).then((lists) => ({
          listsDone: lists.filter((l) => l.finished === 1).length,
          listCount: lists.length,
        }))
      : undefined;
  return {
    runId: run.id,
    status: run.status as ImportRunInfo["status"],
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    summary: state?.summary ?? null,
    snapshotAt: Number(run.snapshot_at),
    ...(progress ? { progress } : {}),
  };
}

/** Where the running run stands, list by list, so an interrupted import can be continued. */
export async function runProgress(
  db: Db,
  userId: string,
  runId: string,
): Promise<{ snapshotAt: number; lists: ResumeList[] }> {
  const { run } = await runningRun(db, userId, runId);
  const lists = (await runLists(db, userId, runId)).map((l) => ({
    externalId: l.external_id,
    name: l.name,
    itemCount: l.item_count,
    pagesDone: l.pages_done,
    finished: l.finished === 1,
  }));
  return { snapshotAt: Number(run.snapshot_at), lists };
}

/** True when the user has a completed import of exactly this kakao-list sync. */
export async function importedSnapshot(
  db: Db,
  userId: string,
  snapshotAt: number,
): Promise<boolean> {
  const row = await db.kysely
    .selectFrom("import_runs")
    .select("id")
    .where("user_id", "=", userId)
    .where("source", "=", "kakao_list")
    .where("status", "=", "completed")
    .where("snapshot_at", "=", snapshotAt)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** True when the user completed a complete import from kakao-list. */
export async function migratedFromKakaoList(db: Db, userId: string): Promise<boolean> {
  const row = await db.kysely
    .selectFrom("import_runs")
    .select("id")
    .where("user_id", "=", userId)
    .where("source", "=", "kakao_list")
    .where("status", "=", "completed")
    .where("complete", "=", 1)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** The running run's snapshot time and fetched list summaries (for the server-driven import). */
export async function runSnapshot(
  db: Db,
  userId: string,
  runId: string,
): Promise<{ provider: string; snapshotAt: number; lists: ImportListSummary[] }> {
  const { run } = await runningRun(db, userId, runId);
  const lists = (await runLists(db, userId, runId)).map((l) => ({
    externalId: l.external_id,
    name: l.name,
    ...(l.description == null ? {} : { description: l.description }),
    ...(l.owner_name == null ? {} : { ownerName: l.owner_name }),
    followed: l.followed === 1,
    itemCount: l.item_count,
  }));
  return { provider: run.provider, snapshotAt: Number(run.snapshot_at), lists };
}
