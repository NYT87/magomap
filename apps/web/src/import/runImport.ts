// Driving an import run from the app: each list's pages, its finish, then the run's complete.
// The Kakao Map sync (kakaoMap.ts) sends the pages; `post` and `codeOf` are shared with
// duplicating a list to Kakao Map.
import { type ApiErrorCode, type ImportSummary, LIMITS } from "@magomap/domain";
import { ACCOUNT_HEADER, ApiError, apiFetch, NetworkError, UnauthorizedError } from "../api/client";
import { syncNow } from "../data/sync";

export type ImportStep = "list" | "complete";

export class ImportError extends Error {
  constructor(
    readonly step: ImportStep,
    readonly code?: ApiErrorCode | "offline" | "signed_out",
    readonly listIndex?: number,
  ) {
    super(`Import failed at ${step}${code ? `: ${code}` : ""}`);
  }
}

export const codeOf = (error: unknown): ImportError["code"] => {
  if (error instanceof ApiError) return error.code;
  if (error instanceof NetworkError) return "offline";
  if (error instanceof UnauthorizedError) return "signed_out";
  return undefined;
};

/** A dropped connection or a busy server gets one more try; anything else stops the import. */
const retryable = (error: unknown) =>
  error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);

/** Posts for `account`, sending the request once more if the connection drops or the server is busy. */
export async function post<T>(account: string, path: string, body?: unknown): Promise<T> {
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

/** A run's lists, as its start answered them. */
export type RunLists = { externalId: string; name: string; itemCount: number }[];

/** A run the app drives list by list. */
export interface DrivenRun {
  runId: string;
  lists: RunLists;
}

/**
 * Every list's pages in order, its finish, then the run's complete and the following sync.
 * `sendPage` sends one page of a list, given the list's run path; `done` ends the list early.
 * If anything fails, the run is never completed, so nothing is marked as removed from Kakao.
 */
export async function driveRun(
  account: string,
  run: DrivenRun,
  onProgress: (p: { listIndex: number; listCount: number }) => void,
  sendPage: (listPath: string, page: number, list: RunLists[number]) => Promise<{ done: boolean }>,
): Promise<ImportSummary> {
  const base = `/api/import/runs/${encodeURIComponent(run.runId)}`;
  for (const [listIndex, list] of run.lists.entries()) {
    onProgress({ listIndex, listCount: run.lists.length });
    const at = `${base}/lists/${encodeURIComponent(list.externalId)}`;
    try {
      const pageCount = Math.max(1, Math.ceil(list.itemCount / LIMITS.importChunkItems));
      for (let page = 0; page < pageCount; page++) {
        const res = await sendPage(at, page, list);
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
