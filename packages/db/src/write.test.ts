import { sql } from "kysely";
import { expect, it } from "vitest";
import type { Db } from "./core";
import { forEachDialect } from "./testing/dbs";
import { WriteConflictError, withWrite } from "./write";

const T0 = 1_763_000_000_000;

const insertUser = (db: Db, id: string, ctx: { guard: ReturnType<typeof sql<boolean>> }) => ({
  compile: () =>
    sql`INSERT INTO users (id, display_name, created_at) SELECT ${id}, NULL, ${T0} WHERE ${ctx.guard}`.compile(
      db.kysely,
    ),
});

const seq = async (db: Db) =>
  Number(
    (await db.kysely.selectFrom("sync_state").select("change_seq").executeTakeFirstOrThrow())
      .change_seq,
  );

forEachDialect("global write check", (makeDb) => {
  it("gives a write the next seq and applies its statements", async () => {
    const db = await makeDb();
    const before = await seq(db);
    const result = await withWrite(db, async (ctx) => {
      expect(ctx.seq).toBe(before + 1);
      return { statements: [insertUser(db, "u1", ctx)], result: "ok" };
    });
    expect(result).toBe("ok");
    expect(await seq(db)).toBe(before + 1);
    expect(await db.kysely.selectFrom("users").selectAll().execute()).toHaveLength(1);
  });

  it("re-decides when another writer committed after the read", async () => {
    const db = await makeDb();
    let decisions = 0;
    let interfered = false;
    const racing: Db = {
      ...db,
      atomic: async (qs) => {
        if (!interfered) {
          interfered = true;
          await withWrite(db, async (ctx) => ({
            statements: [insertUser(db, "other", ctx)],
            result: null,
          }));
        }
        return db.atomic(qs);
      },
    };
    await withWrite(racing, async (ctx) => {
      decisions += 1;
      return { statements: [insertUser(db, `mine-${decisions}`, ctx)], result: null };
    });
    expect(decisions).toBe(2);
    const ids = (await db.kysely.selectFrom("users").select("id").execute())
      .map((u) => u.id)
      .sort();
    expect(ids).toEqual(["mine-2", "other"]);
  });

  it("gives up after five conflicts and writes nothing", async () => {
    const db = await makeDb();
    const alwaysRacing: Db = {
      ...db,
      atomic: async (qs) => {
        await db.kysely
          .updateTable("sync_state")
          .set({ change_seq: sql`change_seq + 1` })
          .execute();
        return db.atomic(qs);
      },
    };
    await expect(
      withWrite(alwaysRacing, async (ctx) => ({
        statements: [insertUser(db, "never", ctx)],
        result: null,
      })),
    ).rejects.toBeInstanceOf(WriteConflictError);
    expect(await db.kysely.selectFrom("users").selectAll().execute()).toHaveLength(0);
  });

  it("writes nothing when the claim guard fails", async () => {
    const db = await makeDb();
    await expect(
      withWrite(
        db,
        async (ctx) => ({ statements: [insertUser(db, "x", ctx)], result: null }),
        sql<boolean>`1 = 0`,
      ),
    ).rejects.toBeInstanceOf(WriteConflictError);
    expect(await db.kysely.selectFrom("users").selectAll().execute()).toHaveLength(0);
  });
});
