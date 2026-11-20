import { expect, type Page, test } from "@playwright/test";
import { devLogin, importFromKakao, setVariant } from "./helpers";

// The e2e server has no Kakao key, so Kakao Map is never available here: the map is
// OpenStreetMap whatever the setting, and Account says so. Switching between the two
// providers is checked by hand on the deployed app, where Kakao loads.
test("without Kakao, the map is OpenStreetMap and Account says so", async ({ page, context }) => {
  await devLogin(context, "111");
  await page.goto("/");
  await expect(page.locator(".mm-map-caption")).toHaveText("Map: OpenStreetMap");

  await page.goto("/account");
  await expect(
    page.getByText("Kakao Map isn't available right now, so the map shows OpenStreetMap."),
  ).toBeVisible();
  const map = page.getByRole("combobox", { name: "Map" });
  await expect(map).toHaveValue("auto");
  await map.selectOption("kakao");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Map" })).toHaveValue("kakao");
  await page.goto("/");
  await expect(page.locator(".mm-map-caption")).toHaveText("Map: OpenStreetMap");
});

// A stand-in for the Kakao Maps SDK: enough for the adapter, and like the real one it fires
// "idle" after every move, programmatic ones included. Fits move it to the middle of the bounds.
const FAKE_SDK = `
(() => {
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; } getLng() { return this.lng; } }
  class LatLngBounds {
    constructor() { this.points = []; }
    extend(p) { this.points.push(p); }
    middle() {
      const lats = this.points.map((p) => p.lat), lngs = this.points.map((p) => p.lng);
      return new LatLng((Math.min(...lats) + Math.max(...lats)) / 2,
                        (Math.min(...lngs) + Math.max(...lngs)) / 2);
    }
  }
  window.__fakeFits = 0;
  class FakeMap {
    constructor(el, o) { this.center = o.center; this.level = o.level; this.idle = [];
      el.innerHTML = '<div class="fake-kakao"></div>'; window.__fakeKakaoMap = this; }
    moved() { setTimeout(() => { for (const cb of this.idle) cb(); }, 0); }
    setCenter(p) { this.center = p; this.moved(); }
    panTo(p) { this.center = p; this.moved(); }
    setLevel(l) { this.level = l; this.moved(); }
    getLevel() { return this.level; }
    getCenter() { return this.center; }
    setBounds(b) { this.center = b.middle(); this.level = 14; window.__fakeFits += 1; this.moved(); }
    relayout() {}
  }
  window.__moveFakeKakao = (lat, lng) => window.__fakeKakaoMap.setCenter(new LatLng(lat, lng));
  window.kakao = { maps: {
    load(cb) { cb(); }, LatLng, LatLngBounds, Map: FakeMap,
    CustomOverlay: class { setMap() {} },
    MarkerClusterer: class { addMarkers() {} clear() {} },
    event: { addListener(target, type, cb) { if (type === "idle") target.idle.push(cb); } },
  } };
})();
`;

/** Serves a fake Kakao key and the fake SDK, so the app believes Kakao Map is available. */
async function withFakeKakao(page: Page) {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { kakaoJavascriptKey: "fake-key", devLoginEnabled: true } }),
  );
  await page.route("https://dapi.kakao.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_SDK }),
  );
}

type FakeWindow = {
  __fakeFits: number;
  __fakeKakaoMap: { center: { lat: number; lng: number }; level: number };
  __moveFakeKakao(lat: number, lng: number): void;
};

test("on Automatic, leaving Korea switches to OpenStreetMap; choosing Kakao brings it back", async ({
  page,
  context,
}) => {
  await withFakeKakao(page);
  // An account with no places: the first "fit to my places" would otherwise move the map
  // back to Korea at an unpredictable moment during this test.
  await devLogin(context, "333");
  await page.goto("/");
  const caption = page.locator(".mm-map-caption");
  await expect(caption).toHaveText("Map: Kakao Map");
  await expect(page.locator(".fake-kakao")).toHaveCount(1);

  // Pan to Tokyo: once the map stops, it's OpenStreetMap, at the same place, Kakao's DOM gone.
  const level = await page.evaluate(() => (window as unknown as FakeWindow).__fakeKakaoMap.level);
  await page.evaluate(() => (window as unknown as FakeWindow).__moveFakeKakao(35.68, 139.69));
  await expect(caption).toHaveText("Map: OpenStreetMap");
  await expect(page.locator(".fake-kakao")).toHaveCount(0);
  await expect(page.locator(".leaflet-container")).toHaveCount(1);

  // Forcing Kakao in Account switches back right away, even abroad, without reloading the app.
  await page.getByRole("link", { name: "Account" }).click();
  await page.getByRole("combobox", { name: "Map" }).selectOption("kakao");
  await page.goBack();
  await expect(caption).toHaveText("Map: Kakao Map");
  await expect(page.locator(".fake-kakao")).toHaveCount(1);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  // Through OpenStreetMap and back, it's still Tokyo at the same zoom.
  const back = await page.evaluate(() => (window as unknown as FakeWindow).__fakeKakaoMap);
  expect(back.center.lat).toBeCloseTo(35.68, 2);
  expect(back.center.lng).toBeCloseTo(139.69, 2);
  expect(back.level).toBe(level);
});

test("a switch keeps the places on the map, and Automatic returns to Kakao in Korea", async ({
  page,
  context,
}) => {
  await withFakeKakao(page);
  await setVariant(page, { name: "base" });
  await devLogin(context, "222");
  await importFromKakao(page);
  await page.goto("/");
  const caption = page.locator(".mm-map-caption");
  await expect(caption).toHaveText("Map: Kakao Map");
  // The first fit to her places (in Korea) has happened and the map stayed on Kakao.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as FakeWindow).__fakeFits))
    .toBeGreaterThan(0);
  await expect(caption).toHaveText("Map: Kakao Map");

  // Forcing OpenStreetMap: the same places are drawn on the new map.
  await page.getByRole("link", { name: "Account" }).click();
  await page.getByRole("combobox", { name: "Map" }).selectOption("osm");
  await page.goBack();
  await expect(caption).toHaveText("Map: OpenStreetMap");
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();

  // Back to Automatic while looking at Korea: Kakao again.
  await page.getByRole("link", { name: "Account" }).click();
  await page.getByRole("combobox", { name: "Map" }).selectOption("auto");
  await page.goBack();
  await expect(caption).toHaveText("Map: Kakao Map");
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
});
