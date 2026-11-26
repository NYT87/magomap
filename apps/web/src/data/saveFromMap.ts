import type { SearchResult } from "@magomap/domain";
import {
  kakaoAddRowId,
  ownItemRowId,
  placeRowId,
  placeSourceRowId,
  userListRowId,
  userPlaceRowId,
} from "@magomap/domain/ids";
import { currentDb } from "./db";
import { notifyWrite } from "./events";
import { placeStatesOf } from "./placeState";
import { isKakaoPlaceKey, kakaoTargets, loadLibrary } from "./queries";
import {
  addToKakaoList,
  addToList,
  createList,
  deleteList,
  removeFromList,
  removeKakaoAdd,
  savePlaceFromSearch,
} from "./writes";

export interface SaveToListInput {
  result: SearchResult;
  /**
   * One of her own lists, one of her own Kakao lists (the place then waits to be added in Kakao
   * Map), or null for no list. Ignored when `newListName` is given.
   */
  listId: string | null;
  /** A name for a new own list to put the place in. */
  newListName?: string;
}

type UndoTable =
  | "places"
  | "user_places"
  | "place_sources"
  | "lists"
  | "user_lists"
  | "list_items"
  | "kakao_adds";

/** What one save from the map did, enough to say so and to take it back. */
export interface SavedFromMap {
  placeId: string;
  /** The list the place went into (or was already in), null for none. */
  listId: string | null;
  listName: string | null;
  /** False when the place was already saved (and already in the list): nothing to undo. */
  changed: boolean;
  /** Each row the save wrote: as it was before (null: it didn't exist), and the updatedAt it wrote. */
  rows: { table: UndoTable; id: string; before: unknown; wrote: number | null }[];
  /** The list items about the place or a list it created, as the save left them (id: updatedAt). */
  related: Record<string, number>;
  /** The outbox entries the save added. */
  outbox: number[];
  /** A list it created, and a list item it added (or restored). */
  createdListId: string | null;
  addedItemId: string | null;
  /** A pending add to one of her Kakao lists it wrote (or asked afresh). */
  kakaoAddId: string | null;
}

/** The list items about a place or in a list, by id, with their updatedAt. */
async function relatedItems(placeId: string, listId: string | null) {
  const db = currentDb();
  const items = [
    ...(await db.list_items.where("placeId").equals(placeId).toArray()),
    ...(listId ? await db.list_items.where("listId").equals(listId).toArray() : []),
  ];
  return Object.fromEntries(items.map((i) => [i.id, i.updatedAt]));
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
  const updatedAtOf = async (table: UndoTable, id: string) =>
    ((await db.table(table).get(id)) as { updatedAt?: number } | undefined)?.updatedAt;
  const saved = await db.transaction("rw", db.tables, async (): Promise<SavedFromMap> => {
    if (newListName !== undefined && !newListName.trim()) throw new Error("blank list name");
    let listName: string | null = null;
    let kakaoList = false;
    if (newListName === undefined && listId !== null) {
      const list = await db.lists.get(listId);
      if (!list || list.deletedAt != null) throw new Error("not one of her lists");
      if (list.provider !== null) {
        // One of her own Kakao lists, for a place Kakao Map can add by its id: it waits to be
        // added there. Any other provider list stays read-only.
        const target = kakaoTargets(await loadLibrary(db)).some((l) => l.id === listId);
        if (!target || result.provider !== "kakao" || !isKakaoPlaceKey(result.externalId)) {
          throw new Error("not one of her lists");
        }
        kakaoList = true;
      }
      listName = list.name;
    }
    const lastSeq = (await db.outbox.orderBy("seq").last())?.seq ?? 0;
    const placeId = placeRowId(result.provider, result.externalId);
    const rows: SavedFromMap["rows"] = [];
    const before = async (table: UndoTable, id: string) =>
      rows.push({ table, id, before: (await db.table(table).get(id)) ?? null, wrote: null });

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
        { table: "lists", id: target, before: null, wrote: null },
        { table: "user_lists", id: userListRowId(target), before: null, wrote: null },
      );
    }
    let addedItemId: string | null = null;
    let kakaoAddId: string | null = null;
    if (kakaoList && target !== null && !was?.listIds.has(target)) {
      kakaoAddId = kakaoAddRowId(target, placeId);
      const asked = await db.kakao_adds.get(kakaoAddId);
      if (!asked || asked.deletedAt != null || asked.failed != null) {
        await before("kakao_adds", kakaoAddId);
        await addToKakaoList(target, placeId);
      } else {
        kakaoAddId = null;
      }
    } else if (target !== null && !was?.listIds.has(target)) {
      addedItemId = ownItemRowId(target, placeId);
      await before("list_items", addedItemId);
      await addToList(target, placeId);
    }
    for (const row of rows) row.wrote = (await updatedAtOf(row.table, row.id)) ?? null;
    const related = await relatedItems(placeId, createdListId);
    const outbox = (await db.outbox.where("seq").above(lastSeq).primaryKeys()) as number[];
    return {
      placeId,
      listId: target,
      listName,
      changed: rows.length > 0,
      rows,
      related,
      outbox,
      createdListId,
      addedItemId,
      kakaoAddId,
    };
  });
  return saved;
}

