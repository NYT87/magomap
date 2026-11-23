import { z } from "zod";
import { LIMITS } from "./limits";
import {
  type AnyRow,
  CLIENT_WRITABLE_TABLES,
  type ClientWritableTable,
  type SyncTable,
} from "./rows";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Text Postgres can store: no NUL characters and no lone surrogates (SQLite accepts both). */
export function isStorableText(value: string): boolean {
  return !value.includes("\u0000") && !LONE_SURROGATE.test(value);
}

/** A string with a max length that every supported database can store. */
export const storableText = (max: number) =>
  z.string().max(max).refine(isStorableText, "Text contains characters that can't be stored");

/** Positions are 32-bit integers in the database. */
export const position = z.number().int().nonnegative().max(2_147_483_647);

const id = storableText(300).pipe(z.string().min(1));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids the client creates (own lists, notes, links) are UUIDs, so they can't impersonate server ids. */
const clientId = z.string().regex(UUID, "Expected a UUID");
const ms = z.number().int().nonnegative();
const nullableText = (max: number) => storableText(max).nullable();

/** A real calendar date in YYYY-MM-DD form. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "Not a real date");

export const httpUrl = storableText(LIMITS.linkUrl).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "Links must be http or https");

const base = {
  id,
  createdAt: ms,
  updatedAt: ms,
  deletedAt: ms.nullable(),
};

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

const providerName = storableText(40).pipe(z.string().regex(/^[a-z0-9]+$/));

/** Places a client may push: created from a provider search result (`source`), or a location refresh. */
export const mutationRowSchemas = {
  places: z.object({
    ...base,
    title: storableText(LIMITS.importTitle).pipe(z.string().min(1)),
    address: nullableText(LIMITS.importText),
    roadAddress: nullableText(LIMITS.importText),
    addressSource: z.enum(["import", "search"]).nullable(),
    category: nullableText(LIMITS.importTitle),
    phone: nullableText(100),
    lat: latitude.nullable(),
    lng: longitude.nullable(),
    providerSnapshotAt: ms.nullable().optional(),
    /** The search result's provider and id; required to create the place. */
    source: z.object({
      provider: providerName,
      externalId: storableText(200).pipe(z.string().min(1)),
      /** The server's signature over the search result (see searchSignaturePayload). */
      signature: z.string().min(1).max(200),
      signedAt: ms,
    }),
  }),
  lists: z.object({
    ...base,
    id: clientId,
    provider: z.null(),
    externalId: z.null(),
    name: storableText(LIMITS.listName).pipe(z.string().trim().min(1)),
    description: nullableText(LIMITS.importText),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable(),
    ownerName: z.null().optional(),
    removedAtProvider: z.null().optional(),
    providerSnapshotAt: z.null().optional(),
  }),
  list_items: z.object({
    ...base,
    listId: id,
    placeId: id,
    position,
    addedAt: ms,
    externalId: z.null().optional(),
    providerNote: z.null().optional(),
    providerColor: z.null().optional(),
    removedAtProvider: z.null().optional(),
    providerSnapshotAt: z.null().optional(),
  }),
  visit_notes: z.object({
    ...base,
    // Imported notes keep their server id (kn_…); every other note is a client UUID.
    id: z.union([clientId, z.string().regex(/^kn_[^\s]{1,290}$/)]),
    placeId: id,
    visitedOn: isoDate.nullable(),
    body: storableText(LIMITS.noteBody),
    origin: z.enum(["user", "import"]),
    originKey: nullableText(200),
    editedByUser: z.boolean(),
  }),
  links: z.object({
    ...base,
    id: clientId,
    placeId: id,
    url: httpUrl,
    title: nullableText(LIMITS.linkTitle),
  }),
} satisfies Record<ClientWritableTable, z.ZodType>;

export interface Mutation {
  mutationId: string;
  table: ClientWritableTable;
  op: "upsert" | "delete";
  id: string;
  row?: unknown;
  clientUpdatedAt: number;
}

export type MutationStatus = "applied" | "ignored_stale" | "rejected";
export type RejectReason =
  | "invalid"
  | "provider_owned"
  | "server_owned"
  | "missing_parent"
  | "not_allowed"
  | "clock_ahead";

export interface PushRequest {
  mutations: Mutation[];
}
export interface PushResult {
  mutationId: string;
  status: MutationStatus;
  reason?: RejectReason;
  /** The current server row, returned with `ignored_stale`. */
  row?: AnyRow;
}
export interface PushResponse {
  results: PushResult[];
}
export interface PullResponse {
  rows: { table: SyncTable; row: AnyRow }[];
  cursor: string;
  hasMore: boolean;
  /**
   * How far the server's changes had gone (`sync_state.change_seq`) when this pull began. A row
   * with a larger `seq` was written after that. The device uses it to tell a list granted after
   * its download began from one that was already the user's.
   */
  asOf?: number;
}

/** The exact text the server signs for a search result, so a pushed place can prove it came from search. */
export function searchSignaturePayload(
  r: {
    provider: string;
    externalId: string;
    title: string;
    address: string | null;
    roadAddress: string | null;
    category: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
  },
  signedAt: number,
): string {
  return JSON.stringify([
    "magomap-search-v1",
    r.provider,
    r.externalId,
    r.title,
    r.address,
    r.roadAddress,
    r.category,
    r.phone,
    r.lat,
    r.lng,
    signedAt,
  ]);
}

/** Shape-only validation of a push; each row is validated separately with `mutationRowSchemas`. */
export const pushEnvelopeSchema = z.object({
  mutations: z
    .array(
      z.object({
        mutationId: id,
        table: z.enum(CLIENT_WRITABLE_TABLES as [ClientWritableTable, ...ClientWritableTable[]]),
        op: z.enum(["upsert", "delete"]),
        id,
        row: z.unknown().optional(),
        clientUpdatedAt: ms,
      }),
    )
    .min(1)
    .max(LIMITS.pushMutations),
});
