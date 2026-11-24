import { decodeId } from "../decodeId";

/** `/places/:id` is a place over the map (a peek on a phone); `/places/:id/details` is its page. */
export function placeRouteOf(location: string): { id: string; details: boolean } | null {
  const match = /^\/places\/([^/]+?)(\/details)?\/?$/.exec(location);
  return match?.[1] ? { id: decodeId(match[1]), details: match[2] !== undefined } : null;
}