/**
 * Takes back what a save from the map did, in one local transaction, and only that.
 *
 * While nothing else has touched what it wrote (each row still as the save left it, nothing
 * written since about the place, its rows or a list it created) and none of it has been sent,
 * its changes are simply unwritten: the place's saving too. Otherwise the safe way: the list item
 * it added is removed, a list it created is deleted if it is still empty and unchanged, and the
 * place stays saved (the server doesn't take saves back, and later changes may rely on it).
 * Resolves to whether the place was unsaved.
 */
export async function undoSave(saved: SavedFromMap): Promise<{ unsaved: boolean }> {
  if (!saved.changed) return { unsaved: false };
  const db = currentDb();
  const unsaved = await db.transaction("rw", db.tables, async () => {
    const untouched = async () => {
      const pending = await db.outbox.bulkGet(saved.outbox);
      if (!pending.every(Boolean)) return false;
      for (const row of saved.rows) {
        const now = (await db.table(row.table).get(row.id)) as { updatedAt?: number } | undefined;
        if ((now?.updatedAt ?? null) !== row.wrote) return false;
      }
      // Anything written after the save about its rows, its place or a list it created.
      const last = Math.max(0, ...saved.outbox);
      const written = new Set(saved.rows.map((r) => `${r.table}:${r.id}`));
      const later = await db.outbox.where("seq").above(last).toArray();
      for (const e of later) {
        const row = e.row as { placeId?: string; listId?: string } | undefined;
        if (written.has(`${e.table}:${e.id}`)) return false;
        if (row?.placeId === saved.placeId) return false;
        if (saved.createdListId && row?.listId === saved.createdListId) return false;
      }
      // List items about the place or the new list that came another way (another tab, a pull).
      const now = await relatedItems(saved.placeId, saved.createdListId);
      const keys = Object.keys(now);
      return (
        keys.length === Object.keys(saved.related).length &&
        keys.every((id) => saved.related[id] === now[id])
      );
    };

    if (await untouched()) {
      await db.outbox.bulkDelete(saved.outbox);
      for (const { table, id, before } of [...saved.rows].reverse()) {
        if (before === null) await db.table(table).delete(id);
        else await db.table(table).put(before);
      }
      return saved.rows.some((r) => r.table === "user_places");
    }

    if (saved.addedItemId) {
      const item = await db.list_items.get(saved.addedItemId);
      if (item && item.deletedAt == null) await removeFromList(saved.addedItemId);
    }
    if (saved.kakaoAddId) {
      const add = await db.kakao_adds.get(saved.kakaoAddId);
      if (add && add.deletedAt == null) await removeKakaoAdd(saved.kakaoAddId);
    }
    if (saved.createdListId) {
      const list = await db.lists.get(saved.createdListId);
      const wrote = saved.rows.find((r) => r.table === "lists")?.wrote;
      const others = (
        await db.list_items.where("listId").equals(saved.createdListId).toArray()
      ).filter((i) => i.deletedAt == null);
      if (list && list.deletedAt == null && list.updatedAt === wrote && others.length === 0) {
        await deleteList(saved.createdListId);
      }
    }
    return false;
  });
  notifyWrite();
  return { unsaved };
}
