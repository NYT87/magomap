import { useSyncExternalStore } from "react";
import { dbReplacements, type MagomapDexie, openUserDb, subscribeDbReplacements } from "./db";

/**
 * Opens the account's database. If another tab deletes it, a fresh one is opened under a new
 * key, so everything keyed by it (sync, editors) starts over on the open database.
 */
export function useUserDb(userId: string): { db: MagomapDexie; key: string } {
  // Only this account's own database being replaced starts it over.
  const generation = useSyncExternalStore(subscribeDbReplacements, () => dbReplacements(userId));
  return { db: openUserDb(userId), key: `${userId}:${generation}` };
}
