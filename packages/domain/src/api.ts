import type { ImportSummary } from "./importContract";

export interface Me {
  userId: string;
  displayName: string | null;
  identities: { provider: "kakao" | "google" }[];
}

export interface PublicConfig {
  kakaoJavascriptKey: string | null;
  devLoginEnabled: boolean;
}

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string | null;
}

export interface SearchResult {
  provider: string;
  externalId: string;
  title: string;
  address: string | null;
  roadAddress: string | null;
  category: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  /** When the server signed this result, and its signature; pushed places must carry both. */
  signedAt: number;
  signature: string;
}

export interface ImportRunInfo {
  runId: string;
  status: "running" | "completed" | "failed" | "superseded";
  startedAt: number;
  finishedAt: number | null;
  summary: ImportSummary | null;
  /** The kakao-list sync (epoch ms) the run was read from; for a Kakao Map sync, when it started. */
  snapshotAt: number;
  /** Where the run read from: kakao-list, or Kakao Map through the extension (a direct sync). */
  source?: "kakao_list" | "kakao_map";
  /** Only on a running run. */
  progress?: { listsDone: number; listCount: number };
}

export interface ImportStatus {
  latest: ImportRunInfo | null;
  /** kakao-list's current sync for this account; null when it has none or couldn't be reached. */
  sourceSnapshotAt: number | null;
  upToDate: boolean;
  /** Why `sourceSnapshotAt` is null: kakao-list has no snapshot for this account, or couldn't be read. */
  source: "ok" | "no_snapshot" | "unavailable";
}

export interface ResumeList {
  externalId: string;
  name: string;
  itemCount: number;
  pagesDone: number;
  finished: boolean;
}

export interface ResumeRun {
  runId: string;
  lists: ResumeList[];
}

export type ApiErrorCode =
  | "no_snapshot"
  | "kakao_list_unavailable"
  | "search_unavailable"
  | "rate_limited"
  | "run_closed"
  | "snapshot_changed"
  | "list_conflict"
  | "incomplete"
  | "account_gone"
  | "busy"
  | "not_found"
  | "invalid"
  | "account_mismatch"
  | "up_to_date"
  | "too_large"
  | "not_allowed"
  | "kakao_signed_out"
  | "kakao_account_unconfirmed"
  | "kakao_account_mismatch"
  | "kakao_account_taken"
  | "kakao_account_unclear";

/** The Kakao Map account a read came from, as a 409 names it: never the full account id. */
export interface KakaoMapAccountHint {
  nickname?: string;
  /** The last 4 characters of the Kakao Map user id. */
  idTail: string;
}
