// Kakao, the provider: its name, how its list ids are made, nicknames and favourite colours.
// The Kakao Map adapter (kakaoMap.ts) maps a read from Kakao Map into the neutral import.
import { LIMITS } from "../limits";
import { isStorableText } from "../sync";

export const KAKAO = "kakao";

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

/** A nickname we can store: trimmed and cut to the limit; undefined when there's none. */
export function usableNickname(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = Array.from(value.trim()).slice(0, LIMITS.nickname).join("").trim();
  return name && isStorableText(name) ? name : undefined;
}

/** Kakao Map's favourite colours, keyed by the favourite's `color` code. */
export const KAKAO_PLACE_COLORS: Record<string, { name: string; value: string }> = {
  "01": { name: "red", value: "#c8373e" },
  "02": { name: "orange", value: "#bd5b00" },
  "03": { name: "yellow", value: "#927000" },
  "04": { name: "green", value: "#2f7547" },
  "05": { name: "blue", value: "#2464ad" },
  "06": { name: "purple", value: "#7150a4" },
  "07": { name: "pink", value: "#b82d6d" },
};
