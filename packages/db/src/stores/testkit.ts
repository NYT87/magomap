// Test helpers shared by the store tests (not imported by production code).
import type { ListItemRow, ListRow, Mutation, PlaceRow, VisitNoteRow } from "@magomap/domain";
import { ownItemRowId, placeRowId } from "@magomap/domain/ids";
import type { Db } from "../core";

export const T0 = 1_763_000_000_000;
let counter = 0;

export async function addUser(db: Db, id: string) {
  await db.kysely.insertInto("users").values({ id, display_name: null, created_at: T0 }).execute();
}

/** A place as the app pushes it after a provider search. */
export function searchedPlace(
  externalId: string,
  extra: Partial<PlaceRow> & { provider?: string } = {},
) {
  const { provider = "kakao", ...rest } = extra;
  return {
    id: placeRowId(provider, externalId),
    title: `카페 ${externalId}`,
    address: "제주 애월읍",
    roadAddress: null,
    addressSource: "search" as const,
    category: "카페",
    phone: null,
    lat: 33.46,
    lng: 126.31,
    providerSnapshotAt: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    source: { provider, externalId },
    ...rest,
  };
}

export function ownList(id: string, extra: Partial<ListRow> = {}): ListRow {
  return {
    id,
    provider: null,
    externalId: null,
    name: "바다 뷰",
    description: null,
    color: "#1F6F5C",
    ownerName: null,
    removedAtProvider: null,
    providerSnapshotAt: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...extra,
  };
}

export function ownItem(
  listId: string,
  placeId: string,
  extra: Partial<ListItemRow> = {},
): ListItemRow {
  return {
    id: ownItemRowId(listId, placeId),
    listId,
    placeId,
    position: 0,
    addedAt: T0,
    externalId: null,
    providerNote: null,
    providerColor: null,
    removedAtProvider: null,
    providerSnapshotAt: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...extra,
  };
}

export function note(id: string, placeId: string, extra: Partial<VisitNoteRow> = {}): VisitNoteRow {
  return {
    id,
    placeId,
    visitedOn: "2026-11-19",
    body: "바다가 보였어요",
    origin: "user",
    originKey: null,
    editedByUser: false,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...extra,
  };
}

export const up = (
  table: Mutation["table"],
  row: { id: string },
  at = T0 + 1,
  mutationId?: string,
): Mutation => ({
  mutationId: mutationId ?? `m${++counter}`,
  table,
  op: "upsert",
  id: row.id,
  row,
  clientUpdatedAt: at,
});
export const del = (table: Mutation["table"], id: string, at = T0 + 1): Mutation => ({
  mutationId: `m${++counter}`,
  table,
  op: "delete",
  id,
  clientUpdatedAt: at,
});

/** Runs `before` once, right before the first write batch: another writer slips in after the pre-read. */
export function interleaved(db: Db, before: () => Promise<unknown>): Db {
  let done = false;
  return {
    ...db,
    atomic: async (qs) => {
      if (!done) {
        done = true;
        await before();
      }
      return db.atomic(qs);
    },
  };
}
