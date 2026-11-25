import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KAKAO_FOLDER_FIELDS } from "../../../packages/domain/src/providers/kakaoMapFields";
import { WRITE_DEADLINE_MS, type WritePlace, type WriteResult, writeInPage } from "./writeList";

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
const ok = (extra: object = {}) => ({ status: { code: "SUCCESS" }, ...extra });

interface Call {
  method: string;
  path: string;
  query: string;
  body?: unknown;
  headers?: HeadersInit;
}
let calls: Call[];

/** Stands in for Kakao Map: a fake that answers by path, and records every request. */
function serve(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.search,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: init?.headers,
    };
    calls.push(call);
    expect(init?.credentials).toBe("include");
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const route = routes[`${call.method} ${call.path}`];
    if (!route) throw new Error(`unexpected request ${call.method} ${call.path}`);
    return route(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("window", { location: { origin: "https://map.kakao.com" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const place = (n: number): WritePlace => ({
  key: String(1000 + n),
  title: `장소 ${n}`,
  address: `인천 서구 ${n}`,
  x: 421000 + n,
  y: 1120000 + n,
});
const PAGE_HEADERS = { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" };

describe("writeInPage: create", () => {
  it("sends the request Kakao Map's own page sends and returns the new list's id", async () => {
    serve({
      "POST /folder/add": () =>
        json(ok({ req: { folderid: 25038639, title: "제주 (복사본)", status: "P" } })),
    });
    const result = await writeInPage({ op: "create", name: "제주 (복사본)" });
    expect(result).toEqual({ ok: true, folderId: 25038639 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/folder/add",
      body: { title: "제주 (복사본)", memo: "", out_link: "", icon: 10, status: "P" },
      headers: PAGE_HEADERS,
    });
  });

  it("is unavailable when Kakao answers without a list id, or not SUCCESS, or not ok", async () => {
    for (const answer of [
      () => json(ok({ req: {} })),
      () => json({ status: { code: "FAIL" } }),
      () => json(ok(), { status: 500 }),
    ]) {
      serve({ "POST /folder/add": answer });
      expect(await writeInPage({ op: "create", name: "x" })).toEqual({
        ok: false,
        error: "kakao_unavailable",
      });
    }
  });

  it("is signed out for a redirect, 401, 403 or an answer that isn't JSON", async () => {
    for (const answer of [
      () => json({}, { status: 403 }),
      () => json({}, { status: 401 }),
      () => new Response("<html>login</html>", { status: 200 }),
    ]) {
      serve({ "POST /folder/add": answer });
      expect(await writeInPage({ op: "create", name: "x" })).toEqual({
        ok: false,
        error: "kakao_signed_out",
      });
    }
  });

  it("is unavailable when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    expect(await writeInPage({ op: "create", name: "x" })).toEqual({
      ok: false,
      error: "kakao_unavailable",
    });
  });
});

describe("writeInPage: add", () => {
  /** Her lists: the default one and list 7, hers by her Kakao Map id. */
  const mine = () =>
    json(
      ok({
        folders: [
          { folderid: 0, kakao_map_user_id: "u1" },
          { folderid: 7, kakao_map_user_id: "u1" },
        ],
      }),
    );
  const serveAdd = (routes: Parameters<typeof serve>[0]) =>
    serve({ "GET /folder/list": mine, ...routes });
  const existing = (keys: string[], nextId?: string) =>
    json({
      favorites: keys.map((key, i) => ({ seq: i + 1, key })),
      ...(nextId ? { next_id: nextId } : {}),
    });
  const added = (n: number) =>
    json(
      ok({
        data: Array.from({ length: n }, (_, i) => ({
          status: { code: "SUCCESS" },
          req: { seq: i + 1 },
        })),
      }),
    );

  it("reads the list first and adds only the places that aren't in it, as the page does", async () => {
    serveAdd({
      "GET /favorite/mine/list": () => existing(["1001"]),
      "POST /favorite/add": ({ body }) => added((body as { datas: unknown[] }).datas.length),
    });
    const result = await writeInPage({ op: "add", folderId: 7, places: [place(1), place(2)] });
    expect(result).toEqual({ ok: true, added: 1, skipped: 1 });
    expect(calls.map((c) => c.path).slice(0, 2)).toEqual(["/folder/list", "/favorite/mine/list"]);
    expect(calls[1]?.query).toBe("?folderid=7");
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({
      datas: [
        {
          type: "place",
          key: 1002,
          display1: "장소 2",
          display2: "인천 서구 2",
          x: 421002,
          y: 1120002,
          color: "03",
          memo: "",
          folderid: 7,
        },
      ],
    });
    expect(post?.headers).toEqual(PAGE_HEADERS);
  });

  it("follows the list's pages when reading what is already there", async () => {
    let page = 0;
    serveAdd({
      "GET /favorite/mine/list": ({ query }) => {
        page += 1;
        return query.includes("next_id=p2") ? existing(["1002"]) : existing(["1001"], "p2");
      },
      "POST /favorite/add": () => {
        throw new Error("nothing should be added");
      },
    });
    const result = await writeInPage({ op: "add", folderId: 7, places: [place(1), place(2)] });
    expect(result).toEqual({ ok: true, added: 0, skipped: 2 });
    expect(page).toBe(2);
  });

  it("a second identical call adds nothing", async () => {
    const stored = new Set<string>();
    serveAdd({
      "GET /favorite/mine/list": () => existing([...stored]),
      "POST /favorite/add": ({ body }) => {
        const datas = (body as { datas: { key: number }[] }).datas;
        for (const d of datas) stored.add(String(d.key));
        return added(datas.length);
      },
    });
    const places = [place(1), place(2), place(3)];
    expect(await writeInPage({ op: "add", folderId: 7, places })).toEqual({
      ok: true,
      added: 3,
      skipped: 0,
    });
    expect(await writeInPage({ op: "add", folderId: 7, places })).toEqual({
      ok: true,
      added: 0,
      skipped: 3,
    });
  });

  it("counts a place sent twice once", async () => {
    serveAdd({
      "GET /favorite/mine/list": () => existing([]),
      "POST /favorite/add": ({ body }) => added((body as { datas: unknown[] }).datas.length),
    });
    expect(await writeInPage({ op: "add", folderId: 7, places: [place(1), place(1)] })).toEqual({
      ok: true,
      added: 1,
      skipped: 1,
    });
  });

  it("sends 20 places per request", async () => {
    serveAdd({
      "GET /favorite/mine/list": () => existing([]),
      "POST /favorite/add": ({ body }) => added((body as { datas: unknown[] }).datas.length),
    });
    const places = Array.from({ length: 45 }, (_, i) => place(i));
    expect(await writeInPage({ op: "add", folderId: 7, places })).toEqual({
      ok: true,
      added: 45,
      skipped: 0,
    });
    const sizes = calls
      .filter((c) => c.method === "POST")
      .map((c) => (c.body as { datas: unknown[] }).datas.length);
    expect(sizes).toEqual([20, 20, 5]);
  });

  it("stops at a failed request and says how many were added before it", async () => {
    let post = 0;
    serveAdd({
      "GET /favorite/mine/list": () => existing([]),
      "POST /favorite/add": ({ body }) => {
        post += 1;
        if (post === 2) return json({ status: { code: "FAIL" } }, { status: 500 });
        return added((body as { datas: unknown[] }).datas.length);
      },
    });
    const places = Array.from({ length: 45 }, (_, i) => place(i));
    const result = await writeInPage({ op: "add", folderId: 7, places });
    expect(result).toEqual({ ok: false, error: "kakao_unavailable", added: 20 });
    expect(post).toBe(2);
  });

  it("counts only the places Kakao says it added when a batch is partly refused", async () => {
    serveAdd({
      "GET /favorite/mine/list": () => existing([]),
      "POST /favorite/add": () =>
        json(
          ok({
            data: [{ status: { code: "SUCCESS" } }, { status: { code: "FAIL" } }],
          }),
        ),
    });
    const result = await writeInPage({ op: "add", folderId: 7, places: [place(1), place(2)] });
    expect(result).toEqual({ ok: false, error: "kakao_unavailable", added: 1 });
  });

  it("is signed out when the list can't be read because the login is gone", async () => {
    serveAdd({ "GET /favorite/mine/list": () => json({}, { status: 403 }) });
    expect(await writeInPage({ op: "add", folderId: 7, places: [place(1)] })).toEqual({
      ok: false,
      error: "kakao_signed_out",
      added: 0,
    });
  });

  it("adds only to one of her own lists: a followed, deleted or unknown list is not_found, and nothing is sent", async () => {
    serve({
      "GET /folder/list": () =>
        json(
          ok({
            folders: [
              { folderid: 0, kakao_map_user_id: "u1" },
              { folderid: 8, subscribe: "Y", kakao_map_user_id: "u2" },
              { folderid: 9, status: "D", kakao_map_user_id: "u1" },
            ],
          }),
        ),
    });
    for (const folderId of [8, 9, 10]) {
      calls = [];
      expect(await writeInPage({ op: "add", folderId, places: [place(1)] })).toEqual({
        ok: false,
        error: "not_found",
        added: 0,
      });
      expect(calls.every((c) => c.path === "/folder/list")).toBe(true);
    }
  });

  it("takes her own public list (flagged like a followed one) as hers by its owner id", async () => {
    serve({
      "GET /folder/list": () =>
        json(
          ok({
            folders: [
              { folderid: 0, kakao_map_user_id: "u1" },
              { folderid: 11, subscribe: "Y", kakao_map_user_id: "u1" },
            ],
          }),
        ),
      "GET /favorite/mine/list": () => existing([]),
      "POST /favorite/add": ({ body }) => added((body as { datas: unknown[] }).datas.length),
    });
    expect(await writeInPage({ op: "add", folderId: 11, places: [place(1)] })).toEqual({
      ok: true,
      added: 1,
      skipped: 0,
    });
  });

  it("looks again, briefly, for a list just made that Kakao's list doesn't show yet", async () => {
    let reads = 0;
    serve({
      "GET /folder/list": () => {
        reads += 1;
        return reads < 3
          ? json(ok({ folders: [{ folderid: 0, kakao_map_user_id: "u1" }] }))
          : mine();
      },
      "GET /favorite/mine/list": () => existing([]),
      "POST /favorite/add": ({ body }) => added((body as { datas: unknown[] }).datas.length),
    });
    expect(await writeInPage({ op: "add", folderId: 7, places: [place(1)] })).toEqual({
      ok: true,
      added: 1,
      skipped: 0,
    });
    expect(reads).toBe(3);
  });

  it("is unavailable, sending nothing, when her lists can't be read", async () => {
    serve({ "GET /folder/list": () => json({ status: { code: "FAIL" } }) });
    expect(await writeInPage({ op: "add", folderId: 7, places: [place(1)] })).toEqual({
      ok: false,
      error: "kakao_unavailable",
      added: 0,
    });
    expect(calls.map((c) => c.path)).toEqual(["/folder/list"]);
  });
});

describe("writeInPage: color", () => {
  const fav = (key: string, seq: number, color: string) => ({
    seq,
    key,
    type: "PLACE",
    display1: `이름 ${key}`,
    display2: `주소 ${key}`,
    memo: `메모 ${key}`,
    color,
  });
  /** A list whose favourites live in `store`; /favorite/update changes `store`. */
  const list = (store: ReturnType<typeof fav>[], accept = true) =>
    serve({
      "GET /favorite/mine/list": () => json({ favorites: store }),
      "POST /favorite/update": (call) => {
        const [d] = (call.body as { datas: { seq: number; color: string }[] }).datas;
        const f = store.find((x) => x.seq === d?.seq);
        if (f && accept) f.color = d?.color ?? f.color;
        return json(ok({ data: [{ status: { code: "SUCCESS" } }] }));
      },
    });
  const req = { op: "color", folderId: 5, key: "1002", color: "04" } as const;

  it("reads the list, sends the favourite back with only the colour changed, then reads again", async () => {
    list([fav("1001", 11, "01"), fav("1002", 12, "02")]);
    expect(await writeInPage(req)).toEqual({ ok: true });
    const update = calls.find((c) => c.path === "/favorite/update");
    expect(update?.method).toBe("POST");
    expect(update?.headers).toEqual(PAGE_HEADERS);
    expect(update?.body).toEqual({
      datas: [
        { seq: 12, display1: "이름 1002", display2: "주소 1002", memo: "메모 1002", color: "04" },
      ],
    });
    expect(calls.map((c) => c.path)).toEqual([
      "/favorite/mine/list",
      "/favorite/update",
      "/favorite/mine/list",
    ]);
  });

  it("with the favourite's own seq, a place twice in one list changes only that favourite", async () => {
    list([fav("1002", 11, "01"), fav("1002", 12, "02")]);
    expect(await writeInPage({ ...req, seq: 12 })).toEqual({ ok: true });
    const sent = calls.find((c) => c.path === "/favorite/update")?.body as
      | { datas: { seq: number }[] }
      | undefined;
    expect(sent?.datas[0]?.seq).toBe(12);
  });

  it("a seq that belongs to another place is not found, and nothing is sent", async () => {
    list([fav("1001", 11, "01"), fav("1002", 12, "02")]);
    expect(await writeInPage({ ...req, seq: 11 })).toEqual({ ok: false, error: "not_found" });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
  });

  it("finds the favourite on a later page of the list", async () => {
    serve({
      "GET /favorite/mine/list": (call) =>
        call.query.includes("next_id")
          ? json({ favorites: [fav("1002", 12, "02")] })
          : json({ favorites: [fav("1001", 11, "01")], next_id: "9" }),
      "POST /favorite/update": () => json(ok({ data: [{ status: { code: "SUCCESS" } }] })),
    });
    const r = await writeInPage(req);
    // The fake never changes the colour, so the read-back fails, but the update was for seq 12.
    const sent = calls.find((c) => c.path === "/favorite/update")?.body as
      | { datas: { seq: number }[] }
      | undefined;
    expect(sent?.datas[0]?.seq).toBe(12);
    expect(r.ok).toBe(false);
  });

  it("sends nothing when the favourite's note can't be read as text, so it can't be cleared", async () => {
    list([{ ...fav("1002", 12, "02"), memo: 5 as unknown as string }]);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
  });

  it("sends an empty note when the favourite has none", async () => {
    const noMemo = { ...fav("1002", 12, "02") } as Partial<ReturnType<typeof fav>>;
    delete noMemo.memo;
    list([noMemo as ReturnType<typeof fav>]);
    await writeInPage(req);
    const sent = calls.find((c) => c.path === "/favorite/update")?.body as
      | { datas: { memo: string }[] }
      | undefined;
    expect(sent?.datas[0]?.memo).toBe("");
  });

  it("is not_found, sending nothing, when the place isn't in the list", async () => {
    list([fav("1001", 11, "01")]);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "not_found" });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
  });

  it("is unavailable when the read-back never shows the new colour", async () => {
    list([fav("1002", 12, "02")], false);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
  });

  it("is unavailable when Kakao doesn't say SUCCESS to the update", async () => {
    serve({
      "GET /favorite/mine/list": () => json({ favorites: [fav("1002", 12, "02")] }),
      "POST /favorite/update": () => json({ status: { code: "FAIL" } }),
    });
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
  });

  it("is signed out when the login is gone", async () => {
    serve({ "GET /favorite/mine/list": () => new Response("", { status: 401 }) });
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_signed_out" });
  });
});

