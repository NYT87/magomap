import type { VisitNoteRow } from "@magomap/domain";
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

let n = 0;
beforeEach(() => {
  n += 1;
  server.pushes = [];
  server.result = (m) => ({ mutationId: m.mutationId, status: "applied" });
  server.failPush = null;
  server.pullPages = [];
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

describe("sync", () => {
  it("empties the outbox for applied changes", async () => {
    const db = open();
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    const res = await syncNow();
    expect(res.pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    expect(syncState().state).toBe("idle");
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
      await vi.waitFor(() => expect(syncState().state).toBe("offline"));
      // One chain: the first try, then retries 5 s, 30 s and 2 min apart.
      await vi.advanceTimersByTimeAsync(5_000 + 30_000 + 120_000 + 1_000);
      expect(pushes).toBe(4);
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
    const late = pullAll(otherTab).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
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
    const late = syncNow();
    await new Promise((r) => setTimeout(r, 20));
    // Another tab got the answer first, then the data was removed from the device.
    const otherTab = defineUserDb(userId);
    await otherTab.transaction("rw", otherTab.tables, async () => {
      await Promise.all(otherTab.tables.map((table) => table.clear()));
    });
    otherTab.close();
    answer();
    await late;
    expect(await db.visit_notes.count()).toBe(0);
  });
});
