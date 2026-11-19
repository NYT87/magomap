-- magomap initial schema. Statements are separated by lines that are exactly `-- statement`.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  change_seq BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
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
CREATE INDEX identities_user ON identities (user_id);
-- statement
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
-- statement
CREATE INDEX sessions_user ON sessions (user_id);
-- statement
CREATE TABLE places (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kakao_place_id TEXT,
  title TEXT NOT NULL,
  address TEXT,
  road_address TEXT,
  address_source TEXT,
  category TEXT,
  phone TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  source TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX places_seq ON places (user_id, seq, id);
-- statement
CREATE TABLE lists (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  kakao_folder_id BIGINT,
  subscribed INTEGER NOT NULL,
  owner_name TEXT,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  removed_from_kakao_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX lists_seq ON lists (user_id, seq, id);
-- statement
CREATE TABLE list_items (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at BIGINT NOT NULL,
  kakao_favorite_seq TEXT,
  kakao_note TEXT,
  kakao_color TEXT,
  removed_from_kakao_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_updated_at BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX list_items_seq ON list_items (user_id, seq, id);
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
CREATE TABLE place_locations (
  user_id TEXT NOT NULL,
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
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX place_locations_seq ON place_locations (user_id, seq, id);
-- statement
CREATE UNIQUE INDEX places_kakao ON places (user_id, kakao_place_id) WHERE kakao_place_id IS NOT NULL;
-- statement
CREATE INDEX list_items_place ON list_items (user_id, place_id);
-- statement
CREATE INDEX visit_notes_place ON visit_notes (user_id, place_id);
-- statement
CREATE INDEX links_place ON links (user_id, place_id);
-- statement
CREATE INDEX place_locations_place ON place_locations (user_id, place_id);
-- statement
CREATE INDEX list_items_list ON list_items (user_id, list_id);
-- statement
CREATE TABLE import_runs (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  status TEXT NOT NULL,
  complete INTEGER NOT NULL,
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
