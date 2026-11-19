import { describe, expect, it } from "vitest";
import { distanceMeters, isLocationMove, type LocationFields, mergeLocation } from "./location";

const LAT = 37.5611523;
const LNG = 126.9876757;
const seoul: LocationFields = {
  lat: LAT,
  lng: LNG,
  address: "서울 중구 명동길 14",
  roadAddress: "서울 중구 명동길 14",
  addressSource: "search",
};
// 1 degree of latitude ≈ 111,320 m
const north = (m: number) => ({ lat: LAT + m / 111_320, lng: LNG });

describe("distanceMeters", () => {
  it("measures about 50 m for a 50 m shift north", () => {
    expect(distanceMeters({ lat: LAT, lng: LNG }, north(50))).toBeCloseTo(50, 0);
  });
});

describe("isLocationMove", () => {
  it("treats a 10 m shift as no move", () => {
    expect(isLocationMove(seoul, north(10))).toBe(false);
  });

  it("treats a 50 m shift as a move", () => {
    expect(isLocationMove(seoul, north(50))).toBe(true);
  });

  it("ignores a different address when both sides have coordinates", () => {
    expect(isLocationMove(seoul, { lat: seoul.lat, lng: seoul.lng, address: "다른 주소" })).toBe(
      false,
    );
  });

  it("treats a new address from the same source as a move when coordinates are missing", () => {
    const current = { ...seoul, lat: null, lng: null };
    expect(isLocationMove(current, { address: "부산 해운대구", addressSource: "search" })).toBe(
      true,
    );
  });

  it("ignores a new address from a different source", () => {
    const current = { ...seoul, lat: null, lng: null };
    expect(isLocationMove(current, { address: "부산 해운대구", addressSource: "import" })).toBe(
      false,
    );
  });

  it("treats filling in coordinates for the first time as no move", () => {
    const current = { ...seoul, lat: null, lng: null };
    expect(isLocationMove(current, { lat: 35.1, lng: 129.1 })).toBe(false);
  });

  it("treats an undefined incoming lat as no move", () => {
    expect(isLocationMove(seoul, { lat: undefined, lng: undefined })).toBe(false);
  });
});

describe("mergeLocation", () => {
  it("never replaces a value with null or undefined", () => {
    expect(mergeLocation(seoul, { lat: null, address: undefined, roadAddress: null })).toEqual(
      seoul,
    );
  });

  it("takes new non-null values", () => {
    const next = mergeLocation(seoul, { ...north(100), address: "새 주소" });
    expect(next.lat).toBe(north(100).lat);
    expect(next.address).toBe("새 주소");
    expect(next.roadAddress).toBe(seoul.roadAddress);
  });
});
