import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CHANGED, apiFetch, setRequestAccount } from "./client";

const reply = (status: number, body: unknown) =>
  vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );

afterEach(() => {
  setRequestAccount(null);
  vi.unstubAllGlobals();
});

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
});
