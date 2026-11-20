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

/**
 * Whether a list's places may still be on their way: "downloading" while a sync runs, "waiting"
 * when a download of everything was cut off (a failed sync) and the next sync finishes it.
 */
export function useListArrival(): "downloading" | "waiting" | "unknown" | null {
  const syncing = useSyncExternalStore(subscribeSync, syncState).state === "syncing";
  const owed = useLiveQuery(async () => (await currentDb().meta.get("fullPull")) !== undefined);
  if (syncing) return "downloading";
  // Not read yet (a first render): say nothing rather than "empty" for a moment.
  if (owed === undefined) return "unknown";
  return owed ? "waiting" : null;
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
