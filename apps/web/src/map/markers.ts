import type {
  ListItemRow,
  ListRow,
  PlaceLocationRow,
  PlaceRow,
  UserListRow,
} from "@magomap/domain";
import { SAVED_GROUP } from "../data/queries";
import { KAKAO_PLACE_COLORS } from "./kakaoColors";
import type { MapMarker } from "./MapAdapter";

export const THEME_PRIMARY = "#1F6F5C";

export interface MarkerInput {
  places: PlaceRow[];
  memberships: ListItemRow[];
  lists: ListRow[];
  locations: PlaceLocationRow[];
  roles: Map<string, UserListRow["role"]>;
  /** Saved places; shown (in the theme colour) when the "Saved, not in a list" group is visible. */
  saved: Set<string>;
  visibleListIds: Set<string>;
  showPrevious: boolean;
}

const rank = (list: ListRow, roles: MarkerInput["roles"]) =>
  list.provider === null ? 0 : roles.get(list.id) === "follower" ? 2 : 1;

/** The colour a membership gives its place: Kakao's favourite colour, the own list's, or the theme. */
export function membershipColor(item: ListItemRow, list: ListRow): string {
  if (list.provider !== null) {
    return (item.providerColor && KAKAO_PLACE_COLORS[item.providerColor]?.value) || THEME_PRIMARY;
  }
  return list.color ?? THEME_PRIMARY;
}

export function buildMarkers(input: MarkerInput): MapMarker[] {
  const lists = new Map(input.lists.map((l) => [l.id, l]));
  const byPlace = new Map<string, { item: ListItemRow; list: ListRow }[]>();
  for (const item of input.memberships) {
    const list = lists.get(item.listId);
    if (!list || item.deletedAt != null || item.removedAtProvider != null) continue;
    if (!input.visibleListIds.has(list.id)) continue;
    const arr = byPlace.get(item.placeId) ?? [];
    arr.push({ item, list });
    byPlace.set(item.placeId, arr);
  }
  const listedAnywhere = new Set(
    input.memberships
      .filter((i) => i.deletedAt == null && i.removedAtProvider == null && lists.has(i.listId))
      .map((i) => i.placeId),
  );
  const showSaved = input.visibleListIds.has(SAVED_GROUP);

  const markers: MapMarker[] = [];
  for (const place of input.places) {
    const ms = byPlace.get(place.id);
    let color: string;
    if (ms && ms.length > 0) {
      ms.sort(
        (a, b) =>
          rank(a.list, input.roles) - rank(b.list, input.roles) ||
          a.list.name.localeCompare(b.list.name),
      );
      const first = ms[0] as { item: ListItemRow; list: ListRow };
      color = membershipColor(first.item, first.list);
    } else if (showSaved && input.saved.has(place.id) && !listedAnywhere.has(place.id)) {
      color = THEME_PRIMARY;
    } else continue;
    if (place.lat != null && place.lng != null) {
      markers.push({
        id: place.id,
        placeId: place.id,
        position: { lat: place.lat, lng: place.lng },
        color,
        label: place.title,
        kind: "saved",
      });
    }
    if (!input.showPrevious) continue;
    for (const loc of input.locations) {
      if (loc.placeId !== place.id || loc.deletedAt != null || loc.lat == null || loc.lng == null)
        continue;
      markers.push({
        id: `prev:${loc.id}`,
        placeId: place.id,
        position: { lat: loc.lat, lng: loc.lng },
        color,
        label: place.title,
        kind: "previous",
      });
    }
  }
  return markers;
}
