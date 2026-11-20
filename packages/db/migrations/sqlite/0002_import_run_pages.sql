-- Seen items are kept per page (one row per page of up to 500 ids), not one row per item.
-- A run in flight can't finish without its seen rows: it ends as superseded and the next import starts over.
UPDATE import_runs SET status = 'superseded', finished_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE status = 'running';
-- statement
DELETE FROM import_run_lists;
-- statement
DROP TABLE import_seen;
-- statement
CREATE TABLE import_run_pages (
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  item_ids TEXT NOT NULL,
  PRIMARY KEY (user_id, run_id, external_id, page)
);
