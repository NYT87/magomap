import { CLOCK_ALLOWANCE_MS } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { addUser, del, note, push, searchedPlace, T0, uid, up } from "./testkit";

const A = "user-a";
const B = "user-b";
const P1 = "p_kakao_1";

const _shared = (
  db: Db,
  table: "places" | "lists" | "list_items" | "place_sources" | "place_locations",
  id?: string,
) =>
  db.kysely
    .selectFrom(table)
    .selectAll()
    .$if(Boolean(id), (q) => q.where("id", "=", id as string))
    .execute();
const mine = (
  db: Db,
  table: "visit_notes" | "links" | "user_places" | "user_lists",
  user: string,
  id?: string,
) =>
  db.kysely
    .selectFrom(table)
    .selectAll()
    .where("user_id", "=", user)
    .$if(Boolean(id), (q) => q.where("id", "=", id as string))
    .execute();

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, A);
  await addUser(db, B);
  return db;
}

async function _insertProviderList(db: Db, id = "l_kakao_9") {
  await db.kysely
    .insertInto("lists")
    .values({
      id,
      provider: "kakao",
      external_id: "9",
      name: "제주",
      description: null,
      color: null,
      owner_name: "지은",
      removed_at_provider: null,
      provider_snapshot_at: T0,
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      client_updated_at: 0,
      seq: 0,
    })
    .execute();
}

forEachDialect("push review regressions", (makeDb) => {
  it("rejects text Postgres can't store in one mutation only", async () => {
    const db = await setup(makeDb);
    const res = await push(
      db,
      A,
      [
        up("places", searchedPlace("1")),
        up("visit_notes", note("bad", P1, { body: "a\u0000b" })),
        up("visit_notes", note("good", P1)),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(["applied", "invalid", "applied"]);
  });

  it("reports superseded mutations with the final outcome", async () => {
    const db = await setup(makeDb);
    const res = await push(
      db,
      A,
      [
        up("visit_notes", note("n1", "p_kakao_404"), T0 + 1),
        up("visit_notes", note("n1", "p_kakao_404"), T0 + 2),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason)).toEqual(["missing_parent", "missing_parent"]);
  });

  it("keeps a row deleted before its create arrived, and accepts a newer create", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("places", searchedPlace("1"))], T0);
    await push(db, A, [del("visit_notes", "n1", T0 + 5)], T0);
    expect(
      (await push(db, A, [up("visit_notes", note("n1", P1), T0 + 3)], T0)).results[0]?.status,
    ).toBe("ignored_stale");
    expect(await mine(db, "visit_notes", A, uid("n1"))).toHaveLength(0);
    expect(
      (await push(db, A, [up("visit_notes", note("n1", P1), T0 + 9)], T0)).results[0]?.status,
    ).toBe("applied");
  });

  it("answers clock_ahead for a time ahead of the server, and accepts it later", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("places", searchedPlace("1"))], T0);
    const ahead = up("visit_notes", note("n1", P1), T0 + CLOCK_ALLOWANCE_MS + 120_000);
    expect((await push(db, A, [ahead], T0)).results[0]).toMatchObject({
      status: "rejected",
      reason: "clock_ahead",
    });
    expect((await push(db, A, [ahead], T0 + 180_000)).results[0]?.status).toBe("applied");
  });

  it("never lets a retry overwrite a newer edit", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("places", searchedPlace("1"))], T0);
    const original = up("visit_notes", note("n1", P1, { body: "old" }), T0 + 30_000, "orig");
    await push(db, A, [original], T0);
    await push(
      db,
      A,
      [up("visit_notes", note("n1", P1, { body: "newer" }), T0 + 120_000)],
      T0 + 120_000,
    );
    expect((await push(db, A, [original], T0 + 600_000)).results[0]?.status).toBe("ignored_stale");
    expect((await mine(db, "visit_notes", A, uid("n1")))[0]?.body).toBe("newer");
  });

  it("never stamps an accepted edit earlier than the device's own time, so the next edit wins", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("places", searchedPlace("1"))], T0);
    // A device 30 s ahead saves; the server accepts it.
    const ahead = T0 + 30_000;
    await push(db, A, [up("visit_notes", note("n1", P1, { body: "fast" }), ahead)], T0);
    const [row] = await mine(db, "visit_notes", A, uid("n1"));
    expect(Number(row?.updated_at)).toBeGreaterThanOrEqual(ahead);
    // Another device with a right clock edits what it pulled, stamping above that row.
    const next = Math.max(T0 + 5_000, Number(row?.updated_at) + 1);
    const res = await push(
      db,
      A,
      [up("visit_notes", note("n1", P1, { body: "later" }), next)],
      T0 + 5_000,
    );
    expect(res.results[0]?.status).toBe("applied");
    expect((await mine(db, "visit_notes", A, uid("n1")))[0]?.body).toBe("later");
  });
});
