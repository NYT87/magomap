import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { afterEach, describe } from "vitest";
import type { Db } from "../core";
import { migrate } from "../migrate";
import { dbFromPostgres } from "../postgres";
import { dbFromSqliteFile } from "../sqlite";

export function migrationsDir(dialect: Db["dialect"]): string {
  return fileURLToPath(new URL(`../../migrations/${dialect}`, import.meta.url));
}

/** In CI the Postgres suite must run, never be skipped silently. */
export function requirePostgresInCi(env: Record<string, string | undefined>): void {
  if (env.CI && !env.TEST_DATABASE_URL) {
    throw new Error("CI requires TEST_DATABASE_URL so the Postgres tests run");
  }
}

/** Which migrations `makeDb` applies: all of them, or only up to and including `through`. */
export interface MakeDbOptions {
  through?: string;
}

/**
 * Runs `fn` against in-memory SQLite, and against Postgres when TEST_DATABASE_URL is set
 * (a fresh schema per database). Each `makeDb()` returns a migrated, empty database.
 */
export function forEachDialect(
  name: string,
  fn: (makeDb: (opts?: MakeDbOptions) => Promise<Db>) => void,
): void {
  requirePostgresInCi(process.env);
  const open: Db[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((db) => db.close()));
  });

  describe(`${name} [sqlite]`, () => {
    fn(async (opts = {}) => {
      const db = dbFromSqliteFile(":memory:");
      open.push(db);
      await migrate(db, migrationsDir("sqlite"), opts);
      return db;
    });
  });

  const url = process.env.TEST_DATABASE_URL;
  describe.runIf(Boolean(url))(`${name} [postgres]`, () => {
    fn(async (opts = {}) => {
      const schema = `t_${randomBytes(6).toString("hex")}`;
      const admin = dbFromPostgres(url as string);
      await sql.raw(`CREATE SCHEMA ${schema}`).execute(admin.kysely);
      await admin.close();
      const db = dbFromPostgres(url as string, { searchPath: schema });
      open.push(db);
      await migrate(db, migrationsDir("postgres"), opts);
      return db;
    });
  });
}
