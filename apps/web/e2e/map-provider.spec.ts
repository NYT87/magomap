import { expect, test } from "@playwright/test";
import { devLogin } from "./helpers";

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

// A stand-in for the Kakao Maps SDK: just enough for the adapter, plus a way to move the map.
const FAKE_SDK = `
(() => {
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; } getLng() { return this.lng; } }
  class FakeMap {
    constructor(el, o) { this.center = o.center; this.level = o.level; this.idle = [];
      el.innerHTML = '<div class="fake-kakao"></div>'; window.__fakeKakaoMap = this; }
    setCenter(p) { this.center = p; } panTo(p) { this.center = p; }
    setLevel(l) { this.level = l; } getLevel() { return this.level; }
    getCenter() { return this.center; } setBounds() {} relayout() {}
  }
  window.__moveFakeKakao = (lat, lng) => {
    const m = window.__fakeKakaoMap; m.center = new LatLng(lat, lng);
    for (const cb of m.idle) cb();
  };
  window.kakao = { maps: {
    load(cb) { cb(); }, LatLng, LatLngBounds: class { extend() {} }, Map: FakeMap,
    CustomOverlay: class { setMap() {} },
    MarkerClusterer: class { addMarkers() {} clear() {} },
    event: { addListener(target, type, cb) { if (type === "idle") target.idle.push(cb); } },
  } };
})();
`;

test("on Automatic, leaving Korea switches to OpenStreetMap; choosing Kakao brings it back", async ({
  page,
  context,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { kakaoJavascriptKey: "fake-key", devLoginEnabled: true } }),
  );
  await page.route("https://dapi.kakao.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_SDK }),
  );
  // An account with no places: the first "fit to my places" would otherwise move the map
  // back to Korea at an unpredictable moment during this test.
  await devLogin(context, "333");
  await page.goto("/");
  const caption = page.locator(".mm-map-caption");
  await expect(caption).toHaveText("Map: Kakao Map");
  await expect(page.locator(".fake-kakao")).toHaveCount(1);

  // Pan to Tokyo: once the map stops, it's OpenStreetMap, at the same place, Kakao's DOM gone.
  await page.evaluate(() =>
    (window as unknown as { __moveFakeKakao(a: number, b: number): void }).__moveFakeKakao(
      35.68,
      139.69,
    ),
  );
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
});
