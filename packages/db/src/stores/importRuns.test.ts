import type { ImportItem, ImportList } from "@magomap/domain";
import { importedNoteRowId } from "@magomap/domain/ids";
import { sql } from "kysely";
import { expect, it } from "vitest";
import type { Db, Statement } from "../core";
import { migrate } from "../migrate";
import { forEachDialect, migrationsDir } from "../testing/dbs";
import {
  completeImportRun,
  finishImportList,
  ImportIncompleteError,
  importedSnapshot,
  importListChunk,
  latestImportRun,
  RunClosedError,
  RunNotFoundError,
  runProgress,
  startImportRun,
} from "./importRuns";
import { pull } from "./sync";
import {
  addUser,
  del,
  importSnapshot,
  interleaved,
  note,
  push,
  searchedPlace,
  T0,
  up,
} from "./testkit";

const WIFE = "wife";
const ME = "me";
const NORTH = (m: number) => 33.46 + m / 111_320;
const SNAP = (ms: number) => new Date(T0 + ms).toISOString();

function item(
  ext: string,
  placeExt: string | undefined,
  extra: Partial<ImportItem> = {},
): ImportItem {
  return {
    externalId: ext,
    placeExternalId: placeExt,
    title: `장소 ${ext}`,
    address: "제주 애월읍",
    lat: 33.46,
    lng: 126.31,
    providerColor: "01",
    position: Number(ext) % 1000,
    ...extra,
  };
}
function list(ext: string, items: ImportItem[], extra: Partial<ImportList> = {}): ImportList {
  return { externalId: ext, name: `리스트 ${ext}`, followed: false, items, ...extra };
}

interface Opts {
  complete?: boolean;
  at?: number;
  snapshotMs?: number;
  subscriptionKnown?: boolean;
  chunk?: number;
}

/** A whole import as the server runs it. */
/** Starts a run over the given lists (id → item count), without importing anything yet. */
const startRun = (db: Db, user: string, ms: number, lists: Record<string, number> = { "1": 1 }) =>
  startImportRun(
    db,
    user,
    {
      provider: "kakao",
      complete: true,
      subscriptionKnown: true,
      importedAt: SNAP(ms),
      lists: Object.entries(lists).map(([externalId, itemCount]) => ({
        externalId,
        name: `리스트 ${externalId}`,
        followed: false,
        itemCount,
      })),
    },
    T0 + ms,
  );

const runImport = (db: Db, user: string, lists: ImportList[], o: Opts = {}) =>
  importSnapshot(db, user, lists, {
    at: o.at,
    snapshot: o.snapshotMs === undefined ? undefined : T0 + o.snapshotMs,
    complete: o.complete,
    subscriptionKnown: o.subscriptionKnown,
    chunk: o.chunk,
  });

const all = (db: Db, t: "places" | "list_items" | "lists" | "place_sources" | "place_locations") =>
  db.kysely.selectFrom(t).selectAll().execute();
const mine = (db: Db, t: "visit_notes" | "user_lists" | "user_places", u: string) =>
  db.kysely.selectFrom(t).selectAll().where("user_id", "=", u).execute();

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, WIFE);
  await addUser(db, ME);
  return db;
}

