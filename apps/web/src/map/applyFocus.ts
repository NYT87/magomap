import type { LatLng, MapAdapter } from "./MapAdapter";

/** Where the map should look, and whether it may zoom in to get there. */
export type Focus = LatLng & { close?: boolean };

/**
 * Opening a saved place (from a marker or the list) only brings it to the middle of the map:
 * the zoom stays as it is, so the screen doesn't jump around under her finger. (Neither map
 * rotates, so the view stays north up.) A search result she hasn't saved is brought close
 * (`close`), because it may be nowhere near what's on screen.
 */
export function applyFocus(adapter: Pick<MapAdapter, "panTo" | "fitTo">, focus: Focus): void {
  const { close, ...point } = focus;
  if (close) adapter.fitTo([point]);
  else adapter.panTo(point);
}
