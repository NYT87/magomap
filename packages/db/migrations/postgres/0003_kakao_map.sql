-- Direct Kakao Map sync. Each user's newest complete snapshot per provider: an older import still
-- adds places and notes, but never changes that user's list roles or personal removals.
CREATE TABLE user_provider_snapshots (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  snapshot_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
-- statement
-- Where a run's snapshot came from: kakao-list (server-fetched) or a direct Kakao Map upload.
ALTER TABLE import_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'kakao_list';
-- statement
-- A user is bound to at most one Kakao Map account, and an account to at most one user,
-- so one person's Kakao Map lists cannot be imported into another person's magomap account.
CREATE TABLE kakao_map_accounts (
  user_id TEXT NOT NULL PRIMARY KEY,
  kakao_map_user_id TEXT NOT NULL UNIQUE,
  nickname TEXT,
  bound_at BIGINT NOT NULL
);
-- statement
-- The provider account that owns a shared list at the provider (for Kakao, the Kakao Map account
-- that owns the folder). The list's owner in magomap is the user bound to that account.
-- Server-side only: never sent to clients.
ALTER TABLE lists ADD COLUMN provider_owner_id TEXT;
-- statement
-- The same, for each list of a running import.
ALTER TABLE import_run_lists ADD COLUMN provider_owner_id TEXT;
