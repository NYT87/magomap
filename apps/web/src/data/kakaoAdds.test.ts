// Pending adds of a place to one of her own Kakao lists (#83): written locally, shown with that
// list, cleared once a Kakao Map sync brings the place in.
import type { ListItemRow, ListRow, PlaceRow } from "@magomap/domain";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { buildMarkers } from "../map/markers";
import { dbName, openUserDb } from "./db";
import {
  kakaoListsFor,
  listPlaces,
  loadLibrary,
  placeMemberships,
  savedNotInList,
  shownItems,
} from "./queries";
import { addToKakaoList, clearDoneKakaoAdds, markKakaoAddsFailed, removeKakaoAdd } from "./writes";

let n = 0;
let db: ReturnType<typeof openUserDb>;
beforeEach(() => {
  n += 1;
  db = openUserDb(`ka${n}`);
});

const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
const kakaoList = (id: string, externalId: string): ListRow => ({
  id,
  provider: "kakao",
  externalId,
  name: `리스트 ${id}`,
  description: null,
  color: null,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: 1,
  ...base,
});
const place = (id: string): PlaceRow => ({
  id,
  title: `장소 ${id}`,
  address: null,
  roadAddress: null,
  addressSource: null,
  category: null,
  phone: null,
  lat: 33.4,
  lng: 126.3,
  providerSnapshotAt: null,
  ...base,
});
const item = (listId: string, placeId: string, extra: Partial<ListItemRow> = {}): ListItemRow => ({
  id: `i_${listId}_${placeId}`,
  listId,
  placeId,
  position: 0,
  addedAt: 1,
  externalId: "55",
  providerNote: null,
  providerColor: "01",
  removedAtProvider: null,
  providerSnapshotAt: 1,
  ...base,
  ...extra,
});

/** Her own Kakao list 9, her default list (folder 0), a list she follows, and three places. */
async function seed() {
  await db.lists.bulkPut([
    kakaoList("l_kakao_9", "9"),
    kakaoList("l_kakao_0~7", "0~7"),
    kakaoList("l_kakao_10", "10"),
  ]);
  await db.user_lists.bulkPut([
    { id: "ul_l_kakao_9", listId: "l_kakao_9", role: "owner", removedAt: null, ...base },
    { id: "ul_l_kakao_0~7", listId: "l_kakao_0~7", role: "owner", removedAt: null, ...base },
    { id: "ul_l_kakao_10", listId: "l_kakao_10", role: "follower", removedAt: null, ...base },
  ]);
  await db.places.bulkPut([place("p_kakao_1"), place("p_kakao_2"), place("p_naver_3")]);
  await db.place_sources.bulkPut([
    { id: "s_kakao_1", placeId: "p_kakao_1", provider: "kakao", externalId: "1", ...base },
    { id: "s_kakao_2", placeId: "p_kakao_2", provider: "kakao", externalId: "2", ...base },
    { id: "s_naver_3", placeId: "p_naver_3", provider: "naver", externalId: "3", ...base },
  ]);
  await db.user_places.bulkPut(
    ["p_kakao_1", "p_kakao_2", "p_naver_3"].map((p) => ({
      id: `up_${p}`,
      placeId: p,
      savedAt: 1,
      ...base,
    })),
  );
}

