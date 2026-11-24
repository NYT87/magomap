import { decodeId } from "../decodeId";

/** `/places/:id` is a place over the map (a peek on a phone); `/places/:id/details` is its page. */
export function placeRouteOf(location: string): { id: string; details: boolean } | null {
  const match = /^\/places\/([^/]+?)(\/details)?\/?$/.exec(location);
  return match?.[1] ? { id: decodeId(match[1]), details: match[2] !== undefined } : null;
}

/**
 * True when opening another place from here should replace this entry in history: on a place's
 * peek, moving to another place is a switch (as in Kakao Map), so Back doesn't walk through each.
 */
export function switchesPlace(location: string): boolean {
  const route = placeRouteOf(location);
  return route !== null && !route.details;
}
