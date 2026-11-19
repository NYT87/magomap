import { describe, expect, it } from "vitest";
import en from "./en.json";
import { detectLanguage } from "./index";
import ko from "./ko.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("language", () => {
  it("picks Korean for ko-KR and English for en-US", () => {
    expect(detectLanguage("ko-KR", null)).toBe("ko");
    expect(detectLanguage("en-US", null)).toBe("en");
  });

  it("lets a stored choice override the browser", () => {
    expect(detectLanguage("ko-KR", "en")).toBe("en");
    expect(detectLanguage("en-US", "ko")).toBe("ko");
  });

  it("has the same keys in Korean and English", () => {
    expect(keys(ko).sort()).toEqual(keys(en).sort());
  });
});
