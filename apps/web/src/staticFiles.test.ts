import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, "..", file), "utf8");

describe("files served as they are", () => {
  it("index.html opens the Kakao map's connections before the app asks for them", () => {
    const html = read("index.html");
    for (const origin of [
      "https://dapi.kakao.com",
      "https://t1.kakaocdn.net",
      "https://mts.kakaocdn.net",
    ])
      expect(html).toContain(`<link rel="preconnect" href="${origin}" />`);
  });

  it("robots.txt keeps the private app out of search engines", () => {
    expect(read("public/robots.txt")).toBe("User-agent: *\nDisallow: /\n");
  });
});
