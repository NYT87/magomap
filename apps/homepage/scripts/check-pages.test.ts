import { describe, expect, it } from "vitest";
import { appUrlOf, checkPages } from "./check-pages";

const dir = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

describe("check-pages", () => {
  it("passes a site where every page has its twin and links resolve", () => {
    expect(checkPages(dir("good"), "https://app.test/")).toEqual([]);
  });

  it("names a page that exists in only one language, a dead link, and a wrong app link", () => {
    const problems = checkPages(dir("broken"), "https://app.test/");
    expect(problems).toContain("ko/privacy/index.html has no English twin (privacy/index.html)");
    expect(problems).toContain("ko/index.html links to a missing page: /magomap/ko/missing/");
    expect(problems).toContain(
      "ko/privacy/index.html: an 'Open magomap' link goes to https://elsewhere.test/, not https://app.test/",
    );
  });

  it("names an app link with spaces around it, even when the app URL has the same spaces", () => {
    expect(checkPages(dir("good"), " https://app.test/")).toContain(
      "the app URL ' https://app.test/' has spaces around it",
    );
  });

  it("trims the app URL taken from the environment, and falls back when it is blank", () => {
    expect(appUrlOf(" https://app.test/ ")).toBe("https://app.test/");
    expect(appUrlOf("   ")).toBe("http://localhost:8787/");
    expect(appUrlOf(undefined)).toBe("http://localhost:8787/");
  });
});
