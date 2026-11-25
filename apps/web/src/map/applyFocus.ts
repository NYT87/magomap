import type { LatLng, MapAdapter } from "./MapAdapter";

/** Where the map should look, and whether it may zoom in to get there. */
export type Focus = LatLng & { close?: boolean };

/** The close-up zoom (Leaflet scale) a place opens at: the zoom a search result is brought to. */
export const PLACE_ZOOM = 16;

/** How much of each edge doesn't count as "on screen": the search bar, buttons, card and nav. */
export const VIEW_INSET = 0.2;

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Whether `point` is inside `bounds` with `inset` (a fraction of the span) left on every side. */
export function wellInside(bounds: Bounds, point: LatLng, inset = VIEW_INSET): boolean {
  const dLat = (bounds.north - bounds.south) * inset;
  const dLng = (bounds.east - bounds.west) * inset;
  return (
    point.lat >= bounds.south + dLat &&
    point.lat <= bounds.north - dLat &&
    point.lng >= bounds.west + dLng &&
    point.lng <= bounds.east - dLng
  );
}

/**
 * Opening a place (from a marker, a list or search):
 * - zoomed out further than the place zoom, the map zooms in to it and centres it;
 * - closer than that, the map stays put when the place is already well on screen, and otherwise
 *   moves to it keeping the zoom, so the screen doesn't jump around under her finger.
 * A search result she hasn't saved (`close`) is always brought close. Neither map rotates, so
 * the view stays north up.
 */
export function applyFocus(
  adapter: Pick<MapAdapter, "panTo" | "fitTo" | "getZoom" | "isWellInView">,
  focus: Focus,
): void {
  const { close, ...point } = focus;
  if (close || adapter.getZoom() < PLACE_ZOOM) adapter.fitTo([point]);
  else if (!adapter.isWellInView(point)) adapter.panTo(point);
}
