import type {
  LinkRow,
  ListItemRow,
  ListRow,
  PlaceLocationRow,
  PlaceRow,
  PlaceSourceRow,
  UserListRow,
  UserPlaceRow,
  VisitNoteRow,
} from "@magomap/domain";
import { useLiveQuery } from "dexie-react-hooks";
import { currentDb, type MagomapDexie, type RejectedEntry } from "./db";

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((r) => r.deletedAt == null);

/** Everything the map and lists need, already filtered to what this user can see. */
export interface Library {
  places: Map<string, PlaceRow>;
  /** Visible lists: own lists, and provider lists the user still has. */
  lists: ListRow[];
  roles: Map<string, UserListRow["role"]>;
  /** Live memberships of visible lists (including ones removed at the provider). */
  items: ListItemRow[];
  saved: Set<string>;
  locations: PlaceLocationRow[];
  sources: PlaceSourceRow[];
}

export async function loadLibrary(db: MagomapDexie): Promise<Library> {
  const [places, lists, items, userLists, userPlaces, locations, sources] = await Promise.all([
    db.places.toArray(),
    db.lists.toArray(),
    db.list_items.toArray(),
    db.user_lists.toArray(),
    db.user_places.toArray(),
    db.place_locations.toArray(),
    db.place_sources.toArray(),
  ]);
  const access = new Map<string, UserListRow>();
  for (const u of live(userLists)) access.set(u.listId, u);
  // A list the user unfollowed (removedAt) is hidden with its memberships.
  const visible = live(lists).filter((l) => {
    const a = access.get(l.id);
    if (a?.removedAt != null) return false;
    return l.provider === null || a != null;
  });
  const visibleIds = new Set(visible.map((l) => l.id));
  const placeMap = new Map(live(places).map((p) => [p.id, p]));
  return {
    places: placeMap,
    lists: visible,
    roles: new Map([...access].map(([id, a]) => [id, a.role])),
    items: live(items).filter((i) => visibleIds.has(i.listId) && placeMap.has(i.placeId)),
    saved: new Set(live(userPlaces as UserPlaceRow[]).map((u) => u.placeId)),
    locations: live(locations),
    sources: live(sources),
  };
}

export const useLibrary = () => useLiveQuery(() => loadLibrary(currentDb()), []);

export type ListSection = "mine" | "provider" | "subscribed";

/** Which section of the picker a list belongs to. */
export function sectionOf(list: ListRow, roles: Map<string, UserListRow["role"]>): ListSection {
  if (list.provider === null) return "mine";
  return roles.get(list.id) === "follower" ? "subscribed" : "provider";
}

/** Places the user saved that are in none of their visible lists. */
export function savedNotInList(lib: Library): string[] {
  const listed = new Set(
    lib.items.filter((i) => i.removedAtProvider == null).map((i) => i.placeId),
  );
  return [...lib.saved].filter((id) => lib.places.has(id) && !listed.has(id));
}

export const SAVED_GROUP = "__saved";

/** Places shown for the selected lists (and the "Saved, not in a list" group). */
export function visiblePlaces(lib: Library, selected: Set<string>): PlaceRow[] {
  const ids = new Set<string>();
  for (const i of lib.items) {
    if (i.removedAtProvider == null && selected.has(i.listId)) ids.add(i.placeId);
  }
  if (selected.has(SAVED_GROUP)) for (const id of savedNotInList(lib)) ids.add(id);
  return [...ids].flatMap((id) => {
    const p = lib.places.get(id);
    return p ? [p] : [];
  });
}

export const useVisiblePlaces = (selectedListIds: Set<string>) => {
  const lib = useLibrary();
  return lib ? visiblePlaces(lib, selectedListIds) : undefined;
};

export const usePlace = (id: string) =>
  useLiveQuery(async () => {
    const p = await currentDb().places.get(id);
    return p && p.deletedAt == null ? p : null;
  }, [id]);

export const usePlaceSources = (id: string) =>
  useLiveQuery(
    async () => live(await currentDb().place_sources.where("placeId").equals(id).toArray()),
    [id],
  );

export const usePlaceLinks = (id: string) =>
  useLiveQuery(
    async () =>
      live(await currentDb().links.where("placeId").equals(id).toArray()).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [id],
  );

