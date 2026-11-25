import { beforeEach, describe, expect, it } from "vitest";
import { openUserDb } from "./db";
import { placeStatesOf } from "./placeState";

let n = 0;
beforeEach(() => {
  n += 1;
});
const user = () => `ps${n}`;

const userPlace = (placeId: string, deletedAt: number | null) => ({
  id: `up_${placeId}`,
  placeId,
  savedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt,
});

const item = (listId: string, placeId: string, deletedAt: number | null = null) => ({
  id: `li_${listId}_${placeId}`,
  listId,
  placeId,
  position: 0,
  addedAt: 1,
  externalId: null,
  providerNote: null,
  providerColor: null,
  itemColor: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt,
});

describe("placeStatesOf", () => {
  it("says a place with a live user_places row is saved", async () => {
    const db = openUserDb(user());
    await db.user_places.put(userPlace("p_kakao_1", null));
    const states = await placeStatesOf(["p_kakao_1"]);
    expect(states.get("p_kakao_1")).toEqual({ saved: true, listIds: new Set() });
  });

  it("says a place she removed is not saved", async () => {
    const db = openUserDb(user());
    await db.user_places.put(userPlace("p_kakao_1", 5));
    expect((await placeStatesOf(["p_kakao_1"])).get("p_kakao_1")?.saved).toBe(false);
  });

  it("names the lists a place is live in, without counting it saved", async () => {
    const db = openUserDb(user());
    await db.list_items.bulkPut([
      item("l1", "p_kakao_1"),
      item("l2", "p_kakao_1", 9),
      item("l3", "p_kakao_2"),
    ]);
    const states = await placeStatesOf(["p_kakao_1"]);
    expect(states.get("p_kakao_1")).toEqual({ saved: false, listIds: new Set(["l1"]) });
  });

  it("answers an unknown place as not saved, in no list", async () => {
    openUserDb(user());
    const states = await placeStatesOf(["p_kakao_9", "p_kakao_8"]);
    expect(states.get("p_kakao_9")).toEqual({ saved: false, listIds: new Set() });
    expect(states.get("p_kakao_8")).toEqual({ saved: false, listIds: new Set() });
  });
});
