// Seed rows for the place-page tests.
import type {
  ListItemRow,
  ListRow,
  PlaceLocationRow,
  PlaceRow,
  UserListRow,
} from "@magomap/domain";
import type { MagomapDexie } from "../data/db";

export const PLACE: PlaceRow = {
  id: "p_kakao_123",
  title: "바다빵집",
  address: "제주 애월읍 새 주소",
  roadAddress: null,
  addressSource: "import",
  category: "베이커리",
  phone: null,
  lat: 33.46,
  lng: 126.31,
  providerSnapshotAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

export const MOVED_AT = new Date("2026-06-01T00:00:00").getTime();

export const OLD_LOCATION: PlaceLocationRow = {
  id: "loc1",
  placeId: PLACE.id,
  address: "제주 애월읍 옛 주소",
  roadAddress: null,
  lat: 33.45,
  lng: 126.3,
  validFrom: new Date("2025-01-01T00:00:00").getTime(),
  validUntil: MOVED_AT,
  detectedBy: "import",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

export const list = (id: string, name: string, provider: string | null): ListRow => ({
  id,
  provider,
  externalId: provider ? id : null,
  name,
  description: null,
  color: provider ? null : "#7A4E7E",
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

export const access = (listId: string, role: UserListRow["role"]): UserListRow => ({
  id: `ul_${listId}`,
  listId,
  role,
  removedAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

export const member = (
  id: string,
  listId: string,
  extra: Partial<ListItemRow> = {},
): ListItemRow => ({
  id,
  listId,
  placeId: PLACE.id,
  position: 0,
  addedAt: 0,
  externalId: null,
  providerNote: null,
  providerColor: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...extra,
});

/** A place in an own list, a Kakao list and a subscribed list, plus another own list it isn't in. */
export async function seed(db: MagomapDexie) {
  await db.places.put(PLACE);
  await db.lists.bulkPut([
    list("own-a", "빵 지도", null),
    list("own-b", "가 볼 곳", null),
    list("l_kakao_1", "제주 카페", "kakao"),
    list("l_kakao_2", "아내의 맛집", "kakao"),
  ]);
  await db.user_lists.bulkPut([
    access("own-a", "owner"),
    access("own-b", "owner"),
    access("l_kakao_1", "owner"),
    access("l_kakao_2", "follower"),
  ]);
  await db.list_items.bulkPut([
    member("li_own-a", "own-a"),
    member("i_kakao_1_10", "l_kakao_1", { providerNote: "창가 자리", providerColor: "01" }),
    member("i_kakao_2_20", "l_kakao_2", { removedAtProvider: 5 }),
  ]);
}
