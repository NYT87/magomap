import type { ListItemRow, ListRow, PlaceLocationRow, PlaceRow } from "@magomap/domain";
import { describe, expect, it } from "vitest";
import { buildMarkers } from "./markers";

const place = (id: string): PlaceRow => ({
  id,
  title: id,
  address: null,
  roadAddress: null,
  addressSource: "import",
  category: null,
  phone: null,
  lat: 33.4,
  lng: 126.3,
  providerSnapshotAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});
const list = (
  id: string,
  name: string,
  provider: string | null,
  color: string | null = null,
): ListRow => ({
  id,
  provider,
  externalId: provider ? id : null,
  name,
  description: null,
  color,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});
const item = (
  listId: string,
  placeId: string,
  providerColor: string | null = null,
): ListItemRow => ({
  id: `${listId}:${placeId}`,
  listId,
  placeId,
  position: 0,
  addedAt: 0,
  externalId: null,
  providerNote: null,
  providerColor,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});
const moved: PlaceLocationRow = {
  id: "loc1",
  placeId: "p1",
  address: "옛",
  roadAddress: null,
  lat: 33.39,
  lng: 126.29,
  validFrom: 0,
  validUntil: 10,
  detectedBy: "import",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

const base = {
  places: [place("p1")],
  memberships: [item("own", "p1")],
  lists: [list("own", "빵", null, "#7A4E7E")],
  locations: [moved],
  roles: new Map([["own", "owner" as const]]),
  saved: new Set<string>(),
  visibleListIds: new Set(["own"]),
  showPrevious: true,
};

describe("buildMarkers", () => {
  it("adds a faded marker for each previous location, only when asked", () => {
    expect(
      buildMarkers(base)
        .map((m) => m.kind)
        .sort(),
    ).toEqual(["previous", "saved"]);
    expect(buildMarkers({ ...base, showPrevious: false }).map((m) => m.kind)).toEqual(["saved"]);
  });

  it("shows nothing for a place in hidden lists only", () => {
    expect(buildMarkers({ ...base, visibleListIds: new Set() })).toEqual([]);
  });

  it("colours a place by own lists first, then Kakao lists, then subscribed lists", () => {
    const lists = [
      list("own", "빵", null, "#7A4E7E"),
      list("kk", "카페", "kakao"),
      list("sub", "아내", "kakao"),
    ];
    const roles = new Map([
      ["own", "owner" as const],
      ["kk", "owner" as const],
      ["sub", "follower" as const],
    ]);
    const all = new Set(["own", "kk", "sub"]);
    const memberships = [item("sub", "p1", "05"), item("kk", "p1", "01"), item("own", "p1")];
    const color = (ms: ListItemRow[]) =>
      buildMarkers({
        ...base,
        lists,
        roles,
        memberships: ms,
        visibleListIds: all,
        showPrevious: false,
      })[0]?.color;
    expect(color(memberships)).toBe("#7A4E7E");
    expect(color(memberships.slice(0, 2))).toBe("#c8373e");
    expect(color(memberships.slice(0, 1))).toBe("#2464ad");
  });
});
