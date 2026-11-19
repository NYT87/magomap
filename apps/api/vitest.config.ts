import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("../../packages/db/migrations/sqlite", import.meta.url)),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml", environment: "d1" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            KAKAO_REST_API_KEY: "test-rest-key",
            KAKAO_CLIENT_SECRET: "test-client-secret",
            MAGOMAP_IMPORT_SECRET: "m".repeat(48),
            ALLOWED_KAKAO_USER_IDS: "111,222",
            ALLOW_DEV_LOGIN: "true",
            KAKAO_JAVASCRIPT_KEY: "test-js-key",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
