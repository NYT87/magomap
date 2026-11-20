// The server-driven Kakao import: the app only says "next page"; the server fetches from kakao-list.
import { type ApiErrorCode, type ImportSummary, LIMITS } from "@magomap/domain";
import { ACCOUNT_HEADER, ApiError, apiFetch, NetworkError, UnauthorizedError } from "../api/client";
import { currentDb, dbUserId } from "../data/db";
import { syncNow } from "../data/sync";

export type ImportStep = "start" | "list" | "complete";

export class ImportError extends Error {
  constructor(
    readonly step: ImportStep,
    readonly code?: ApiErrorCode | "offline" | "signed_out",
    readonly listIndex?: number,
  ) {
    super(`Import failed at ${step}${code ? `: ${code}` : ""}`);
  }
}

const codeOf = (error: unknown): ImportError["code"] => {
  if (error instanceof ApiError) return error.code;
  if (error instanceof NetworkError) return "offline";
  if (error instanceof UnauthorizedError) return "signed_out";
  return undefined;
};

/** A dropped connection or a busy server gets one more try; anything else stops the import. */
const retryable = (error: unknown) =>
  error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);

async function post<T>(account: string, path: string, body?: unknown): Promise<T> {
  // Every request, retries included, acts for the account the import started in.
  const init = {
    method: "POST",
    body: JSON.stringify(body ?? {}),
    headers: { [ACCOUNT_HEADER]: account },
  };
  try {
    return await apiFetch<T>(path, init);
  } catch (error) {
    if (!retryable(error)) throw error;
    return apiFetch<T>(path, init);
  }
}

type RunLists = { externalId: string; name: string; itemCount: number }[];
type ResumeLists = (RunLists[number] & { pagesDone: number; finished: boolean })[];

/**
 * Starts a run (or continues a stopped one), imports every list page by page, finishes each list,
 * then completes the run. If anything fails, the run is never completed, so nothing is marked
 * as removed from Kakao.
 */
export async function runImport(
  onProgress: (p: { listIndex: number; listCount: number }) => void,
  opts: {
    resumeRunId?: string;
    /** Called once the run is known, started or continued. */
    onRun?: (runId: string) => void;
    /** Called when kakao-list synced since the stopped run, so the import began again. */
    onFreshStart?: () => void;
  } = {},
): Promise<ImportSummary> {
  const account = dbUserId(currentDb());
  let run: { runId: string; lists: ResumeLists } | undefined;
  if (opts.resumeRunId) {
    try {
      run = await post(account, `/api/import/runs/${encodeURIComponent(opts.resumeRunId)}/resume`);
    } catch (error) {
      const code = codeOf(error);
      if (code !== "snapshot_changed" && code !== "run_closed")
        throw new ImportError("start", code);
      // A closed run just means there is nothing to continue; only a newer sync is worth saying.
      if (code === "snapshot_changed") opts.onFreshStart?.();
    }
  }
  if (!run) {
    try {
      const fresh = await post<{ runId: string; lists: RunLists }>(account, "/api/import/runs", {
        provider: "kakao",
      });
      run = {
        runId: fresh.runId,
        lists: fresh.lists.map((l) => ({ ...l, pagesDone: 0, finished: false })),
      };
    } catch (error) {
      throw new ImportError("start", codeOf(error));
    }
  }
  opts.onRun?.(run.runId);
  const base = `/api/import/runs/${encodeURIComponent(run.runId)}`;
  for (const [listIndex, list] of run.lists.entries()) {
    if (list.finished) continue;
    onProgress({ listIndex, listCount: run.lists.length });
    const at = `${base}/lists/${encodeURIComponent(list.externalId)}`;
    try {
      // A list stopped after its last page only needs its finish call.
      const pageCount = Math.max(1, Math.ceil(list.itemCount / LIMITS.importChunkItems));
      for (let page = list.pagesDone; page < pageCount; page++) {
        const res = await post<{ done: boolean }>(account, `${at}/pages/${page}`);
        if (res.done) break;
      }
      await post(account, `${at}/finish`);
    } catch (error) {
      throw new ImportError("list", codeOf(error), listIndex);
    }
  }
  let summary: ImportSummary;
  try {
    summary = await post<ImportSummary>(account, `${base}/complete`);
  } catch (error) {
    throw new ImportError("complete", codeOf(error));
  }
  await syncNow();
  return summary;
}
