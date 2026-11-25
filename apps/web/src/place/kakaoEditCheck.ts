// Before a colour or a note is changed in Kakao Map, the server is asked whether it would record
// it: a refusal after Kakao Map had already changed would leave the two apart.
import { codeOf, post } from "../import/runImport";

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
