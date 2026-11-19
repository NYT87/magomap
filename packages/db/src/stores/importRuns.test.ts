import type { ImportItem, ImportList } from "@magomap/domain";
import { sql } from "kysely";
import { expect, it } from "vitest";
import type { Db, Statement } from "../core";
import { forEachDialect } from "../testing/dbs";
import {
  completeImportRun,
  finishImportList,
  importListChunk,
  latestImportRun,
  RunClosedError,
  startImportRun,
} from "./importRuns";
import { applyPush, pull } from "./sync";

const T0 = 1_763_000_000_000;
const U = "user-1";
const NORTH = (m: number) => 33.46 + m / 111_320;

async function withUser(db: Db) {
  await db.kysely
    .insertInto("users")
    .values({ id: U, display_name: null, change_seq: 0, created_at: T0 })
    .execute();
}

function item(
  seq: string,
  placeKey: string | undefined,
  extra: Partial<ImportItem> = {},
): ImportItem {
  return {
    favoriteSeq: seq,
    placeKey,
    title: `장소 ${seq}`,
    address: "제주 애월읍",
    lat: 33.46,
    lng: 126.31,
    kakaoColor: "01",
    position: Number(seq) % 1000,
    ...extra,
  };
}

function list(folder: number, items: ImportItem[], extra: Partial<ImportList> = {}): ImportList {
  return { kakaoFolderId: folder, name: `리스트 ${folder}`, subscribed: false, items, ...extra };
}

/** Runs a whole import the way the client does: start, chunks of 500, finish each list, complete. */
async function runImport(
  db: Db,
  lists: ImportList[],
  opts: { complete?: boolean; now?: number; chunk?: number } = {},
) {
  const now = opts.now ?? T0;
  const { runId } = await startImportRun(
    db,
    U,
    { complete: opts.complete ?? true, importedAt: "2026-11-19T00:00:00Z" },
    now,
  );
  for (const l of lists) {
    const { items, ...meta } = l;
    const size = opts.chunk ?? 500;
    for (let i = 0; i < Math.max(1, Math.ceil(items.length / size)); i++) {
      await importListChunk(db, U, runId, meta, items.slice(i * size, (i + 1) * size), now);
    }
    await finishImportList(db, U, runId, l.kakaoFolderId, now);
  }
  return {
    runId,
    summary: await completeImportRun(
      db,
      U,
      runId,
      lists.map((l) => l.kakaoFolderId),
      now,
    ),
  };
}

const count = async (
  db: Db,
  table: "places" | "list_items" | "lists" | "visit_notes" | "place_locations",
) => (await db.kysely.selectFrom(table).selectAll().where("user_id", "=", U).execute()).length;

