import { test } from "@playwright/test";
import { BADA, devLogin, syncFromKakao } from "./helpers";

// Screenshots for the homepage (apps/homepage/public/screenshots), per project, light and dark.
test.use({ locale: "ko-KR" });

test("homepage screenshots", async ({ page, context }, info) => {
  await devLogin(context, "111");
  await syncFromKakao(page);
  const phone = info.project.name === "phone";
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(phone ? "/" : `/places/${BADA}`);
    await page.waitForTimeout(3_000);
    await page.screenshot({
      path: `../homepage/public/screenshots/${info.project.name}-${scheme}.png`,
    });
  }
});
