import { LIMITS } from "@magomap/domain/limits";
import type { Db } from "../core";
import { withWrite } from "../write";
import { boundKakaoMapAccount } from "./kakaoMapAccounts";

export type KakaoNoteEdit =
  | "updated"
  | "invalid"
  | "not_found"
  | "not_owner"
  | "owner_unknown"
  | "kakao_account_unconfirmed";

/**
 * Records a Kakao note the owner just saved in Kakao Map on one list item, shared with everyone
 * who has the list. An empty note clears it. Only the list's Kakao owner may: the caller's bound Kakao Map account (its id
 * or its alias) must be the list's recorded owner. The edit time is kept so an import whose
 * snapshot is older than the edit never puts the old note back. One list-item row is written.
 */
export async function recordKakaoNoteEdit(
  db: Db,
  userId: string,
  edit: { listId: string; itemId: string; note: string },
  now: number,
): Promise<KakaoNoteEdit> {
  if (edit.note.length > LIMITS.importText) return "invalid";
  const found = await db.kysely
    .selectFrom("list_items as i")
    .innerJoin("lists as l", "l.id", "i.list_id")
    .innerJoin("user_lists as ul", "ul.list_id", "l.id")
    .select(["l.provider", "l.provider_owner_id"])
    .where("i.id", "=", edit.itemId)
    .where("i.list_id", "=", edit.listId)
    .where("i.deleted_at", "is", null)
    .where("i.removed_at_provider", "is", null)
    .where("l.deleted_at", "is", null)
    .where("l.provider", "=", "kakao")
    .where("ul.user_id", "=", userId)
    .where("ul.deleted_at", "is", null)
    .where("ul.removed_at", "is", null)
    .executeTakeFirst();
  if (!found) return "not_found";
  const bound = await boundKakaoMapAccount(db, userId);
  if (!bound) return "kakao_account_unconfirmed";
  const owner = found.provider_owner_id;
  if (owner == null) return "owner_unknown";
  if (owner !== bound.kakaoMapUserId && owner !== bound.alias) return "not_owner";
  return withWrite(db, async (ctx) => ({
    statements: [
      db.kysely
        .updateTable("list_items")
        .set({
          provider_note: edit.note,
          note_edited_at: now,
          updated_at: now,
          seq: ctx.seq,
        })
        .where("id", "=", edit.itemId)
        .where("list_id", "=", edit.listId)
        .where(ctx.guard),
    ],
    result: "updated" as const,
  }));
}
