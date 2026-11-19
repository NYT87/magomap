import { CLOCK_ALLOWANCE_MS } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { applyPush } from "./sync";
import {
  addUser,
  del,
  interleaved,
  note,
  ownItem,
  ownList,
  searchedPlace,
  T0,
  up,
} from "./testkit";

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

async function insertProviderList(db: Db, id = "l_kakao_9") {
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

forEachDialect("push", (makeDb) => {
  // Validation and batching
  it("rejects one invalid mutation and applies the rest", async () => {
    const db = await setup(makeDb);
    const bad = up("links", {
      id: "l1",
      placeId: P1,
      url: "javascript:x",
      title: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    } as never);
    const res = await applyPush(
      db,
      A,
      [up("places", searchedPlace("1")), bad, up("visit_notes", note("n1", P1))],
      T0,
    );
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(["applied", "invalid", "applied"]);
  });

  it("rejects text Postgres can't store in one mutation only", async () => {
    const db = await setup(makeDb);
    const res = await applyPush(
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

  it("coalesces create, edit and delete of one note into a deleted state", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    await applyPush(
      db,
      A,
      [
        up("visit_notes", note("n1", P1), T0 + 2),
        up("visit_notes", note("n1", P1, { body: "edited" }), T0 + 3),
        del("visit_notes", "n1", T0 + 4),
      ],
      T0,
    );
    const late = await applyPush(db, A, [up("visit_notes", note("n1", P1), T0 + 2)], T0);
    expect(late.results[0]?.status).toBe("ignored_stale");
    expect(await mine(db, "visit_notes", A, "n1")).toHaveLength(0);
  });

  it("reports superseded mutations with the final outcome", async () => {
    const db = await setup(makeDb);
    const res = await applyPush(
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

  it("gives every row of one push the same new seq", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    await applyPush(
      db,
      A,
      [up("places", searchedPlace("2")), up("visit_notes", note("n1", "p_kakao_2"))],
      T0,
    );
    const [p2] = await shared(db, "places", "p_kakao_2");
    const [n1] = await mine(db, "visit_notes", A, "n1");
    const [p1] = await shared(db, "places", P1);
    expect(p2?.seq).toBe(n1?.seq);
    expect(Number(p2?.seq)).toBeGreaterThan(Number(p1?.seq));
  });

  it("gives the same result when a push is retried", async () => {
    const db = await setup(makeDb);
    const batch = [up("places", searchedPlace("1")), up("visit_notes", note("n1", P1))];
    await applyPush(db, A, batch, T0);
    const again = await applyPush(db, A, batch, T0);
    expect(again.results.every((r) => r.status === "applied" || r.status === "ignored_stale")).toBe(
      true,
    );
    expect(await mine(db, "visit_notes", A)).toHaveLength(1);
  });

  // Shared places
  it("creates a searched place once, with its source and the user's place", async () => {
    const db = await setup(makeDb);
    const res = await applyPush(
      db,
      A,
      [up("visit_notes", note("n1", P1)), up("places", searchedPlace("1"))],
      T0,
    );
    expect(res.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(await shared(db, "places")).toHaveLength(1);
    expect(await shared(db, "place_sources")).toMatchObject([
      { place_id: P1, provider: "kakao", external_id: "1" },
    ]);
    expect(await mine(db, "user_places", A)).toMatchObject([{ place_id: P1 }]);
  });

  it("only adds the second user's place when they save a place someone already has", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    await applyPush(db, B, [up("places", searchedPlace("1", { title: "renamed" }), T0 + 5)], T0);
    expect(await shared(db, "places")).toHaveLength(1);
    expect((await shared(db, "places", P1))[0]?.title).toBe("카페 1");
    expect(await mine(db, "user_places", B)).toHaveLength(1);
  });

  it("refuses places with a mismatched id, without coordinates, or a delete", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    const res = await applyPush(
      db,
      A,
      [
        up("places", { ...searchedPlace("2"), id: "p_kakao_other" }),
        up("places", searchedPlace("3", { lat: null, lng: null })),
        del("places", P1),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason)).toEqual(["not_allowed", "not_allowed", "not_allowed"]);
    expect(await shared(db, "places", P1)).toHaveLength(1);
  });

  it("records a move from search, and none for 10 m or an address alone", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"), T0 + 1)], T0);
    await applyPush(
      db,
      A,
      [up("places", searchedPlace("1", { lat: 33.46 + 10 / 111_320 }), T0 + 2)],
      T0,
    );
    await applyPush(
      db,
      A,
      [up("places", searchedPlace("1", { address: "다른 표기" }), T0 + 3)],
      T0,
    );
    expect(await shared(db, "place_locations")).toHaveLength(0);
    await applyPush(
      db,
      A,
      [up("places", searchedPlace("1", { lat: 33.46 + 100 / 111_320 }), T0 + 4)],
      T0 + 50,
    );
    expect(await shared(db, "place_locations")).toMatchObject([
      { place_id: P1, lat: 33.46, detected_by: "search", valid_until: T0 + 50 },
    ]);
  });

  // Lists and items
  it("refuses writes to provider lists and their items", async () => {
    const db = await setup(makeDb);
    await insertProviderList(db);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    const res = await applyPush(db, A, [up("list_items", ownItem("l_kakao_9", P1))], T0);
    expect(res.results[0]?.reason).toBe("provider_owned");
    const removal = await applyPush(db, A, [del("lists", "l_kakao_9")], T0);
    expect(removal.results[0]?.reason).toBe("provider_owned");
  });

  it("creates an own list with its owner, and requires the item id and parents", async () => {
    const db = await setup(makeDb);
    const res = await applyPush(
      db,
      A,
      [
        up("lists", ownList("own-1")),
        up("places", searchedPlace("1")),
        up("list_items", { ...ownItem("own-1", P1), id: "random" }),
        up("list_items", ownItem("own-1", "p_kakao_404")),
        up("list_items", ownItem("own-1", P1)),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual([
      "applied",
      "applied",
      "not_allowed",
      "missing_parent",
      "applied",
    ]);
    expect(await mine(db, "user_lists", A)).toMatchObject([{ list_id: "own-1", role: "owner" }]);
  });

  it("refuses to touch another user's own list, even with its id", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("lists", ownList("own-1")), up("places", searchedPlace("1"))], T0);
    const res = await applyPush(
      db,
      B,
      [
        up("lists", ownList("own-1", { name: "hijacked" }), T0 + 9),
        up("list_items", ownItem("own-1", P1), T0 + 9),
        del("lists", "own-1", T0 + 9),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason)).toEqual(["not_allowed", "not_allowed", "not_allowed"]);
    expect((await shared(db, "lists", "own-1"))[0]).toMatchObject({
      name: "바다 뷰",
      deleted_at: null,
    });
  });

  it("collapses the same own-list item added from two devices", async () => {
    const db = await setup(makeDb);
    await applyPush(
      db,
      A,
      [
        up("lists", ownList("own-1")),
        up("places", searchedPlace("1")),
        up("list_items", ownItem("own-1", P1), T0 + 1),
      ],
      T0,
    );
    await applyPush(db, A, [up("list_items", ownItem("own-1", P1), T0 + 2)], T0);
    expect(await shared(db, "list_items")).toHaveLength(1);
  });

  // Notes, links and last write wins
  it("ignores a stale edit and returns the server row", async () => {
    const db = await setup(makeDb);
    await applyPush(
      db,
      A,
      [
        up("places", searchedPlace("1")),
        up("visit_notes", note("n1", P1, { body: "new" }), T0 + 10),
      ],
      T0,
    );
    const res = await applyPush(
      db,
      A,
      [up("visit_notes", note("n1", P1, { body: "old" }), T0 + 5)],
      T0,
    );
    expect(res.results[0]).toMatchObject({
      status: "ignored_stale",
      row: { id: "n1", body: "new" },
    });
  });

  it("keeps a note private to its author and gives the author the place", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    await applyPush(db, B, [up("visit_notes", note("n1", P1))], T0);
    expect(await mine(db, "visit_notes", A)).toHaveLength(0);
    expect(await mine(db, "user_places", B)).toHaveLength(1);
  });

  it("refuses creating an imported note, and marks an edited one", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    const create = await applyPush(
      db,
      A,
      [up("visit_notes", note("n9", P1, { origin: "import", originKey: "x" }))],
      T0,
    );
    expect(create.results[0]?.reason).toBe("not_allowed");
    await db.kysely
      .insertInto("visit_notes")
      .values({
        user_id: A,
        id: "kn_p_kakao_1_l_kakao_9",
        place_id: P1,
        visited_on: null,
        body: "주차 어려움",
        origin: "import",
        origin_key: "l_kakao_9",
        edited_by_user: 0,
        created_at: T0,
        updated_at: T0,
        deleted_at: null,
        client_updated_at: 0,
        seq: 0,
      })
      .execute();
    await applyPush(
      db,
      A,
      [
        up(
          "visit_notes",
          note("kn_p_kakao_1_l_kakao_9", P1, {
            origin: "import",
            originKey: "l_kakao_9",
            visitedOn: null,
            body: "고침",
          }),
          T0 + 1,
        ),
      ],
      T0,
    );
    expect((await mine(db, "visit_notes", A, "kn_p_kakao_1_l_kakao_9"))[0]?.edited_by_user).toBe(1);
  });

  it("keeps a row deleted before its create arrived, and accepts a newer create", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    await applyPush(db, A, [del("visit_notes", "n1", T0 + 5)], T0);
    expect(
      (await applyPush(db, A, [up("visit_notes", note("n1", P1), T0 + 3)], T0)).results[0]?.status,
    ).toBe("ignored_stale");
    expect(await mine(db, "visit_notes", A, "n1")).toHaveLength(0);
    expect(
      (await applyPush(db, A, [up("visit_notes", note("n1", P1), T0 + 9)], T0)).results[0]?.status,
    ).toBe("applied");
  });

  it("answers clock_ahead for a time ahead of the server, and accepts it later", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    const ahead = up("visit_notes", note("n1", P1), T0 + CLOCK_ALLOWANCE_MS + 120_000);
    expect((await applyPush(db, A, [ahead], T0)).results[0]).toMatchObject({
      status: "rejected",
      reason: "clock_ahead",
    });
    expect((await applyPush(db, A, [ahead], T0 + 180_000)).results[0]?.status).toBe("applied");
  });

  it("never lets a retry overwrite a newer edit", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    const original = up("visit_notes", note("n1", P1, { body: "old" }), T0 + 30_000, "orig");
    await applyPush(db, A, [original], T0);
    await applyPush(
      db,
      A,
      [up("visit_notes", note("n1", P1, { body: "newer" }), T0 + 120_000)],
      T0 + 120_000,
    );
    expect((await applyPush(db, A, [original], T0 + 600_000)).results[0]?.status).toBe(
      "ignored_stale",
    );
    expect((await mine(db, "visit_notes", A, "n1"))[0]?.body).toBe("newer");
  });

  // Concurrency
  it("reports a write another device beat as stale, with the winner", async () => {
    const db = await setup(makeDb);
    await applyPush(
      db,
      A,
      [up("places", searchedPlace("1")), up("visit_notes", note("n1", P1), T0 + 1)],
      T0,
    );
    const racing = interleaved(db, () =>
      applyPush(db, A, [up("visit_notes", note("n1", P1, { body: "B newer" }), T0 + 9)], T0),
    );
    const res = await applyPush(
      racing,
      A,
      [up("visit_notes", note("n1", P1, { body: "A older" }), T0 + 5)],
      T0,
    );
    expect(res.results[0]).toMatchObject({ status: "ignored_stale", row: { body: "B newer" } });
  });

  it("lets a newer delete that lands first beat an older create", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1"))], T0);
    const racing = interleaved(db, () => applyPush(db, A, [del("visit_notes", "n1", T0 + 9)], T0));
    const res = await applyPush(racing, A, [up("visit_notes", note("n1", P1), T0 + 5)], T0);
    expect(res.results[0]?.status).toBe("ignored_stale");
    expect(await mine(db, "visit_notes", A, "n1")).toHaveLength(0);
  });

  it("adds no location history for a move another device's newer move beat", async () => {
    const db = await setup(makeDb);
    await applyPush(db, A, [up("places", searchedPlace("1", { lat: 33 }), T0 + 1)], T0);
    const racing = interleaved(db, () =>
      applyPush(db, B, [up("places", searchedPlace("1", { lat: 34 }), T0 + 9)], T0),
    );
    await applyPush(racing, A, [up("places", searchedPlace("1", { lat: 35 }), T0 + 5)], T0);
    expect((await shared(db, "places", P1))[0]?.lat).toBe(34);
    expect(await shared(db, "place_locations")).toMatchObject([{ lat: 33 }]);
  });
});
