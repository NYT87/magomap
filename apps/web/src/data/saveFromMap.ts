import type { SearchResult } from "@magomap/domain";
import { currentDb } from "./db";
import { placeStatesOf } from "./placeState";
import { addToList, createList, savePlaceFromSearch } from "./writes";

export interface SaveToListInput {
  result: SearchResult;
  /** One of her own lists, or null for no list. Ignored when `newListName` is given. */
  listId: string | null;
  /** A name for a new own list to put the place in. */
  newListName?: string;
}

/**
 * Saves a place found on the map and, when asked, puts it in one of her own lists (a new one
 * when named). A place she already has isn't saved again, and a list that already holds it
 * isn't added to. All of it is one local transaction: a failure leaves nothing half-way.
 * Resolves to the place id.
 */
export function savePlaceToList(input: SaveToListInput): Promise<string> {
  const { result, listId, newListName } = input;
  const db = currentDb();
  return db.transaction("rw", db.tables, async () => {
    if (newListName !== undefined && !newListName.trim()) throw new Error("blank list name");
    if (newListName === undefined && listId !== null) {
      const list = await db.lists.get(listId);
      // Only her own lists take a place from the map; Kakao lists stay read-only.
      if (!list || list.deletedAt != null || list.provider !== null) {
        throw new Error("not one of her lists");
      }
    }
    const placeId = await savePlaceFromSearch(result);
    const target =
      newListName !== undefined ? await createList({ name: newListName, color: null }) : listId;
    if (target === null) return placeId;
    const state = (await placeStatesOf([placeId])).get(placeId);
    if (!state?.listIds.has(target)) await addToList(target, placeId);
    return placeId;
  });
}
