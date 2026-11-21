import type { ImportItem, ImportList } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { countWrites } from "../testing/countWrites";
import { forEachDialect } from "../testing/dbs";
import { bindKakaoMapAccount } from "./kakaoMapAccounts";
import { pull } from "./sync";
import { addUser, importSnapshot, T0 } from "./testkit";

// A shared Kakao list's owner in magomap is the user bound to the Kakao Map account that owns
// the folder in Kakao (spec: "Who owns a list"). An upload names each folder's owner; a
// kakao-list import can't, so it follows the recorded owner when there is one.

const A = "owner-a"; // bound to Kakao Map account "km-a", which owns folder 500
const B = "claimer-b"; // bound to "km-b"
const L = "l_kakao_500";

const item = (ext: string): ImportItem => ({
  externalId: ext,
  placeExternalId: `P${ext}`,
  title: `장소 ${ext}`,
  lat: 33.46,
  lng: 126.31,
  position: 0,
});
const list = (ext: string, name: string, extra: Partial<ImportList> = {}): ImportList => ({
  externalId: ext,
  name,
  followed: false,
  items: [item(`${ext}1`)],
  ...extra,
});
/** Folder 500 as an upload names it: owned in Kakao by "km-a". */
const owned = (name: string) => list("500", name, { providerOwnerId: "km-a" });

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, A);
  await addUser(db, B);
  await bindKakaoMapAccount(db, A, { kakaoMapUserId: "km-a" }, T0);
  await bindKakaoMapAccount(db, B, { kakaoMapUserId: "km-b" }, T0);
  return db;
}

const upload = (db: Db, user: string, lists: ImportList[], at: number) =>
  importSnapshot(db, user, lists, { source: "kakao_map", at });
const kakaoList = (db: Db, user: string, lists: ImportList[], at: number, snapshot = at) =>
  importSnapshot(db, user, lists, { source: "kakao_list", at, snapshot });

const access = (db: Db, user: string, listId = L) =>
  db.kysely
    .selectFrom("user_lists")
    .select(["role", "removed_at"])
    .where("user_id", "=", user)
    .where("list_id", "=", listId)
    .executeTakeFirst();
const shared = (db: Db, listId = L) =>
  db.kysely
    .selectFrom("lists")
    .select(["name", "removed_at_provider", "provider_owner_id"])
    .where("id", "=", listId)
    .executeTakeFirstOrThrow();

