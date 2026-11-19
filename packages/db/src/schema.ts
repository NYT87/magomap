// Kysely schema: one interface per table, snake_case like the SQL.
// Timestamps are epoch ms; booleans are 0/1 integers.

export interface PlacesTable {
  user_id: string;
  id: string;
  kakao_place_id: string | null;
  title: string;
  address: string | null;
  road_address: string | null;
  address_source: string | null;
  category: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  source: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface ListsTable {
  user_id: string;
  id: string;
  kind: string;
  kakao_folder_id: number | null;
  subscribed: number;
  owner_name: string | null;
  name: string;
  description: string | null;
  color: string | null;
  removed_from_kakao_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_updated_at: number;
  seq: number;
}

export interface ListItemsTable {
  user_id: string;
  id: string;
  list_id: string;
  place_id: string;
  position: number;
  added_at: number;
  kakao_favorite_seq: string | null;
  kakao_note: string | null;
  kakao_color: string | null;
  removed_from_kakao_at: number | null;
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

export interface PlaceLocationsTable {
  user_id: string;
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

export interface UsersTable {
  id: string;
  display_name: string | null;
  change_seq: number;
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

export interface ImportRunsTable {
  user_id: string;
  id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  complete: number;
  summary_json: string | null;
  error: string | null;
}

export interface ImportSeenTable {
  user_id: string;
  run_id: string;
  list_item_id: string;
}

export interface TombstonesTable {
  user_id: string;
  table_name: string;
  id: string;
  deleted_at: number;
}

export interface Database {
  places: PlacesTable;
  lists: ListsTable;
  list_items: ListItemsTable;
  visit_notes: VisitNotesTable;
  links: LinksTable;
  place_locations: PlaceLocationsTable;
  users: UsersTable;
  identities: IdentitiesTable;
  sessions: SessionsTable;
  import_runs: ImportRunsTable;
  import_seen: ImportSeenTable;
  tombstones: TombstonesTable;
}
