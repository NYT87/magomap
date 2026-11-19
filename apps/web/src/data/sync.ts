// Push the outbox, then pull pages; resilient to offline, sign-out, refusals and clock skew.
import type { AnyRow, Mutation, PullResponse, PushResponse, SyncTable } from "@magomap/domain";
import { LIMITS } from "@magomap/domain/limits";
import { ApiError, apiFetch, NetworkError, UnauthorizedError } from "../api/client";
import { currentDb, type MagomapDexie, type OutboxEntry, ROW_TABLES } from "./db";
import { onWrite } from "./events";

export type SyncStateName =
  | "idle"
  | "syncing"
  | "offline"
  | "needs_signin"
  | "error"
  | "clock_ahead";
export interface SyncResult {
  pushed: number;
  pulled: number;
  rejected: number;
}

const MAX_BATCH = LIMITS.pushMutations;
const MAX_BYTES = 900_000;
const BACKOFF = [5_000, 30_000, 120_000, 600_000];

// ---------- state ----------

let state: { state: SyncStateName; lastSyncAt?: number } = { state: "idle" };
const subscribers = new Set<() => void>();

function setState(next: SyncStateName, lastSyncAt?: number) {
  state = { state: next, lastSyncAt: lastSyncAt ?? state.lastSyncAt };
  for (const fn of subscribers) fn();
}

export const syncState = () => state;
export function subscribeSync(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

class Stop extends Error {
  constructor(readonly to: SyncStateName) {
    super(to);
  }
}

function stopFor(error: unknown): Stop {
  if (error instanceof Stop) return error;
  if (error instanceof UnauthorizedError) return new Stop("needs_signin");
  if (error instanceof NetworkError) return new Stop("offline");
  return new Stop("error");
}

// ---------- push ----------

const toMutation = (e: OutboxEntry): Mutation => ({
  mutationId: e.mutationId,
  table: e.table,
  op: e.op,
  id: e.id,
  ...(e.op === "upsert" ? { row: e.row } : {}),
  clientUpdatedAt: e.clientUpdatedAt,
});

const bytes = (m: Mutation) => new TextEncoder().encode(JSON.stringify(m)).length;

/** Batches of at most 200 mutations and 900 KB. */
function batches(entries: OutboxEntry[]): OutboxEntry[][] {
  const out: OutboxEntry[][] = [];
  let cur: OutboxEntry[] = [];
  let size = 0;
  for (const e of entries) {
    const b = bytes(toMutation(e));
    if (cur.length > 0 && (cur.length >= MAX_BATCH || size + b > MAX_BYTES)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += b;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

interface PushTally {
  pushed: number;
  rejected: number;
  clockAhead: boolean;
}

async function applyResults(
  db: MagomapDexie,
  sent: OutboxEntry[],
  res: PushResponse,
  t: PushTally,
) {
  const byId = new Map(sent.map((e) => [e.mutationId, e]));
  await db.transaction(
    "rw",
    [db.outbox, db.rejected, ...ROW_TABLES.map((n) => db.table(n))],
    async () => {
      for (const r of res.results) {
        const e = byId.get(r.mutationId);
        if (!e || e.seq === undefined) continue;
        if (r.status === "rejected" && r.reason === "clock_ahead") {
          // Kept unchanged: accepted once real time catches up with the stamp.
          t.clockAhead = true;
          continue;
        }
        await db.outbox.delete(e.seq);
        if (r.status === "applied") t.pushed += 1;
        else if (r.status === "ignored_stale") {
          t.pushed += 1;
          const pending = await db.outbox.where("[table+id]").equals([e.table, e.id]).count();
          if (r.row && pending === 0) await db.table(e.table).put(r.row);
        } else {
          t.rejected += 1;
          await db.rejected.put({
            mutationId: e.mutationId,
            table: e.table,
            id: e.id,
            op: e.op,
            row: e.row,
            reason: r.reason ?? "invalid",
            at: Date.now(),
          });
        }
      }
    },
  );
}

/** Sends a batch; a 400/413 splits it until the refused change is set aside on its own. */
async function pushBatch(db: MagomapDexie, entries: OutboxEntry[], t: PushTally): Promise<void> {
  let res: PushResponse;
  try {
    res = await apiFetch<PushResponse>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ mutations: entries.map(toMutation) }),
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 413)) {
      if (entries.length === 1) {
        const e = entries[0] as OutboxEntry;
        await db.transaction("rw", db.outbox, db.rejected, async () => {
          if (e.seq !== undefined) await db.outbox.delete(e.seq);
          await db.rejected.put({ ...e, reason: "invalid", at: Date.now() });
        });
        t.rejected += 1;
        return;
      }
      const half = Math.ceil(entries.length / 2);
      await pushBatch(db, entries.slice(0, half), t);
      await pushBatch(db, entries.slice(half), t);
      return;
    }
    throw stopFor(error);
  }
  await applyResults(db, entries, res, t);
}

