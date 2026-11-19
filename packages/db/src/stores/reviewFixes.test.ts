// Regression tests for the findings of the plan 01 final review.
import type { Mutation, VisitNoteRow } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { completeImportRun, finishImportList, importListChunk, startImportRun } from "./importRuns";
import { applyPush } from "./sync";

const T0 = 1_763_000_000_000;
const U = "user-1";
let n = 0;

async function withUser(db: Db) {
  await db.kysely
    .insertInto("users")
    .values({ id: U, display_name: null, change_seq: 0, created_at: T0 })
    .execute();
}
const placeRow = (key: string, extra: Record<string, unknown> = {}) => ({
  id: `kp_${key}`,
  kakaoPlaceId: key,
  title: "카페",
  address: "제주",
  roadAddress: null,
  addressSource: "search",
  category: null,
  phone: null,
  lat: 33.46,
  lng: 126.31,
  source: "search",
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...extra,
});
const noteRow = (id: string, placeId: string, extra: Partial<VisitNoteRow> = {}): VisitNoteRow => ({
  id,
  placeId,
  visitedOn: null,
  body: "메모",
  origin: "user",
  originKey: null,
  editedByUser: false,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  ...extra,
});
const up = (table: Mutation["table"], row: { id: string }, at: number): Mutation => ({
  mutationId: `r${++n}`,
  table,
  op: "upsert",
  id: row.id,
  row,
  clientUpdatedAt: at,
});
const del = (table: Mutation["table"], id: string, at: number): Mutation => ({
  mutationId: `r${++n}`,
  table,
  op: "delete",
  id,
  clientUpdatedAt: at,
});
const get = (db: Db, table: "places" | "visit_notes" | "list_items", id: string) =>
  db.kysely
    .selectFrom(table)
    .selectAll()
    .where("user_id", "=", U)
    .where("id", "=", id)
    .executeTakeFirst();

/** A Db whose next atomic() first runs `before` — to interleave another write after a pre-read. */
function interleaved(db: Db, before: () => Promise<unknown>): Db {
  let done = false;
  return {
    ...db,
    atomic: async (qs) => {
      if (!done) {
        done = true;
        await before();
      }
      return db.atomic(qs);
    },
  };
}

