import type {
  ClientWritableTable,
  LinkRow,
  ListItemRow,
  ListRow,
  Mutation,
  PlaceLocationRow,
  PlaceRow,
  PlaceSourceRow,
  RejectReason,
  SyncTable,
  UserListRow,
  UserPlaceRow,
  VisitNoteRow,
} from "@magomap/domain";
import Dexie, { type EntityTable } from "dexie";
import { ACCOUNT_CHANGED, setRequestAccount } from "../api/client";

export interface OutboxEntry {
  seq?: number;
  mutationId: string;
  table: ClientWritableTable;
  id: string;
  op: Mutation["op"];
  row?: unknown;
  clientUpdatedAt: number;
}

export interface RejectedEntry {
  mutationId: string;
  table: ClientWritableTable;
  id: string;
  op: Mutation["op"];
  row?: unknown;
  reason: RejectReason;
  at: number;
}

export interface Draft {
  key: string;
  visitedOn: string | null;
  body: string;
  updatedAt: number;
}

export interface MetaEntry {
  key: "cursor" | "lastSyncAt";
  value: string | number;
}

export type MagomapDexie = Dexie & {
  places: EntityTable<PlaceRow, "id">;
  place_sources: EntityTable<PlaceSourceRow, "id">;
  place_locations: EntityTable<PlaceLocationRow, "id">;
  lists: EntityTable<ListRow, "id">;
  list_items: EntityTable<ListItemRow, "id">;
  user_lists: EntityTable<UserListRow, "id">;
  user_places: EntityTable<UserPlaceRow, "id">;
  visit_notes: EntityTable<VisitNoteRow, "id">;
  links: EntityTable<LinkRow, "id">;
  outbox: EntityTable<OutboxEntry, "seq">;
  rejected: EntityTable<RejectedEntry, "mutationId">;
  drafts: EntityTable<Draft, "key">;
  meta: EntityTable<MetaEntry, "key">;
};

export const ROW_TABLES: readonly SyncTable[] = [
  "places",
  "place_sources",
  "place_locations",
  "lists",
  "list_items",
  "user_lists",
  "user_places",
  "visit_notes",
  "links",
];

export const dbName = (userId: string) => `magomap-${userId}`;
/** The account a database belongs to. */
export const dbUserId = (db: MagomapDexie) => db.name.slice("magomap-".length);

let current: MagomapDexie | null = null;

/** Per account: how often its database was closed under the app (another tab deleted it). */
const replaced = new Map<string, number>();
const replacedListeners = new Set<() => void>();
export const dbReplacements = (userId: string) => replaced.get(dbName(userId)) ?? 0;
export function subscribeDbReplacements(fn: () => void): () => void {
  replacedListeners.add(fn);
  return () => replacedListeners.delete(fn);
}

/** One instance per account, so coming back to an account finds its running work again. */
const instances = new Map<string, MagomapDexie>();

/** Opens (and makes current) this account's own database: data, outbox and drafts. */
export function openUserDb(userId: string): MagomapDexie {
  const known = instances.get(dbName(userId));
  // A closed instance (deleted elsewhere, or closed on purpose) is replaced by a fresh one.
  if (known && !known.hasBeenClosed()) {
    current = known;
    setRequestAccount(userId);
    return known;
  }
  const db = new Dexie(dbName(userId)) as MagomapDexie;
  db.version(1).stores({
    places: "id",
    place_sources: "id, placeId",
    place_locations: "id, placeId",
    lists: "id",
    list_items: "id, listId, placeId",
    user_lists: "id, listId",
    user_places: "id, placeId",
    visit_notes: "id, placeId",
    links: "id, placeId",
    outbox: "++seq, mutationId, [table+id]",
    rejected: "mutationId",
    drafts: "key",
    meta: "key",
  });
  // Another tab deleted (or upgraded) this database: close for good, so no late write here
  // recreates it, and ask again who is signed in.
  db.on("versionchange", () => {
    db.close({ disableAutoOpen: true });
    if (instances.get(db.name) === db) instances.delete(db.name);
    if (current === db) {
      current = null;
      setRequestAccount(null);
    }
    replaced.set(db.name, (replaced.get(db.name) ?? 0) + 1);
    for (const fn of replacedListeners) fn();
    window.dispatchEvent(new Event(ACCOUNT_CHANGED));
    return false;
  });
  instances.set(db.name, db);
  current = db;
  setRequestAccount(userId);
  return db;
}

/** The signed-in account's database. */
export function currentDb(): MagomapDexie {
  if (!current) throw new Error("No account database is open");
  return current;
}

/** The open account's database, or null when none is open. */
export const openDbOrNull = (): MagomapDexie | null => current;

/**
 * Closes an account's database (before deleting it), so nothing reopens or recreates it. If it
 * was the open one, no account is open afterwards.
 */
export function closeUserDb(userId?: string) {
  const db = userId === undefined ? current : (instances.get(dbName(userId)) ?? null);
  if (!db) return;
  db.close();
  instances.delete(db.name);
  if (db === current) {
    current = null;
    setRequestAccount(null);
  }
}
