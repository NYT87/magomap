import type { AnyRow, RowOf, SyncTable } from "@magomap/domain";
import { type RawBuilder, sql } from "kysely";
import type { Db } from "./core";
import type { Database } from "./schema";

export const PER_USER_TABLES: ReadonlySet<SyncTable> = new Set([
  "user_lists",
  "user_places",
  "visit_notes",
  "links",
]);

const BOOLEAN_COLUMNS: Partial<Record<SyncTable, readonly string[]>> = {
  visit_notes: ["edited_by_user"],
};

/** Columns kept on the server: never sent to clients (a list's provider owner account, when a colour or note was last edited here). */
const SERVER_ONLY_COLUMNS: Partial<Record<SyncTable, readonly string[]>> = {
  lists: ["provider_owner_id"],
  list_items: ["color_edited_at", "note_edited_at"],
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export type DbRow<T extends SyncTable> = Database[T];

/**
 * Wire row → database row. Per-user tables get `user_id`; shared tables don't.
 * Wire-only fields (`seq`, a pushed place's `source`) are dropped.
 */
export function toDbRow<T extends SyncTable>(
  table: T,
  row: RowOf<T> | Record<string, unknown>,
  userId: string,
  extra: { clientUpdatedAt: number; seq?: number },
): DbRow<T> {
  const out: Record<string, unknown> = PER_USER_TABLES.has(table) ? { user_id: userId } : {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "seq" || key === "source") continue;
    out[toSnake(key)] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  out.client_updated_at = extra.clientUpdatedAt;
  out.seq = extra.seq ?? 0;
  return out as unknown as DbRow<T>;
}

/** Database row → wire row (drops user_id, client_updated_at and server-only columns; keeps seq). */
export function fromDbRow<T extends SyncTable>(table: T, row: DbRow<T>): RowOf<T> {
  const booleans: readonly string[] = BOOLEAN_COLUMNS[table] ?? [];
  const serverOnly: readonly string[] = SERVER_ONLY_COLUMNS[table] ?? [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as unknown as Record<string, unknown>)) {
    if (key === "user_id" || key === "client_updated_at" || serverOnly.includes(key)) continue;
    out[toCamel(key)] = booleans.includes(key) ? Boolean(value) : value;
  }
  return out as unknown as RowOf<T>;
}

export function toAnyRow(table: SyncTable, row: Record<string, unknown>): AnyRow {
  return fromDbRow(table, row as never) as AnyRow;
}

const MAX_JSON_BYTES = 900_000;
const encoder = new TextEncoder();

/**
 * `column IN (<values>)` with the values bound as JSON parameters, split so each stays well
 * under D1's 1 MB limit (one parameter for normal sizes; OR-ed groups for very large lists).
 */
export function inJson(db: Db, column: string, values: readonly string[]): RawBuilder<boolean> {
  const groups: string[][] = [[]];
  let bytes = 2;
  for (const value of values) {
    const size = encoder.encode(JSON.stringify(value)).length + 1;
    const current = groups[groups.length - 1] as string[];
    if (current.length > 0 && bytes + size > MAX_JSON_BYTES) {
      groups.push([]);
      bytes = 2;
    }
    (groups[groups.length - 1] as string[]).push(value);
    bytes += size;
  }
  const one = (group: string[]) => {
    const payload = JSON.stringify(group);
    return db.dialect === "sqlite"
      ? sql<boolean>`${sql.ref(column)} IN (SELECT value FROM json_each(${payload}))`
      : sql<boolean>`${sql.ref(column)} IN (SELECT jsonb_array_elements_text(${payload}::jsonb))`;
  };
  if (groups.length === 1) return one(groups[0] as string[]);
  return sql<boolean>`(${sql.join(groups.map(one), sql` OR `)})`;
}
