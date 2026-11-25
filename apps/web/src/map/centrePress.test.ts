import { describe, expect, it } from "vitest";
import { centrePress } from "./centrePress";
import type { MapAdapter } from "./MapAdapter";

describe("centrePress", () => {
  it("is the map's centre, on the map and on the screen", () => {
    const map = { getCenter: () => ({ lat: 33.4, lng: 126.5 }) } as MapAdapter;
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 600 }) as DOMRect;
    expect(centrePress(map, el)).toEqual({
      point: { lat: 33.4, lng: 126.5 },
      at: { x: 160, y: 320 },
    });
  });
});
