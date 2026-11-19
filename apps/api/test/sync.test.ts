import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { signSearchResult } from "../src/search/signing";
import { call, devLogin } from "./helpers";

const T0 = 1_763_000_000_000;
/** Signed at call time (in the Workers runtime the clock reads 0 at module load). */
const signedPlace = () => ({
  id: "p_kakao_42",
  title: "바다정원 카페",
  address: "제주 애월읍",
  roadAddress: null,
  addressSource: "search",
  category: "카페",
  phone: null,
  lat: 33.46,
  lng: 126.31,
  providerSnapshotAt: null,
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  source: {
    provider: "kakao",
    externalId: "42",
    ...signSearchResult(
      "s".repeat(48),
      {
        provider: "kakao",
        externalId: "42",
        title: "바다정원 카페",
        address: "제주 애월읍",
        roadAddress: null,
        category: "카페",
        phone: null,
        lat: 33.46,
        lng: 126.31,
      },
      Date.now(),
    ),
  },
});

const json = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

describe("sync routes", () => {
  it("requires a session", async () => {
    expect((await call("/api/sync/push", json({ mutations: [] }))).status).toBe(401);
    expect((await call("/api/sync/pull")).status).toBe(401);
  });

  it("refuses a request made for a different account than the session's", async () => {
    const cookie = await devLogin("111");
    const me = (await (await call("/api/me", { headers: { cookie } })).json()) as {
      userId: string;
    };
    const as = (user: string) => ({ headers: { cookie, "x-magomap-user": user } });
    const wrong = await call("/api/sync/pull", as("someone-else"));
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toEqual({ error: "account_mismatch" });
    expect((await call("/api/sync/pull", as(me.userId))).status).toBe(200);
    // Who-am-I answers whoever the cookie belongs to.
    expect((await call("/api/me", as("someone-else"))).status).toBe(200);
  });

  it("refuses an account-scoped request that doesn't say which account it acts for", async () => {
    const cookie = await devLogin("111");
    // Straight to the app: the test helper would add the header the way the web app does.
    const res = await app.request(
      "https://magomap.test/api/sync/pull",
      { headers: { cookie } },
      env,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "account_mismatch" });
  });

  it("signs out only the account the page shows", async () => {
    const cookie = await devLogin("111");
    const res = await call("/api/auth/logout", {
      method: "POST",
      headers: { cookie, "x-magomap-user": "someone-else" },
    });
    expect(res.status).toBe(409);
    expect((await call("/api/sync/pull", { headers: { cookie } })).status).toBe(200);
    // Already signed out: still fine.
    expect((await call("/api/auth/logout", { method: "POST" })).status).toBe(204);
  });

  it("signs out everywhere only for the account the page shows", async () => {
    const cookie = await devLogin("111");
    const res = await call("/api/auth/logout-all", {
      method: "POST",
      headers: { cookie, "x-magomap-user": "someone-else" },
    });
    expect(res.status).toBe(409);
    expect((await call("/api/sync/pull", { headers: { cookie } })).status).toBe(200);
  });

  it("rejects a malformed envelope with 400", async () => {
    const cookie = await devLogin("111");
    expect((await call("/api/sync/push", json("not json", cookie))).status).toBe(400);
    expect((await call("/api/sync/push", json({ mutations: [] }, cookie))).status).toBe(400);
  });

  it("rejects a body over 1 MB with 413", async () => {
    const cookie = await devLogin("111");
    const big = {
      mutations: [
        {
          mutationId: "m",
          table: "visit_notes",
          op: "upsert",
          id: "n",
          clientUpdatedAt: 1,
          row: { body: "x".repeat(1_100_000) },
        },
      ],
    };
    expect((await call("/api/sync/push", json(big, cookie))).status).toBe(413);
  });

  it("refuses a place whose location doesn't match its search signature", async () => {
    const cookie = await devLogin("111");
    const tampered = { ...signedPlace(), lat: 37.5 };
    const res = await call(
      "/api/sync/push",
      json(
        {
          mutations: [
            {
              mutationId: "m1",
              table: "places",
              op: "upsert",
              id: "p_kakao_42",
              row: tampered,
              clientUpdatedAt: Date.now(),
            },
          ],
        },
        cookie,
      ),
    );
    expect(await res.json()).toEqual({
      results: [{ mutationId: "m1", status: "rejected", reason: "invalid" }],
    });
  });

  it("round-trips a push and a pull", async () => {
    const cookie = await devLogin("111");
    const push = await call(
      "/api/sync/push",
      json(
        {
          mutations: [
            {
              mutationId: "m1",
              table: "places",
              op: "upsert",
              id: "p_kakao_42",
              row: signedPlace(),
              clientUpdatedAt: Date.now(),
            },
          ],
        },
        cookie,
      ),
    );
    expect(push.status).toBe(200);
    expect(await push.json()).toEqual({ results: [{ mutationId: "m1", status: "applied" }] });
    const pulled = (await (await call("/api/sync/pull", { headers: { cookie } })).json()) as {
      rows: { table: string; row: { id: string } }[];
      hasMore: boolean;
    };
    expect(pulled.rows.map((r) => `${r.table}:${r.row.id}`)).toContain("places:p_kakao_42");
    expect(pulled.hasMore).toBe(false);
  });
});
