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

export interface SearchResult {
  kakaoPlaceId: string;
  title: string;
  address: string | null;
  roadAddress: string | null;
  category: string | null;
  phone: string | null;
  lat: number;
  lng: number;
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
  | "run_closed";