/** Newest visit first (undated ones after dated ones), then newest written first. */
export function sortNotes(notes: VisitNoteRow[]): VisitNoteRow[] {
  return [...notes].sort((a, b) => {
    if (a.visitedOn !== b.visitedOn) {
      if (a.visitedOn == null) return 1;
      if (b.visitedOn == null) return -1;
      return a.visitedOn < b.visitedOn ? 1 : -1;
    }
    return b.createdAt - a.createdAt;
  });
}

export const usePlaceNotes = (id: string) =>
  useLiveQuery(
    async () =>
      sortNotes(live(await currentDb().visit_notes.where("placeId").equals(id).toArray())),
    [id],
  );

export const usePlaceLocations = (id: string) =>
  useLiveQuery(
    async () =>
      live(await currentDb().place_locations.where("placeId").equals(id).toArray()).sort(
        (a, b) => b.validUntil - a.validUntil,
      ),
    [id],
  );

/** The place's memberships in visible lists, with their lists. */
export const usePlaceMemberships = (id: string) =>
  useLiveQuery(async () => {
    const lib = await loadLibrary(currentDb());
    const lists = new Map(lib.lists.map((l) => [l.id, l]));
    return lib.items
      .filter((i) => i.placeId === id)
      .flatMap((item) => {
        const list = lists.get(item.listId);
        return list ? [{ item, list, section: sectionOf(list, lib.roles) }] : [];
      });
  }, [id]);

export const useLists = () =>
  useLiveQuery(async () => {
    const lib = await loadLibrary(currentDb());
    const count = (listId: string) =>
      lib.items.filter((i) => i.listId === listId && i.removedAtProvider == null).length;
    const byName = (a: ListRow, b: ListRow) => a.name.localeCompare(b.name);
    const of = (s: ListSection) =>
      lib.lists
        .filter((l) => sectionOf(l, lib.roles) === s)
        .sort(byName)
        .map((list) => ({ list, count: count(list.id) }));
    return {
      mine: of("mine"),
      provider: of("provider"),
      subscribed: of("subscribed"),
      savedNotInList: savedNotInList(lib).length,
    };
  }, []);

/** A list's places in position order; removed-at-provider ones last. */
export const useListPlaces = (listId: string) =>
  useLiveQuery(async () => {
    const lib = await loadLibrary(currentDb());
    const rows =
      listId === SAVED_GROUP
        ? savedNotInList(lib).map((placeId) => ({ item: null, placeId }))
        : lib.items
            .filter((i) => i.listId === listId)
            .sort(
              (a, b) =>
                Number(a.removedAtProvider != null) - Number(b.removedAtProvider != null) ||
                a.position - b.position,
            )
            .map((item) => ({ item, placeId: item.placeId }));
    return rows.flatMap((r) => {
      const place = lib.places.get(r.placeId);
      return place ? [{ ...r, place }] : [];
    });
  }, [listId]);

/** The previous location a moment falls in, or null when it's in the current location. */
export function locationAt(rows: PlaceLocationRow[], at: number): PlaceLocationRow | null {
  return rows.find((r) => r.deletedAt == null && r.validFrom <= at && at < r.validUntil) ?? null;
}

/** A visit date read as local noon, so time zones don't move it across a day. */
export const visitMoment = (visitedOn: string) => new Date(`${visitedOn}T12:00:00`).getTime();

/** Saved and listed places matching a word in their title, address, notes or link titles. */
export async function searchLocal(db: MagomapDexie, q: string): Promise<string[]> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const lib = await loadLibrary(db);
  const visible = new Set([...lib.saved, ...lib.items.map((i) => i.placeId)]);
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle);
  const hits = new Set<string>();
  for (const p of lib.places.values()) {
    if (visible.has(p.id) && (has(p.title) || has(p.address) || has(p.roadAddress))) hits.add(p.id);
  }
  for (const n of live(await db.visit_notes.toArray())) if (has(n.body)) hits.add(n.placeId);
  for (const l of live((await db.links.toArray()) as LinkRow[]))
    if (has(l.title)) hits.add(l.placeId);
  return [...hits].filter((id) => visible.has(id) && lib.places.has(id));
}

export const useRejected = () =>
  useLiveQuery(
    async (): Promise<RejectedEntry[]> => currentDb().rejected.orderBy("at").toArray(),
    [],
  );
