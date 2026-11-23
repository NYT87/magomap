import { SYNC_TABLES } from "@magomap/domain";
import { sql } from "kysely";
import { expect, it } from "vitest";
import { forEachDialect } from "../testing/dbs";
import { pullPage } from "./sync";
import { addUser, importSnapshot, T0 } from "./testkit";

// Issue #36: a pull must start its walk of each table at the cursor, through the (seq, id)
// index, and test membership per row. It used to build the user's whole place set for every
// table (and start every walk at the first row): about 23,000 rows read per pull to return a few.
forEachDialect("pull query plan", (makeDb) => {
  it("every table is walked from the cursor, through its (seq, id) index", async () => {
    const db = await makeDb();
    if (db.dialect !== "sqlite") return; // EXPLAIN QUERY PLAN is SQLite's
    await addUser(db, "user-a");
    await importSnapshot(
      db,
      "user-a",
      [
        {
          externalId: "1",
          name: "제주",
          followed: false,
          items: [
            {
              externalId: "10",
              placeExternalId: "p1",
              title: "p1",
              lat: 33.4,
              lng: 126.3,
              position: 0,
            },
          ],
        },
      ],
      { at: T0 },
    );
    // Many places that belong to nobody this user can see, then statistics, as in production.
    const filler = sql`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4000)`;
    await sql`${filler} INSERT INTO places (id, title, created_at, updated_at, client_updated_at, seq)
      SELECT 'x' || i, 'x', 0, 0, 0, 1000 + i FROM n`.execute(db.kysely);
    await sql`${filler} INSERT INTO place_sources (id, place_id, provider, external_id, created_at, updated_at, client_updated_at, seq)
      SELECT 'x' || i, 'x' || i, 'kakao', 'x' || i, 0, 0, 0, 1000 + i FROM n`.execute(db.kysely);
    await sql`${filler} INSERT INTO place_locations (id, place_id, valid_from, valid_until, detected_by, created_at, updated_at, client_updated_at, seq)
      SELECT 'x' || i, 'x' || i, 0, 0, 'search', 0, 0, 0, 1000 + i FROM n`.execute(db.kysely);
    await sql`ANALYZE`.execute(db.kysely);

    for (const table of SYNC_TABLES) {
      const compiled = pullPage(table, "user-a", 5000, "x5000", 101).compile(db.kysely);
      // The plan needs the values inline; they are a user id, numbers and a string.
      let i = 0;
      const inlined = compiled.sql.replace(/\?/g, () => {
        const value = compiled.parameters[i++];
        return typeof value === "string" ? `'${value}'` : String(value);
      });
      const { rows } = await sql
        .raw<{ detail: string }>(`EXPLAIN QUERY PLAN ${inlined}`)
        .execute(db.kysely);
      const walk = rows
        .map((r) => r.detail)
        .find((d) => d.includes(` ${table} `) || d.endsWith(` ${table}`));
      expect(walk, `${table}:\n${rows.map((r) => r.detail).join("\n")}`).toMatch(
        /^SEARCH .* USING (COVERING )?INDEX \w+ \(.*\(seq,id\)>\(\?,\?\)\)$/,
      );
    }
  });
});
