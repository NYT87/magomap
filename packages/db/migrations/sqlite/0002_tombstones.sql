-- Deletes of rows the server has never seen, so an older create arriving later can't bring them back.
CREATE TABLE tombstones (
  user_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, table_name, id)
);
