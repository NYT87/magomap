import { v7 } from "uuid";

/** A new client-generated id (UUIDv7, time-ordered). */
export function newId(): string {
  return v7();
}

/** Place id for a Kakao place: the same row from search, import or any device. */
export function kakaoPlaceRowId(placeKey: string): string {
  return `kp_${placeKey}`;
}

/** Place id for a Kakao favourite that has no place key (a custom pin). */
export function customPinRowId(favoriteSeq: string): string {
  return `kf_${favoriteSeq}`;
}

export function kakaoListRowId(folderId: number): string {
  return `kl_${folderId}`;
}

export function kakaoMembershipRowId(folderId: number, favoriteSeq: string): string {
  return `ki_${folderId}_${favoriteSeq}`;
}

/** Own-list membership: deterministic, so two devices adding the same place collapse into one row. */
export function ownMembershipRowId(listId: string, placeId: string): string {
  return `li_${listId}_${placeId}`;
}

/** The diary entry created from a kakao-list local note for a place in one Kakao list. */
export function importedNoteRowId(placeId: string, folderId: number): string {
  return `kn_${placeId}_${folderId}`;
}
