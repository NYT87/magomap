import { z } from "zod";
import { LIMITS } from "./limits";

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

const text = (max: number) => z.string().max(max);

export const importItemSchema = z.object({
  favoriteSeq: z.string().min(1).max(200),
  favoriteType: text(40).optional(),
  placeKey: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(LIMITS.importTitle),
  address: text(LIMITS.importText).optional(),
  category: text(LIMITS.importTitle).optional(),
  phone: text(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  kakaoNote: text(LIMITS.importText).optional(),
  kakaoColor: text(40).optional(),
  localNote: text(LIMITS.importText).optional(),
  position: z.number().int().nonnegative(),
});

export const importListMetaSchema = z.object({
  kakaoFolderId: z.number().int().nonnegative(),
  name: z.string().min(1).max(LIMITS.importTitle),
  description: text(LIMITS.importText).optional(),
  icon: text(200).optional(),
  subscribed: z.boolean(),
  ownerName: text(LIMITS.importTitle).optional(),
});

export const importItemsChunkSchema = z.array(importItemSchema).max(LIMITS.importChunkItems);

export const importContractSchema = z.object({
  contractVersion: z.literal(1),
  kakaoUserId: z.string().min(1).max(200),
  importedAt: z.string().min(1).max(40),
  complete: z.boolean(),
  lists: z
    .array(
      importListMetaSchema.extend({ items: z.array(importItemSchema).max(LIMITS.importListItems) }),
    )
    .max(LIMITS.importLists),
});
