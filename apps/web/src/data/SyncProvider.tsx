import { type ReactNode, useEffect, useMemo, useState } from "react";
import { currentDb } from "./db";
import { startKakaoAddTriggers } from "./kakaoAddTriggers";
import { SyncContext, type SyncControls } from "./SyncContext";
import { startSyncTriggers, syncNow } from "./sync";
import { useSyncStatus } from "./useSyncStatus";

/** Starts syncing for the open account and gives screens the controls they need. */
export function SyncProvider({ children }: { children: ReactNode }) {
  // This provider's account (it is remounted for another one).
  const [db] = useState(currentDb);
  const status = useSyncStatus();
  useEffect(() => startSyncTriggers(), []);
  // Places she asked to add to her Kakao lists go to Kakao Map where the extension is.
  useEffect(() => startKakaoAddTriggers(db), [db]);
  const controls = useMemo<SyncControls>(
    () => ({
      unsynced: status.unsynced,
      rejected: status.rejected,
      syncNow,
      countUnsynced: () => db.outbox.count(),
    }),
    [db, status.unsynced, status.rejected],
  );
  return <SyncContext.Provider value={controls}>{children}</SyncContext.Provider>;
}
