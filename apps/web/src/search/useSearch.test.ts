import type { SearchResult } from "@magomap/domain";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
const { openUserDb } = await import("../data/db");
const { addVisitNote, savePlaceFromSearch } = await import("../data/writes");
const { openSearchHit, useSearch } = await import("./useSearch");

const result = (externalId: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  provider: "kakao",
  externalId,
  title: `빵집 ${externalId}`,
  address: "제주",
  roadAddress: null,
  category: null,
  phone: null,
  lat: 33.46,
  lng: 126.31,
  signedAt: Date.now(),
  signature: "sig",
  ...extra,
});
const center = { lat: 33.4, lng: 126.5 };

let n = 0;
beforeEach(() => {
  n += 1;
  openUserDb(`search${n}`);
  api.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSearch", () => {
  it("searches saved places when offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const id = await savePlaceFromSearch(result("1", { title: "Sea house" }));
    await addVisitNote(id, { visitedOn: null, body: "great bread" });
    const { result: hook } = renderHook(() => useSearch("bread", center));
    await waitFor(() => expect(hook.current.results).toHaveLength(1));
    expect(hook.current.mode).toBe("local");
    expect(hook.current.results[0]).toEqual({ kind: "saved", placeId: id });
    expect(api).not.toHaveBeenCalled();
  });

  it("marks a result that's already saved", async () => {
    const id = await savePlaceFromSearch(result("7"));
    api.mockResolvedValue({ results: [result("7"), result("8")], isEnd: true });
    const { result: hook } = renderHook(() => useSearch("빵집", center));
    await waitFor(() => expect(hook.current.results).toHaveLength(2));
    expect(hook.current.mode).toBe("kakao");
    expect(hook.current.results.map((r) => (r.kind === "kakao" ? r.savedPlaceId : "x"))).toEqual([
      id,
      undefined,
    ]);
    expect(api.mock.calls[0]?.[0]).toMatch(/^\/api\/search\/places\?q=.+&lat=33\.4&lng=126\.5$/);
  });

  it("keeps the last results and says so when rate limited", async () => {
    api.mockResolvedValueOnce({ results: [result("1")], isEnd: true });
    const { result: hook, rerender } = renderHook(({ q }) => useSearch(q, center), {
      initialProps: { q: "빵집" },
    });
    await waitFor(() => expect(hook.current.results).toHaveLength(1));
    api.mockRejectedValueOnce(new ApiError(429, { error: "rate_limited" }));
    rerender({ q: "빵집 제주" });
    await waitFor(() => expect(hook.current.error).toBe("rate_limited"));
    expect(hook.current.results).toHaveLength(1);
  });

  it("refreshes a saved place's location when its result is opened", async () => {
    const db = openUserDb(`search${n}`);
    const id = await savePlaceFromSearch(result("5"));
    let opened: string | null = "";
    await act(async () => {
      opened = await openSearchHit({
        kind: "kakao",
        result: result("5", { lat: 33.47 }),
        savedPlaceId: id,
      });
    });
    expect(opened).toBe(id);
    expect((await db.places.get(id))?.lat).toBe(33.47);
    expect(await db.outbox.count()).toBe(2);
  });
});
