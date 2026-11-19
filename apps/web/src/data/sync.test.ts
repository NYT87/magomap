import type { VisitNoteRow } from "@magomap/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "./db";
import { fakeServer, pulled } from "./testServer";

const server = fakeServer();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (path: string, init?: RequestInit) => server.fetch(path, init) };
});
const { openUserDb } = await import("./db");
const { addVisitNote, editVisitNote } = await import("./writes");
const { syncNow, syncState } = await import("./sync");

let n = 0;
beforeEach(() => {
  n += 1;
  server.pushes = [];
  server.result = (m) => ({ mutationId: m.mutationId, status: "applied" });
  server.failPush = null;
  server.pullPages = [];
  server.pullStatus = null;
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
});
