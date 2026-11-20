import type { MapAdapter } from "./MapAdapter";

/**
 * Replaces one map with another in the same element: same centre and zoom, a fit the old one
 * hadn't done yet, and the "my location" dot (without moving the map again).
 */
export function swapAdapter(old: MapAdapter, next: MapAdapter, el: HTMLElement): void {
  const view = { center: old.getCenter(), zoom: old.getZoom() };
  const fit = old.pendingFit();
  const me = old.myLocation();
  old.destroy();
  next.mount(el, view);
  if (me) next.showMyLocation(me, { recenter: false });
  if (fit) next.fitTo(fit);
}
