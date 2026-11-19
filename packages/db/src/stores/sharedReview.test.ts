// Regression tests for the plan 01b final reviews (code, security, Codex).
import type { ImportItem } from "@magomap/domain";
import { ownItemRowId } from "@magomap/domain/ids";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { inJson } from "../mapping";
import { forEachDialect } from "../testing/dbs";
import {
  completeImportRun,
  finishImportList,
  ImportConflictError,
  importListChunk,
  startImportRun,
} from "./importRuns";
import { AccountGoneError, applyPush, pull } from "./sync";
import {
  addUser,
  interleaved,
  note,
  ownItem,
  ownList,
  push,
  searchedPlace,
  T0,
  uid,
  up,
} from "./testkit";
import { deleteAccount } from "./users";

const WIFE = "wife";
const ME = "me";
const at = (ms: number) => new Date(T0 + ms).toISOString();
const item = (ext: string, place: string, extra: Partial<ImportItem> = {}): ImportItem => ({
  externalId: ext,
  placeExternalId: place,
  title: place,
  lat: 33.46,
  lng: 126.31,
  position: Number(ext) % 1000,
  ...extra,
});

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, WIFE);
  await addUser(db, ME);
  return db;
}

async function importOne(
  db: Db,
  user: string,
  items: ImportItem[],
  o: { snap: number; followed?: boolean; complete?: boolean; lists?: string[] },
) {
  const { runId } = await startImportRun(
    db,
    user,
    {
      provider: "kakao",
      complete: o.complete ?? true,
      subscriptionKnown: true,
      importedAt: at(o.snap),
    },
    T0 + o.snap,
  );
  if (items.length > 0 || (o.lists ?? ["1"]).includes("1")) {
    if ((o.lists ?? ["1"]).includes("1")) {
      await importListChunk(
        db,
        user,
        runId,
        { externalId: "1", name: "제주", followed: o.followed ?? false },
        items,
        T0 + o.snap,
      );
      await finishImportList(db, user, runId, "1", T0 + o.snap);
    }
  }
  return completeImportRun(db, user, runId, o.lists ?? ["1"], T0 + o.snap);
}

const ids = async (db: Db, user: string, cursor: string | null = null) =>
  (await pull(db, user, cursor)).rows.map((r) => `${r.table}:${r.row.id}`);

