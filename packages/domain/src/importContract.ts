import { z } from "zod";
import { LIMITS } from "./limits";
import { position, storableText } from "./sync";

export interface ImportItem {
  favoriteSeq: string;
  favoriteType?: string;
  placeKey?: string;
  title: string;
  address?: string;
  category?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  kakaoNote?: string;
  kakaoColor?: string;
  localNote?: string;
  position: number;
}

export interface ImportList {
  kakaoFolderId: number;
  name: string;
  description?: string;
  icon?: string;
  subscribed: boolean;
  ownerName?: string;
  items: ImportItem[];
}

export interface MagomapImportContract {
  contractVersion: 1;
  kakaoUserId: string;
  importedAt: string;
  complete: boolean;
  lists: ImportList[];
}

export interface ImportSummary {
  listsAdded: number;
  listsUpdated: number;
  listsRemoved: number;
  placesAdded: number;
  placesMoved: number;
  membershipsRemoved: number;
  membershipsRestored: number;
  notesImported: number;
}

const text = (max: number) => storableText(max);

export const importItemSchema = z.object({
  favoriteSeq: text(200).pipe(z.string().min(1)),
  favoriteType: text(40).optional(),
  placeKey: text(200).pipe(z.string().min(1)).optional(),
  title: text(LIMITS.importTitle).pipe(z.string().min(1)),
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

export const importListMetaSchema = z.object({
  kakaoFolderId: z.number().int().nonnegative(),
  name: text(LIMITS.importTitle).pipe(z.string().min(1)),
  description: text(LIMITS.importText).optional(),
  icon: text(200).optional(),
  subscribed: z.boolean(),
  ownerName: text(LIMITS.importTitle).optional(),
});

export const importItemsChunkSchema = z.array(importItemSchema).max(LIMITS.importChunkItems);

export const importContractSchema = z.object({
  contractVersion: z.literal(1),
  kakaoUserId: text(200).pipe(z.string().min(1)),
  importedAt: z.string().min(1).max(40),
  complete: z.boolean(),
  lists: z
    .array(
      importListMetaSchema.extend({ items: z.array(importItemSchema).max(LIMITS.importListItems) }),
    )
    .max(LIMITS.importLists),
});
