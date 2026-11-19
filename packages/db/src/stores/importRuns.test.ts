import type { ImportItem, ImportList } from "@magomap/domain";
import { importedNoteRowId } from "@magomap/domain/ids";
import { expect, it } from "vitest";
import type { Db, Statement } from "../core";
import { forEachDialect } from "../testing/dbs";
import {
  completeImportRun,
  finishImportList,
  ImportIncompleteError,
  importListChunk,
  latestImportRun,
  RunClosedError,
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
