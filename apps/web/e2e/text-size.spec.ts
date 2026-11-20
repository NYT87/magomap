import { expect, type Page, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setRootSize, setVariant } from "./helpers";

// (The phone's bottom nav isn't on the Account page, so its label is read on the map.)
// Text sizes at the default root size (16px), as computed before text followed the device.
type Probe = { page: "account" | "map" | "place"; selector: string; px: number };

const PATHS = { account: "/account", map: "/", place: `/places/${BADA}` };

function probes(phone: boolean): Probe[] {
  const list: Probe[] = [
    { page: "account", selector: "body", px: 16 },
    { page: "account", selector: ".mm-muted", px: 14 },
  ];
  if (phone) {
    list.push({ page: "map", selector: ".mm-nav__item", px: 12 });
    list.push({ page: "account", selector: ".mm-page__title", px: 18 });
  } else {
    list.push({ page: "account", selector: ".mm-screen__title", px: 24 });
  }
  list.push({ page: "place", selector: ".mm-section__title", px: phone ? 18 : 20 });
  return list;
}

async function sizesAt(page: Page, rootPx: number, list: Probe[]) {
  const out: number[] = [];
  for (const p of list) {
    await page.goto(PATHS[p.page]);
    await page.locator(p.selector).first().waitFor();
    await setRootSize(page, rootPx);
    out.push(
      await page
        .locator(p.selector)
        .first()
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
    );
  }
  return out;
}

test.beforeEach(async ({ page, context }) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
});

test("text sizes match today at the default size", async ({ page }, info) => {
  const list = probes(info.project.name === "phone");
  expect(await sizesAt(page, 16, list)).toEqual(list.map((p) => p.px));
});

test("text doubles at the cap", async ({ page }, info) => {
  const list = probes(info.project.name === "phone");
  expect(await sizesAt(page, 32, list)).toEqual(list.map((p) => p.px * 2));
});

test("text stops growing above the cap", async ({ page }, info) => {
  const list = probes(info.project.name === "phone");
  expect(await sizesAt(page, 48, list)).toEqual(list.map((p) => p.px * 2));
});
