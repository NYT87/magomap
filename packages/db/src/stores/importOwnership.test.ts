import type { ImportItem, ImportList } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { addUser, importSnapshot, T0 } from "./testkit";
import { deleteAccount } from "./users";

// A provider list's external id is global (a Kakao folder id), so a read can name a list that
// another user owns. Only the first owner owns it: anyone else who claims it as their own becomes
// a follower, and their snapshot never removes it for everyone.

const A = "owner-a";
const B = "claimer-b";
const L = "l_kakao_500";

const item = (ext: string): ImportItem => ({
  externalId: ext,
  placeExternalId: `P${ext}`,
  title: `장소 ${ext}`,
  lat: 33.46,
  lng: 126.31,
  position: 0,
});
const list = (ext: string, name: string, items: ImportItem[] = [item(`${ext}1`)]): ImportList => ({
  externalId: ext,
  name,
  followed: false,
  items,
});

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, A);
  await addUser(db, B);
  return db;
}

const access = (db: Db, user: string) =>
  db.kysely
    .selectFrom("user_lists")
    .select(["role", "removed_at"])
    .where("user_id", "=", user)
    .where("list_id", "=", L)
    .executeTakeFirst();
const shared = (db: Db) =>
  db.kysely
    .selectFrom("lists")
    .select(["name", "removed_at_provider"])
    .where("id", "=", L)
    .executeTakeFirstOrThrow();

forEachDialect("list ownership across users", (makeDb) => {
  it("another user's claim to an owned list makes them a follower", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, A, [list("500", "A의 리스트")], { snapshot: T0 + 1000 });
    // B's claim is older than the list's snapshot: it changes nothing in the list.
    await importSnapshot(db, B, [list("500", "B가 바꾼 이름")], { at: T0 + 2000, snapshot: T0 });
    expect(await access(db, A)).toMatchObject({ role: "owner", removed_at: null });
    expect(await access(db, B)).toMatchObject({ role: "follower", removed_at: null });
    expect((await shared(db)).name).toBe("A의 리스트");

    // A newer claim is still only a follower's.
    await importSnapshot(db, B, [list("500", "B가 바꾼 이름")], { at: T0 + 3000 });
    expect(await access(db, B)).toMatchObject({ role: "follower" });
    expect(await access(db, A)).toMatchObject({ role: "owner" });
  });

  it("the claimer's later sync without the list removes it for them only", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, A, [list("500", "A의 리스트")], { snapshot: T0 });
    await importSnapshot(db, B, [list("500", "A의 리스트"), list("600", "B의 리스트")], {
      at: T0 + 1000,
    });
    await importSnapshot(db, B, [list("600", "B의 리스트")], { at: T0 + 2000 });
    expect((await shared(db)).removed_at_provider).toBeNull();
    expect(await access(db, A)).toMatchObject({ role: "owner", removed_at: null });
    expect((await access(db, B))?.removed_at).toBe(T0 + 2000);
  });

  it("an owner row someone else also holds never removes the list for everyone", async () => {
    // Rows from before this rule: both users hold the list as owner.
    const db = await setup(makeDb);
    await importSnapshot(db, A, [list("500", "A의 리스트")], { snapshot: T0 });
    await importSnapshot(db, B, [list("500", "A의 리스트")], { at: T0 + 1000 });
    await db.kysely
      .updateTable("user_lists")
      .set({ role: "owner" })
      .where("user_id", "=", B)
      .where("list_id", "=", L)
      .execute();
    await importSnapshot(db, B, [list("600", "B의 리스트")], { at: T0 + 2000 });
    expect((await shared(db)).removed_at_provider).toBeNull();
    expect((await access(db, B))?.removed_at).toBe(T0 + 2000);
    expect(await access(db, A)).toMatchObject({ role: "owner", removed_at: null });
  });

  it("an owner's own re-import keeps owner and can remove the list for everyone", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, A, [list("500", "A의 리스트")], { snapshot: T0 });
    await importSnapshot(db, B, [list("500", "A의 리스트")], { at: T0 + 500 });
    await importSnapshot(db, A, [list("500", "A의 리스트")], { at: T0 + 1000 });
    expect(await access(db, A)).toMatchObject({ role: "owner" });
    await importSnapshot(db, A, [list("700", "새 리스트")], { at: T0 + 2000 });
    expect((await shared(db)).removed_at_provider).toBe(T0 + 2000);
  });

  it("a list whose only owner deleted their account can be claimed", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, A, [list("500", "A의 리스트")], { snapshot: T0 });
    await deleteAccount(db, A);
    await importSnapshot(db, B, [list("500", "B의 리스트")], { at: T0 + 1000 });
    expect(await access(db, B)).toMatchObject({ role: "owner" });
    expect((await shared(db)).name).toBe("B의 리스트");
  });

  it("an owner who removed the list from their own lists still owns it", async () => {
    const db = await setup(makeDb);
    await importSnapshot(db, A, [list("500", "A의 리스트")], { snapshot: T0 });
    await db.kysely
      .updateTable("user_lists")
      .set({ removed_at: T0 + 10 })
      .where("user_id", "=", A)
      .where("list_id", "=", L)
      .execute();
    await importSnapshot(db, B, [list("500", "A의 리스트")], { at: T0 + 1000 });
    expect(await access(db, B)).toMatchObject({ role: "follower" });
  });
});
