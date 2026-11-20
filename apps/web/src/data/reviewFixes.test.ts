// Regression tests for the plan 02 final review.
import type { SearchResult } from "@magomap/domain";
import { placeRowId, userPlaceRowId } from "@magomap/domain/ids";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServer } from "./testServer";

const server = fakeServer();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (path: string, init?: RequestInit) => server.fetch(path, init) };
});
const { closeUserDb, openUserDb } = await import("./db");
const { addVisitNote, editVisitNote, savePlaceFromSearch } = await import("./writes");
const { syncNow } = await import("./sync");
const { dismissRejected, loadRejected } = await import("./queries");

const result = (): SearchResult => ({
  provider: "kakao",
  externalId: "77",
  title: "오래된 결과",
  address: null,
  roadAddress: null,
  category: null,
  phone: null,
  lat: 33.4,
  lng: 126.3,
  signedAt: Date.now(),
  signature: "old",
});

let n = 0;
beforeEach(() => {
  n += 1;
  server.pushes = [];
  server.failPush = null;
  server.pullPages = [];
  server.result = (m) => ({ mutationId: m.mutationId, status: "applied" });
});

describe("refused changes", () => {
  it("lists them newest last without crashing", async () => {
    const db = openUserDb(`rf${n}`);
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "first" });
    await addVisitNote("p_kakao_1", { visitedOn: null, body: "second" });
    server.result = (m) => ({
      mutationId: m.mutationId,
      status: "rejected",
      reason: "missing_parent",
    });
    await syncNow();
    const rows = await loadRejected(db);
    expect(rows.map((r) => (r.row as { body: string }).body)).toEqual(["first", "second"]);
  });

  it("un-saves a place the server refused, and pulls everything again", async () => {
    const db = openUserDb(`rf${n}`);
    await db.meta.put({ key: "cursor", value: "c-old" });
    // Past the one-time full pull, so only the refusal can be what drops the cursor.
    await db.meta.put({ key: "pullEpoch", value: 1 });
    await savePlaceFromSearch(result());
    server.result = (m) => ({ mutationId: m.mutationId, status: "rejected", reason: "invalid" });
    const pulls: string[] = [];
    const fetch = server.fetch;
    server.fetch = async (path, init) => {
      if (path.startsWith("/api/sync/pull")) pulls.push(path);
      return fetch(path, init);
    };
    await syncNow();
    server.fetch = fetch;
    expect(await db.user_places.get(userPlaceRowId(placeRowId("kakao", "77")))).toBeUndefined();
    expect(pulls[0]).toBe("/api/sync/pull");
  });

  it("clears a refused mark once a later change to the same row is saved", async () => {
    const db = openUserDb(`rf${n}`);
    const id = await addVisitNote("p_kakao_1", { visitedOn: null, body: "a" });
    server.result = (m) => ({
      mutationId: m.mutationId,
      status: "rejected",
      reason: "missing_parent",
    });
    await syncNow();
    expect(await db.rejected.count()).toBe(1);
    server.result = (m) => ({ mutationId: m.mutationId, status: "applied" });
    await editVisitNote(id, { body: "b" });
    await syncNow();
    expect(await db.rejected.count()).toBe(0);
  });

  it("can be dismissed, removing a refused note the server never had", async () => {
    const db = openUserDb(`rf${n}`);
    const id = await addVisitNote("p_kakao_1", { visitedOn: null, body: "never stored" });
    server.result = (m) => ({
      mutationId: m.mutationId,
      status: "rejected",
      reason: "missing_parent",
    });
    await syncNow();
    const [entry] = await loadRejected(db);
    await dismissRejected(db, entry?.mutationId ?? "");
    expect(await db.rejected.count()).toBe(0);
    expect(await db.visit_notes.get(id)).toBeUndefined();
  });
});

describe("closing an account's database", () => {
  it("doesn't reopen a database after it was closed for deletion", async () => {
    openUserDb(`rf${n}`);
    closeUserDb();
    expect(() => openUserDb(`rf${n}`).name).not.toThrow();
    closeUserDb();
    const { currentDb } = await import("./db");
    expect(() => currentDb()).toThrow();
  });
});
