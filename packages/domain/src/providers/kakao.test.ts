import { describe, expect, it } from "vitest";
import { KAKAO, kakaoContractToImport } from "./kakao";

const kakaoListContract = {
  contractVersion: 1,
  kakaoUserId: "111",
  importedAt: "2026-11-19T00:00:00.000Z",
  complete: true,
  subscriptionKnown: true,
  lists: [
    {
      kakaoFolderId: 101,
      name: "제주 카페",
      subscribed: true,
      ownerName: "지은",
      items: [
        {
          favoriteSeq: "9001",
          placeKey: "27324155",
          title: "바다정원 카페",
          address: "제주 애월읍",
          lat: 33.46,
          lng: 126.31,
          kakaoNote: "창가 자리",
          kakaoColor: "01",
          position: 0,
          localNote: "주차 어려움",
        },
        { favoriteSeq: "9002", title: "내 핀", position: 1 },
      ],
    },
  ],
};

describe("kakaoContractToImport", () => {
  it("maps kakao-list's contract to the neutral import", () => {
    expect(kakaoContractToImport(kakaoListContract)).toEqual({
      provider: KAKAO,
      importedAt: "2026-11-19T00:00:00.000Z",
      complete: true,
      subscriptionKnown: true,
      lists: [
        {
          externalId: "101",
          name: "제주 카페",
          followed: true,
          ownerName: "지은",
          items: [
            {
              externalId: "9001",
              placeExternalId: "27324155",
              title: "바다정원 카페",
              address: "제주 애월읍",
              lat: 33.46,
              lng: 126.31,
              providerNote: "창가 자리",
              providerColor: "01",
              position: 0,
              localNote: "주차 어려움",
            },
            { externalId: "9002", title: "내 핀", position: 1 },
          ],
        },
      ],
    });
  });

  it("treats a snapshot without subscriptionKnown as not knowing", () => {
    const { subscriptionKnown: _drop, ...old } = kakaoListContract;
    expect(kakaoContractToImport(old).subscriptionKnown).toBe(false);
  });

  it("rejects an unknown contract version", () => {
    expect(() => kakaoContractToImport({ ...kakaoListContract, contractVersion: 2 })).toThrow();
  });
});
