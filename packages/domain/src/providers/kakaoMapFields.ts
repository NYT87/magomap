// The raw Kakao Map fields magomap reads: the Kakao Map adapter (kakaoMap.ts, including
// kakaoFavoritePoint) and kakao-list's mapping it must match (kakaoListParity.fixture.ts). The
// extension sends only these, so a favourite's unused fields (a route's waypoints, say) never
// leave her browser. readInPage keeps its own copy (it runs in the Kakao page and can't import);
// its test checks that copy against these lists, and kakaoMap.test.ts checks the adapter reads
// nothing else. No imports here, so the extension's test can read this file directly.

/** Fields of a `/favorite/mine/list` record. */
export const KAKAO_FAVORITE_FIELDS: readonly string[] = [
  "seq",
  "key",
  "type",
  "display1",
  "display2",
  "memo",
  "color",
  "lat",
  "lon",
  "x",
  "y",
];

/** Fields of a `/folder/list` record. */
export const KAKAO_FOLDER_FIELDS: readonly string[] = [
  "folderid",
  "status",
  "title",
  "memo",
  "nickname",
  "kakao_map_user_id",
  "map_user_id",
  "subscribe",
  "favorite_cnt",
  "folder_updated_at",
];
