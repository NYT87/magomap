import type { ImportList } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { recordKakaoColorEdit } from "./kakaoColors";
import { bindKakaoMapAccount } from "./kakaoMapAccounts";
import { addUser, importSnapshot, T0 } from "./testkit";

const WIFE = "wife";
const ME = "me";
const item = (ext: string, placeExt: string, color = "01") => ({
  externalId: ext,
  placeExternalId: placeExt,
  title: `장소 ${ext}`,
  address: "제주",
  lat: 33.46,
  lng: 126.31,
  providerColor: color,
  position: Number(ext),
});
const list = (extra: Partial<ImportList> = {}): ImportList => ({
  externalId: "1",
  name: "리스트",
  followed: false,
  items: [item("10", "A"), item("11", "B")],
  ...extra,
});

/** She owns Kakao list "1" (owner id acct-wife) and has bound that account; he follows it. */
async function setup(makeDb: () => Promise<Db>, ownerId = "acct-wife") {
  const db = await makeDb();
  await addUser(db, WIFE);
  await addUser(db, ME);
  await bindKakaoMapAccount(db, WIFE, { kakaoMapUserId: "acct-wife" }, T0);
  await bindKakaoMapAccount(db, ME, { kakaoMapUserId: "acct-me" }, T0);
  const lists = [list({ providerOwnerId: ownerId })];
  await importSnapshot(db, WIFE, lists, { snapshot: T0 + 1000, source: "kakao_map" });
  await importSnapshot(db, ME, [{ ...lists[0], followed: true } as ImportList], {
    snapshot: T0 + 1000,
  });
  const row = await db.kysely
    .selectFrom("list_items")
    .selectAll()
    .where("external_id", "=", "10")
    .executeTakeFirstOrThrow();
  return { db, listId: row.list_id, itemId: row.id };
}
const read = (db: Db, id: string) =>
  db.kysely.selectFrom("list_items").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

forEachDialect("a Kakao colour edit", (makeDb) => {
  it("records the owner's change, shared with everyone who has the list, with a new seq", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    const before = await read(db, itemId);
    const result = await recordKakaoColorEdit(db, WIFE, { listId, itemId, color: "05" }, T0 + 5000);
    expect(result).toBe("updated");
    const after = await read(db, itemId);
    expect(after.provider_color).toBe("05");
    expect(Number(after.color_edited_at)).toBe(T0 + 5000);
    expect(Number(after.seq)).toBeGreaterThan(Number(before.seq));
  });

  it("writes one list-item row and nothing else", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    const others = await db.kysely
      .selectFrom("list_items")
      .select(["id", "seq"])
      .where("id", "<>", itemId)
      .execute();
    await recordKakaoColorEdit(db, WIFE, { listId, itemId, color: "05" }, T0 + 5000);
    expect(
      await db.kysely
        .selectFrom("list_items")
        .select(["id", "seq"])
        .where("id", "<>", itemId)
        .execute(),
    ).toEqual(others);
  });

  it("is refused for a follower, writing nothing", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    expect(await recordKakaoColorEdit(db, ME, { listId, itemId, color: "05" }, T0 + 5000)).toBe(
      "not_owner",
    );
    expect((await read(db, itemId)).provider_color).toBe("01");
  });

  it("is refused when the list has no recorded owner", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    await db.kysely.updateTable("lists").set({ provider_owner_id: null }).execute();
    expect(await recordKakaoColorEdit(db, WIFE, { listId, itemId, color: "05" }, T0 + 5000)).toBe(
      "owner_unknown",
    );
    expect((await read(db, itemId)).provider_color).toBe("01");
  });

  it("is refused when no Kakao Map account is bound", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    await db.kysely.deleteFrom("kakao_map_accounts").where("user_id", "=", WIFE).execute();
    expect(await recordKakaoColorEdit(db, WIFE, { listId, itemId, color: "05" }, T0 + 5000)).toBe(
      "kakao_account_unconfirmed",
    );
  });

  it("is not found for an item of another list or one that doesn't exist", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    expect(
      await recordKakaoColorEdit(db, WIFE, { listId: "nope", itemId, color: "05" }, T0 + 5000),
    ).toBe("not_found");
    expect(
      await recordKakaoColorEdit(db, WIFE, { listId, itemId: "nope", color: "05" }, T0 + 5000),
    ).toBe("not_found");
  });

  it("refuses a colour that isn't a known code", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    expect(await recordKakaoColorEdit(db, WIFE, { listId, itemId, color: "99" }, T0 + 5000)).toBe(
      "invalid",
    );
    expect(await recordKakaoColorEdit(db, WIFE, { listId, itemId, color: "x1" }, T0 + 5000)).toBe(
      "invalid",
    );
  });

  it("keeps the edit when an older Kakao read arrives, and yields to a newer one", async () => {
    const { db, listId, itemId } = await setup(makeDb);
    await recordKakaoColorEdit(db, WIFE, { listId, itemId, color: "05" }, T0 + 5000);
    // A read taken before the edit (snapshot 3000) is newer than the last one but older than the edit.
    await importSnapshot(db, WIFE, [list({ providerOwnerId: "acct-wife" })], {
      snapshot: T0 + 3000,
      at: T0 + 6000,
    });
    expect((await read(db, itemId)).provider_color).toBe("05");
    // A read after the edit shows what Kakao has.
    await importSnapshot(db, WIFE, [list({ providerOwnerId: "acct-wife" })], {
      snapshot: T0 + 7000,
      at: T0 + 8000,
    });
    expect((await read(db, itemId)).provider_color).toBe("01");
  });
});
