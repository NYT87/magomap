// Every local change: the row and its outbox entry in one Dexie transaction.
import {
  type ClientWritableTable,
  type LinkRow,
  type ListItemRow,
  type ListRow,
  mutationRowSchemas,
  type PlaceRow,
  type SearchResult,
  type VisitNoteRow,
} from "@magomap/domain";
import {
  newId,
  ownItemRowId,
  placeRowId,
  placeSourceRowId,
  userListRowId,
  userPlaceRowId,
} from "@magomap/domain/ids";
import { currentDb, type Draft, type MagomapDexie } from "./db";
import { notifyWrite } from "./events";

/** Never earlier than the version being replaced, so a slow device clock can't lose an edit. */
export const stamp = (existingUpdatedAt?: number) =>
  Math.max(Date.now(), (existingUpdatedAt ?? 0) + 1);

const TABLES = [
  "places",
  "lists",
  "list_items",
  "visit_notes",
  "links",
  "user_lists",
  "user_places",
  "place_sources",
  "outbox",
] as const;

async function upsert<T extends ClientWritableTable>(
  db: MagomapDexie,
  table: T,
  row: { id: string; updatedAt: number },
  wire: object = row,
) {
  mutationRowSchemas[table].parse(wire);
  await (db.table(table) as MagomapDexie["places"]).put(row as never);
  await db.outbox.add({
    mutationId: newId(),
    table,
    id: row.id,
    op: "upsert",
    row: wire,
    clientUpdatedAt: row.updatedAt,
  });
}

async function softDelete(db: MagomapDexie, table: ClientWritableTable, id: string) {
  const store = db.table(table);
  const existing = (await store.get(id)) as { updatedAt: number } | undefined;
  if (!existing) return;
  const at = stamp(existing.updatedAt);
  await store.update(id, { deletedAt: at, updatedAt: at });
  await db.outbox.add({ mutationId: newId(), table, id, op: "delete", clientUpdatedAt: at });
}

async function tx<T>(fn: (db: MagomapDexie) => Promise<T>): Promise<T> {
  const db = currentDb();
  const out = await db.transaction(
    "rw",
    TABLES.map((t) => db.table(t)),
    () => fn(db),
  );
  notifyWrite();
  return out;
}

// ---------- Diary ----------