forEachDialect("import (shared)", (makeDb) => {
  it("imports two lists sharing a place as one place", async () => {
    const db = await setup(makeDb);
    const { summary } = await runImport(db, WIFE, [
      list("1", [item("10", "A"), item("11", "B")]),
      list("2", [item("20", "A"), item("21", "C")]),
    ]);
    expect(await all(db, "places")).toHaveLength(3);
    expect(await all(db, "place_sources")).toHaveLength(3);
    expect(await all(db, "list_items")).toHaveLength(4);
    expect(await all(db, "lists")).toHaveLength(2);
    expect(summary).toMatchObject({ listsAdded: 2, placesAdded: 3 });
    expect((await mine(db, "user_lists", WIFE)).map((u) => u.role)).toEqual(["owner", "owner"]);
    expect(await mine(db, "user_places", WIFE)).toHaveLength(3);
  });

  it("shares one list, its items and places between the owner and a follower", async () => {
    const db = await setup(makeDb);
    await runImport(db, ME, [
      list("1", [item("10", "A", { localNote: "남편 메모" })], {
        followed: true,
        ownerName: "지은",
      }),
    ]);
    await runImport(db, WIFE, [list("1", [item("10", "A", { localNote: "아내 메모" })])], {
      at: T0 + 10,
    });
    expect(await all(db, "lists")).toHaveLength(1);
    expect(await all(db, "list_items")).toHaveLength(1);
    expect(await all(db, "places")).toHaveLength(1);
    expect((await mine(db, "user_lists", ME))[0]?.role).toBe("follower");
    expect((await mine(db, "user_lists", WIFE))[0]?.role).toBe("owner");
    expect((await mine(db, "visit_notes", ME)).map((n) => n.body)).toEqual(["남편 메모"]);
    expect((await mine(db, "visit_notes", WIFE)).map((n) => n.body)).toEqual(["아내 메모"]);
  });

  it("treats nobody as owner without subscription information", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A")])], { subscriptionKnown: false });
    expect((await mine(db, "user_lists", WIFE))[0]?.role).toBe("follower");
  });

  it("marks nothing removed until a list is finished", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A"), item("11", "B")])]);
    const { runId } = await startRun(db, WIFE, 1);
    await importListChunk(db, WIFE, runId, "1", 0, [item("10", "A")], T0 + 1);
    const before = await db.kysely
      .selectFrom("list_items")
      .select("removed_at_provider")
      .where("id", "=", "i_kakao_1_11")
      .executeTakeFirstOrThrow();
    expect(before.removed_at_provider).toBeNull();
    await finishImportList(db, WIFE, runId, "1", T0 + 1);
    const after = await db.kysely
      .selectFrom("list_items")
      .select("removed_at_provider")
      .where("id", "=", "i_kakao_1_11")
      .executeTakeFirstOrThrow();
    expect(after.removed_at_provider).toBe(T0 + 1);
  });

  it("marks a removed favourite for everyone, keeps the place and notes, and restores it", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A"), item("11", "B")])]);
    await push(db, WIFE, [up("visit_notes", note("n1", "p_kakao_B"))], T0);
    const gone = await runImport(db, WIFE, [list("1", [item("10", "A")])], { at: T0 + 10 });
    expect(gone.summary.membershipsRemoved).toBe(1);
    expect(await all(db, "places")).toHaveLength(2);
    expect(await mine(db, "visit_notes", WIFE)).toHaveLength(1);
    const back = await runImport(db, WIFE, [list("1", [item("10", "A"), item("11", "B")])], {
      at: T0 + 20,
    });
    expect(back.summary.membershipsRestored).toBe(1);
  });

  it("marks nothing removed for an incomplete import", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [
      list("1", [item("10", "A"), item("11", "B")]),
      list("2", [item("20", "C")]),
    ]);
    await runImport(db, WIFE, [list("1", [item("10", "A")])], { complete: false, at: T0 + 5 });
    expect((await all(db, "list_items")).every((i) => i.removed_at_provider === null)).toBe(true);
    expect((await all(db, "lists")).every((l) => l.removed_at_provider === null)).toBe(true);
    expect((await mine(db, "user_lists", WIFE)).every((u) => u.removed_at === null)).toBe(true);
  });

  it("marks nothing removed when a complete run's lists weren't finished", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A")])]);
    const { runId } = await startRun(db, WIFE, 5, { "2": 1 });
    await expect(completeImportRun(db, WIFE, runId, T0 + 5)).rejects.toBeInstanceOf(
      ImportIncompleteError,
    );
    expect((await all(db, "lists"))[0]?.removed_at_provider).toBeNull();
    expect((await mine(db, "user_lists", WIFE))[0]?.removed_at).toBeNull();
  });

  it("removes a list for everyone only from the owner's import", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A")]), list("2", [item("20", "B")])]);
    await runImport(
      db,
      ME,
      [
        list("1", [item("10", "A")], { followed: true }),
        list("2", [item("20", "B")], { followed: true }),
      ],
      { at: T0 + 1 },
    );
    // I unfollow list 2: personal only
    await runImport(db, ME, [list("1", [item("10", "A")], { followed: true })], { at: T0 + 2 });
    expect(
      (await all(db, "lists")).find((l) => l.id === "l_kakao_2")?.removed_at_provider,
    ).toBeNull();
    expect(
      (await mine(db, "user_lists", ME)).find((u) => u.list_id === "l_kakao_2")?.removed_at,
    ).toBe(T0 + 2);
    expect(
      (await mine(db, "user_lists", WIFE)).find((u) => u.list_id === "l_kakao_2")?.removed_at,
    ).toBeNull();
    // She deletes list 2 in Kakao: removed for everyone
    const { summary } = await runImport(db, WIFE, [list("1", [item("10", "A")])], { at: T0 + 3 });
    expect(summary.listsRemoved).toBe(1);
    expect((await all(db, "lists")).find((l) => l.id === "l_kakao_2")?.removed_at_provider).toBe(
      T0 + 3,
    );
  });

  it("ignores an older snapshot for shared data", async () => {
    const db = await setup(makeDb);
    await runImport(
      db,
      WIFE,
      [
        list("1", [item("10", "A", { lat: NORTH(500), providerNote: "new note" })], {
          name: "새 이름",
        }),
      ],
      { snapshotMs: 1000 },
    );
    await runImport(
      db,
      ME,
      [
        list("1", [item("10", "A", { providerNote: "old note" }), item("11", "B")], {
          followed: true,
          name: "옛 이름",
        }),
      ],
      { at: T0 + 2000, snapshotMs: 10 },
    );
    expect((await all(db, "lists"))[0]?.name).toBe("새 이름");
    const items = await all(db, "list_items");
    expect(items.find((i) => i.id === "i_kakao_1_10")?.provider_note).toBe("new note");
    expect((await all(db, "places")).find((p) => p.id === "p_kakao_A")?.lat).toBeCloseTo(
      NORTH(500),
      6,
    );
    expect(await all(db, "place_locations")).toHaveLength(0);
    expect((await mine(db, "user_lists", ME))[0]?.role).toBe("follower");
  });

  it("keeps a place and membership an older snapshot would change after a newer one confirmed them", async () => {
    const db = await setup(makeDb);
    const current = [list("1", [item("10", "A", { lat: NORTH(500), providerNote: "new" })])];
    await runImport(db, WIFE, current, { snapshotMs: 100 });
    await runImport(db, WIFE, current, { at: T0 + 3000, snapshotMs: 3000 });
    await runImport(
      db,
      ME,
      [list("1", [item("10", "A", { lat: NORTH(0), providerNote: "old" })], { followed: true })],
      { at: T0 + 4000, snapshotMs: 2000 },
    );
    expect((await all(db, "places")).find((p) => p.id === "p_kakao_A")?.lat).toBeCloseTo(
      NORTH(500),
      6,
    );
    const items = await all(db, "list_items");
    expect(items.find((i) => i.id === "i_kakao_1_10")?.provider_note).toBe("new");
    expect(await all(db, "place_locations")).toHaveLength(0);
  });

  it("keeps a place an older snapshot of another list would move after a newer one confirmed it", async () => {
    const db = await setup(makeDb);
    const current = [list("1", [item("10", "A", { lat: NORTH(500) })])];
    await runImport(db, WIFE, current, { snapshotMs: 100 });
    await runImport(db, WIFE, current, { at: T0 + 3000, snapshotMs: 3000 });
    await runImport(db, ME, [list("2", [item("20", "A", { lat: NORTH(0) })])], {
      at: T0 + 4000,
      snapshotMs: 2000,
    });
    expect((await all(db, "places")).find((p) => p.id === "p_kakao_A")?.lat).toBeCloseTo(
      NORTH(500),
      6,
    );
    expect(await all(db, "place_locations")).toHaveLength(0);
    expect((await all(db, "list_items")).map((i) => i.id).sort()).toEqual([
      "i_kakao_1_10",
      "i_kakao_2_20",
    ]);
  });

  it("keeps a place a newer list confirmed after that list dropped it", async () => {
    const db = await setup(makeDb);
    const current = [list("1", [item("10", "A", { lat: NORTH(500) })])];
    await runImport(db, WIFE, current, { snapshotMs: 100 });
    await runImport(db, WIFE, current, { at: T0 + 3000, snapshotMs: 3000 });
    await runImport(db, WIFE, [list("1", [])], { at: T0 + 4000, snapshotMs: 4000 });
    await runImport(db, ME, [list("2", [item("20", "A", { lat: NORTH(0) })])], {
      at: T0 + 5000,
      snapshotMs: 2000,
    });
    expect((await all(db, "places")).find((p) => p.id === "p_kakao_A")?.lat).toBeCloseTo(
      NORTH(500),
      6,
    );
    expect(await all(db, "place_locations")).toHaveLength(0);
  });

  it("keeps a place from a search older than a list that confirmed it and then dropped it", async () => {
    const db = await setup(makeDb);
    const current = [list("1", [item("10", "A", { lat: NORTH(500) })])];
    await runImport(db, WIFE, current, { snapshotMs: 100 });
    await runImport(db, WIFE, current, { at: T0 + 3000, snapshotMs: 3000 });
    await runImport(db, WIFE, [list("1", [])], { at: T0 + 4000, snapshotMs: 4000 });
    await push(
      db,
      ME,
      [up("places", searchedPlace("A", { lat: NORTH(0), signedAt: T0 + 2000 }), T0 + 5000)],
      T0 + 5000,
    );
    expect((await all(db, "places")).find((p) => p.id === "p_kakao_A")?.lat).toBeCloseTo(
      NORTH(500),
      6,
    );
    expect(await all(db, "place_locations")).toHaveLength(0);
  });

  it("keeps a place from a search older than the import that last confirmed it", async () => {
    const db = await setup(makeDb);
    const current = [list("1", [item("10", "A", { lat: NORTH(500) })])];
    await runImport(db, WIFE, current, { snapshotMs: 100 });
    await runImport(db, WIFE, current, { at: T0 + 3000, snapshotMs: 3000 });
    await push(
      db,
      ME,
      [up("places", searchedPlace("A", { lat: NORTH(0), signedAt: T0 + 2000 }), T0 + 4000)],
      T0 + 4000,
    );
    expect((await all(db, "places")).find((p) => p.id === "p_kakao_A")?.lat).toBeCloseTo(
      NORTH(500),
      6,
    );
    expect(await all(db, "place_locations")).toHaveLength(0);
  });

  it("turns local notes into private diary entries that respect edits and deletes", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A", { localNote: "주차 어려움" })])]);
    await runImport(
      db,
      WIFE,
      [list("1", [item("10", "A", { localNote: "주차 어려움, 공영주차장" })])],
      { at: T0 + 1 },
    );
    const [n] = await mine(db, "visit_notes", WIFE);
    expect(n).toMatchObject({
      id: importedNoteRowId("p_kakao_A", "l_kakao_1"),
      body: "주차 어려움, 공영주차장",
      origin: "import",
      visited_on: null,
    });
    await push(
      db,
      WIFE,
      [
        up(
          "visit_notes",
          note(n?.id as string, "p_kakao_A", {
            origin: "import",
            originKey: "l_kakao_1",
            visitedOn: null,
            body: "내가 고침",
          }),
          T0 + 2,
        ),
      ],
      T0 + 2,
    );
    await runImport(db, WIFE, [list("1", [item("10", "A", { localNote: "again" })])], {
      at: T0 + 3,
    });
    expect((await mine(db, "visit_notes", WIFE))[0]?.body).toBe("내가 고침");
    await push(db, WIFE, [del("visit_notes", n?.id as string, T0 + 4)], T0 + 4);
    await runImport(db, WIFE, [list("1", [item("10", "A", { localNote: "again" })])], {
      at: T0 + 5,
    });
    expect((await mine(db, "visit_notes", WIFE))[0]?.deleted_at).not.toBeNull();
  });

  it("does not overwrite an imported note the user edits during the import", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A", { localNote: "v1" })])]);
    const { runId } = await startRun(db, WIFE, 1);
    const racing = interleaved(db, () =>
      push(
        db,
        WIFE,
        [
          up(
            "visit_notes",
            note(importedNoteRowId("p_kakao_A", "l_kakao_1"), "p_kakao_A", {
              origin: "import",
              originKey: "l_kakao_1",
              visitedOn: null,
              body: "MY EDIT",
            }),
            T0 + 2,
          ),
        ],
        T0 + 2,
      ),
    );
    await importListChunk(
      racing,
      WIFE,
      runId,
      "1",
      0,
      [item("10", "A", { localNote: "v2" })],
      T0 + 3,
    );
    expect((await mine(db, "visit_notes", WIFE))[0]).toMatchObject({
      body: "MY EDIT",
      edited_by_user: 1,
    });
  });

  it("matches a place saved from search, keeps its notes and records no move", async () => {
    const db = await setup(makeDb);
    await push(
      db,
      WIFE,
      [up("places", searchedPlace("123")), up("visit_notes", note("n1", "p_kakao_123"))],
      T0,
    );
    await runImport(db, WIFE, [list("1", [item("10", "123", { address: "애월읍" })])], {
      at: T0 + 5,
    });
    expect(await all(db, "places")).toHaveLength(1);
    expect(await mine(db, "visit_notes", WIFE)).toHaveLength(1);
    expect(await all(db, "place_locations")).toHaveLength(0);
  });

  it("records moves, ignores small changes, and chains history", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A")])]);
    await runImport(db, WIFE, [list("1", [item("10", "A", { lat: NORTH(5) })])], { at: T0 + 10 });
    expect(await all(db, "place_locations")).toHaveLength(0);
    expect(
      (
        await runImport(db, WIFE, [list("1", [item("10", "A", { lat: NORTH(200) })])], {
          at: T0 + 20,
        })
      ).summary.placesMoved,
    ).toBe(1);
    await runImport(db, WIFE, [list("1", [item("10", "A", { lat: NORTH(600) })])], { at: T0 + 30 });
    const history = await db.kysely
      .selectFrom("place_locations")
      .selectAll()
      .orderBy("valid_until")
      .execute();
    expect(history).toMatchObject([
      { detected_by: "import", valid_from: T0, valid_until: T0 + 20 },
      { valid_from: T0 + 20, valid_until: T0 + 30 },
    ]);
  });

  it("bumps no seq when re-importing unchanged data", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A", { localNote: "x" })])]);
    const first = await pull(db, WIFE, null);
    await runImport(db, WIFE, [list("1", [item("10", "A", { localNote: "x" })])], { at: T0 + 1 });
    expect((await pull(db, WIFE, first.cursor)).rows).toHaveLength(0);
  });

  it("delivers a list someone imported long ago to a new follower", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("10", "A"), item("11", "B")])]);
    await push(db, ME, [up("places", searchedPlace("Z"))], T0);
    const myCursor = (await pull(db, ME, null)).cursor;
    await runImport(db, ME, [list("1", [item("10", "A"), item("11", "B")], { followed: true })], {
      at: T0 + 100,
      snapshotMs: 0,
    });
    const got = (await pull(db, ME, myCursor)).rows.map((r) => `${r.table}:${r.row.id}`);
    for (const id of [
      "lists:l_kakao_1",
      "list_items:i_kakao_1_10",
      "list_items:i_kakao_1_11",
      "places:p_kakao_A",
      "places:p_kakao_B",
      "place_sources:s_kakao_A",
      "user_lists:ul_l_kakao_1",
    ]) {
      expect(got).toContain(id);
    }
  });

  it("keys a favourite without a place id as a pin of that list", async () => {
    const db = await setup(makeDb);
    await runImport(db, WIFE, [list("1", [item("55", undefined)])]);
    expect((await all(db, "places"))[0]?.id).toBe("pin_kakao_1_55");
  });

  it("finishes a 5,000-place list with long notes within the limits", async () => {
    const db = await setup(makeDb);
    const items = Array.from({ length: 5000 }, (_, i) =>
      item(`${"9".repeat(150)}${i}`, `P${i}`, { position: i, providerNote: "가".repeat(5000) }),
    );
    let run = await startRun(db, WIFE, 0, { "1": 5000 });
    const statements: Statement[] = [];
    const counting: Db = {
      ...db,
      atomic: (qs) => {
        statements.push(...qs);
        return db.atomic(qs);
      },
    };
    for (let i = 0; i < 10; i++) {
      const before = statements.length;
      await importListChunk(
        counting,
        WIFE,
        run.runId,
        "1",
        i,
        items.slice(i * 500, (i + 1) * 500),
        T0,
      );
      expect(statements.length - before).toBeLessThanOrEqual(50);
    }
    run = await startRun(db, WIFE, 1, { "1": 0 });
    await importListChunk(db, WIFE, run.runId, "1", 0, [], T0 + 1);
    const before = statements.length;
    const summary = await finishImportList(counting, WIFE, run.runId, "1", T0 + 1);
    expect(summary.membershipsRemoved).toBe(5000);
    expect(statements.length - before).toBeLessThanOrEqual(50);
    for (const s of statements) {
      const c = s.compile();
      expect(c.parameters.length).toBeLessThanOrEqual(100);
      for (const p of c.parameters)
        if (typeof p === "string")
          expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(1_000_000);
    }
  }, 120_000);

  it("refuses a chunk for a run superseded mid-flight, and allows one running import", async () => {
    const db = await setup(makeDb);
    const run = await startRun(db, WIFE, 0);
    const racing = interleaved(db, () => startRun(db, WIFE, 1));
    await expect(
      importListChunk(racing, WIFE, run.runId, "1", 0, [item("10", "A")], T0 + 2),
    ).rejects.toBeInstanceOf(RunClosedError);
    expect(await all(db, "places")).toHaveLength(0);
    const running = await db.kysely
      .selectFrom("import_runs")
      .selectAll()
      .where("status", "=", "running")
      .execute();
    expect(running).toHaveLength(1);
    expect((await latestImportRun(db, WIFE))?.status).toBe("running");
  });
});

