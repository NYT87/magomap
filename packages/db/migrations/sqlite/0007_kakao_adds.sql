-- Places she asked to add to one of her own Kakao lists, not yet in Kakao Map (issue #83). The
-- extension adds them there; the next Kakao Map sync brings each in as a list item, and the app
-- then deletes the row. Per user, like links. `failed` is null or 'list_missing'.
CREATE TABLE kakao_adds (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  failed TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  client_updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- statement
CREATE INDEX kakao_adds_seq ON kakao_adds (user_id, seq, id);
