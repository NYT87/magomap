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
