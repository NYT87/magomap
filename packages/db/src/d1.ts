import { Kysely, type QueryResult } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Db, Statement } from "./core";
import type { Database } from "./schema";

/** Db over a Cloudflare D1 binding. `atomic` uses `d1.batch()`, which D1 runs as one transaction. */
export function dbFromD1(d1: D1Database): Db {
  const kysely = new Kysely<Database>({ dialect: new D1Dialect({ database: d1 }) });
  return {
    kysely,
    dialect: "sqlite",
    async atomic(queries: Statement[]): Promise<QueryResult<unknown>[]> {
      if (queries.length === 0) return [];
      const prepared = queries.map((q) => {
        const compiled = q.compile();
        return d1.prepare(compiled.sql).bind(...(compiled.parameters as unknown[]));
      });
      const results = await d1.batch(prepared);
      return results.map((r) => ({ rows: (r.results ?? []) as unknown[] }));
    },
    async close() {},
  };
}