forEachDialect("import seen pages", (makeDb) => {
  const pages = (db: Db, runId: string) =>
    db.kysely
      .selectFrom("import_run_pages")
      .selectAll()
      .where("run_id", "=", runId)
      .orderBy("external_id")
      .orderBy("page")
      .execute();
  const removed = async (db: Db) =>
    (await all(db, "list_items")).filter((i) => i.removed_at_provider != null).map((i) => i.id);

  it("a page retried with the same items is seen once", async () => {
    const db = await setup(makeDb);
    const items = [item("10", "A"), item("11", "B")];
    await runImport(db, WIFE, [list("1", items)]);
    const { runId } = await startRun(db, WIFE, 1, { "1": 2 });
    await importListChunk(db, WIFE, runId, "1", 0, items, T0 + 1);
    await importListChunk(db, WIFE, runId, "1", 0, items, T0 + 1);
    await finishImportList(db, WIFE, runId, "1", T0 + 1);
    expect(await removed(db)).toEqual([]);
    const seen = await pages(db, runId);
    expect(seen.map((p) => [p.user_id, p.external_id, p.page])).toEqual([[WIFE, "1", 0]]);
    expect(JSON.parse(seen[0]?.item_ids ?? "[]")).toEqual(["i_kakao_1_10", "i_kakao_1_11"]);
    await completeImportRun(db, WIFE, runId, T0 + 2);
    expect(await pages(db, runId)).toEqual([]);
  });

  it("marks only items missing from every page of the list removed", async () => {
    const db = await setup(makeDb);
    const items = ["10", "11", "12", "13", "14"].map((e) => item(e, `P${e}`));
    await runImport(db, WIFE, [list("1", items)], { chunk: 2 });
    // Three pages: the item count is the provider's, the pages hold what it sent.
    const { runId } = await startRun(db, WIFE, 1, { "1": 1001 });
    await importListChunk(db, WIFE, runId, "1", 0, items.slice(0, 2), T0 + 1);
    await importListChunk(db, WIFE, runId, "1", 1, [], T0 + 1);
    await importListChunk(db, WIFE, runId, "1", 2, items.slice(4), T0 + 1);
    await finishImportList(db, WIFE, runId, "1", T0 + 1);
    expect((await removed(db)).sort()).toEqual(["i_kakao_1_12", "i_kakao_1_13"]);
    expect((await pages(db, runId)).map((p) => p.page)).toEqual([0, 1, 2]);
  });

  it("deletes a superseded run's pages when the next run starts", async () => {
    const db = await setup(makeDb);
    const first = await startRun(db, WIFE, 1);
    await importListChunk(db, WIFE, first.runId, "1", 0, [item("10", "A")], T0 + 1);
    const other = await startRun(db, ME, 1);
    await importListChunk(db, ME, other.runId, "1", 0, [item("10", "A")], T0 + 1);
    expect(await pages(db, first.runId)).toHaveLength(1);
    await startRun(db, WIFE, 2);
    expect(await pages(db, first.runId)).toEqual([]);
    expect(await pages(db, other.runId)).toHaveLength(1);
  });
});

