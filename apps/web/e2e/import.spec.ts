import { expect, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

test("re-imports keep notes, mark removed favourites and show previous locations", async ({
  page,
  context,
}, info) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "111");
  await importFromKakao(page);
  await expect(page.locator(".mm-card").first()).toContainText(/added|already up to date/);

  // The favourite disappears from Kakao: the place stays, marked, with its note.
  await setVariant(page, { name: "withoutFavourite", args: ["9001"] });
  await importFromKakao(page);
  await page.goto(`/places/${BADA}`);
  await expect(page.getByText("Removed from Kakao")).toBeVisible();
  await expect(page.getByText("주차 어려움")).toBeVisible();

  // The place moves 200 m: a faded previous-location marker appears.
  await setVariant(page, { name: "moved", args: ["9001", 200] });
  await importFromKakao(page);
  await setVariant(page, { name: "base" });
  await page.goto("/");
  const previous = page.locator(".mm-pin--previous");
  for (let i = 0; i < 5 && (await previous.count()) === 0; i++) {
    await page.locator(".marker-cluster").first().click({ force: true });
    await page.waitForTimeout(800);
  }
  await expect(previous.first()).toBeAttached();
  info.annotations.push({ type: "project", description: info.project.name });
});
