import { expect, type Page, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

test.beforeEach(async ({ page, context }) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
});

const selectedPin = (page: Page) => page.locator(".mm-pin--selected");
const hostOf = (page: Page) => selectedPin(page).locator("xpath=..");
const clusters = (page: Page) => page.locator(".marker-cluster");
/** Saved pins (or clusters of them) are drawn. */
const drawn = (page: Page) =>
  expect(page.locator(".mm-pin-host--saved, .marker-cluster").first()).toBeAttached();

test("the open place's pin stands out", async ({ page }, info) => {
  await page.goto(`/places/${BADA}`);
  await expect(selectedPin(page)).toHaveCount(1);
  // The phone's map is hidden under place pages: there it is only present.
  if (info.project.name === "desktop") await expect(selectedPin(page)).toBeVisible();
  await expect(page.locator(".marker-cluster .mm-pin--selected")).toHaveCount(0);
});

test("zoomed out, it still isn't clustered", async ({ page }) => {
  await page.goto(`/places/${BADA}`);
  await expect(selectedPin(page)).toHaveCount(1);
  // On a phone the map sits hidden under the place page, where a key press can't reach it: show it.
  await page.addStyleTag({ content: ".mm-map[hidden] { visibility: visible !important; }" });
  await page.locator(".leaflet-container").focus();
  // Zoom out until every other saved pin has merged into a cluster: only then does the check mean
  // something (a selected pin that clustered would be gone, or inside a cluster).
  // Far apart (Jeju, Seoul, Busan): they merge only a long way out, so zoom out first.
  for (let i = 0; i < 11; i++) await page.keyboard.press("-");
  await expect(async () => {
    await page.keyboard.press("-");
    await expect(clusters(page).first()).toBeAttached({ timeout: 500 });
    await expect(page.locator(".mm-pin-host--saved:not(:has(.mm-pin--selected))")).toHaveCount(0, {
      timeout: 500,
    });
  }).toPass({ timeout: 25_000 });
  await expect(selectedPin(page)).toHaveCount(1);
  await expect(page.locator(".marker-cluster .mm-pin--selected")).toHaveCount(0);
});

test("another place takes over, and closing the place clears it", async ({ page }) => {
  await page.goto(`/places/${BADA}`);
  await expect(selectedPin(page)).toHaveCount(1);
  const first = await hostOf(page).getAttribute("title");
  await page.goto("/");
  await drawn(page);
  await expect(selectedPin(page)).toHaveCount(0);
  const plain = (first ?? "").replace(/, selected$/, "");
  const other = page.locator(".leaflet-marker-icon.mm-pin-host--saved").filter({
    hasNot: page.locator(`[title="${plain}"]`),
  });
  await expect(other.first()).toBeAttached();
  const clicked = await other.first().getAttribute("title");
  expect(`${clicked}, selected`).not.toBe(first);
  // Dispatched on the pin itself: neighbouring pins' 44 px targets can overlap and take a real click.
  // By title, not `first()` again: the pins are redrawn when the library settles, and the order may change.
  await page
    .locator(`.leaflet-marker-icon.mm-pin-host--saved[title="${clicked}"]`)
    .dispatchEvent("click");
  await expect(page).toHaveURL(/\/places\//);
  await expect(page).not.toHaveURL(new RegExp(BADA));
  await expect(selectedPin(page)).toHaveCount(1);
  // The selected pin's label is the clicked pin's, marked as selected.
  expect(await hostOf(page).getAttribute("title")).toBe(`${clicked}, selected`);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await drawn(page);
  await expect(selectedPin(page)).toHaveCount(0);
});

test("a keyboard user who opens another pin keeps focus on it", async ({ page }, info) => {
  if (info.project.name !== "desktop") return;
  await page.goto(`/places/${BADA}`);
  await expect(selectedPin(page)).toHaveCount(1);
  const first = await hostOf(page).getAttribute("title");
  // The view is close on this place: zoom out until another saved pin is drawn on its own.
  await page.locator(".leaflet-container").focus();
  const others = page.locator(
    ".leaflet-marker-icon.mm-pin-host--saved:not(:has(.mm-pin--selected))",
  );
  await expect(async () => {
    await page.keyboard.press("-");
    await expect(others.first()).toBeAttached({ timeout: 500 });
  }).toPass({ timeout: 25_000 });
  const clicked = await others.first().getAttribute("title");
  expect(`${clicked}, selected`).not.toBe(first);
  const pin = page.locator(`.leaflet-marker-icon.mm-pin-host--saved[title="${clicked}"]`);
  // The pins are redrawn once when the library settles: retry if that took the focus away.
  await expect(async () => {
    await pin.focus();
    await expect(pin).toBeFocused({ timeout: 500 });
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(new RegExp(BADA), { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(selectedPin(page)).toHaveCount(1);
  await expect(hostOf(page)).toHaveAttribute("title", `${clicked}, selected`);
  await expect(hostOf(page)).toBeFocused();
});

test("a malformed place link doesn't take the map down", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/places/%E0%A4%A");
  await drawn(page);
  expect(errors).toEqual([]);
});
