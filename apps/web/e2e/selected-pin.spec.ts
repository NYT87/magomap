import { expect, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

test.beforeEach(async ({ page, context }) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
});

const selectedPin = (page: import("@playwright/test").Page) => page.locator(".mm-pin--selected");

test("the open place's pin stands out", async ({ page }) => {
  await page.goto(`/places/${BADA}`);
  await expect(selectedPin(page)).toHaveCount(1);
  await expect(page.locator(".marker-cluster .mm-pin--selected")).toHaveCount(0);
});

test("zoomed out, it still isn't clustered", async ({ page }) => {
  await page.goto(`/places/${BADA}`);
  await expect(selectedPin(page)).toHaveCount(1);
  await page.locator(".leaflet-container").focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("-");
  await expect(selectedPin(page)).toHaveCount(1);
  await expect(page.locator(".marker-cluster .mm-pin--selected")).toHaveCount(0);
});

test("another place takes over, and closing the place clears it", async ({ page }) => {
  await page.goto(`/places/${BADA}`);
  await expect(selectedPin(page)).toHaveCount(1);
  const first = await selectedPin(page).locator("xpath=..").getAttribute("title");
  await page.goto("/");
  await expect(selectedPin(page)).toHaveCount(0);
  const other = page
    .locator(".leaflet-marker-icon.mm-pin-host--saved")
    .filter({ hasNot: page.locator(".mm-pin--selected") })
    .first();
  await expect(other).toBeVisible();
  await other.click();
  await expect(page).toHaveURL(/\/places\//);
  await expect(page).not.toHaveURL(new RegExp(BADA));
  await expect(selectedPin(page)).toHaveCount(1);
  expect(await selectedPin(page).locator("xpath=..").getAttribute("title")).not.toBe(first);
  await page.goBack();
  await page.goBack();
  await expect(selectedPin(page)).toHaveCount(0);
});
