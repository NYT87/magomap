// Kysely schema, generated once from the table list in plan 01b. snake_case like the SQL.
// Shared tables have no user_id. Timestamps are epoch ms; booleans are 0/1 integers.

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
}

export interface ImportSeenTable {
  user_id: string;
  run_id: string;
  list_item_id: string;
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
  import_seen: ImportSeenTable;
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
