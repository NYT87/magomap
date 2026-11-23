import type {
  ListItemRow,
  ListRow,
  PlaceLocationRow,
  PlaceRow,
  PlaceSourceRow,
  RowOf,
  SyncTable,
  UserListRow,
  UserPlaceRow,
  VisitNoteRow,
} from "@magomap/domain";
import { LIMITS } from "@magomap/domain/limits";
import type { Db } from "../core";
import { toAnyRow } from "../mapping";
import { pullPage } from "./sync";

/** A row as exported: the wire row without its sync counter, which means nothing outside the server. */
type Out<T> = Omit<T, "seq">;
type LinkRow = RowOf<"links">;

export interface UserExport {
  format: "magomap-export";
  /** Bumped when a field is removed or renamed; adding fields does not bump it. */
  version: 1;
  exportedAt: string;
  account: { displayName: string | null; createdAt: number; signInProviders: string[] };
  /** Rows that belong to this user alone. */
  mine: {
    savedPlaces: Out<UserPlaceRow>[];
    notes: Out<VisitNoteRow>[];
    links: Out<LinkRow>[];
    /** The lists this user made, with their items. */
    lists: Out<ListRow>[];
    listItems: Out<ListItemRow>[];
    /** Which lists (own and followed Kakao lists) the user belongs to, and how. */
    listMemberships: Out<UserListRow>[];
  };
  /** Rows other people can see too, included only because this user's places or lists reach them. */
  shared: {
    places: Out<PlaceRow>[];
    placeSources: Out<PlaceSourceRow>[];
    placeLocations: Out<PlaceLocationRow>[];
    /** Followed provider lists (e.g. Kakao). */
    lists: Out<ListRow>[];
    listItems: Out<ListItemRow>[];
  };
}

/** Every live row of `table` the user may see, read in keyset pages so no single read is large. */
async function readAll<T extends SyncTable>(
  db: Db,
  userId: string,
  table: T,
  pageRows: number,
): Promise<Out<RowOf<T>>[]> {
  const out: Out<RowOf<T>>[] = [];
  let seq = -1;
  let id = "";
  for (;;) {
    const { rows } = await pullPage(table, userId, seq, id, pageRows).execute(db.kysely);
    for (const raw of rows) {
      const { seq: _seq, ...row } = toAnyRow(table, raw as Record<string, unknown>) as {
        seq?: number;
        deletedAt?: number | null;
      };
      if (row.deletedAt == null) out.push(row as Out<RowOf<T>>);
    }
    const last = rows.at(-1);
    if (rows.length < pageRows || !last) return out;
    seq = Number(last.seq);
    id = last.id;
  }
}

/**
 * Everything that belongs to the user, as one JSON-serialisable object. It reads through the
 * same user-scoped queries as a sync pull (never a scan of a shared table), a page at a time,
 * so the user's own rows and only the shared rows their places and lists reach come out; other
 * users' notes, links and saved places, sessions, and server-only columns never do.
 */
export async function exportUserData(
  db: Db,
  userId: string,
  now: number,
  opts: { pageRows?: number } = {},
): Promise<UserExport> {
  const pageRows = opts.pageRows ?? LIMITS.pullPageRows;
  const user = await db.kysely
    .selectFrom("users")
    .select(["display_name", "created_at"])
    .where("id", "=", userId)
    .executeTakeFirst();
  const identities = await db.kysely
    .selectFrom("identities")
    .select("provider")
    .where("user_id", "=", userId)
    .execute();
  const read = <T extends SyncTable>(table: T) => readAll(db, userId, table, pageRows);
  const lists = await read("lists");
  const listItems = await read("list_items");
  const places = await read("places");
  const placeSources = await read("place_sources");
  const placeLocations = await read("place_locations");
  const savedPlaces = await read("user_places");
  const notes = await read("visit_notes");
  const links = await read("links");
  const listMemberships = await read("user_lists");
  // Own lists have no provider; they and their items are the user's, the rest are shared.
  const ownListIds = new Set(lists.filter((l) => l.provider === null).map((l) => l.id));
  return {
    format: "magomap-export",
    version: 1,
    exportedAt: new Date(now).toISOString(),
    account: {
      displayName: user?.display_name ?? null,
      createdAt: Number(user?.created_at ?? 0),
      signInProviders: identities.map((i) => i.provider),
    },
    mine: {
      savedPlaces,
      notes,
      links,
      lists: lists.filter((l) => ownListIds.has(l.id)),
      listItems: listItems.filter((i) => ownListIds.has(i.listId)),
      listMemberships,
    },
    shared: {
      places,
      placeSources,
      placeLocations,
      lists: lists.filter((l) => !ownListIds.has(l.id)),
      listItems: listItems.filter((i) => !ownListIds.has(i.listId)),
    },
  };
}
