-- At most one running import per user, enforced by the database.
CREATE UNIQUE INDEX import_runs_one_running ON import_runs (user_id) WHERE status = 'running';
