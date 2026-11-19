import { newId } from "@magomap/domain/ids";
import { sql } from "kysely";
import type { Db } from "../core";
import type { Database } from "../schema";

const DAY = 86_400_000;
export const SESSION_TTL_MS = 30 * DAY;
const SLIDE_WHEN_LEFT_MS = 15 * DAY;

export type Provider = "kakao" | "google";

export async function findOrCreateUserByIdentity(
  db: Db,
  provider: Provider,
  providerUserId: string,
  displayName: string | null,
  now: number,
): Promise<{ userId: string; created: boolean }> {
  const existing = await db.kysely
    .selectFrom("identities")
    .select("user_id")
    .where("provider", "=", provider)
    .where("provider_user_id", "=", providerUserId)
    .executeTakeFirst();
  if (existing) return { userId: existing.user_id, created: false };

  const userId = newId();
  await db.atomic([
    db.kysely
      .insertInto("users")
      .values({ id: userId, display_name: displayName, created_at: now }),
    db.kysely.insertInto("identities").values({
      user_id: userId,
      provider,
      provider_user_id: providerUserId,
      created_at: now,
    }),
  ]);
  return { userId, created: true };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of the session token; only this is stored. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  db: Db,
  userId: string,
  now: number,
): Promise<{ token: string; expiresAt: number }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = now + SESSION_TTL_MS;
  await db.kysely
    .insertInto("sessions")
    .values({
      token_hash: await hashToken(token),
      user_id: userId,
      expires_at: expiresAt,
      created_at: now,
    })
    .execute();
  return { token, expiresAt };
}

/** The session's user, or null. Extends the expiry when less than 15 days remain. */
export async function resolveSession(
  db: Db,
  token: string,
  now: number,
): Promise<{ userId: string; refreshedExpiresAt?: number } | null> {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await db.kysely
    .selectFrom("sessions")
    .select(["user_id", "expires_at"])
    .where("token_hash", "=", tokenHash)
    .executeTakeFirst();
  if (!row || row.expires_at <= now) return null;
  if (row.expires_at - now >= SLIDE_WHEN_LEFT_MS) return { userId: row.user_id };
  const refreshedExpiresAt = now + SESSION_TTL_MS;
  await db.kysely
    .updateTable("sessions")
    .set({ expires_at: refreshedExpiresAt })
    .where("token_hash", "=", tokenHash)
    .execute();
  return { userId: row.user_id, refreshedExpiresAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.kysely
    .deleteFrom("sessions")
    .where("token_hash", "=", await hashToken(token))
    .execute();
}

export async function deleteAllSessions(db: Db, userId: string): Promise<void> {
  await db.kysely.deleteFrom("sessions").where("user_id", "=", userId).execute();
}

/** Per-user tables: everything here with the user's id is theirs alone. */
const USER_TABLES = [
  "identities",
  "sessions",
  "user_places",
  "visit_notes",
  "links",
  "tombstones",
  "import_runs",
  "import_seen",
] as const satisfies readonly (keyof Database)[];

/**
 * Removes the user's own data, all-or-nothing: their per-user rows, and the own lists they
 * own with those lists' items. Shared places and provider lists stay. The global write
 * counter is claimed first, like every writer, so no write can land mid-deletion.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  const ownLists = sql`SELECT list_id FROM user_lists WHERE user_id = ${userId} AND role = 'owner'`;
  await db.atomic([
    db.kysely
      .updateTable("sync_state")
      .set({ change_seq: sql`change_seq + 1`, write_token: "deleting" })
      .where("id", "=", 1),
    db.kysely
      .deleteFrom("list_items")
      .where(
        sql<boolean>`list_id IN (SELECT id FROM lists WHERE provider IS NULL AND id IN (${ownLists}))`,
      ),
    db.kysely.deleteFrom("lists").where(sql<boolean>`provider IS NULL AND id IN (${ownLists})`),
    db.kysely.deleteFrom("user_lists").where("user_id", "=", userId),
    ...USER_TABLES.map((t) => db.kysely.deleteFrom(t).where("user_id", "=", userId)),
    db.kysely.deleteFrom("users").where("id", "=", userId),
  ]);
}
