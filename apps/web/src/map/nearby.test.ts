import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import { fetchNearby, nearbyFailure } from "./nearby";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNearby", () => {
  it("asks the nearby route for the point and returns its results", async () => {
    const results = [{ result: { externalId: "1" }, distanceM: 12 }];
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ results })));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchNearby({ lat: 33.4627, lng: 126.3095 })).resolves.toEqual(results);
    const url = new URL(String(fetch.mock.calls[0]?.[0]), "http://x");
    expect(url.pathname).toBe("/api/search/nearby");
    expect(url.searchParams.get("lat")).toBe("33.4627");
    expect(url.searchParams.get("lng")).toBe("126.3095");
  });

  it("lets a network or server failure through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(fetchNearby({ lat: 1, lng: 2 })).rejects.toBeInstanceOf(NetworkError);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 })),
    );
    await expect(fetchNearby({ lat: 1, lng: 2 })).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("nearbyFailure", () => {
  it("says offline for a network failure", () => {
    expect(nearbyFailure(new NetworkError())).toBe("offline");
  });

  it("says offline when the browser is offline, whatever the error", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      expect(nearbyFailure(new Error("boom"))).toBe("offline");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("says rate limited for the limiter's answer", () => {
    expect(nearbyFailure(new ApiError(429, { error: "rate_limited" }))).toBe("rate_limited");
  });

  it("says unavailable for a Kakao failure or anything else", () => {
    expect(nearbyFailure(new ApiError(502, { error: "search_unavailable" }))).toBe("unavailable");
    expect(nearbyFailure(new Error("boom"))).toBe("unavailable");
  });
});
