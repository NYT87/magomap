-- magomap schema (shared, provider-neutral). Statements are separated by lines that are exactly `-- statement`.
CREATE TABLE users (
  id TEXT NOT NULL,
  display_name TEXT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id)
);
-- statement
CREATE TABLE identities (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
-- statement
CREATE TABLE sessions (
  token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (token_hash)
);
-- statement
CREATE TABLE tombstones (
  user_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  id TEXT NOT NULL,
  deleted_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, table_name, id)
);
-- statement
CREATE TABLE import_runs (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  provider TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  status TEXT NOT NULL,
  complete INTEGER NOT NULL,
  subscription_known INTEGER NOT NULL,
  snapshot_at BIGINT NOT NULL,
  summary_json TEXT,
  error TEXT,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE TABLE import_seen (
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  list_item_id TEXT NOT NULL,
  PRIMARY KEY (user_id, run_id, list_item_id)
);
-- statement
CREATE TABLE sync_state (
  id INTEGER NOT NULL,
  change_seq BIGINT NOT NULL,
  write_token TEXT,
  PRIMARY KEY (id)
);
-- statement
INSERT INTO sync_state (id, change_seq, write_token) VALUES (1, 0, NULL);
-- statement
CREATE TABLE places (
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  address TEXT,
  road_address TEXT,
  address_source TEXT,
  category TEXT,
  phone TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  provider_snapshot_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (id)
);
-- statement
CREATE INDEX places_seq ON places (seq, id);
-- statement
CREATE TABLE place_sources (
  id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (id)
);
-- statement
CREATE INDEX place_sources_seq ON place_sources (seq, id);
-- statement
CREATE TABLE place_locations (
  id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  address TEXT,
  road_address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  valid_from BIGINT NOT NULL,
  valid_until BIGINT NOT NULL,
  detected_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (id)
);
-- statement
CREATE INDEX place_locations_seq ON place_locations (seq, id);
-- statement
CREATE TABLE lists (
  id TEXT NOT NULL,
  provider TEXT,
  external_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  owner_name TEXT,
  removed_at_provider BIGINT,
  provider_snapshot_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (id)
);
-- statement
CREATE INDEX lists_seq ON lists (seq, id);
-- statement
CREATE TABLE list_items (
  id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at BIGINT NOT NULL,
  external_id TEXT,
  provider_note TEXT,
  provider_color TEXT,
  removed_at_provider BIGINT,
  provider_snapshot_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (id)
);
-- statement
CREATE INDEX list_items_seq ON list_items (seq, id);
-- statement
CREATE TABLE user_lists (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  role TEXT NOT NULL,
  removed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX user_lists_seq ON user_lists (user_id, seq, id);
-- statement
CREATE TABLE user_places (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  saved_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX user_places_seq ON user_places (user_id, seq, id);
-- statement
CREATE TABLE visit_notes (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  visited_on TEXT,
  body TEXT NOT NULL,
  origin TEXT NOT NULL,
  origin_key TEXT,
  edited_by_user INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX visit_notes_seq ON visit_notes (user_id, seq, id);
-- statement
CREATE TABLE links (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX links_seq ON links (user_id, seq, id);
-- statement
CREATE UNIQUE INDEX place_sources_external ON place_sources (provider, external_id);
-- statement
CREATE INDEX place_sources_place ON place_sources (place_id);
-- statement
CREATE INDEX place_locations_place ON place_locations (place_id);
-- statement
CREATE UNIQUE INDEX lists_external ON lists (provider, external_id) WHERE provider IS NOT NULL;
-- statement
CREATE INDEX list_items_list ON list_items (list_id);
-- statement
CREATE INDEX list_items_place ON list_items (place_id);
-- statement
CREATE INDEX user_lists_list ON user_lists (user_id, list_id);
-- statement
CREATE INDEX user_places_place ON user_places (user_id, place_id);
-- statement
CREATE INDEX visit_notes_place ON visit_notes (user_id, place_id);
-- statement
CREATE INDEX links_place ON links (user_id, place_id);
-- statement
CREATE INDEX identities_user ON identities (user_id);
-- statement
CREATE INDEX sessions_user ON sessions (user_id);
-- statement
CREATE UNIQUE INDEX import_runs_one_running ON import_runs (user_id) WHERE status = 'running';
