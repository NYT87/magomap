import type { SearchResult } from "@magomap/domain";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
const { openUserDb } = await import("../data/db");
const { addVisitNote, savePlaceFromSearch } = await import("../data/writes");
const { useSearch } = await import("./useSearch");

const result = (externalId: string, title: string): SearchResult => ({
  provider: "kakao",
  externalId,
  title,
  address: null,
  roadAddress: null,
  category: null,
  phone: null,
  lat: 33.4,
  lng: 126.3,
  signedAt: Date.now(),
  signature: "s",
});

let n = 0;
beforeEach(() => {
  n += 1;
  api.mockReset();
});

describe("online search", () => {
  it("also finds her own places by what she wrote about them", async () => {
    openUserDb(`srf${n}`);
    const id = await savePlaceFromSearch(result("1", "Sea house"));
    await addVisitNote(id, { visitedOn: null, body: "the bread was great" });
    api.mockResolvedValue({ results: [result("9", "Bread shop")], isEnd: true });
    const { result: hook } = renderHook(() => useSearch("bread", null));
    await waitFor(() => expect(hook.current.results).toHaveLength(2));
    expect(hook.current.results[0]).toEqual({ kind: "saved", placeId: id });
  });
});
