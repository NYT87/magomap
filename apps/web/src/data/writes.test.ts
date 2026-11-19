import type { PlaceLocationRow, SearchResult } from "@magomap/domain";
import { placeRowId } from "@magomap/domain/ids";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import type { OutboxEntry } from "./db";
import { openUserDb } from "./db";
import { locationAt, searchLocal } from "./queries";
import {
  addLink,
  addToList,
  addVisitNote,
  clearDraft,
  createList,
  editVisitNote,
  removeFromList,
  saveDraft,
  savePlaceFromSearch,
} from "./writes";

const result = (extra: Partial<SearchResult> = {}): SearchResult => ({
  provider: "kakao",
  externalId: "123",
  title: "바다빵집",
  address: "제주 애월읍",
  roadAddress: null,
  category: "베이커리",
  phone: null,
  lat: 33.46,
  lng: 126.31,
  signedAt: Date.now(),
  signature: "sig",
  ...extra,
});

let n = 0;
beforeEach(() => {
  n += 1;
});
const user = () => `w${n}`;

describe("local writes", () => {
  it("keeps an offline note and its outbox entry after reopening", async () => {
    let db = openUserDb(user());
    await addVisitNote("p_kakao_1", { visitedOn: "2026-11-19", body: "창가 자리" });
    db.close();
    db = openUserDb(user());
    expect((await db.visit_notes.toArray()).map((r) => r.body)).toEqual(["창가 자리"]);
    expect(await db.outbox.count()).toBe(1);
  });

  it("stamps an edit after a future updatedAt, so a slow clock still wins", async () => {
    const db = openUserDb(user());
    const id = await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    const future = Date.now() + 3_600_000;
    await db.visit_notes.update(id, { updatedAt: future });
    await editVisitNote(id, { body: "b" });
    const last = (await db.outbox.orderBy("seq").last()) as OutboxEntry;
    expect(last.clientUpdatedAt).toBe(future + 1);
  });

  it("marks an edited imported note as edited by the user", async () => {
    const db = openUserDb(user());
    await db.visit_notes.put({
      id: "kn_p_l",
      placeId: "p_kakao_1",
      visitedOn: null,
      body: "from kakao",
      origin: "import",
      originKey: "l_kakao_1",
      editedByUser: false,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    await editVisitNote("kn_p_l", { body: "mine now" });
    expect((await db.visit_notes.get("kn_p_l"))?.editedByUser).toBe(true);
  });

  it("saves a search result once, with its signature, and the same id each time", async () => {
    const db = openUserDb(user());
    const a = await savePlaceFromSearch(result());
    const b = await savePlaceFromSearch(result());
    expect(a).toBe(placeRowId("kakao", "123"));
    expect(b).toBe(a);
    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.row).toMatchObject({
      id: a,
      source: { provider: "kakao", externalId: "123", signature: "sig" },
    });
    expect(await db.user_places.count()).toBe(1);
  });

  it("adds a place to an own list once, and re-adding a removed one restores it", async () => {
    const db = openUserDb(user());
    const listId = await createList({ name: "빵", color: "#1F6F5C" });
    const first = await addToList(listId, "p_kakao_1");
    expect(await addToList(listId, "p_kakao_1")).toBe(first);
    expect(await db.list_items.count()).toBe(1);
    await removeFromList(first);
    expect((await db.list_items.get(first))?.deletedAt).not.toBeNull();
    await addToList(listId, "p_kakao_1");
    expect((await db.list_items.get(first))?.deletedAt).toBeNull();
  });

  it("refuses a link that isn't http(s), before it reaches the outbox", async () => {
    const db = openUserDb(user());
    await expect(
      addLink("p_kakao_1", { url: "javascript:alert(1)", title: null }),
    ).rejects.toThrow();
    expect(await db.outbox.count()).toBe(0);
  });

  it("keeps drafts across reopening, until cleared", async () => {
    let db = openUserDb(user());
    await saveDraft("new:p_kakao_1", { visitedOn: "2026-11-19", body: "반쯤 쓴 메모" });
    db.close();
    db = openUserDb(user());
    expect((await db.drafts.get("new:p_kakao_1"))?.body).toBe("반쯤 쓴 메모");
    await clearDraft("new:p_kakao_1");
    expect(await db.drafts.get("new:p_kakao_1")).toBeUndefined();
  });

  it("never recreates an account's database that another tab deleted", async () => {
    const name = `${user()}-gone`;
    const db = openUserDb(name);
    await saveDraft("k", { visitedOn: null, body: "a" });
    await Dexie.delete(`magomap-${name}`);
    await expect(saveDraft("k", { visitedOn: null, body: "late" }, db)).rejects.toThrow();
    expect(await Dexie.exists(`magomap-${name}`)).toBe(false);
  });

  it("keeps separate data per account", async () => {
    const a = openUserDb(`${user()}-a`);
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    const b = openUserDb(`${user()}-b`);
    expect(await b.outbox.count()).toBe(0);
    expect(await a.outbox.count()).toBe(1);
  });

  it("never writes location history itself", async () => {
    const db = openUserDb(user());
    await savePlaceFromSearch(result());
    await addVisitNote(placeRowId("kakao", "123"), { visitedOn: null, body: "x" });
    expect((await db.outbox.toArray()).some((e) => e.table === ("place_locations" as never))).toBe(
      false,
    );
  });
});

describe("queries", () => {
  it("finds a place by a word in one of its notes", async () => {
    const db = openUserDb(user());
    const id = await savePlaceFromSearch(result({ title: "Sea house" }));
    await addVisitNote(id, { visitedOn: null, body: "The bread was great" });
    expect(await searchLocal(db, "BREAD")).toEqual([id]);
  });

  it("tells which old location a date falls in", () => {
    const moved = Date.UTC(2026, 5, 1);
    const old: PlaceLocationRow = {
      id: "loc1",
      placeId: "p",
      address: "옛 주소",
      roadAddress: null,
      lat: 33,
      lng: 126,
      validFrom: Date.UTC(2025, 0, 1),
      validUntil: moved,
      detectedBy: "import",
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
    };
    expect(locationAt([old], moved - 86_400_000)?.id).toBe("loc1");
    expect(locationAt([old], moved + 86_400_000)).toBeNull();
  });
});
