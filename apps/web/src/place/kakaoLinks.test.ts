import { describe, expect, it } from "vitest";
import { kakaoLinks } from "./kakaoLinks";

describe("kakaoLinks", () => {
  it("opens the Kakao Map app, or the web page", () => {
    expect(kakaoLinks("123")).toEqual({
      app: "kakaomap://place?placeId=123",
      web: "https://place.map.kakao.com/123",
    });
  });

  // ADDRESS favourites have keys like N34923295 or J149809285: not Kakao place ids.
  it("opens an address at its position, not as a place page", () => {
    expect(
      kakaoLinks("N34923295", {
        title: "12 Yeonmujang 3-gil, Seoul",
        lat: 37.54465465,
        lng: 127.05177942,
      }),
    ).toEqual({
      app: "kakaomap://look?p=37.54465465,127.05177942",
      web: "https://map.kakao.com/link/map/12%20Yeonmujang%203-gil%20Seoul,37.54465465,127.05177942",
    });
  });

  it("has no link for an address without a position", () => {
    expect(kakaoLinks("J149809285")).toBeNull();
  });
});
