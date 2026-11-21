// Sync from Kakao Map: the magomap extension reads her Kakao Map lists in this browser, and this
// page uploads that read through an upload run (start, each list's pages of ≤ 500 favourites,
// finish, complete). The read stays in this page's memory only, never stored and never logged.
// All interpretation of the raw records is the server's (and the domain adapter's).
import {
  type ApiErrorCode,
  type ImportSummary,
  type KakaoMapAccountHint,
  LIMITS,
} from "@magomap/domain";
import { kakaoFolderIdOf } from "@magomap/domain/providers/kakao";
import { ApiError } from "../api/client";
import { currentDb, dbUserId } from "../data/db";
import { codeOf, driveRun, ImportError, post, type ResumeLists } from "./runImport";

/** The extension's id (apps/extension/src/extensionId.ts); overridable for a differently keyed build. */
const EXTENSION_ID =
  import.meta.env.VITE_MAGOMAP_EXTENSION_ID || "eccgkehfioodkgllihgbgkgfcifmghif";

/** How long the extension has to answer a ping before it counts as missing. */
const PING_TIMEOUT_MS = 1500;
/** The extension gives up on a read after 5 minutes; this page waits a little longer. */
const READ_TIMEOUT_MS = 6 * 60_000;

export type ExtensionState = "missing" | "ready";

export type KakaoMapSyncCode =
  | ApiErrorCode
  | "kakao_signed_out"
  | "kakao_unavailable"
  | "busy"
  | "offline"
  | "signed_out";

export class KakaoMapSyncError extends Error {
  constructor(
    /** Undefined when the failure has no known reason (an unexpected answer). */
    readonly code: KakaoMapSyncCode | undefined,
    /** The account a `kakao_account_*` refusal names: nickname and the id's last 4 characters. */
    readonly account?: KakaoMapAccountHint,
    /** On a mismatch, the account she synced from before, named the same way. */
    readonly bound?: KakaoMapAccountHint,
  ) {
    super(`Kakao Map sync failed${code ? `: ${code}` : ""}`);
    this.name = "KakaoMapSyncError";
  }
}

