import type { SearchResult } from "@magomap/domain";
import { placeRowId, userPlaceRowId } from "@magomap/domain/ids";
import { beforeEach, describe, expect, it } from "vitest";
import { openUserDb } from "./db";
import { savePlaceToList } from "./saveFromMap";
import { addToList, createList, savePlaceFromSearch } from "./writes";

const result = (extra: Partial<SearchResult> = {}): SearchResult => ({
  provider: "kakao",
  externalId: "321",
  title: "바다정원 카페",
  address: "제주 애월읍 고내리 1",
  roadAddress: "제주 애월읍 애월해안로 1",
  category: "음식점 > 카페",
  phone: null,
  lat: 33.4627,
  lng: 126.3095,
  signedAt: Date.now(),
  signature: "sig",
  ...extra,
});
const ID = placeRowId("kakao", "321");

let n = 0;
beforeEach(() => {
  n += 1;
});
const user = () => `sfm${n}`;

const liveItems = async (db: ReturnType<typeof openUserDb>) =>
  (await db.list_items.toArray()).filter((i) => i.deletedAt == null);

describe("savePlaceToList", () => {
  it("saves a new place with its source, and puts it in the chosen list", async () => {
    const db = openUserDb(user());
    const listId = await createList({ name: "카페", color: null });
    await expect(savePlaceToList({ result: result(), listId })).resolves.toBe(ID);
    expect((await db.places.get(ID))?.title).toBe("바다정원 카페");
    expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
    expect(await db.place_sources.where("placeId").equals(ID).count()).toBe(1);
    const items = await liveItems(db);
    expect(items.map((i) => [i.listId, i.placeId])).toEqual([[listId, ID]]);
  });

  it("doesn't save a place she already has a second time", async () => {
    const db = openUserDb(user());
    await savePlaceFromSearch(result());
    const mine = await db.user_places.get(userPlaceRowId(ID));
    const before = await db.outbox.count();
    const listId = await createList({ name: "카페", color: null });
    await savePlaceToList({ result: result(), listId });
    expect(await db.user_places.count()).toBe(1);
    expect(await db.user_places.get(userPlaceRowId(ID))).toEqual(mine);
    const placeWrites = (await db.outbox.toArray())
      .slice(before)
      .filter((e) => e.table === "places");
    expect(placeWrites).toEqual([]);
    expect((await liveItems(db)).map((i) => i.listId)).toEqual([listId]);
  });

  it("adds no second item to a list the place is already in", async () => {
    const db = openUserDb(user());
    const listId = await createList({ name: "카페", color: null });
    await savePlaceFromSearch(result());
    await addToList(listId, ID);
    const before = await db.outbox.count();
    await savePlaceToList({ result: result(), listId });
    expect(await liveItems(db)).toHaveLength(1);
    expect(await db.outbox.count()).toBe(before);
  });

  it("puts it in no list for listId null", async () => {
    const db = openUserDb(user());
    await createList({ name: "카페", color: null });
    await savePlaceToList({ result: result(), listId: null });
    expect(await db.list_items.count()).toBe(0);
    expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
  });

  it("changes nothing for a saved place with no list", async () => {
    const db = openUserDb(user());
    await savePlaceFromSearch(result());
    const before = await db.outbox.count();
    await expect(savePlaceToList({ result: result(), listId: null })).resolves.toBe(ID);
    expect(await db.outbox.count()).toBe(before);
  });

  it("creates one own list with the trimmed new name, holding the place", async () => {
    const db = openUserDb(user());
    await savePlaceToList({ result: result(), listId: null, newListName: " Cafés " });
    const lists = await db.lists.toArray();
    expect(lists.map((l) => [l.name, l.provider])).toEqual([["Cafés", null]]);
    expect((await liveItems(db)).map((i) => [i.listId, i.placeId])).toEqual([[lists[0]?.id, ID]]);
  });

  it("refuses a blank new list name and writes nothing", async () => {
    const db = openUserDb(user());
    await expect(
      savePlaceToList({ result: result(), listId: null, newListName: "   " }),
    ).rejects.toThrow();
    expect(await db.lists.count()).toBe(0);
    expect(await db.user_places.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("restores a place she once removed", async () => {
    const db = openUserDb(user());
    await savePlaceFromSearch(result());
    await db.user_places.update(userPlaceRowId(ID), { deletedAt: 5 });
    await savePlaceToList({ result: result(), listId: null });
    expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
    expect(await db.user_places.count()).toBe(1);
  });

  it("refuses a Kakao list or a missing one, leaving nothing half-way", async () => {
    const db = openUserDb(user());
    await db.lists.put({
      id: "l_kakao_9",
      provider: "kakao",
      externalId: "9",
      name: "Kakao",
      description: null,
      color: null,
      ownerName: null,
      removedAtProvider: null,
      providerSnapshotAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    for (const listId of ["l_kakao_9", "no-such-list"]) {
      await expect(savePlaceToList({ result: result(), listId })).rejects.toThrow();
    }
    expect(await db.user_places.count()).toBe(0);
    expect(await db.places.count()).toBe(0);
    expect(await db.list_items.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
