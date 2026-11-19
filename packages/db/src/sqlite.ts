import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Db } from "./core";
import { transactional } from "./postgres";
import type { Database as Schema } from "./schema";

/** Db over a local SQLite file (or ":memory:"), for tests and local tools. Not for the Worker. */
export function dbFromSqliteFile(path: string): Db {
  const kysely = new Kysely<Schema>({
    dialect: new SqliteDialect({ database: new Database(path) }),
  });
  return {
    kysely,
    dialect: "sqlite",
    atomic: (queries) => transactional(kysely, queries),
    close: () => kysely.destroy(),
  };
}
