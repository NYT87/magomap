import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CHANGED } from "../api/client";
import { accountName, notifyMeChanged, storedMe, useMe } from "./useMe";

const me = (userId: string) => ({ userId, displayName: userId });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function serve(answers: string[]) {
  const fetch = vi.fn(async () => {
    const who = answers.shift() ?? "nobody";
    return new Response(JSON.stringify(me(who)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("useMe", () => {
  it("asks again who is signed in when the server says the session changed", async () => {
    serve(["a", "b"]);
    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.me?.userId).toBe("a"));
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_CHANGED));
    });
    await waitFor(() => expect(result.current.me?.userId).toBe("b"));
  });

  it("asks again when another tab signs in or out", async () => {
    serve(["a", "b"]);
    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.me?.userId).toBe("a"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "mm.me" }));
    });
    await waitFor(() => expect(result.current.me?.userId).toBe("b"));
  });

  it("never lets an older answer replace a newer one", async () => {
    let answerA: (r: Response) => void = () => {};
    const calls = [
      async () => new Response(JSON.stringify(me("a")), { status: 200 }),
      () =>
        new Promise<Response>((r) => {
          answerA = r;
        }),
      async () => new Response(JSON.stringify(me("b")), { status: 200 }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => (calls.shift() as () => Promise<Response>)()),
    );
    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.me?.userId).toBe("a"));
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_CHANGED));
    });
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_CHANGED));
    });
    await waitFor(() => expect(result.current.me?.userId).toBe("b"));
    await act(async () => {
      answerA(new Response(JSON.stringify(me("a")), { status: 200 }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.me?.userId).toBe("b");
    expect(JSON.parse(localStorage.getItem("mm.me") ?? "{}").userId).toBe("b");
  });

  it("remembers each account's name, even after the session ends", async () => {
    const answers: (() => Response)[] = [
      () => new Response(JSON.stringify({ userId: "u1", displayName: "지은" }), { status: 200 }),
      () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
      () => new Response(JSON.stringify({ userId: "u1", displayName: null }), { status: 200 }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (answers.shift() as () => Response)()),
    );
    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.me?.displayName).toBe("지은"));
    expect(accountName("u1")).toBe("지은");
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_CHANGED));
    });
    await waitFor(() => expect(result.current.me).toBeNull());
    expect(storedMe()).toBeNull();
    expect(accountName("u1")).toBe("지은");
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_CHANGED));
    });
    await waitFor(() => expect(result.current.me?.userId).toBe("u1"));
    expect(accountName("u1")).toBeNull();
  });

  it("asks again when the account's details changed", async () => {
    serve(["a", "b"]);
    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.me?.userId).toBe("a"));
    act(() => notifyMeChanged());
    await waitFor(() => expect(result.current.me?.userId).toBe("b"));
  });
});
