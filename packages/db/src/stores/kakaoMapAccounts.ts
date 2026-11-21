import type { Db } from "../core";
import { AccountGoneError } from "./sync";

/** The Kakao Map account is already bound to a different magomap user. */
export class KakaoMapAccountTakenError extends Error {
  constructor() {
    super("This Kakao Map account is already connected to another user");
  }
}

export async function boundKakaoMapAccount(
  db: Db,
  userId: string,
): Promise<{ kakaoMapUserId: string; nickname: string | null } | null> {
  const row = await db.kysely
    .selectFrom("kakao_map_accounts")
    .select(["kakao_map_user_id", "nickname"])
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row ? { kakaoMapUserId: row.kakao_map_user_id, nickname: row.nickname } : null;
}

/**
 * A unique violation on kakao_map_user_id, from any driver:
 * - Postgres (pg): code 23505, naming the table;
 * - SQLite (better-sqlite3): code SQLITE_CONSTRAINT_UNIQUE, message
 *   "UNIQUE constraint failed: kakao_map_accounts.kakao_map_user_id";
 * - D1: no code, the same SQLite text inside the message, e.g.
 *   "D1_ERROR: UNIQUE constraint failed: kakao_map_accounts.kakao_map_user_id: SQLITE_CONSTRAINT".
 * Kysely rethrows driver errors unchanged, and D1 may wrap them, so the cause chain is walked.
 */
function isAccountTaken(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (typeof e !== "object") return false;
    const err = e as {
      code?: unknown;
      message?: unknown;
      table?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    const message = typeof err.message === "string" ? err.message : "";
    if (/UNIQUE constraint failed: kakao_map_accounts\.kakao_map_user_id/.test(message))
      return true;
    if (
      err.code === "23505" &&
      (err.table === "kakao_map_accounts" ||
        (typeof err.constraint === "string" && err.constraint.startsWith("kakao_map_accounts_")))
    ) {
      return true;
    }
    e = err.cause;
  }
  return false;
}

/**
 * Binds or re-binds the user's account in one upsert on `user_id`; the unique constraint on
 * `kakao_map_user_id` refuses an account another user holds. Like the other account rows in
 * users.ts it is not sync data, so it skips the global write counter.
 */
export async function bindKakaoMapAccount(
  db: Db,
  userId: string,
  account: { kakaoMapUserId: string; nickname?: string },
  now: number,
): Promise<void> {
  const nickname = account.nickname ?? null;
  try {
    // Inserting from `users` binds nothing for a user deleted meanwhile, so no orphan row can
    // hold the Kakao Map account.
    const result = await db.kysely
      .insertInto("kakao_map_accounts")
      .columns(["user_id", "kakao_map_user_id", "nickname", "bound_at"])
      .expression((eb) =>
        eb
          .selectFrom("users")
          .select([
            eb.val(userId).as("user_id"),
            eb.val(account.kakaoMapUserId).as("kakao_map_user_id"),
            eb.val(nickname).as("nickname"),
            eb.val(now).as("bound_at"),
          ])
          .where("id", "=", userId),
      )
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          kakao_map_user_id: account.kakaoMapUserId,
          nickname,
          bound_at: now,
        }),
      )
      .executeTakeFirst();
    if (Number(result.numInsertedOrUpdatedRows ?? 0) === 0) throw new AccountGoneError();
  } catch (error) {
    if (isAccountTaken(error)) throw new KakaoMapAccountTakenError();
    throw error;
  }
}
