import { z } from "zod";
import { LIMITS } from "./limits";
import { position, storableText } from "./sync";

/** A provider-neutral import, produced by a provider adapter (e.g. providers/kakao). */
export interface ImportItem {
  externalId: string;
  placeExternalId?: string;
  title: string;
  address?: string;
  category?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  providerNote?: string;
  providerColor?: string;
  localNote?: string;
  position: number;
}

export interface ImportList {
  externalId: string;
  name: string;
  description?: string;
  followed: boolean;
  ownerName?: string;
  items: ImportItem[];
}

export interface ImportContract {
  provider: string;
  importedAt: string;
  complete: boolean;
  /** Whether `followed` is reliable; without it nobody is treated as a list's owner. */
  subscriptionKnown: boolean;
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
const required = (max: number) => text(max).pipe(z.string().min(1));

export const importItemSchema = z.object({
  externalId: required(200),
  placeExternalId: required(200).optional(),
  title: required(LIMITS.importTitle),
  address: text(LIMITS.importText).optional(),
  category: text(LIMITS.importTitle).optional(),
  phone: text(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  providerNote: text(LIMITS.importText).optional(),
  providerColor: text(40).optional(),
  localNote: text(LIMITS.importText).optional(),
  position,
});

export const importListMetaSchema = z.object({
  externalId: required(200),
  name: required(LIMITS.importTitle),
  description: text(LIMITS.importText).optional(),
  followed: z.boolean(),
  ownerName: text(LIMITS.importTitle).optional(),
});

export const importItemsChunkSchema = z.array(importItemSchema).max(LIMITS.importChunkItems);

export const providerNameSchema = text(40).pipe(z.string().regex(/^[a-z0-9]+$/));

export const importContractSchema = z.object({
  provider: providerNameSchema,
  importedAt: required(40),
  complete: z.boolean(),
  subscriptionKnown: z.boolean(),
  lists: z
    .array(
      importListMetaSchema.extend({ items: z.array(importItemSchema).max(LIMITS.importListItems) }),
    )
    .max(LIMITS.importLists),
});