describe("pending adds to a Kakao list", () => {
  it("offers only her own Kakao lists (not folder 0, not followed), for a place with a Kakao id", async () => {
    await seed();
    const lib = await loadLibrary(db);
    expect(kakaoListsFor(lib, "p_kakao_1").map((l) => l.id)).toEqual(["l_kakao_9"]);
    expect(kakaoListsFor(lib, "p_naver_3")).toEqual([]);
  });

  it("writes one pending add, synced; again changes nothing; removing and adding restores it", async () => {
    await seed();
    const id = await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect(id).toBe("ka_l_kakao_9_p_kakao_1");
    expect(await addToKakaoList("l_kakao_9", "p_kakao_1")).toBe(id);
    expect(await db.kakao_adds.count()).toBe(1);
    expect((await db.outbox.toArray()).map((o) => [o.table, o.op])).toEqual([
      ["kakao_adds", "upsert"],
    ]);
    await removeKakaoAdd(id);
    expect((await db.kakao_adds.get(id))?.deletedAt).not.toBeNull();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect(await db.kakao_adds.get(id)).toMatchObject({ deletedAt: null, failed: null });
  });

  it("shows a pending place in its list, on the place and among the map's items, marked", async () => {
    await seed();
    await db.list_items.put(item("l_kakao_9", "p_kakao_2"));
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    const lib = await loadLibrary(db);
    const rows = listPlaces(lib, "l_kakao_9");
    expect(rows.map((r) => [r.placeId, r.pending?.id ?? null])).toEqual([
      ["p_kakao_2", null],
      ["p_kakao_1", "ka_l_kakao_9_p_kakao_1"],
    ]);
    expect(placeMemberships(lib, "p_kakao_1")).toMatchObject([
      { list: { id: "l_kakao_9" }, pending: { id: "ka_l_kakao_9_p_kakao_1" } },
    ]);
    expect(lib.pending.map((p) => p.item.placeId)).toEqual(["p_kakao_1"]);
    // Listed for the map and counts, so not "saved, not in a list".
    expect(shownItems(lib).map((i) => i.placeId)).toContain("p_kakao_1");
    expect(savedNotInList(lib)).not.toContain("p_kakao_1");
  });

  it("marks a list's pending adds as failed, and they show it", async () => {
    await seed();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    await markKakaoAddsFailed(["ka_l_kakao_9_p_kakao_1"], "list_missing");
    const lib = await loadLibrary(db);
    expect(placeMemberships(lib, "p_kakao_1")[0]?.pending?.failed).toBe("list_missing");
  });

  it("clears a pending add once the list holds the place, and keeps the others", async () => {
    await seed();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    await addToKakaoList("l_kakao_9", "p_kakao_2");
    // A sync brought p_kakao_1 in; p_kakao_2 is there only as removed at Kakao.
    await db.list_items.bulkPut([
      item("l_kakao_9", "p_kakao_1"),
      item("l_kakao_9", "p_kakao_2", { removedAtProvider: 5 }),
    ]);
    await clearDoneKakaoAdds(db);
    expect((await db.kakao_adds.get("ka_l_kakao_9_p_kakao_1"))?.deletedAt).not.toBeNull();
    expect((await db.kakao_adds.get("ka_l_kakao_9_p_kakao_2"))?.deletedAt).toBeNull();
    const deletes = (await db.outbox.toArray()).filter((o) => o.op === "delete");
    expect(deletes.map((o) => o.id)).toEqual(["ka_l_kakao_9_p_kakao_1"]);
  });

  it("asks afresh after a failure: the mark goes and the add is sent again", async () => {
    await seed();
    const id = await addToKakaoList("l_kakao_9", "p_kakao_1");
    await markKakaoAddsFailed([id], "list_missing");
    await db.outbox.clear();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect((await db.kakao_adds.get(id))?.failed).toBeNull();
    expect((await db.outbox.toArray()).map((o) => [o.table, o.op])).toEqual([
      ["kakao_adds", "upsert"],
    ]);
  });

  it("doesn't show a pending add twice once the list holds the place, nor one for a list she left", async () => {
    await seed();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    await db.list_items.put(item("l_kakao_9", "p_kakao_1"));
    expect((await loadLibrary(db)).pending).toEqual([]);
    expect(listPlaces(await loadLibrary(db), "l_kakao_9")).toHaveLength(1);
    await db.list_items.clear();
    await db.user_lists.update("ul_l_kakao_9", { removedAt: 5 });
    expect((await loadLibrary(db)).pending).toEqual([]);
  });

  it("doesn't offer a list removed from her Kakao Map", async () => {
    await seed();
    await db.lists.update("l_kakao_9", { removedAtProvider: 5 });
    expect(kakaoListsFor(await loadLibrary(db), "p_kakao_1")).toEqual([]);
  });

  it("puts a pending place on the map in its list, in the theme colour until Kakao Map has it", async () => {
    await seed();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    const lib = await loadLibrary(db);
    const markers = buildMarkers({
      places: [...lib.places.values()],
      memberships: shownItems(lib),
      lists: lib.lists,
      locations: lib.locations,
      roles: lib.roles,
      saved: new Set(),
      visibleListIds: new Set(["l_kakao_9"]),
      showPrevious: false,
    });
    expect(markers.filter((m) => m.kind === "saved").map((m) => m.id)).toEqual(["p_kakao_1"]);
  });

  it("an existing device's database gains the table and keeps its rows", async () => {
    const name = dbName(`kaold${n}`);
    const old = new Dexie(name);
    old.version(1).stores({
      places: "id",
      place_sources: "id, placeId",
      place_locations: "id, placeId",
      lists: "id",
      list_items: "id, listId, placeId",
      user_lists: "id, listId",
      user_places: "id, placeId",
      visit_notes: "id, placeId",
      links: "id, placeId",
      outbox: "++seq, mutationId, [table+id]",
      rejected: "mutationId",
      drafts: "key",
      meta: "key",
    });
    await old.table("places").put(place("p_kakao_1"));
    old.close();
    const upgraded = openUserDb(`kaold${n}`);
    expect(await upgraded.places.get("p_kakao_1")).toBeDefined();
    expect(await upgraded.kakao_adds.count()).toBe(0);
  });
});
