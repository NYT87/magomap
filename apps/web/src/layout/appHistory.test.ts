import { describe, expect, it, vi } from "vitest";
import "wouter/use-browser-location";
import { canGoBackInApp, goBackOr } from "./appHistory";

const popped = () =>
  new Promise<void>((r) => window.addEventListener("popstate", () => r(), { once: true }));

describe("appHistory", () => {
  it("can't go back on the first page, and can after an in-app push", async () => {
    expect(canGoBackInApp()).toBe(false);
    history.pushState(null, "", "/places/a");
    expect(canGoBackInApp()).toBe(true);
    const back = popped();
    history.back();
    await back;
    expect(canGoBackInApp()).toBe(false);
  });

  it("a replace keeps the place in history (switching places doesn't add a step)", async () => {
    history.pushState(null, "", "/places/a");
    history.replaceState(null, "", "/places/b");
    expect(canGoBackInApp()).toBe(true);
    const back = popped();
    history.back();
    await back;
    expect(canGoBackInApp()).toBe(false);
  });

  it("goes back when there is in-app history, else replaces with the fallback", async () => {
    const navigate = vi.fn();
    goBackOr(navigate, "/");
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
    history.pushState(null, "", "/places/a");
    navigate.mockClear();
    const back = popped();
    goBackOr(navigate, "/");
    await back;
    expect(navigate).not.toHaveBeenCalled();
    expect(location.pathname).not.toBe("/places/a");
  });
});
