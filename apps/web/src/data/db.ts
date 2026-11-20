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
import { accountDeviceKeys } from "./deviceKeys";

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

/** Where sign-out leaves the removal's outcome for the sign-in screen to show. */
export const REMOVE_RESULT = "mm.removeResult";

/** How removing an account's data from this device ended. */
export type RemovalResult = "removed" | "kept" | "pending";

/** Accounts whose database removal hasn't finished yet; retried from the sign-in screen. */
const PENDING_REMOVAL = "mm.pendingRemoval";

function pendingRemovals(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(PENDING_REMOVAL) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function setPendingRemovals(ids: string[]) {
  try {
    if (ids.length > 0) localStorage.setItem(PENDING_REMOVAL, JSON.stringify(ids));
    else localStorage.removeItem(PENDING_REMOVAL);
  } catch {
    // storage blocked: nothing to retry later
  }
}

/** Deletes the database; once done, the account leaves the pending list. Never throws. */
function deleteDatabase(userId: string): Promise<boolean> {
  return Dexie.delete(dbName(userId)).then(
    () => {
      setPendingRemovals(pendingRemovals().filter((id) => id !== userId));
      return true;
    },
    () => false,
  );
}

/**
 * Unsent or refused changes in an account's database, counted straight from the browser's
 * storage (not from what the screen last showed). A database that doesn't exist has none.
 */
function changesLeft(userId: string): Promise<number> {
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName(userId));
    // It didn't exist: don't create it.
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const db = request.result;
      const stores = ["outbox", "rejected"].filter((n) => db.objectStoreNames.contains(n));
      if (stores.length === 0) {
        db.close();
        resolve(0);
        return;
      }
      const tx = db.transaction(stores, "readonly");
      let total = 0;
      for (const name of stores) {
        tx.objectStore(name).count().onsuccess = (e) => {
          total += (e.target as IDBRequest<number>).result;
        };
      }
      tx.oncomplete = () => {
        db.close();
        resolve(total);
      };
      // Unreadable: treat as having changes, so nothing is deleted on a guess.
      tx.onerror = () => {
        db.close();
        resolve(1);
      };
    };
  });
}

/**
 * Removes an account from this device: its database and what the device remembers for it
 * (lists shown, map choice, name). Device-wide settings stay.
 * - "kept": the database still has unsent or refused changes, so nothing is removed.
 * - "removed": done.
 * - "pending": another connection (another tab) holds the database; the browser finishes the
 *   deletion when it lets go, and the sign-in screen retries it until then.
 */
export async function forgetAccountOnDevice(userId: string): Promise<RemovalResult> {
  if ((await changesLeft(userId)) > 0) return "kept";
  for (const key of accountDeviceKeys(userId)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // storage blocked: nothing was stored
    }
  }
  closeUserDb(userId);
  setPendingRemovals([...new Set([...pendingRemovals(), userId])]);
  const deleted = await Promise.race([
    deleteDatabase(userId),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  return deleted ? "removed" : "pending";
}

/** Tries again to delete databases whose removal didn't finish (from the sign-in screen). */
export function retryPendingRemovals(): Promise<void> {
  return Promise.all(pendingRemovals().map((id) => deleteDatabase(id))).then(() => {});
}
