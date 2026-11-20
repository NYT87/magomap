import type { ImportItem, ImportList } from "@magomap/domain";
import { expect, it } from "vitest";
import type { Db } from "../core";
import { countWrites } from "../testing/countWrites";
import { forEachDialect } from "../testing/dbs";
import { addUser, importSnapshot, T0 } from "./testkit";

const USER = "wife";

function item(ext: string, extra: Partial<ImportItem> = {}): ImportItem {
  return {
    externalId: ext,
    placeExternalId: `P${ext}`,
    title: `장소 ${ext}`,
    address: "제주 애월읍",
    lat: 33.46,
    lng: 126.31,
    providerColor: "01",
    position: Number(ext) % 1000,
    ...extra,
  };
}
function list(ext: string, items: ImportItem[]): ImportList {
  return { externalId: ext, name: `리스트 ${ext}`, followed: false, items };
}

const all = (db: Db, t: "places" | "list_items" | "place_sources" | "place_locations") =>
  db.kysely.selectFrom(t).selectAll().execute();

async function setup(makeDb: () => Promise<Db>) {
  const db = await makeDb();
  await addUser(db, USER);
  return db;
}

forEachDialect("import write budget", (makeDb) => {
  it("an unchanged re-import with a newer snapshot stays within the write budget", async () => {
    const db = await setup(makeDb);
    const big = Array.from({ length: 600 }, (_, i) => item(String(i + 1)));
    const small = ["1001", "1002", "1003"].map((e) => item(e));
    const lists = [list("1", big), list("2", small)];
    await importSnapshot(db, USER, lists, { snapshot: T0 });

    const counted = countWrites(db);
    await importSnapshot(counted.db, USER, lists, { at: T0 + 1000, snapshot: T0 + 1000 });
    expect(counted.written()).toBeLessThanOrEqual(10 + 6 * 2 + 5 * 3);
  });

  it("an unchanged re-import changes no places, list items, sources or locations", async () => {
    const db = await setup(makeDb);
    const full = { category: "카페", phone: "064-000-0000", lat: 33.5, lng: 126.5 };
    const moved = 33.46 + 500 / 111_320;
    await importSnapshot(db, USER, [list("1", [item("10", full), item("11")])], { snapshot: T0 });
    // Place 11 moves, so it has a location history row.
    const lists = [list("1", [item("10", full), item("11", { lat: moved })])];
    await importSnapshot(db, USER, lists, { at: T0 + 500, snapshot: T0 + 500 });
    await db.kysely
      .updateTable("places")
      .set({ road_address: "제주 애월읍 애월해안로 1" })
      .where("id", "=", "p_kakao_P10")
      .execute();
    const before = {
      places: await all(db, "places"),
      items: await all(db, "list_items"),
      sources: await all(db, "place_sources"),
      locations: await all(db, "place_locations"),
    };
    expect(before.locations).toHaveLength(1);
    expect(before.places.find((p) => p.id === "p_kakao_P10")?.road_address).toBe(
      "제주 애월읍 애월해안로 1",
    );
    await importSnapshot(db, USER, lists, { at: T0 + 1000, snapshot: T0 + 1000 });
    expect(await all(db, "places")).toEqual(before.places);
    expect(await all(db, "list_items")).toEqual(before.items);
    expect(await all(db, "place_sources")).toEqual(before.sources);
    expect(await all(db, "place_locations")).toEqual(before.locations);
  });

  it("a re-import leaves memberships already removed alone, within the write budget", async () => {
    const db = await setup(makeDb);
    await importSnapshot(
      db,
      USER,
      [
        list(
          "1",
          ["1", "2", "3"].map((e) => item(e)),
        ),
      ],
      {
        snapshot: T0,
      },
    );
    const two = [
      list(
        "1",
        ["1", "2"].map((e) => item(e)),
      ),
    ];
    await importSnapshot(db, USER, two, { at: T0 + 500, snapshot: T0 + 500 });
    const before = await all(db, "list_items");
    expect(before.filter((i) => i.removed_at_provider != null)).toHaveLength(1);

    const counted = countWrites(db);
    await importSnapshot(counted.db, USER, two, { at: T0 + 1000, snapshot: T0 + 1000 });
    expect(await all(db, "list_items")).toEqual(before);
    expect(counted.written()).toBeLessThanOrEqual(10 + 6 * 1 + 5 * 1);
  });

  it("atomic reports the rows each statement changed", async () => {
    const db = await makeDb();
    const results = await db.atomic([
      db.kysely
        .insertInto("users")
        .values(["a", "b", "c"].map((id) => ({ id, display_name: null, created_at: T0 }))),
      db.kysely.updateTable("users").set({ display_name: "x" }).where("id", "=", "a"),
    ]);
    expect(results.map((r) => r.numAffectedRows)).toEqual([3n, 1n]);
  });
});
