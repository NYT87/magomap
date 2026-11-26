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

/**
 * Kakao Map's favourite colours, keyed by the favourite's `color` code: exactly the colours its
 * page shows, so places look the way she knows them. Light ones are edged where they're drawn.
 */
export const KAKAO_PLACE_COLORS: Record<string, { name: string; value: string }> = {
  "01": { name: "red", value: "#f96061" },
  "02": { name: "yellow", value: "#ffc43b" },
  "03": { name: "orange", value: "#ff9340" },
  "04": { name: "green", value: "#96d147" },
  "05": { name: "darkGreen", value: "#56c07c" },
  "06": { name: "purple", value: "#a088ff" },
  "07": { name: "pink", value: "#e879c5" },
};
