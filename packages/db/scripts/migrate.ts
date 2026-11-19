// Usage: tsx packages/db/scripts/migrate.ts postgres   (uses DATABASE_URL)
//        tsx packages/db/scripts/migrate.ts sqlite <file>
// D1 uses `wrangler d1 migrations apply` with migrations/sqlite instead.
import { fileURLToPath } from "node:url";
import { migrate } from "../src/migrate";
import { dbFromPostgres } from "../src/postgres";
import { dbFromSqliteFile } from "../src/sqlite";

const [dialect, file] = process.argv.slice(2);
const dir = (d: string) => fileURLToPath(new URL(`../migrations/${d}`, import.meta.url));

if (dialect === "postgres") {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL");
  const db = dbFromPostgres(url);
  console.log(await migrate(db, dir("postgres")));
  await db.close();
} else if (dialect === "sqlite" && file) {
  const db = dbFromSqliteFile(file);
  console.log(await migrate(db, dir("sqlite")));
  await db.close();
} else {
  console.error("Usage: migrate.ts postgres | migrate.ts sqlite <file>");
  process.exit(1);
}
