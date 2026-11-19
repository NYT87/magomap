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

let current: MagomapDexie | null = null;

/** Opens (and makes current) this account's own database: data, outbox and drafts. */
export function openUserDb(userId: string): MagomapDexie {
  if (current?.name === dbName(userId) && current.isOpen()) return current;
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
  current = db;
  return db;
}

/** The signed-in account's database. */
export function currentDb(): MagomapDexie {
  if (!current) throw new Error("No account database is open");
  return current;
}

/** Closes the account's database (before deleting it), so nothing reopens or recreates it. */
export function closeUserDb() {
  current?.close();
  current = null;
}
