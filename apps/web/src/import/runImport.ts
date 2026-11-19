// The server-driven Kakao import: the app only says "next page"; the server fetches from kakao-list.
import type { ApiErrorCode, ImportSummary } from "@magomap/domain";
import { ApiError, apiFetch, NetworkError, UnauthorizedError } from "../api/client";
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

async function post<T>(path: string, body?: unknown): Promise<T> {
  const init = { method: "POST", body: JSON.stringify(body ?? {}) };
  try {
    return await apiFetch<T>(path, init);
  } catch (error) {
    if (!retryable(error)) throw error;
    return apiFetch<T>(path, init);
  }
}

/**
 * Starts a run, imports every list page by page, finishes each list, then completes the run.
 * If anything fails, the run is never completed, so nothing is marked as removed from Kakao.
 */
export async function runImport(
  onProgress: (p: { listIndex: number; listCount: number }) => void,
): Promise<ImportSummary> {
  let run: { runId: string; lists: { externalId: string; name: string; itemCount: number }[] };
  try {
    run = await post("/api/import/runs", { provider: "kakao" });
  } catch (error) {
    throw new ImportError("start", codeOf(error));
  }
  const base = `/api/import/runs/${encodeURIComponent(run.runId)}`;
  for (const [listIndex, list] of run.lists.entries()) {
    onProgress({ listIndex, listCount: run.lists.length });
    const at = `${base}/lists/${encodeURIComponent(list.externalId)}`;
    try {
      for (let page = 0; ; page++) {
        const res = await post<{ done: boolean }>(`${at}/pages/${page}`);
        if (res.done) break;
      }
      await post(`${at}/finish`);
    } catch (error) {
      throw new ImportError("list", codeOf(error), listIndex);
    }
  }
  let summary: ImportSummary;
  try {
    summary = await post<ImportSummary>(`${base}/complete`);
  } catch (error) {
    throw new ImportError("complete", codeOf(error));
  }
  await syncNow();
  return summary;
}
