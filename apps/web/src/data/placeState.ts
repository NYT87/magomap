import { currentDb } from "./db";

export interface PlaceState {
  /** She has it among her places (a live user_places row; a removed one doesn't count). */
  saved: boolean;
  /** The lists it is live in. */
  listIds: Set<string>;
}

/** What she already has of each place, read from the device. */
export async function placeStatesOf(placeIds: string[]): Promise<Map<string, PlaceState>> {
  const db = currentDb();
  const [mine, items] = await Promise.all([
    db.user_places.where("placeId").anyOf(placeIds).toArray(),
    db.list_items.where("placeId").anyOf(placeIds).toArray(),
  ]);
  const states = new Map<string, PlaceState>(
    placeIds.map((id) => [id, { saved: false, listIds: new Set<string>() }]),
  );
  for (const row of mine) {
    const state = states.get(row.placeId);
    if (state && row.deletedAt == null) state.saved = true;
  }
  for (const item of items) {
    const state = states.get(item.placeId);
    if (state && item.deletedAt == null && item.removedAtProvider == null) {
      state.listIds.add(item.listId);
    }
  }
  return states;
}
