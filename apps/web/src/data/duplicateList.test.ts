import type { ListItemRow, ListRow, UserListRow } from "@magomap/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { type MagomapDexie, openUserDb } from "./db";
import { duplicateList } from "./writes";

let n = 0;
beforeEach(() => {
  n += 1;
});

const list = (id: string, name: string, provider: string | null): ListRow => ({
  id,
  provider,
  externalId: provider ? id : null,
  name,
  description: null,
  color: null,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
const role = (listId: string, r: UserListRow["role"]): UserListRow => ({
  id: `ul_${listId}`,
  listId,
  role: r,
  removedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
const item = (
  id: string,
  listId: string,
  placeId: string,
  position: number,
  extra: Partial<ListItemRow> = {},
): ListItemRow => ({
  id,
  listId,
  placeId,
  position,
  addedAt: 1,
  externalId: null,
  providerNote: null,
  providerColor: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...extra,
});

/** A source list with three live places (out of order on purpose), one removed from Kakao, one deleted. */
async function seed(db: MagomapDexie, source: ListRow, r: UserListRow["role"]) {
  await db.lists.put(source);
  await db.user_lists.put(role(source.id, r));
  await db.list_items.bulkPut([
    item("i2", source.id, "p_b", 1, { providerNote: "창가 자리", providerColor: "01" }),
    item("i1", source.id, "p_a", 0),
    item("i3", source.id, "p_c", 2),
    item("i4", source.id, "p_gone", 3, { removedAtProvider: 5 }),
    item("i5", source.id, "p_deleted", 4, { deletedAt: 9 }),
  ]);
}

const copiesOf = async (db: MagomapDexie, sourceId: string) =>
  (await db.lists.toArray()).filter((l) => l.id !== sourceId);
const itemsOf = async (db: MagomapDexie, listId: string) =>
  (await db.list_items.where("listId").equals(listId).toArray())
    .filter((i) => i.deletedAt == null)
    .sort((a, b) => a.position - b.position);

describe("duplicateList", () => {
  for (const [label, provider, r] of [
    ["an own list", null, "owner"],
    ["a Kakao list he owns", "kakao", "owner"],
    ["a Kakao list he follows", "kakao", "follower"],
  ] as const) {
    it(`copies ${label} as a new own list with its live places in order`, async () => {
      const db = openUserDb(`dup${n}`);
      const source = list("src", "제주 카페", provider);
      await seed(db, source, r);
      const id = await duplicateList("src", "  제주 카페 (copy) ");
      const copies = await copiesOf(db, "src");
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({ id, provider: null, name: "제주 카페 (copy)" });
      expect((await itemsOf(db, id)).map((i) => i.placeId)).toEqual(["p_a", "p_b", "p_c"]);
      expect((await itemsOf(db, id)).map((i) => i.position)).toEqual([0, 1, 2]);
      // It is his own list at once, like any list he makes.
      expect((await db.user_lists.get(`ul_${id}`))?.role).toBe("owner");
    });
  }

  it("does not copy Kakao notes or the Kakao colour field, and leaves the source as it was", async () => {
    const db = openUserDb(`dup${n}`);
    await seed(db, list("src", "제주 카페", "kakao"), "owner");
    const before = await db.list_items.where("listId").equals("src").toArray();
    const id = await duplicateList("src", "copy");
    expect((await itemsOf(db, id)).every((i) => i.providerNote === null)).toBe(true);
    expect((await itemsOf(db, id)).every((i) => i.providerColor === null)).toBe(true);
    expect(await db.list_items.where("listId").equals("src").toArray()).toEqual(before);
    expect((await db.lists.get("src"))?.name).toBe("제주 카페");
  });

  it("makes an empty list from an empty source", async () => {
    const db = openUserDb(`dup${n}`);
    await db.lists.put(list("src", "빈 리스트", null));
    const id = await duplicateList("src", "copy");
    expect(await itemsOf(db, id)).toEqual([]);
  });

  it("queues the new list and its items to sync", async () => {
    const db = openUserDb(`dup${n}`);
    await seed(db, list("src", "제주 카페", null), "owner");
    await db.outbox.clear();
    await duplicateList("src", "copy");
    const tables = (await db.outbox.toArray()).map((e) => e.table);
    expect(tables.filter((t) => t === "lists")).toHaveLength(1);
    expect(tables.filter((t) => t === "list_items")).toHaveLength(3);
  });

  it("refuses a blank name and writes nothing", async () => {
    const db = openUserDb(`dup${n}`);
    await seed(db, list("src", "제주 카페", null), "owner");
    await db.outbox.clear();
    await expect(duplicateList("src", "   ")).rejects.toThrow("blank name");
    expect(await copiesOf(db, "src")).toEqual([]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("refuses a source that doesn't exist", async () => {
    openUserDb(`dup${n}`);
    await expect(duplicateList("nope", "copy")).rejects.toThrow("no such list");
  });

  it("keeps each place's colour as an item colour: a known Kakao code only", async () => {
    const db = openUserDb(`dup${n}`);
    await db.lists.put(list("src", "제주 카페", "kakao"));
    await db.user_lists.put(role("src", "follower"));
    await db.list_items.bulkPut([
      item("a", "src", "p_red", 0, { providerColor: "01" }),
      item("b", "src", "p_blue", 1, { providerColor: "05" }),
      item("c", "src", "p_unknown", 2, { providerColor: "99" }),
      item("d", "src", "p_none", 3),
    ]);
    const id = await duplicateList("src", "copy");
    const colours = Object.fromEntries(
      (await itemsOf(db, id)).map((i) => [i.placeId, i.itemColor ?? null]),
    );
    expect(colours).toEqual({ p_red: "01", p_blue: "05", p_unknown: null, p_none: null });
  });

  it("a copy of a copy keeps the colours too", async () => {
    const db = openUserDb(`dup${n}`);
    await db.lists.put(list("src", "제주 카페", "kakao"));
    await db.user_lists.put(role("src", "owner"));
    await db.list_items.bulkPut([item("a", "src", "p_red", 0, { providerColor: "01" })]);
    const first = await duplicateList("src", "first");
    const second = await duplicateList(first, "second");
    expect((await itemsOf(db, second)).map((i) => i.itemColor)).toEqual(["01"]);
  });
});
