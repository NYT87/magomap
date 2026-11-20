import { describe, expect, it } from "vitest";
import { checkPages } from "./check-pages";

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
});
