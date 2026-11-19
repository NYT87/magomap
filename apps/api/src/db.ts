import type { Db } from "@magomap/db";
import { dbFromD1 } from "@magomap/db/d1";
import { dbFromPostgres } from "@magomap/db/postgres";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";

// D1 objects are safe to reuse across requests in one isolate; Postgres clients are not.
const d1Cache = new WeakMap<D1Database, Db>();

export function openDb(env: Env): { db: Db; perRequest: boolean } {
  if (env.DB_DRIVER === "postgres") {
    if (!env.HYPERDRIVE) throw new Error("DB_DRIVER=postgres needs the HYPERDRIVE binding");
    return { db: dbFromPostgres(env.HYPERDRIVE.connectionString), perRequest: true };
  }
  if (!env.DB) throw new Error("DB_DRIVER=d1 needs the DB binding");
  let db = d1Cache.get(env.DB);
  if (!db) {
    db = dbFromD1(env.DB);
    d1Cache.set(env.DB, db);
  }
  return { db, perRequest: false };
}

/** Puts the request's Db on the context; a per-request Postgres client is closed afterwards. */
export const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { db, perRequest } = openDb(c.env);
  c.set("db", db);
  try {
    await next();
  } finally {
    if (perRequest) {
      const closing = db.close();
      try {
        c.executionCtx.waitUntil(closing);
      } catch {
        await closing; // no execution context (e.g. app.request in tests)
      }
    }
  }
};