describe("writeInPage: note", () => {
  const fav = (key: string, seq: number, memo: string) => ({
    seq,
    key,
    type: "PLACE",
    display1: `이름 ${key}`,
    display2: `주소 ${key}`,
    memo,
    color: "02",
  });
  /** A list whose favourites live in `store`; /favorite/update changes `store`. */
  const list = (store: ReturnType<typeof fav>[], accept = true) =>
    serve({
      "GET /favorite/mine/list": () => json({ favorites: store }),
      "POST /favorite/update": (call) => {
        const [d] = (call.body as { datas: { seq: number; memo: string }[] }).datas;
        const f = store.find((x) => x.seq === d?.seq);
        if (f && accept) f.memo = d?.memo ?? f.memo;
        return json(ok({ data: [{ status: { code: "SUCCESS" } }] }));
      },
    });
  const req = { op: "note", folderId: 5, key: "1002", note: "새 메모\n둘째 줄" } as const;

  it("writes nothing and hands back Kakao's note when it differs from the one magomap knew", async () => {
    list([fav("1002", 12, "아내가 바꾼 메모")]);
    expect(await writeInPage({ ...req, expected: "옛 메모" })).toEqual({
      ok: false,
      error: "note_changed",
      current: "아내가 바꾼 메모",
    });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
  });

  it("writes when Kakao's note is still the one magomap knew (line breaks and edge spaces aside)", async () => {
    list([fav("1002", 12, "옛 메모\r\n둘째 ")]);
    expect(await writeInPage({ ...req, expected: "옛 메모\n둘째" })).toEqual({ ok: true });
  });

  it("treats a missing note and an empty expected note as the same", async () => {
    const empty = { ...fav("1002", 12, "") } as Partial<ReturnType<typeof fav>>;
    delete empty.memo;
    list([empty as ReturnType<typeof fav>]);
    expect(await writeInPage({ ...req, expected: "" })).toEqual({ ok: true });
  });

  it("overwrites the changed note when asked to", async () => {
    list([fav("1002", 12, "아내가 바꾼 메모")]);
    expect(await writeInPage({ ...req, expected: "옛 메모", overwrite: true })).toEqual({
      ok: true,
    });
    const sent = calls.find((c) => c.path === "/favorite/update")?.body as
      | { datas: { memo: string }[] }
      | undefined;
    expect(sent?.datas[0]?.memo).toBe("새 메모\n둘째 줄");
  });

  it("reads the list, sends the favourite back with only the memo changed, then reads again", async () => {
    list([fav("1001", 11, "a"), fav("1002", 12, "옛 메모")]);
    expect(await writeInPage(req)).toEqual({ ok: true });
    const update = calls.find((c) => c.path === "/favorite/update");
    expect(update?.method).toBe("POST");
    expect(update?.headers).toEqual(PAGE_HEADERS);
    expect(update?.body).toEqual({
      datas: [
        {
          seq: 12,
          display1: "이름 1002",
          display2: "주소 1002",
          color: "02",
          memo: "새 메모\n둘째 줄",
        },
      ],
    });
    expect(calls.map((c) => c.path)).toEqual([
      "/favorite/mine/list",
      "/favorite/update",
      "/favorite/mine/list",
    ]);
  });

  it("can clear the note with an empty one", async () => {
    list([fav("1002", 12, "옛 메모")]);
    expect(await writeInPage({ ...req, note: "" })).toEqual({ ok: true });
    const sent = calls.find((c) => c.path === "/favorite/update")?.body as
      | { datas: { memo: string }[] }
      | undefined;
    expect(sent?.datas[0]?.memo).toBe("");
  });

  it("accepts a read-back where Kakao changed only line breaks or edge spaces", async () => {
    serve({
      "GET /favorite/mine/list": () =>
        json({ favorites: [fav("1002", 12, "새 메모\r\n둘째 줄 ")] }),
      "POST /favorite/update": () => json(ok({ data: [{ status: { code: "SUCCESS" } }] })),
    });
    expect(await writeInPage(req)).toEqual({ ok: true });
  });

  it("sends nothing when the title or address can't be read as text", async () => {
    list([{ ...fav("1002", 12, "x"), display1: 5 as unknown as string }]);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
    list([{ ...fav("1002", 12, "x"), display2: null as unknown as string }]);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
  });

  it("sends nothing when the current note can't be read as text", async () => {
    list([{ ...fav("1002", 12, "x"), memo: 5 as unknown as string }]);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
  });

  it("is not_found, sending nothing, when the place isn't in the list", async () => {
    list([fav("1001", 11, "a")]);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "not_found" });
    expect(calls.some((c) => c.path === "/favorite/update")).toBe(false);
  });

  it("is unavailable when the read-back never shows the new note", async () => {
    list([fav("1002", 12, "옛 메모")], false);
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
  });

  it("is unavailable when Kakao doesn't say SUCCESS to the update", async () => {
    serve({
      "GET /favorite/mine/list": () => json({ favorites: [fav("1002", 12, "x")] }),
      "POST /favorite/update": () => json({ status: { code: "FAIL" } }),
    });
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_unavailable" });
  });

  it("is signed out when the login is gone", async () => {
    serve({ "GET /favorite/mine/list": () => new Response("", { status: 401 }) });
    expect(await writeInPage(req)).toEqual({ ok: false, error: "kakao_signed_out" });
  });
});

