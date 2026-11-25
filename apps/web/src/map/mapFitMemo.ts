import type { Bounds } from "./applyFocus";
import type { LatLng } from "./MapAdapter";

type Provider = "kakao" | "leaflet";
type Size = { w: number; h: number };

/**
 * Where the map settled after fitting the saved places last time: for which places (their
 * bounds), on which map, in a box of which size. The next visit opens the map right there, so
 * it doesn't draw a default view and then jump to the places (a layout shift on the Kakao map,
 * and the first tiles thrown away). Kept per account (deviceKeys.mapFit).
 */
export interface FitMemo {
  provider: Provider;
  bounds: Bounds;
  view: { center: LatLng; zoom: number };
  size: Size;
}

/** The map and box it's about to be drawn in. */
export interface Here {
  provider: Provider;
  size: Size;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  };
}

export function sameBounds(a: Bounds, b: Bounds | null, eps = 1e-7): boolean {
  if (!b) return false;
  return (
    Math.abs(a.south - b.south) < eps &&
    Math.abs(a.west - b.west) < eps &&
    Math.abs(a.north - b.north) < eps &&
    Math.abs(a.east - b.east) < eps
  );
}

// A fit is for a box: another map's zoom scale, or a turned or resized box, is another view.
const sameHere = (m: FitMemo, here: Here) =>
  m.provider === here.provider && m.size.w === here.size.w && m.size.h === here.size.h;

/** Where to open the map, if the remembered fit was made here. */
export function opensAt(m: FitMemo | null, here: Here): FitMemo["view"] | null {
  return m && sameHere(m, here) ? m.view : null;
}

/** Whether the map, opened at the remembered fit, already fits these places. */
export function stillFits(m: FitMemo | null, here: Here, bounds: Bounds | null): boolean {
  return !!m && sameHere(m, here) && sameBounds(m.bounds, bounds);
}

const finite = (...xs: unknown[]) => xs.every((x) => typeof x === "number" && Number.isFinite(x));

export function readFitMemo(key: string): FitMemo | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const m = JSON.parse(raw) as FitMemo;
    const { bounds: b, view: v, size: s } = m ?? {};
    if (
      (m.provider !== "kakao" && m.provider !== "leaflet") ||
      !b ||
      !v?.center ||
      !s ||
      !finite(b.south, b.west, b.north, b.east, v.center.lat, v.center.lng, v.zoom, s.w, s.h)
    )
      return null;
    return m;
  } catch {
    // Storage blocked or the value unreadable: open at the default view, as before.
    return null;
  }
}

export function writeFitMemo(key: string, m: FitMemo) {
  try {
    localStorage.setItem(key, JSON.stringify(m));
  } catch {
    // Storage blocked: the next visit fits again, as before.
  }
}
