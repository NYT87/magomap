import type {
  KakaoAddRow,
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
import { kakaoFolderIdOf } from "@magomap/domain/providers/kakao";
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
  /**
   * Places she asked to add to one of her Kakao lists that the list doesn't hold yet, each with a
   * stand-in item (last in the list, no Kakao colour or note) so lists and the map can show it.
   */
  pending: PendingAdd[];
}

/** A pending add to a Kakao list, with the stand-in item it is shown by. */
export interface PendingAdd {
  add: KakaoAddRow;
  item: ListItemRow;
}

const standIn = (add: KakaoAddRow): ListItemRow => ({
  id: add.id,
  listId: add.listId,
  placeId: add.placeId,
  position: Number.MAX_SAFE_INTEGER,
  addedAt: add.createdAt,
  externalId: null,
  providerNote: null,
  providerColor: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: add.createdAt,
  updatedAt: add.updatedAt,
  deletedAt: null,
});

export async function loadLibrary(db: MagomapDexie): Promise<Library> {
  const [places, lists, items, userLists, userPlaces, locations, sources, adds] = await Promise.all(
    [
      db.places.toArray(),
      db.lists.toArray(),
      db.list_items.toArray(),
      db.user_lists.toArray(),
      db.user_places.toArray(),
      db.place_locations.toArray(),
      db.place_sources.toArray(),
      db.kakao_adds.toArray(),
    ],
  );
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
  const shownItems = live(items).filter((i) => visibleIds.has(i.listId) && placeMap.has(i.placeId));
  // A pending add the list already holds (before it's cleared) isn't shown twice.
  const held = new Set(
    shownItems.filter((i) => i.removedAtProvider == null).map((i) => `${i.listId} ${i.placeId}`),
  );
  const pending = live(adds as KakaoAddRow[])
    .filter(
      (a) =>
        visibleIds.has(a.listId) &&
        placeMap.has(a.placeId) &&
        !held.has(`${a.listId} ${a.placeId}`),
    )
    .map((add) => ({ add, item: standIn(add) }));
  return {
    places: placeMap,
    lists: visible,
    roles: new Map([...access].map(([id, a]) => [id, a.role])),
    items: shownItems,
    pending,
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

/** Every item lists show: the real ones, then the stand-ins of places pending for a Kakao list. */
export const shownItems = (lib: Library): ListItemRow[] => [
  ...lib.items,
  ...lib.pending.map((p) => p.item),
];

/** Places the user saved that are in none of their visible lists. */
export function savedNotInList(lib: Library): string[] {
  const listed = new Set(
    shownItems(lib)
      .filter((i) => i.removedAtProvider == null)
      .map((i) => i.placeId),
  );
  return [...lib.saved].filter((id) => lib.places.has(id) && !listed.has(id));
}

export const SAVED_GROUP = "__saved";

/** Places shown for the selected lists (and the "Saved, not in a list" group). */
export function visiblePlaces(lib: Library, selected: Set<string>): PlaceRow[] {
  const ids = new Set<string>();
  for (const i of shownItems(lib)) {
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

/** A place's memberships in visible lists, with their lists; pending adds come last, marked. */
export function placeMemberships(lib: Library, placeId: string) {
  const lists = new Map(lib.lists.map((l) => [l.id, l]));
  const real = lib.items
    .filter((i) => i.placeId === placeId)
    .flatMap((item) => {
      const list = lists.get(item.listId);
      return list ? [{ item, list, section: sectionOf(list, lib.roles) }] : [];
    });
  const pending = lib.pending
    .filter((p) => p.item.placeId === placeId)
    .flatMap(({ add, item }) => {
      const list = lists.get(item.listId);
      return list ? [{ item, list, section: sectionOf(list, lib.roles), pending: add }] : [];
    });
  return [...real, ...pending] as {
    item: ListItemRow;
    list: ListRow;
    section: ListSection;
    pending?: KakaoAddRow;
  }[];
}

/** The place's memberships in visible lists, with their lists. */
export const usePlaceMemberships = (id: string) =>
  useLiveQuery(async () => placeMemberships(await loadLibrary(currentDb()), id), [id]);

/**
 * Her own Kakao lists a place can be added to in Kakao Map: not followed ones, not her default
 * list (folder 0, which the extension can't write), and only for a place with a Kakao place id.
 */
export function kakaoListsFor(lib: Library, placeId: string): ListRow[] {
  const keyed = lib.sources.some(
    (s) => s.placeId === placeId && s.provider === "kakao" && /^[1-9]\d{0,14}$/.test(s.externalId),
  );
  if (!keyed) return [];
  return lib.lists
    .filter((l) => {
      // Owner only, as the server requires (a follower or collaborator can't add in Kakao Map).
      if (l.provider !== "kakao" || lib.roles.get(l.id) !== "owner") return false;
      if (l.removedAtProvider != null || l.externalId == null) return false;
      const folder = kakaoFolderIdOf(l.externalId);
      return folder !== undefined && folder > 0;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const useLists = () =>
  useLiveQuery(async () => {
    const lib = await loadLibrary(currentDb());
    const count = (listId: string) =>
      shownItems(lib).filter((i) => i.listId === listId && i.removedAtProvider == null).length;
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

/**
 * A list's places in position order; then places waiting to be added to it in Kakao Map
 * (marked `pending`); removed-at-provider ones last.
 */
export function listPlaces(lib: Library, listId: string) {
  const rows: { item: ListItemRow | null; placeId: string; pending?: KakaoAddRow }[] =
    listId === SAVED_GROUP
      ? savedNotInList(lib).map((placeId) => ({ item: null, placeId }))
      : [
          ...lib.items.filter((i) => i.listId === listId && i.removedAtProvider == null),
          ...lib.pending.filter((p) => p.item.listId === listId).map((p) => p.item),
          ...lib.items.filter((i) => i.listId === listId && i.removedAtProvider != null),
        ]
          .sort(
            (a, b) =>
              Number(a.removedAtProvider != null) - Number(b.removedAtProvider != null) ||
              a.position - b.position,
          )
          .map((item) => {
            const pending = lib.pending.find((p) => p.item === item)?.add;
            return { item, placeId: item.placeId, ...(pending ? { pending } : {}) };
          });
  return rows.flatMap((r) => {
    const place = lib.places.get(r.placeId);
    return place ? [{ ...r, place }] : [];
  });
}

export const useListPlaces = (listId: string) =>
  useLiveQuery(async () => listPlaces(await loadLibrary(currentDb()), listId), [listId]);

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
  const visible = new Set([...lib.saved, ...shownItems(lib).map((i) => i.placeId)]);
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

/** Refused changes, oldest first (sorted here: the table is keyed by mutation id only). */
export async function loadRejected(db: MagomapDexie): Promise<RejectedEntry[]> {
  return (await db.rejected.toArray()).sort((a, b) => a.at - b.at);
}

export const useRejected = () => useLiveQuery(() => loadRejected(currentDb()), []);

/** Tables whose refused rows exist only on this device until the server accepts them. */
const OWN_ROW_TABLES = ["visit_notes", "links", "lists", "list_items", "kakao_adds"];

/**
 * Forgets a refused change after its text was copied. If the local row is still exactly the
 * refused version (the server never replaced it), it goes too, so nothing stays out of step.
 */
export async function dismissRejected(db: MagomapDexie, mutationId: string): Promise<void> {
  const tables = [db.rejected, db.outbox, ...OWN_ROW_TABLES.map((t) => db.table(t))];
  await db.transaction("rw", tables, async () => {
    const entry = await db.rejected.get(mutationId);
    if (!entry) return;
    await db.rejected.delete(mutationId);
    if (entry.op !== "upsert" || !OWN_ROW_TABLES.includes(entry.table)) return;
    const pending = await db.outbox.where("[table+id]").equals([entry.table, entry.id]).count();
    const local = (await db.table(entry.table).get(entry.id)) as { updatedAt?: number } | undefined;
    const refused = entry.row as { updatedAt?: number } | undefined;
    if (pending === 0 && local && refused && local.updatedAt === refused.updatedAt) {
      await db.table(entry.table).delete(entry.id);
    }
  });
}
