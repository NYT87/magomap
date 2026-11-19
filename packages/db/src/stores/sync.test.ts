import type { Mutation, PlaceRow, VisitNoteRow } from "@magomap/domain";
import { kakaoPlaceRowId, ownMembershipRowId } from "@magomap/domain/ids";
import { describe, expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { applyLocationUpdate, applyPush, pull } from "./sync";

const T0 = 1_763_000_000_000;
const U = "user-1";
let counter = 0;

async function withUser(db: Db, id = U) {
  await db.kysely
    .insertInto("users")
    .values({ id, display_name: null, change_seq: 0, created_at: T0 })
    .execute();
}

function place(n: string, extra: Partial<PlaceRow> = {}): PlaceRow {
  return {
    id: kakaoPlaceRowId(n),
    kakaoPlaceId: n,
    title: `카페 ${n}`,
    address: "제주 애월읍",
    roadAddress: null,
    addressSource: "search",
    category: "카페",
    phone: null,
    lat: 33.46,
    lng: 126.31,
    source: "search",
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...extra,
  };
}

function note(id: string, placeId: string, extra: Partial<VisitNoteRow> = {}): VisitNoteRow {
  return {
    id,
    placeId,
    visitedOn: "2026-11-19",
    body: "바다가 보였어요",
    origin: "user",
    originKey: null,
    editedByUser: false,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...extra,
  };
}

function up(table: Mutation["table"], row: { id: string }, at = T0 + 1): Mutation {
  counter += 1;
  return { mutationId: `m${counter}`, table, op: "upsert", id: row.id, row, clientUpdatedAt: at };
}
function del(table: Mutation["table"], id: string, at = T0 + 1): Mutation {
  counter += 1;
  return { mutationId: `m${counter}`, table, op: "delete", id, clientUpdatedAt: at };
}

async function rowOf(
  db: Db,
  table: "places" | "visit_notes" | "lists" | "list_items" | "links",
  id: string,
) {
  return db.kysely
    .selectFrom(table)
    .selectAll()
    .where("user_id", "=", U)
    .where("id", "=", id)
    .executeTakeFirst();
}

async function insertKakaoList(db: Db, listId = "kl_9") {
  await db.kysely
    .insertInto("lists")
    .values({
      user_id: U,
      id: listId,
      kind: "kakao",
      kakao_folder_id: 9,
      subscribed: 0,
      owner_name: null,
      name: "제주",
      description: null,
      color: null,
      removed_from_kakao_at: null,
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      client_updated_at: 0,
      seq: 0,
    })
    .execute();
}

forEachDialect("sync push", (makeDb) => {
  it("1. rejects an invalid row and applies the rest", async () => {
    const db = await makeDb();
    await withUser(db);
    const bad = up("links", {
      id: "l1",
      placeId: "kp_1",
      url: "javascript:x",
      title: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    } as never);
    const res = await applyPush(
      db,
      U,
      [up("places", place("1")), bad, up("visit_notes", note("n1", "kp_1"))],
      T0,
    );
    expect(res.results.map((r) => [r.status, r.reason])).toEqual([
      ["applied", undefined],
      ["rejected", "invalid"],
      ["applied", undefined],
    ]);
  });

  it("2. coalesces create, edit and delete of one note", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1"))], T0);
    const res = await applyPush(
      db,
      U,
      [
        up("visit_notes", note("n1", "kp_1"), T0 + 1),
        up("visit_notes", note("n1", "kp_1", { body: "edited" }), T0 + 2),
        del("visit_notes", "n1", T0 + 3),
      ],
      T0,
    );
    expect(res.results.every((r) => r.status === "applied")).toBe(true);
    const row = await rowOf(db, "visit_notes", "n1");
    expect(row?.deleted_at).not.toBeNull();
  });

  it("3-4. accepts a searched place and a note on it in one push", async () => {
    const db = await makeDb();
    await withUser(db);
    const res = await applyPush(
      db,
      U,
      [up("visit_notes", note("n1", "kp_7")), up("places", place("7"))],
      T0,
    );
    expect(res.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(await rowOf(db, "visit_notes", "n1")).toBeDefined();
  });

  it("5. rejects writes to Kakao lists and their memberships", async () => {
    const db = await makeDb();
    await withUser(db);
    await insertKakaoList(db);
    await applyPush(db, U, [up("places", place("1"))], T0);
    const list = {
      id: "kl_9",
      kind: "kakao",
      kakaoFolderId: 9,
      subscribed: false,
      ownerName: null,
      name: "x",
      description: null,
      color: null,
      removedFromKakaoAt: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    };
    const item = {
      id: ownMembershipRowId("kl_9", "kp_1"),
      listId: "kl_9",
      placeId: "kp_1",
      position: 0,
      addedAt: T0,
      kakaoFavoriteSeq: null,
      kakaoNote: null,
      kakaoColor: null,
      removedFromKakaoAt: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    };
    const res = await applyPush(db, U, [up("lists", list), up("list_items", item)], T0);
    expect(res.results.map((r) => r.reason)).toEqual(["kakao_owned", "kakao_owned"]);
    const removal = await applyPush(db, U, [del("lists", "kl_9")], T0);
    expect(removal.results[0]?.reason).toBe("kakao_owned");
  });

  it("6. requires the deterministic membership id and an existing parent", async () => {
    const db = await makeDb();
    await withUser(db);
    const list = {
      id: "own-1",
      kind: "own",
      kakaoFolderId: null,
      subscribed: false,
      ownerName: null,
      name: "바다 뷰",
      description: null,
      color: "#1F6F5C",
      removedFromKakaoAt: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    };
    const item = (id: string, placeId: string) => ({
      id,
      listId: "own-1",
      placeId,
      position: 0,
      addedAt: T0,
      kakaoFavoriteSeq: null,
      kakaoNote: null,
      kakaoColor: null,
      removedFromKakaoAt: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    });
    const res = await applyPush(
      db,
      U,
      [
        up("lists", list),
        up("places", place("1")),
        up("list_items", item("random-id", "kp_1")),
        up("list_items", item(ownMembershipRowId("own-1", "kp_404"), "kp_404")),
        up("list_items", item(ownMembershipRowId("own-1", "kp_1"), "kp_1")),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual([
      "applied",
      "applied",
      "not_allowed",
      "missing_parent",
      "applied",
    ]);
  });

  it("6b. collapses the same membership added from two devices", async () => {
    const db = await makeDb();
    await withUser(db);
    const list = {
      id: "own-1",
      kind: "own",
      kakaoFolderId: null,
      subscribed: false,
      ownerName: null,
      name: "x",
      description: null,
      color: null,
      removedFromKakaoAt: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    };
    const id = ownMembershipRowId("own-1", "kp_1");
    const item = {
      id,
      listId: "own-1",
      placeId: "kp_1",
      position: 0,
      addedAt: T0,
      kakaoFavoriteSeq: null,
      kakaoNote: null,
      kakaoColor: null,
      removedFromKakaoAt: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    };
    await applyPush(
      db,
      U,
      [up("lists", list), up("places", place("1")), up("list_items", item, T0 + 1)],
      T0,
    );
    await applyPush(db, U, [up("list_items", item, T0 + 2)], T0);
    const rows = await db.kysely
      .selectFrom("list_items")
      .selectAll()
      .where("user_id", "=", U)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("7. only creates places from search with a matching id and coordinates", async () => {
    const db = await makeDb();
    await withUser(db);
    const res = await applyPush(
      db,
      U,
      [
        up("places", place("1", { id: "kp_other" })),
        up("places", place("2", { lat: null, lng: null })),
        up("places", place("3", { source: "kakao_import" })),
      ],
      T0,
    );
    expect(res.results.map((r) => r.reason)).toEqual(["not_allowed", "not_allowed", "not_allowed"]);
  });

  it("7b. never changes the title of an existing place", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1"), T0 + 1)], T0);
    await applyPush(db, U, [up("places", place("1", { title: "renamed" }), T0 + 2)], T0);
    expect((await rowOf(db, "places", "kp_1"))?.title).toBe("카페 1");
  });

  it("8. restores a deleted place when a note for it is applied", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1"), T0 + 1)], T0);
    await applyPush(db, U, [del("places", "kp_1", T0 + 2)], T0);
    expect((await rowOf(db, "places", "kp_1"))?.deleted_at).not.toBeNull();
    await applyPush(db, U, [up("visit_notes", note("n1", "kp_1"), T0 + 3)], T0);
    expect((await rowOf(db, "places", "kp_1"))?.deleted_at).toBeNull();
  });

  it("8b. does not restore a place for a stale note", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(
      db,
      U,
      [up("places", place("1"), T0 + 1), up("visit_notes", note("n1", "kp_1"), T0 + 5)],
      T0,
    );
    await applyPush(db, U, [del("places", "kp_1", T0 + 6)], T0);
    const res = await applyPush(db, U, [up("visit_notes", note("n1", "kp_1"), T0 + 2)], T0);
    expect(res.results[0]?.status).toBe("ignored_stale");
    expect((await rowOf(db, "places", "kp_1"))?.deleted_at).not.toBeNull();
  });

  it("9. ignores a stale edit and returns the server row", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(
      db,
      U,
      [up("places", place("1")), up("visit_notes", note("n1", "kp_1", { body: "new" }), T0 + 10)],
      T0,
    );
    const res = await applyPush(
      db,
      U,
      [up("visit_notes", note("n1", "kp_1", { body: "old" }), T0 + 5)],
      T0,
    );
    expect(res.results[0]?.status).toBe("ignored_stale");
    expect(res.results[0]?.row).toMatchObject({ id: "n1", body: "new" });
    expect((await rowOf(db, "visit_notes", "n1"))?.body).toBe("new");
  });

  it("10. marks an edited or deleted imported note as edited by the user", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1"))], T0);
    await db.kysely
      .insertInto("visit_notes")
      .values({
        user_id: U,
        id: "kn_kp_1_9",
        place_id: "kp_1",
        visited_on: null,
        body: "주차 어려움",
        origin: "kakao_list",
        origin_key: "9",
        edited_by_user: 0,
        created_at: T0,
        updated_at: T0,
        deleted_at: null,
        client_updated_at: 0,
        seq: 0,
      })
      .execute();
    const imported = note("kn_kp_1_9", "kp_1", {
      origin: "kakao_list",
      originKey: "9",
      visitedOn: null,
      body: "주차 어려움, 근처 공영주차장",
    });
    await applyPush(db, U, [up("visit_notes", imported, T0 + 1)], T0);
    expect((await rowOf(db, "visit_notes", "kn_kp_1_9"))?.edited_by_user).toBe(1);
  });

  it("11. gives every row of one push the same new seq", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1"))], T0);
    await applyPush(db, U, [up("places", place("2")), up("visit_notes", note("n1", "kp_2"))], T0);
    const p2 = await rowOf(db, "places", "kp_2");
    const n1 = await rowOf(db, "visit_notes", "n1");
    const p1 = await rowOf(db, "places", "kp_1");
    expect(p2?.seq).toBe(2);
    expect(n1?.seq).toBe(2);
    expect(p1?.seq).toBe(1);
  });

  it("12. gives the same result when a push is retried", async () => {
    const db = await makeDb();
    await withUser(db);
    const batch = [up("places", place("1")), up("visit_notes", note("n1", "kp_1"))];
    await applyPush(db, U, batch, T0);
    const again = await applyPush(db, U, batch, T0);
    expect(again.results.every((r) => r.status === "applied" || r.status === "ignored_stale")).toBe(
      true,
    );
    expect(await db.kysely.selectFrom("visit_notes").selectAll().execute()).toHaveLength(1);
  });

  it("records a move when a search shows the place 100 m away", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1"), T0 + 1)], T0);
    await applyPush(
      db,
      U,
      [up("places", place("1", { lat: 33.46 + 100 / 111_320 }), T0 + 2)],
      T0 + 50,
    );
    const history = await db.kysely.selectFrom("place_locations").selectAll().execute();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      place_id: "kp_1",
      lat: 33.46,
      detected_by: "search",
      valid_from: T0,
      valid_until: T0 + 50,
    });
  });

  it("records no move for 10 m or for a different address alone", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1"), T0 + 1)], T0);
    await applyPush(db, U, [up("places", place("1", { lat: 33.46 + 10 / 111_320 }), T0 + 2)], T0);
    await applyPush(db, U, [up("places", place("1", { address: "다른 표기" }), T0 + 3)], T0);
    expect(await db.kysely.selectFrom("place_locations").selectAll().execute()).toHaveLength(0);
  });

  it("keeps users apart", async () => {
    const db = await makeDb();
    await withUser(db);
    await withUser(db, "user-2");
    await applyPush(db, "user-2", [up("places", place("1"))], T0);
    const res = await applyPush(db, U, [up("visit_notes", note("n1", "kp_1"))], T0);
    expect(res.results[0]?.reason).toBe("missing_parent");
  });
});

