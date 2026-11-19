import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { bulkUpsertQuery, countParams } from "./core";
import { migrate } from "./migrate";
import { forEachDialect, migrationsDir } from "./testing/dbs";

const now = 1_763_000_000_000;

function place(i: number, overrides: Record<string, unknown> = {}) {
  return {
    user_id: "u1",
    id: `kp_${i}`,
    kakao_place_id: String(i),
    title: `장소 ${i}`,
    address: `서울 ${i}`,
    road_address: null,
    address_source: "kakao_import",
    category: null,
    phone: null,
    lat: 37.5 + i / 1e6,
    lng: 127 + i / 1e6,
    source: "kakao_import",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    client_updated_at: now,
    seq: 1,
    ...overrides,
  };
}

function note(i: number, body: string) {
  return {
    user_id: "u1",
    id: `n${i}`,
    place_id: "kp_1",
    visited_on: "2026-11-19",
    body,
    origin: "user",
    origin_key: null,
    edited_by_user: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    client_updated_at: now,
    seq: 1,
  };
}

async function compiled(statements: ReturnType<typeof bulkUpsertQuery>) {
  return statements.map((s) => s.compile());
}

forEachDialect("connector", (makeDb) => {
  it("applies nothing on a second migrate", async () => {
    const db = await makeDb();
    expect(await migrate(db, migrationsDir(db.dialect))).toEqual([]);
  });

  it("rolls back every statement when one fails", async () => {
    const db = await makeDb();
    const insert = (id: string) =>
      db.kysely
        .insertInto("users")
        .values({ id, display_name: null, change_seq: 0, created_at: now });
    await expect(db.atomic([insert("a"), insert("a")])).rejects.toThrow();
    const rows = await db.kysely.selectFrom("users").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("upserts 3,000 places within the parameter and size limits", async () => {
    const db = await makeDb();
    const rows = Array.from({ length: 3000 }, (_, i) => place(i));
    const statements = await compiled(
      bulkUpsertQuery(db, "places", rows, { conflict: ["user_id", "id"], update: ["title"] }),
    );
    expect(statements.length).toBeLessThanOrEqual(10);
    for (const s of statements) {
      expect(countParams(s)).toBeLessThanOrEqual(100);
      for (const p of s.parameters) {
        if (typeof p === "string")
          expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(1_000_000);
      }
    }
    await db.atomic(
      bulkUpsertQuery(db, "places", rows, { conflict: ["user_id", "id"], update: ["title"] }),
    );
    const count = await db.kysely
      .selectFrom("places")
      .select(sql<number>`count(*)`.as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(3000);
  });

  it("splits long Korean notes by bytes", async () => {
    const db = await makeDb();
    const rows = Array.from({ length: 200 }, (_, i) => note(i, "가".repeat(20_000)));
    const statements = await compiled(
      bulkUpsertQuery(db, "visit_notes", rows, { conflict: ["user_id", "id"], update: ["body"] }),
    );
    expect(statements.length).toBeGreaterThan(1);
    for (const s of statements) {
      for (const p of s.parameters) {
        if (typeof p === "string")
          expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(1_000_000);
      }
    }
  });

  it("does not overwrite a newer row with whereNewer", async () => {
    const db = await makeDb();
    const opts = {
      conflict: ["user_id", "id"] as const,
      update: ["title", "client_updated_at"] as const,
      whereNewer: true,
    };
    await db.atomic(
      bulkUpsertQuery(db, "places", [place(1, { title: "new", client_updated_at: now + 10 })], {
        ...opts,
        conflict: [...opts.conflict],
        update: [...opts.update],
      }),
    );
    await db.atomic(
      bulkUpsertQuery(db, "places", [place(1, { title: "old", client_updated_at: now })], {
        ...opts,
        conflict: [...opts.conflict],
        update: [...opts.update],
      }),
    );
    const row = await db.kysely.selectFrom("places").select("title").executeTakeFirstOrThrow();
    expect(row.title).toBe("new");
  });

  it("keeps the existing lat when the incoming one is null, via updateExpr", async () => {
    const db = await makeDb();
    await db.atomic(
      bulkUpsertQuery(db, "places", [place(1)], { conflict: ["user_id", "id"], update: ["lat"] }),
    );
    await db.atomic(
      bulkUpsertQuery(db, "places", [place(1, { lat: null })], {
        conflict: ["user_id", "id"],
        update: ["lat"],
        updateExpr: { lat: sql`coalesce(excluded.lat, places.lat)` },
      }),
    );
    const row = await db.kysely.selectFrom("places").select("lat").executeTakeFirstOrThrow();
    expect(row.lat).toBeCloseTo(37.500001, 6);
  });

  it("returns timestamps and seq as numbers", async () => {
    const db = await makeDb();
    await db.atomic(
      bulkUpsertQuery(db, "places", [place(1, { seq: 42 })], {
        conflict: ["user_id", "id"],
        update: [],
      }),
    );
    const row = await db.kysely
      .selectFrom("places")
      .select(["seq", "created_at"])
      .executeTakeFirstOrThrow();
    expect(typeof row.seq).toBe("number");
    expect(row.seq).toBe(42);
    expect(row.created_at).toBe(now);
  });
});

describe("forEachDialect in CI", () => {
  it("requires TEST_DATABASE_URL when CI is set", async () => {
    const { requirePostgresInCi } = await import("./testing/dbs");
    expect(() => requirePostgresInCi({ CI: "true" })).toThrow(/TEST_DATABASE_URL/);
    expect(() =>
      requirePostgresInCi({ CI: "true", TEST_DATABASE_URL: "postgres://x" }),
    ).not.toThrow();
    expect(() => requirePostgresInCi({})).not.toThrow();
  });
});
