import { describe, expect, it, vi } from "vitest";
import { applyFocus, PLACE_ZOOM, wellInside } from "./applyFocus";

const point = { lat: 33.4, lng: 126.5 };
/** A map at `zoom` that reports whether a point sits well inside what's on screen. */
const adapter = (zoom: number, inView: boolean) => ({
  panTo: vi.fn(),
  fitTo: vi.fn(),
  getZoom: () => zoom,
  isWellInView: vi.fn(() => inView),
});

describe("applyFocus", () => {
  it("the place zoom is the close-up a search result gets (16)", () => {
    expect(PLACE_ZOOM).toBe(16);
  });

  it("zoomed out (below the place zoom): zooms in to the place and centres it", () => {
    const a = adapter(12, true);
    applyFocus(a, point);
    expect(a.fitTo).toHaveBeenCalledWith([point]);
    expect(a.panTo).not.toHaveBeenCalled();
  });

  it("zoomed in, and the place is on screen: the map doesn't move", () => {
    const a = adapter(16, true);
    applyFocus(a, point);
    expect(a.fitTo).not.toHaveBeenCalled();
    expect(a.panTo).not.toHaveBeenCalled();
    expect(a.isWellInView).toHaveBeenCalledWith(point);
  });

  it("zoomed in, and the place is off screen: moves to it, keeping the zoom", () => {
    const a = adapter(17, false);
    applyFocus(a, point);
    expect(a.panTo).toHaveBeenCalledWith(point);
    expect(a.fitTo).not.toHaveBeenCalled();
  });

  it("a search result that isn't saved is always brought close", () => {
    const a = adapter(18, true);
    applyFocus(a, { ...point, close: true });
    expect(a.fitTo).toHaveBeenCalledWith([point]);
    expect(a.panTo).not.toHaveBeenCalled();
  });
});

describe("wellInside", () => {
  const b = { south: 33, west: 126, north: 34, east: 127 };
  it("is true in the middle and false near an edge or outside", () => {
    expect(wellInside(b, { lat: 33.5, lng: 126.5 })).toBe(true);
    expect(wellInside(b, { lat: 33.1, lng: 126.5 })).toBe(false);
    expect(wellInside(b, { lat: 33.5, lng: 126.95 })).toBe(false);
    expect(wellInside(b, { lat: 35, lng: 126.5 })).toBe(false);
  });
});
