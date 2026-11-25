import type { UserListRow, UserPlaceRow, VisitNoteRow } from "@magomap/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "./db";
import { fakeServer, pulled } from "./testServer";

const server = fakeServer();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (path: string, init?: RequestInit) => server.fetch(path, init) };
});
const { closeUserDb, defineUserDb, forgetAccountOnDevice, openUserDb } = await import("./db");
const { addVisitNote, editVisitNote } = await import("./writes");
const { startSyncTriggers, syncNow, syncState } = await import("./sync");
const { holdPushes } = await import("./events");

let n = 0;
beforeEach(() => {
  n += 1;
  server.pushes = [];
  server.result = (m) => ({ mutationId: m.mutationId, status: "applied" });
  server.failPush = null;
  server.pullPages = [];
  server.pulls = [];
  server.failPullAt = null;
  server.pullStatus = null;
  server.failCode = "x";
  server.headers = [];
  server.pushGate = null;
  server.pullGate = null;
});
const open = () => openUserDb(`s${n}`);
const note = (id: string, body: string, updatedAt = 5): VisitNoteRow => ({
  id,
  placeId: "p_kakao_1",
  visitedOn: null,
  body,
  origin: "user",
  originKey: null,
  editedByUser: false,
  createdAt: 1,
  updatedAt,
  deletedAt: null,
});

