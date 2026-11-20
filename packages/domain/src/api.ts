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
  | "account_mismatch";