forEachDialect("review fixes", (makeDb) => {
  it("C1: an import does not overwrite a concurrent edit of an imported note", async () => {
    const db = await makeDb();
    await withUser(db);
    const meta = { kakaoFolderId: 1, name: "리스트", subscribed: false };
    const item = (note: string) => [
      {
        favoriteSeq: "10",
        placeKey: "A",
        title: "t",
        lat: 33.46,
        lng: 126.31,
        position: 0,
        localNote: note,
      },
    ];
    let run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0);
    await importListChunk(db, U, run.runId, meta, item("v1"), T0);
    run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 1);
    const racing = interleaved(db, () =>
      applyPush(
        db,
        U,
        [
          up(
            "visit_notes",
            noteRow("kn_kp_A_1", "kp_A", {
              origin: "kakao_list",
              originKey: "1",
              body: "MY DIARY EDIT",
            }),
            T0 + 2,
          ),
        ],
        T0 + 2,
      ),
    );
    await importListChunk(racing, U, run.runId, meta, item("v2"), T0 + 3);
    const note = await get(db, "visit_notes", "kn_kp_A_1");
    expect(note?.body).toBe("MY DIARY EDIT");
    expect(note?.edited_by_user).toBe(1);
  });

  it("C1b: an import does not resurrect a concurrently deleted imported note", async () => {
    const db = await makeDb();
    await withUser(db);
    const meta = { kakaoFolderId: 1, name: "리스트", subscribed: false };
    const item = (note: string) => [
      { favoriteSeq: "10", placeKey: "A", title: "t", position: 0, localNote: note },
    ];
    let run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0);
    await importListChunk(db, U, run.runId, meta, item("v1"), T0);
    run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 1);
    const racing = interleaved(db, () =>
      applyPush(db, U, [del("visit_notes", "kn_kp_A_1", T0 + 2)], T0 + 2),
    );
    await importListChunk(racing, U, run.runId, meta, item("v2"), T0 + 3);
    expect((await get(db, "visit_notes", "kn_kp_A_1"))?.deleted_at).not.toBeNull();
  });

  it("C2: a bad value in one mutation rejects only that mutation", async () => {
    const db = await makeDb();
    await withUser(db);
    const res = await applyPush(
      db,
      U,
      [
        up("places", placeRow("1"), T0 + 1),
        up("visit_notes", noteRow("bad", "kp_1", { body: "a\u0000b" }), T0 + 1),
        up("visit_notes", noteRow("good", "kp_1"), T0 + 1),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(["applied", "invalid", "applied"]);
  });

  it("I3: a delete that arrives before its create keeps the row deleted", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    const gone = await applyPush(db, U, [del("visit_notes", "n1", T0 + 5)], T0);
    expect(gone.results[0]?.status).toBe("applied");
    const late = await applyPush(db, U, [up("visit_notes", noteRow("n1", "kp_1"), T0 + 3)], T0);
    expect(late.results[0]?.status).toBe("ignored_stale");
    expect(await get(db, "visit_notes", "n1")).toBeUndefined();
  });

  it("I3b: a create newer than an earlier delete of the same id is applied", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    await applyPush(db, U, [del("visit_notes", "n1", T0 + 2)], T0);
    const res = await applyPush(db, U, [up("visit_notes", noteRow("n1", "kp_1"), T0 + 9)], T0);
    expect(res.results[0]?.status).toBe("applied");
    expect((await get(db, "visit_notes", "n1"))?.deleted_at).toBeNull();
  });

  it("I3c: create, edit and delete of one note in one push leaves it deleted", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    await applyPush(
      db,
      U,
      [
        up("visit_notes", noteRow("n1", "kp_1"), T0 + 2),
        up("visit_notes", noteRow("n1", "kp_1", { body: "edited" }), T0 + 3),
        del("visit_notes", "n1", T0 + 4),
      ],
      T0,
    );
    const late = await applyPush(db, U, [up("visit_notes", noteRow("n1", "kp_1"), T0 + 2)], T0);
    expect(late.results[0]?.status).toBe("ignored_stale");
    expect(await get(db, "visit_notes", "n1")).toBeUndefined();
  });

  it("I4: an incomplete run marks no membership removed", async () => {
    const db = await makeDb();
    await withUser(db);
    const meta = { kakaoFolderId: 1, name: "리스트", subscribed: false };
    const items = [
      { favoriteSeq: "10", placeKey: "A", title: "a", position: 0 },
      { favoriteSeq: "11", placeKey: "B", title: "b", position: 1 },
    ];
    let run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0);
    await importListChunk(db, U, run.runId, meta, items, T0);
    await finishImportList(db, U, run.runId, 1, T0);
    await completeImportRun(db, U, run.runId, [1], T0);
    run = await startImportRun(db, U, { complete: false, importedAt: "x" }, T0 + 1);
    await importListChunk(db, U, run.runId, meta, items.slice(0, 1), T0 + 1);
    const summary = await finishImportList(db, U, run.runId, 1, T0 + 1);
    expect(summary.membershipsRemoved).toBe(0);
    expect((await get(db, "list_items", "ki_1_11"))?.removed_from_kakao_at).toBeNull();
  });

  it("I5a: a stale search upsert does not undo a newer place delete", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    const racing = interleaved(db, () => applyPush(db, U, [del("places", "kp_1", T0 + 9)], T0));
    await applyPush(racing, U, [up("places", placeRow("1"), T0 + 5)], T0);
    expect((await get(db, "places", "kp_1"))?.deleted_at).not.toBeNull();
  });

  it("I5b: an import refresh does not undo a concurrent place delete", async () => {
    const db = await makeDb();
    await withUser(db);
    const meta = { kakaoFolderId: 1, name: "리스트", subscribed: false };
    let run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0);
    await importListChunk(
      db,
      U,
      run.runId,
      meta,
      [{ favoriteSeq: "10", placeKey: "A", title: "a", position: 0 }],
      T0,
    );
    run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 1);
    const racing = interleaved(db, () => applyPush(db, U, [del("places", "kp_A", T0 + 2)], T0 + 2));
    await importListChunk(
      racing,
      U,
      run.runId,
      meta,
      [{ favoriteSeq: "10", placeKey: "A", title: "new title", position: 0 }],
      T0 + 3,
    );
    const place = await get(db, "places", "kp_A");
    expect(place?.deleted_at).not.toBeNull();
    expect(place?.title).toBe("new title");
  });

  it("I5c: restoring a place for a note does not revert a concurrent move", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    await applyPush(db, U, [del("places", "kp_1", T0 + 2)], T0);
    const moveTo = 33.46 + 500 / 111_320;
    const racing = interleaved(db, () =>
      db.kysely.updateTable("places").set({ lat: moveTo }).where("id", "=", "kp_1").execute(),
    );
    await applyPush(racing, U, [up("visit_notes", noteRow("n1", "kp_1"), T0 + 3)], T0);
    const place = await get(db, "places", "kp_1");
    expect(place?.deleted_at).toBeNull();
    expect(place?.lat).toBeCloseTo(moveTo, 6);
  });

  it("I6: a far-future clientUpdatedAt does not lock a row against later edits", async () => {
    const db = await makeDb();
    await withUser(db);
    const TEN_YEARS = 10 * 365 * 86_400_000;
    await applyPush(
      db,
      U,
      [
        up("places", placeRow("1"), T0 + 1),
        up("visit_notes", noteRow("n1", "kp_1", { body: "future" }), T0 + TEN_YEARS),
      ],
      T0,
    );
    const res = await applyPush(
      db,
      U,
      [up("visit_notes", noteRow("n1", "kp_1", { body: "now" }), T0 + 120_000)],
      T0 + 120_000,
    );
    expect(res.results[0]?.status).toBe("applied");
    expect((await get(db, "visit_notes", "n1"))?.body).toBe("now");
  });

  it("superseded mutations report the final mutation's status", async () => {
    const db = await makeDb();
    await withUser(db);
    const res = await applyPush(
      db,
      U,
      [
        up("visit_notes", noteRow("n1", "kp_missing"), T0 + 1),
        up("visit_notes", noteRow("n1", "kp_missing", { body: "edit" }), T0 + 2),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason)).toEqual(["missing_parent", "missing_parent"]);
  });
});
