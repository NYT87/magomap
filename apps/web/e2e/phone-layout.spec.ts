import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { devLogin, setVariant } from "./helpers";

const GUTTER = 16;

/** The e2e database keeps its places between tests, and a second import has nothing new to bring. */
async function ensureImported(page: Page) {
  const statusLoaded = page.waitForResponse("**/api/import/status");
  await page.goto("/account");
  const status: { upToDate?: boolean } = await (await statusLoaded).json();
  if (status.upToDate === true) return;
  await page.getByRole("button", { name: /Import (from kakao-list|again)/ }).click();
  await page.getByText("Import finished").waitFor({ timeout: 30_000 });
}

async function openMap(page: Page, context: BrowserContext) {
  await setVariant(page, { name: "base" });
  await devLogin(context, "111");
  await ensureImported(page);
  await page.goto("/");
  await expect(page.locator(".mm-map-top .mm-search__box")).toBeVisible();
}

test("the search bar spans the screen on phones", async ({ page, context }, info) => {
  if (info.project.name !== "phone") return;
  await openMap(page, context);
  const box = await page.locator(".mm-map-top .mm-search__box").boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box).not.toBeNull();
  expect(Math.abs((box?.x ?? 0) - GUTTER)).toBeLessThanOrEqual(1);
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) - (width - GUTTER))).toBeLessThanOrEqual(1);
});

test("the map buttons start below the search bar", async ({ page, context }, info) => {
  if (info.project.name !== "phone") return;
  await openMap(page, context);
  const top = await page.locator(".mm-map-top").boundingBox();
  const tools = await page.locator(".mm-map-tools").boundingBox();
  expect(tools?.y ?? 0).toBeGreaterThan((top?.y ?? 0) + (top?.height ?? 0));
});

test("the list view isn't covered by the map buttons", async ({ page, context }, info) => {
  if (info.project.name !== "phone") return;
  await openMap(page, context);
  await page.getByRole("button", { name: "Show as a list" }).click();
  const row = await page.locator(".mm-places__list li").first().boundingBox();
  const tools = await page.locator(".mm-map-tools").boundingBox();
  expect(row).not.toBeNull();
  expect((row?.x ?? 0) + (row?.width ?? 0)).toBeLessThan(tools?.x ?? 0);
});

test("search results fit the screen", async ({ page, context }, info) => {
  if (info.project.name !== "phone") return;
  await openMap(page, context);
  await page.getByRole("searchbox").fill("바다");
  const results = page.locator(".mm-search__results");
  await expect(results).toBeVisible();
  const box = await results.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - GUTTER + 1);
});

test("a long header title wraps instead of being clipped, and the sync icon stays on screen", async ({
  page,
  context,
}, info) => {
  if (info.project.name !== "phone") return;
  await devLogin(context, "111");
  await page.goto("/account");
  const title = page.locator(".mm-page__header h1");
  await expect(title).toBeVisible();
  const header = page.locator(".mm-page__header");
  const before = (await header.boundingBox())?.height ?? 0;
  await title.evaluate((el) => {
    el.textContent = "A much longer title that cannot possibly fit on one line of a phone";
  });
  const clipped = await title.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(false);
  const after = (await header.boundingBox())?.height ?? 0;
  expect(after).toBeGreaterThan(before);
  expect(after).toBeGreaterThan(44);
  const icon = await page.locator(".mm-page__header button").last().boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(icon).not.toBeNull();
  expect((icon?.x ?? 0) + (icon?.width ?? 0)).toBeLessThanOrEqual(width);
  expect(icon?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(icon?.width ?? 0).toBeGreaterThanOrEqual(44);
});
