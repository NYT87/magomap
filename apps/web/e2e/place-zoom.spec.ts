import { expect, type Page, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

// Opening a place: zoomed out it zooms in to 16 on it; closer than that the map stays put when
// the place is on screen, and otherwise moves to it keeping the zoom (src/map/applyFocus.ts).
const MYEONGDONG = "p_kakao_11223344"; // 명동 칼국수, Seoul: far from 바다정원 카페 in Jeju

/** The zoom of the tiles Leaflet shows now (the front level), read from their URLs. */
const zoomOf = (page: Page) =>
  page.evaluate(() => {
    const levels = [...document.querySelectorAll<HTMLElement>(".leaflet-tile-container")];
    levels.sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
    const tile = levels[0]?.querySelector<HTMLImageElement>("img.leaflet-tile");
    const m = tile?.src.match(/\/(\d+)\/\d+\/\d+\.png/);
    return m ? Number(m[1]) : null;
  });

const pin = (page: Page, title: string) =>
  page.locator(`.leaflet-marker-icon.mm-pin-host--saved[title^="${title}"]`);

/** Waits until the selected pin has stood still for three readings in a row (glides finished). */
async function settled(page: Page) {
  const selected = page.locator(".mm-pin--selected");
  let before = await selected.boundingBox();
  let stillFor = 0;
  await expect(async () => {
    const now = await selected.boundingBox();
    stillFor = JSON.stringify(now) === JSON.stringify(before) ? stillFor + 1 : 0;
    before = now;
    expect(stillFor).toBeGreaterThanOrEqual(3);
  }).toPass({ intervals: [400], timeout: 20_000 });
  return before;
}

/** Opens a place inside the app (no reload), as a list row or search does. */
const openInApp = (page: Page, id: string) =>
  page.evaluate((to) => {
    history.pushState(null, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/places/${id}`);

test.beforeEach(async ({ page, context }) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
  await page.goto("/");
  await expect(pin(page, "바다정원 카페")).toBeAttached({ timeout: 20_000 });
});

test("zoomed out, opening a place zooms in to it", async ({ page }) => {
  await expect.poll(() => zoomOf(page)).toBeLessThan(16);
  await pin(page, "바다정원 카페").dispatchEvent("click");
  await expect.poll(() => zoomOf(page), { timeout: 15_000 }).toBe(16);
});

test("zoomed in, opening a place that is on screen doesn't move the map", async ({ page }) => {
  await openInApp(page, BADA);
  await expect.poll(() => zoomOf(page), { timeout: 15_000 }).toBe(16);
  const before = await settled(page);
  // The same place again, from the map: it is on screen, so nothing moves.
  await page.evaluate(() => {
    history.pushState(null, "", "/");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(100);
  await openInApp(page, BADA);
  await page.waitForTimeout(1200);
  expect(await page.locator(".mm-pin--selected").boundingBox()).toEqual(before);
  expect(await zoomOf(page)).toBe(16);
});

test("zoomed in, opening a place off screen moves to it and keeps the zoom", async ({ page }) => {
  await openInApp(page, BADA);
  await expect.poll(() => zoomOf(page), { timeout: 15_000 }).toBe(16);
  await settled(page);
  await openInApp(page, MYEONGDONG);
  await expect(pin(page, "명동 칼국수")).toBeAttached({ timeout: 15_000 });
  await settled(page);
  expect(await zoomOf(page)).toBe(16);
  await expect(page.locator(".mm-pin--selected")).toBeInViewport();
});
