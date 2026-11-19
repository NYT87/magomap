import type {
  ImportItem,
  ImportList,
  ImportRunInfo,
  ImportSummary,
  PlaceRow,
  SyncTable,
} from "@magomap/domain";
import {
  customPinRowId,
  importedNoteRowId,
  kakaoListRowId,
  kakaoMembershipRowId,
  kakaoPlaceRowId,
  newId,
} from "@magomap/domain/ids";
import { sql } from "kysely";
import { bulkUpsertQuery, type Db, type Statement } from "../core";
import { inJson, toAnyRow, toDbRow } from "../mapping";
import { applyLocationUpdate, latestValidUntil, writeStatements } from "./sync";

type Row = Record<string, unknown> & { id: string };

export class RunClosedError extends Error {
  constructor() {
    super("This import run is no longer running");
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
}

function add(a: ImportSummary, b: Partial<ImportSummary>): ImportSummary {
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof ImportSummary)[]) out[k] += b[k] ?? 0;
  return out;
}

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

function saveState(db: Db, userId: string, runId: string, state: RunState): Statement {
  return db.kysely
    .updateTable("import_runs")
    .set({ summary_json: JSON.stringify(state) })
    .where("user_id", "=", userId)
    .where("id", "=", runId);
}

async function readIds(db: Db, userId: string, table: SyncTable, ids: string[]) {
  const out = new Map<string, Row>();
  if (ids.length === 0) return out;
  const rows = await db.kysely
    .selectFrom(table)
    .selectAll()
    .where("user_id", "=", userId)
    .where(inJson(db, "id", [...new Set(ids)]))
    .execute();
  for (const r of rows) out.set((r as Row).id, r as Row);
  return out;
}

const same = (a: Row, b: Row) => Object.keys(b).every((k) => k === "seq" || a[k] === b[k]);

export async function startImportRun(
  db: Db,
  userId: string,
  opts: { complete: boolean; importedAt: string },
  now: number,
): Promise<{ runId: string }> {
  const runId = newId();
  await db.atomic([
    db.kysely
      .updateTable("import_runs")
      .set({ status: "superseded", finished_at: now })
      .where("user_id", "=", userId)
      .where("status", "=", "running"),
    db.kysely.insertInto("import_runs").values({
      user_id: userId,
      id: runId,
      started_at: now,
      finished_at: null,
      status: "running",
      complete: opts.complete ? 1 : 0,
      summary_json: JSON.stringify({ summary: EMPTY, finishedLists: 0 } satisfies RunState),
      error: null,
    }),
  ]);
  return { runId };
}

/** Place columns an import may refresh. */
const IMPORT_PLACE_COLUMNS = [
  "title",
  "category",
  "phone",
  "lat",
  "lng",
  "address",
  "address_source",
  "updated_at",
];

const placeIdOf = (item: ImportItem) =>
  item.placeKey ? kakaoPlaceRowId(item.placeKey) : customPinRowId(item.favoriteSeq);

