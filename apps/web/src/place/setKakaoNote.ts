// Changes the Kakao note of a place in one Kakao list he owns. Kakao Map is changed first,
// through the extension; only when that worked does magomap record it (the server, so everyone
// with the list sees it, then this device). Any failure before Kakao took it changes nothing.
// An empty note clears it. A list he only follows, or his own list, has no note he can change.
import { LIMITS } from "@magomap/domain/limits";
import { kakaoFolderIdOf } from "@magomap/domain/providers/kakao";
import { currentDb, dbUserId } from "../data/db";
import { askExtension } from "../import/kakaoMap";
import { codeOf, post } from "../import/runImport";
import { checkKakaoAccount, KakaoCopyError } from "../lists/duplicateToKakao";

export type NoteErrorCode =
  | "extension_missing"
  | "account_mismatch"
  | "account_unconfirmed"
  | "kakao_signed_out"
  | "kakao_unavailable"
  | "not_found"
  | "not_owner"
  | "busy"
  | "offline"
  | "too_long"
  | "server_failed";

export class NoteError extends Error {
  constructor(readonly code: NoteErrorCode) {
    super(`Changing the Kakao note failed: ${code}`);
    this.name = "NoteError";
  }
}

const WRITE_WAIT_MS = 150_000;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Kakao Map is being written by something else in this page right now. */
let working = false;

export async function setKakaoNote(input: { itemId: string; note: string }): Promise<void> {
  const note = input.note.trim();
  if (note.length > LIMITS.importText) throw new NoteError("too_long");
  const db = currentDb();
  const item = await db.list_items.get(input.itemId);
  const list = item ? await db.lists.get(item.listId) : undefined;
  if (!item || !list || item.deletedAt != null || list.deletedAt != null) {
    throw new NoteError("not_found");
  }
  if (list.provider !== "kakao" || item.removedAtProvider != null) throw new NoteError("not_found");
  const roles = await db.user_lists.where("listId").equals(list.id).toArray();
  if (!roles.some((r) => r.removedAt == null && r.deletedAt == null && r.role === "owner")) {
    throw new NoteError("not_owner");
  }
  const folderId = list.externalId === null ? undefined : kakaoFolderIdOf(list.externalId);
  const sources = await db.place_sources.where("placeId").equals(item.placeId).toArray();
  const key = sources.find((s) => s.provider === "kakao" && s.deletedAt == null)?.externalId;
  if (!folderId || !key) throw new NoteError("not_found");

  if (working) throw new NoteError("busy");
  working = true;
  try {
    try {
      await checkKakaoAccount();
    } catch (error) {
      if (
        error instanceof KakaoCopyError &&
        error.code !== "partial" &&
        error.code !== "not_kakao_list"
      ) {
        throw new NoteError(error.code);
      }
      throw new NoteError("kakao_unavailable");
    }
    // Kakao Map first; nothing is recorded anywhere unless it took the note.
    const answer = await askExtension(
      { type: "magomap.setNote", folderId, key, note },
      WRITE_WAIT_MS,
    );
    if (answer === undefined) throw new NoteError("extension_missing");
    if (!isRecord(answer) || answer.ok !== true) {
      const error = isRecord(answer) ? answer.error : undefined;
      if (error === "kakao_signed_out" || error === "busy" || error === "not_found") {
        throw new NoteError(error);
      }
      throw new NoteError("kakao_unavailable");
    }
    try {
      await post(dbUserId(db), "/api/kakao-notes", { listId: list.id, itemId: item.id, note });
    } catch (error) {
      // Kakao Map has the new note; the next sync from Kakao Map brings it here.
      if (codeOf(error) === "not_owner") throw new NoteError("not_owner");
      throw new NoteError("server_failed");
    }
    // Kakao's own row, not synced from here (no outbox entry): the pull brings the server's copy.
    await db.list_items.update(item.id, { providerNote: note });
  } finally {
    working = false;
  }
}
