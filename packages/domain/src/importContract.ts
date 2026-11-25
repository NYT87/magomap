import { z } from "zod";
import { LIMITS } from "./limits";
import { position, storableText } from "./sync";

/** A provider-neutral import, produced by a provider adapter (e.g. providers/kakaoMap). */
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
  /**
   * The provider account that owns the list at the provider, when the read names it. Its owner in
   * magomap is the user bound to that account. Server-side only; never synced to clients.
   */
  providerOwnerId?: string;
  /**
   * The read shows only that the user follows the list, not its name or contents (a bare followed
   * folder). The import grants the user follower access and leaves the shared list and its items
   * alone. Set only by the server from a direct read; never part of a contract a client sends.
   */
  accessOnly?: boolean;
  items: ImportItem[];
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
  providerOwnerId: required(200).optional(),
});

export const importItemsChunkSchema = z.array(importItemSchema).max(LIMITS.importChunkItems);

/** A provider list as the server reads it before importing its items. */
export interface ImportListSummary extends Omit<ImportList, "items"> {
  itemCount: number;
}

/**
 * A provider's list summaries at the start of an import: the old kakao-list import's shape, which
 * the Kakao Map adapter's parity fixture still reads.
 */
export interface ImportListsSnapshot {
  provider: string;
  importedAt: string;
  complete: boolean;
  subscriptionKnown: boolean;
  /** The account's own nickname at the provider, when it sent one we can use. */
  ownerNickname?: string;
  lists: ImportListSummary[];
}

/** One page (at most 500) of a list's items (the old kakao-list import's shape, as above). */
export interface ImportItemsPage {
  externalId: string;
  importedAt: string;
  total: number;
  offset: number;
  items: ImportItem[];
}