// ---------- pull ----------

/** Pulls every page; each page's rows and its cursor are stored together. */
export async function pullAll(db: MagomapDexie): Promise<number> {
  let pulled = 0;
  for (;;) {
    const cursor = (await db.meta.get("cursor"))?.value;
    const q = typeof cursor === "string" ? `?cursor=${encodeURIComponent(cursor)}` : "";
    let page: PullResponse;
    try {
      page = await apiFetch<PullResponse>(`/api/sync/pull${q}`);
    } catch (error) {
      throw stopFor(error);
    }
    await db.transaction(
      "rw",
      [db.outbox, db.meta, ...ROW_TABLES.map((n) => db.table(n))],
      async () => {
        const pending = new Set((await db.outbox.toArray()).map((e) => `${e.table}:${e.id}`));
        for (const { table, row } of page.rows as { table: SyncTable; row: AnyRow }[]) {
          // A local change still on its way wins over what the server had.
          if (pending.has(`${table}:${row.id}`)) continue;
          await db.table(table).put(row);
          pulled += 1;
        }
        await db.meta.put({ key: "cursor", value: page.cursor });
      },
    );
    if (!page.hasMore) return pulled;
  }
}

// ---------- syncNow ----------

let running: Promise<SyncResult> | null = null;

async function run(): Promise<SyncResult> {
  let db: MagomapDexie;
  try {
    db = currentDb();
  } catch {
    return { pushed: 0, pulled: 0, rejected: 0 };
  }
  setState("syncing");
  const t: PushTally = { pushed: 0, rejected: 0, clockAhead: false };
  try {
    const entries = await db.outbox.orderBy("seq").toArray();
    for (const batch of batches(entries)) await pushBatch(db, batch, t);
    const pulled = await pullAll(db);
    const now = Date.now();
    await db.meta.put({ key: "lastSyncAt", value: now });
    setState(t.clockAhead ? "clock_ahead" : "idle", now);
    return { pushed: t.pushed, pulled, rejected: t.rejected };
  } catch (error) {
    setState(stopFor(error).to);
    return { pushed: t.pushed, pulled: 0, rejected: t.rejected };
  }
}

/** Runs one sync; a call while one is running joins it. */
export function syncNow(): Promise<SyncResult> {
  if (!running) {
    running = run().finally(() => {
      running = null;
    });
  }
  return running;
}

// ---------- triggers ----------

/** Syncs on start, when back online or visible, 2 s after a write, and retries with backoff. */
export function startSyncTriggers(): () => void {
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const go = async () => {
    clearTimeout(retryTimer);
    await syncNow();
    const s = syncState().state;
    if (s === "error") {
      retryTimer = setTimeout(go, BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
      attempt += 1;
    } else {
      attempt = 0;
      if (s === "clock_ahead") retryTimer = setTimeout(go, 60_000);
    }
  };
  const onOnline = () => void go();
  const onVisible = () => {
    if (document.visibilityState === "visible") void go();
  };
  const offWrite = onWrite(() => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => void go(), 2_000);
  });
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  void go();
  return () => {
    clearTimeout(writeTimer);
    clearTimeout(retryTimer);
    offWrite();
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
