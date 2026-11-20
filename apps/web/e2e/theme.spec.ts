import { expect, test } from "@playwright/test";

// Emulating the device's colour scheme: https://playwright.dev/docs/api/class-page#page-emulate-media
// Init scripts that run before the page's own: https://playwright.dev/docs/api/class-page#page-add-init-script
const DARK_BG = "rgb(20, 24, 22)";
const LIGHT_BG = "rgb(251, 248, 242)";
const bodyBg = () => getComputedStyle(document.body).backgroundColor;
const bar = () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

test("a chosen dark theme opens dark with no flash", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("mm.theme", "dark"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(bodyBg)).toBe(DARK_BG);
  expect(await page.evaluate(bar)).toBe("#141816");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    "dark",
  );
  await page.screenshot({
    path: `../../.superpowers/sdd/2026-11-20-theme-choice/screens/task-1/${test.info().project.name}-dark-chosen-on-light-device.png`,
  });
});

test("a chosen light theme beats a dark device", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("mm.theme", "light"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(bodyBg)).toBe(LIGHT_BG);
  expect(await page.evaluate(bar)).toBe("#1F6F5C");
});

test("the device's theme is the default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect(await page.evaluate(bodyBg)).toBe(DARK_BG);
  expect(await page.evaluate(bar)).toBe("#141816");
  await page.screenshot({
    path: `../../.superpowers/sdd/2026-11-20-theme-choice/screens/task-1/${test.info().project.name}-default-on-dark-device.png`,
  });
});
