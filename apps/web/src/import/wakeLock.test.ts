import { afterEach, describe, expect, it, vi } from "vitest";
import { holdScreenOn } from "./wakeLock";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("holdScreenOn", () => {
  it("requests the lock, asks again when the page returns, and lets go on release", async () => {
    const sentinel = { release: vi.fn(async () => {}) };
    const request = vi.fn(async () => sentinel);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const release = holdScreenOn();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("screen");

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);

    release();
    await Promise.resolve();
    expect(sentinel.release).toHaveBeenCalled();
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ignores a rejected request", async () => {
    const request = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const release = holdScreenOn();
    await Promise.resolve();
    expect(() => release()).not.toThrow();
  });

  it("does nothing when the browser has no wake lock", () => {
    vi.stubGlobal("navigator", {});
    const release = holdScreenOn();
    expect(typeof release).toBe("function");
    expect(() => release()).not.toThrow();
  });
});
