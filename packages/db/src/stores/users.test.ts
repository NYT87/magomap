import { expect, it } from "vitest";
import { forEachDialect } from "../testing/dbs";
import {
  createSession,
  deleteAccount,
  deleteAllSessions,
  deleteSession,
  findOrCreateUserByIdentity,
  resolveSession,
} from "./users";

const DAY = 86_400_000;
const now = 1_763_000_000_000;

forEachDialect("users store", (makeDb) => {
  it("returns the same user for the same identity", async () => {
    const db = await makeDb();
    const first = await findOrCreateUserByIdentity(db, "kakao", "123", "지은", now);
    const second = await findOrCreateUserByIdentity(db, "kakao", "123", "지은", now);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
  });

  it("gives a different identity its own user", async () => {
    const db = await makeDb();
    const a = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const b = await findOrCreateUserByIdentity(db, "kakao", "2", null, now);
    expect(a.userId).not.toBe(b.userId);
  });

  it("resolves a fresh session, and stores only the hash", async () => {
    const db = await makeDb();
    const { userId } = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const { token, expiresAt } = await createSession(db, userId, now);
    expect(expiresAt).toBe(now + 30 * DAY);
    expect(await resolveSession(db, token, now + DAY)).toEqual({ userId });
    const stored = await db.kysely.selectFrom("sessions").select("token_hash").execute();
    expect(stored.map((s) => s.token_hash)).not.toContain(token);
  });

  it("resolves an expired session to null", async () => {
    const db = await makeDb();
    const { userId } = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const { token } = await createSession(db, userId, now);
    expect(await resolveSession(db, token, now + 31 * DAY)).toBeNull();
  });

  it("slides a session with less than 15 days left", async () => {
    const db = await makeDb();
    const { userId } = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const { token } = await createSession(db, userId, now);
    const later = now + 20 * DAY;
    expect(await resolveSession(db, token, later)).toEqual({
      userId,
      refreshedExpiresAt: later + 30 * DAY,
    });
    expect(await resolveSession(db, token, later + 10 * DAY)).toEqual({ userId });
  });

  it("revokes one session, or all of a user's sessions", async () => {
    const db = await makeDb();
    const { userId } = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const a = await createSession(db, userId, now);
    const b = await createSession(db, userId, now);
    await deleteSession(db, a.token);
    expect(await resolveSession(db, a.token, now)).toBeNull();
    expect(await resolveSession(db, b.token, now)).toEqual({ userId });
    await deleteAllSessions(db, userId);
    expect(await resolveSession(db, b.token, now)).toBeNull();
  });

  it("deletes every row of one account and nothing of another", async () => {
    const db = await makeDb();
    const me = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const other = await findOrCreateUserByIdentity(db, "kakao", "2", null, now);
    for (const u of [me.userId, other.userId]) {
      await createSession(db, u, now);
      await db.kysely
        .insertInto("places")
        .values({
          user_id: u,
          id: "kp_1",
          kakao_place_id: "1",
          title: "t",
          address: null,
          road_address: null,
          address_source: null,
          category: null,
          phone: null,
          lat: null,
          lng: null,
          source: "search",
          created_at: now,
          updated_at: now,
          deleted_at: null,
          client_updated_at: now,
          seq: 1,
        })
        .execute();
    }
    await deleteAccount(db, me.userId);
    for (const table of ["users", "identities", "sessions", "places"] as const) {
      const column = table === "users" ? "id" : "user_id";
      const mine = await db.kysely
        .selectFrom(table)
        .select(column)
        .where(column, "=", me.userId)
        .execute();
      const theirs = await db.kysely
        .selectFrom(table)
        .select(column)
        .where(column, "=", other.userId)
        .execute();
      expect(mine, table).toHaveLength(0);
      expect(theirs.length, table).toBeGreaterThan(0);
    }
  });
});

forEachDialect("account deletion ordering", (makeDb) => {
  it("locks the user row before deleting anything", async () => {
    const db = await makeDb();
    const { userId } = await findOrCreateUserByIdentity(db, "kakao", "9", null, now);
    const seen: string[] = [];
    const recording = {
      ...db,
      atomic: (qs: Parameters<typeof db.atomic>[0]) => {
        seen.push(...qs.map((q) => q.compile().sql));
        return db.atomic(qs);
      },
    };
    await deleteAccount(recording, userId);
    expect(seen[0]).toMatch(/^update "users"/i);
  });
});
