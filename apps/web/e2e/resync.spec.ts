import { expect, test } from "@playwright/test";
import { BADA, devLogin, syncFromKakao } from "./helpers";

test("re-syncs keep notes, mark removed favourites and show previous locations", async ({
  page,
  context,
}, info) => {
  // Four syncs, each a few seconds.
  test.slow();
  await devLogin(context, "111");
  await syncFromKakao(page);
  const section = page.getByRole("region", { name: "Sync from Kakao Map" });
  // On the desktop run the phone run has already moved the place, so this sync moves it back.
  await expect(section).toContainText(/added|moved|already up to date/);

  // A note of her own about the place, written in magomap.
  const mine = `resync note ${info.project.name} ${Date.now()}`;
  await page.goto(`/places/${BADA}/details`);
  await page.getByRole("button", { name: "Add visit note" }).click();
  await page.getByRole("textbox", { name: "Note" }).fill(mine);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".mm-entry__body", { hasText: mine })).toBeVisible();

  // The favourite disappears from Kakao: the place stays, marked, with her note and the Kakao note.
  await syncFromKakao(page, { name: "withoutFavourite", args: ["9001"] });
  await expect(section).toContainText("1 removed in Kakao Map");
  await page.goto(`/places/${BADA}/details`);
  // The list chip's label (the Kakao note card also says "(Removed from Kakao)").
  await expect(page.getByText("Removed from Kakao", { exact: true })).toBeVisible();
  await expect(page.locator(".mm-entry__body", { hasText: mine })).toBeVisible();
  await expect(page.getByText("창가 자리")).toBeVisible();

  // Back in Kakao: restored.
  await syncFromKakao(page);
  await expect(section).toContainText("1 back in Kakao Map");

  // The place moves 200 m: a faded previous-location marker appears.
  await syncFromKakao(page, { name: "moved", args: ["9001", 200] });
  await expect(section).toContainText("1 moved");
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
