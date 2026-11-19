import type { SyncTable } from "@magomap/domain";
import { newId } from "@magomap/domain/ids";
import { type RawBuilder, sql } from "kysely";
import { bulkUpsertQuery, type Db, type Statement } from "./core";
import { inJson } from "./mapping";

export type Row = Record<string, unknown> & { id: string };

/** The per-write context: the seq every written row gets, and the guard every statement carries. */
export interface WriteContext {
  seq: number;
  guard: RawBuilder<boolean>;
}

/** Other writers kept committing first; the caller should retry later (503). */
export class WriteConflictError extends Error {
  constructor() {
    super("Too many concurrent writes; try again");
  }
}

const MAX_WRITE_ATTEMPTS = 5;

/**
 * Optimistic global write. Reads `sync_state.change_seq`, lets `decide` pre-read and build
 * statements, then runs one batch that first claims `change_seq + 1` with a fresh token.
 * Every statement must carry `ctx.guard`, so if any other write committed in between, nothing
 * is written and `decide` runs again on fresh data. Every row written gets `seq = ctx.seq`.
 * `claimGuard` adds a condition to the claim (e.g. "this import run is still running").
 * One global counter serializes all writes: cheap at this app's scale, and it makes decisions
 * about shared rows (places, provider lists) safe across users.
 */
export async function withWrite<T>(
  db: Db,
  decide: (ctx: WriteContext) => Promise<{ statements: Statement[]; result: T }>,
  claimGuard?: RawBuilder<boolean>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const state = await db.kysely
      .selectFrom("sync_state")
      .select("change_seq")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    const current = Number(state.change_seq);
    const token = newId();
    const ctx: WriteContext = {
      seq: current + 1,
      guard: sql<boolean>`EXISTS (SELECT 1 FROM sync_state WHERE id = 1 AND write_token = ${token})`,
    };
    const { statements, result } = await decide(ctx);
    if (statements.length === 0) return result;
    const claim = db.kysely
      .updateTable("sync_state")
      .set({ change_seq: current + 1, write_token: token })
      .where("id", "=", 1)
      .where("change_seq", "=", current)
      .where(claimGuard ?? sql<boolean>`true`);
    const check = db.kysely.selectFrom("sync_state").select("write_token").where("id", "=", 1);
    const results = await db.atomic([claim, ...statements, check]);
    const rows = (results.at(-1)?.rows ?? []) as { write_token: string | null }[];
    if (rows[0]?.write_token === token) return result;
  }
  throw new WriteConflictError();
}

export interface TableWriteOptions {
  /** Columns overwritten on conflict (default: every column except the key). */
  update?: string[];
  /** Extra condition on the DO UPDATE. */
  where?: RawBuilder<boolean>;
  /** Only update when the incoming client_updated_at is newer. */
  whereNewer?: boolean;
}

const PER_USER: ReadonlySet<SyncTable> = new Set([
  "user_lists",
  "user_places",
  "visit_notes",
  "links",
]);

/** Upserts of sync rows, each stamped with the write's seq and guarded by the write check. */
export function writeStatements(
  db: Db,
  ctx: WriteContext,
  writes: Map<SyncTable, Map<string, Row>>,
  options: Partial<Record<SyncTable, TableWriteOptions>> = {},
): Statement[] {
  const statements: Statement[] = [];
  for (const [table, byId] of writes) {
    const rows = [...byId.values()].map((r) => ({ ...r, seq: ctx.seq }));
    if (rows.length === 0) continue;
    const key = PER_USER.has(table) ? ["user_id", "id"] : ["id"];
    const opts = options[table] ?? {};
    const update = opts.update
      ? [...opts.update, "seq"]
      : Object.keys(rows[0] as Row).filter((c) => !key.includes(c));
    statements.push(
      ...bulkUpsertQuery(db, table, rows as never[], {
        conflict: key as never[],
        update: update as never[],
        whereNewer: opts.whereNewer ?? false,
        guard: ctx.guard,
        ...(opts.where ? { where: opts.where } : {}),
      }),
    );
  }
  return statements;
}

/**
 * A user just gained access to places or lists that may have been written long ago. Their
 * shared rows are re-stamped with this write's seq, so the user's next pull includes them.
 * (Other users who already have them receive them again: harmless.)
 */
export function grantStatements(
  db: Db,
  ctx: WriteContext,
  grant: { placeIds?: readonly string[]; listIds?: readonly string[] },
): Statement[] {
  const out: Statement[] = [];
  const stamp = { seq: ctx.seq } as never;
  const places = [...new Set(grant.placeIds ?? [])];
  const lists = [...new Set(grant.listIds ?? [])];
  if (places.length > 0) {
    out.push(
      db.kysely
        .updateTable("places")
        .set(stamp)
        .where(inJson(db, "id", places))
        .where(ctx.guard),
      db.kysely
        .updateTable("place_sources")
        .set(stamp)
        .where(inJson(db, "place_id", places))
        .where(ctx.guard),
      db.kysely
        .updateTable("place_locations")
        .set(stamp)
        .where(inJson(db, "place_id", places))
        .where(ctx.guard),
    );
  }
  if (lists.length > 0) {
    out.push(
      db.kysely
        .updateTable("lists")
        .set(stamp)
        .where(inJson(db, "id", lists))
        .where(ctx.guard),
      db.kysely
        .updateTable("list_items")
        .set(stamp)
        .where(inJson(db, "list_id", lists))
        .where(ctx.guard),
    );
    // The list's places come with it.
    const listed = sql`SELECT place_id FROM list_items WHERE ${inJson(db, "list_id", lists)}`;
    out.push(
      db.kysely
        .updateTable("places")
        .set(stamp)
        .where(sql<boolean>`id IN (${listed})`)
        .where(ctx.guard),
      db.kysely
        .updateTable("place_sources")
        .set(stamp)
        .where(sql<boolean>`place_id IN (${listed})`)
        .where(ctx.guard),
      db.kysely
        .updateTable("place_locations")
        .set(stamp)
        .where(sql<boolean>`place_id IN (${listed})`)
        .where(ctx.guard),
    );
  }
  return out;
}
