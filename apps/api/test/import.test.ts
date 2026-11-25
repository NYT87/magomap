// The import routes after kakao-list: the Worker no longer fetches anything from kakao-list. What
// stays is shared with the Kakao Map sync (finish a list, complete a run, the latest run); a
// kakao-list run left in the database is closed and read like any other.
import { env } from "cloudflare:workers";
import { dbFromD1 } from "@magomap/db/d1";
import { startImportRun } from "@magomap/db/stores/importRuns";
import { describe, expect, it } from "vitest";
import { call, devLogin } from "./helpers";

const post = (cookie: string, body: unknown = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(body),
});

const userIdOf = async (cookie: string) =>
  ((await (await call("/api/me", { headers: { cookie } })).json()) as { userId: string }).userId;

/** A kakao-list run as one left from before (started, never driven to the end). */
async function kakaoListRun(userId: string) {
  return startImportRun(
    dbFromD1(env.DB),
    userId,
    {
      provider: "kakao",
      source: "kakao_list",
      complete: true,
      subscriptionKnown: true,
      importedAt: "2026-11-19T00:00:00.000Z",
      lists: [{ externalId: "101", name: "제주 카페", followed: false, itemCount: 0 }],
    },
    Date.now(),
  );
}

describe("kakao-list is gone", () => {
  it("the routes that started, continued and fetched a kakao-list import answer 404", async () => {
    const cookie = await devLogin("111");
    const { runId } = await kakaoListRun(await userIdOf(cookie));
    expect((await call("/api/import/runs", post(cookie, { provider: "kakao" }))).status).toBe(404);
    expect((await call("/api/import/status", { headers: { cookie } })).status).toBe(404);
    expect((await call(`/api/import/runs/${runId}/resume`, post(cookie))).status).toBe(404);
    expect((await call(`/api/import/runs/${runId}/lists/101/pages/0`, post(cookie))).status).toBe(
      404,
    );
  });
});

describe("the routes the Kakao Map sync shares", () => {
  it("a kakao-list run left running shows as the latest run, and the usual checks hold", async () => {
    const cookie = await devLogin("111");
    const userId = await userIdOf(cookie);
    const { runId } = await kakaoListRun(userId);
    const latest = (await (
      await call("/api/import/runs/latest", { headers: { cookie } })
    ).json()) as { runId: string; source: string; status: string };
    expect(latest).toMatchObject({ runId, source: "kakao_list", status: "running" });
    // Its one list never got a page: finishing it, or completing the run, is refused.
    const early = await call(`/api/import/runs/${runId}/lists/101/finish`, post(cookie));
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "incomplete" });
    const complete = await call(`/api/import/runs/${runId}/complete`, post(cookie));
    expect(complete.status).toBe(409);
    expect(await complete.json()).toEqual({ error: "incomplete" });
  });

  it("another user's run, or a list that isn't in it, is not found", async () => {
    const owner = await devLogin("111");
    const other = await devLogin("222");
    const { runId } = await kakaoListRun(await userIdOf(owner));
    expect((await call(`/api/import/runs/${runId}/lists/999/finish`, post(owner))).status).toBe(
      404,
    );
    expect((await call(`/api/import/runs/${runId}/lists/101/finish`, post(other))).status).toBe(
      404,
    );
    expect((await call(`/api/import/runs/${runId}/complete`, post(other))).status).toBe(404);
  });
});
