import { describe, expect, it } from "vitest";
import { kakaoLinks } from "./kakaoLinks";

describe("kakaoLinks", () => {
  it("opens the Kakao Map app, or the web page", () => {
    expect(kakaoLinks("123")).toEqual({
      app: "kakaomap://place?id=123",
      web: "https://place.map.kakao.com/123",
    });
  });
});
