import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useServerBuild } from "./version";

const build = { version: "0.1.1", commit: "a1b2c3d", builtAt: null };
const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ ok: true, ...build })));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useServerBuild", () => {
  it("ends in offline when the server doesn't answer within 8 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            init.signal?.addEventListener("abort", () => rej(new DOMException("x", "AbortError")));
          }),
      ),
    );
    const { result } = renderHook(() => useServerBuild());
    expect(result.current.state).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7900);
    });
    expect(result.current.state).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.state).toBe("offline");
  });

  it("shows offline at once when the browser goes offline, and recovers on online", async () => {
    vi.stubGlobal("fetch", okFetch());
    const { result } = renderHook(() => useServerBuild());
    await vi.waitFor(() => expect(result.current.state).toBe("ok"));
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.state).toBe("offline");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await vi.waitFor(() => expect(result.current.state).toBe("ok"));
  });
});
