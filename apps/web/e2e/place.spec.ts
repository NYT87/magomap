import { expect, test } from "@playwright/test";
import { BADA, devLogin, importFromKakao, setVariant } from "./helpers";

const LONG_NAME = `Restaurants-cafes-and-viewpoints-${"x".repeat(60)}`;

test("a long list name and a long note stay inside their Kakao note card", async ({
  page,
  context,
}) => {
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
  await page.goto(`/places/${BADA}`);
  await expect(page.getByRole("heading", { name: "Kakao notes" })).toBeVisible();
  // Give the place's Kakao list a long unbroken name, straight in the local database.
  await page.evaluate(async (name) => {
    const dbs = await indexedDB.databases();
    const dbName = dbs.map((d) => d.name ?? "").find((n) => n.startsWith("magomap-"));
    if (!dbName) throw new Error("no local database");
    const db = await new Promise<IDBDatabase>((ok, ko) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    await new Promise<void>((ok) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").openCursor().onsuccess = (e) => {
        const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!c) return;
        const v = c.value as { name: string };
        if (v.name === "제주 카페") c.update({ ...v, name });
        c.continue();
      };
      tx.oncomplete = () => ok();
    });
    db.close();
  }, LONG_NAME);
  // The narrowest phones she might use.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  const card = page.locator(".mm-kakao-note").first();
  await expect(card).toContainText(LONG_NAME);
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
  await page.goto(`/places/${BADA}`);
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