interface ChromeRuntime {
  sendMessage(id: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: unknown;
}

/** `chrome.runtime` as a web page sees it: there only when an extension lets this page talk to it. */
const runtime = (): ChromeRuntime | undefined => {
  const chrome = (globalThis as { chrome?: { runtime?: Partial<ChromeRuntime> } }).chrome;
  const r = chrome?.runtime;
  return typeof r?.sendMessage === "function" ? (r as ChromeRuntime) : undefined;
};

/** Sends one message to the extension; undefined when it isn't there or doesn't answer in time. */
function send(message: { type: string }, timeoutMs: number): Promise<unknown> {
  const r = runtime();
  if (!r) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      r.sendMessage(EXTENSION_ID, message, (response) => {
        clearTimeout(timer);
        // Reading lastError tells Chrome it was handled (no extension with this id, for one).
        resolve(r.lastError ? undefined : response);
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether the magomap extension answers in this browser. */
export async function detectExtension(): Promise<ExtensionState> {
  const answer = await send({ type: "magomap.ping" }, PING_TIMEOUT_MS);
  return isRecord(answer) && answer.ok === true ? "ready" : "missing";
}

/** A read as the extension hands it over: raw records, never looked into here. */
interface Read {
  start: { folders: unknown[]; counts: { folderid: number; itemCount: number }[] };
  favorites: Record<string, unknown[]>;
}

async function readKakaoMap(): Promise<Read> {
  const answer = await send({ type: "magomap.read" }, READ_TIMEOUT_MS);
  if (isRecord(answer) && answer.ok === false) {
    const error = answer.error;
    if (error === "kakao_signed_out" || error === "busy") throw new KakaoMapSyncError(error);
    throw new KakaoMapSyncError("kakao_unavailable");
  }
  if (
    !isRecord(answer) ||
    answer.ok !== true ||
    !isRecord(answer.start) ||
    !Array.isArray(answer.start.folders) ||
    !Array.isArray(answer.start.counts) ||
    !isRecord(answer.favorites)
  ) {
    throw new KakaoMapSyncError("kakao_unavailable");
  }
  return answer as unknown as Read;
}

/**
 * The read a `kakao_account_*` refusal stopped, kept so confirming it doesn't read Kakao Map
 * again. Only in memory, only for the magomap account it was read for.
 */
let pending: { account: string; read: Read } | null = null;

/** Drops the read kept for a confirmation (she cancelled, or it was used). */
export function forgetKakaoMapRead() {
  pending = null;
}

/** The adapter couldn't be loaded (the connection dropped): the confirmation can't go out yet. */
class AdapterUnavailable extends Error {}

/** The read's Kakao Map account id, as the server decides it; undefined when it can't tell. */
async function accountIdOf(read: Read): Promise<string | undefined> {
  // Loaded only to confirm an account: the adapter brings the coordinate library along.
  let adapter: typeof import("@magomap/domain/providers/kakaoMap");
  try {
    adapter = await import("@magomap/domain/providers/kakaoMap");
  } catch {
    throw new AdapterUnavailable();
  }
  try {
    // The login id only shapes folder 0's list id, which isn't used here.
    return adapter.kakaoMapListsToImport(read.start, "-").account.kakaoMapUserId;
  } catch {
    return undefined;
  }
}

/** A refusal's account hint, read leniently. */
const hintOf = (value: unknown): KakaoMapAccountHint | undefined =>
  isRecord(value) && typeof value.idTail === "string"
    ? {
        ...(typeof value.nickname === "string" ? { nickname: value.nickname } : {}),
        idTail: value.idTail,
      }
    : undefined;

/**
 * Reads her Kakao Map once through the extension and uploads it: the start, each list's pages
 * (that folder's favourites, 500 at a time, in order), finish and complete, then a sync, with the
 * same single retry per request as runImport. A `kakao_account_*` refusal throws with the account
 * it names; calling again with `confirmAccount` (the last 4 characters she was shown) reuses that
 * read and confirms its account, whose full id never leaves this module.
 */
export async function runKakaoMapSync(
  onProgress: (p: { listIndex: number; listCount: number }) => void,
  opts: { account?: string; confirmAccount?: string } = {},
): Promise<ImportSummary> {
  const account = opts.account ?? dbUserId(currentDb());
  const kept = pending?.account === account ? pending.read : null;
  pending = null;
  // A confirmation applies only to the read she was shown; anything else reads again.
  let keptId: string | undefined;
  try {
    keptId = kept && opts.confirmAccount !== undefined ? await accountIdOf(kept) : undefined;
  } catch {
    // Keep the read, so confirming again once she's back online still uses it.
    pending = kept ? { account, read: kept } : null;
    throw new KakaoMapSyncError("offline");
  }
  const confirmAccount =
    keptId !== undefined && keptId.slice(-4) === opts.confirmAccount ? keptId : undefined;
  const read = confirmAccount && kept ? kept : await readKakaoMap();

  let run: { runId: string; lists: { externalId: string; name: string; itemCount: number }[] };
  try {
    run = await post(account, "/api/import/kakao-map/runs", {
      ...read.start,
      ...(confirmAccount ? { confirmAccount } : {}),
    });
  } catch (error) {
    const code = codeOf(error);
    if (
      error instanceof ApiError &&
      (code === "kakao_account_unconfirmed" || code === "kakao_account_mismatch")
    ) {
      pending = { account, read };
      const body = isRecord(error.body) ? error.body : {};
      throw new KakaoMapSyncError(
        code,
        hintOf(body.account) ?? { idTail: "" },
        code === "kakao_account_mismatch" ? hintOf(body.bound) : undefined,
      );
    }
    // A confirmation that couldn't go out: keep the read, so confirming again once she's back
    // online sends the same read she was shown.
    if (code === "offline" && confirmAccount) pending = { account, read };
    throw new KakaoMapSyncError(code);
  }

  const lists: ResumeLists = run.lists.map((l) => ({ ...l, pagesDone: 0, finished: false }));
  const runPath = `/api/import/kakao-map/runs/${encodeURIComponent(run.runId)}`;
  try {
    return await driveRun(account, { runId: run.runId, lists }, onProgress, (_at, page, list) => {
      // The server reads a page as the favourites of the folder its list id names.
      const folderId = kakaoFolderIdOf(list.externalId);
      const all = folderId === undefined ? [] : (read.favorites[String(folderId)] ?? []);
      const size = LIMITS.importChunkItems;
      const favorites = all.slice(page * size, (page + 1) * size);
      return post(
        account,
        `${runPath}/lists/${encodeURIComponent(list.externalId)}/pages/${page}`,
        {
          favorites,
        },
      );
    });
  } catch (error) {
    throw new KakaoMapSyncError(error instanceof ImportError ? error.code : codeOf(error));
  }
}
