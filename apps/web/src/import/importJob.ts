// The import in flight, kept outside any screen: leaving Account and coming back must not
// make a running import look stopped, and the screen stays awake until the import really ends.
import type { ImportSummary } from "@magomap/domain";
import { runImport } from "./runImport";
import { holdScreenOn } from "./wakeLock";

export interface ImportJob {
  /** Known once the server has started or continued the run. */
  runId: string | null;
  current: number;
  total: number;
  /** The run was started again from the beginning because kakao-list synced since. */
  freshStart: boolean;
  /** Settles when the import ends; `freshStart` is the final value. */
  promise: Promise<{ summary: ImportSummary; freshStart: boolean }>;
}

let job: ImportJob | null = null;
const listeners = new Set<() => void>();

const publish = (next: ImportJob | null) => {
  job = next;
  for (const listener of listeners) listener();
};

const patch = (changes: Partial<Omit<ImportJob, "promise">>) => {
  if (job) publish({ ...job, ...changes });
};

export const subscribeImportJob = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const currentImportJob = () => job;

/** Starts an import (or continues a stopped run), or returns the one already running. */
export function startImportJob(resumeRunId?: string): ImportJob {
  if (job) return job;
  const release = holdScreenOn();
  let freshStart = false;
  // Deferred a tick so the job is published before runImport can report anything.
  const promise = Promise.resolve().then(async () => {
    try {
      const summary = await runImport(
        ({ listIndex, listCount }) => patch({ current: listIndex + 1, total: listCount }),
        {
          ...(resumeRunId ? { resumeRunId } : {}),
          onRun: (runId) => patch({ runId }),
          onFreshStart: () => {
            freshStart = true;
            patch({ freshStart });
          },
        },
      );
      return { summary, freshStart };
    } finally {
      release();
      publish(null);
    }
  });
  const started: ImportJob = { runId: null, current: 0, total: 0, freshStart: false, promise };
  publish(started);
  return started;
}

/** Forgets the job without waiting for it (tests, which never let one finish). */
export const forgetImportJob = () => publish(null);