/** Imports one chunk (≤ 500 items) of one Kakao list, in one atomic batch. */
export async function importListChunk(
  db: Db,
  userId: string,
  runId: string,
  meta: Omit<ImportList, "items">,
  items: ImportItem[],
  now: number,
): Promise<ImportSummary> {
  const { state } = await runningRun(db, userId, runId);
  const counts: Partial<ImportSummary> = {};
  const inc = (k: keyof ImportSummary) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  const listId = kakaoListRowId(meta.kakaoFolderId);
  const placeIds = items.map(placeIdOf);
  const memberIds = items.map((i) => kakaoMembershipRowId(meta.kakaoFolderId, i.favoriteSeq));
  const noteIds = items
    .filter((i) => i.localNote?.trim())
    .map((i) => importedNoteRowId(placeIdOf(i), meta.kakaoFolderId));

  const [lists, places, members, notes, validUntil] = await Promise.all([
    readIds(db, userId, "lists", [listId]),
    readIds(db, userId, "places", placeIds),
    readIds(db, userId, "list_items", memberIds),
    readIds(db, userId, "visit_notes", noteIds),
    latestValidUntil(db, userId, placeIds),
  ]);

  const writes = new Map<SyncTable, Map<string, Row>>();
  const write = (table: SyncTable, row: Row) => {
    if (!writes.has(table)) writes.set(table, new Map());
    writes.get(table)?.set(row.id, row);
  };

  // The list
  const existingList = lists.get(listId);
  const listRow: Row = {
    user_id: userId,
    id: listId,
    kind: "kakao",
    kakao_folder_id: meta.kakaoFolderId,
    subscribed: meta.subscribed ? 1 : 0,
    owner_name: meta.ownerName ?? null,
    name: meta.name,
    description: meta.description ?? null,
    color: null,
    removed_from_kakao_at: null,
    created_at: existingList?.created_at ?? now,
    updated_at: now,
    deleted_at: existingList?.deleted_at ?? null,
    client_updated_at: existingList?.client_updated_at ?? 0,
    seq: 0,
  };
  if (!existingList) {
    write("lists", listRow);
    inc("listsAdded");
  } else if (!same(existingList, { ...listRow, updated_at: existingList.updated_at })) {
    write("lists", listRow);
    inc("listsUpdated");
  }

  // Places, memberships and imported notes
  const seenPlaces = new Map<string, Row>();
  for (const item of items) {
    const placeId = placeIdOf(item);
    const existing = seenPlaces.get(placeId) ?? places.get(placeId);
    let placeRow: Row;
    if (!existing) {
      placeRow = {
        user_id: userId,
        id: placeId,
        kakao_place_id: item.placeKey ?? null,
        title: item.title,
        address: item.address ?? null,
        road_address: null,
        address_source: item.address ? "kakao_import" : null,
        category: item.category ?? null,
        phone: item.phone ?? null,
        lat: item.lat ?? null,
        lng: item.lng ?? null,
        source: "kakao_import",
        created_at: now,
        updated_at: now,
        deleted_at: null,
        client_updated_at: 0,
        seq: 0,
      };
      write("places", placeRow);
      inc("placesAdded");
    } else {
      const current = toAnyRow("places", existing) as PlaceRow;
      const update = applyLocationUpdate(
        current,
        {
          lat: item.lat,
          lng: item.lng,
          address: item.address,
          addressSource: item.address ? "kakao_import" : undefined,
        },
        "kakao_import",
        now,
        validUntil.get(placeId) ?? null,
      );
      const refreshed = toDbRow(
        "places",
        {
          ...update.place,
          title: item.title || current.title,
          category: item.category ?? current.category,
          phone: item.phone ?? current.phone,
        },
        userId,
        { clientUpdatedAt: Number(existing.client_updated_at) },
      ) as unknown as Row;
      placeRow = { ...refreshed, deleted_at: existing.deleted_at, updated_at: existing.updated_at };
      if (!same(existing, placeRow)) {
        write("places", { ...placeRow, updated_at: now });
      }
      if (update.history) {
        write(
          "place_locations",
          toDbRow("place_locations", update.history, userId, {
            clientUpdatedAt: 0,
          }) as unknown as Row,
        );
        validUntil.set(placeId, now);
        inc("placesMoved");
      }
    }
    seenPlaces.set(placeId, placeRow);

    const memberId = kakaoMembershipRowId(meta.kakaoFolderId, item.favoriteSeq);
    const member = members.get(memberId);
    const memberRow: Row = {
      user_id: userId,
      id: memberId,
      list_id: listId,
      place_id: placeId,
      position: item.position,
      added_at: member?.added_at ?? now,
      kakao_favorite_seq: item.favoriteSeq,
      kakao_note: item.kakaoNote ?? null,
      kakao_color: item.kakaoColor ?? null,
      removed_from_kakao_at: null,
      created_at: member?.created_at ?? now,
      updated_at: member?.updated_at ?? now,
      deleted_at: member?.deleted_at ?? null,
      client_updated_at: member?.client_updated_at ?? 0,
      seq: 0,
    };
    if (!member || !same(member, memberRow)) write("list_items", { ...memberRow, updated_at: now });
    if (member?.removed_from_kakao_at != null) inc("membershipsRestored");

    const body = item.localNote?.trim();
    if (body) {
      const noteId = importedNoteRowId(placeId, meta.kakaoFolderId);
      const note = notes.get(noteId);
      if (!note) {
        write("visit_notes", {
          user_id: userId,
          id: noteId,
          place_id: placeId,
          visited_on: null,
          body,
          origin: "kakao_list",
          origin_key: String(meta.kakaoFolderId),
          edited_by_user: 0,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          client_updated_at: 0,
          seq: 0,
        });
        inc("notesImported");
      } else if (
        Number(note.edited_by_user) === 0 &&
        note.deleted_at == null &&
        note.body !== body
      ) {
        write("visit_notes", { ...note, body, updated_at: now });
      }
    }
  }

  const seen = memberIds.map((id) => ({ user_id: userId, run_id: runId, list_item_id: id }));
  const next: RunState = { ...state, summary: add(state.summary, counts) };
  await db.atomic([
    ...writeStatements(db, userId, writes, {
      newerOnly: new Set(),
      tableOptions: {
        // A refresh never touches whether the user deleted the place, or its sync clock.
        places: { update: IMPORT_PLACE_COLUMNS },
        // Never overwrite an imported note the user edited or deleted, even concurrently.
        visit_notes: {
          update: ["body", "updated_at"],
          where: sql<boolean>`visit_notes.edited_by_user = 0 AND visit_notes.deleted_at IS NULL`,
        },
      },
    }),
    ...bulkUpsertQuery(db, "import_seen", seen, {
      conflict: ["user_id", "run_id", "list_item_id"],
      update: [],
    }),
    saveState(db, userId, runId, next),
  ]);
  return { ...EMPTY, ...counts };
}

