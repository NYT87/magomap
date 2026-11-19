import { describe, expect, it } from "vitest";
import { call, devLogin } from "./helpers";

const T0 = 1_763_000_000_000;
const place = {
  id: "kp_42",
  kakaoPlaceId: "42",
  title: "바다정원 카페",
  address: "제주 애월읍",
  roadAddress: null,
  addressSource: "search",
  category: "카페",
  phone: null,
  lat: 33.46,
  lng: 126.31,
  source: "search",
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
};

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
              id: "kp_42",
              row: place,
              clientUpdatedAt: T0 + 1,
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
    expect(pulled.rows.map((r) => `${r.table}:${r.row.id}`)).toContain("places:kp_42");
    expect(pulled.hasMore).toBe(false);
  });
});
