// The Kakao provider adapter: maps kakao-list's import contract (v1) into the neutral ImportContract.
// This is the only place in the domain package that knows Kakao's field names.
import { z } from "zod";
import {
  type ImportContract,
  type ImportItemsPage,
  type ImportListsSnapshot,
  importContractSchema,
} from "../importContract";
import { LIMITS } from "../limits";
import { position, storableText } from "../sync";

export const KAKAO = "kakao";

const text = (max: number) => storableText(max);
const required = (max: number) => text(max).pipe(z.string().min(1));

const kakaoItem = z.object({
  favoriteSeq: required(200),
  favoriteType: text(40).optional(),
  placeKey: required(200).optional(),
  title: required(LIMITS.importTitle),
  address: text(LIMITS.importText).optional(),
  category: text(LIMITS.importTitle).optional(),
  phone: text(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  kakaoNote: text(LIMITS.importText).optional(),
  kakaoColor: text(40).optional(),
  localNote: text(LIMITS.importText).optional(),
  position,
});

/** kakao-list's GET /api/integrations/magomap/snapshot body (contract v1). */
export const kakaoListContractSchema = z.object({
  contractVersion: z.literal(1),
  kakaoUserId: required(200),
  importedAt: required(40),
  complete: z.boolean(),
  subscriptionKnown: z.boolean().optional(),
  lists: z
    .array(
      z.object({
        kakaoFolderId: z.number().int().nonnegative(),
        name: required(LIMITS.importTitle),
        description: text(LIMITS.importText).optional(),
        icon: text(200).optional(),
        subscribed: z.boolean(),
        ownerName: text(LIMITS.importTitle).optional(),
        items: z.array(kakaoItem).max(LIMITS.importListItems),
      }),
    )
    .max(LIMITS.importLists),
});

/** kakao-list's contract as it arrives over the wire. */
export type KakaoListContract = z.infer<typeof kakaoListContractSchema>;

const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/**
 * A Kakao list's external id. Folder ids are global at Kakao, except folder 0: every user's own
 * default favourites. That one is keyed per person (by their Kakao Login id), so two people's
 * default lists never become one shared list.
 */
export function kakaoListExternalId(folderId: number, kakaoUserId: string): string {
  return folderId === 0 ? `0~${kakaoUserId}` : String(folderId);
}

/** The Kakao folder id behind a list's external id, or undefined if it isn't one. */
export function kakaoFolderIdOf(externalId: string): number | undefined {
  if (/^0~[^~]+$/.test(externalId)) return 0;
  if (!/^[1-9]\d{0,15}$/.test(externalId)) return undefined;
  const id = Number(externalId);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** Validates kakao-list's contract and maps it to the neutral import. Throws on an invalid contract. */
export function kakaoContractToImport(raw: unknown): ImportContract {
  const c = kakaoListContractSchema.parse(raw);
  return importContractSchema.parse({
    provider: KAKAO,
    importedAt: c.importedAt,
    complete: c.complete,
    subscriptionKnown: c.subscriptionKnown ?? false,
    lists: c.lists.map((l) =>
      defined({
        externalId: kakaoListExternalId(l.kakaoFolderId, c.kakaoUserId),
        name: l.name,
        description: l.description,
        followed: l.subscribed,
        ownerName: l.ownerName,
        items: l.items.map((i) =>
          defined({
            externalId: i.favoriteSeq,
            placeExternalId: i.placeKey,
            title: i.title,
            address: i.address,
            category: i.category,
            phone: i.phone,
            lat: i.lat,
            lng: i.lng,
            providerNote: i.kakaoNote,
            providerColor: i.kakaoColor,
            localNote: i.localNote,
            position: i.position,
          }),
        ),
      }),
    ),
  }) as ImportContract;
}

// --- Paged endpoints (the server fetches these itself; the app never supplies import data) ---

const kakaoListSummary = z.object({
  kakaoFolderId: z.number().int().nonnegative(),
  name: required(LIMITS.importTitle),
  description: text(LIMITS.importText).optional(),
  icon: text(200).optional(),
  subscribed: z.boolean(),
  ownerName: text(LIMITS.importTitle).optional(),
  itemCount: z.number().int().nonnegative().max(LIMITS.importListItems),
});

/** kakao-list's GET /api/integrations/magomap/lists body. */
export const kakaoListsSchema = z.object({
  contractVersion: z.literal(1),
  kakaoUserId: required(200),
  importedAt: required(40),
  complete: z.boolean(),
  subscriptionKnown: z.boolean().optional(),
  lists: z
    .array(kakaoListSummary)
    .max(LIMITS.importLists)
    .refine((lists) => new Set(lists.map((l) => l.kakaoFolderId)).size === lists.length, {
      message: "A list appears twice",
    }),
});

/** kakao-list's GET /api/integrations/magomap/lists/:folderId/items body. */
export const kakaoItemsSchema = z.object({
  contractVersion: z.literal(1),
  kakaoFolderId: z.number().int().nonnegative(),
  importedAt: required(40),
  total: z.number().int().nonnegative().max(LIMITS.importListItems),
  offset: z.number().int().nonnegative(),
  items: z.array(kakaoItem).max(LIMITS.importChunkItems),
});

export type KakaoLists = z.infer<typeof kakaoListsSchema>;
export type KakaoItems = z.infer<typeof kakaoItemsSchema>;

/** `kakaoUserId` is the importing user's own Kakao Login id (it keys their folder 0). */
export function kakaoListsToImport(raw: unknown, kakaoUserId: string): ImportListsSnapshot {
  const c = kakaoListsSchema.parse(raw);
  return {
    provider: KAKAO,
    importedAt: c.importedAt,
    complete: c.complete,
    subscriptionKnown: c.subscriptionKnown ?? false,
    lists: c.lists.map((l) =>
      defined({
        externalId: kakaoListExternalId(l.kakaoFolderId, kakaoUserId),
        name: l.name,
        description: l.description,
        followed: l.subscribed,
        ownerName: l.ownerName,
        itemCount: l.itemCount,
      }),
    ),
  };
}

export function kakaoItemsToImport(raw: unknown, kakaoUserId: string): ImportItemsPage {
  const c = kakaoItemsSchema.parse(raw);
  return {
    externalId: kakaoListExternalId(c.kakaoFolderId, kakaoUserId),
    importedAt: c.importedAt,
    total: c.total,
    offset: c.offset,
    items: c.items.map((i) =>
      defined({
        externalId: i.favoriteSeq,
        placeExternalId: i.placeKey,
        title: i.title,
        address: i.address,
        category: i.category,
        phone: i.phone,
        lat: i.lat,
        lng: i.lng,
        providerNote: i.kakaoNote,
        providerColor: i.kakaoColor,
        localNote: i.localNote,
        position: i.position,
      }),
    ),
  };
}

/** Kakao Map's favourite colours, keyed by the item's colour code (from kakao-list). */
export const KAKAO_PLACE_COLORS: Record<string, { name: string; value: string }> = {
  "01": { name: "red", value: "#c8373e" },
  "02": { name: "orange", value: "#bd5b00" },
  "03": { name: "yellow", value: "#927000" },
  "04": { name: "green", value: "#2f7547" },
  "05": { name: "blue", value: "#2464ad" },
  "06": { name: "purple", value: "#7150a4" },
  "07": { name: "pink", value: "#b82d6d" },
};
