// Push the outbox, then pull pages; resilient to offline, sign-out, refusals and clock skew.
import type { AnyRow, Mutation, PullResponse, PushResponse, SyncTable } from "@magomap/domain";
import { userPlaceRowId } from "@magomap/domain/ids";
import { LIMITS } from "@magomap/domain/limits";
import { ACCOUNT_HEADER, ApiError, apiFetch, NetworkError, UnauthorizedError } from "../api/client";
import { dbUserId, type MagomapDexie, type OutboxEntry, openDbOrNull, ROW_TABLES } from "./db";
import { onWrite } from "./events";

export type SyncStateName =
  | "idle"
  | "syncing"
  | "offline"
  | "needs_signin"
  | "error"
  | "clock_ahead";
export interface SyncResult {
  /** How this account's sync ended (the indicator may be showing another account's). */
  state: SyncStateName;
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
  // Signed in as someone else elsewhere: nothing goes out until this tab follows.
  if (error instanceof ApiError && error.code === "account_mismatch")
    return new Stop("needs_signin");
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

/** Requests made for the database's own account, even if another one opens meanwhile. */
const forDb = (db: MagomapDexie, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), [ACCOUNT_HEADER]: dbUserId(db) },
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
  /** A refusal left local rows out of step: pull everything again. */
  repull: boolean;
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
        if (r.status !== "rejected") {
          // A later change to a row refused before went through: that refusal is history.
          const old = (await db.rejected.toArray()).filter(
            (x) => x.table === e.table && x.id === e.id,
          );
          await db.rejected.bulkDelete(old.map((x) => x.mutationId));
        }
        if (r.status === "applied") t.pushed += 1;
        else if (r.status === "ignored_stale") {
          t.pushed += 1;
          const pending = await db.outbox.where("[table+id]").equals([e.table, e.id]).count();
          if (r.row && pending === 0) await db.table(e.table).put(r.row);
        } else {
          t.rejected += 1;
          t.repull = true;
          const pending = await db.outbox.where("[table+id]").equals([e.table, e.id]).count();
          // A refused save from search isn't saved: drop the local "saved" mark.
          if (e.table === "places" && pending === 0) {
            await db.user_places.delete(userPlaceRowId(e.id));
          }
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
    res = await apiFetch<PushResponse>(
      "/api/sync/push",
      forDb(db, { method: "POST", body: JSON.stringify({ mutations: entries.map(toMutation) }) }),
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 413)) {
      if (entries.length === 1) {
        const e = entries[0] as OutboxEntry;
        await db.transaction("rw", db.outbox, db.rejected, db.user_places, async () => {
          if (e.seq !== undefined) await db.outbox.delete(e.seq);
          await db.rejected.put({ ...e, reason: "invalid", at: Date.now() });
          if (e.table === "places") await db.user_places.delete(userPlaceRowId(e.id));
        });
        t.rejected += 1;
        t.repull = true;
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
  // The account's data removed from this device meanwhile (sign-out in another tab): what comes
  // back from the server is dropped, never written over the emptied tables.
  const removal = (await db.meta.get("removal"))?.value;
  for (;;) {
    const cursor = (await db.meta.get("cursor"))?.value;
    const q = typeof cursor === "string" ? `?cursor=${encodeURIComponent(cursor)}` : "";
    let page: PullResponse;
    try {
      page = await apiFetch<PullResponse>(`/api/sync/pull${q}`, forDb(db));
    } catch (error) {
      throw stopFor(error);
    }
    await db.transaction(
      "rw",
      [db.outbox, db.meta, ...ROW_TABLES.map((n) => db.table(n))],
      async () => {
        if ((await db.meta.get("removal"))?.value !== removal) throw new Stop("needs_signin");
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

async function run(
  db: MagomapDexie,
): Promise<{ result: Omit<SyncResult, "state">; to: SyncStateName }> {
  // Only the open account's sync speaks for the indicator; an old account's ends quietly.
  const report = (to: SyncStateName, at?: number) => {
    if (openDbOrNull() === db) setState(to, at);
  };
  report("syncing");
  const t: PushTally = { pushed: 0, rejected: 0, clockAhead: false, repull: false };
  try {
    const entries = await db.outbox.orderBy("seq").toArray();
    for (const batch of batches(entries)) await pushBatch(db, batch, t);
    // After a refusal, the server's copies come back in full, replacing refused local edits.
    if (t.repull) await db.meta.delete("cursor");
    const pulled = await pullAll(db);
    const now = Date.now();
    await db.meta.put({ key: "lastSyncAt", value: now });
    const to = t.clockAhead ? "clock_ahead" : "idle";
    report(to, now);
    return { result: { pushed: t.pushed, pulled, rejected: t.rejected }, to };
  } catch (error) {
    const { to } = stopFor(error);
    report(to);
    return { result: { pushed: t.pushed, pulled: 0, rejected: t.rejected }, to };
  }
}

/** Each database syncs on its own: one account's (or a closed instance's) run never stands in for another's. */
const runs = new Map<MagomapDexie, { promise: Promise<SyncResult>; again: boolean }>();

/**
 * Syncs the open account. A call while its sync is running joins it, and that run goes round once
 * more, so a change saved after it read the outbox still goes out.
 */
export function syncNow(): Promise<SyncResult> {
  const db = openDbOrNull();
  if (!db) return Promise.resolve({ state: "idle", pushed: 0, pulled: 0, rejected: 0 });
  const existing = runs.get(db);
  if (existing) {
    existing.again = true;
    return existing.promise;
  }
  const entry: { promise: Promise<SyncResult>; again: boolean } = {
    promise: Promise.resolve({ state: "idle", pushed: 0, pulled: 0, rejected: 0 }),
    again: false,
  };
  entry.promise = (async () => {
    const total: SyncResult = { state: "idle", pushed: 0, pulled: 0, rejected: 0 };
    do {
      entry.again = false;
      const r = await run(db);
      total.state = r.to;
      total.pushed += r.result.pushed;
      total.pulled += r.result.pulled;
      total.rejected += r.result.rejected;
    } while (entry.again && (total.state === "idle" || total.state === "clock_ahead"));
    return total;
  })().finally(() => {
    runs.delete(db);
  });
  runs.set(db, entry);
  return entry.promise;
}

// ---------- triggers ----------

/**
 * Syncs on start, when back online or visible, 2 s after a write, and retries errors and dropped
 * connections with backoff.
 */
export function startSyncTriggers(): () => void {
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;
  let waiting: Promise<void> | null = null;

  // One chain of retries: a trigger while a sync is under way joins it and schedules nothing.
  const go = () => {
    if (stopped) return;
    if (waiting) {
      void syncNow();
      return;
    }
    clearTimeout(retryTimer);
    waiting = (async () => {
      // This account's own outcome, not the indicator's, decides the retry.
      const { state: s } = await syncNow();
      if (stopped) return;
      clearTimeout(retryTimer);
      // A dropped connection may come back without an "online" event: keep trying, spaced out.
      if (s === "error" || s === "offline") {
        retryTimer = setTimeout(go, BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
        attempt += 1;
      } else {
        attempt = 0;
        if (s === "clock_ahead") retryTimer = setTimeout(go, 60_000);
      }
    })().finally(() => {
      waiting = null;
    });
  };
  const onOnline = () => go();
  const onVisible = () => {
    if (document.visibilityState === "visible") go();
  };
  const offWrite = onWrite(() => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(go, 2_000);
  });
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  go();
  return () => {
    stopped = true;
    clearTimeout(writeTimer);
    clearTimeout(retryTimer);
    offWrite();
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
