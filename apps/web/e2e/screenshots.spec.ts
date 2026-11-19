import { test } from "@playwright/test";
import { BADA, devLogin, setVariant } from "./helpers";

// Screenshots for the homepage (apps/homepage/public/screenshots), per project, light and dark.
test.use({ locale: "ko-KR" });

test("homepage screenshots", async ({ page, context }, info) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "111");
  await page.goto("/import");
  await page.getByRole("button", { name: /카카오에서 가져오기|다시 가져오기/ }).click();
  await page.getByText("가져오기를 마쳤어요").waitFor({ timeout: 30_000 });
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
