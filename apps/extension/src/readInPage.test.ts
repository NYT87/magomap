import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReadResult, readInPage } from "./readInPage";

type Route = (url: URL) => Response | Promise<Response>;

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const folderList = (folders: unknown[]) => json({ status: { code: "SUCCESS" }, folders });

const favoriteList = (favorites: unknown[]) => json({ status: { code: "SUCCESS" }, favorites });

let requests: URL[];

function serve(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    expect(init?.credentials).toBe("include");
    expect(init?.headers).toBeUndefined();
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const key = url.pathname + (url.searchParams.has("folderid") ? `?${url.searchParams}` : "");
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return route(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal("window", { location: { origin: "https://map.kakao.com" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const expectOk = (result: ReadResult) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result;
};

describe("readInPage", () => {
  it("reads folders then every folder's favourites", async () => {
    serve({
      "/folder/list": () => folderList([{ folderid: 0 }, { folderid: 7, title: "Cafés" }]),
      "/favorite/mine/list?folderid=0": () => favoriteList([{ seq: 1, display1: "A" }]),
      "/favorite/mine/list?folderid=7": () =>
        favoriteList([
          { seq: 2, display1: "B" },
          { seq: 3, display1: "C" },
        ]),
    });

    const result = expectOk(await readInPage());

    expect(requests[0]?.toString()).toBe("https://map.kakao.com/folder/list");
    expect(requests.slice(1).map((url) => url.searchParams.get("folderid"))).toEqual(["0", "7"]);
    expect(result.start.folders).toEqual([{ folderid: 0 }, { folderid: 7, title: "Cafés" }]);
    expect(result.favorites).toEqual({
      "0": [{ seq: 1, display1: "A" }],
      "7": [
        { seq: 2, display1: "B" },
        { seq: 3, display1: "C" },
      ],
    });
  });

  it('skips "D" folders', async () => {
    serve({
      "/folder/list": () =>
        folderList([{ folderid: 0 }, { folderid: 5, status: "D" }, { folderid: 6, status: "O" }]),
      "/favorite/mine/list?folderid=0": () => favoriteList([]),
      "/favorite/mine/list?folderid=6": () => favoriteList([{ seq: 9 }]),
    });

    const result = expectOk(await readInPage());

    expect(requests.map((url) => url.searchParams.get("folderid"))).toEqual([null, "0", "6"]);
    expect(Object.keys(result.favorites).sort()).toEqual(["0", "6"]);
    expect(result.start.counts.map((count) => count.folderid)).toEqual([0, 6]);
    // The raw folder records stay as received, deleted ones included: the server decides.
    expect(result.start.folders).toHaveLength(3);
  });

  it("builds counts with firstDisplay2", async () => {
    serve({
      "/folder/list": () => folderList([{ folderid: 0 }, { folderid: 1 }, { folderid: 2 }]),
      "/favorite/mine/list?folderid=0": () =>
        favoriteList([
          { seq: 1, display2: " Jeju-si " },
          { seq: 2, display2: "Seoul" },
        ]),
      "/favorite/mine/list?folderid=1": () => favoriteList([]),
      "/favorite/mine/list?folderid=2": () => favoriteList([{ seq: 3 }]),
    });

    const result = expectOk(await readInPage());

    expect(result.start.counts).toEqual([
      { folderid: 0, itemCount: 2, firstDisplay2: " Jeju-si " },
      { folderid: 1, itemCount: 0 },
      { folderid: 2, itemCount: 1 },
    ]);
  });

  it("reads a duplicated folder's favourites once and keeps every raw folder record", async () => {
    const fetchMock = serve({
      "/folder/list": () => folderList([{ folderid: 3, title: "Bars" }, { folderid: 3 }]),
      "/favorite/mine/list?folderid=3": () => favoriteList([{ seq: 1 }]),
    });

    const result = expectOk(await readInPage());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.start.folders).toEqual([{ folderid: 3, title: "Bars" }, { folderid: 3 }]);
    expect(result.start.counts).toEqual([{ folderid: 3, itemCount: 1 }]);
  });

  it('reads the "folders" key, and keeps favourites\' lat/lon unchanged', async () => {
    const favourite = {
      seq: 11,
      type: "PLACE",
      key: "12345",
      x: 471350,
      y: -32433,
      lat: 33.37661909,
      lon: 126.87684594,
      memo: "good",
    };
    serve({
      "/folder/list": () =>
        folderList([{ folderid: 0, kakao_map_user_id: "u1", subscribe: "N", nickname: "Me" }]),
      "/favorite/mine/list?folderid=0": () => favoriteList([favourite]),
    });

    const result = expectOk(await readInPage());

    expect(result.start.folders).toEqual([
      { folderid: 0, kakao_map_user_id: "u1", subscribe: "N", nickname: "Me" },
    ]);
    expect(result.favorites["0"]).toEqual([favourite]);
  });

  it("a SUCCESS response with zero folders is kakao_signed_out", async () => {
    serve({ "/folder/list": () => folderList([]) });

    expect(await readInPage()).toEqual({ ok: false, error: "kakao_signed_out" });
    expect(requests).toHaveLength(1);
  });

  it("only deleted folders is kakao_signed_out too", async () => {
    serve({ "/folder/list": () => folderList([{ folderid: 4, status: "D" }]) });

    expect(await readInPage()).toEqual({ ok: false, error: "kakao_signed_out" });
  });

  describe("a non-JSON or 401/403 or redirected response is kakao_signed_out", () => {
    const signedOutResponses: [string, () => Response][] = [
      [
        "an HTML page",
        () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
      ],
      ["401", () => new Response("no", { status: 401 })],
      ["403", () => new Response("<html>forbidden</html>", { status: 403 })],
      [
        "a cross-site redirect to the login page (opaque, with redirect: manual)",
        () => {
          const response = new Response(null, { status: 302 });
          Object.defineProperty(response, "type", { value: "opaqueredirect" });
          Object.defineProperty(response, "status", { value: 0 });
          Object.defineProperty(response, "ok", { value: false });
          return response;
        },
      ],
      [
        "a redirect",
        () => {
          const response = folderList([{ folderid: 0 }]);
          Object.defineProperty(response, "redirected", { value: true });
          return response;
        },
      ],
    ];

    for (const [name, respond] of signedOutResponses) {
      it(`on /folder/list: ${name}`, async () => {
        serve({ "/folder/list": respond });
        expect(await readInPage()).toEqual({ ok: false, error: "kakao_signed_out" });
      });

      it(`on a folder's favourites: ${name}`, async () => {
        serve({
          "/folder/list": () => folderList([{ folderid: 0 }, { folderid: 1 }]),
          "/favorite/mine/list?folderid=0": () => favoriteList([{ seq: 1 }]),
          "/favorite/mine/list?folderid=1": respond,
        });
        expect(await readInPage()).toEqual({ ok: false, error: "kakao_signed_out" });
      });
    }
  });

  describe("a 5xx or network failure on any folder is kakao_unavailable, with no partial result", () => {
    const failures: [string, () => Response][] = [
      ["500", () => new Response("oops", { status: 500 })],
      ["503", () => new Response("busy", { status: 503 })],
      [
        "a network failure",
        () => {
          throw new TypeError("Failed to fetch");
        },
      ],
      ["an unexpected JSON shape", () => json({ status: { code: "SUCCESS" } })],
    ];

    for (const [name, respond] of failures) {
      it(`on /folder/list: ${name}`, async () => {
        serve({ "/folder/list": respond });
        expect(await readInPage()).toEqual({ ok: false, error: "kakao_unavailable" });
      });

      it(`on one folder of several: ${name}`, async () => {
        serve({
          "/folder/list": () => folderList([{ folderid: 0 }, { folderid: 1 }, { folderid: 2 }]),
          "/favorite/mine/list?folderid=0": () => favoriteList([{ seq: 1 }]),
          "/favorite/mine/list?folderid=1": respond,
          "/favorite/mine/list?folderid=2": () => favoriteList([{ seq: 2 }]),
        });
        // Exactly the error, nothing else: no `start`, no `favorites`.
        expect(await readInPage()).toEqual({ ok: false, error: "kakao_unavailable" });
      });
    }
  });

  it("runs at most 4 folder requests at a time", async () => {
    const folders = Array.from({ length: 10 }, (_, index) => ({ folderid: index }));
    let inFlight = 0;
    let maxInFlight = 0;
    const routes: Record<string, Route> = { "/folder/list": () => folderList(folders) };
    for (const { folderid } of folders) {
      routes[`/favorite/mine/list?folderid=${folderid}`] = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return favoriteList([{ seq: folderid }]);
      };
    }
    serve(routes);

    const result = expectOk(await readInPage());

    expect(maxInFlight).toBe(4);
    expect(Object.keys(result.favorites)).toHaveLength(10);
  });

  it("is self-contained, so it still works once serialised into the page", async () => {
    serve({
      "/folder/list": () => folderList([{ folderid: 0 }]),
      "/favorite/mine/list?folderid=0": () => favoriteList([{ seq: 1 }]),
    });
    // chrome.scripting.executeScript serialises `func` and loses its closure. Rebuilding it
    // from its source text, away from this module, fails if it uses anything outside itself.
    const rebuilt = new Function(`return (${readInPage.toString()});`)() as typeof readInPage;

    expect(expectOk(await rebuilt()).favorites).toEqual({ "0": [{ seq: 1 }] });
  });
  it("a request that hangs is aborted after 30 s and reads as kakao_unavailable", async () => {
    vi.useFakeTimers();
    try {
      serve({
        "/folder/list": () => folderList([{ folderid: 0 }, { folderid: 1 }]),
        "/favorite/mine/list?folderid=0": () => favoriteList([{ seq: 1 }]),
        "/favorite/mine/list?folderid=1": () => new Promise<Response>(() => {}),
      });
      // The mocked fetch for folder 1 never answers; only the abort signal can end it.
      const fetchMock = vi.mocked(fetch);
      const real = fetchMock.getMockImplementation();
      fetchMock.mockImplementation((input, init) => {
        const answer = real ? real(input, init) : Promise.reject(new Error("no route"));
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          answer.then(resolve, reject);
        });
      });

      const result = readInPage();
      await vi.advanceTimersByTimeAsync(29_999);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(await result).toEqual({ ok: false, error: "kakao_unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("more than 2000 folder records is kakao_unavailable, before any favourites are read", async () => {
    serve({
      "/folder/list": () =>
        folderList(Array.from({ length: 2001 }, (_, index) => ({ folderid: index }))),
    });

    expect(await readInPage()).toEqual({ ok: false, error: "kakao_unavailable" });
    expect(requests).toHaveLength(1);
  });

  it("2000 folder records is still read", async () => {
    const routes: Record<string, Route> = {
      "/folder/list": () =>
        folderList(Array.from({ length: 2000 }, (_, index) => ({ folderid: index }))),
    };
    for (let index = 0; index < 2000; index += 1) {
      routes[`/favorite/mine/list?folderid=${index}`] = () => favoriteList([]);
    }
    serve(routes);

    expect(expectOk(await readInPage()).start.counts).toHaveLength(2000);
  });

  it("more than 50,000 favourites in all is kakao_unavailable", async () => {
    const many = (count: number) => Array.from({ length: count }, (_, seq) => ({ seq }));
    serve({
      "/folder/list": () => folderList([{ folderid: 0 }, { folderid: 1 }]),
      "/favorite/mine/list?folderid=0": () => favoriteList(many(25_000)),
      "/favorite/mine/list?folderid=1": () => favoriteList(many(25_001)),
    });

    expect(await readInPage()).toEqual({ ok: false, error: "kakao_unavailable" });
  });

  it("exactly 50,000 favourites is still read", async () => {
    const many = (count: number) => Array.from({ length: count }, (_, seq) => ({ seq }));
    serve({
      "/folder/list": () => folderList([{ folderid: 0 }, { folderid: 1 }]),
      "/favorite/mine/list?folderid=0": () => favoriteList(many(25_000)),
      "/favorite/mine/list?folderid=1": () => favoriteList(many(25_000)),
    });

    expect(expectOk(await readInPage()).start.counts.map((count) => count.itemCount)).toEqual([
      25_000, 25_000,
    ]);
  });
});
