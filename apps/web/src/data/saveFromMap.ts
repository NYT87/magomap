import type { SearchResult } from "@magomap/domain";
import {
  ownItemRowId,
  placeRowId,
  placeSourceRowId,
  userListRowId,
  userPlaceRowId,
} from "@magomap/domain/ids";
import { currentDb } from "./db";
import { notifyWrite } from "./events";
import { placeStatesOf } from "./placeState";
import { addToList, createList, deleteList, removeFromList, savePlaceFromSearch } from "./writes";

export interface SaveToListInput {
  result: SearchResult;
  /** One of her own lists, or null for no list. Ignored when `newListName` is given. */
  listId: string | null;
  /** A name for a new own list to put the place in. */
  newListName?: string;
}

type UndoTable = "places" | "user_places" | "place_sources" | "lists" | "user_lists" | "list_items";

/** What one save from the map did, enough to say so and to take it back. */
export interface SavedFromMap {
  placeId: string;
  /** The list the place went into (or was already in), null for none. */
  listId: string | null;
  listName: string | null;
  /** False when the place was already saved (and already in the list): nothing to undo. */
  changed: boolean;
  /** Each row the save wrote, as it was before (null: it didn't exist). */
  rows: { table: UndoTable; id: string; before: unknown }[];
  /** The outbox entries the save added. */
  outbox: number[];
  /** A list it created, and a list item it added (or restored). */
  createdListId: string | null;
  addedItemId: string | null;
}

/**
 * Saves a place found on the map and, when asked, puts it in one of her own lists (a new one
 * when named). A place she already has isn't saved again, and a list that already holds it
 * isn't added to. All of it is one local transaction: a failure leaves nothing half-way.
 * Resolves to what it did (see `undoSave`).
 */
export async function savePlaceToList(input: SaveToListInput): Promise<SavedFromMap> {
  const { result, listId, newListName } = input;
  const db = currentDb();
  const saved = await db.transaction("rw", db.tables, async (): Promise<SavedFromMap> => {
    if (newListName !== undefined && !newListName.trim()) throw new Error("blank list name");
    let listName: string | null = null;
    if (newListName === undefined && listId !== null) {
      const list = await db.lists.get(listId);
      // Only her own lists take a place from the map; Kakao lists stay read-only.
      if (!list || list.deletedAt != null || list.provider !== null) {
        throw new Error("not one of her lists");
      }
      listName = list.name;
    }
    const lastSeq = (await db.outbox.orderBy("seq").last())?.seq ?? 0;
    const placeId = placeRowId(result.provider, result.externalId);
    const rows: SavedFromMap["rows"] = [];
    const before = async (table: UndoTable, id: string) =>
      rows.push({ table, id, before: (await db.table(table).get(id)) ?? null });

    const was = (await placeStatesOf([placeId])).get(placeId);
    if (!was?.saved) {
      await before("places", placeId);
      await before("user_places", userPlaceRowId(placeId));
      await before("place_sources", placeSourceRowId(result.provider, result.externalId));
    }
    await savePlaceFromSearch(result);

    let target = listId;
    let createdListId: string | null = null;
    if (newListName !== undefined) {
      target = createdListId = await createList({ name: newListName, color: null });
      listName = newListName.trim();
      rows.push(
        { table: "lists", id: target, before: null },
        { table: "user_lists", id: userListRowId(target), before: null },
      );
    }
    let addedItemId: string | null = null;
    if (target !== null && !was?.listIds.has(target)) {
      addedItemId = ownItemRowId(target, placeId);
      await before("list_items", addedItemId);
      await addToList(target, placeId);
    }
    const outbox = (await db.outbox.where("seq").above(lastSeq).primaryKeys()) as number[];
    return {
      placeId,
      listId: target,
      listName,
      changed: rows.length > 0,
      rows,
      outbox,
      createdListId,
      addedItemId,
    };
  });
  return saved;
}

/**
 * Takes back exactly what a save from the map did, in one local transaction: the list item it
 * added, a list it created, and the place's saving when it saved it. While its changes haven't
 * been sent, they are simply unwritten. If they already went out, the place stays saved (the
 * server doesn't take saves back) and the item and list are removed the usual way.
 */
export async function undoSave(saved: SavedFromMap): Promise<void> {
  if (!saved.changed) return;
  const db = currentDb();
  await db.transaction("rw", db.tables, async () => {
    const pending = await db.outbox.bulkGet(saved.outbox);
    if (pending.every(Boolean)) {
      await db.outbox.bulkDelete(saved.outbox);
      for (const { table, id, before } of [...saved.rows].reverse()) {
        if (before === null) await db.table(table).delete(id);
        else await db.table(table).put(before);
      }
      return;
    }
    if (saved.addedItemId) await removeFromList(saved.addedItemId);
    if (saved.createdListId) await deleteList(saved.createdListId);
  });
  notifyWrite();
}
