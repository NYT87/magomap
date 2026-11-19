import type { BrowserContext, Page } from "@playwright/test";

export const KAKAO_LIST = "http://localhost:8788";

export async function devLogin(context: BrowserContext, kakaoUserId: string) {
  const res = await context.request.post("/api/auth/dev", {
    data: { kakaoUserId, nickname: "tester" },
  });
  if (!res.ok()) throw new Error(`dev login ${res.status()}`);
}

export async function setVariant(page: Page, variant: unknown) {
  await page.request.post(`${KAKAO_LIST}/__variant`, { data: variant });
}

/** Runs an import from the Import screen and waits for its summary. */
export async function importFromKakao(page: Page) {
  await page.goto("/import");
  await page.getByRole("button", { name: /Import (from Kakao|again)/ }).click();
  await page.getByText("Import finished").waitFor({ timeout: 30_000 });
}

export const BADA = "p_kakao_27324155"; // 바다정원 카페, favourite 9001 in 제주 카페, with a kakao-list note
