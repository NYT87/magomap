// Before a colour or a note is changed in Kakao Map, the server is asked whether it would record
// it: a refusal after Kakao Map had already changed would leave the two apart.
import { askExtension } from "../import/kakaoMap";
import { codeOf, post } from "../import/runImport";

/**
 * The first extension release that changes a favourite by its own id (`seq`). An older one
 * ignores it and changes the first favourite of that place in the list, which may be another one
 * (a place can be in one list twice), so it isn't asked to.
 */
const AIMS_AT_FAVORITE_SINCE = [0, 1, 5];

/**
 * Whether the extension in this browser says it is older than that. An extension that doesn't
 * answer, or gives no version, isn't judged here: the account check that follows says so.
 */
export async function extensionTooOld(): Promise<boolean> {
  const answer = await askExtension({ type: "magomap.ping" }, 1500);
  const version =
    typeof answer === "object" && answer !== null && "version" in answer
      ? (answer as { version: unknown }).version
      : undefined;
  if (typeof version !== "string" || !/^\d+(\.\d+){0,3}$/.test(version)) return false;
  const parts = version.split(".").map(Number);
  for (const [i, since] of AIMS_AT_FAVORITE_SINCE.entries()) {
    const part = parts[i] ?? 0;
    if (part !== since) return part < since;
  }
  return false;
}

export type EditRefusal =
  | "account_unconfirmed"
  | "sync_first"
  | "not_owner"
  | "not_found"
  | "offline"
  | "check_failed";

/** The favourite's own Kakao id (`seq`), which the list item keeps; none for an older row. */
export function favoriteSeqOf(externalId: string | null): number | undefined {
  if (externalId === null || !/^[1-9]\d{0,15}$/.test(externalId)) return undefined;
  const seq = Number(externalId);
  return Number.isSafeInteger(seq) ? seq : undefined;
}

/** Why the server wouldn't record this edit, or null when it would (nothing is written yet). */
export async function refusalBeforeKakao(
  account: string,
  path: "/api/kakao-colors" | "/api/kakao-notes",
  body: Record<string, unknown>,
): Promise<EditRefusal | null> {
  try {
    await post(account, path, { ...body, check: true });
    return null;
  } catch (error) {
    switch (codeOf(error) as string | undefined) {
      // The list's Kakao owner isn't known yet: a sync from Kakao Map records it.
      case "owner_unknown":
        return "sync_first";
      case "kakao_account_unconfirmed":
        return "account_unconfirmed";
      case "not_owner":
        return "not_owner";
      case "not_found":
        return "not_found";
      case "offline":
        return "offline";
      default:
        return "check_failed";
    }
  }
}
