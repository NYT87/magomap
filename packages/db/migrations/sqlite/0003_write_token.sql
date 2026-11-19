-- A per-write token: a write batch applies only if no other writer changed the user's data since it read.
ALTER TABLE users ADD COLUMN write_token TEXT;
