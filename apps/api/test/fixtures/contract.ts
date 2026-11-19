import type { KakaoListContract } from "@magomap/domain/providers/kakao";

/** A small Kakao import as kakao-list would serve it (contract v1). */
export function baseContract(kakaoUserId = "111"): KakaoListContract {
  return {
    contractVersion: 1,
    kakaoUserId,
    importedAt: "2026-11-19T00:00:00.000Z",
    complete: true,
    lists: [
      {
        kakaoFolderId: 101,
        name: "제주 카페",
        subscribed: false,
        items: [
          {
            favoriteSeq: "9001",
            placeKey: "27324155",
            title: "바다정원 카페",
            address: "제주 애월읍",
            lat: 33.4627,
            lng: 126.3095,
            kakaoNote: "창가 자리",
            kakaoColor: "01",
            position: 0,
            localNote: "주차 어려움",
          },
          {
            favoriteSeq: "9002",
            placeKey: "8125123",
            title: "돌담 브런치",
            address: "제주 한림읍",
            lat: 33.4101,
            lng: 126.2659,
            kakaoColor: "03",
            position: 1,
          },
        ],
      },
      {
        kakaoFolderId: 102,
        name: "서울 맛집",
        subscribed: false,
        items: [
          {
            favoriteSeq: "9101",
            placeKey: "11223344",
            title: "명동 칼국수",
            address: "서울 중구 명동",
            lat: 37.5636,
            lng: 126.9852,
            kakaoColor: "05",
            position: 0,
          },
        ],
      },
      {
        kakaoFolderId: 205,
        name: "민수의 부산 여행",
        subscribed: true,
        ownerName: "민수",
        items: [
          {
            favoriteSeq: "9201",
            placeKey: "55667788",
            title: "해운대 시장",
            address: "부산 해운대구",
            lat: 35.1631,
            lng: 129.1636,
            kakaoColor: "02",
            position: 0,
          },
        ],
      },
    ],
  };
}
