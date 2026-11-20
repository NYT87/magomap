import type { MapAdapter } from "./MapAdapter";

/** Replaces one map with another in the same element, keeping the centre and zoom. */
export function swapAdapter(old: MapAdapter, next: MapAdapter, el: HTMLElement): void {
  const view = { center: old.getCenter(), zoom: old.getZoom() };
  old.destroy();
  next.mount(el, view);
}
