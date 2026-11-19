import { type ReactNode, useEffect, useMemo } from "react";
import { currentDb } from "./db";
import { SyncContext, type SyncControls } from "./SyncContext";
import { startSyncTriggers, syncNow } from "./sync";
import { useSyncStatus } from "./useSyncStatus";

/** Starts syncing for the open account and gives screens the controls they need. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const status = useSyncStatus();
  useEffect(() => startSyncTriggers(), []);
  const controls = useMemo<SyncControls>(
    () => ({
      unsynced: status.unsynced,
      rejected: status.rejected,
      syncNow,
      countUnsynced: () => currentDb().outbox.count(),
    }),
    [status.unsynced, status.rejected],
  );
  return <SyncContext.Provider value={controls}>{children}</SyncContext.Provider>;
}
