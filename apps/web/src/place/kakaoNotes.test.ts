import { describe, expect, it } from "vitest";
import { membershipColor } from "../map/markers";
import { groupKakaoNotes } from "./kakaoNotes";
import { list, member } from "./testData";

const jeju = list("l_kakao_1", "제주 카페", "kakao");
const fall = list("l_kakao_3", "가을 산책", "kakao");
const wife = list("l_kakao_2", "아내의 맛집", "kakao");

describe("groupKakaoNotes", () => {
  it("skips memberships without a note, or with only spaces", () => {
    expect(
      groupKakaoNotes([
        { item: member("a", jeju.id), list: jeju },
        { item: member("b", fall.id, { providerNote: "   " }), list: fall },
      ]),
    ).toEqual([]);
  });

  it("one card per distinct note, in membership order", () => {
    const cards = groupKakaoNotes([
      { item: member("a", jeju.id, { providerNote: "a" }), list: jeju },
      { item: member("b", wife.id, { providerNote: "b" }), list: wife },
      { item: member("c", fall.id, { providerNote: " a " }), list: fall },
    ]);
    expect(cards.map((c) => c.text)).toEqual(["a", "b"]);
    expect(cards[0]?.from.map((f) => f.name)).toEqual(["제주 카페", "가을 산책"]);
  });

  it("marks lists removed from Kakao", () => {
    const [card] = groupKakaoNotes([
      { item: member("a", wife.id, { providerNote: "n", removedAtProvider: 5 }), list: wife },
    ]);
    expect(card?.from[0]?.removed).toBe(true);
  });

  it("uses the membership's Kakao colour", () => {
    const item = member("a", jeju.id, { providerNote: "n", providerColor: "03" });
    const [card] = groupKakaoNotes([{ item, list: jeju }]);
    expect(card?.from[0]?.color).toBe(membershipColor(item, jeju));
  });
});
