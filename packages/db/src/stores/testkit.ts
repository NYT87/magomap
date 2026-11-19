// Test helpers shared by the store tests (not imported by production code).

import { createHash } from "node:crypto";
import type {
  ImportList,
  ListItemRow,
  ListRow,
  Mutation,
  PlaceRow,
  VisitNoteRow,
} from "@magomap/domain";
import { ownItemRowId, placeRowId } from "@magomap/domain/ids";
import type { Db } from "../core";
import { completeImportRun, finishImportList, importListChunk, startImportRun } from "./importRuns";
import { applyPush } from "./sync";

/** A deterministic UUID for a readable test name ("n1" → the same UUID every time). */
export function uid(name: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return name;
  const h = createHash("sha1").update(name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** applyPush with signatures trusted (store tests exercise rules, not the signature check). */
export const push = (
  db: Db,
  userId: string,
  mutations: Parameters<typeof applyPush>[2],
  now: number,
) => applyPush(db, userId, mutations, now, { verifySource: () => true });

export const T0 = 1_763_000_000_000;
let counter = 0;

export async function addUser(db: Db, id: string) {
  await db.kysely.insertInto("users").values({ id, display_name: null, created_at: T0 }).execute();
}

/** A place as the app pushes it after a provider search. */
export function searchedPlace(
  externalId: string,
  extra: Partial<PlaceRow> & { provider?: string; signedAt?: number } = {},
) {
  const { provider = "kakao", signedAt = T0, ...rest } = extra;
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
    source: { provider, externalId, signature: "test", signedAt },
    ...rest,
  };
}

export function ownList(id: string, extra: Partial<ListRow> = {}): ListRow {
  return {
    id: uid(id),
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
  listName: string,
  placeId: string,
  extra: Partial<ListItemRow> = {},
): ListItemRow {
  const listId = listName.startsWith("l_") ? listName : uid(listName);
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
    id: id.startsWith("kn_") ? id : uid(id),
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
  id: table === "places" || /^(kn|li|l|p)_/.test(id) ? id : uid(id),
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

export interface ImportOpts {
  /** Server time of every call (default T0). */
  at?: number;
  /** Snapshot time (default: `at`). */
  snapshot?: number;
  complete?: boolean;
  subscriptionKnown?: boolean;
  /** Items per page (default 500). */
  chunk?: number;
}

/** A whole import as the server runs it: start with the summaries, every page, finish each list, complete. */
export async function importSnapshot(
  db: Db,
  user: string,
  lists: ImportList[],
  o: ImportOpts = {},
) {
  const now = o.at ?? T0;
  const { runId } = await startImportRun(
    db,
    user,
    {
      provider: "kakao",
      complete: o.complete ?? true,
      subscriptionKnown: o.subscriptionKnown ?? true,
      importedAt: new Date(o.snapshot ?? now).toISOString(),
      lists: lists.map(({ items, ...meta }) => ({ ...meta, itemCount: items.length })),
    },
    now,
  );
  for (const l of lists) {
    const size = o.chunk ?? 500;
    for (let i = 0; i < Math.max(1, Math.ceil(l.items.length / size)); i++) {
      await importListChunk(
        db,
        user,
        runId,
        l.externalId,
        i,
        l.items.slice(i * size, (i + 1) * size),
        now,
      );
    }
    await finishImportList(db, user, runId, l.externalId, now);
  }
  return { runId, summary: await completeImportRun(db, user, runId, now) };
}
