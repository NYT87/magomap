import type { AddressSource } from "./location";

export type SyncTable =
  | "places"
  | "place_sources"
  | "place_locations"
  | "lists"
  | "list_items"
  | "user_lists"
  | "user_places"
  | "visit_notes"
  | "links"
  | "kakao_adds";
export type ClientWritableTable =
  | "places"
  | "lists"
  | "list_items"
  | "visit_notes"
  | "links"
  | "kakao_adds";

export const SYNC_TABLES: readonly SyncTable[] = [
  "places",
  "place_sources",
  "place_locations",
  "lists",
  "list_items",
  "user_lists",
  "user_places",
  "visit_notes",
  "links",
  "kakao_adds",
];
export const CLIENT_WRITABLE_TABLES: readonly ClientWritableTable[] = [
  "places",
  "lists",
  "list_items",
  "visit_notes",
  "links",
  "kakao_adds",
];

export interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  seq?: number;
}

/** A real place, shared by everyone who has it. Never deleted. */
export interface PlaceRow extends Base {
  title: string;
  address: string | null;
  roadAddress: string | null;
  addressSource: AddressSource | null;
  category: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  providerSnapshotAt: number | null;
}

/** An external id of a place at a provider. */
export interface PlaceSourceRow extends Base {
  placeId: string;
  provider: string;
  externalId: string;
}

/** An own list (provider null, private) or a provider list (shared). */
export interface ListRow extends Base {
  provider: string | null;
  externalId: string | null;
  name: string;
  description: string | null;
  color: string | null;
  ownerName: string | null;
  removedAtProvider: number | null;
  providerSnapshotAt: number | null;
}

export interface ListItemRow extends Base {
  listId: string;
  placeId: string;
  position: number;
  addedAt: number;
  externalId: string | null;
  providerNote: string | null;
  providerColor: string | null;
  /** An own-list item's Kakao colour code (two digits), kept from the place it was copied from. */
  itemColor?: string | null;
  removedAtProvider: number | null;
  providerSnapshotAt: number | null;
}

export interface UserListRow extends Base {
  listId: string;
  role: "owner" | "follower" | "collaborator";
  removedAt: number | null;
}

export interface UserPlaceRow extends Base {
  placeId: string;
  savedAt: number;
}

export interface VisitNoteRow extends Base {
  placeId: string;
  visitedOn: string | null;
  body: string;
  origin: "user" | "import";
  originKey: string | null;
  editedByUser: boolean;
}

export interface LinkRow extends Base {
  placeId: string;
  url: string;
  title: string | null;
}

/**
 * A place she asked to add to one of her own Kakao lists, not yet in Kakao Map: the extension
 * adds it there, and the next Kakao Map sync brings it in as a list item, which clears this row.
 */
export interface KakaoAddRow extends Base {
  listId: string;
  placeId: string;
  /** Why it can't be added: the list is gone from her Kakao Map, or isn't hers. */
  failed: "list_missing" | null;
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

export type AnyRow =
  | PlaceRow
  | PlaceSourceRow
  | PlaceLocationRow
  | ListRow
  | ListItemRow
  | UserListRow
  | UserPlaceRow
  | VisitNoteRow
  | LinkRow
  | KakaoAddRow;

export type RowOf<T extends SyncTable> = {
  places: PlaceRow;
  place_sources: PlaceSourceRow;
  place_locations: PlaceLocationRow;
  lists: ListRow;
  list_items: ListItemRow;
  user_lists: UserListRow;
  user_places: UserPlaceRow;
  visit_notes: VisitNoteRow;
  links: LinkRow;
  kakao_adds: KakaoAddRow;
}[T];
