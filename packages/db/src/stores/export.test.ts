import { SYNC_TABLES } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { exportUserData } from "./export";
import { note, ownItem, ownList, push, searchedPlace, T0, uid } from "./testkit";
import { createSession, deleteAccount, findOrCreateUserByIdentity } from "./users";

const mut = (id: string, table: string, row: { id: string }) =>
  ({ mutationId: id, table, op: "upsert", id: row.id, clientUpdatedAt: T0 + 1, row }) as never;

async function twoUsers(db: Db) {
  const me = await findOrCreateUserByIdentity(db, "kakao", "1", "지은", T0);
  const other = await findOrCreateUserByIdentity(db, "kakao", "2", "Jose", T0);
  const cafe = searchedPlace("1");
  const secret = searchedPlace("2", { title: "비밀 카페" });
  const shared = searchedPlace("3", { title: "공유 카페" });
  for (const [u, place, tag] of [
    [me.userId, cafe, "me"],
    [other.userId, secret, "other"],
  ] as const) {
    await push(
      db,
      u,
      [
        mut(`p${tag}`, "places", place),
        mut(`n${tag}`, "visit_notes", note(`n-${tag}`, place.id, { body: `note of ${tag}` })),
        mut(`k${tag}`, "links", {
          id: uid(`k-${tag}`),
          placeId: place.id,
          url: `https://example.com/${tag}`,
          title: null,
          createdAt: T0,
          updatedAt: T0,
          deletedAt: null,
        } as { id: string }),
        mut(`l${tag}`, "lists", ownList(`own-${tag}`)),
        mut(`i${tag}`, "list_items", ownItem(`own-${tag}`, place.id)),
      ],
      T0 + 1,
    );
  }
  // A provider list the first user follows, holding a place only that list connects her to.
  await push(db, other.userId, [mut("ps", "places", shared)], T0 + 1);
  await db.kysely
    .insertInto("lists")
    .values({
      id: "l_kakao_1",
      provider: "kakao",
      external_id: "1",
      name: "제주",
      description: null,
      color: null,
      owner_name: null,
      removed_at_provider: null,
      provider_snapshot_at: null,
      provider_owner_id: "kakao-owner-secret",
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      client_updated_at: T0,
      seq: 1,
    })
    .execute();
  await db.kysely
    .insertInto("list_items")
    .values({
      id: "li_kakao_1",
      list_id: "l_kakao_1",
      place_id: shared.id,
      position: 0,
      added_at: T0,
      external_id: "x",
      provider_note: "memo",
      provider_color: null,
      item_color: null,
      color_edited_at: T0,
      removed_at_provider: null,
      provider_snapshot_at: null,
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      client_updated_at: T0,
      seq: 1,
    })
    .execute();
  await db.kysely
    .insertInto("user_lists")
    .values({
      user_id: me.userId,
      id: "ul_1",
      list_id: "l_kakao_1",
      role: "follower",
      removed_at: null,
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      client_updated_at: T0,
      seq: 1,
    })
    .execute();
  return { me, other, cafe, secret, shared };
}