forEachDialect("import", (makeDb) => {
  it("imports two lists sharing a place as one place", async () => {
    const db = await makeDb();
    await withUser(db);
    const { summary } = await runImport(db, [
      list(1, [item("10", "A"), item("11", "B")]),
      list(2, [item("20", "A"), item("21", "C")]),
    ]);
    expect(await count(db, "places")).toBe(3);
    expect(await count(db, "list_items")).toBe(4);
    expect(await count(db, "lists")).toBe(2);
    expect(summary).toMatchObject({ listsAdded: 2, placesAdded: 3 });
  });

  it("marks nothing removed until a list is finished", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A"), item("11", "B")])]);
    const { runId } = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 1);
    const { items: _i, ...meta } = list(1, []);
    await importListChunk(db, U, runId, meta, [item("10", "A")], T0 + 1);
    const removed = await db.kysely
      .selectFrom("list_items")
      .select("removed_from_kakao_at")
      .where("id", "=", "ki_1_11")
      .executeTakeFirstOrThrow();
    expect(removed.removed_from_kakao_at).toBeNull();
    await finishImportList(db, U, runId, 1, T0 + 1);
    const after = await db.kysely
      .selectFrom("list_items")
      .select("removed_from_kakao_at")
      .where("id", "=", "ki_1_11")
      .executeTakeFirstOrThrow();
    expect(after.removed_from_kakao_at).toBe(T0 + 1);
  });

  it("marks a removed favourite, keeps the place and its notes, and restores it", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A"), item("11", "B")])]);
    await applyPush(
      db,
      U,
      [
        {
          mutationId: "m1",
          table: "visit_notes",
          op: "upsert",
          id: "n1",
          clientUpdatedAt: T0 + 1,
          row: {
            id: "n1",
            placeId: "kp_B",
            visitedOn: "2026-11-19",
            body: "좋았어요",
            origin: "user",
            originKey: null,
            editedByUser: false,
            createdAt: T0,
            updatedAt: T0,
            deletedAt: null,
          },
        },
      ],
      T0,
    );
    const gone = await runImport(db, [list(1, [item("10", "A")])], { now: T0 + 10 });
    expect(gone.summary.membershipsRemoved).toBe(1);
    expect(await count(db, "places")).toBe(2);
    expect(
      (
        await db.kysely
          .selectFrom("visit_notes")
          .select("body")
          .where("id", "=", "n1")
          .executeTakeFirst()
      )?.body,
    ).toBe("좋았어요");
    const back = await runImport(db, [list(1, [item("10", "A"), item("11", "B")])], {
      now: T0 + 20,
    });
    expect(back.summary.membershipsRestored).toBe(1);
  });

  it("marks no list removed for an incomplete import", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A")]), list(2, [item("20", "B")])]);
    await runImport(db, [list(1, [item("10", "A")])], { complete: false, now: T0 + 5 });
    const lists = await db.kysely
      .selectFrom("lists")
      .select(["id", "removed_from_kakao_at"])
      .execute();
    expect(lists.every((l) => l.removed_from_kakao_at === null)).toBe(true);
  });

  it("marks no list removed when a complete run finished no list", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A")])]);
    const { runId } = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 5);
    await completeImportRun(db, U, runId, [], T0 + 5);
    expect(
      (
        await db.kysely
          .selectFrom("lists")
          .select("removed_from_kakao_at")
          .executeTakeFirstOrThrow()
      ).removed_from_kakao_at,
    ).toBeNull();
  });

  it("marks a missing list removed after a complete run and keeps its places", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A")]), list(2, [item("20", "B")])]);
    const { summary } = await runImport(db, [list(1, [item("10", "A")])], { now: T0 + 5 });
    expect(summary.listsRemoved).toBe(1);
    const l2 = await db.kysely
      .selectFrom("lists")
      .select("removed_from_kakao_at")
      .where("id", "=", "kl_2")
      .executeTakeFirstOrThrow();
    expect(l2.removed_from_kakao_at).toBe(T0 + 5);
    expect(await count(db, "places")).toBe(2);
  });

  it("turns a local note into one diary entry, updates it, and respects edits and deletes", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A", { localNote: "주차 어려움" })])]);
    await runImport(db, [list(1, [item("10", "A", { localNote: "주차 어려움, 공영주차장" })])], {
      now: T0 + 1,
    });
    const notes = await db.kysely.selectFrom("visit_notes").selectAll().execute();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: "kn_kp_A_1",
      body: "주차 어려움, 공영주차장",
      origin: "kakao_list",
      visited_on: null,
    });

    await applyPush(
      db,
      U,
      [
        {
          mutationId: "e",
          table: "visit_notes",
          op: "upsert",
          id: "kn_kp_A_1",
          clientUpdatedAt: T0 + 2,
          row: { ...notesToWire(notes[0]), body: "내가 고침" },
        },
      ],
      T0 + 2,
    );
    await runImport(db, [list(1, [item("10", "A", { localNote: "import again" })])], {
      now: T0 + 3,
    });
    expect(
      (await db.kysely.selectFrom("visit_notes").select("body").executeTakeFirstOrThrow()).body,
    ).toBe("내가 고침");

    await applyPush(
      db,
      U,
      [
        {
          mutationId: "d",
          table: "visit_notes",
          op: "delete",
          id: "kn_kp_A_1",
          clientUpdatedAt: T0 + 4,
        },
      ],
      T0 + 4,
    );
    await runImport(db, [list(1, [item("10", "A", { localNote: "import again" })])], {
      now: T0 + 5,
    });
    expect(
      (await db.kysely.selectFrom("visit_notes").select("deleted_at").executeTakeFirstOrThrow())
        .deleted_at,
    ).not.toBeNull();
  });

  it("keeps the user's own note when an import runs", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A")])]);
    await applyPush(
      db,
      U,
      [
        {
          mutationId: "n",
          table: "visit_notes",
          op: "upsert",
          id: "own",
          clientUpdatedAt: T0 + 1,
          row: {
            id: "own",
            placeId: "kp_A",
            visitedOn: "2026-11-01",
            body: "내 메모",
            origin: "user",
            originKey: null,
            editedByUser: false,
            createdAt: T0,
            updatedAt: T0,
            deletedAt: null,
          },
        },
      ],
      T0,
    );
    await runImport(db, [list(1, [item("10", "A", { title: "새 이름" })])], { now: T0 + 2 });
    expect(
      (
        await db.kysely
          .selectFrom("visit_notes")
          .select("body")
          .where("id", "=", "own")
          .executeTakeFirst()
      )?.body,
    ).toBe("내 메모");
    expect((await db.kysely.selectFrom("places").select("title").executeTakeFirst())?.title).toBe(
      "새 이름",
    );
  });

  it("matches a place saved from search, keeps its notes and records no move", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(
      db,
      U,
      [
        {
          mutationId: "p",
          table: "places",
          op: "upsert",
          id: "kp_123",
          clientUpdatedAt: T0 + 1,
          row: {
            id: "kp_123",
            kakaoPlaceId: "123",
            title: "카페",
            address: "제주특별자치도 제주시 애월읍 123",
            roadAddress: "애월해안로 1",
            addressSource: "search",
            category: null,
            phone: null,
            lat: 33.46,
            lng: 126.31,
            source: "search",
            createdAt: T0,
            updatedAt: T0,
            deletedAt: null,
          },
        },
        {
          mutationId: "n",
          table: "visit_notes",
          op: "upsert",
          id: "n1",
          clientUpdatedAt: T0 + 1,
          row: {
            id: "n1",
            placeId: "kp_123",
            visitedOn: null,
            body: "검색해서 저장",
            origin: "user",
            originKey: null,
            editedByUser: false,
            createdAt: T0,
            updatedAt: T0,
            deletedAt: null,
          },
        },
      ],
      T0,
    );
    await runImport(db, [list(1, [item("10", "123", { address: "애월읍" })])], { now: T0 + 5 });
    expect(await count(db, "places")).toBe(1);
    expect(await count(db, "visit_notes")).toBe(1);
    expect(await count(db, "place_locations")).toBe(0);
  });

  it("records moves, ignores small changes, and chains history", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A")])], { now: T0 });
    await runImport(db, [list(1, [item("10", "A", { lat: NORTH(5) })])], { now: T0 + 10 });
    expect(await count(db, "place_locations")).toBe(0);
    const moved = await runImport(db, [list(1, [item("10", "A", { lat: NORTH(200) })])], {
      now: T0 + 20,
    });
    expect(moved.summary.placesMoved).toBe(1);
    await runImport(db, [list(1, [item("10", "A", { lat: NORTH(600) })])], { now: T0 + 30 });
    const history = await db.kysely
      .selectFrom("place_locations")
      .selectAll()
      .orderBy("valid_until")
      .execute();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      detected_by: "kakao_import",
      valid_from: T0,
      valid_until: T0 + 20,
    });
    expect(history[1]).toMatchObject({ valid_from: T0 + 20, valid_until: T0 + 30 });
  });

  it("bumps no seq when re-importing unchanged data", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("10", "A", { localNote: "x" })])]);
    const first = await pull(db, U, null);
    await runImport(db, [list(1, [item("10", "A", { localNote: "x" })])], { now: T0 + 1 });
    const next = await pull(db, U, first.cursor);
    expect(next.rows).toHaveLength(0);
  });

  it("imports a 3,000-item list in 500-item chunks within the limits", async () => {
    const db = await makeDb();
    await withUser(db);
    const statements: Statement[] = [];
    const counting: Db = {
      ...db,
      atomic: (qs) => {
        statements.push(...qs);
        return db.atomic(qs);
      },
    };
    const items = Array.from({ length: 3000 }, (_, i) => item(String(i), `P${i}`, { position: i }));
    const { runId } = await startImportRun(counting, U, { complete: true, importedAt: "x" }, T0);
    const { items: _i, ...meta } = list(1, []);
    for (let i = 0; i < 6; i++) {
      const before = statements.length;
      await importListChunk(counting, U, runId, meta, items.slice(i * 500, (i + 1) * 500), T0);
      expect(statements.length - before).toBeLessThanOrEqual(50);
    }
    for (const s of statements) {
      const c = s.compile();
      expect(c.parameters.length).toBeLessThanOrEqual(100);
      for (const p of c.parameters)
        if (typeof p === "string")
          expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(1_000_000);
    }
    await finishImportList(counting, U, runId, 1, T0);
    expect(await count(db, "list_items")).toBe(3000);
  });

  it("refuses writes to a superseded run", async () => {
    const db = await makeDb();
    await withUser(db);
    const first = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0);
    await startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 1);
    const { items: _i, ...meta } = list(1, []);
    await expect(
      importListChunk(db, U, first.runId, meta, [item("10", "A")], T0 + 2),
    ).rejects.toBeInstanceOf(RunClosedError);
  });

  it("imports a subscribed list with its owner and reports the latest run", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(7, [item("70", "S")], { subscribed: true, ownerName: "민수" })]);
    expect(
      await db.kysely.selectFrom("lists").select(["subscribed", "owner_name"]).executeTakeFirst(),
    ).toEqual({ subscribed: 1, owner_name: "민수" });
    const latest = await latestImportRun(db, U);
    expect(latest).toMatchObject({
      status: "completed",
      summary: { listsAdded: 1, placesAdded: 1 },
    });
    expect(await sql`select 1 as one`.execute(db.kysely)).toBeTruthy();
  });

  it("keys a favourite without a place key as a custom pin", async () => {
    const db = await makeDb();
    await withUser(db);
    await runImport(db, [list(1, [item("55", undefined)])]);
    expect((await db.kysely.selectFrom("places").select("id").executeTakeFirstOrThrow()).id).toBe(
      "kf_55",
    );
  });
});

function notesToWire(n: Record<string, unknown> | undefined) {
  return {
    id: n?.id,
    placeId: n?.place_id,
    visitedOn: n?.visited_on,
    body: n?.body,
    origin: n?.origin,
    originKey: n?.origin_key,
    editedByUser: Boolean(n?.edited_by_user),
    createdAt: n?.created_at,
    updatedAt: n?.updated_at,
    deletedAt: n?.deleted_at,
  };
}
