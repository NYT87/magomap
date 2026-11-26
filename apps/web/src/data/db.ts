import type {
  ClientWritableTable,
  KakaoAddRow,
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
import { dropHolds } from "./events";

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
  /** "removal": changes each time the account's data is removed from this device. */
  /** "fullPull": a download of everything has started and hasn't reached its last page. */
  /** "cursorGen": counts the cursor's deletions, so a cursor deleted and reached again differs. */
  key: "cursor" | "lastSyncAt" | "pullEpoch" | "removal" | "fullPull" | "cursorGen";
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
  kakao_adds: EntityTable<KakaoAddRow, "id">;
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
  "kakao_adds",
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

/** An account's database: its tables (not opened yet). Exported for tests only. */
export function defineUserDb(userId: string): MagomapDexie {
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
  // Pending adds to her Kakao lists (#83).
  db.version(2).stores({ kakao_adds: "id, listId, placeId" });
  return db;
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
  const db = defineUserDb(userId);
  // Another tab deleted (or upgraded) this database: close for good, so no late write here
  // recreates it, and ask again who is signed in.
  db.on("versionchange", () => {
    db.close({ disableAutoOpen: true });
    dropHolds(db);
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
  dropHolds(db);
  instances.delete(db.name);
  if (db === current) {
    current = null;
    setRequestAccount(null);
  }
}

/** Where sign-out leaves the removal's outcome for the sign-in screen to show. */
export const REMOVE_RESULT = "mm.removeResult";

/** How removing an account's data from this device ended. */
export type RemovalResult = "removed" | "kept";

/**
 * Removes an account's data from this device, unless something hasn't reached the server.
 *
 * One read-write transaction over every table checks the unsent and refused queues and, only if
 * both are empty, empties every table. The browser runs it atomically and in order with any other
 * tab's writes, so a change written elsewhere can't slip in between the check and the clearing.
 * The (now empty) database itself stays: deleting the file can wait on other tabs indefinitely.
 * The same transaction leaves a new removal mark: a pull another tab started earlier compares it
 * before writing what it fetched, and drops it instead of bringing the data back.
 * - "kept": something is unsent or refused, or the database couldn't be read; nothing is removed.
 * - "removed": every table is empty (but for the mark), and what the device remembers for the
 *   account is gone.
 */
export async function forgetAccountOnDevice(userId: string): Promise<RemovalResult> {
  const known = instances.get(dbName(userId));
  const db = known && !known.hasBeenClosed() ? known : defineUserDb(userId);
  let kept: boolean;
  // Sign-out doesn't wait long for the tables: another tab's write, or an older version of the
  // database held open, can hold them. Giving up cancels the clearing for good: the transaction
  // checks this flag once it has the tables, and aborts instead of clearing.
  let cancelled = false;
  let clearingStarted = false;
  try {
    const clearing = db.transaction("rw", db.tables, async () => {
      if ((await db.outbox.count()) > 0 || (await db.rejected.count()) > 0) return true;
      if (cancelled) throw new Error("removal cancelled");
      clearingStarted = true;
      await Promise.all(db.tables.map((table) => table.clear()));
      await db.meta.put({ key: "removal", value: crypto.randomUUID() });
      return false;
    });
    clearing.catch(() => {});
    const timedOut = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 4_000),
    );
    const outcome = await Promise.race([clearing, timedOut]);
    if (outcome !== "timeout") kept = outcome;
    // Already clearing: it finishes in a moment, so report what really happened.
    else if (clearingStarted) kept = await clearing;
    else {
      cancelled = true;
      kept = true;
    }
  } catch {
    // Couldn't read it: keep everything rather than guess.
    kept = true;
  } finally {
    if (db !== known) db.close();
  }
  if (kept) return "kept";
  for (const key of accountDeviceKeys(userId)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // storage blocked: nothing was stored
    }
  }
  closeUserDb(userId);
  return "removed";
}
