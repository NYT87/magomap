import { describe, expect, it } from "vitest";
import {
  KAKAO,
  kakaoContractToImport,
  kakaoFolderIdOf,
  kakaoItemsToImport,
  kakaoListExternalId,
  kakaoListsToImport,
} from "./kakao";

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

  it("gives folder 0 the contract's own user in its external id", () => {
    const zero = {
      ...kakaoListContract,
      lists: [{ ...kakaoListContract.lists[0], kakaoFolderId: 0 }],
    };
    expect(kakaoContractToImport(zero).lists[0]?.externalId).toBe("0~111");
  });

  it("rejects an unknown contract version", () => {
    expect(() => kakaoContractToImport({ ...kakaoListContract, contractVersion: 2 })).toThrow();
  });
});

describe("paged kakao-list endpoints", () => {
  const listsBody = {
    contractVersion: 1,
    kakaoUserId: "111",
    importedAt: "2026-11-19T00:00:00.000Z",
    complete: true,
    subscriptionKnown: true,
    lists: [
      { kakaoFolderId: 101, name: "제주 카페", subscribed: true, ownerName: "지은", itemCount: 2 },
    ],
  };
  const itemsBody = {
    contractVersion: 1,
    kakaoFolderId: 101,
    importedAt: "2026-11-19T00:00:00.000Z",
    total: 2,
    offset: 0,
    items: [
      {
        favoriteSeq: "9001",
        placeKey: "27324155",
        title: "바다정원 카페",
        kakaoNote: "창가 자리",
        kakaoColor: "01",
        position: 0,
      },
    ],
  };

  it("maps the list summaries", () => {
    expect(kakaoListsToImport(listsBody, "111")).toEqual({
      provider: KAKAO,
      importedAt: "2026-11-19T00:00:00.000Z",
      complete: true,
      subscriptionKnown: true,
      lists: [
        { externalId: "101", name: "제주 카페", followed: true, ownerName: "지은", itemCount: 2 },
      ],
    });
  });

  it("passes on the account's own nickname, trimmed and cut to 40", () => {
    expect(kakaoListsToImport({ ...listsBody, ownerNickname: " 지은 " }, "111").ownerNickname).toBe(
      "지은",
    );
    const long = "가".repeat(60);
    expect(kakaoListsToImport({ ...listsBody, ownerNickname: long }, "111").ownerNickname).toBe(
      "가".repeat(40),
    );
  });

  it("drops a nickname it can't use, and still reads every list", () => {
    for (const bad of ["", "   ", 123, "a\u0000b"]) {
      const snapshot = kakaoListsToImport({ ...listsBody, ownerNickname: bad }, "111");
      expect(snapshot.ownerNickname).toBeUndefined();
      expect(snapshot.lists).toHaveLength(1);
    }
  });

  it("maps one page of items", () => {
    expect(kakaoItemsToImport(itemsBody, "111")).toEqual({
      externalId: "101",
      importedAt: "2026-11-19T00:00:00.000Z",
      total: 2,
      offset: 0,
      items: [
        {
          externalId: "9001",
          placeExternalId: "27324155",
          title: "바다정원 카페",
          providerNote: "창가 자리",
          providerColor: "01",
          position: 0,
        },
      ],
    });
  });

  it("rejects summaries that name the same list twice", () => {
    const twice = { ...listsBody, lists: [...listsBody.lists, { ...listsBody.lists[0] }] };
    expect(() => kakaoListsToImport(twice, "111")).toThrow();
  });

  it("rejects a page of more than 500 items", () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      favoriteSeq: String(i),
      title: "t",
      position: i,
    }));
    expect(() => kakaoItemsToImport({ ...itemsBody, items }, "111")).toThrow();
  });

  // Every Kakao user has a folder 0 (their default favourites): it must never be shared.
  it("gives folder 0 a per-person external id, in summaries and pages", () => {
    const lists = { ...listsBody, lists: [{ ...listsBody.lists[0], kakaoFolderId: 0 }] };
    expect(kakaoListsToImport(lists, "111").lists[0]?.externalId).toBe("0~111");
    expect(kakaoListsToImport(lists, "222").lists[0]?.externalId).toBe("0~222");
    expect(kakaoItemsToImport({ ...itemsBody, kakaoFolderId: 0 }, "111").externalId).toBe("0~111");
  });

  it("keeps the folder id of every other folder", () => {
    expect(kakaoListExternalId(101, "111")).toBe("101");
    expect(kakaoListExternalId(0, "111")).toBe("0~111");
  });

  it("reads the folder id back from an external id", () => {
    expect(kakaoFolderIdOf("101")).toBe(101);
    expect(kakaoFolderIdOf("0~111")).toBe(0);
    for (const bad of ["", "abc", "0~", "1~111", "-1", "1.5", "0~111~2"]) {
      expect(kakaoFolderIdOf(bad)).toBeUndefined();
    }
  });
});
