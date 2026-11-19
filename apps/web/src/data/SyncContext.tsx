import { createContext, useContext } from "react";

/** What screens need from the sync engine (Task 2 provides the real one). */
export interface SyncControls {
  unsynced: number;
  syncNow: () => Promise<unknown>;
  /** Unsynced changes right now (after a sync attempt); defaults to `unsynced`. */
  countUnsynced?: () => Promise<number>;
}

export const SyncContext = createContext<SyncControls>({
  unsynced: 0,
  syncNow: async () => {},
});

export const useSyncControls = () => useContext(SyncContext);
