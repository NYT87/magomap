import { describe, expect, it } from "vitest";
import { kakaoNoteOf, peekNoteOf } from "./kakaoNotes";
import { list, member } from "./testData";

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

describe("peekNoteOf", () => {
  const entry = (
    section: "mine" | "provider" | "subscribed",
    listName: string,
    note: string | null,
    extra: { provider?: string | null; removed?: boolean } = {},
  ) => ({
    item: member(`i_${listName}`, `l_${listName}`, {
      providerNote: note,
      removedAtProvider: extra.removed ? 5 : null,
    }),
    list: list(`l_${listName}`, listName, extra.provider === undefined ? "kakao" : extra.provider),
    section,
  });

  it("is null without memberships or notes", () => {
    expect(peekNoteOf([])).toBeNull();
    expect(peekNoteOf([entry("provider", "a", null), entry("provider", "b", "  ")])).toBeNull();
  });

  it("takes the note of an owned list before a followed one", () => {
    expect(
      peekNoteOf([entry("subscribed", "a", "followed"), entry("provider", "z", "owned")]),
    ).toBe("owned");
  });

  it("takes a followed list's note when it is the only one", () => {
    expect(peekNoteOf([entry("provider", "a", null), entry("subscribed", "b", "followed")])).toBe(
      "followed",
    );
  });

  it("takes the list whose name sorts first among owned lists", () => {
    expect(peekNoteOf([entry("provider", "나", "second"), entry("provider", "가", "first")])).toBe(
      "first",
    );
  });

  it("skips an empty note and uses the next list's", () => {
    expect(peekNoteOf([entry("provider", "a", ""), entry("provider", "b", "later")])).toBe("later");
  });

  it("never shows a note removed from Kakao, or an own list's item", () => {
    expect(peekNoteOf([entry("provider", "a", "gone", { removed: true })])).toBeNull();
    expect(peekNoteOf([entry("mine", "a", "mine", { provider: null })])).toBeNull();
  });

  it("is trimmed", () => {
    expect(peekNoteOf([entry("provider", "a", " 창가 ")])).toBe("창가");
  });
});
