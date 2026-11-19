import { z } from "zod";
import { LIMITS } from "./limits";
import {
  type AnyRow,
  CLIENT_WRITABLE_TABLES,
  type ClientWritableTable,
  type SyncTable,
} from "./rows";

const id = z.string().min(1).max(300);
const ms = z.number().int().nonnegative();
const nullableText = (max: number) => z.string().max(max).nullable();

/** A real calendar date in YYYY-MM-DD form. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "Not a real date");

export const httpUrl = z
  .string()
  .max(LIMITS.linkUrl)
  .refine((value) => {
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

export const mutationRowSchemas = {
  places: z.object({
    ...base,
    kakaoPlaceId: z.string().min(1).max(200).nullable(),
    title: z.string().min(1).max(LIMITS.importTitle),
    address: nullableText(LIMITS.importText),
    roadAddress: nullableText(LIMITS.importText),
    addressSource: z.enum(["kakao_import", "search"]).nullable(),
    category: nullableText(LIMITS.importTitle),
    phone: nullableText(100),
    lat: latitude.nullable(),
    lng: longitude.nullable(),
    source: z.enum(["kakao_import", "search"]),
  }),
  lists: z.object({
    ...base,
    kind: z.enum(["kakao", "own"]),
    kakaoFolderId: z.number().int().nullable(),
    subscribed: z.boolean(),
    ownerName: nullableText(LIMITS.importTitle),
    name: z.string().trim().min(1).max(LIMITS.listName),
    description: nullableText(LIMITS.importText),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable(),
    removedFromKakaoAt: ms.nullable(),
  }),
  list_items: z.object({
    ...base,
    listId: id,
    placeId: id,
    position: z.number().int().nonnegative(),
    addedAt: ms,
    kakaoFavoriteSeq: z.string().max(200).nullable(),
    kakaoNote: nullableText(LIMITS.importText),
    kakaoColor: z.string().max(40).nullable(),
    removedFromKakaoAt: ms.nullable(),
  }),
  visit_notes: z.object({
    ...base,
    placeId: id,
    visitedOn: isoDate.nullable(),
    body: z.string().max(LIMITS.noteBody),
    origin: z.enum(["user", "kakao_list"]),
    originKey: z.string().max(200).nullable(),
    editedByUser: z.boolean(),
  }),
  links: z.object({
    ...base,
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
  | "kakao_owned"
  | "server_owned"
  | "missing_parent"
  | "not_allowed";

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
