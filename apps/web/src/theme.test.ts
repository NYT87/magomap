import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setColorScheme } from "./test/setup";
import { applyTheme, DARK_BAR, followTheme, LIGHT_BAR, setTheme, storedTheme } from "./theme";

const bar = () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#1F6F5C" />';
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("defaults to the device's setting", () => {
    expect(storedTheme()).toBe("system");
    localStorage.setItem("mm.theme", "purple");
    expect(storedTheme()).toBe("system");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(storedTheme()).toBe("system");
    vi.restoreAllMocks();
  });

  it("applies and remembers a choice", () => {
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("mm.theme")).toBe("dark");
    expect(bar()).toBe(DARK_BAR);
    setTheme("light");
    expect(bar()).toBe(LIGHT_BAR);
    setTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("applies a choice that disagrees with the device", () => {
    setColorScheme("dark");
    applyTheme("light");
    expect(bar()).toBe(LIGHT_BAR);
    setColorScheme("light");
    applyTheme("dark");
    expect(bar()).toBe(DARK_BAR);
  });

  it("still applies when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setTheme("light")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
    vi.restoreAllMocks();
  });

  it("keeps a private-mode choice for the session", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const stop = followTheme();
    setTheme("dark");
    setColorScheme("light");
    setColorScheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storedTheme()).toBe("dark");
    stop();
    vi.restoreAllMocks();
    setTheme("system"); // a working write ends the session choice
    expect(storedTheme()).toBe("system");
  });

  it("returns to the device theme when another tab clears storage", () => {
    const stop = followTheme();
    setTheme("dark");
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    stop();
  });

  it("follows the device while on system", () => {
    const stop = followTheme();
    applyTheme("system");
    expect(bar()).toBe(LIGHT_BAR);
    setColorScheme("dark");
    expect(bar()).toBe(DARK_BAR);
    setColorScheme("light");
    expect(bar()).toBe(LIGHT_BAR);
    stop();
    setColorScheme("dark");
    expect(bar()).toBe(LIGHT_BAR);
  });

  it("does not follow the device once a theme is chosen", () => {
    const stop = followTheme();
    setTheme("light");
    setColorScheme("dark");
    expect(bar()).toBe(LIGHT_BAR);
    expect(document.documentElement.dataset.theme).toBe("light");
    stop();
  });

  it("follows another tab", () => {
    const stop = followTheme();
    window.dispatchEvent(new StorageEvent("storage", { key: "mm.theme", newValue: "dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(bar()).toBe(DARK_BAR);
    window.dispatchEvent(new StorageEvent("storage", { key: "mm.theme", newValue: null }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    stop();
  });

  it("keeps the dark bar colour equal to the dark background in tokens.css", () => {
    const css = readFileSync(resolve(__dirname, "styles/tokens.css"), "utf8");
    const dark = /--dark-color-bg:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(dark?.toLowerCase()).toBe(DARK_BAR.toLowerCase());
    const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
    expect(html.toLowerCase()).toContain(`"${DARK_BAR.toLowerCase()}"`);
  });
});
