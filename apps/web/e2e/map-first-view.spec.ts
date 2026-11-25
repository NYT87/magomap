import { expect, test } from "@playwright/test";
import { BADA, devLogin, syncFromKakao } from "./helpers";

type Calls = { views: number[]; fits: number };

/** The signed-in account's remembered fit (kept under its user id, mm.mapFit.<id>). */
const fitMemo = () => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("mm.mapFit."));
  return key ? localStorage.getItem(key) : null;
};

// Coming back to the map, it opens where it settled last time (fitted to the saved places)
// instead of opening at a default view and then fitting: on the Kakao map that jump is a layout
// shift, and the first tiles are thrown away.
test("the map opens where it fitted last time, without fitting again", async ({
  page,
  context,
}) => {
  await devLogin(context, "222");
  await syncFromKakao(page);
  await page.goto("/");
  await expect(page.locator(".mm-pin-host--saved, .marker-cluster").first()).toBeAttached({
    timeout: 20_000,
  });
  // The first fit settles and is remembered.
  await expect.poll(() => page.evaluate(fitMemo), { timeout: 15_000 }).not.toBeNull();
  const memo = JSON.parse((await page.evaluate(fitMemo)) ?? "{}") as { view: { zoom: number } };

  // On the next visit, every view the map is set to and every fit, from Leaflet's own calls
  // (the app puts Leaflet on window.L when it loads it).
  await page.addInitScript(() => {
    const calls: Calls = { views: [], fits: 0 };
    (window as unknown as { mapCalls: Calls }).mapCalls = calls;
    let lib: unknown;
    Object.defineProperty(window, "L", {
      configurable: true,
      get: () => lib,
      set(v: { Map: { prototype: Record<string, (...a: unknown[]) => unknown> } }) {
        lib = v;
        const p = v.Map.prototype;
        const setView = p.setView as (...a: unknown[]) => unknown;
        const fitBounds = p.fitBounds as (...a: unknown[]) => unknown;
        p.setView = function (this: unknown, ...a: unknown[]) {
          calls.views.push(a[1] as number);
          return setView.apply(this, a);
        };
        p.fitBounds = function (this: unknown, ...a: unknown[]) {
          calls.fits++;
          return fitBounds.apply(this, a);
        };
      },
    });
  });
  await page.reload();
  await expect(page.locator(".mm-pin-host--saved, .marker-cluster").first()).toBeAttached({
    timeout: 20_000,
  });
  await page.waitForTimeout(1_500);
  const calls = await page.evaluate(() => (window as unknown as { mapCalls: Calls }).mapCalls);
  expect(calls.views[0]).toBe(memo.view.zoom);
  expect(calls.fits).toBe(0);
});

// Opening a place by its link zooms to that place: that view isn't remembered as the places'
// fit, or the next visit to the map would open on that one place.
test("a place opened by its link isn't remembered as the map's view", async ({ page, context }) => {
  await devLogin(context, "222");
  await syncFromKakao(page);
  await page.goto(`/places/${BADA}`);
  await expect(page.locator(".mm-pin--selected")).toBeAttached({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await page.goto("/");
  await expect(page.locator(".mm-pin-host--saved, .marker-cluster").first()).toBeAttached({
    timeout: 20_000,
  });
  await expect.poll(() => page.evaluate(fitMemo), { timeout: 15_000 }).not.toBeNull();
  const memo = JSON.parse((await page.evaluate(fitMemo)) ?? "{}") as { view: { zoom: number } };
  // All the places, Seoul to Jeju: far out, not the place's close-up (16).
  expect(memo.view.zoom).toBeLessThan(12);
});
