import type { AddressSource } from "./location";

export type SyncTable =
  | "places"
  | "lists"
  | "list_items"
  | "visit_notes"
  | "links"
  | "place_locations";
export type ClientWritableTable = Exclude<SyncTable, "place_locations">;

export const SYNC_TABLES: readonly SyncTable[] = [
  "places",
  "lists",
  "list_items",
  "visit_notes",
  "links",
  "place_locations",
];
export const CLIENT_WRITABLE_TABLES: readonly ClientWritableTable[] = [
  "places",
  "lists",
  "list_items",
  "visit_notes",
  "links",
];

export interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  seq?: number;
}

export interface PlaceRow extends Base {
  kakaoPlaceId: string | null;
  title: string;
  address: string | null;
  roadAddress: string | null;
  addressSource: AddressSource | null;
  category: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  source: "kakao_import" | "search";
}

export interface ListRow extends Base {
  kind: "kakao" | "own";
  kakaoFolderId: number | null;
  subscribed: boolean;
  ownerName: string | null;
  name: string;
  description: string | null;
  color: string | null;
  removedFromKakaoAt: number | null;
}

export interface ListItemRow extends Base {
  listId: string;
  placeId: string;
  position: number;
  addedAt: number;
  kakaoFavoriteSeq: string | null;
  kakaoNote: string | null;
  kakaoColor: string | null;
  removedFromKakaoAt: number | null;
}

export interface VisitNoteRow extends Base {
  placeId: string;
  visitedOn: string | null;
  body: string;
  origin: "user" | "kakao_list";
  originKey: string | null;
  editedByUser: boolean;
}

export interface LinkRow extends Base {
  placeId: string;
  url: string;
  title: string | null;
}

export interface PlaceLocationRow extends Base {
  placeId: string;
  address: string | null;
  roadAddress: string | null;
  lat: number | null;
  lng: number | null;
  validFrom: number;
  validUntil: number;
  detectedBy: AddressSource;
}

export type AnyRow = PlaceRow | ListRow | ListItemRow | VisitNoteRow | LinkRow | PlaceLocationRow;

export type RowOf<T extends SyncTable> = {
  places: PlaceRow;
  lists: ListRow;
  list_items: ListItemRow;
  visit_notes: VisitNoteRow;
  links: LinkRow;
  place_locations: PlaceLocationRow;
}[T];
