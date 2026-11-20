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
