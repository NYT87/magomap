import { expect, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

const LONG_NAME = `Restaurants-cafes-and-viewpoints-${"x".repeat(60)}`;
const LONG_NOTE = `예약 필수, 창가 자리 추천. https://place.map.kakao.com/${"a".repeat(92)}`;

test("a long list name and a long note stay inside their Kakao note card", async ({
  page,
  context,
}) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
  await page.goto(`/places/${BADA}/details`);
  await expect(page.locator(".mm-kakao-note").first()).toBeVisible();
  // Give the place's Kakao list a long unbroken name and its note a long link, straight in
  // the local database.
  await page.evaluate(
    async ({ name, note }) => {
      const dbs = await indexedDB.databases();
      const dbName = dbs.map((d) => d.name ?? "").find((n) => n.startsWith("magomap-"));
      if (!dbName) throw new Error("no local database");
      const db = await new Promise<IDBDatabase>((ok, ko) => {
        const r = indexedDB.open(dbName);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      await new Promise<void>((ok) => {
        const tx = db.transaction(["lists", "list_items"], "readwrite");
        tx.objectStore("lists").openCursor().onsuccess = (e) => {
          const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!c) return;
          const v = c.value as { name: string };
          if (v.name === "제주 카페") c.update({ ...v, name });
          c.continue();
        };
        tx.objectStore("list_items").openCursor().onsuccess = (e) => {
          const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!c) return;
          const v = c.value as { placeId: string; providerNote: string | null };
          if (v.placeId === "p_kakao_27324155" && v.providerNote)
            c.update({ ...v, providerNote: note });
          c.continue();
        };
        tx.oncomplete = () => ok();
      });
      db.close();
    },
    { name: LONG_NAME, note: LONG_NOTE },
  );
  // The narrowest phones she might use.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  const card = page.locator(".mm-kakao-note").first();
  // The list's name sits in the chip above its note, in the same entry.
  await expect(page.locator(".mm-membership").first()).toContainText(LONG_NAME);
  await expect(card).toContainText(LONG_NOTE);
  const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
});

test("the Kakao colour rule on a note stays visible in the dark theme", async ({
  page,
  context,
}) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/places/${BADA}/details`);
  const text = page.locator(".mm-kakao-note__text").first();
  await expect(text).toBeVisible();
  // Every Kakao colour, as the rule would draw it, against the card behind it.
  const worst = await text.evaluate((el) => {
    // "rgb(200, 55, 62)", or "color(srgb 0.78 0.21 0.24)" for a color-mix() result.
    const parse = (c: string) => {
      const n = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      return c.startsWith("color(") ? n.map((v) => v * 255) : n;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
    };
    const card = el.closest(".mm-kakao-note") as HTMLElement;
    const behind = lum(parse(getComputedStyle(card).backgroundColor));
    const colours = ["#c8373e", "#bd5b00", "#927000", "#2f7547", "#2464ad", "#7150a4", "#b82d6d"];
    return Math.min(
      ...colours.map((c) => {
        (el as HTMLElement).style.setProperty("--note-color", c);
        const rule = lum(parse(getComputedStyle(el).borderInlineStartColor));
        const [hi, lo] = rule > behind ? [rule, behind] : [behind, rule];
        return (hi + 0.05) / (lo + 0.05);
      }),
    );
  });
  expect(worst).toBeGreaterThanOrEqual(3);
});

// A phone's place is a peek card over the map; the details page is its own route.
async function openFirstPin(page: import("@playwright/test").Page) {
  await page.goto("/");
  const pins = page.locator(".leaflet-marker-icon.mm-pin-host--saved");
  await expect(pins.first()).toBeAttached({ timeout: 20_000 });
  const title = await pins.first().getAttribute("title");
  // Dispatched on the pin itself: neighbouring pins' 44 px targets can overlap and take a real click.
  await page
    .locator(`.leaflet-marker-icon.mm-pin-host--saved[title="${title}"]`)
    .dispatchEvent("click");
  await expect(page).toHaveURL(/\/places\/[^/]+$/);
  return (title ?? "").replace(/, selected$/, "");
}

test.describe("the phone's place peek", () => {
  test.beforeEach(async ({ page, context }, info) => {
    test.skip(info.project.name !== "phone", "the peek is phone only");
    await setVariant(page, { name: "base" });
    await devLogin(context, "222");
    await importFromKakao(page);
  });

  test("a tapped pin shows the map with the name above the nav, and the pin above the card", async ({
    page,
  }) => {
    const name = await openFirstPin(page);
    const peek = page.getByRole("region", { name });
    await expect(peek).toBeVisible();
    await expect(page.locator(".mm-map")).toBeVisible();
    const nav = await page.getByRole("navigation").boundingBox();
    const card = await peek.boundingBox();
    if (!nav || !card) throw new Error("no boxes");
    expect(card.y + card.height).toBeLessThanOrEqual(nav.y);
    // The selected pin is brought to the middle of the map: above the card.
    const pin = await page.locator(".mm-pin--selected").boundingBox();
    if (!pin) throw new Error("no selected pin");
    expect(pin.y + pin.height).toBeLessThan(card.y);
    for (const button of [
      page.getByRole("button", { name: "Open details" }),
      page.getByRole("button", { name: "Close" }),
    ]) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("the arrow opens the details page, Back returns to the peek, Close to the map", async ({
    page,
  }) => {
    const name = await openFirstPin(page);
    await page.getByRole("button", { name: "Open details" }).click();
    await expect(page).toHaveURL(/\/details$/);
    await expect(page.locator(".mm-map")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/places\/[^/]+$/);
    await expect(page.getByRole("region", { name })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("region", { name })).toHaveCount(0);
  });

  test("dragging the card up opens the details page, and doesn't pan the map", async ({ page }) => {
    const name = await openFirstPin(page);
    const card = page.getByRole("region", { name });
    const box = await card.boundingBox();
    if (!box) throw new Error("no card");
    // The map first glides to the place: measure the pin once it has stopped.
    const pin = page.locator(".mm-pin--selected");
    let before = await pin.boundingBox();
    await expect(async () => {
      const now = await pin.boundingBox();
      const still = JSON.stringify(now) === JSON.stringify(before);
      before = now;
      expect(still).toBe(true);
    }).toPass({ intervals: [400], timeout: 10_000 });
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(x, box.y - 20, { steps: 4 });
    // Still down: the card follows, the map stays.
    await expect.poll(async () => (await card.boundingBox())?.y).toBeLessThan(box.y);
    expect(await page.locator(".mm-pin--selected").boundingBox()).toEqual(before);
    await page.mouse.move(x, box.y - 120, { steps: 6 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/details$/);
  });

  test("a tap on the card opens the details page, as in Kakao Map", async ({ page }) => {
    const name = await openFirstPin(page);
    await page.getByRole("heading", { level: 2, name }).click();
    await expect(page).toHaveURL(/\/places\/[^/]+\/details$/);
  });
});
