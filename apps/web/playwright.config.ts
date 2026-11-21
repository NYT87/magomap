import { defineConfig, devices } from "@playwright/test";

// End-to-end: the built app served by a local Worker (fresh D1 each run) and the fake kakao-list.
// https://playwright.dev/docs/test-webserver
// Overridable so two checkouts can run their end-to-end tests at the same time.
const PORT = Number(process.env.E2E_PORT ?? 8790);
const FAKE_PORT = Number(process.env.E2E_FAKE_PORT ?? 8788);
// The fake kakao-list and the Worker must share this secret. Passed to both here, so the
// tests never depend on what apps/api/.dev.vars holds (a real secret there broke every import test).
const IMPORT_SECRET = "m".repeat(48);

// The d1 environment holds the deployed settings; the e2e server uses local stand-ins instead:
// the fake kakao-list, the dev-login test accounts, and no Kakao map key (OpenStreetMap).
const E2E_VARS = [
  "ALLOW_DEV_LOGIN:true",
  `KAKAO_LIST_URL:http://localhost:${FAKE_PORT}`,
  `MAGOMAP_IMPORT_SECRET:${IMPORT_SECRET}`,
  // 444–447: the Kakao Map sync tests, which upload (uploads need a non-empty allowlist).
  "ALLOWED_KAKAO_USER_IDS:111,222,333,444,445,446,447",
  `KAKAO_REDIRECT_URI:http://localhost:${PORT}/api/auth/kakao/callback`,
  "KAKAO_JAVASCRIPT_KEY:",
]
  .map((v) => `--var ${v}`)
  .join(" ");

export default defineConfig({
  testDir: "e2e",
  // Outside the app folder, so lint and git never see test output.
  outputDir: "../../tmp/playwright-results",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "en-US", trace: "retain-on-failure" },
  projects: [
    {
      name: "phone",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: `MAGOMAP_IMPORT_SECRET=${IMPORT_SECRET} FAKE_KAKAO_LIST_PORT=${FAKE_PORT} pnpm --filter @magomap/api dev:fake-kakao-list`,
      url: `http://localhost:${FAKE_PORT}/__health`,
      reuseExistingServer: true,
      ignoreHTTPSErrors: true,
    },
    {
      command: `rm -rf ../../tmp/e2e-state && pnpm build && cd ../api && npx wrangler d1 migrations apply DB --env d1 --local --persist-to ../../tmp/e2e-state && npx wrangler dev --env d1 --persist-to ../../tmp/e2e-state --port ${PORT} ${E2E_VARS}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
