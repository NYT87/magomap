import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { devLogin } from "./helpers";

// Saving a place from the map: right-click (desktop) or long-press (phone), pick a nearby place,
// pick a list, land on the place. The e2e Worker has no Kakao Local key, so the nearby lookup is
// answered here; its result isn't really signed, so pushes are held back (as if offline) and the
// place stays on the device, where the app shows it.

const MENU = "Save a place here";

function nearbyAnswer(externalId: string, title: string) {
  return {
    results: [
      {
        result: {
          provider: "kakao",
          externalId,
          title,
          address: "제주특별자치도 제주시 애월읍 고내리 1",
          roadAddress: "제주특별자치도 제주시 애월읍 애월해안로 1",
          category: "음식점 > 카페 > 커피전문점",
          phone: null,
          lat: 33.4,
          lng: 126.55,
          signedAt: Date.now(),
          signature: "e2e-not-signed",
        },
        distanceM: 12,
      },
    ],
  };
}

/** A place id no other run or project has used, so it starts unsaved. */
const freshId = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function openMap(page: Page, context: BrowserContext, answer: unknown) {
  await devLogin(context, "333");
  await page.route("**/api/sync/push", (route) => route.abort());
  await page.route("**/api/search/nearby*", (route) => route.fulfill({ json: answer }));
  await page.goto("/");
  await expect(page.locator(".mm-mapview__canvas.leaflet-container")).toBeVisible();
}

/** A spot on the map clear of the search bar, the buttons and the tabs. */
async function mapSpot(page: Page) {
  const box = await page.locator(".mm-mapview__canvas").boundingBox();
  if (!box) throw new Error("no map");
  return { x: box.x + box.width * 0.4, y: box.y + box.height * 0.55 };
}

/** A finger held still for 700 ms, through Chrome's own touch input. */
async function longPress(page: Page, at: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = [{ x: at.x, y: at.y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function press(page: Page, layout: string) {
  const at = await mapSpot(page);
  if (layout === "phone") await longPress(page, at);
  else await page.mouse.click(at.x, at.y, { button: "right" });
}

test("a press on the map saves a nearby place to a new list and opens it", async ({
  page,
  context,
}, info) => {
  const id = freshId();
  const title = `Sea Garden ${id}`;
  const listName = `Map finds ${id}`;
  await openMap(page, context, nearbyAnswer(id, title));

  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/search/nearby");
  await press(page, info.project.name);
  const url = new URL((await asked).url());
  expect(Number(url.searchParams.get("lat"))).toBeCloseTo(33.4, 0);
  expect(Number(url.searchParams.get("lng"))).toBeCloseTo(126.55, 0);

  const menu = page.getByRole("dialog", { name: MENU });
  await expect(menu).toBeVisible();
  if (info.project.name === "phone") await expect(page.locator(".mm-sheet")).toBeVisible();
  else await expect(menu).toHaveClass(/mm-map-menu--popover/);
  const row = menu.getByRole("button", { name: new RegExp(title) });
  await expect(row).toContainText("커피전문점");
  await expect(row).toContainText("12 m");
  await row.click();
  await menu.getByRole("button", { name: "New list" }).click();
  await menu.getByRole("textbox", { name: "List name" }).fill(`  ${listName} `);
  await menu.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/places/p_kakao_${id}$`));
  await expect(page.getByRole("dialog", { name: MENU })).toHaveCount(0);
  await page.goto(`/places/p_kakao_${id}/details`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator(".mm-membership").filter({ hasText: listName })).toBeVisible();

  // The same place again, into the list it is already in: marked, and nothing doubles.
  await page.goto("/");
  await expect(page.locator(".mm-mapview__canvas.leaflet-container")).toBeVisible();
  await press(page, info.project.name);
  const again = page.getByRole("dialog", { name: MENU });
  const savedRow = again.getByRole("button", { name: new RegExp(title) });
  await expect(savedRow).toContainText("Saved");
  await savedRow.click();
  const listRow = again.getByRole("button", { name: new RegExp(listName) });
  await expect(listRow).toContainText("Already in");
  await listRow.click();
  await expect(page).toHaveURL(new RegExp(`/places/p_kakao_${id}$`));
  await page.goto(`/places/p_kakao_${id}/details`);
  await expect(page.locator(".mm-membership").filter({ hasText: listName })).toHaveCount(1);
});

test("a normal tap or click on the map opens nothing", async ({ page, context }, info) => {
  await openMap(page, context, nearbyAnswer(freshId(), "Unused"));
  let asked = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/search/nearby") asked += 1;
  });
  const at = await mapSpot(page);
  if (info.project.name === "phone") await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("dialog", { name: MENU })).toHaveCount(0);
  expect(asked).toBe(0);
});

test("with nothing nearby it says so, saves nothing, and Escape closes it", async ({
  page,
  context,
}, info) => {
  await openMap(page, context, { results: [] });
  await press(page, info.project.name);
  const menu = page.getByRole("dialog", { name: MENU });
  await expect(menu.getByText("No Kakao place found here.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("the keyboard opens the menu from the focused map, at its centre", async ({
  page,
  context,
}, info) => {
  // A keyboard on a desktop.
  if (info.project.name === "phone") return;
  await openMap(page, context, { results: [] });
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/search/nearby");
  await page.locator(".mm-mapview__canvas").focus();
  await page.keyboard.press("Shift+F10");
  await asked;
  const menu = page.getByRole("dialog", { name: MENU });
  await expect(menu).toBeVisible();
  await expect(menu).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".mm-mapview__canvas")).toBeFocused();
});

test("a long-press on the place card isn't a press on the map", async ({ page, context }, info) => {
  // The card over the map is a phone's.
  if (info.project.name !== "phone") return;
  const id = freshId();
  const title = `Card Cafe ${id}`;
  await openMap(page, context, nearbyAnswer(id, title));
  await press(page, "phone");
  const menu = page.getByRole("dialog", { name: MENU });
  await menu.getByRole("button", { name: new RegExp(title) }).click();
  await menu.getByRole("button", { name: "No list" }).click();
  await expect(page).toHaveURL(new RegExp(`/places/p_kakao_${id}$`));
  const card = page.locator(".mm-place-peek");
  await expect(card).toBeVisible();

  let asked = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/search/nearby") asked += 1;
  });
  const box = await card.boundingBox();
  if (!box) throw new Error("no card");
  await longPress(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(500);
  await expect(page.getByRole("dialog", { name: MENU })).toHaveCount(0);
  expect(asked).toBe(0);
});
