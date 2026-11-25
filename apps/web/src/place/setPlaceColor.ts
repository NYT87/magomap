// Changes the colour of a place in one list. On a Kakao list he owns, Kakao Map is changed first,
// through the extension; only when that worked does magomap record it (the server, so everyone
// with the list sees it, then this device). On his own lists there is no Kakao side, so it is just
// saved and synced like any edit. A list he only follows can't be changed.
import { KAKAO_PLACE_COLORS, kakaoFolderIdOf } from "@magomap/domain/providers/kakao";
import { currentDb, dbUserId } from "../data/db";
import { setOwnItemColor } from "../data/writes";
import { askExtension } from "../import/kakaoMap";
import { codeOf, post } from "../import/runImport";
import { checkKakaoAccount, KakaoCopyError } from "../lists/duplicateToKakao";
import { favoriteSeqOf, refusalBeforeKakao } from "./kakaoEditCheck";

export type ColorErrorCode =
  | "extension_missing"
  | "account_mismatch"
  | "account_unconfirmed"
  | "kakao_signed_out"
  | "kakao_unavailable"
  | "not_found"
  | "not_owner"
  | "busy"
  | "offline"
  | "sync_first"
  | "check_failed"
  | "invalid"
  | "server_failed";

export class ColorError extends Error {
  constructor(readonly code: ColorErrorCode) {
    super(`Changing the colour failed: ${code}`);
    this.name = "ColorError";
  }
}

const WRITE_WAIT_MS = 150_000;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Kakao Map is being written by something else in this page right now. */
let working = false;

export async function setPlaceColor(input: { itemId: string; color: string }): Promise<void> {
  if (!Object.hasOwn(KAKAO_PLACE_COLORS, input.color)) throw new ColorError("invalid");
  const db = currentDb();
  const item = await db.list_items.get(input.itemId);
  const list = item ? await db.lists.get(item.listId) : undefined;
  if (!item || !list || item.deletedAt != null || list.deletedAt != null) {
    throw new ColorError("not_found");
  }
  if (list.provider === null) {
    await setOwnItemColor(input.itemId, input.color);
    return;
  }
  const roles = await db.user_lists.where("listId").equals(list.id).toArray();
  if (!roles.some((r) => r.removedAt == null && r.deletedAt == null && r.role === "owner")) {
    throw new ColorError("not_owner");
  }
  const folderId = list.externalId === null ? undefined : kakaoFolderIdOf(list.externalId);
  const sources = await db.place_sources.where("placeId").equals(item.placeId).toArray();
  const key = sources.find((s) => s.provider === "kakao" && s.deletedAt == null)?.externalId;
  // The favourite itself, by its own Kakao id: a place can be in one list twice.
  const seq = favoriteSeqOf(item.externalId);
  if (!folderId || !key || seq === undefined) throw new ColorError("not_found");

  if (working) throw new ColorError("busy");
  working = true;
  try {
    try {
      await checkKakaoAccount();
    } catch (error) {
      if (
        error instanceof KakaoCopyError &&
        error.code !== "partial" &&
        error.code !== "list_missing" &&
        error.code !== "not_kakao_list"
      ) {
        throw new ColorError(error.code);
      }
      throw new ColorError("kakao_unavailable");
    }
    // The server is asked first: if it wouldn't record the change, Kakao Map isn't touched.
    const refusal = await refusalBeforeKakao(dbUserId(db), "/api/kakao-colors", {
      listId: list.id,
      itemId: item.id,
      color: input.color,
    });
    if (refusal) throw new ColorError(refusal);
    // Kakao Map first; nothing is recorded anywhere unless it took the change.
    const answer = await askExtension(
      { type: "magomap.setColor", folderId, key, seq, color: input.color },
      WRITE_WAIT_MS,
    );
    if (answer === undefined) throw new ColorError("extension_missing");
    if (!isRecord(answer) || answer.ok !== true) {
      const error = isRecord(answer) ? answer.error : undefined;
      if (error === "kakao_signed_out" || error === "busy" || error === "not_found") {
        throw new ColorError(error);
      }
      throw new ColorError("kakao_unavailable");
    }
    try {
      await post(dbUserId(db), "/api/kakao-colors", {
        listId: list.id,
        itemId: item.id,
        color: input.color,
      });
    } catch (error) {
      // Kakao Map has the new colour; the next sync from Kakao Map brings it here.
      if (codeOf(error) === "not_owner") throw new ColorError("not_owner");
      throw new ColorError("server_failed");
    }
    // Kakao's own row, not synced from here (no outbox entry): the pull brings the server's copy.
    await db.list_items.update(item.id, { providerColor: input.color });
  } finally {
    working = false;
  }
}
