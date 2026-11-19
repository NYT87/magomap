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
  const previous = page.locator(".mm-pin--previous");
  if (info.project.name === "desktop") {
    // The place page zooms the map beside it to the place; its old spot, 200 m away, is in view.
    await page.goto(`/places/${BADA}`);
    await expect(page.getByRole("button", { name: "Moved" })).toBeVisible();
    await expect(previous.first()).toBeAttached();
  } else {
    // On the phone, the accessible list of places on the map marks the moved place.
    await page.goto("/");
    await page.getByRole("button", { name: "Show as a list" }).click();
    await expect(page.getByRole("link", { name: /바다정원 카페.*Moved/ })).toBeVisible();
  }
  info.annotations.push({ type: "project", description: info.project.name });
});