forEachDialect("sync pull", (makeDb) => {
  it("returns everything from a null cursor", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1")), up("visit_notes", note("n1", "kp_1"))], T0);
    const res = await pull(db, U, null);
    expect(res.rows.map((r) => `${r.table}:${r.row.id}`).sort()).toEqual([
      "places:kp_1",
      "visit_notes:n1",
    ]);
    expect(res.hasMore).toBe(false);
    expect(res.rows.find((r) => r.table === "visit_notes")?.row).toMatchObject({
      editedByUser: false,
      body: "바다가 보였어요",
    });
  });

  it("pages every row exactly once", async () => {
    const db = await makeDb();
    await withUser(db);
    const muts = [1, 2, 3, 4, 5].map((n) => up("places", place(String(n))));
    await applyPush(
      db,
      U,
      [
        ...muts,
        up("visit_notes", note("a", "kp_1")),
        up("visit_notes", note("b", "kp_1")),
        up("visit_notes", note("c", "kp_1")),
      ],
      T0,
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await pull(db, U, cursor, 2);
      seen.push(...page.rows.map((r) => `${r.table}:${r.row.id}`));
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(seen.sort()).toEqual([
      "places:kp_1",
      "places:kp_2",
      "places:kp_3",
      "places:kp_4",
      "places:kp_5",
      "visit_notes:a",
      "visit_notes:b",
      "visit_notes:c",
    ]);
  });

  it("returns only changed rows after a cursor, including tombstones", async () => {
    const db = await makeDb();
    await withUser(db);
    await applyPush(db, U, [up("places", place("1")), up("visit_notes", note("n1", "kp_1"))], T0);
    const first = await pull(db, U, null);
    await applyPush(db, U, [del("visit_notes", "n1", T0 + 5)], T0);
    const next = await pull(db, U, first.cursor);
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]).toMatchObject({ table: "visit_notes", row: { id: "n1" } });
    expect(next.rows[0]?.row.deletedAt).not.toBeNull();
  });
});

describe("applyLocationUpdate", () => {
  it("chains validFrom to the previous move", () => {
    const current = place("1");
    const r = applyLocationUpdate(
      current,
      { lat: 33.47, lng: 126.31 },
      "kakao_import",
      T0 + 100,
      T0 + 40,
    );
    expect(r.changed).toBe(true);
    expect(r.history).toMatchObject({
      placeId: "kp_1",
      lat: 33.46,
      validFrom: T0 + 40,
      validUntil: T0 + 100,
      detectedBy: "kakao_import",
    });
    expect(r.place.lat).toBe(33.47);
  });
});