forEachDialect("import seen pages migration", (makeDb) => {
  it("a run started before the migration ends as superseded and marks nothing removed", async () => {
    const db = await makeDb({ through: "0001_init.sql" });
    await addUser(db, WIFE);
    const base = { created_at: T0, updated_at: T0, deleted_at: null, client_updated_at: 0, seq: 1 };
    await db.kysely
      .insertInto("lists")
      .values({
        ...base,
        id: "l_kakao_1",
        provider: "kakao",
        external_id: "1",
        name: "리스트 1",
        description: null,
        color: null,
        owner_name: null,
        removed_at_provider: null,
        provider_snapshot_at: T0,
      })
      .execute();
    await db.kysely
      .insertInto("list_items")
      .values(
        ["10", "11"].map((e, position) => ({
          ...base,
          id: `i_kakao_1_${e}`,
          list_id: "l_kakao_1",
          place_id: `p_kakao_P${e}`,
          position,
          added_at: T0,
          external_id: e,
          provider_note: null,
          provider_color: null,
          removed_at_provider: null,
          provider_snapshot_at: T0,
        })),
      )
      .execute();
    await db.kysely
      .insertInto("import_runs")
      .values({
        user_id: WIFE,
        id: "old-run",
        provider: "kakao",
        started_at: T0 + 1,
        finished_at: null,
        status: "running",
        complete: 1,
        subscription_known: 1,
        snapshot_at: T0 + 1,
        summary_json: null,
        error: null,
      })
      .execute();
    await db.kysely
      .insertInto("import_run_lists")
      .values({
        user_id: WIFE,
        run_id: "old-run",
        external_id: "1",
        position: 0,
        name: "리스트 1",
        description: null,
        owner_name: null,
        followed: 0,
        item_count: 2,
        pages_done: 1,
        finished: 0,
      })
      .execute();
    await sql`INSERT INTO import_seen (user_id, run_id, list_item_id) VALUES (${WIFE}, 'old-run', 'i_kakao_1_10')`.execute(
      db.kysely,
    );

    expect(await migrate(db, migrationsDir(db.dialect))).toEqual(["0002_import_run_pages.sql"]);

    const run = await db.kysely
      .selectFrom("import_runs")
      .selectAll()
      .where("id", "=", "old-run")
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("superseded");
    expect(Number(run.finished_at)).toBeGreaterThan(0);
    await expect(finishImportList(db, WIFE, "old-run", "1", T0 + 2)).rejects.toBeInstanceOf(
      RunClosedError,
    );
    expect((await all(db, "list_items")).map((i) => [i.id, i.removed_at_provider])).toEqual([
      ["i_kakao_1_10", null],
      ["i_kakao_1_11", null],
    ]);
    expect(await db.kysely.selectFrom("import_run_lists").selectAll().execute()).toEqual([]);
    expect(await migrate(db, migrationsDir(db.dialect))).toEqual([]);
  });
});

