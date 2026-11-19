// Regression tests for the Codex re-review of the plan 01b fix pass.
import type { ImportItem, ImportList } from "@magomap/domain";
import { importedNoteRowId } from "@magomap/domain/ids";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import {
  completeImportRun,
  finishImportList,
  ImportIncompleteError,
  importListChunk,
  RunNotFoundError,
  runSnapshot,
  startImportRun,
} from "./importRuns";
import { pull } from "./sync";
import { addUser, importSnapshot, push, searchedPlace, T0, up } from "./testkit";

const WIFE = "wife";
const ME = "me";
const item = (ext: string, place: string, extra: Partial<ImportItem> = {}): ImportItem => ({
  externalId: ext,
  placeExternalId: place,
  title: place,
  lat: 33.46,
  lng: 126.31,
  position: Number(ext) % 1000,
  ...extra,
});
const list = (ext: string, items: ImportItem[], extra: Partial<ImportList> = {}): ImportList => ({
  externalId: ext,
  name: `리스트 ${ext}`,
  followed: false,
  items,
  ...extra,
});

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, WIFE);
  await addUser(db, ME);
  return db;
}

const start = (db: Db, user: string, lists: { externalId: string; itemCount: number }[], at = 50) =>
  startImportRun(
    db,
    user,
    {
      provider: "kakao",
      complete: true,
      subscriptionKnown: true,
      importedAt: new Date(T0 + at).toISOString(),
      lists: lists.map((l) => ({ ...l, name: l.externalId, followed: false })),
    },
    T0 + at,
  );

const listRow = (db: Db, id: string) =>
  db.kysely.selectFrom("lists").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const itemRow = (db: Db, id: string) =>
  db.kysely.selectFrom("list_items").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