forEachDialect("a list's owner is the Kakao Map account that owns it", (makeDb) => {
  it("an upload from the folder's owner account owns it, and records the owner", async () => {
    const db = await setup(makeDb);
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    expect(await access(db, A)).toMatchObject({ role: "owner", removed_at: null });
    expect(await shared(db)).toMatchObject({ name: "A의 리스트", provider_owner_id: "km-a" });
    // Her own re-import keeps owner.
    await upload(db, A, [owned("A의 리스트")], T0 + 2000);
    expect(await access(db, A)).toMatchObject({ role: "owner" });
  });

  it("a claimer whose account differs is a follower and can't remove the list for everyone", async () => {
    const db = await setup(makeDb);
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    // B's read names folder 500 as unflagged, but its Kakao owner is km-a.
    await upload(
      db,
      B,
      [owned("A의 리스트"), list("600", "B의 리스트", { providerOwnerId: "km-b" })],
      T0 + 2000,
    );
    expect(await access(db, B)).toMatchObject({ role: "follower" });
    expect(await access(db, B, "l_kakao_600")).toMatchObject({ role: "owner" });
    await upload(db, B, [list("600", "B의 리스트", { providerOwnerId: "km-b" })], T0 + 3000);
    expect((await shared(db)).removed_at_provider).toBeNull();
    expect((await access(db, B))?.removed_at).toBe(T0 + 3000);
    expect(await access(db, A)).toMatchObject({ role: "owner", removed_at: null });
  });

  it("the real owner gets owner even when someone else imported the list first as owner", async () => {
    const db = await setup(makeDb);
    // B's kakao-list import came first and (by kakao-list's rule) made B its owner.
    await kakaoList(db, B, [list("500", "A의 리스트")], T0 + 500);
    expect(await access(db, B)).toMatchObject({ role: "owner" });
    // A's upload: A is bound to the folder's Kakao owner, so A owns it.
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    expect(await access(db, A)).toMatchObject({ role: "owner" });
    // B's stale owner row can't remove it for everyone (the recorded owner isn't B's account)…
    await kakaoList(db, B, [list("600", "B의 리스트")], T0 + 2000);
    expect((await shared(db)).removed_at_provider).toBeNull();
    expect((await access(db, B))?.removed_at).toBe(T0 + 2000);
    // …and B's next sync naming it makes B a follower.
    await kakaoList(db, B, [list("500", "A의 리스트"), list("600", "B의 리스트")], T0 + 3000);
    expect(await access(db, B)).toMatchObject({ role: "follower", removed_at: null });
    await upload(db, B, [owned("A의 리스트")], T0 + 4000);
    expect(await access(db, B)).toMatchObject({ role: "follower" });
    expect(await access(db, A)).toMatchObject({ role: "owner", removed_at: null });
  });

  it("a stale owner row from an upload becomes follower at its next upload", async () => {
    // Two owner rows on one list (as an older rule could leave them): the Kakao owner id settles it.
    const db = await setup(makeDb);
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    await upload(db, B, [owned("A의 리스트")], T0 + 1500);
    await db.kysely
      .updateTable("user_lists")
      .set({ role: "owner" })
      .where("user_id", "=", B)
      .where("list_id", "=", L)
      .execute();
    // While it lasts, the stale row can't remove the list for everyone.
    await upload(db, B, [list("600", "B의 리스트", { providerOwnerId: "km-b" })], T0 + 2000);
    expect((await shared(db)).removed_at_provider).toBeNull();
    await upload(db, B, [owned("A의 리스트")], T0 + 3000);
    expect(await access(db, B)).toMatchObject({ role: "follower", removed_at: null });
  });

  it("a bare folder (no owner in the read) is followed", async () => {
    const db = await setup(makeDb);
    await upload(db, B, [list("700", "주인 모름")], T0 + 1000);
    expect(await access(db, B, "l_kakao_700")).toMatchObject({ role: "follower" });
    expect((await shared(db, "l_kakao_700")).provider_owner_id).toBeNull();
  });

  it("a kakao-list import after a recorded owner: a different binding follows", async () => {
    const db = await setup(makeDb);
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    await kakaoList(db, B, [list("500", "A의 리스트")], T0 + 2000);
    expect(await access(db, B)).toMatchObject({ role: "follower" });
    // The owner's own kakao-list import keeps owner.
    await kakaoList(db, A, [list("500", "A의 리스트")], T0 + 3000);
    expect(await access(db, A)).toMatchObject({ role: "owner" });
    // A kakao-list import never clears the recorded owner.
    expect((await shared(db)).provider_owner_id).toBe("km-a");
  });

  it("a kakao-list import with no binding, or of a list with no recorded owner, keeps today's rule", async () => {
    const db = await setup(makeDb);
    const C = "unbound-c";
    await addUser(db, C);
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    await kakaoList(db, C, [list("500", "A의 리스트")], T0 + 2000);
    expect(await access(db, C)).toMatchObject({ role: "owner" });
    // …but without the recorded owner's binding, C's sync can't remove it for everyone.
    await kakaoList(db, C, [], T0 + 3000);
    expect((await shared(db)).removed_at_provider).toBeNull();
    // A list with no recorded owner: kakao-list's rule, including removal by its owner.
    await kakaoList(db, B, [list("800", "기록 없음")], T0 + 4000);
    expect(await access(db, B, "l_kakao_800")).toMatchObject({ role: "owner" });
    await kakaoList(db, B, [], T0 + 5000);
    expect((await shared(db, "l_kakao_800")).removed_at_provider).toBe(T0 + 5000);
  });

  it("the owner removes the list for everyone when her complete sync drops it", async () => {
    const db = await setup(makeDb);
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    await upload(db, B, [owned("A의 리스트")], T0 + 1500);
    await upload(db, A, [list("900", "새 리스트", { providerOwnerId: "km-a" })], T0 + 2000);
    expect((await shared(db)).removed_at_provider).toBe(T0 + 2000);
  });

  it("the owner id never reaches clients", async () => {
    const db = await setup(makeDb);
    await upload(db, A, [owned("A의 리스트")], T0 + 1000);
    const pulled = await pull(db, A, null);
    const row = pulled.rows.find((r) => r.table === "lists")?.row;
    expect(row).toMatchObject({ id: L, name: "A의 리스트" });
    expect(JSON.stringify(pulled)).not.toContain("km-a");
    expect(Object.keys(row ?? {})).not.toContain("providerOwnerId");
  });

  it("an unchanged upload re-import stays within the write budget", async () => {
    const db = await setup(makeDb);
    const big = Array.from({ length: 600 }, (_, i) => item(String(5000 + i)));
    const lists = [
      { ...owned("A의 리스트"), items: big },
      list("901", "작은 리스트", { providerOwnerId: "km-a" }),
    ];
    await upload(db, A, lists, T0 + 1000);
    const counted = countWrites(db);
    await upload(counted.db, A, lists, T0 + 2000);
    expect(counted.written()).toBeLessThanOrEqual(10 + 6 * 2 + 5 * 3);
  });
});
