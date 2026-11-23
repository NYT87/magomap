import { expect, type Page, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setLanguage, setRootSize, setVariant } from "./helpers";

// Layouts at the cap (a 32px root = 2x text), phone only, in English and Korean.
const CAP = 32;
const SCREENS = [
  { name: "Map", path: "/", ready: ".mm-map-top .mm-search__box" },
  { name: "Lists", path: "/lists", ready: ".mm-page__title" },
  { name: "Account", path: "/account", ready: ".mm-page__title" },
  { name: "a place page", path: `/places/${BADA}`, ready: ".mm-section__title" },
] as const;

// Map pins and clusters and the map providers' controls are out of scope.
const MAP_PARTS = ".leaflet-container, .marker-cluster, .mm-pin-host";

async function openSyncSheet(page: Page) {
  await page.locator('.mm-map-tools button[aria-haspopup="dialog"]').click();
  await page.locator(".mm-sheet").waitFor();
}

async function cutOff(page: Page) {
  return page.evaluate((mapParts) => {
    const sel =
      "button, .mm-chip__name, .mm-switch__name, .mm-nav__item, .mm-note, h1, h2, h3, h4, .mm-picker__title, a";
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest(mapParts) || el.offsetParent === null) continue;
      if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className || el.tagName}`);
    }
    if (document.documentElement.scrollWidth > innerWidth) bad.push("page scrolls sideways");
    return bad;
  }, MAP_PARTS);
}

async function smallTargets(page: Page) {
  return page.evaluate((mapParts) => {
    const bad: string[] = [];
    const sel = "button, a, [role=switch], select, input";
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest(mapParts)) continue;
      const r = (el.closest("label") ?? el).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5)
        bad.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  }, MAP_PARTS);
}

async function showAtCap(page: Page, path: string, ready: string) {
  await page.goto(path);
  await page.locator(ready).first().waitFor();
  await setRootSize(page, CAP);
}

for (const lang of ["en", "ko"] as const) {
  test.describe(`at the cap, ${lang}`, () => {
    test.beforeEach(async ({ page, context }, info) => {
      if (info.project.name !== "phone") return;
      await setVariant(page, { name: "base" });
      await devLogin(context, "222");
      await importFromKakao(page);
      await setLanguage(page, lang);
    });

    test("the map buttons start below the search bar at the cap", async ({ page }, info) => {
      if (info.project.name !== "phone") return;
      await showAtCap(page, "/", ".mm-map-top .mm-search__box");
      const box = await page.locator(".mm-map-top .mm-search__box").boundingBox();
      const tools = await page.locator(".mm-map-tools").boundingBox();
      expect(tools?.y ?? 0).toBeGreaterThan((box?.y ?? 0) + (box?.height ?? 0));
    });

    test("the map keeps at least half the screen at the cap", async ({ page }, info) => {
      if (info.project.name !== "phone") return;
      await showAtCap(page, "/", ".mm-map-top .mm-search__box");
      const search = await page.locator(".mm-map-top .mm-search__box").boundingBox();
      const nav = await page.locator(".mm-nav").boundingBox();
      const hasNote = (await page.locator(".mm-map-notes .mm-note").count()) > 0;
      const notes = hasNote ? await page.locator(".mm-map-notes").boundingBox() : null;
      const height = page.viewportSize()?.height ?? 0;
      const used =
        (search?.y ?? 0) + (search?.height ?? 0) + (nav?.height ?? 0) + (notes?.height ?? 0);
      expect(height - used).toBeGreaterThanOrEqual(422);
    });

    test("nothing is cut off at the cap", async ({ page }, info) => {
      if (info.project.name !== "phone") return;
      for (const s of SCREENS) {
        await showAtCap(page, s.path, s.ready);
        expect(await cutOff(page), s.name).toEqual([]);
      }
      await showAtCap(page, "/", ".mm-map-top .mm-search__box");
      await openSyncSheet(page);
      expect(await cutOff(page), "Sync sheet").toEqual([]);
    });

    test("tap targets stay at least 44px at the cap", async ({ page }, info) => {
      if (info.project.name !== "phone") return;
      for (const s of SCREENS) {
        await showAtCap(page, s.path, s.ready);
        expect(await smallTargets(page), s.name).toEqual([]);
      }
      await showAtCap(page, "/", ".mm-map-top .mm-search__box");
      await openSyncSheet(page);
      expect(await smallTargets(page), "Sync sheet").toEqual([]);
    });

    test("the Sync sheet scrolls at the cap", async ({ page }, info) => {
      if (info.project.name !== "phone") return;
      await showAtCap(page, "/", ".mm-map-top .mm-search__box");
      await openSyncSheet(page);
      await page.locator(".mm-sheet__body").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const close = page.locator(".mm-sheet .mm-icon-button");
      await close.scrollIntoViewIfNeeded();
      await expect(close).toBeInViewport();
      const sheet = await page.locator(".mm-sheet").boundingBox();
      expect((sheet?.y ?? 0) + (sheet?.height ?? 0)).toBeLessThanOrEqual(
        (page.viewportSize()?.height ?? 0) + 1,
      );
      const actions = page.locator(".mm-sheet__body button");
      if ((await actions.count()) > 0) {
        await actions.last().scrollIntoViewIfNeeded();
        await expect(actions.last()).toBeInViewport();
      }
    });
  });
}