/** After the last chunk of a list: memberships the run didn't see are marked removed from Kakao. */
export async function finishImportList(
  db: Db,
  userId: string,
  runId: string,
  kakaoFolderId: number,
  now: number,
): Promise<ImportSummary> {
  const { run, state } = await runningRun(db, userId, runId);
  // An incomplete kakao-list snapshot may hold partial lists, so it never marks removals.
  const missing =
    run.complete !== 1
      ? []
      : await db.kysely
          .selectFrom("list_items")
          .selectAll()
          .where("user_id", "=", userId)
          .where("list_id", "=", kakaoListRowId(kakaoFolderId))
          .where("removed_from_kakao_at", "is", null)
          .where(
            sql<boolean>`id NOT IN (SELECT list_item_id FROM import_seen WHERE user_id = ${userId} AND run_id = ${runId})`,
          )
          .execute();
  const writes = new Map<SyncTable, Map<string, Row>>([
    [
      "list_items",
      new Map(
        missing.map((m) => [m.id, { ...m, removed_from_kakao_at: now, updated_at: now } as Row]),
      ),
    ],
  ]);
  const counts = { membershipsRemoved: missing.length };
  const next: RunState = {
    summary: add(state.summary, counts),
    finishedLists: state.finishedLists + 1,
  };
  await db.atomic([
    ...writeStatements(db, userId, writes, { newerOnly: new Set() }),
    saveState(db, userId, runId, next),
  ]);
  return { ...EMPTY, ...counts };
}

/** Ends the run. Only a complete run that finished at least one list marks missing lists as removed. */
export async function completeImportRun(
  db: Db,
  userId: string,
  runId: string,
  kakaoFolderIds: number[],
  now: number,
): Promise<ImportSummary> {
  const { run, state } = await runningRun(db, userId, runId);
  let removed: Row[] = [];
  if (run.complete === 1 && state.finishedLists > 0) {
    const keep = new Set(kakaoFolderIds.map(kakaoListRowId));
    const lists = await db.kysely
      .selectFrom("lists")
      .selectAll()
      .where("user_id", "=", userId)
      .where("kind", "=", "kakao")
      .where("removed_from_kakao_at", "is", null)
      .execute();
    removed = lists
      .filter((l) => !keep.has(l.id))
      .map((l) => ({ ...l, removed_from_kakao_at: now, updated_at: now }) as Row);
  }
  const summary = add(state.summary, { listsRemoved: removed.length });
  await db.atomic([
    ...writeStatements(db, userId, new Map([["lists", new Map(removed.map((r) => [r.id, r]))]]), {
      newerOnly: new Set(),
    }),
    db.kysely.deleteFrom("import_seen").where("user_id", "=", userId).where("run_id", "=", runId),
    db.kysely
      .updateTable("import_runs")
      .set({
        status: "completed",
        finished_at: now,
        summary_json: JSON.stringify({ ...state, summary }),
      })
      .where("user_id", "=", userId)
      .where("id", "=", runId),
  ]);
  return summary;
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
