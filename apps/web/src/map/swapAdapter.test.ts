import { describe, expect, it, vi } from "vitest";
import { kakaoLevel, zoomFromKakaoLevel } from "./kakaoAdapter";
import { loadKakaoSdk } from "./loadMapAdapter";
import type { MapAdapter } from "./MapAdapter";
import { swapAdapter } from "./swapAdapter";

const fake = (provider: MapAdapter["provider"], at = { lat: 35.68, lng: 139.69 }, zoom = 12) =>
  ({
    provider,
    mount: vi.fn(),
    setMarkers: vi.fn(),
    fitTo: vi.fn(),
    panTo: vi.fn(),
    getCenter: vi.fn(() => at),
    getZoom: vi.fn(() => zoom),
    onSelect: vi.fn(),
    onViewChange: vi.fn(),
    showMyLocation: vi.fn(),
    destroy: vi.fn(),
  }) satisfies MapAdapter;

describe("swapAdapter", () => {
  it("mounts the next map where the old one was, then lets the old one go", () => {
    const el = document.createElement("div");
    const old = fake("kakao");
    const next = fake("leaflet");
    swapAdapter(old, next, el);
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(next.mount).toHaveBeenCalledWith(el, { center: { lat: 35.68, lng: 139.69 }, zoom: 12 });
  });
});

describe("Kakao zoom levels", () => {
  it("round-trips the zooms Kakao can show, and clamps the rest", () => {
    for (let z = 6; z <= 19; z++) expect(zoomFromKakaoLevel(kakaoLevel(z))).toBe(z);
    expect(kakaoLevel(3)).toBe(14);
    expect(kakaoLevel(30)).toBe(1);
  });
});

describe("loadKakaoSdk", () => {
  it("says no without a key, and adds no script", async () => {
    expect(await loadKakaoSdk(null)).toBe(false);
    expect(document.querySelector("script[src*='dapi.kakao.com']")).toBeNull();
  });

  it("loads the SDK once however often it's asked", async () => {
    const first = loadKakaoSdk("once-key", { timeoutMs: 50 });
    const second = loadKakaoSdk("once-key", { timeoutMs: 50 });
    expect(document.querySelectorAll("script[src*='appkey=once-key']")).toHaveLength(1);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
  });
});
