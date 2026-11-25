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

/** A place near a point on the map: a signed search result, and how far it is from the point. */
export interface NearbyResult {
  result: SearchResult;
  /** Metres from the point; outside the signature. */
  distanceM: number;
}

export interface ImportRunInfo {
  runId: string;
  status: "running" | "completed" | "failed" | "superseded";
  startedAt: number;
  finishedAt: number | null;
  summary: ImportSummary | null;
  /**
   * When the run's read was taken (epoch ms): for a Kakao Map sync, when it started; a run left
   * by the old kakao-list import keeps that sync's time.
   */
  snapshotAt: number;
  /** Where the run read from: Kakao Map through the extension, or (runs from before) kakao-list. */
  source?: "kakao_list" | "kakao_map";
  /** Only on a running run. */
  progress?: { listsDone: number; listCount: number };
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
  | "search_unavailable"
  | "rate_limited"
  | "run_closed"
  | "list_conflict"
  | "incomplete"
  | "account_gone"
  | "busy"
  | "not_found"
  | "invalid"
  | "account_mismatch"
  | "too_large"
  | "not_allowed"
  | "kakao_signed_out"
  | "kakao_account_unconfirmed"
  | "kakao_account_mismatch"
  | "kakao_account_taken"
  | "kakao_account_unclear"
  | "not_owner"
  | "owner_unknown";

/** The Kakao Map account a read came from, as a 409 names it: never the full account id. */
export interface KakaoMapAccountHint {
  nickname?: string;
  /** The last 4 characters of the Kakao Map user id. */
  idTail: string;
}
