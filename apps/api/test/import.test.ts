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
function serveKakaoList(contract = baseContract("111"), extra: Record<string, unknown> = {}) {
  const seen: { auth: string; user: string; url: string }[] = [];
  network.use(
    http.get(`${BASE}/lists`, ({ request }) => {
      const url = new URL(request.url);
      seen.push({
        auth: request.headers.get("authorization") ?? "",
        user: url.searchParams.get("kakaoUserId") ?? "",
        url: url.pathname,
      });
      return HttpResponse.json({ ...listsBody(contract), ...extra });
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

const json = (cookie: string, method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(body),
});
const nameOf = async (cookie: string) =>
  (
    (await (await call("/api/me", { headers: { cookie } })).json()) as {
      displayName: string | null;
    }
  ).displayName;

describe("account nickname from kakao-list", () => {
  it("an import fills an empty nickname from kakao-list", async () => {
    serveKakaoList(baseContract("111"), { ownerNickname: "지은" });
    const cookie = await devLogin("111");
    await start(cookie);
    expect(await nameOf(cookie)).toBe("지은");
  });

  it("a typed nickname survives imports", async () => {
    serveKakaoList(baseContract("111"), { ownerNickname: "지은" });
    const cookie = await devLogin("111");
    expect((await call("/api/me", json(cookie, "PATCH", { displayName: "Jose" }))).status).toBe(
      200,
    );
    await start(cookie);
    expect(await nameOf(cookie)).toBe("Jose");
  });

  it("a cleared nickname is filled again", async () => {
    serveKakaoList(baseContract("111"), { ownerNickname: "지은" });
    const cookie = await devLogin("111");
    await call("/api/me", json(cookie, "PATCH", { displayName: "Jose" }));
    const cleared = await call("/api/me", json(cookie, "PATCH", { displayName: "  " }));
    expect(((await cleared.json()) as { displayName: string | null }).displayName).toBeNull();
    await start(cookie);
    expect(await nameOf(cookie)).toBe("지은");
  });

  it("a nickname kakao-list can't give doesn't stop the import", async () => {
    serveKakaoList(baseContract("222"), { ownerNickname: 42 });
    // An account no other test has named (accounts carry over between tests in this file).
    const cookie = await devLogin("222");
    const { res } = await start(cookie);
    expect(res.status).toBe(200);
    expect(await nameOf(cookie)).toBeNull();
  });
});

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

  it("answers 502 when kakao-list names the same list twice", async () => {
    const cookie = await devLogin("111");
    const body = listsBody(baseContract("111"));
    network.use(
      http.get(`${BASE}/lists`, () =>
        HttpResponse.json({ ...body, lists: [...body.lists, body.lists[0]] }),
      ),
    );
    expect((await start(cookie)).res.status).toBe(502);
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

  it("keeps each person's folder 0 (default favourites) as their own list", async () => {
    const zero = (user: string, seq: string): ReturnType<typeof baseContract> => {
      const c = baseContract(user);
      const [list] = c.lists;
      const [item] = list?.items ?? [];
      if (!list || !item) throw new Error("fixture changed");
      return {
        ...c,
        lists: [{ ...list, kakaoFolderId: 0, items: [{ ...item, favoriteSeq: seq }] }],
      };
    };
    const runAll = async (user: string, seq: string) => {
      const cookie = await devLogin(user);
      const seen = serveKakaoList(zero(user, seq));
      const { body } = await start(cookie);
      expect(body.lists.map((l) => l.externalId)).toEqual([`0~${user}`]);
      const at = `/api/import/runs/${body.runId}/lists/${encodeURIComponent(`0~${user}`)}`;
      expect((await call(`${at}/pages/0`, post(cookie))).status).toBe(200);
      // kakao-list still knows it as folder 0.
      expect(seen.at(-1)).toMatchObject({ user, url: "/api/integrations/magomap/lists/0/items" });
      expect((await call(`${at}/finish`, post(cookie))).status).toBe(200);
      expect((await call(`/api/import/runs/${body.runId}/complete`, post(cookie))).status).toBe(
        200,
      );
      return cookie;
    };
    const first = await runAll("111", "7001");
    await runAll("222", "7002");
    const pulled = JSON.stringify(
      await (await call("/api/sync/pull", { headers: { cookie: first } })).json(),
    );
    expect(pulled).toContain("l_kakao_0%7E111");
    expect(pulled).not.toContain("l_kakao_0%7E222");
    expect(pulled).not.toContain('"l_kakao_0"');
  });
});
