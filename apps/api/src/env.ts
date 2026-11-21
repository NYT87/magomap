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
  /** "true" lets any signed-in user upload a Kakao Map read: local dev and tests only. */
  ALLOW_DEV_UPLOAD: string;
  SEARCH_LIMITER?: RateLimit;
  /** Set by the release deploy; a Worker without them reports a dev build. */
  APP_VERSION?: string;
  APP_COMMIT?: string;
  APP_BUILT_AT?: string;
}

export interface Vars {
  db: Db;
  userId: string;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
