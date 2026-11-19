import { expect, it } from "vitest";
import type { Db } from "../core";
import { forEachDialect } from "../testing/dbs";
import { completeImportRun, finishImportList, importListChunk, startImportRun } from "./importRuns";
import { pull } from "./sync";
import { addUser, del, note, ownItem, ownList, push, searchedPlace, T0, uid, up } from "./testkit";

const A = "user-a";
const B = "user-b";
const ids = async (db: Db, user: string, cursor: string | null = null) =>
  (await pull(db, user, cursor)).rows.map((r) => `${r.table}:${r.row.id}`).sort();

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, A);
  await addUser(db, B);
  return db;
}

async function importList(db: Db, user: string, followed: boolean, items: string[], at: number) {
  const { runId } = await startImportRun(
    db,
    user,
    {
      provider: "kakao",
      complete: true,
      subscriptionKnown: true,
      importedAt: new Date(at).toISOString(),
    },
    at,
  );
  await importListChunk(
    db,
    user,
    runId,
    { externalId: "1", name: "제주", followed },
    items.map((p, i) => ({
      externalId: String(10 + i),
      placeExternalId: p,
      title: p,
      lat: 33.4,
      lng: 126.3,
      position: i,
    })),
    at,
  );
  await finishImportList(db, user, runId, "1", at);
  await completeImportRun(db, user, runId, ["1"], at);
}

forEachDialect("pull scope", (makeDb) => {
  it("returns a user's own rows from a null cursor, in wire format", async () => {
    const db = await setup(makeDb);
    await push(
      db,
      A,
      [up("places", searchedPlace("1")), up("visit_notes", note("n1", "p_kakao_1"))],
      T0,
    );
    expect(await ids(db, A)).toEqual([
      "place_sources:s_kakao_1",
      "places:p_kakao_1",
      "user_places:up_p_kakao_1",
      `visit_notes:${uid("n1")}`,
    ]);
    const res = await pull(db, A, null);
    expect(res.rows.find((r) => r.table === "visit_notes")?.row).toMatchObject({
      editedByUser: false,
      body: "바다가 보였어요",
    });
  });

  it("never gives a user another user's own lists, items, notes or links", async () => {
    const db = await setup(makeDb);
    await push(
      db,
      A,
      [
        up("places", searchedPlace("1")),
        up("lists", ownList("own-a")),
        up("list_items", ownItem("own-a", "p_kakao_1")),
        up("visit_notes", note("na", "p_kakao_1")),
        up("links", {
          id: "la",
          placeId: "p_kakao_1",
          url: "https://example.com",
          title: null,
          createdAt: T0,
          updatedAt: T0,
          deletedAt: null,
        } as never),
      ],
      T0,
    );
    await push(db, B, [up("places", searchedPlace("1"))], T0);
    const seen = await ids(db, B);
    for (const forbidden of [
      `lists:${uid("own-a")}`,
      `visit_notes:${uid("na")}`,
      `links:${uid("la")}`,
      `user_lists:ul_${uid("own-a")}`,
    ])
      expect(seen).not.toContain(forbidden);
    expect(seen.some((s) => s.startsWith("list_items:"))).toBe(false);
    expect(seen).toContain("places:p_kakao_1");
  });

  it("gives a user a place someone else saved long ago, once they save it too", async () => {
    const db = await setup(makeDb);
    await push(db, A, [up("places", searchedPlace("1"))], T0);
    await push(db, B, [up("places", searchedPlace("2"))], T0);
    const cursor = (await pull(db, B, null)).cursor;
    await push(
      db,
      B,
      [up("places", searchedPlace("1"), T0 + 2), up("visit_notes", note("nb", "p_kakao_1"))],
      T0,
    );
    const got = await ids(db, B, cursor);
    expect(got).toContain("places:p_kakao_1");
    expect(got).toContain("place_sources:s_kakao_1");
  });

  it("stops sending a list's content after the user unfollows it, and keeps sending it to the owner", async () => {
    const db = await setup(makeDb);
    await importList(db, A, false, ["X", "Y"], T0);
    await importList(db, B, true, ["X", "Y"], T0 + 1);
    expect(await ids(db, B)).toContain("lists:l_kakao_1");
    // B unfollows: a complete import without the list
    const { runId } = await startImportRun(
      db,
      B,
      {
        provider: "kakao",
        complete: true,
        subscriptionKnown: true,
        importedAt: new Date(T0 + 2).toISOString(),
      },
      T0 + 2,
    );
    await importListChunk(
      db,
      B,
      runId,
      { externalId: "9", name: "다른", followed: false },
      [],
      T0 + 2,
    );
    await finishImportList(db, B, runId, "9", T0 + 2);
    await completeImportRun(db, B, runId, ["9"], T0 + 2);
    const bNow = await ids(db, B);
    expect(bNow).not.toContain("lists:l_kakao_1");
    expect(bNow.some((s) => s.startsWith("list_items:i_kakao_1_"))).toBe(false);
    expect(bNow).toContain("user_lists:ul_l_kakao_1");
    expect(bNow).toContain("places:p_kakao_X");
    expect(await ids(db, A)).toContain("lists:l_kakao_1");
  });

  it("pages every row exactly once", async () => {
    const db = await setup(makeDb);
    await push(
      db,
      A,
      [1, 2, 3, 4, 5].map((n) => up("places", searchedPlace(String(n)))),
      T0,
    );
    await push(
      db,
      A,
      ["a", "b", "c"].map((n) => up("visit_notes", note(n, "p_kakao_1"))),
      T0,
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await pull(db, A, cursor, 2);
      seen.push(...page.rows.map((r) => `${r.table}:${r.row.id}`));
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((s) => s.startsWith("places:"))).toHaveLength(5);
    expect(seen.filter((s) => s.startsWith("visit_notes:"))).toHaveLength(3);
  });

  it("returns only changed rows after a cursor, including deletions", async () => {
    const db = await setup(makeDb);
    await push(
      db,
      A,
      [up("places", searchedPlace("1")), up("visit_notes", note("n1", "p_kakao_1"))],
      T0,
    );
    const first = await pull(db, A, null);
    await push(db, A, [del("visit_notes", "n1", T0 + 5)], T0);
    const next = await pull(db, A, first.cursor);
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]).toMatchObject({ table: "visit_notes", row: { id: uid("n1") } });
    expect(next.rows[0]?.row.deletedAt).not.toBeNull();
  });

  it("ignores a malformed cursor instead of failing", async () => {
    const db = await setup(makeDb);
    const bad = btoa(JSON.stringify({ places: 5 }));
    await expect(pull(db, A, bad)).resolves.toBeTruthy();
  });
});
