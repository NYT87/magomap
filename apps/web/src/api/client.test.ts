import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CHANGED, apiFetch, NetworkError, setRequestAccount } from "./client";

const reply = (status: number, body: unknown) =>
  vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );

afterEach(() => {
  setRequestAccount(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fetch that never answers until its signal aborts, as on one bar of signal. */
const stall = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );

/** Stands in for AbortSignal.timeout: records each limit, and lets the test make it run out. */
function limits() {
  const asked: { ms: number; expire: () => void }[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const c = new AbortController();
    asked.push({ ms, expire: () => c.abort(new DOMException("timed out", "TimeoutError")) });
    return c.signal;
  });
  return asked;
}

describe("apiFetch", () => {
  it("says which account the request acts for", async () => {
    const fetch = reply(200, { ok: true });
    vi.stubGlobal("fetch", fetch);
    setRequestAccount("u1");
    await apiFetch("/api/search/places?q=a");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-magomap-user")).toBe("u1");
  });

  it("sends no account before one is open", async () => {
    const fetch = reply(200, {});
    vi.stubGlobal("fetch", fetch);
    await apiFetch("/api/me");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("x-magomap-user")).toBe(false);
  });

  it("announces that the session now belongs to another account", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "account_mismatch" }));
    setRequestAccount("u1");
    const heard = vi.fn();
    window.addEventListener(ACCOUNT_CHANGED, heard);
    await expect(apiFetch("/api/sync/pull")).rejects.toMatchObject({ code: "account_mismatch" });
    window.removeEventListener(ACCOUNT_CHANGED, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("gives up on a stalled request after its time limit, as being offline", async () => {
    const asked = limits();
    vi.stubGlobal("fetch", stall());
    const answer = apiFetch("/api/me");
    expect(asked[0]?.ms).toBe(120_000);
    asked[0]?.expire();
    await expect(answer).rejects.toBeInstanceOf(NetworkError);
  });

  it("gives up when the answer starts but its body stalls", async () => {
    const asked = limits();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = new ReadableStream({
          start(c) {
            init?.signal?.addEventListener("abort", () => c.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );
    const answer = apiFetch("/api/sync/pull");
    await Promise.resolve();
    asked[0]?.expire();
    await expect(answer).rejects.toBeInstanceOf(NetworkError);
  });

  it("still stops when the caller cancels", async () => {
    limits();
    vi.stubGlobal("fetch", stall());
    const mine = new AbortController();
    const answer = apiFetch("/api/me", { signal: mine.signal });
    mine.abort();
    await expect(answer).rejects.toBeInstanceOf(NetworkError);
  });

  it("still works, without a limit, where the browser has no AbortSignal.timeout", async () => {
    const original = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
    Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
    try {
      vi.stubGlobal("fetch", reply(200, { ok: true }));
      await expect(apiFetch("/api/me")).resolves.toEqual({ ok: true });
    } finally {
      if (original) Object.defineProperty(AbortSignal, "timeout", original);
    }
  });
});
