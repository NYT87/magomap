import { expect, test } from "@playwright/test";
import { devLogin, importFromKakao, setVariant } from "./helpers";

const JEJU = "Show 제주 카페 on the map";
const BADA_TITLE = "바다정원 카페";

test("the Lists tab is where lists are switched on and off the map", async ({
  page,
  context,
}, info) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "111");
  await importFromKakao(page);

  if (info.project.name === "phone") {
    await page.goto("/");
    await page.locator(".mm-map-tools").getByRole("button", { name: "Lists" }).click();
    await expect(page).toHaveURL(/\/lists$/);
    await expect(page.getByRole("heading", { level: 1, name: "Lists" })).toBeVisible();
    const jeju = page.getByRole("switch", { name: JEJU });
    await expect(jeju).toBeVisible();
    await expect(jeju).toBeChecked();
    await jeju.click();
    await expect(jeju).not.toBeChecked();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "Show as a list" }).click();
    await expect(page.locator(".mm-list-overlay")).toBeVisible();
    await expect(page.locator(".mm-list-overlay").getByText(BADA_TITLE)).toHaveCount(0);
  } else {
    await page.goto("/");
    const panel = page.locator(".mm-panel__body");
    await expect(panel.getByText(BADA_TITLE)).toBeVisible();
    await expect(panel.getByRole("switch")).toHaveCount(0);
    await page.goto("/lists");
    await page.getByRole("switch", { name: JEJU }).click();
    await expect(page.getByRole("switch", { name: JEJU })).not.toBeChecked();
    await page.goto("/");
    await expect(page.locator(".mm-panel__body").getByText(BADA_TITLE)).toHaveCount(0);
  }
});

test("an old link to the import page lands on Account", async ({ page, context }) => {
  await devLogin(context, "111");
  await page.goto("/import");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Import from kakao-list" })).toBeVisible();
});

test("the account actions are outlined buttons, at the bottom of the panel on desktop", async ({
  page,
  context,
}, info) => {
  await devLogin(context, "111");
  await page.goto("/account");
  for (const name of ["Sign out", "Sign out on every device", "Delete account"]) {
    const style = await page
      .getByRole("button", { name, exact: true })
      .evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(style).not.toBe("none");
  }
  if (info.project.name === "desktop") {
    // With room to spare: a window tall enough for all of Account (without room, the panel
    // scrolls and the buttons simply follow the content).
    await page.setViewportSize({ width: 1440, height: 1400 });
    const body = await page.locator(".mm-panel__body").boundingBox();
    const box = await page.getByRole("button", { name: "Delete account" }).boundingBox();
    expect(body && box).toBeTruthy();
    if (body && box) {
      // At the bottom, and still inside the panel (not pushed below it).
      const gap = body.y + body.height - (box.y + box.height);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(48);
    }
  }
});
