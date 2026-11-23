import { describe, expect, it } from "vitest";
import { kakaoNoteOf } from "./kakaoNotes";
import { member } from "./testData";

describe("kakaoNoteOf", () => {
  it("is null without a note, or with only spaces", () => {
    expect(kakaoNoteOf(member("a", "l"))).toBeNull();
    expect(kakaoNoteOf(member("b", "l", { providerNote: "   " }))).toBeNull();
    expect(kakaoNoteOf(member("c", "l", { providerNote: "" }))).toBeNull();
  });

  it("is the note, trimmed", () => {
    expect(kakaoNoteOf(member("a", "l", { providerNote: " 창가 자리 " }))).toBe("창가 자리");
  });

  it("keeps line breaks inside the note", () => {
    expect(kakaoNoteOf(member("a", "l", { providerNote: "one\ntwo" }))).toBe("one\ntwo");
  });
});
