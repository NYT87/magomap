import type { BrowserContext, Page } from "@playwright/test";

export const KAKAO_LIST = `http://localhost:${process.env.E2E_FAKE_PORT ?? 8788}`;

export async function devLogin(context: BrowserContext, kakaoUserId: string) {
  const res = await context.request.post("/api/auth/dev", {
    data: { kakaoUserId, nickname: "tester" },
  });
  if (!res.ok()) throw new Error(`dev login ${res.status()}`);
}

export async function setVariant(page: Page, variant: unknown) {
  await page.request.post(`${KAKAO_LIST}/__variant`, { data: variant });
}

/** Runs an import of a new kakao-list sync (in Account) and waits for its summary. */
export async function importFromKakao(page: Page) {
  await page.request.post(`${KAKAO_LIST}/__resync`);
  await page.goto("/account");
  // The page keeps showing the previous import's "Import finished", so wait for this run's own
  // start and completion; a refused start (e.g. "up to date") fails here with its status.
  const started = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/import/runs",
  );
  const completed = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/import\/runs\/[^/]+\/complete$/.test(new URL(r.url()).pathname),
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /Import (from kakao-list|again)/ }).click();
  const start = await started;
  if (!start.ok())
    throw new Error(`The import didn't start: ${start.status()} ${await start.text()}`);
  const done = await completed;
  if (!done.ok()) throw new Error(`The import didn't complete: ${done.status()}`);
  await page.getByText("Import finished").waitFor({ timeout: 30_000 });
}

export const BADA = "p_kakao_27324155"; // 바다정원 카페, favourite 9001 in 제주 카페, with a kakao-list note

/** Sets the page's root font size, as the device's text size would. */
export async function setRootSize(page: Page, px: number) {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${size}px`;
  }, px);
}

/** Stores the app's language choice (read at start-up), before the next page load. */
export async function setLanguage(page: Page, lang: "en" | "ko") {
  await page.addInitScript((value) => {
    localStorage.setItem("mm.lang", value);
  }, lang);
}
