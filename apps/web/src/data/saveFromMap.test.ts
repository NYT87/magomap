import type { SearchResult } from "@magomap/domain";
import { placeRowId, userPlaceRowId } from "@magomap/domain/ids";
import { beforeEach, describe, expect, it } from "vitest";
import { openUserDb } from "./db";
import { savePlaceToList, undoSave } from "./saveFromMap";
import { addToList, addVisitNote, createList, removeFromList, savePlaceFromSearch } from "./writes";

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
    await expect(savePlaceToList({ result: result(), listId })).resolves.toMatchObject({
      placeId: ID,
      listId,
      listName: "카페",
    });
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
    await expect(savePlaceToList({ result: result(), listId: null })).resolves.toMatchObject({
      placeId: ID,
      listId: null,
      listName: null,
    });
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

  /** Her own Kakao list 9 (owner), as a Kakao Map sync leaves it. */
  async function herKakaoList(db: ReturnType<typeof openUserDb>, role: "owner" | "follower") {
    await db.lists.put({
      id: "l_kakao_9",
      provider: "kakao",
      externalId: "9",
      name: "제주",
      description: null,
      color: null,
      ownerName: null,
      removedAtProvider: null,
      providerSnapshotAt: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    await db.user_lists.put({
      id: "ul_l_kakao_9",
      listId: "l_kakao_9",
      role,
      removedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
  }

  it("saves to her own Kakao list as a pending add, never as a list item", async () => {
    const db = openUserDb(user());
    await herKakaoList(db, "owner");
    const saved = await savePlaceToList({ result: result(), listId: "l_kakao_9" });
    expect(saved).toMatchObject({
      listId: "l_kakao_9",
      listName: "제주",
      kakaoAddId: `ka_l_kakao_9_${ID}`,
    });
    expect(await liveItems(db)).toEqual([]);
    expect(await db.kakao_adds.get(`ka_l_kakao_9_${ID}`)).toMatchObject({
      deletedAt: null,
      failed: null,
    });
    expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
  });

  it("undoes a save to her Kakao list: no place, no pending add, nothing to send", async () => {
    const db = openUserDb(user());
    await herKakaoList(db, "owner");
    const saved = await savePlaceToList({ result: result(), listId: "l_kakao_9" });
    await undoSave(saved);
    expect(await db.kakao_adds.count()).toBe(0);
    expect(await db.places.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("once sent, undo cancels the pending add and keeps the place saved", async () => {
    const db = openUserDb(user());
    await herKakaoList(db, "owner");
    const saved = await savePlaceToList({ result: result(), listId: "l_kakao_9" });
    await db.outbox.clear();
    await undoSave(saved);
    expect((await db.kakao_adds.get(`ka_l_kakao_9_${ID}`))?.deletedAt).not.toBeNull();
    expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
  });

  it("refuses a Kakao list she follows, and a place Kakao Map can't add by id", async () => {
    const db = openUserDb(user());
    await herKakaoList(db, "follower");
    await expect(savePlaceToList({ result: result(), listId: "l_kakao_9" })).rejects.toThrow();
    await db.user_lists.update("ul_l_kakao_9", { role: "owner" });
    await expect(
      savePlaceToList({ result: result({ provider: "naver" }), listId: "l_kakao_9" }),
    ).rejects.toThrow();
    expect(await db.places.count()).toBe(0);
    expect(await db.kakao_adds.count()).toBe(0);
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

/** Every row an undo could touch, and the outbox, as plain data. */
async function snapshot(db: ReturnType<typeof openUserDb>) {
  const tables = [
    "places",
    "user_places",
    "place_sources",
    "lists",
    "user_lists",
    "list_items",
    "kakao_adds",
  ];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await db.table(t).toArray();
  out.outbox = await db.outbox.toArray();
  return out;
}

describe("undoSave", () => {
  it("takes back a new place in a new list: no place, no list, nothing to send", async () => {
    const db = openUserDb(user());
    const before = await snapshot(db);
    const saved = await savePlaceToList({ result: result(), listId: null, newListName: "Cafés" });
    expect(saved.listName).toBe("Cafés");
    expect(saved.listId).not.toBeNull();
    expect(saved.changed).toBe(true);
    await expect(undoSave(saved)).resolves.toEqual({ unsaved: true });
    expect(await snapshot(db)).toEqual(before);
  });

  it("takes a saved place back out of the list it was added to, and only that", async () => {
    const db = openUserDb(user());
    const listId = await createList({ name: "카페", color: null });
    await savePlaceFromSearch(result());
    const before = await snapshot(db);
    const saved = await savePlaceToList({ result: result(), listId });
    expect(await liveItems(db)).toHaveLength(1);
    await expect(undoSave(saved)).resolves.toEqual({ unsaved: false });
    expect(await snapshot(db)).toEqual(before);
    // Still saved, as it was.
    expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
  });

  it("takes back a membership it restored, back to removed", async () => {
    const db = openUserDb(user());
    const listId = await createList({ name: "카페", color: null });
    await savePlaceFromSearch(result());
    await removeFromList(await addToList(listId, ID));
    const before = await snapshot(db);
    await undoSave(await savePlaceToList({ result: result(), listId }));
    expect(await snapshot(db)).toEqual(before);
  });

  it("has nothing to undo when the place was already in the list", async () => {
    const db = openUserDb(user());
    const listId = await createList({ name: "카페", color: null });
    await savePlaceFromSearch(result());
    await addToList(listId, ID);
    const before = await snapshot(db);
    const saved = await savePlaceToList({ result: result(), listId });
    expect(saved.changed).toBe(false);
    await undoSave(saved);
    expect(await snapshot(db)).toEqual(before);
  });

  it("leaves other changes alone", async () => {
    const db = openUserDb(user());
    const saved = await savePlaceToList({ result: result(), listId: null, newListName: "Cafés" });
    const other = await createList({ name: "Later", color: null });
    await undoSave(saved);
    expect((await db.lists.get(other))?.name).toBe("Later");
    expect((await db.outbox.toArray()).map((e) => e.id)).toEqual([other]);
  });

  it("when the save already went out, takes the place out of the list and the list away", async () => {
    const db = openUserDb(user());
    const saved = await savePlaceToList({ result: result(), listId: null, newListName: "Cafés" });
    // As if pushed.
    await db.outbox.clear();
    await expect(undoSave(saved)).resolves.toEqual({ unsaved: false });
    expect(await liveItems(db)).toEqual([]);
    expect((await db.lists.get(saved.listId as string))?.deletedAt).not.toBeNull();
    const sent = (await db.outbox.toArray()).map((e) => [e.table, e.op]);
    expect(sent).toEqual(
      expect.arrayContaining([
        ["list_items", "delete"],
        ["lists", "delete"],
      ]),
    );
  });

  it("unsaves a place she only had through a list, leaving that list's item", async () => {
    const db = openUserDb(user());
    const listId = await createList({ name: "Shared", color: null });
    await savePlaceFromSearch(result());
    await addToList(listId, ID);
    // In a list, but not among her places.
    await db.user_places.delete(userPlaceRowId(ID));
    const before = await snapshot(db);
    const saved = await savePlaceToList({ result: result(), listId: null });
    await expect(undoSave(saved)).resolves.toEqual({ unsaved: true });
    expect(await snapshot(db)).toEqual(before);
  });

  describe("when something else changed in between, it keeps that and the place", () => {
    const live = (id: string | null) => async (db: ReturnType<typeof openUserDb>) =>
      (await db.list_items.toArray()).filter((i) => i.listId === id && i.deletedAt == null);

    it("a note written for the place", async () => {
      const db = openUserDb(user());
      const saved = await savePlaceToList({ result: result(), listId: null, newListName: "L" });
      const note = await addVisitNote(ID, { visitedOn: null, body: "lovely" });
      await expect(undoSave(saved)).resolves.toEqual({ unsaved: false });
      expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
      expect(await db.places.get(ID)).toBeDefined();
      expect((await db.visit_notes.get(note))?.body).toBe("lovely");
      expect((await db.outbox.toArray()).some((e) => e.id === note)).toBe(true);
      // What only the save made is still taken back.
      expect(await live(saved.listId)(db)).toEqual([]);
      expect((await db.lists.get(saved.listId as string))?.deletedAt).not.toBeNull();
    });

    it("the place added to another list", async () => {
      const db = openUserDb(user());
      const saved = await savePlaceToList({ result: result(), listId: null });
      const other = await createList({ name: "Other", color: null });
      await addToList(other, ID);
      await expect(undoSave(saved)).resolves.toEqual({ unsaved: false });
      expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
      expect(await live(other)(db)).toHaveLength(1);
      // Nothing waiting to be sent refers to a place that's gone.
      const pending = await db.outbox.toArray();
      for (const e of pending) {
        const placeId = (e.row as { placeId?: string } | undefined)?.placeId;
        if (placeId) expect(await db.places.get(placeId)).toBeDefined();
      }
    });

    it("another place added to the list it created", async () => {
      const db = openUserDb(user());
      const saved = await savePlaceToList({ result: result(), listId: null, newListName: "L" });
      const second = await savePlaceFromSearch(result({ externalId: "999", title: "Two" }));
      await addToList(saved.listId as string, second);
      await undoSave(saved);
      // Its own item goes; the list, holding another place, stays.
      expect((await live(saved.listId)(db)).map((i) => i.placeId)).toEqual([second]);
      expect((await db.lists.get(saved.listId as string))?.deletedAt).toBeNull();
    });

    it("a row the server sent in between", async () => {
      const db = openUserDb(user());
      const saved = await savePlaceToList({ result: result(), listId: null, newListName: "L" });
      const place = await db.places.get(ID);
      await db.places.put({
        ...(place as NonNullable<typeof place>),
        title: "Renamed",
        updatedAt: Date.now() + 5_000,
      });
      await expect(undoSave(saved)).resolves.toEqual({ unsaved: false });
      expect((await db.places.get(ID))?.title).toBe("Renamed");
      expect((await db.user_places.get(userPlaceRowId(ID)))?.deletedAt).toBeNull();
      expect(await live(saved.listId)(db)).toEqual([]);
    });

    it("a list it created, renamed in between, isn't deleted", async () => {
      const db = openUserDb(user());
      const saved = await savePlaceToList({ result: result(), listId: null, newListName: "L" });
      const { editList } = await import("./writes");
      await editList(saved.listId as string, { name: "Kept" });
      await undoSave(saved);
      expect((await db.lists.get(saved.listId as string))?.deletedAt).toBeNull();
      expect(await live(saved.listId)(db)).toEqual([]);
    });
  });
});
