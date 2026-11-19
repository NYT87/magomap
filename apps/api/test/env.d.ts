declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    DB_DRIVER: "d1" | "postgres";
    KAKAO_REST_API_KEY: string;
    KAKAO_CLIENT_SECRET: string;
    KAKAO_REDIRECT_URI: string;
    KAKAO_JAVASCRIPT_KEY: string;
    ALLOWED_KAKAO_USER_IDS: string;
    KAKAO_LIST_URL: string;
    MAGOMAP_IMPORT_SECRET: string;
    SIGNING_SECRET: string;
    ALLOW_DEV_LOGIN: string;
  }
}
