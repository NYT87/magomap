import {
  type Compilable,
  type CompiledQuery,
  type Insertable,
  type Kysely,
  type QueryResult,
  type RawBuilder,
  sql,
} from "kysely";
import { COLUMN_TYPES } from "./columnTypes";
import type { Database } from "./schema";

export type Statement = Compilable<unknown>;

export interface Db {
  kysely: Kysely<Database>;
  dialect: "sqlite" | "postgres";
  /**
   * Runs all queries all-or-nothing: a D1 batch, or a transaction elsewhere.
   * Every result carries `numAffectedRows`: the rows that statement inserted, updated or deleted.
   */
  atomic(queries: Statement[]): Promise<QueryResult<unknown>[]>;
  /** Releases connections; a no-op for D1. */
  close(): Promise<void>;
}

/** Bound parameters in a compiled statement (D1 allows at most 100). */
export function countParams(query: CompiledQuery): number {
  return query.parameters.length;
}

const MAX_ROWS_PER_STATEMENT = 500;
const MAX_JSON_BYTES = 1_000_000;
const encoder = new TextEncoder();

type Column<T extends keyof Database> = keyof Database[T] & string;

export interface BulkUpsertOptions<T extends keyof Database> {
  conflict: Column<T>[];
  /** Columns set from the incoming row on conflict. */
  update: Column<T>[];
  /** Raw SQL per column, overriding `update`, e.g. `{ lat: sql\`coalesce(excluded.lat, places.lat)\` }`. */
  updateExpr?: Partial<Record<Column<T>, RawBuilder<unknown>>>;
  /** Extra condition on the DO UPDATE. */
  where?: RawBuilder<boolean>;
  /** Only update when the incoming client_updated_at is newer. */
  whereNewer?: boolean;
  /** Insert or update nothing unless this holds (the per-user write check). */
  guard?: RawBuilder<boolean>;
}

/** Splits rows into chunks of at most 500 rows and at most 1 MB of JSON. */
function chunk<R>(rows: R[]): R[][] {
  const chunks: R[][] = [];
  let current: R[] = [];
  let bytes = 2;
  for (const row of rows) {
    const size = encoder.encode(JSON.stringify(row)).length + 1;
    if (
      current.length > 0 &&
      (current.length >= MAX_ROWS_PER_STATEMENT || bytes + size > MAX_JSON_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 2;
    }
    if (size + 2 > MAX_JSON_BYTES) throw new Error("A single row is larger than 1 MB");
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * A multi-row upsert that binds each chunk as one JSON parameter, so it stays within
 * D1's 100-parameter limit: `json_each(?)` on SQLite, `jsonb_to_recordset($1)` on Postgres.
 */
export function bulkUpsertQuery<T extends keyof Database>(
  db: Db,
  table: T,
  rows: Insertable<Database[T]>[],
  opts: BulkUpsertOptions<T>,
): Statement[] {
  if (rows.length === 0) return [];
  const types = COLUMN_TYPES[table] as Record<string, string>;
  const columns = Object.keys(types);
  const tableRef = sql.table(table);
  const columnList = sql.join(columns.map((c) => sql.ref(c)));
  const conflictList = sql.join(opts.conflict.map((c) => sql.ref(c)));

  const assignments = opts.update.map((c) => {
    const expr = opts.updateExpr?.[c] ?? sql`excluded.${sql.ref(c)}`;
    return sql`${sql.ref(c)} = ${expr}`;
  });
  for (const [c, expr] of Object.entries(opts.updateExpr ?? {}) as [
    string,
    RawBuilder<unknown>,
  ][]) {
    if (!opts.update.includes(c as Column<T>)) assignments.push(sql`${sql.ref(c)} = ${expr}`);
  }
  const conditions: RawBuilder<unknown>[] = [];
  if (opts.whereNewer) {
    conditions.push(sql`excluded.client_updated_at > ${sql.raw(table)}.client_updated_at`);
  }
  if (opts.where) conditions.push(opts.where);
  const onConflict =
    assignments.length === 0
      ? sql`ON CONFLICT (${conflictList}) DO NOTHING`
      : sql`ON CONFLICT (${conflictList}) DO UPDATE SET ${sql.join(assignments)}${
          conditions.length > 0 ? sql` WHERE ${sql.join(conditions, sql` AND `)}` : sql``
        }`;

  return chunk(rows).map((part) => {
    const payload = JSON.stringify(
      part.map((row) => normalize(row as Record<string, unknown>, columns)),
    );
    const query =
      db.dialect === "sqlite"
        ? sql`INSERT INTO ${tableRef} (${columnList}) SELECT ${sql.join(
            columns.map((c) => sql`json_extract(value, ${sql.lit(`$.${c}`)})`),
          )} FROM json_each(${payload}) WHERE ${opts.guard ?? sql`true`} ${onConflict}`
        : sql`INSERT INTO ${tableRef} (${columnList}) SELECT ${columnList} FROM jsonb_to_recordset(${payload}::jsonb) AS r(${sql.join(
            columns.map((c) => sql`${sql.ref(c)} ${sql.raw(types[c] as string)}`),
          )}) WHERE ${opts.guard ?? sql`true`} ${onConflict}`;
    return { compile: () => query.compile(db.kysely) };
  });
}

/** Every column present, booleans as 0/1, undefined as null. */
function normalize(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    const value = row[c];
    out[c] = value === undefined ? null : typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  return out;
}
