import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { currentDb } from "./db";
import { type SyncStateName, subscribeSync, syncState } from "./sync";

export interface SyncStatus {
  state: SyncStateName;
  unsynced: number;
  rejected: number;
  lastSyncAt?: number;
}

/** True while a sync is running: rows of a list may still be arriving. */
export function useSyncing(): boolean {
  return useSyncExternalStore(subscribeSync, syncState).state === "syncing";
}

export function useSyncStatus(): SyncStatus {
  const s = useSyncExternalStore(subscribeSync, syncState);
  const counts = useLiveQuery(
    async () => {
      const db = currentDb();
      return { unsynced: await db.outbox.count(), rejected: await db.rejected.count() };
    },
    [],
    { unsynced: 0, rejected: 0 },
  );
  return { state: s.state, lastSyncAt: s.lastSyncAt, ...counts };
}
