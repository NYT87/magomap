import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "kysely";
import type { Db } from "./core";

/** Splits a migration file on lines that are exactly `-- statement`. */
export function splitStatements(source: string): string[] {
  return source
    .split(/^-- statement$/m)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^--.*$/gm, "").trim().length > 0);
}

/**
 * Applies `<dir>/*.sql` files not yet recorded in `_migrations`, in name order.
 * Node only (reads files). On D1, `wrangler d1 migrations apply` is used instead.
 * Returns the names applied.
 */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`.execute(
    db.kysely,
  );
  const done = new Set(
    (await sql<{ name: string }>`SELECT name FROM _migrations`.execute(db.kysely)).rows.map(
      (r) => r.name,
    ),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const statements = splitStatements(await readFile(join(dir, file), "utf8"));
    await db.atomic([
      ...statements.map((s) => sql.raw(s)).map((q) => ({ compile: () => q.compile(db.kysely) })),
      {
        compile: () =>
          sql`INSERT INTO _migrations (name, applied_at) VALUES (${file}, ${Date.now()})`.compile(
            db.kysely,
          ),
      },
    ]);
    applied.push(file);
  }
  return applied;
}
