import { v7 } from "uuid";

/** Encodes one id component so "_" can safely separate components (no two tuples share an id). */
function part(value: string): string {
  return encodeURIComponent(value).replace(/_/g, "%5F").replace(/~/g, "%7E");
}

/** A new client-generated id (UUIDv7, time-ordered). */
export function newId(): string {
  return v7();
}

/** A place, identified by its first external source: the same row from search, import or any user. */
export function placeRowId(provider: string, externalId: string): string {
  return `p_${provider}_${part(externalId)}`;
}

/** An external id of a place at a provider. */
export function placeSourceRowId(provider: string, externalId: string): string {
  return `s_${provider}_${part(externalId)}`;
}

/** A provider favourite with no place id (a custom pin): one per list item, never merged. */
export function pinRowId(provider: string, listExternalId: string, itemExternalId: string): string {
  return `pin_${provider}_${part(listExternalId)}_${part(itemExternalId)}`;
}

/** A provider list, shared by everyone who imported it. */
export function providerListRowId(provider: string, externalId: string): string {
  return `l_${provider}_${part(externalId)}`;
}

/** A place in a provider list, shared like its list. */
export function providerItemRowId(
  provider: string,
  listExternalId: string,
  itemExternalId: string,
): string {
  return `i_${provider}_${part(listExternalId)}_${part(itemExternalId)}`;
}

/** A place in an own list: deterministic, so two devices adding the same place collapse into one row. */
export function ownItemRowId(listId: string, placeId: string): string {
  return `li_${listId}_${placeId}`;
}

/** A user's access to a list. */
export function userListRowId(listId: string): string {
  return `ul_${listId}`;
}

/** A user's place ("my places"). */
export function userPlaceRowId(placeId: string): string {
  return `up_${placeId}`;
}

/** The diary entry created from an imported local note, per user, place and list. */
export function importedNoteRowId(placeId: string, listId: string): string {
  return `kn_${part(placeId)}_${part(listId)}`;
}