export function addVisitNote(
  placeId: string,
  input: { visitedOn: string | null; body: string },
): Promise<string> {
  return tx(async (db) => {
    const at = stamp();
    const row: VisitNoteRow = {
      id: newId(),
      placeId,
      visitedOn: input.visitedOn,
      body: input.body,
      origin: "user",
      originKey: null,
      editedByUser: false,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    await upsert(db, "visit_notes", row);
    return row.id;
  });
}

export function editVisitNote(
  id: string,
  patch: Partial<Pick<VisitNoteRow, "visitedOn" | "body">>,
): Promise<void> {
  return tx(async (db) => {
    const existing = await db.visit_notes.get(id);
    if (!existing) throw new Error("Note not found");
    const row: VisitNoteRow = {
      ...existing,
      ...patch,
      // An imported note becomes the user's own once edited; later imports leave it alone.
      editedByUser: existing.origin === "import" ? true : existing.editedByUser,
      updatedAt: stamp(existing.updatedAt),
    };
    await upsert(db, "visit_notes", row);
  });
}

export const deleteVisitNote = (id: string) => tx((db) => softDelete(db, "visit_notes", id));

// ---------- Links ----------

export function addLink(placeId: string, input: { url: string; title: string | null }) {
  return tx(async (db) => {
    const at = stamp();
    const row: LinkRow = {
      id: newId(),
      placeId,
      url: input.url.trim(),
      title: input.title?.trim() || null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    await upsert(db, "links", row);
    return row.id;
  });
}

export function editLink(id: string, patch: Partial<Pick<LinkRow, "url" | "title">>) {
  return tx(async (db) => {
    const existing = await db.links.get(id);
    if (!existing) throw new Error("Link not found");
    await upsert(db, "links", { ...existing, ...patch, updatedAt: stamp(existing.updatedAt) });
  });
}

export const deleteLink = (id: string) => tx((db) => softDelete(db, "links", id));

// ---------- Places from search ----------

function placeFromResult(result: SearchResult, at: number, existing?: PlaceRow): PlaceRow {
  return {
    id: placeRowId(result.provider, result.externalId),
    title: result.title,
    address: result.address,
    roadAddress: result.roadAddress,
    addressSource: "search",
    category: result.category,
    phone: result.phone,
    lat: result.lat,
    lng: result.lng,
    providerSnapshotAt: existing?.providerSnapshotAt ?? null,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    deletedAt: null,
  };
}

/** The pushed row: exactly the signed search result, so the server can verify it. */
function signedWire(result: SearchResult, row: PlaceRow) {
  return {
    ...row,
    title: result.title,
    address: result.address,
    roadAddress: result.roadAddress,
    category: result.category,
    phone: result.phone,
    lat: result.lat,
    lng: result.lng,
    source: {
      provider: result.provider,
      externalId: result.externalId,
      signature: result.signature,
      signedAt: result.signedAt,
    },
  };
}

/** Saves a search result as one of the user's places; saving again changes nothing. */
export function savePlaceFromSearch(result: SearchResult): Promise<string> {
  return tx(async (db) => {
    const id = placeRowId(result.provider, result.externalId);
    const mine = await db.user_places.get(userPlaceRowId(id));
    if (mine && mine.deletedAt == null) return id;
    const existing = await db.places.get(id);
    const at = stamp(existing?.updatedAt);
    // A place already known from a list keeps its data; only search-new places take the result.
    const row = existing ?? placeFromResult(result, at);
    await upsert(
      db,
      "places",
      { ...row, updatedAt: at },
      signedWire(result, { ...row, updatedAt: at }),
    );
    await db.user_places.put({
      id: userPlaceRowId(id),
      placeId: id,
      savedAt: at,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
    await db.place_sources.put({
      id: placeSourceRowId(result.provider, result.externalId),
      placeId: id,
      provider: result.provider,
      externalId: result.externalId,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
    return id;
  });
}

/** Sends a newer location for a saved place; the server decides whether it moved. */
export function refreshPlaceFromSearch(result: SearchResult): Promise<void> {
  return tx(async (db) => {
    const id = placeRowId(result.provider, result.externalId);
    const existing = await db.places.get(id);
    if (!existing) return;
    const same =
      existing.lat === result.lat &&
      existing.lng === result.lng &&
      existing.address === result.address &&
      existing.roadAddress === result.roadAddress;
    if (same) return;
    const at = stamp(existing.updatedAt);
    const row: PlaceRow = {
      ...existing,
      lat: result.lat,
      lng: result.lng,
      address: result.address,
      roadAddress: result.roadAddress,
      addressSource: "search",
      updatedAt: at,
    };
    await upsert(db, "places", row, signedWire(result, row));
  });
}

// ---------- Own lists ----------

/** Writes a new own list and marks it as one of "My lists" at once (the server records the owner too). */
async function insertOwnList(db: MagomapDexie, input: { name: string; color: string | null }) {
  const at = stamp();
  const row: ListRow = {
    id: newId(),
    provider: null,
    externalId: null,
    name: input.name.trim(),
    description: null,
    color: input.color,
    ownerName: null,
    removedAtProvider: null,
    providerSnapshotAt: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  await upsert(db, "lists", row);
  await db.user_lists.put({
    id: userListRowId(row.id),
    listId: row.id,
    role: "owner",
    removedAt: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  });
  return { id: row.id, at };
}

export function createList(input: { name: string; color: string | null }): Promise<string> {
  return tx(async (db) => (await insertOwnList(db, input)).id);
}

/**
 * A new own list holding the places the source list has now (live items, in the source's order).
 * Works for any list, own or Kakao, followed or owned. Only places are copied: Kakao notes and
 * colours belong to the source's items. Returns the new list's id.
 */
export function duplicateList(sourceListId: string, name: string): Promise<string> {
  return tx(async (db) => {
    const source = await db.lists.get(sourceListId);
    if (!source || source.deletedAt != null) throw new Error("no such list");
    if (!name.trim()) throw new Error("blank name");
    const items = (await db.list_items.where("listId").equals(sourceListId).toArray())
      .filter((i) => i.deletedAt == null && i.removedAtProvider == null)
      .sort((a, b) => a.position - b.position);
    const { id: listId, at } = await insertOwnList(db, { name, color: null });
    for (const [position, source] of items.entries()) {
      const row: ListItemRow = {
        id: ownItemRowId(listId, source.placeId),
        listId,
        placeId: source.placeId,
        position,
        addedAt: at,
        externalId: null,
        providerNote: null,
        providerColor: null,
        removedAtProvider: null,
        providerSnapshotAt: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      await upsert(db, "list_items", row);
    }
    return listId;
  });
}

export function editList(id: string, patch: Partial<Pick<ListRow, "name" | "color">>) {
  return tx(async (db) => {
    const existing = await db.lists.get(id);
    if (!existing || existing.provider !== null) throw new Error("Not an own list");
    const row: ListRow = {
      ...existing,
      ...patch,
      name: (patch.name ?? existing.name).trim(),
      updatedAt: stamp(existing.updatedAt),
    };
    await upsert(db, "lists", row);
  });
}

export const deleteList = (id: string) => tx((db) => softDelete(db, "lists", id));

/** Adds a place to an own list; adding it again restores a removed membership. */
export function addToList(listId: string, placeId: string): Promise<string> {
  return tx(async (db) => {
    const id = ownItemRowId(listId, placeId);
    const existing = await db.list_items.get(id);
    if (existing && existing.deletedAt == null) return id;
    const items = await db.list_items.where("listId").equals(listId).toArray();
    const position = items.reduce((max, i) => Math.max(max, i.position), -1) + 1;
    const at = stamp(existing?.updatedAt);
    const row: ListItemRow = {
      id,
      listId,
      placeId,
      position: existing?.position ?? position,
      addedAt: existing?.addedAt ?? at,
      externalId: null,
      providerNote: null,
      providerColor: null,
      removedAtProvider: null,
      providerSnapshotAt: null,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      deletedAt: null,
    };
    await upsert(db, "list_items", row);
    return id;
  });
}

export const removeFromList = (listItemId: string) =>
  tx((db) => softDelete(db, "list_items", listItemId));

// ---------- Drafts ----------

/** Keeps a draft; `db` pins it to the account it was typed in, even if another one opens. */
export async function saveDraft(
  key: string,
  value: { visitedOn: string | null; body: string },
  db: MagomapDexie = currentDb(),
) {
  const draft: Draft = { key, ...value, updatedAt: Date.now() };
  await db.drafts.put(draft);
}

export async function clearDraft(key: string, db: MagomapDexie = currentDb()) {
  await db.drafts.delete(key);
}
