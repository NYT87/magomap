// Regression tests for the Codex review of plan 01: retries and concurrent writers.
import type { Mutation, VisitNoteRow } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db, Statement } from "../core";
import { forEachDialect } from "../testing/dbs";
import { finishImportList, importListChunk, RunClosedError, startImportRun } from "./importRuns";
import { applyPush, CLOCK_ALLOWANCE_MS } from "./sync";

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
  lat: 33,
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
const up = (
  table: Mutation["table"],
  row: { id: string },
  at: number,
  mutationId = `c${++n}`,
): Mutation => ({
  mutationId,
  table,
  op: "upsert",
  id: row.id,
  row,
  clientUpdatedAt: at,
});
const del = (table: Mutation["table"], id: string, at: number): Mutation => ({
  mutationId: `c${++n}`,
  table,
  op: "delete",
  id,
  clientUpdatedAt: at,
});
const get = (db: Db, table: "places" | "visit_notes", id: string) =>
  db.kysely
    .selectFrom(table)
    .selectAll()
    .where("user_id", "=", U)
    .where("id", "=", id)
    .executeTakeFirst();

/** Runs `before` once, right before the first write batch: another writer slips in after the pre-read. */
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

forEachDialect("concurrency (codex review)", (makeDb) => {
  it("1. rejects a time far ahead of the server instead of clamping it", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    const res = await applyPush(
      db,
      U,
      [up("visit_notes", noteRow("n1", "kp_1"), T0 + CLOCK_ALLOWANCE_MS + 1)],
      T0,
    );
    expect(res.results[0]).toMatchObject({ status: "rejected", reason: "invalid" });
  });

  it("1b. a retried mutation never overwrites a newer edit", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    const original = up("visit_notes", noteRow("n1", "kp_1", { body: "old" }), T0 + 30_000, "orig");
    await applyPush(db, U, [original], T0);
    await applyPush(
      db,
      U,
      [up("visit_notes", noteRow("n1", "kp_1", { body: "newer" }), T0 + 120_000)],
      T0 + 120_000,
    );
    const retry = await applyPush(db, U, [original], T0 + 600_000);
    expect(retry.results[0]?.status).toBe("ignored_stale");
    expect((await get(db, "visit_notes", "n1"))?.body).toBe("newer");
  });

  it("2. a write the database refuses is reported stale, with the winning row", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(
      db,
      U,
      [up("places", placeRow("1"), T0 + 1), up("visit_notes", noteRow("n1", "kp_1"), T0 + 1)],
      T0,
    );
    const racing = interleaved(db, () =>
      applyPush(db, U, [up("visit_notes", noteRow("n1", "kp_1", { body: "B newer" }), T0 + 9)], T0),
    );
    const res = await applyPush(
      racing,
      U,
      [up("visit_notes", noteRow("n1", "kp_1", { body: "A older" }), T0 + 5)],
      T0,
    );
    expect(res.results[0]?.status).toBe("ignored_stale");
    expect(res.results[0]?.row).toMatchObject({ body: "B newer" });
    expect((await get(db, "visit_notes", "n1"))?.body).toBe("B newer");
  });

  it("3. a note saved while another device deletes its place brings the place back", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    const racing = interleaved(db, () => applyPush(db, U, [del("places", "kp_1", T0 + 2)], T0));
    const res = await applyPush(racing, U, [up("visit_notes", noteRow("n1", "kp_1"), T0 + 3)], T0);
    expect(res.results[0]?.status).toBe("applied");
    expect((await get(db, "places", "kp_1"))?.deleted_at).toBeNull();
  });

  it("4. an older create loses to a newer delete that lands first", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1"), T0 + 1)], T0);
    const racing = interleaved(db, () => applyPush(db, U, [del("visit_notes", "n1", T0 + 9)], T0));
    const res = await applyPush(racing, U, [up("visit_notes", noteRow("n1", "kp_1"), T0 + 5)], T0);
    expect(res.results[0]?.status).toBe("ignored_stale");
    expect(await get(db, "visit_notes", "n1")).toBeUndefined();
  });

  it("5. a chunk for a run superseded mid-flight writes nothing", async () => {
    const db = await makeDb();
    await withUser(db);
    const run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0);
    const racing = interleaved(db, () =>
      startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 1),
    );
    const meta = { kakaoFolderId: 1, name: "리스트", subscribed: false };
    await expect(
      importListChunk(
        racing,
        U,
        run.runId,
        meta,
        [{ favoriteSeq: "10", placeKey: "A", title: "a", position: 0 }],
        T0 + 2,
      ),
    ).rejects.toBeInstanceOf(RunClosedError);
    expect(await get(db, "places", "kp_A")).toBeUndefined();
  });

  it("6. finishing a 5,000-place list with long notes stays within the limits", async () => {
    const db = await makeDb();
    await withUser(db);
    const meta = { kakaoFolderId: 1, name: "리스트", subscribed: false };
    const items = Array.from({ length: 5000 }, (_, i) => ({
      favoriteSeq: `${"9".repeat(150)}${i}`,
      placeKey: `P${i}`,
      title: "t",
      position: i,
      kakaoNote: "가".repeat(5000),
    }));
    let run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0);
    for (let i = 0; i < 10; i++)
      await importListChunk(db, U, run.runId, meta, items.slice(i * 500, (i + 1) * 500), T0);
    run = await startImportRun(db, U, { complete: true, importedAt: "x" }, T0 + 1);
    const statements: Statement[] = [];
    const counting: Db = {
      ...db,
      atomic: (qs) => {
        statements.push(...qs);
        return db.atomic(qs);
      },
    };
    const summary = await finishImportList(counting, U, run.runId, 1, T0 + 1);
    expect(summary.membershipsRemoved).toBe(5000);
    expect(statements.length).toBeLessThanOrEqual(50);
    for (const s of statements) {
      const c = s.compile();
      expect(c.parameters.length).toBeLessThanOrEqual(100);
      for (const p of c.parameters)
        if (typeof p === "string")
          expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(1_000_000);
    }
  }, 60_000);

  it("7. a refused place update adds no location history", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", placeRow("1", { lat: 33 }), T0 + 1)], T0);
    const racing = interleaved(db, () =>
      applyPush(db, U, [up("places", placeRow("1", { lat: 34 }), T0 + 9)], T0),
    );
    const res = await applyPush(racing, U, [up("places", placeRow("1", { lat: 35 }), T0 + 5)], T0);
    expect(res.results[0]?.status).toBe("ignored_stale");
    expect((await get(db, "places", "kp_1"))?.lat).toBe(34);
    const history = await db.kysely.selectFrom("place_locations").selectAll().execute();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ lat: 33 });
  });
});