describe("writeInPage: account", () => {
  const folders = (list: unknown[]) => json(ok({ folders: list }));

  it("returns the folder records trimmed to the fields magomap reads, for the app to decide whose they are", async () => {
    serve({
      "GET /folder/list": () =>
        folders([
          { folderid: 0 },
          {
            folderid: 5,
            map_user_id: "772826870",
            subscribe: 1,
            title: "제주",
            profile_image: "https://example/never-sent.jpg",
            nickname: "jose",
          },
          "not a record",
        ]),
    });
    expect(await writeInPage({ op: "account" })).toEqual({
      ok: true,
      folders: [
        { folderid: 0 },
        { folderid: 5, map_user_id: "772826870", subscribe: 1, title: "제주", nickname: "jose" },
        null,
      ],
    });
  });

  it("keeps exactly the fields the domain's Kakao Map adapter reads", async () => {
    const all = Object.fromEntries(KAKAO_FOLDER_FIELDS.map((field) => [field, "v"]));
    serve({ "GET /folder/list": () => folders([{ ...all, extra: "dropped" }]) });
    const result = await writeInPage({ op: "account" });
    if (!result.ok || !("folders" in result)) throw new Error("expected folders");
    expect(Object.keys(result.folders[0] as object).sort()).toEqual(
      [...KAKAO_FOLDER_FIELDS].sort(),
    );
  });

  it("is signed out when there are no folders at all", async () => {
    serve({ "GET /folder/list": () => folders([]) });
    expect(await writeInPage({ op: "account" })).toEqual({ ok: false, error: "kakao_signed_out" });
  });

  it("is unavailable when Kakao doesn't say SUCCESS, or sends no folder list", async () => {
    for (const answer of [
      () => json({ status: { code: "FAIL" }, folders: [] }),
      () => json(ok({ folders: "nope" })),
      () => json(ok()),
    ]) {
      serve({ "GET /folder/list": answer });
      expect(await writeInPage({ op: "account" })).toEqual({
        ok: false,
        error: "kakao_unavailable",
      });
    }
  });
});

