// The imports in flight, kept outside any screen: leaving Account and coming back must not
// make a running import look stopped, and the screen stays awake until the import really ends.
// One job per account and kind, so signing in as someone else never shows (or blocks on)
// another's import. Two kinds share this: the kakao-list import and the Kakao Map sync.
import type { ImportSummary } from "@magomap/domain";
import { notifyMeChanged } from "../auth/useMe";
import { dbUserId, openDbOrNull } from "../data/db";
import { KakaoMapSyncError, runKakaoMapSync } from "./kakaoMap";
import { ImportError, runImport } from "./runImport";
import { holdScreenOn } from "./wakeLock";

/** What every job shows while it runs. */
interface JobBase {
  /** The account this job acts for. */
  account: string;
  current: number;
  total: number;
}

export interface ImportJob extends JobBase {
  /** Known once the server has started or continued the run. */
  runId: string | null;
  /** The run was started again from the beginning because kakao-list synced since. */
  freshStart: boolean;
  /** Settles when the import ends; `freshStart` is the final value. */
  promise: Promise<{ summary: ImportSummary; freshStart: boolean }>;
}

export interface KakaoMapJob extends JobBase {
  /** Settles when the sync ends. */
  promise: Promise<ImportSummary>;
}

const accountNow = () => {
  const db = openDbOrNull();
  return db ? dbUserId(db) : "";
};

/**
 * A store of running jobs of one kind, by account, with the shared run: the screen held on from
 * start to end, the job published as it goes and dropped when it ends, and "who is signed in"
 * asked again afterwards.
 */
function jobStore<J extends JobBase & { promise: Promise<unknown> }>() {
  const jobs = new Map<string, J>();
  const listeners = new Set<() => void>();
  const publish = (account: string, next: J | null) => {
    if (next) jobs.set(account, next);
    else jobs.delete(account);
    for (const listener of listeners) listener();
  };
  const patch = (account: string, changes: Partial<Omit<J, "promise" | "account">>) => {
    const job = jobs.get(account);
    if (job) publish(account, { ...job, ...changes });
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: () => jobs.get(accountNow()) ?? null,
    forget: () => {
      jobs.clear();
      for (const listener of listeners) listener();
    },
    /** Starts a job for the signed-in account, or returns the one running. */
    start(
      initial: Omit<J, "promise" | "account">,
      run: (
        account: string,
        patch: (changes: Partial<Omit<J, "promise" | "account">>) => void,
      ) => J["promise"],
      signedOut: (error: unknown) => boolean,
    ): J {
      const account = accountNow();
      const existing = jobs.get(account);
      if (existing) return existing;
      const release = holdScreenOn();
      // Deferred a tick so the job is published before the run can report anything.
      const promise = Promise.resolve().then(async () => {
        let wasSignedOut = false;
        try {
          return await run(account, (changes) => patch(account, changes));
        } catch (error) {
          wasSignedOut = signedOut(error);
          throw error;
        } finally {
          release();
          publish(account, null);
          // An import may have filled an empty nickname (even one that stopped, or was refused
          // as up to date): show it now. Not when signed out: asking again would leave whatever
          // screen is open for the sign-in page, instead of the import saying so.
          if (!wasSignedOut) notifyMeChanged();
        }
      });
      const started = { ...initial, account, promise } as J;
      publish(account, started);
      return started;
    },
  };
}

const imports = jobStore<ImportJob>();
const syncs = jobStore<KakaoMapJob>();

export const subscribeImportJob = imports.subscribe;

/** The signed-in account's import, if one is running. */
export const currentImportJob = imports.current;

/** Starts an import (or continues a stopped run) for the signed-in account, or returns the one running. */
export function startImportJob(resumeRunId?: string): ImportJob {
  return imports.start(
    { runId: null, current: 0, total: 0, freshStart: false },
    async (account, patch) => {
      let freshStart = false;
      const summary = await runImport(
        ({ listIndex, listCount }) => patch({ current: listIndex + 1, total: listCount }),
        {
          account,
          ...(resumeRunId ? { resumeRunId } : {}),
          onRun: (runId) => patch({ runId }),
          onFreshStart: () => {
            freshStart = true;
            patch({ freshStart });
          },
        },
      );
      return { summary, freshStart };
    },
    (error) => error instanceof ImportError && error.code === "signed_out",
  );
}

/** Forgets every job without waiting for them (tests, which never let one finish). */
export const forgetImportJob = () => {
  imports.forget();
  syncs.forget();
};

export const subscribeKakaoMapJob = syncs.subscribe;

/** The signed-in account's Kakao Map sync, if one is running. */
export const currentKakaoMapJob = syncs.current;

/**
 * Starts a Kakao Map sync for the signed-in account, or returns the one running. `confirmAccount`
 * is the account (by its last 4 characters) she confirmed for the read kept in memory.
 */
export function startKakaoMapJob(confirmAccount?: string): KakaoMapJob {
  return syncs.start(
    { current: 0, total: 0 },
    (account, patch) =>
      runKakaoMapSync(
        ({ listIndex, listCount }) => patch({ current: listIndex + 1, total: listCount }),
        { account, ...(confirmAccount ? { confirmAccount } : {}) },
      ),
    (error) => error instanceof KakaoMapSyncError && error.code === "signed_out",
  );
}
