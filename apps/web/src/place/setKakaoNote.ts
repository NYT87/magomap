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
import { extensionTooOld, favoriteSeqOf, refusalBeforeKakao } from "./kakaoEditCheck";

export type NoteErrorCode =
  | "extension_missing"
  | "extension_outdated"
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
  | "too_long"
  | "note_changed"
  | "server_failed";

export class NoteError extends Error {
  constructor(readonly code: NoteErrorCode) {
    super(`Changing the Kakao note failed: ${code}`);
    this.name = "NoteError";
  }
}

/** Kakao Map's note was changed there since magomap last knew it; nothing was written. */
export class NoteChangedError extends NoteError {
  constructor(
    /** The note Kakao Map has now (empty when it has none). */
    readonly current: string,
  ) {
    super("note_changed");
  }
}

const WRITE_WAIT_MS = 150_000;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Kakao Map is being written by something else in this page right now. */
let working = false;

/**
 * `overwrite` goes with the note only after he confirmed overwriting a note that was changed in
 * Kakao Map since the last sync; without it, a changed note throws `NoteChangedError`.
 */
export async function setKakaoNote(input: {
  itemId: string;
  note: string;
  overwrite?: boolean;
}): Promise<void> {
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
  // The favourite itself, by its own Kakao id: a place can be in one list twice.
  const seq = favoriteSeqOf(item.externalId);
  if (!folderId || !key || seq === undefined) throw new NoteError("not_found");

  if (working) throw new NoteError("busy");
  working = true;
  try {
    // An extension too old to change the favourite itself isn't asked to change anything.
    if (await extensionTooOld()) throw new NoteError("extension_outdated");
    try {
      await checkKakaoAccount();
    } catch (error) {
      if (
        error instanceof KakaoCopyError &&
        error.code !== "partial" &&
        error.code !== "list_missing" &&
        error.code !== "not_kakao_list"
      ) {
        throw new NoteError(error.code);
      }
      throw new NoteError("kakao_unavailable");
    }
    // The server is asked first: if it wouldn't record the change, Kakao Map isn't touched.
    const refusal = await refusalBeforeKakao(dbUserId(db), "/api/kakao-notes", {
      listId: list.id,
      itemId: item.id,
      note,
    });
    if (refusal) throw new NoteError(refusal);
    // Kakao Map first; nothing is recorded anywhere unless it took the note.
    const answer = await askExtension(
      {
        type: "magomap.setNote",
        folderId,
        key,
        seq,
        note,
        // The note magomap knows: the extension compares it with Kakao Map's before writing.
        expected: item.providerNote ?? "",
        ...(input.overwrite ? { overwrite: true } : {}),
      },
      WRITE_WAIT_MS,
    );
    if (answer === undefined) throw new NoteError("extension_missing");
    if (!isRecord(answer) || answer.ok !== true) {
      const error = isRecord(answer) ? answer.error : undefined;
      if (error === "note_changed") {
        throw new NoteChangedError(
          isRecord(answer) && typeof answer.current === "string" ? answer.current : "",
        );
      }
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
