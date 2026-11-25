import type { ContextPress, MapAdapter } from "./MapAdapter";

/** A press at the map's centre: what the keyboard and the phone's Save button open the menu at. */
export function centrePress(map: MapAdapter, el: HTMLElement): ContextPress {
  const box = el.getBoundingClientRect();
  return {
    point: map.getCenter(),
    at: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
  };
}
