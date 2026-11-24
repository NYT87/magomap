import { expect, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

test("a note written offline survives a reload and syncs when back online", async ({
  page,
  context,
  browser,
}, info) => {
  const text = `offline test ${info.project.name} ${Date.now()}`;
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
  await page.goto(`/places/${BADA}/details`);
  await expect(page.getByRole("heading", { name: "바다정원 카페" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Add visit note" }).click();
  await page.getByRole("textbox", { name: "Note" }).fill(text);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".mm-entry__body", { hasText: text })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Offline.*1 change/ })).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();
  await expect(page.locator(".mm-entry__body", { hasText: text })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({
    timeout: 20_000,
  });

  const other = await browser.newContext({ locale: "en-US" });
  await devLogin(other, "222");
  const second = await other.newPage();
  await second.goto(`/places/${BADA}/details`);
  await expect(second.locator(".mm-entry__body", { hasText: text })).toBeVisible({
    timeout: 20_000,
  });
  await other.close();
});
