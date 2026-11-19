import type { Db } from "@magomap/db";

export interface Env {
  DB_DRIVER: "d1" | "postgres";
  DB?: D1Database;
  HYPERDRIVE?: Hyperdrive;
  KAKAO_REST_API_KEY: string;
  KAKAO_CLIENT_SECRET: string;
  KAKAO_REDIRECT_URI: string;
  KAKAO_JAVASCRIPT_KEY: string;
  ALLOWED_KAKAO_USER_IDS: string;
  KAKAO_LIST_URL: string;
  MAGOMAP_IMPORT_SECRET: string;
  /** Signs search results (≥ 32 characters). */
  SIGNING_SECRET: string;
  ALLOW_DEV_LOGIN: string;
  SEARCH_LIMITER?: RateLimit;
}

export interface Vars {
  db: Db;
  userId: string;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
