import { afterEach, describe, expect, it } from "vitest";
import {
  boundsOf,
  type FitMemo,
  opensAt,
  readFitMemo,
  sameBounds,
  stillFits,
  writeFitMemo,
} from "./mapFitMemo";

const KEY = "mm.mapFit.222";
const memo: FitMemo = {
  provider: "kakao",
  bounds: { south: 33.2, west: 126.2, north: 37.6, east: 127.1 },
  view: { center: { lat: 35.4, lng: 126.65 }, zoom: 8 },
  size: { w: 390, h: 700 },
};
const here = { provider: "kakao" as const, size: { w: 390, h: 700 } };

afterEach(() => localStorage.clear());

describe("the map's remembered fit", () => {
  it("bounds a set of points, and has none for no points", () => {
    expect(
      boundsOf([
        { lat: 33.2, lng: 127.1 },
        { lat: 37.6, lng: 126.2 },
      ]),
    ).toEqual(memo.bounds);
    expect(boundsOf([])).toBeNull();
  });

  it("tells the same places' bounds from moved ones", () => {
    expect(sameBounds(memo.bounds, { ...memo.bounds })).toBe(true);
    expect(sameBounds(memo.bounds, { ...memo.bounds, north: 37.7 })).toBe(false);
    expect(sameBounds(memo.bounds, null)).toBe(false);
  });

  it("is kept across visits, per account", () => {
    writeFitMemo(KEY, memo);
    expect(readFitMemo(KEY)).toEqual(memo);
    expect(readFitMemo("mm.mapFit.111")).toBeNull();
  });

  it("is ignored when missing or not what was written", () => {
    expect(readFitMemo(KEY)).toBeNull();
    localStorage.setItem(KEY, "{not json");
    expect(readFitMemo(KEY)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ ...memo, view: { zoom: "8" } }));
    expect(readFitMemo(KEY)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ ...memo, size: undefined }));
    expect(readFitMemo(KEY)).toBeNull();
  });

  it("opens the map only on the same map, in a box of the same size", () => {
    expect(opensAt(memo, here)).toEqual(memo.view);
    expect(opensAt(memo, { ...here, provider: "leaflet" })).toBeNull();
    // Turned sideways, or a wider window: that view no longer fits the places.
    expect(opensAt(memo, { ...here, size: { w: 700, h: 390 } })).toBeNull();
    expect(opensAt(null, here)).toBeNull();
  });

  it("spares a fit only for the same places, map and box", () => {
    expect(stillFits(memo, here, { ...memo.bounds })).toBe(true);
    expect(stillFits(memo, here, { ...memo.bounds, east: 128 })).toBe(false);
    expect(stillFits(memo, { ...here, size: { w: 1440, h: 900 } }, memo.bounds)).toBe(false);
    expect(stillFits(null, here, memo.bounds)).toBe(false);
  });
});