forEachDialect("exportUserData", (makeDb) => {
  it("exports the user's own rows and the shared rows they can reach", async () => {
    const db = await makeDb();
    const { me, cafe, shared } = await twoUsers(db);
    const out = await exportUserData(db, me.userId, T0 + 5);
    expect(out.format).toBe("magomap-export");
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe(new Date(T0 + 5).toISOString());
    expect(out.account.displayName).toBe("지은");
    expect(out.mine.notes.map((n) => n.body)).toEqual(["note of me"]);
    expect(out.mine.links.map((l) => l.url)).toEqual(["https://example.com/me"]);
    expect(out.mine.savedPlaces.map((p) => p.placeId)).toContain(cafe.id);
    expect(out.mine.lists.map((l) => l.id)).toEqual([uid("own-me")]);
    expect(out.mine.listItems.map((i) => i.placeId)).toEqual([cafe.id]);
    expect(out.mine.listMemberships.map((m) => m.listId).sort()).toEqual(
      ["l_kakao_1", uid("own-me")].sort(),
    );
    expect(out.shared.places.map((p) => p.id).sort()).toEqual([cafe.id, shared.id].sort());
    expect(out.shared.placeSources).toHaveLength(2);
    expect(out.shared.lists.map((l) => l.id)).toEqual(["l_kakao_1"]);
    expect(out.shared.listItems.map((i) => i.id)).toEqual(["li_kakao_1"]);
    expect(out.shared.placeLocations).toBeInstanceOf(Array);
  });

  it("never includes another user's private rows, secrets or server-only columns", async () => {
    const db = await makeDb();
    const { me, other, secret } = await twoUsers(db);
    await createSession(db, me.userId, T0);
    const text = JSON.stringify(await exportUserData(db, me.userId, T0));
    for (const leak of [
      "note of other",
      "example.com/other",
      secret.id,
      "비밀 카페",
      uid("own-other"),
      other.userId,
      "kakao-owner-secret",
      "color_edited_at",
      "colorEditedAt",
      "provider_owner_id",
      "providerOwnerId",
      "token_hash",
      "tokenHash",
      "expiresAt",
      "userId",
      "user_id",
    ]) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it("leaves out rows the user deleted, and lists they were removed from", async () => {
    const db = await makeDb();
    const { me } = await twoUsers(db);
    await db.kysely
      .updateTable("visit_notes")
      .set({ deleted_at: T0 + 2 })
      .where("user_id", "=", me.userId)
      .execute();
    await db.kysely
      .updateTable("user_lists")
      .set({ removed_at: T0 + 2 })
      .where("user_id", "=", me.userId)
      .where("list_id", "=", "l_kakao_1")
      .execute();
    const out = await exportUserData(db, me.userId, T0);
    expect(out.mine.notes).toEqual([]);
    expect(out.shared.lists).toEqual([]);
    expect(out.shared.listItems).toEqual([]);
  });

  it("exports the user's import history, not another user's or the run's working state", async () => {
    const db = await makeDb();
    const { me, other } = await twoUsers(db);
    const summary = {
      listsAdded: 2,
      listsUpdated: 0,
      listsRemoved: 0,
      placesAdded: 5,
      placesMoved: 0,
      membershipsRemoved: 0,
      membershipsRestored: 0,
      notesImported: 1,
    };
    const run = (userId: string, id: string, startedAt: number, summaryJson: string | null) => ({
      user_id: userId,
      id,
      provider: "kakao",
      source: "kakao_map",
      started_at: startedAt,
      finished_at: summaryJson ? startedAt + 10 : null,
      status: summaryJson ? "completed" : "superseded",
      complete: summaryJson ? 1 : 0,
      subscription_known: 1,
      snapshot_at: startedAt,
      summary_json: summaryJson,
      error: null,
    });
    await db.kysely
      .insertInto("import_runs")
      .values([
        run(me.userId, "run-old", T0, null),
        run(me.userId, "run-new", T0 + 100, JSON.stringify({ summary, internal: "x" })),
        run(other.userId, "run-other", T0, JSON.stringify({ summary })),
      ])
      .execute();
    const out = await exportUserData(db, me.userId, T0);
    expect(out.mine.importRuns).toEqual([
      {
        id: "run-new",
        provider: "kakao",
        source: "kakao_map",
        startedAt: T0 + 100,
        finishedAt: T0 + 110,
        status: "completed",
        complete: true,
        summary,
      },
      {
        id: "run-old",
        provider: "kakao",
        source: "kakao_map",
        startedAt: T0,
        finishedAt: null,
        status: "superseded",
        complete: false,
        summary: null,
      },
    ]);
  });

  it("exports an empty account", async () => {
    const db = await makeDb();
    const u = await findOrCreateUserByIdentity(db, "kakao", "9", null, T0);
    const out = await exportUserData(db, u.userId, T0);
    expect(out.account.displayName).toBeNull();
    expect(Object.values(out.mine).every((rows) => rows.length === 0)).toBe(true);
    expect(Object.values(out.shared).every((rows) => rows.length === 0)).toBe(true);
  });

  it("reads a large account in pages, losing and repeating nothing", async () => {
    const db = await makeDb();
    const u = await findOrCreateUserByIdentity(db, "kakao", "7", null, T0);
    const places = Array.from({ length: 25 }, (_, i) => searchedPlace(`b${i}`));
    for (let i = 0; i < places.length; i += 5) {
      await push(
        db,
        u.userId,
        places.slice(i, i + 5).map((p) => mut(`m${p.id}`, "places", p)),
        T0 + 1,
      );
    }
    const out = await exportUserData(db, u.userId, T0, { pageRows: 4 });
    expect(out.shared.places).toHaveLength(25);
    expect(new Set(out.shared.places.map((p) => p.id)).size).toBe(25);
    expect(out.mine.savedPlaces).toHaveLength(25);
  });

  // The Workers Free plan allows 50 D1 queries per request (developers.cloudflare.com/d1/platform/
  // limits): the export reads a few thousand rows a table in one query, not one per 500.
  it("reads a library of 600 places in one query per table", async () => {
    const db = await makeDb();
    const u = await findOrCreateUserByIdentity(db, "kakao", "8", null, T0);
    const places = Array.from({ length: 600 }, (_, i) => searchedPlace(`c${i}`));
    for (let i = 0; i < places.length; i += 200) {
      await push(
        db,
        u.userId,
        places.slice(i, i + 200).map((p) => mut(`m${p.id}`, "places", p)),
        T0 + 1,
      );
    }
    let queries = 0;
    const counted = {
      ...db,
      kysely: db.kysely.withPlugin({
        transformQuery: (args) => {
          queries += 1;
          return args.node;
        },
        transformResult: async (args) => args.result,
      }),
    } as Db;
    const out = await exportUserData(counted, u.userId, T0);
    expect(out.shared.places).toHaveLength(600);
    // users, identities, import runs, and one read for each synced table (the export reads them all).
    expect(queries).toBeLessThanOrEqual(3 + SYNC_TABLES.length);
  });

  it("finds nothing for a deleted account, and everything still for the other one", async () => {
    const db = await makeDb();
    const { me, other } = await twoUsers(db);
    await deleteAccount(db, me.userId);
    const gone = await exportUserData(db, me.userId, T0);
    expect(Object.values(gone.mine).every((rows) => rows.length === 0)).toBe(true);
    expect(Object.values(gone.shared).every((rows) => rows.length === 0)).toBe(true);
    const kept = await exportUserData(db, other.userId, T0);
    expect(kept.mine.notes).toHaveLength(1);
  });
});
