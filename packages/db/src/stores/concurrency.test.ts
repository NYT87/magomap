import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { addUser, del, interleaved, note, push, searchedPlace, T0, uid, up } from "./testkit";

const A = "user-a";
const B = "user-b";
const P1 = "p_kakao_1";

const shared = (
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

forEachDialect("push concurrency", (makeDb) => {
  it("reports a write another device beat as stale, with the winner", async () => {
    const db = await setup(makeDb);
    await push(
      db,
      A,
      [up("places", searchedPlace("1")), up("visit_notes", note("n1", P1), T0 + 1)],
      T0,
    );
    const racing = interleaved(db, () =>
      push(db, A, [up("visit_notes", note("n1", P1, { body: "B newer" }), T0 + 9)], T0),
    );
    const res = await push(
      racing,
      A,
      [up("visit_notes", note("n1", P1, { body: "A older" }), T0 + 5)],
      T0,
    );
    expect(res.results[0]).toMatchObject({ status: "ignored_stale", row: { body: "B newer" } });
  });

  it("lets a newer delete that lands first beat an older create", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("places", searchedPlace("1"))], T0);
    const racing = interleaved(db, () => push(db, A, [del("visit_notes", "n1", T0 + 9)], T0));
    const res = await push(racing, A, [up("visit_notes", note("n1", P1), T0 + 5)], T0);
    expect(res.results[0]?.status).toBe("ignored_stale");
    expect(await mine(db, "visit_notes", A, uid("n1"))).toHaveLength(0);
  });

  it("adds no location history for a move another device's newer move beat", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("places", searchedPlace("1", { lat: 33 }), T0 + 1)], T0);
    const racing = interleaved(db, () =>
      push(db, B, [up("places", searchedPlace("1", { lat: 34 }), T0 + 9)], T0),
    );
    await push(racing, A, [up("places", searchedPlace("1", { lat: 35 }), T0 + 5)], T0);
    expect((await shared(db, "places", P1))[0]?.lat).toBe(34);
    expect(await shared(db, "place_locations")).toMatchObject([{ lat: 33 }]);
  });
});
