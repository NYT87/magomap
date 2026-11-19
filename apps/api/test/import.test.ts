import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { baseContract } from "./fixtures/contract";
import { itemsBody, listsBody } from "./fixtures/pages";
import { call, devLogin } from "./helpers";
import { network } from "./msw";

const BASE = "http://localhost:8788/api/integrations/magomap";
const SECRET = `Bearer ${"m".repeat(48)}`;
const post = (cookie: string, body: unknown = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(body),
});

/** A stand-in kakao-list that serves the fixture for any user, checking the secret. */
function serveKakaoList(contract = baseContract("111")) {
  const seen: { auth: string; user: string; url: string }[] = [];
  network.use(
    http.get(`${BASE}/lists`, ({ request }) => {
      const url = new URL(request.url);
      seen.push({
        auth: request.headers.get("authorization") ?? "",
        user: url.searchParams.get("kakaoUserId") ?? "",
        url: url.pathname,
      });
      return HttpResponse.json(listsBody(contract));
    }),
    http.get(`${BASE}/lists/:folderId/items`, ({ request, params }) => {
      const url = new URL(request.url);
      seen.push({
        auth: request.headers.get("authorization") ?? "",
        user: url.searchParams.get("kakaoUserId") ?? "",
        url: url.pathname,
      });
      const body = itemsBody(
        contract,
        Number(params.folderId),
        Number(url.searchParams.get("offset") ?? 0),
      );
      return body
        ? HttpResponse.json(body)
        : HttpResponse.json({ error: "no_snapshot" }, { status: 404 });
    }),
  );
  return seen;
}

async function start(cookie: string) {
  const res = await call("/api/import/runs", post(cookie, { provider: "kakao" }));
  return {
    res,
    body: (await res.json()) as {
      runId: string;
      lists: { externalId: string; itemCount: number }[];
    },
  };
}

describe("server-driven import", () => {
  it("starts a run from the caller's own kakao-list data, sending the secret", async () => {
    const cookie = await devLogin("111");
    const seen = serveKakaoList();
    const { res, body } = await start(cookie);
    expect(res.status).toBe(200);
    expect(body.lists.map((l) => l.externalId)).toEqual(["101", "102", "205"]);
    expect(seen[0]).toMatchObject({ auth: SECRET, user: "111" });
  });

  it("imports a list page by page, then finishes and completes it", async () => {
    const cookie = await devLogin("111");
    const contract = baseContract("111");
    const seen = serveKakaoList({
      ...contract,
      lists: contract.lists.filter((l) => l.kakaoFolderId === 101),
    });
    const { body } = await start(cookie);
    const page = await call(`/api/import/runs/${body.runId}/lists/101/pages/0`, post(cookie));
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ placesAdded: 2, notesImported: 1, done: true });
    expect(seen.at(-1)).toMatchObject({
      auth: SECRET,
      user: "111",
      url: "/api/integrations/magomap/lists/101/items",
    });
    expect(
      (await call(`/api/import/runs/${body.runId}/lists/101/finish`, post(cookie))).status,
    ).toBe(200);
    const done = await call(`/api/import/runs/${body.runId}/complete`, post(cookie));
    expect(await done.json()).toMatchObject({ listsAdded: 1, placesAdded: 2 });
    expect(
      await (await call("/api/import/runs/latest", { headers: { cookie } })).json(),
    ).toMatchObject({ status: "completed" });
  });

  it("answers no_snapshot when kakao-list has nothing for the user", async () => {
    const cookie = await devLogin("111");
    network.use(
      http.get(`${BASE}/lists`, () => HttpResponse.json({ error: "no_snapshot" }, { status: 404 })),
    );
    const { res, body } = await start(cookie);
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "no_snapshot" });
  });

  it("answers 502 for other failures, redirects or a future snapshot", async () => {
    const cookie = await devLogin("111");
    for (const respond of [
      () => HttpResponse.text("boom", { status: 500 }),
      () => new HttpResponse(null, { status: 302, headers: { location: "https://evil.example/" } }),
      () =>
        HttpResponse.json({
          ...listsBody(baseContract("111")),
          importedAt: "2999-01-01T00:00:00.000Z",
        }),
    ]) {
      network.use(http.get(`${BASE}/lists`, respond));
      expect((await start(cookie)).res.status).toBe(502);
    }
  });

  it("refuses a page whose snapshot changed since the run started", async () => {
    const cookie = await devLogin("111");
    serveKakaoList();
    const { body } = await start(cookie);
    network.use(
      http.get(`${BASE}/lists/:folderId/items`, () =>
        HttpResponse.json({
          ...itemsBody(baseContract("111"), 101, 0),
          importedAt: "2026-11-20T00:00:00.000Z",
        }),
      ),
    );
    const res = await call(`/api/import/runs/${body.runId}/lists/101/pages/0`, post(cookie));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "snapshot_changed" });
  });

  it("refuses a list that isn't in the run, another user's run, and a superseded run", async () => {
    const owner = await devLogin("111");
    const other = await devLogin("222");
    serveKakaoList();
    const first = await start(owner);
    expect(
      (await call(`/api/import/runs/${first.body.runId}/lists/999/pages/0`, post(owner))).status,
    ).toBe(404);
    expect(
      (await call(`/api/import/runs/${first.body.runId}/lists/101/pages/0`, post(other))).status,
    ).toBe(404);
    await start(owner);
    const closed = await call(
      `/api/import/runs/${first.body.runId}/lists/101/pages/0`,
      post(owner),
    );
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: "run_closed" });
  });

  it("refuses to finish a list that isn't in the run, or before its pages arrived", async () => {
    const cookie = await devLogin("111");
    serveKakaoList();
    const { body } = await start(cookie);
    const runUrl = `/api/import/runs/${body.runId}`;
    expect((await call(`${runUrl}/lists/999/finish`, post(cookie))).status).toBe(404);
    const early = await call(`${runUrl}/lists/101/finish`, post(cookie));
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "incomplete" });
    const complete = await call(`${runUrl}/complete`, post(cookie));
    expect(complete.status).toBe(409);
    expect(await complete.json()).toEqual({ error: "incomplete" });
  });

  it("refuses a page that skips ahead, or doesn't match the list's summary", async () => {
    const cookie = await devLogin("111");
    serveKakaoList();
    const { body } = await start(cookie);
    const runUrl = `/api/import/runs/${body.runId}`;
    expect((await call(`${runUrl}/lists/101/pages/1`, post(cookie))).status).toBe(404);
    const page = itemsBody(baseContract("111"), 101, 0);
    network.use(
      http.get(`${BASE}/lists/:folderId/items`, () =>
        HttpResponse.json({ ...page, total: (page?.total ?? 0) + 1 }),
      ),
    );
    const grown = await call(`${runUrl}/lists/101/pages/0`, post(cookie));
    expect(grown.status).toBe(409);
    expect(await grown.json()).toEqual({ error: "snapshot_changed" });
    network.use(
      http.get(`${BASE}/lists/:folderId/items`, () =>
        HttpResponse.json({ ...page, items: page?.items.slice(1) }),
      ),
    );
    expect((await call(`${runUrl}/lists/101/pages/0`, post(cookie))).status).toBe(502);
  });

  it("no longer accepts import data from the app", async () => {
    const cookie = await devLogin("111");
    serveKakaoList();
    const { body } = await start(cookie);
    const res = await call(`/api/import/runs/${body.runId}/lists/101/chunks/0`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ meta: { externalId: "101", name: "x", followed: false }, items: [] }),
    });
    expect(res.status).toBe(404);
  });
});
