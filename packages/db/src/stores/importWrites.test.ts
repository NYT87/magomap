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

const all = (db: Db, t: "places" | "list_items" | "place_sources") =>
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

  it("an unchanged re-import changes no places, list items or sources", async () => {
    const db = await setup(makeDb);
    const lists = [
      list("1", [item("10", { category: "카페", phone: "064-000-0000", lat: 33.5, lng: 126.5 })]),
    ];
    await importSnapshot(db, USER, lists, { snapshot: T0 });
    const before = {
      places: await all(db, "places"),
      items: await all(db, "list_items"),
      sources: await all(db, "place_sources"),
    };
    await importSnapshot(db, USER, lists, { at: T0 + 1000, snapshot: T0 + 1000 });
    expect(await all(db, "places")).toEqual(before.places);
    expect(await all(db, "list_items")).toEqual(before.items);
    expect(await all(db, "place_sources")).toEqual(before.sources);
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
