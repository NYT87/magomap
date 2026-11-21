import { describe, expect, it } from "vitest";
import { kakaoFavoritePoint, wcongnamulToLatLng } from "./wcongnamul";
import { OWNER_FIXTURES } from "./wcongnamul.fixtures";

const close = (actual: number | undefined, expected: number, within: number) => {
  expect(actual).toBeDefined();
  expect(Math.abs((actual as number) - expected)).toBeLessThan(within);
};

describe("wcongnamulToLatLng", () => {
  it("converts the published reference point", () => {
    const p = wcongnamulToLatLng(497278, 1128228);
    close(p?.lat, 37.5611523, 1e-5);
    close(p?.lng, 126.9876757, 1e-5);
  });

  it("matches the owner's Kakao SDK fixtures", () => {
    expect(OWNER_FIXTURES.length).toBeGreaterThan(0);
    for (const f of OWNER_FIXTURES) {
      const p = wcongnamulToLatLng(f.x, f.y);
      close(p?.lat, f.lat, 1e-5);
      close(p?.lng, f.lng, 1e-5);
    }
  });

  it("keeps negative coordinates", () => {
    const p = wcongnamulToLatLng(471350, -32433);
    close(p?.lat, 33.37661909, 1e-6);
    close(p?.lng, 126.87684594, 1e-6);
  });

  it("returns undefined for bad input", () => {
    for (const [x, y] of [
      [undefined, 1],
      [0, 0],
      ["a", 3],
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 1],
    ] as [unknown, unknown][]) {
      expect(wcongnamulToLatLng(x, y)).toBeUndefined();
    }
  });

  it("returns undefined outside Korea", () => {
    expect(wcongnamulToLatLng(5_000_000, 5_000_000)).toBeUndefined();
  });
});

describe("kakaoFavoritePoint", () => {
  it("prefers Kakao's lat/lon", () => {
    expect(kakaoFavoritePoint({ lat: 37.5, lon: 127.1, x: 1, y: 1 })).toEqual({
      lat: 37.5,
      lng: 127.1,
    });
  });

  it("falls back to x/y when lat/lon are missing, not numbers, or outside Korea", () => {
    const { x, y, lat, lng } = OWNER_FIXTURES[1] as (typeof OWNER_FIXTURES)[number];
    for (const own of [{}, { lat: "37.5", lon: "127.1" }, { lat: 10, lon: 10 }]) {
      const p = kakaoFavoritePoint({ ...own, x, y });
      close(p?.lat, lat, 1e-5);
      close(p?.lng, lng, 1e-5);
    }
  });

  it("is undefined with neither", () => {
    expect(kakaoFavoritePoint({})).toBeUndefined();
    expect(kakaoFavoritePoint({ lat: null, lon: null, x: 0, y: 0 })).toBeUndefined();
  });
});