forEachDialect("import integrity", (makeDb) => {
  it("refuses to finish a list that isn't part of the run", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "A"), item("11", "B")])]);
    const { runId } = await start(db, ME, [{ externalId: "2", itemCount: 0 }]);
    await expect(finishImportList(db, ME, runId, "1", T0 + 50)).rejects.toBeInstanceOf(
      RunNotFoundError,
    );
    expect((await itemRow(db, "i_kakao_1_11")).removed_at_provider).toBeNull();
  });

  it("refuses to finish a list before all its pages arrived", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "A"), item("11", "B")])]);
    const { runId } = await start(db, WIFE, [{ externalId: "1", itemCount: 600 }]);
    await importListChunk(db, WIFE, runId, "1", 0, [item("10", "A")], T0 + 50);
    await expect(finishImportList(db, WIFE, runId, "1", T0 + 50)).rejects.toBeInstanceOf(
      ImportIncompleteError,
    );
    expect((await itemRow(db, "i_kakao_1_11")).removed_at_provider).toBeNull();
  });

  it("refuses a page that skips ahead", async () => {
    const db = await setup(makeDb);
    const { runId } = await start(db, WIFE, [{ externalId: "1", itemCount: 600 }]);
    await expect(
      importListChunk(db, WIFE, runId, "1", 1, [item("10", "A")], T0 + 50),
    ).rejects.toBeInstanceOf(ImportIncompleteError);
  });

  it("refuses a page for a list that isn't part of the run", async () => {
    const db = await setup(makeDb);
    const { runId } = await start(db, WIFE, [{ externalId: "1", itemCount: 1 }]);
    await expect(
      importListChunk(db, WIFE, runId, "2", 0, [item("10", "A")], T0 + 50),
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("counts a list's removals once when finish is retried", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "A"), item("11", "B")])]);
    const { runId } = await start(db, WIFE, [{ externalId: "1", itemCount: 1 }]);
    await importListChunk(db, WIFE, runId, "1", 0, [item("10", "A")], T0 + 50);
    expect((await finishImportList(db, WIFE, runId, "1", T0 + 50)).membershipsRemoved).toBe(1);
    expect((await finishImportList(db, WIFE, runId, "1", T0 + 50)).membershipsRemoved).toBe(0);
    expect((await completeImportRun(db, WIFE, runId, T0 + 50)).membershipsRemoved).toBe(1);
  });

  it("refuses to complete a run before every list finished", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "A")]), list("2", [item("20", "B")])]);
    const { runId } = await start(db, WIFE, [
      { externalId: "1", itemCount: 1 },
      { externalId: "2", itemCount: 1 },
    ]);
    await importListChunk(db, WIFE, runId, "1", 0, [item("10", "A")], T0 + 50);
    await finishImportList(db, WIFE, runId, "1", T0 + 50);
    await expect(completeImportRun(db, WIFE, runId, T0 + 50)).rejects.toBeInstanceOf(
      ImportIncompleteError,
    );
    expect((await listRow(db, "l_kakao_2")).removed_at_provider).toBeNull();
  });

  it("removes the previous lists when a complete snapshot has no lists", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "A")])]);
    const { summary } = await importSnapshot(db, WIFE, [], { at: T0 + 10 });
    expect(summary.listsRemoved).toBe(1);
    expect((await listRow(db, "l_kakao_1")).removed_at_provider).not.toBeNull();
  });

  it("keeps many long list summaries without one oversized value", async () => {
    const db = await setup(makeDb);
    const lists = Array.from({ length: 300 }, (_, i) => ({
      externalId: String(i),
      itemCount: 0,
      name: `리스트 ${i}`,
      description: "가".repeat(5000),
      followed: false,
    }));
    const { runId } = await startImportRun(
      db,
      WIFE,
      {
        provider: "kakao",
        complete: true,
        subscriptionKnown: true,
        importedAt: new Date(T0).toISOString(),
        lists,
      },
      T0,
    );
    const run = await db.kysely.selectFrom("import_runs").selectAll().executeTakeFirstOrThrow();
    expect(new TextEncoder().encode(run.summary_json ?? "").length).toBeLessThan(100_000);
    const snapshot = await runSnapshot(db, WIFE, runId);
    expect(snapshot.lists).toHaveLength(300);
    expect(snapshot.lists[299]).toMatchObject({
      externalId: "299",
      description: "가".repeat(5000),
    });
  });

  it("imports a user's own note even when the shared list has a newer snapshot", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "A")])], {
      snapshot: T0 + 20,
      at: T0 + 20,
    });
    await importSnapshot(
      db,
      ME,
      [list("1", [item("10", "A", { localNote: "내 메모" })], { followed: true })],
      { snapshot: T0 + 15, at: T0 + 20 },
    );
    const notes = await db.kysely
      .selectFrom("visit_notes")
      .selectAll()
      .where("user_id", "=", ME)
      .execute();
    expect(notes.map((n) => [n.id, n.body])).toEqual([
      [importedNoteRowId("p_kakao_A", "l_kakao_1"), "내 메모"],
    ]);
    expect(await db.kysely.selectFrom("list_items").selectAll().execute()).toHaveLength(1);
  });

  it("keeps a list removed when a newer owner snapshot confirms the removal again", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "A")]), list("2", [item("20", "B")])]);
    await importSnapshot(db, WIFE, [list("2", [item("20", "B")])], { at: T0 + 30 });
    const { summary } = await importSnapshot(db, WIFE, [list("2", [item("20", "B")])], {
      at: T0 + 50,
    });
    expect(summary.listsRemoved).toBe(0);
    await importSnapshot(db, ME, [list("1", [item("10", "A")], { followed: true })], {
      snapshot: T0 + 40,
      at: T0 + 50,
    });
    expect((await listRow(db, "l_kakao_1")).removed_at_provider).toBe(T0 + 30);
  });

  it("orders search refreshes by when the result was signed, not by the client clock", async () => {
    const db = await setup(makeDb);
    const north = 33.46 + 500 / 111_320;
    const signed = (lat: number, signedAt: number) => searchedPlace("A", { lat, signedAt });
    await push(db, WIFE, [up("places", signed(33.46, T0))], T0);
    await push(db, WIFE, [up("places", signed(north, T0 + 50), T0 + 50)], T0 + 50);
    await push(db, ME, [up("places", signed(33.46, T0 + 40), T0 + 60)], T0 + 60);
    const place = await db.kysely.selectFrom("places").selectAll().executeTakeFirstOrThrow();
    expect(place.lat).toBeCloseTo(north, 6);
    expect(await db.kysely.selectFrom("place_locations").selectAll().execute()).toHaveLength(1);
    // ME still saved the place, even though their result was older.
    expect(
      await db.kysely.selectFrom("user_places").selectAll().where("user_id", "=", ME).execute(),
    ).toHaveLength(1);
  });

  it("gives followers the place an existing list item switches to", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, WIFE, [list("1", [item("10", "X")]), list("2", [item("20", "Y")])]);
    await importSnapshot(db, ME, [list("1", [item("10", "X")], { followed: true })]);
    const cursor = (await pull(db, ME, null)).cursor;
    await importSnapshot(db, WIFE, [list("1", [item("10", "Y")]), list("2", [item("20", "Y")])], {
      at: T0 + 50,
    });
    const got = (await pull(db, ME, cursor)).rows.map((r) => `${r.table}:${r.row.id}`);
    expect(got).toContain("list_items:i_kakao_1_10");
    expect(got).toContain("places:p_kakao_Y");
    expect(got).toContain("place_sources:s_kakao_Y");
  });

  it("records a newer search observation even when nothing changed", async () => {
    const db = await setup(makeDb);
    const north = 33.46 + 500 / 111_320;
    await push(db, WIFE, [up("places", searchedPlace("A", { signedAt: T0 }))], T0);
    await push(
      db,
      WIFE,
      [up("places", searchedPlace("A", { signedAt: T0 + 50 }), T0 + 50)],
      T0 + 50,
    );
    await push(
      db,
      ME,
      [up("places", searchedPlace("A", { lat: north, signedAt: T0 + 40 }), T0 + 60)],
      T0 + 60,
    );
    const place = await db.kysely.selectFrom("places").selectAll().executeTakeFirstOrThrow();
    expect(place.lat).toBeCloseTo(33.46, 6);
    expect(place.provider_snapshot_at).toBe(T0 + 50);
    expect(await db.kysely.selectFrom("place_locations").selectAll().execute()).toHaveLength(0);
  });

  it("never lets an older snapshot change an imported note", async () => {
    const db = await setup(makeDb);
    const withNote = (body: string) => [list("1", [item("10", "A", { localNote: body })])];
    await importSnapshot(db, WIFE, withNote("new note"), { at: T0 + 20 });
    await importSnapshot(db, ME, [list("1", [item("10", "A")], { followed: true })], {
      at: T0 + 30,
    });
    await importSnapshot(db, WIFE, withNote("old note"), { snapshot: T0 + 10, at: T0 + 30 });
    const notes = await db.kysely
      .selectFrom("visit_notes")
      .selectAll()
      .where("user_id", "=", WIFE)
      .execute();
    expect(notes.map((n) => n.body)).toEqual(["new note"]);
  });

  it("refuses list summaries that name the same list twice", async () => {
    const db = await setup(makeDb);
    await expect(
      start(db, WIFE, [
        { externalId: "1", itemCount: 1 },
        { externalId: "1", itemCount: 2 },
      ]),
    ).rejects.toThrow(/Duplicate list/);
    expect(await db.kysely.selectFrom("import_runs").selectAll().execute()).toHaveLength(0);
  });
});
