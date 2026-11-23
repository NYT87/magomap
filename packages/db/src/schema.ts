// Kysely schema, generated once from the table list in plan 01b. snake_case like the SQL.
// Shared tables have no user_id. Timestamps are epoch ms; booleans are 0/1 integers.

import type { Generated } from "kysely";

export interface UsersTable {
  id: string;
  display_name: string | null;
  created_at: number;
}

export interface IdentitiesTable {
  user_id: string;
  provider: string;
  provider_user_id: string;
  created_at: number;
}

export interface SessionsTable {
  token_hash: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

export interface TombstonesTable {
  user_id: string;
  table_name: string;
  id: string;
  deleted_at: number;
}

export interface ImportRunsTable {
  user_id: string;
  id: string;
  provider: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  complete: number;
  subscription_known: number;
  snapshot_at: number;
  summary_json: string | null;
  error: string | null;
  /** `kakao_list` (server-fetched) or `kakao_map` (a direct Kakao Map upload); defaults to `kakao_list`. */
  source: Generated<string>;
}

/** The one Kakao Map account a user is bound to; an account belongs to at most one user. */
export interface KakaoMapAccountsTable {
  user_id: string;
  kakao_map_user_id: string;
  kakao_map_alias: string | null;
  nickname: string | null;
  bound_at: number;
}

/** A user's newest complete import snapshot per provider; older imports don't change their access. */
export interface UserProviderSnapshotsTable {
  user_id: string;
  provider: string;
  snapshot_at: number;
}

export interface ImportRunListsTable {
  user_id: string;
  run_id: string;
  external_id: string;
  position: number;
  name: string;
  description: string | null;
  owner_name: string | null;
  followed: number;
  item_count: number;
  pages_done: number;
  finished: number;
  provider_owner_id: string | null;
  /** 1 when the read showed only that the user follows the list (see migration 0003). */
  access_only: Generated<number>;
}

/** The list items one page of a running import held (`item_ids`: a JSON array of `list_items.id`). */
export interface ImportRunPagesTable {
  user_id: string;
  run_id: string;
  external_id: string;
  page: number;
  item_ids: string;
}

export interface SyncStateTable {
  id: number;
  change_seq: number;
  write_token: string | null;
}

export interface PlacesTable {
  id: string;
  title: string;
  address: string | null;
  road_address: string | null;
  address_source: string | null;
  category: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  provider_snapshot_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface PlaceSourcesTable {
  id: string;
  place_id: string;
  provider: string;
  external_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface PlaceLocationsTable {
  id: string;
  place_id: string;
  address: string | null;
  road_address: string | null;
  lat: number | null;
  lng: number | null;
  valid_from: number;
  valid_until: number;
  detected_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface ListsTable {
  id: string;
  provider: string | null;
  external_id: string | null;
  name: string;
  description: string | null;
  color: string | null;
  owner_name: string | null;
  removed_at_provider: number | null;
  provider_snapshot_at: number | null;
  /** Server-side only (see migration 0003): the provider account that owns the list. */
  provider_owner_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface ListItemsTable {
  id: string;
  list_id: string;
  place_id: string;
  position: number;
  added_at: number;
  external_id: string | null;
  provider_note: string | null;
  provider_color: string | null;
  /** An own-list item's Kakao colour code, copied from the place it was copied from. */
  item_color: string | null;
  /** When the owner last changed this item's colour from magomap; older reads keep that colour. */
  color_edited_at: number | null;
  /** When the owner last changed this item's Kakao note from magomap; older reads keep that note. */
  note_edited_at: number | null;
  removed_at_provider: number | null;
  provider_snapshot_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface UserListsTable {
  user_id: string;
  id: string;
  list_id: string;
  role: string;
  removed_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface UserPlacesTable {
  user_id: string;
  id: string;
  place_id: string;
  saved_at: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface VisitNotesTable {
  user_id: string;
  id: string;
  place_id: string;
  visited_on: string | null;
  body: string;
  origin: string;
  origin_key: string | null;
  edited_by_user: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface LinksTable {
  user_id: string;
  id: string;
  place_id: string;
  url: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface Database {
  users: UsersTable;
  identities: IdentitiesTable;
  sessions: SessionsTable;
  tombstones: TombstonesTable;
  import_runs: ImportRunsTable;
  import_run_lists: ImportRunListsTable;
  import_run_pages: ImportRunPagesTable;
  user_provider_snapshots: UserProviderSnapshotsTable;
  kakao_map_accounts: KakaoMapAccountsTable;
  sync_state: SyncStateTable;
  places: PlacesTable;
  place_sources: PlaceSourcesTable;
  place_locations: PlaceLocationsTable;
  lists: ListsTable;
  list_items: ListItemsTable;
  user_lists: UserListsTable;
  user_places: UserPlacesTable;
  visit_notes: VisitNotesTable;
  links: LinksTable;
}