forEachDialect("shared review fixes", (makeDb) => {
  it("never returns another user's own-list item in a stale response", async () => {
    const db = await setup(makeDb);
    await push(
      db,
      WIFE,
      [
        up("lists", ownList("hers")),
        up("places", searchedPlace("1")),
        up("list_items", ownItem("hers", "p_kakao_1"), T0 + 5),
      ],
      T0,
    );
    const hers = ownItemRowId(uid("hers"), "p_kakao_1");
    const res = await push(
      db,
      ME,
      [up("list_items", { ...ownItem("mine-missing", "p_kakao_1"), id: hers }, T0 + 1)],
      T0,
    );
    expect(res.results[0]).toMatchObject({ status: "rejected", reason: "not_allowed" });
    expect(res.results[0]?.row).toBeUndefined();
  });

  it("does not let an import take over a list row that isn't that provider's list", async () => {
    const db = await setup(makeDb);
    await db.kysely
      .insertInto("lists")
      .values({
        id: "l_kakao_1",
        provider: null,
        external_id: null,
        name: "private",
        description: null,
        color: null,
        owner_name: null,
        removed_at_provider: null,
        provider_snapshot_at: null,
        created_at: T0,
        updated_at: T0,
        deleted_at: null,
        client_updated_at: T0,
        seq: 0,
      })
      .execute();
    await expect(importOne(db, WIFE, [item("10", "A")], { snap: 0 })).rejects.toBeInstanceOf(
      ImportConflictError,
    );
    expect((await db.kysely.selectFrom("lists").selectAll().execute())[0]).toMatchObject({
      provider: null,
      name: "private",
    });
  });

  it("keeps a removal against an older snapshot (items and lists)", async () => {
    const db = await setup(makeDb);
    await importOne(db, WIFE, [item("10", "A"), item("11", "B")], { snap: 0 });
    await importOne(db, WIFE, [item("10", "A")], { snap: 200 });
    await importOne(db, ME, [item("10", "A"), item("11", "B")], { snap: 100, followed: true });
    const removed = await db.kysely
      .selectFrom("list_items")
      .select("removed_at_provider")
      .where("id", "=", "i_kakao_1_11")
      .executeTakeFirstOrThrow();
    expect(removed.removed_at_provider).not.toBeNull();
    // the owner deletes list 1 at 300 (her import still has another list); a follower's 250 snapshot doesn't bring it back
    const { runId } = await startImportRun(
      db,
      WIFE,
      { provider: "kakao", complete: true, subscriptionKnown: true, importedAt: at(300) },
      T0 + 300,
    );
    await importListChunk(
      db,
      WIFE,
      runId,
      { externalId: "2", name: "다른", followed: false },
      [item("20", "C")],
      T0 + 300,
    );
    await finishImportList(db, WIFE, runId, "2", T0 + 300);
    await completeImportRun(db, WIFE, runId, ["2"], T0 + 300);
    expect(
      (
        await db.kysely
          .selectFrom("lists")
          .selectAll()
          .where("id", "=", "l_kakao_1")
          .executeTakeFirstOrThrow()
      ).removed_at_provider,
    ).not.toBeNull();
    await importOne(db, ME, [item("10", "A")], { snap: 250, followed: true });
    expect(
      (
        await db.kysely
          .selectFrom("lists")
          .selectAll()
          .where("id", "=", "l_kakao_1")
          .executeTakeFirstOrThrow()
      ).removed_at_provider,
    ).not.toBeNull();
  });

  it("does not add items from an older snapshot to a newer list", async () => {
    const db = await setup(makeDb);
    await importOne(db, WIFE, [item("10", "Y")], { snap: 100 });
    await importOne(db, ME, [item("10", "Y"), item("11", "X")], { snap: 10, followed: true });
    const items = await db.kysely.selectFrom("list_items").selectAll().execute();
    expect(items.map((i) => i.id)).toEqual(["i_kakao_1_10"]);
    expect(
      (
        await db.kysely
          .selectFrom("user_lists")
          .selectAll()
          .where("user_id", "=", ME)
          .executeTakeFirst()
      )?.role,
    ).toBe("follower");
  });

  it("gives followers the places of items added to a list later", async () => {
    const db = await setup(makeDb);
    await importOne(db, WIFE, [item("10", "X")], { snap: 0 });
    await importOne(db, ME, [item("10", "X")], { snap: 0, followed: true });
    const cursor = (await pull(db, ME, null)).cursor;
    await push(db, "wife", [up("places", searchedPlace("Y"))], T0); // Y exists long before she adds it
    await importOne(db, WIFE, [item("10", "X"), item("11", "Y")], { snap: 50 });
    const got = await ids(db, ME, cursor);
    expect(got).toContain("list_items:i_kakao_1_11");
    expect(got).toContain("places:p_kakao_Y");
    expect(got).toContain("place_sources:s_kakao_Y");
  });

  it("refuses writes for an account deleted while a push was in flight", async () => {
    const db = await setup(makeDb);
    await push(db, ME, [up("places", searchedPlace("1"))], T0);
    const racing = interleaved(db, () => deleteAccount(db, ME));
    await expect(
      applyPush(racing, ME, [up("visit_notes", note("n1", "p_kakao_1"))], T0, {
        verifySource: () => true,
      }),
    ).rejects.toBeInstanceOf(AccountGoneError);
    expect(await db.kysely.selectFrom("visit_notes").selectAll().execute()).toHaveLength(0);
    expect(
      await db.kysely.selectFrom("user_places").selectAll().where("user_id", "=", ME).execute(),
    ).toHaveLength(0);
  });

  it("refuses a place whose search signature doesn't verify", async () => {
    const db = await setup(makeDb);
    const res = await applyPush(db, ME, [up("places", searchedPlace("1"))], T0, {
      verifySource: () => false,
    });
    expect(res.results[0]).toMatchObject({ status: "rejected", reason: "invalid" });
    expect(await db.kysely.selectFrom("places").selectAll().execute()).toHaveLength(0);
  });

  it("refuses a pushed source that impersonates a pin", async () => {
    const db = await setup(makeDb);
    const res = await push(db, ME, [up("places", searchedPlace("pin:1:55"))], T0);
    expect(res.results[0]?.reason).toBe("not_allowed");
  });

  it("only allows notes on places the user has or can see in their lists", async () => {
    const db = await setup(makeDb);
    await push(db, WIFE, [up("places", searchedPlace("secret"))], T0);
    const res = await push(db, ME, [up("visit_notes", note("n1", "p_kakao_secret"))], T0);
    expect(res.results[0]?.reason).toBe("missing_parent");
  });

  it("protects a location refreshed from search against an older import", async () => {
    const db = await setup(makeDb);
    await importOne(db, WIFE, [item("10", "A", { lat: 33.46 })], { snap: 0 });
    await push(
      db,
      WIFE,
      [up("places", searchedPlace("A", { lat: 33.46 + 500 / 111_320 }), T0 + 50)],
      T0 + 50,
    );
    await importOne(db, ME, [item("10", "A", { lat: 33.46 })], { snap: 20, followed: true });
    const place = await db.kysely.selectFrom("places").selectAll().executeTakeFirstOrThrow();
    expect(place.lat).toBeCloseTo(33.46 + 500 / 111_320, 6);
    expect(await db.kysely.selectFrom("place_locations").selectAll().execute()).toHaveLength(1);
  });

  it("refuses an import run dated in the future", async () => {
    const db = await setup(makeDb);
    await expect(
      startImportRun(
        db,
        WIFE,
        {
          provider: "kakao",
          complete: true,
          subscriptionKnown: true,
          importedAt: at(10 * 86_400_000),
        },
        T0,
      ),
    ).rejects.toThrow(/importedAt/);
    await expect(
      startImportRun(
        db,
        WIFE,
        { provider: "kakao", complete: true, subscriptionKnown: true, importedAt: "not a date" },
        T0,
      ),
    ).rejects.toThrow(/importedAt/);
  });

  it("splits large id lists so each JSON parameter stays under 1 MB", async () => {
    const db = await setup(makeDb);
    const many = Array.from({ length: 6000 }, (_, i) => `${"x".repeat(200)}${i}`);
    const q = db.kysely
      .selectFrom("places")
      .selectAll()
      .where(inJson(db, "id", many))
      .compile();
    for (const p of q.parameters)
      if (typeof p === "string")
        expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(1_000_000);
    expect(q.parameters.length).toBeGreaterThan(1);
  });
});
