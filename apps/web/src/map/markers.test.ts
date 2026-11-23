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

  describe("colouring a place in several lists", () => {
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
    const color = (ms: ListItemRow[]) =>
      buildMarkers({
        ...base,
        lists,
        roles,
        memberships: ms,
        visibleListIds: all,
        showPrevious: false,
      })[0]?.color;

    it("the Kakao colour wins over an own list's, whichever list is first", () => {
      expect(color([item("own", "p1"), item("kk", "p1", "01")])).toBe("#c8373e");
      expect(color([item("kk", "p1", "01"), item("own", "p1")])).toBe("#c8373e");
    });

    it("an owned Kakao list's colour comes before one from a list she follows", () => {
      expect(color([item("sub", "p1", "05"), item("kk", "p1", "01"), item("own", "p1")])).toBe(
        "#c8373e",
      );
      expect(color([item("sub", "p1", "05"), item("own", "p1")])).toBe("#2464ad");
    });

    it("an own list's colour shows when no Kakao list gives the place one", () => {
      expect(color([item("own", "p1")])).toBe("#7A4E7E");
      // A Kakao item with no colour code, or one this app doesn't know, doesn't hide it.
      expect(color([item("kk", "p1"), item("own", "p1")])).toBe("#7A4E7E");
      expect(color([item("kk", "p1", "99"), item("own", "p1")])).toBe("#7A4E7E");
    });

    it("a Kakao list alone with no colour code falls back to the theme colour", () => {
      expect(color([item("kk", "p1")])).toBe("var(--color-pine)");
    });
  });
});

describe("buildMarkers: the selected place", () => {
  it("marks the selected place's pin", () => {
    const plain = buildMarkers({ ...base, showPrevious: false });
    const marked = buildMarkers({ ...base, showPrevious: false, selectedPlaceId: "p1" });
    const selected = marked.filter((m) => m.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.kind).toBe("saved");
    expect(selected[0]?.placeId).toBe("p1");
    expect(selected[0]?.color).toBe(plain[0]?.color);
  });

  it("never marks previous locations or hidden places", () => {
    const withPrev = buildMarkers({ ...base, selectedPlaceId: "p1" });
    expect(withPrev.filter((m) => m.kind === "previous").every((m) => !m.selected)).toBe(true);
    const hidden = buildMarkers({ ...base, visibleListIds: new Set(), selectedPlaceId: "p1" });
    expect(hidden.some((m) => m.selected)).toBe(false);
  });

  it("has no selection without an id", () => {
    expect(buildMarkers(base).some((m) => m.selected)).toBe(false);
  });
});
