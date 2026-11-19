import { Kysely, PostgresDialect, type QueryResult } from "kysely";
import pg from "pg";
import type { Db, Statement } from "./core";
import type { Database } from "./schema";

// BIGINT (int8) arrives as a string by default; magomap's ms timestamps and seq fit in a double.
pg.types.setTypeParser(20, (value: string) => Number(value));

/**
 * Db over Postgres (directly, or through Cloudflare Hyperdrive).
 * On Workers, build one per request and close it in `ctx.waitUntil`.
 */
export function dbFromPostgres(
  connectionString: string,
  options: { searchPath?: string } = {},
): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    ...(options.searchPath ? { options: `-c search_path=${options.searchPath}` } : {}),
  });
  const kysely = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return {
    kysely,
    dialect: "postgres",
    atomic: (queries) => transactional(kysely, queries),
    close: () => kysely.destroy(),
  };
}

export async function transactional(
  kysely: Kysely<Database>,
  queries: Statement[],
): Promise<QueryResult<unknown>[]> {
  if (queries.length === 0) return [];
  return kysely.transaction().execute(async (trx) => {
    const results: QueryResult<unknown>[] = [];
    for (const q of queries) results.push(await trx.executeQuery(q.compile()));
    return results;
  });
}
