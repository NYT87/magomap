import { expect, test } from "@playwright/test";
import { BADA, devLogin, syncFromKakao } from "./helpers";

// A phone has no extension: a place added to one of her Kakao lists waits, marked, and is kept
// across going back online. Each project adds a different place to a different list, and cancels
// it at the end, so the two can run side by side and again.
test("a place added to her Kakao list without the extension waits, marked, and can be cancelled", async ({
  page,
  browser,
  context,
}, info) => {
  const phone = info.project.name === "phone";
  const target = phone
    ? { place: BADA, title: "바다정원 카페", list: "서울 맛집", listId: "l_kakao_102" }
    : { place: "p_kakao_11223344", title: "명동 칼국수", list: "제주 카페", listId: "l_kakao_101" };
  await devLogin(context, "222");
  await syncFromKakao(page);

  // Another browser of hers, with no extension in it.
  const other = await browser.newContext({ locale: "en-US" });
  await devLogin(other, "222");
  const p = await other.newPage();
  await p.goto(`/places/${target.place}/details`);
  await expect(p.getByRole("heading", { name: target.title })).toBeVisible({ timeout: 20_000 });

  await other.setOffline(true);
  await p.getByRole("button", { name: "Add to list" }).click();
  const kakao = p.getByRole("group", { name: "Kakao Map" });
  await expect(
    kakao.getByText(/next time magomap is open in Chrome with the extension/),
  ).toBeVisible();
  await kakao.getByRole("button", { name: target.list }).click();
  const chip = p.locator(".mm-chip", { hasText: target.list });
  await expect(chip).toContainText("Not yet in Kakao Map");

  await other.setOffline(false);
  await expect(p.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({
    timeout: 20_000,
  });
  // In the list too, marked.
  await p.goto(`/lists/${target.listId}`);
  await expect(p.locator(".mm-place-row", { hasText: target.title })).toContainText(
    "Not yet in Kakao Map",
  );

  // Cancelled, it's gone, here and on the server.
  await p.goto(`/places/${target.place}/details`);
  await p.getByRole("button", { name: `Don't add to ${target.list}` }).click();
  await expect(p.locator(".mm-chip", { hasText: target.list })).toHaveCount(0);
  await expect(p.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({
    timeout: 20_000,
  });
  await other.close();
});