forEachDialect("import run progress", (makeDb) => {
  it("latestImportRun reports the snapshot and, while running, how many lists are done", async () => {
    const db = await setup(makeDb);
    const run = await startRun(db, WIFE, 5, { "1": 1, "2": 1, "3": 1 });
    await importListChunk(db, WIFE, run.runId, "1", 0, [item("10", "A")], T0 + 6);
    await finishImportList(db, WIFE, run.runId, "1", T0 + 7);
    expect(await latestImportRun(db, WIFE)).toMatchObject({
      status: "running",
      snapshotAt: T0 + 5,
      progress: { listsDone: 1, listCount: 3 },
    });
    for (const [ext, place] of [
      ["2", "B"],
      ["3", "C"],
    ] as const) {
      await importListChunk(db, WIFE, run.runId, ext, 0, [item(`${ext}0`, place)], T0 + 8);
      await finishImportList(db, WIFE, run.runId, ext, T0 + 9);
    }
    await completeImportRun(db, WIFE, run.runId, T0 + 10);
    const done = await latestImportRun(db, WIFE);
    expect(done).toMatchObject({ status: "completed", snapshotAt: T0 + 5 });
    expect(done?.progress).toBeUndefined();
  });

  it("runProgress gives each list's pages done and finished flag, in order", async () => {
    const db = await setup(makeDb);
    const run = await startRun(db, WIFE, 5, { "1": 1, "2": 501, "3": 1 });
    await importListChunk(db, WIFE, run.runId, "1", 0, [item("10", "A")], T0 + 6);
    await finishImportList(db, WIFE, run.runId, "1", T0 + 7);
    await importListChunk(
      db,
      WIFE,
      run.runId,
      "2",
      0,
      Array.from({ length: 500 }, (_, i) => item(`${200 + i}`, `P${i}`)),
      T0 + 8,
    );
    expect(await runProgress(db, WIFE, run.runId)).toEqual({
      snapshotAt: T0 + 5,
      lists: [
        { externalId: "1", name: "리스트 1", itemCount: 1, pagesDone: 1, finished: true },
        { externalId: "2", name: "리스트 2", itemCount: 501, pagesDone: 1, finished: false },
        { externalId: "3", name: "리스트 3", itemCount: 1, pagesDone: 0, finished: false },
      ],
    });
    await expect(runProgress(db, ME, run.runId)).rejects.toBeInstanceOf(RunNotFoundError);
    await startRun(db, WIFE, 6);
    await expect(runProgress(db, WIFE, run.runId)).rejects.toBeInstanceOf(RunClosedError);
  });

  it("runProgress rejects a completed run", async () => {
    const db = await setup(makeDb);
    const run = await startRun(db, WIFE, 5);
    await importListChunk(db, WIFE, run.runId, "1", 0, [item("10", "A")], T0 + 6);
    await finishImportList(db, WIFE, run.runId, "1", T0 + 7);
    await completeImportRun(db, WIFE, run.runId, T0 + 8);
    await expect(runProgress(db, WIFE, run.runId)).rejects.toBeInstanceOf(RunClosedError);
  });

  it("importedSnapshot is true only for a completed run on that snapshot", async () => {
    const db = await setup(makeDb);
    const first = await startRun(db, WIFE, 5);
    expect(await importedSnapshot(db, WIFE, T0 + 5)).toBe(false);
    await importListChunk(db, WIFE, first.runId, "1", 0, [item("10", "A")], T0 + 6);
    await finishImportList(db, WIFE, first.runId, "1", T0 + 7);
    await completeImportRun(db, WIFE, first.runId, T0 + 8);
    expect(await importedSnapshot(db, WIFE, T0 + 5)).toBe(true);
    expect(await importedSnapshot(db, WIFE, T0 + 6)).toBe(false);
    expect(await importedSnapshot(db, ME, T0 + 5)).toBe(false);
    // A superseded run (20) and a still-running one (30) don't count.
    await startRun(db, WIFE, 20);
    await startRun(db, WIFE, 30);
    expect(await importedSnapshot(db, WIFE, T0 + 20)).toBe(false);
    expect(await importedSnapshot(db, WIFE, T0 + 30)).toBe(false);
  });
});
