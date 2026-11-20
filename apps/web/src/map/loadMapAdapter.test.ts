import { afterEach, describe, expect, it } from "vitest";
import { loadMapAdapter } from "./loadMapAdapter";

const withKey = { kakaoJavascriptKey: "k", devLoginEnabled: false };

afterEach(() => {
  for (const s of document.querySelectorAll("script")) s.remove();
});

describe("loadMapAdapter", () => {
  it("uses Leaflet without a Kakao key", async () => {
    const a = await loadMapAdapter({ kakaoJavascriptKey: null, devLoginEnabled: false });
    expect(a.provider).toBe("leaflet");
  });

  it("falls back to Leaflet when the Kakao script fails", async () => {
    const pending = loadMapAdapter(withKey, { timeoutMs: 5_000 });
    const script = document.querySelector<HTMLScriptElement>("script[src*='dapi.kakao.com']");
    expect(script?.src).toContain("appkey=k");
    script?.dispatchEvent(new Event("error"));
    expect((await pending).provider).toBe("leaflet");
  });

  it("falls back to Leaflet when the Kakao script never loads", async () => {
    // Its own key: the SDK load is cached per key, and this one must reach the timeout.
    const a = await loadMapAdapter({ ...withKey, kakaoJavascriptKey: "slow" }, { timeoutMs: 50 });
    expect(document.querySelector("script[src*='appkey=slow']")).not.toBeNull();
    expect(a.provider).toBe("leaflet");
  });
});
