import { sql } from "kysely";
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
): Promise<{ kakaoMapUserId: string; nickname: string | null; alias?: string } | null> {
  const row = await db.kysely
    .selectFrom("kakao_map_accounts")
    .select(["kakao_map_user_id", "nickname", "kakao_map_alias"])
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    kakaoMapUserId: row.kakao_map_user_id,
    nickname: row.nickname,
    ...(row.kakao_map_alias == null ? {} : { alias: row.kakao_map_alias }),
  };
}

/** The user an account is bound to (by its id or its alias), or null when no one holds it. */
export async function kakaoMapAccountHolder(
  db: Db,
  kakaoMapUserId: string,
): Promise<string | null> {
  const row = await db.kysely
    .selectFrom("kakao_map_accounts")
    .select("user_id")
    .where((eb) =>
      eb.or([
        eb("kakao_map_user_id", "=", kakaoMapUserId),
        eb("kakao_map_alias", "=", kakaoMapUserId),
      ]),
    )
    .executeTakeFirst();
  return row?.user_id ?? null;
}

/**
 * Each of `ids` that names a bound account (as its id or its alias), mapped to that account's id.
 * Ids no account is bound by are left out. One read.
 */
export async function kakaoMapAccountsNamed(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const named = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return named;
  const rows = await db.kysely
    .selectFrom("kakao_map_accounts")
    .select(["kakao_map_user_id", "kakao_map_alias"])
    .where((eb) =>
      eb.or([eb("kakao_map_user_id", "in", unique), eb("kakao_map_alias", "in", unique)]),
    )
    .execute();
  for (const row of rows) {
    named.set(row.kakao_map_user_id, row.kakao_map_user_id);
    if (row.kakao_map_alias != null) named.set(row.kakao_map_alias, row.kakao_map_user_id);
  }
  for (const key of [...named.keys()]) if (!unique.includes(key)) named.delete(key);
  return named;
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

/** A unique violation on kakao_map_alias (the same driver shapes as `isAccountTaken`). */
function isAliasTaken(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (typeof e !== "object") return false;
    const err = e as { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };
    const message = typeof err.message === "string" ? err.message : "";
    if (/UNIQUE constraint failed: kakao_map_accounts\.kakao_map_alias/.test(message)) return true;
    if (
      err.code === "23505" &&
      typeof err.constraint === "string" &&
      err.constraint.includes("kakao_map_alias")
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
 * `alias` (the account's map_user_id, when its folders carry both ids) is kept only when no other
 * account uses it as its id or alias, and it isn't recorded as the owner of a list another user
 * owns: an id belongs to at most one account, and a read's claimed id can't reach someone else's
 * lists. In doubt it is left out. An account id recorded on a list another user owns is refused.
 */
/**
 * An id is recorded as the Kakao owner of a list another live user holds as owner. Such an id
 * can't become this user's account or alias: through it they would match (and own) that list.
 */
const ownsOthersList = (userId: string, id: string) =>
  sql<boolean>`EXISTS (SELECT 1 FROM lists l INNER JOIN user_lists ul ON ul.list_id = l.id WHERE l.provider_owner_id = ${id} AND ul.role = 'owner' AND ul.user_id <> ${userId} AND ul.deleted_at IS NULL)`;

export async function bindKakaoMapAccount(
  db: Db,
  userId: string,
  account: { kakaoMapUserId: string; nickname?: string; alias?: string },
  now: number,
): Promise<void> {
  const nickname = account.nickname ?? null;
  const wanted = account.alias !== undefined && account.alias !== account.kakaoMapUserId;
  // NULL when another account already uses the alias, or it names the owner of a list another
  // user owns, decided in the same statement.
  const alias = wanted
    ? sql<
        string | null
      >`CASE WHEN EXISTS (SELECT 1 FROM kakao_map_accounts WHERE user_id <> ${userId} AND (kakao_map_user_id = ${account.alias} OR kakao_map_alias = ${account.alias})) OR ${ownsOthersList(userId, account.alias ?? "")} THEN NULL ELSE ${account.alias} END`
    : sql<string | null>`NULL`;
  try {
    // Inserting from `users` binds nothing for a user deleted meanwhile, so no orphan row can
    // hold the Kakao Map account.
    const result = await db.kysely
      .insertInto("kakao_map_accounts")
      .columns(["user_id", "kakao_map_user_id", "kakao_map_alias", "nickname", "bound_at"])
      .expression((eb) =>
        eb
          .selectFrom("users")
          .select([
            eb.val(userId).as("user_id"),
            eb.val(account.kakaoMapUserId).as("kakao_map_user_id"),
            alias.as("kakao_map_alias"),
            eb.val(nickname).as("nickname"),
            eb.val(now).as("bound_at"),
          ])
          .where("id", "=", userId)
          // An account id recorded as the owner of a list someone else owns is refused (taken).
          .where(sql<boolean>`NOT ${ownsOthersList(userId, account.kakaoMapUserId)}`),
      )
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          kakao_map_user_id: account.kakaoMapUserId,
          kakao_map_alias: alias,
          nickname,
          bound_at: now,
        }),
      )
      .executeTakeFirst();
    if (Number(result.numInsertedOrUpdatedRows ?? 0) === 0) {
      const exists = await db.kysely
        .selectFrom("users")
        .select("id")
        .where("id", "=", userId)
        .executeTakeFirst();
      throw exists ? new KakaoMapAccountTakenError() : new AccountGoneError();
    }
  } catch (error) {
    if (isAccountTaken(error)) throw new KakaoMapAccountTakenError();
    // Another account took the alias meanwhile: bind without it.
    if (wanted && isAliasTaken(error)) {
      return bindKakaoMapAccount(db, userId, { ...account, alias: undefined }, now);
    }
    throw error;
  }
}

/**
 * Fills in the bound account's alias when it has none yet (a later read showed it), under the
 * same rule as binding: never an id another account uses, nor one recorded as the owner of a
 * list another user owns. Changes nothing otherwise.
 */
export async function fillKakaoMapAlias(db: Db, userId: string, alias: string): Promise<void> {
  try {
    await db.kysely
      .updateTable("kakao_map_accounts")
      .set({ kakao_map_alias: alias })
      .where("user_id", "=", userId)
      .where("kakao_map_alias", "is", null)
      .where("kakao_map_user_id", "<>", alias)
      .where(
        sql<boolean>`NOT EXISTS (SELECT 1 FROM kakao_map_accounts other WHERE other.user_id <> ${userId} AND (other.kakao_map_user_id = ${alias} OR other.kakao_map_alias = ${alias}))`,
      )
      .where(sql<boolean>`NOT ${ownsOthersList(userId, alias)}`)
      .execute();
  } catch (error) {
    if (!isAliasTaken(error)) throw error;
  }
}
