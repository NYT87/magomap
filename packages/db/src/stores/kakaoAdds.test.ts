// Pending adds of a place to one of her own Kakao lists (issue #83): only her own live Kakao
// lists (never folder 0), only places she can see that have a Kakao place id.
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { exportUserData } from "./export";
import { addUser, del, kakaoAdd, ownList, push, searchedPlace, T0, uid, up } from "./testkit";
import { deleteAccount } from "./users";

const A = "user-a";
const B = "user-b";
const P1 = "p_kakao_1";

async function kakaoList(
  db: Db,
  id: string,
  externalId: string,
  extra: { removedAtProvider?: number; deletedAt?: number } = {},
) {
  await db.kysely
    .insertInto("lists")
    .values({
      id,
      provider: "kakao",
      external_id: externalId,
      name: "제주",
      description: null,
      color: null,
      owner_name: null,
      removed_at_provider: extra.removedAtProvider ?? null,
      provider_snapshot_at: T0,
      created_at: T0,
      updated_at: T0,
      deleted_at: extra.deletedAt ?? null,
      client_updated_at: 0,
      seq: 0,
    })
    .execute();
}

async function access(
  db: Db,
  user: string,
  listId: string,
  role: "owner" | "follower",
  removedAt: number | null = null,
) {
  await db.kysely
    .insertInto("user_lists")
    .values({
      user_id: user,
      id: `ul_${listId}`,
      list_id: listId,
      role,
      removed_at: removedAt,
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      client_updated_at: 0,
      seq: 0,
    })
    .execute();
}

const rows = (db: Db, user: string) =>
  db.kysely.selectFrom("kakao_adds").selectAll().where("user_id", "=", user).execute();

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, A);
  await addUser(db, B);
  await kakaoList(db, "l_kakao_9", "9");
  await access(db, A, "l_kakao_9", "owner");
  await push(db, A, [up("places", searchedPlace("1"))], T0);
  return db;
}

forEachDialect("kakao_adds", (makeDb) => {
  it("keeps her pending add to her own Kakao list, private to her", async () => {
    const db = await setup(makeDb);
    const res = await push(db, A, [up("kakao_adds", kakaoAdd("l_kakao_9", P1))], T0 + 5);
    expect(res.results[0]?.status).toBe("applied");
    expect(await rows(db, A)).toMatchObject([
      { id: "ka_l_kakao_9_p_kakao_1", list_id: "l_kakao_9", place_id: P1, failed: null },
    ]);
    expect(await rows(db, B)).toEqual([]);
  });

  it("refuses a followed, removed, deleted, magomap-made or default (folder 0) list", async () => {
    const db = await setup(makeDb);
    await kakaoList(db, "l_kakao_10", "10");
    await access(db, A, "l_kakao_10", "follower");
    await kakaoList(db, "l_kakao_11", "11");
    await access(db, A, "l_kakao_11", "owner", T0);
    await kakaoList(db, "l_kakao_12", "12", { removedAtProvider: T0 });
    await access(db, A, "l_kakao_12", "owner");
    await kakaoList(db, "l_kakao_0~77", "0~77");
    await access(db, A, "l_kakao_0~77", "owner");
    await kakaoList(db, "l_kakao_13", "13", { deletedAt: T0 });
    await access(db, A, "l_kakao_13", "owner");
    // Someone else's list she has no access to at all.
    await kakaoList(db, "l_kakao_14", "14");
    await access(db, B, "l_kakao_14", "owner");
    // One of her own magomap lists.
    await push(db, A, [up("lists", ownList("own-1"))], T0);
    const lists = [
      uid("own-1"),
      "l_kakao_10",
      "l_kakao_11",
      "l_kakao_12",
      "l_kakao_0~77",
      "l_kakao_13",
      "l_kakao_14",
    ];
    const res = await push(
      db,
      A,
      lists.map((l) => up("kakao_adds", kakaoAdd(l, P1))),
      T0 + 5,
    );
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(lists.map(() => "not_allowed"));
    expect(await rows(db, A)).toEqual([]);
  });

  it("refuses a place she can't see or one with no Kakao place id", async () => {
    const db = await setup(makeDb);
    // A place only B has.
    await push(db, B, [up("places", searchedPlace("2"))], T0);
    // A place she has, known only from another provider.
    await push(db, A, [up("places", searchedPlace("3", { provider: "naver" }))], T0);
    const res = await push(
      db,
      A,
      [
        up("kakao_adds", kakaoAdd("l_kakao_9", "p_kakao_2")),
        up("kakao_adds", kakaoAdd("l_kakao_9", "p_naver_3")),
      ],
      T0 + 5,
    );
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(["missing_parent", "not_allowed"]);
  });

  it("refuses an id that isn't ka_<list>_<place>", async () => {
    const db = await setup(makeDb);
    const res = await push(
      db,
      A,
      [up("kakao_adds", { ...kakaoAdd("l_kakao_9", P1), id: "ka_l_kakao_9_p_kakao_2" })],
      T0 + 5,
    );
    expect(res.results[0]?.reason).toBe("invalid");
  });

  it("collapses two devices' adds, takes a failure mark, and deletes", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("kakao_adds", kakaoAdd("l_kakao_9", P1), T0 + 5)], T0);
    await push(db, A, [up("kakao_adds", kakaoAdd("l_kakao_9", P1), T0 + 6)], T0);
    expect(await rows(db, A)).toHaveLength(1);
    await push(
      db,
      A,
      [up("kakao_adds", kakaoAdd("l_kakao_9", P1, { failed: "list_missing" }), T0 + 7)],
      T0,
    );
    expect((await rows(db, A))[0]).toMatchObject({ failed: "list_missing" });
    const gone = await push(db, A, [del("kakao_adds", "ka_l_kakao_9_p_kakao_1", T0 + 8)], T0);
    expect(gone.results[0]?.status).toBe("applied");
    expect((await rows(db, A))[0]?.deleted_at).toBe(T0 + 8);
  });

  it("goes with her account and comes with her export", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("kakao_adds", kakaoAdd("l_kakao_9", P1))], T0 + 5);
    const exported = await exportUserData(db, A, T0 + 9);
    expect(exported.mine.kakaoAdds).toMatchObject([{ listId: "l_kakao_9", placeId: P1 }]);
    await deleteAccount(db, A);
    expect(await rows(db, A)).toEqual([]);
  });
});