const access = (listId: string, removedAt: number | null = null): UserListRow => ({
  id: `ul_${listId}`,
  listId,
  role: "follower",
  removedAt,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
const saved = (placeId: string): UserPlaceRow => ({
  id: `up_${placeId}`,
  placeId,
  savedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

describe("sync", () => {
  it("empties the outbox for applied changes", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    const res = await syncNow();
    expect(res.pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    expect(syncState().state).toBe("idle");
  });

  it("sends nothing while pushes are held (an undo may still take it back), then sends it", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    const release = holdPushes();
    const held = await syncNow();
    expect(held.pushed).toBe(0);
    expect(server.pushes).toHaveLength(0);
    expect(await db.outbox.count()).toBe(1);
    release();
    // Releasing twice does no harm.
    release();
    expect((await syncNow()).pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it("lets go of a forgotten hold after a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      open();
      await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
      holdPushes();
      vi.setSystemTime(Date.now() + 60_000);
      expect((await syncNow()).pushed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces the local row with the server's on ignored_stale", async () => {
    const db = open();
    const id = await addVisitNote("p_kakao_1", { visitedOn: null, body: "mine" });
    server.result = (m) => ({
      mutationId: m.mutationId,
      status: "ignored_stale",
      row: note(id, "server's", 99),
    });
    await syncNow();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.visit_notes.get(id))?.body).toBe("server's");
  });

  it("moves a rejected change aside with its text", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "keep me" });
    server.result = (m) => ({
      mutationId: m.mutationId,
      status: "rejected",
      reason: "missing_parent",
    });
    const res = await syncNow();
    expect(res.rejected).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    const [r] = await db.rejected.toArray();
    expect(r).toMatchObject({ reason: "missing_parent", row: { body: "keep me" } });
  });

  it("keeps a clock_ahead change unchanged and sends it again later", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    const before = (await db.outbox.toArray())[0] as OutboxEntry;
    server.result = (m) => ({
      mutationId: m.mutationId,
      status: "rejected",
      reason: "clock_ahead",
    });
    await syncNow();
    expect(syncState().state).toBe("clock_ahead");
    const after = (await db.outbox.toArray())[0] as OutboxEntry;
    expect(after.clientUpdatedAt).toBe(before.clientUpdatedAt);
    server.result = (m) => ({ mutationId: m.mutationId, status: "applied" });
    await syncNow();
    expect(server.pushes.at(-1)?.[0]?.mutationId).toBe(before.mutationId);
    expect(await db.outbox.count()).toBe(0);
  });

  it("keeps everything and reports an error on a 500", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    server.failPush = () => 500;
    await syncNow();
    expect(syncState().state).toBe("error");
    expect(await db.outbox.count()).toBe(1);
  });

  it("splits a refused batch until the bad change is isolated", async () => {
    const db = open();
    const ids: string[] = [];
    for (const body of ["1", "2", "3", "4"]) {
      ids.push(await addVisitNote("p_kakao_1", { visitedOn: null, body }));
    }
    const bad = (await db.outbox.toArray())[2]?.mutationId;
    server.failPush = (ms) => (ms.some((m) => m.mutationId === bad) ? 400 : null);
    await syncNow();
    expect(await db.outbox.count()).toBe(0);
    const rejected = await db.rejected.toArray();
    expect(rejected.map((r) => [r.mutationId, r.reason])).toEqual([[bad, "invalid"]]);
    expect(
      server.pushes
        .flat()
        .map((m) => m.id)
        .sort(),
    ).toEqual([ids[0], ids[1], ids[3]].sort());
  });

  it("keeps the outbox and asks to sign in on a 401", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    server.failPush = () => 401;
    await syncNow();
    expect(syncState().state).toBe("needs_signin");
    expect(await db.outbox.count()).toBe(1);
  });

  it("sends every sync request for the account whose database it syncs", async () => {
    open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    const running = syncNow();
    // Another account opens meanwhile: this run still speaks for the first one.
    openUserDb(`other${n}`);
    await running;
    expect(server.headers.length).toBeGreaterThanOrEqual(2);
    for (const h of server.headers) expect(h.get("x-magomap-user")).toBe(`s${n}`);
  });

  it("keeps the outbox and asks to sign in when the session is another account's", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "private" });
    server.failPush = () => 409;
    server.failCode = "account_mismatch";
    await syncNow();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.rejected.count()).toBe(0);
    expect(syncState().state).toBe("needs_signin");
  });

  it("sends a change saved while a slow sync was already under way", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "first" });
    let release = () => {};
    server.pushGate = new Promise((r) => {
      release = r;
    });
    const first = syncNow();
    await vi.waitFor(() => expect(server.headers.length).toBe(1));
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "second" });
    const joined = syncNow();
    release();
    await Promise.all([first, joined]);
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    expect(server.pushes.flat().map((m) => (m.row as { body: string }).body)).toEqual([
      "first",
      "second",
    ]);
  });

  it("tries again by itself after a dropped connection, even if the browser says online", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    let drops = 1;
    server.failPush = () => (drops-- > 0 ? "network" : null);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startSyncTriggers();
    try {
      await vi.waitFor(() => expect(syncState().state).toBe("offline"));
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("runs the new account's sync even while the old account's fails", async () => {
    const a = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "A" });
    let release = () => {};
    server.pushGate = new Promise((r) => {
      release = r;
    });
    server.failCode = "account_mismatch";
    server.failPush = (ms) =>
      ms.some((m) => (m.row as { body: string }).body === "A") ? 409 : null;
    const first = syncNow();
    await vi.waitFor(() => expect(server.headers.length).toBe(1));
    const b = openUserDb(`b${n}`);
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "B" });
    const second = syncNow();
    release();
    await Promise.all([first, second]);
    expect(await b.outbox.count()).toBe(0);
    expect(await a.outbox.count()).toBe(1);
    expect(syncState().state).toBe("idle");
  });

  it("keeps reporting an account's sync after switching away and back", async () => {
    const a = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "A" });
    let release = () => {};
    server.pushGate = new Promise((r) => {
      release = r;
    });
    server.failPush = () => "network";
    const first = syncNow();
    await vi.waitFor(() => expect(server.headers.length).toBe(1));
    openUserDb(`b${n}`);
    expect(openUserDb(`s${n}`)).toBe(a);
    const joined = syncNow();
    release();
    const [r1, r2] = await Promise.all([first, joined]);
    expect(r1.state).toBe("offline");
    expect(r2.state).toBe("offline");
    expect(syncState().state).toBe("offline");
  });

  it("syncs a reopened database on its own, not through the closed one's run", async () => {
    open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "old" });
    let release = () => {};
    server.pushGate = new Promise((r) => {
      release = r;
    });
    const first = syncNow();
    await vi.waitFor(() => expect(server.headers.length).toBe(1));
    closeUserDb();
    const again = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "new" });
    const second = syncNow();
    release();
    await Promise.allSettled([first, second]);
    expect(await again.outbox.count()).toBe(0);
  });

  it("schedules no retry after its triggers are stopped", async () => {
    open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    server.failPush = () => "network";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let pushes = 0;
    const count = server.failPush;
    server.failPush = (ms) => {
      pushes += 1;
      return count(ms);
    };
    try {
      const stop = startSyncTriggers();
      stop();
      await vi.waitFor(() => expect(syncState().state).toBe("offline"));
      await vi.advanceTimersByTimeAsync(700_000);
      expect(pushes).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one retry going when several triggers fail at once", async () => {
    open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    let pushes = 0;
    server.failPush = () => {
      pushes += 1;
      return "network";
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startSyncTriggers();
    try {
      window.dispatchEvent(new Event("online"));
      // The first try failed and its retry is waiting (the state may still say "offline" from
      // an earlier test, so it can't tell).
      const failedTries = async (count: number) =>
        vi.waitFor(() => {
          expect(pushes).toBe(count);
          expect(vi.getTimerCount()).toBe(1);
        });
      await failedTries(1);
      // One chain: the first try, then retries 5 s, 30 s and 2 min apart.
      for (const [wait, count] of [
        [5_000, 2],
        [30_000, 3],
        [120_000, 4],
      ] as const) {
        await vi.advanceTimersByTimeAsync(wait);
        await failedTries(count);
      }
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("reports offline on a network failure", async () => {
    open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    server.failPush = () => "network";
    await syncNow();
    expect(syncState().state).toBe("offline");
  });

  it("stores pulled rows and the cursor, but never over a pending edit", async () => {
    const db = open();
    const id = await addVisitNote("p_kakao_1", { visitedOn: null, body: "local" });
    server.failPush = () => "network";
    await syncNow();
    server.failPush = null;
    server.result = () => {
      throw new Error("no push expected");
    };
    // Pull only: simulate the push still pending by pulling directly.
    const { pullAll } = await import("./sync");
    server.pullPages = [
      {
        rows: [
          pulled("visit_notes", note(id, "server")),
          pulled("place_locations", {
            id: "loc1",
            placeId: "p_kakao_1",
            address: "옛 주소",
            roadAddress: null,
            lat: 33,
            lng: 126,
            validFrom: 0,
            validUntil: 10,
            detectedBy: "import",
            createdAt: 0,
            updatedAt: 0,
            deletedAt: null,
          }),
        ],
        cursor: "c1",
        hasMore: true,
      },
      { rows: [], cursor: "c2", hasMore: false },
    ];
    await pullAll(db);
    expect((await db.visit_notes.get(id))?.body).toBe("local");
    expect(await db.place_locations.count()).toBe(1);
    expect((await db.meta.get("cursor"))?.value).toBe("c2");
    await editVisitNote(id, { body: "local 2" });
  });

  it("pulls everything again once when a new list arrives", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c1", hasMore: true },
      // The full pull, straight away: the rest of the cursor's pages would come again anyway.
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f1", hasMore: true },
      { rows: [pulled("user_lists", access("l_kakao_2"))], cursor: "f2", hasMore: false },
    ];
    await pullAll(db);
    expect(server.pulls).toEqual([
      "/api/sync/pull?cursor=c0",
      "/api/sync/pull",
      "/api/sync/pull?cursor=f1",
    ]);
    expect((await db.meta.get("cursor"))?.value).toBe("f2");
    expect((await db.meta.get("cursorGen"))?.value).toBe(1);
  });

  it("still pulls everything after a pull that brought a new list was cut off", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c1", hasMore: true },
    ];
    server.failPullAt = 2;
    await expect(pullAll(db)).rejects.toThrow();
    expect(await db.user_lists.get("ul_l_kakao_1")).toBeTruthy();
    server.pulls = [];
    server.failPullAt = null;
    await pullAll(db);
    expect(server.pulls).toEqual(["/api/sync/pull"]);
  });

  it("pulls everything again once when a restored list arrives, but not for a new place", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.user_lists.put(access("l_kakao_2", 5));
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_2"))], cursor: "c1", hasMore: false },
    ];
    await pullAll(db);
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=c0", "/api/sync/pull"]);

    server.pulls = [];
    server.pullPages = [
      { rows: [pulled("user_places", saved("p_kakao_9"))], cursor: "c2", hasMore: false },
    ];
    await pullAll(db);
    // A place the user newly has comes with its shared rows (the server re-stamps them).
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=c-end"]);
    expect(await db.user_places.get("up_p_kakao_9")).toBeTruthy();
    expect((await db.meta.get("cursor"))?.value).toBe("c2");
  });

  it("does not pull again for lists and places it already had", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.user_lists.put(access("l_kakao_1"));
    await db.user_places.put(saved("p_kakao_1"));
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [
      {
        rows: [
          pulled("user_lists", access("l_kakao_1", 9)),
          pulled("user_places", saved("p_kakao_1")),
        ],
        cursor: "c1",
        hasMore: false,
      },
    ];
    await pullAll(db);
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=c0"]);
  });

  it("pulls everything once on a device that synced before pulls had an epoch", async () => {
    const db = open();
    // An older app stored this cursor; its lists may lack rows it never re-pulled.
    await db.meta.put({ key: "cursor", value: "c-old" });
    await syncNow();
    expect(server.pulls).toEqual(["/api/sync/pull"]);
    expect((await db.meta.get("pullEpoch"))?.value).toBe(1);
    expect((await db.meta.get("cursorGen"))?.value).toBe(1);

    server.pulls = [];
    await syncNow();
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=c-end"]);
  });

  it("a first sync sets the pull epoch without pulling twice", async () => {
    const db = open();
    await syncNow();
    expect(server.pulls).toEqual(["/api/sync/pull"]);
    expect((await db.meta.get("pullEpoch"))?.value).toBe(1);
    server.pulls = [];
    await syncNow();
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=c-end"]);
  });

  it("a first pull on a new device does not pull twice", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c1", hasMore: false },
    ];
    await pullAll(db);
    expect(server.pulls).toEqual(["/api/sync/pull"]);
  });

  it("never brings removed data back with a pull another tab started before the removal", async () => {
    const userId = `s${n}`;
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    await syncNow();
    // Another tab: its own connection, with a pull on its way.
    const otherTab = defineUserDb(userId);
    let answer = () => {};
    server.pullGate = new Promise((resolve) => {
      answer = resolve;
    });
    server.pullPages = [
      { rows: [pulled("visit_notes", note("n_late", "late"))], cursor: "c9", hasMore: false },
    ];
    const { pullAll } = await import("./sync");
    const sent = server.headers.length;
    const late = pullAll(otherTab).catch((e: unknown) => e);
    await vi.waitFor(() => expect(server.headers.length).toBe(sent + 1));
    expect(await forgetAccountOnDevice(userId)).toBe("removed");
    answer();
    await late;
    expect(await otherTab.visit_notes.count()).toBe(0);
    expect(await otherTab.meta.get("cursor")).toBeUndefined();
    otherTab.close();
    expect(db.hasBeenClosed()).toBe(true);
  });

  it("ignores a late push answer for a change another tab already settled", async () => {
    const userId = `s${n}`;
    const db = open();
    const id = await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    let answer = () => {};
    server.pushGate = new Promise((resolve) => {
      answer = resolve;
    });
    server.result = (m) => ({
      mutationId: m.mutationId,
      status: "ignored_stale",
      row: note(id, "server"),
    });
    // The pull that follows the push would bring the note back too.
    server.pullPages = [
      { rows: [pulled("visit_notes", note(id, "server"))], cursor: "c9", hasMore: false },
    ];
    const late = syncNow();
    await vi.waitFor(() => expect(server.headers.length).toBe(1));
    // Another tab got the answer first, then the data was removed from the device (as
    // forgetAccountOnDevice does: every table emptied, a new removal mark).
    const otherTab = defineUserDb(userId);
    await otherTab.transaction("rw", otherTab.tables, async () => {
      await Promise.all(otherTab.tables.map((table) => table.clear()));
      await otherTab.meta.put({ key: "removal", value: "r1" });
    });
    otherTab.close();
    answer();
    await late;
    expect(await db.visit_notes.count()).toBe(0);
    // Nothing but the removal mark is written back.
    expect(await db.meta.toArray()).toEqual([{ key: "removal", value: "r1" }]);
  });

  it("counts no refusal for a refused change another tab already set aside", async () => {
    const userId = `s${n}`;
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    let answer = () => {};
    server.pushGate = new Promise((resolve) => {
      answer = resolve;
    });
    server.failPush = () => 400;
    const late = syncNow();
    await vi.waitFor(() => expect(server.headers.length).toBe(1));
    // Another tab got the same refusal first and set the change aside.
    const otherTab = defineUserDb(userId);
    await otherTab.outbox.clear();
    otherTab.close();
    answer();
    const result = await late;
    expect(result.rejected).toBe(0);
    expect(await db.rejected.count()).toBe(0);
    expect(server.headers).toHaveLength(2); // the refused push, then the pull
  });

  it("remembers a full download a failed sync left unfinished, until its last page", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    const owed = async () => (await db.meta.get("fullPull")) !== undefined;
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f1", hasMore: true },
    ];
    server.failPullAt = 2;
    await expect(pullAll(db)).rejects.toThrow();
    expect(await owed()).toBe(true);
    // Resumed from its cursor: still owed until the last page is in.
    server.failPullAt = null;
    server.pullPages = [{ rows: [], cursor: "f2", hasMore: false }];
    await pullAll(db);
    expect(await owed()).toBe(false);
  });

  it("remembers the full download a newly added list starts", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c1", hasMore: true },
    ];
    // The restarted, full download fails at once.
    server.failPullAt = 2;
    await expect(pullAll(db)).rejects.toThrow();
    expect(await db.meta.get("fullPull")).toBeDefined();
  });

  it("an ordinary pull from a cursor owes no full download", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [{ rows: [], cursor: "c1", hasMore: true }];
    server.failPullAt = 2;
    await expect(pullAll(db)).rejects.toThrow();
    expect(await db.meta.get("fullPull")).toBeUndefined();
  });

  it("clears the full download when the restarted pull is a single page", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c1", hasMore: false },
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f1", hasMore: false },
    ];
    await pullAll(db);
    expect(await db.meta.get("fullPull")).toBeUndefined();
    expect((await db.meta.get("cursor"))?.value).toBe("f1");
  });

  it("a single-page download of everything never owes one", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c1", hasMore: false },
    ];
    await pullAll(db);
    expect(await db.meta.get("fullPull")).toBeUndefined();
  });

  it("a page that lands after another tab restarted the download doesn't undo the restart", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.user_lists.put(access("l_kakao_1"));
    await db.meta.put({ key: "cursor", value: "c0" });
    let answer = () => {};
    server.pullGate = new Promise((resolve) => {
      answer = resolve;
    });
    server.pullPages = [
      { rows: [], cursor: "c1", hasMore: false },
      { rows: [], cursor: "f1", hasMore: false },
    ];
    const late = pullAll(db);
    await vi.waitFor(() => expect(server.pulls).toHaveLength(1));
    // Another tab gained a list meanwhile: it dropped the cursor and owes a full download.
    await db.meta.delete("cursor");
    await db.meta.put({ key: "fullPull", value: 1 });
    server.pullGate = null;
    answer();
    await late;
    // This tab pulled again from the start, and the full download finished.
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=c0", "/api/sync/pull"]);
    expect((await db.meta.get("cursor"))?.value).toBe("f1");
    expect(await db.meta.get("fullPull")).toBeUndefined();
  });

  it("drops a page another tab overtook, keeping the newer rows it stored", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.meta.put({ key: "cursor", value: "c0" });
    let answer = () => {};
    server.pullGate = new Promise((resolve) => {
      answer = resolve;
    });
    server.pullPages = [
      { rows: [pulled("visit_notes", note("n1", "old", 5))], cursor: "c1", hasMore: false },
      { rows: [], cursor: "c6", hasMore: false },
    ];
    const late = pullAll(db);
    await vi.waitFor(() => expect(server.pulls).toHaveLength(1));
    // Another tab pulled further meanwhile and stored the note's newer version.
    await db.visit_notes.put(note("n1", "new", 9));
    await db.meta.put({ key: "cursor", value: "c5" });
    server.pullGate = null;
    answer();
    await late;
    expect((await db.visit_notes.get("n1"))?.body).toBe("new");
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=c0", "/api/sync/pull?cursor=c5"]);
    expect((await db.meta.get("cursor"))?.value).toBe("c6");
  });

  it("drops a page whose cursor was deleted and reached again by another tab", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.user_lists.put(access("l_kakao_1"));
    await db.meta.put({ key: "cursor", value: "f1" });
    let answer = () => {};
    server.pullGate = new Promise((resolve) => {
      answer = resolve;
    });
    server.pullPages = [
      // The late page: from before the other tab's restart.
      { rows: [pulled("user_lists", access("l_kakao_2"))], cursor: "f2", hasMore: false },
      { rows: [], cursor: "f9", hasMore: false },
    ];
    const late = pullAll(db);
    await vi.waitFor(() => expect(server.pulls).toHaveLength(1));
    // Another tab restarted (the cursor deleted), then its first page brought it back to f1.
    await db.meta.delete("cursor");
    await db.meta.put({ key: "cursorGen", value: 1 });
    await db.meta.put({ key: "cursor", value: "f1" });
    server.pullGate = null;
    answer();
    await late;
    // The late page was dropped: neither its list nor its cursor, and no restart.
    expect(await db.user_lists.get("ul_l_kakao_2")).toBeUndefined();
    expect(server.pulls).toEqual(["/api/sync/pull?cursor=f1", "/api/sync/pull?cursor=f1"]);
    expect((await db.meta.get("cursor"))?.value).toBe("f9");
  });

  it("a download of everything doesn't restart for the lists it brings", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f1", hasMore: true },
      { rows: [pulled("user_lists", access("l_kakao_2"))], cursor: "f2", hasMore: false },
    ];
    await pullAll(db);
    expect(server.pulls).toEqual(["/api/sync/pull", "/api/sync/pull?cursor=f1"]);
    expect((await db.meta.get("cursor"))?.value).toBe("f2");
    expect(await db.meta.get("fullPull")).toBeUndefined();
    expect(await db.meta.get("cursorGen")).toBeUndefined();
  });

  // Issue #21: a list granted after a download of everything began has shared rows older than the
  // positions the download has passed, so it needs a restart; one granted before it began doesn't.
  it("a download of everything restarts for a list granted after it began", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f1", hasMore: true, asOf: 10 },
      // Granted at seq 11, after the pass began at 10.
      {
        rows: [pulled("user_lists", { ...access("l_kakao_2"), seq: 11 })],
        cursor: "f2",
        hasMore: true,
        asOf: 11,
      },
      // The restart: from scratch, and this pass began at 11.
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "g1", hasMore: true, asOf: 11 },
      {
        rows: [pulled("user_lists", { ...access("l_kakao_2"), seq: 11 })],
        cursor: "g2",
        hasMore: false,
        asOf: 11,
      },
    ];
    await pullAll(db);
    expect(server.pulls).toEqual([
      "/api/sync/pull",
      "/api/sync/pull?cursor=f1",
      "/api/sync/pull",
      "/api/sync/pull?cursor=g1",
    ]);
    expect((await db.meta.get("cursor"))?.value).toBe("g2");
    expect(await db.meta.get("fullPull")).toBeUndefined();
  });

  it("a download of everything doesn't restart for a list granted before it began", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    server.pullPages = [
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f1", hasMore: true, asOf: 10 },
      {
        rows: [pulled("user_lists", { ...access("l_kakao_2"), seq: 9 })],
        cursor: "f2",
        hasMore: false,
        asOf: 10,
      },
    ];
    await pullAll(db);
    expect(server.pulls).toEqual(["/api/sync/pull", "/api/sync/pull?cursor=f1"]);
    expect((await db.meta.get("cursorGen"))?.value).toBeUndefined();
  });

  it("restarts for a new list after another tab overtook its download of everything", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    server.pullPages = [
      { rows: [], cursor: "f1", hasMore: true },
      // From f1: overtaken, dropped.
      { rows: [], cursor: "f2", hasMore: false },
      // From the other tab's c30: an ordinary page, with a newly gained list.
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c31", hasMore: false },
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f9", hasMore: false },
    ];
    const held = () => {
      let open = () => {};
      server.pullGate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return open;
    };
    const first = held();
    const late = pullAll(db);
    await vi.waitFor(() => expect(server.pulls).toHaveLength(1));
    // The second request (from f1) waits until the other tab has finished the download.
    const second = held();
    first();
    await vi.waitFor(() => expect(server.pulls).toHaveLength(2));
    await db.meta.put({ key: "cursor", value: "c30" });
    server.pullGate = null;
    second();
    await late;
    expect(server.pulls).toEqual([
      "/api/sync/pull",
      "/api/sync/pull?cursor=f1",
      "/api/sync/pull?cursor=c30",
      "/api/sync/pull",
    ]);
    expect((await db.meta.get("cursor"))?.value).toBe("f9");
  });

  it("restarts for a new list when a pull from scratch was overtaken and goes on from a cursor", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    let answer = () => {};
    server.pullGate = new Promise((resolve) => {
      answer = resolve;
    });
    server.pullPages = [
      { rows: [], cursor: "f1", hasMore: false },
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c10", hasMore: false },
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f2", hasMore: false },
    ];
    const late = pullAll(db);
    await vi.waitFor(() => expect(server.pulls).toHaveLength(1));
    // Another tab finished the full download first.
    await db.meta.put({ key: "cursor", value: "c9" });
    server.pullGate = null;
    answer();
    await late;
    expect(server.pulls).toEqual(["/api/sync/pull", "/api/sync/pull?cursor=c9", "/api/sync/pull"]);
    expect((await db.meta.get("cursor"))?.value).toBe("f2");
  });

  it("restarts again for a list that reaches it after another tab overtook its restart", async () => {
    const db = open();
    const { pullAll } = await import("./sync");
    await db.meta.put({ key: "cursor", value: "c0" });
    server.pullPages = [
      // From c0: a new list, so a restart.
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "c1", hasMore: false },
      // The restarted page: overtaken, dropped.
      { rows: [pulled("user_lists", access("l_kakao_1"))], cursor: "f1", hasMore: false },
      // From the other tab's c30: a list granted after its download.
      { rows: [pulled("user_lists", access("l_kakao_2"))], cursor: "c31", hasMore: false },
      { rows: [pulled("user_lists", access("l_kakao_2"))], cursor: "f9", hasMore: false },
    ];
    const held = () => {
      let open = () => {};
      server.pullGate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return open;
    };
    const first = held();
    const late = pullAll(db);
    await vi.waitFor(() => expect(server.pulls).toHaveLength(1));
    const second = held();
    first();
    await vi.waitFor(() => expect(server.pulls).toHaveLength(2));
    // Another tab finished a download of everything meanwhile.
    await db.meta.put({ key: "cursor", value: "c30" });
    await db.meta.delete("fullPull");
    server.pullGate = null;
    second();
    await late;
    expect(server.pulls).toEqual([
      "/api/sync/pull?cursor=c0",
      "/api/sync/pull",
      "/api/sync/pull?cursor=c30",
      "/api/sync/pull",
    ]);
    expect((await db.meta.get("cursor"))?.value).toBe("f9");
    expect(await db.meta.get("fullPull")).toBeUndefined();
    // Each restart stored the list it was for, so neither restarts again.
    expect(await db.user_lists.get("ul_l_kakao_1")).toBeDefined();
    expect(await db.user_lists.get("ul_l_kakao_2")).toBeDefined();
  });
});
