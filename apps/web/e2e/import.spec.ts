import { expect, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

test("re-imports keep notes, mark removed favourites and show previous locations", async ({
  page,
  context,
}, info) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "111");
  await importFromKakao(page);
  const importSection = page.getByRole("region", { name: "Import from kakao-list" });
  // On the desktop run the phone run has already moved the place, so this import moves it back.
  await expect(importSection).toContainText(/added|moved|already up to date/);

  // The favourite disappears from Kakao: the place stays, marked, with its note.
  await setVariant(page, { name: "withoutFavourite", args: ["9001"] });
  await importFromKakao(page);
  await page.goto(`/places/${BADA}/details`);
  // The list chip's label (the Kakao note card also says "(Removed from Kakao)").
  await expect(page.getByText("Removed from Kakao", { exact: true })).toBeVisible();
  await expect(page.getByText("주차 어려움")).toBeVisible();

  // The place moves 200 m: a faded previous-location marker appears.
  await setVariant(page, { name: "moved", args: ["9001", 200] });
  await importFromKakao(page);
  await setVariant(page, { name: "base" });
  const previous = page.locator(".mm-pin--previous");
  if (info.project.name === "desktop") {
    // The place page zooms the map beside it to the place; its old spot, 200 m away, is in view.
    await page.goto(`/places/${BADA}`);
    const moved = page.getByRole("button", { name: "Moved" });
    await moved.click();
    await expect(page.locator(".mm-moved__list li").first()).toContainText("제주 애월읍");
    // After the phone run this place has two earlier spots, one where it is now, and the map
    // groups pins that sit together, so the faded marker may be inside a cluster. The Moved list
    // above is the firm check; markers.test.ts covers which previous pins are drawn.
    await expect(previous.or(page.locator(".marker-cluster")).first()).toBeAttached();
  } else {
    // On the phone, the accessible list of places on the map marks the moved place.
    await page.goto("/");
    await page.getByRole("button", { name: "Show as a list" }).click();
    await expect(page.getByRole("link", { name: /바다정원 카페.*Moved/ })).toBeVisible();
  }
  info.annotations.push({ type: "project", description: info.project.name });
});