describe("writeInPage: its own deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops by itself before the worker gives up, so a retry can't overlap it", async () => {
    vi.useFakeTimers();
    // A slow Kakao: every request answers after 29 s (under the 30 s limit per request), and
    // honours an abort. Reading the list and five batches would take far longer than the deadline.
    const SLOW = 29_000;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
              const isAdd = new URL(String(input)).pathname === "/favorite/add";
              const size = isAdd
                ? (JSON.parse(String(init?.body)) as { datas: unknown[] }).datas.length
                : 0;
              const isFolders = new URL(String(input)).pathname === "/folder/list";
              resolve(
                isFolders
                  ? json(ok({ folders: [{ folderid: 7 }] }))
                  : isAdd
                    ? json(
                        ok({
                          data: Array.from({ length: size }, () => ({
                            status: { code: "SUCCESS" },
                          })),
                        }),
                      )
                    : json({ favorites: [] }),
              );
            }, SLOW);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new TypeError("aborted"));
            });
          }),
      ),
    );
    let settled = false;
    const places = Array.from({ length: 100 }, (_, i) => place(i));
    const pending = writeInPage({ op: "add", folderId: 7, places }).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // Her lists (29 s), the list's places (58 s) and one batch (87 s) finished; the second batch
    // was cut off at 90 s.
    expect(await pending).toEqual({ ok: false, error: "kakao_unavailable", added: 20 });
  });

  it("sends nothing more once the deadline has passed", async () => {
    vi.useFakeTimers();
    let first = true;
    const fetchMock = vi.fn(async () => {
      if (first) {
        first = false;
        // Her lists answer, but only after the deadline.
        vi.setSystemTime(Date.now() + WRITE_DEADLINE_MS + 1);
        return json(ok({ folders: [{ folderid: 7 }] }));
      }
      return json(ok({ data: [{ status: { code: "SUCCESS" } }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await writeInPage({ op: "add", folderId: 7, places: [place(1)] });
    expect(result).toEqual({ ok: false, error: "kakao_unavailable", added: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("writeInPage: never logs", () => {
  it("writes nothing to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    serve({
      "POST /folder/add": () => json(ok({ req: { folderid: 1 } })),
      "GET /folder/list": () => json(ok({ folders: [] })),
    });
    await writeInPage({ op: "create", name: "비밀 리스트" });
    await writeInPage({ op: "account" });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

// A type check the compiler enforces: every result is one of the documented shapes.
const _shapes: WriteResult[] = [
  { ok: true, folders: [{ folderid: 1 }] },
  { ok: true, folderId: 1 },
  { ok: true, added: 1, skipped: 0 },
  { ok: false, error: "kakao_signed_out" },
  { ok: false, error: "kakao_unavailable", added: 0 },
];
void _shapes;
