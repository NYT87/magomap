// The import in flight, kept outside any screen: leaving Account and coming back must not
// make a running import look stopped, and the screen stays awake until the import really ends.
// One job per account, so signing in as someone else never shows (or blocks on) another's import.
import type { ImportSummary } from "@magomap/domain";
import { dbUserId, openDbOrNull } from "../data/db";
import { runImport } from "./runImport";
import { holdScreenOn } from "./wakeLock";

export interface ImportJob {
  /** The account this import acts for. */
  account: string;
  /** Known once the server has started or continued the run. */
  runId: string | null;
  current: number;
  total: number;
  /** The run was started again from the beginning because kakao-list synced since. */
  freshStart: boolean;
  /** Settles when the import ends; `freshStart` is the final value. */
  promise: Promise<{ summary: ImportSummary; freshStart: boolean }>;
}

const jobs = new Map<string, ImportJob>();
const listeners = new Set<() => void>();

const accountNow = () => {
  const db = openDbOrNull();
  return db ? dbUserId(db) : "";
};

const publish = (account: string, next: ImportJob | null) => {
  if (next) jobs.set(account, next);
  else jobs.delete(account);
  for (const listener of listeners) listener();
};

const patch = (account: string, changes: Partial<Omit<ImportJob, "promise" | "account">>) => {
  const job = jobs.get(account);
  if (job) publish(account, { ...job, ...changes });
};

export const subscribeImportJob = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The signed-in account's import, if one is running. */
export const currentImportJob = () => jobs.get(accountNow()) ?? null;

/** Starts an import (or continues a stopped run) for the signed-in account, or returns the one running. */
export function startImportJob(resumeRunId?: string): ImportJob {
  const account = accountNow();
  const existing = jobs.get(account);
  if (existing) return existing;
  const release = holdScreenOn();
  let freshStart = false;
  // Deferred a tick so the job is published before runImport can report anything.
  const promise = Promise.resolve().then(async () => {
    try {
      const summary = await runImport(
        ({ listIndex, listCount }) => patch(account, { current: listIndex + 1, total: listCount }),
        {
          account,
          ...(resumeRunId ? { resumeRunId } : {}),
          onRun: (runId) => patch(account, { runId }),
          onFreshStart: () => {
            freshStart = true;
            patch(account, { freshStart });
          },
        },
      );
      return { summary, freshStart };
    } finally {
      release();
      publish(account, null);
    }
  });
  const started: ImportJob = {
    account,
    runId: null,
    current: 0,
    total: 0,
    freshStart: false,
    promise,
  };
  publish(account, started);
  return started;
}

/** Forgets every job without waiting for them (tests, which never let one finish). */
export const forgetImportJob = () => {
  jobs.clear();
  for (const listener of listeners) listener();
};
