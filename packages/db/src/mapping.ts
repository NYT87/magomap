import type { AnyRow, RowOf, SyncTable } from "@magomap/domain";
import { type RawBuilder, sql } from "kysely";
import type { Db } from "./core";
import type { Database } from "./schema";

const BOOLEAN_COLUMNS: Partial<Record<SyncTable, readonly string[]>> = {
  lists: ["subscribed"],
  visit_notes: ["edited_by_user"],
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export type DbRow<T extends SyncTable> = Database[T];

/** Wire row → database row for one user. `seq` and `client_updated_at` are set by the caller. */
export function toDbRow<T extends SyncTable>(
  _table: T,
  row: RowOf<T>,
  userId: string,
  extra: { clientUpdatedAt: number; seq?: number },
): DbRow<T> {
  const out: Record<string, unknown> = { user_id: userId };
  for (const [key, value] of Object.entries(row)) {
    if (key === "seq") continue;
    out[toSnake(key)] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  out.client_updated_at = extra.clientUpdatedAt;
  out.seq = extra.seq ?? 0;
  return out as unknown as DbRow<T>;
}

/** Database row → wire row (drops user_id and client_updated_at, keeps seq). */
export function fromDbRow<T extends SyncTable>(table: T, row: DbRow<T>): RowOf<T> {
  const booleans: readonly string[] = BOOLEAN_COLUMNS[table] ?? [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as unknown as Record<string, unknown>)) {
    if (key === "user_id" || key === "client_updated_at") continue;
    out[toCamel(key)] = booleans.includes(key) ? Boolean(value) : value;
  }
  return out as unknown as RowOf<T>;
}

export function toAnyRow(table: SyncTable, row: Record<string, unknown>): AnyRow {
  return fromDbRow(table, row as never) as AnyRow;
}

/** `column IN (<values>)` with the values bound as ONE JSON parameter (stays under D1's 100-param limit). */
export function inJson(db: Db, column: string, values: readonly string[]): RawBuilder<boolean> {
  const payload = JSON.stringify(values);
  return db.dialect === "sqlite"
    ? sql<boolean>`${sql.ref(column)} IN (SELECT value FROM json_each(${payload}))`
    : sql<boolean>`${sql.ref(column)} IN (SELECT jsonb_array_elements_text(${payload}::jsonb))`;
}
