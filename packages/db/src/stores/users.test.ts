import { expect, it } from "vitest";
import { forEachDialect } from "../testing/dbs";
import { importListChunk, startImportRun } from "./importRuns";
import { note, ownList, push, searchedPlace, uid } from "./testkit";
import {
  createSession,
  deleteAccount,
  deleteAllSessions,
  deleteSession,
  fillDisplayName,
  findOrCreateUserByIdentity,
  resolveSession,
  setDisplayName,
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

  it("fillDisplayName fills an empty name only", async () => {
    const db = await makeDb();
    const empty = await findOrCreateUserByIdentity(db, "kakao", "n1", null, now);
    const named = await findOrCreateUserByIdentity(db, "kakao", "n2", "Jose", now);
    await fillDisplayName(db, empty.userId, "지은");
    await fillDisplayName(db, named.userId, "지은");
    const names = await db.kysely
      .selectFrom("users")
      .select(["id", "display_name"])
      .where("id", "in", [empty.userId, named.userId])
      .execute();
    const byId = new Map(names.map((u) => [u.id, u.display_name]));
    expect(byId.get(empty.userId)).toBe("지은");
    expect(byId.get(named.userId)).toBe("Jose");
  });

  it("setDisplayName sets or clears the name", async () => {
    const db = await makeDb();
    const u = await findOrCreateUserByIdentity(db, "kakao", "n3", "Jose", now);
    await setDisplayName(db, u.userId, null);
    const row = await db.kysely
      .selectFrom("users")
      .select("display_name")
      .where("id", "=", u.userId)
      .executeTakeFirst();
    expect(row?.display_name).toBeNull();
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

  it("deletes one account's own data, keeps shared places and another user's data", async () => {
    const db = await makeDb();
    const me = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const other = await findOrCreateUserByIdentity(db, "kakao", "2", null, now);
    for (const u of [me.userId, other.userId]) {
      await createSession(db, u, now);
      await push(
        db,
        u,
        [
          {
            mutationId: `p${u}`,
            table: "places",
            op: "upsert",
            id: "p_kakao_1",
            clientUpdatedAt: now + 1,
            row: searchedPlace("1"),
          },
          {
            mutationId: `l${u}`,
            table: "lists",
            op: "upsert",
            id: uid(`own-${u}`),
            clientUpdatedAt: now + 1,
            row: ownList(`own-${u}`),
          },
          {
            mutationId: `n${u}`,
            table: "visit_notes",
            op: "upsert",
            id: uid(`n-${u}`),
            clientUpdatedAt: now + 1,
            row: note(`n-${u}`, "p_kakao_1"),
          },
        ],
        now,
      );
    }
    await deleteAccount(db, me.userId);
    for (const table of [
      "identities",
      "sessions",
      "user_places",
      "user_lists",
      "visit_notes",
    ] as const) {
      const mine = await db.kysely
        .selectFrom(table)
        .select("user_id")
        .where("user_id", "=", me.userId)
        .execute();
      const theirs = await db.kysely
        .selectFrom(table)
        .select("user_id")
        .where("user_id", "=", other.userId)
        .execute();
      expect(mine, table).toHaveLength(0);
      expect(theirs.length, table).toBeGreaterThan(0);
    }
    expect(
      await db.kysely.selectFrom("users").selectAll().where("id", "=", me.userId).execute(),
    ).toHaveLength(0);
    expect(
      await db.kysely
        .selectFrom("lists")
        .selectAll()
        .where("id", "=", uid(`own-${me.userId}`))
        .execute(),
    ).toHaveLength(0);
    expect(
      await db.kysely
        .selectFrom("lists")
        .selectAll()
        .where("id", "=", uid(`own-${other.userId}`))
        .execute(),
    ).toHaveLength(1);
    expect(await db.kysely.selectFrom("places").selectAll().execute()).toHaveLength(1);
  });

  it("deletes the pages of an import the account had running", async () => {
    const db = await makeDb();
    const { userId } = await findOrCreateUserByIdentity(db, "kakao", "1", null, now);
    const lists = [{ externalId: "1", name: "리스트", followed: false, itemCount: 1 }];
    const opts = { provider: "kakao", complete: true, subscriptionKnown: true, lists };
    const { runId } = await startImportRun(
      db,
      userId,
      { ...opts, importedAt: new Date(now).toISOString() },
      now,
    );
    const place = { externalId: "10", placeExternalId: "A", title: "카페", position: 0 };
    await importListChunk(db, userId, runId, "1", 0, [place], now);
    const pages = () =>
      db.kysely.selectFrom("import_run_pages").selectAll().where("user_id", "=", userId).execute();
    expect(await pages()).toHaveLength(1);
    await deleteAccount(db, userId);
    expect(await pages()).toHaveLength(0);
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
    expect(seen[0]).toMatch(/^update "sync_state"/i);
  });
});
