import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_ORIGINS,
  type ExtensionApi,
  type ExternalListener,
  install,
  READ_TIMEOUT_MS,
  type ReadAnswer,
  type TabInfo,
  type TabUpdatedListener,
  WRITE_TIMEOUT_MS,
} from "./background";
import { allowedOrigins } from "./origins";
import { readInPage } from "./readInPage";
import { WRITE_DEADLINE_MS, writeInPage } from "./writeList";

const MAGOMAP = "https://magomap.jmn8718.workers.dev";

const okRead: ReadAnswer = {
  ok: true,
  start: { folders: [{ folderid: 0 }], counts: [{ folderid: 0, itemCount: 0 }] },
  favorites: { "0": [] },
};

interface Stub {
  api: ExtensionApi;
  click: () => void;
  send: (message: unknown, origin?: string) => Promise<unknown>;
  executeScript: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  fireUpdated: (tabId: number, status: string) => void;
  updatedListenerCount: () => number;
}

function makeStub(options: {
  tabs?: TabInfo[];
  created?: TabInfo;
  read?: () => Promise<unknown>;
  /** Answers an injected `writeInPage`, given the request it was called with. */
  write?: (request: unknown) => Promise<unknown>;
  getStatus?: string;
}): Stub {
  let listener: ExternalListener | undefined;
  let clicked: (() => void) | undefined;
  const updatedListeners = new Set<TabUpdatedListener>();

  const executeScript = vi.fn(async (injection: { func: unknown; args?: unknown[] }) => {
    if (injection.func === writeInPage) {
      return [{ frameId: 0, result: await options.write?.(injection.args?.[0]) }];
    }
    return [{ frameId: 0, result: options.read ? await options.read() : okRead }];
  });
  const query = vi.fn(async () => options.tabs ?? []);
  const create = vi.fn(async () => options.created ?? { id: 99, status: "loading" });
  const remove = vi.fn(async () => {});

  const api: ExtensionApi = {
    runtime: {
      getManifest: () => ({ version: "1.2.3" }),
      onMessageExternal: {
        addListener: (added) => {
          listener = added;
        },
      },
    },
    tabs: {
      query,
      create,
      remove,
      get: async (tabId) => ({ id: tabId, status: options.getStatus ?? "loading" }),
      onUpdated: {
        addListener: (added) => {
          updatedListeners.add(added);
        },
        removeListener: (removed) => {
          updatedListeners.delete(removed);
        },
      },
    },
    action: {
      onClicked: {
        addListener: (added) => {
          clicked = added;
        },
      },
    },
    scripting: { executeScript },
  };

  install(api);

  const send = (message: unknown, origin = MAGOMAP) =>
    new Promise<unknown>((resolve) => {
      if (!listener) throw new Error("no listener installed");
      let answered = false;
      const keepOpen = listener(message, { origin, url: `${origin}/account` }, (response) => {
        answered = true;
        resolve(response);
      });
      if (keepOpen !== true && !answered) resolve(undefined);
    });

  return {
    api,
    click: () => clicked?.(),
    send,
    executeScript,
    query,
    create,
    remove,
    fireUpdated: (tabId, status) => {
      for (const updated of [...updatedListeners]) updated(tabId, { status });
    },
    updatedListenerCount: () => updatedListeners.size,
  };
}

describe("the toolbar button", () => {
  it("opens magomap's Account page", () => {
    const stub = makeStub({});
    stub.click();
    expect(stub.create).toHaveBeenCalledWith({ url: `${MAGOMAP}/account`, active: true });
  });
});

describe("background", () => {
  it("ping answers", async () => {
    const stub = makeStub({});

    expect(await stub.send({ type: "magomap.ping" })).toEqual({ ok: true, version: "1.2.3" });
  });

  it("read uses the most recent map.kakao.com tab", async () => {
    const stub = makeStub({
      tabs: [
        { id: 1, status: "complete", lastAccessed: 100 },
        { id: 2, status: "complete", lastAccessed: 300 },
        { id: 3, status: "complete", lastAccessed: 200 },
      ],
    });

    expect(await stub.send({ type: "magomap.read" })).toEqual(okRead);

    expect(stub.query).toHaveBeenCalledWith({ url: "https://map.kakao.com/*" });
    expect(stub.create).not.toHaveBeenCalled();
    expect(stub.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      world: "MAIN",
      func: readInPage,
    });
    expect(stub.remove).not.toHaveBeenCalled();
  });

  it("read opens a background tab when none is open and waits for it to load", async () => {
    const stub = makeStub({ tabs: [], created: { id: 42, status: "loading" } });

    const answer = stub.send({ type: "magomap.read" });
    await vi.waitFor(() => expect(stub.create).toHaveBeenCalled());
    // Still loading: nothing runs in the tab yet.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stub.executeScript).not.toHaveBeenCalled();

    stub.fireUpdated(7, "complete"); // another tab
    stub.fireUpdated(42, "loading");
    expect(stub.executeScript).not.toHaveBeenCalled();
    stub.fireUpdated(42, "complete");

    expect(await answer).toEqual(okRead);
    expect(stub.create).toHaveBeenCalledWith({ url: "https://map.kakao.com/", active: false });
    expect(stub.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      world: "MAIN",
      func: readInPage,
    });
    // The tab it opened is closed again; she never saw it.
    expect(stub.remove).toHaveBeenCalledWith(42);
  });

  it("read doesn't wait for a tab that finished loading before it started listening", async () => {
    const stub = makeStub({
      tabs: [],
      created: { id: 42, status: "loading" },
      getStatus: "complete",
    });

    expect(await stub.send({ type: "magomap.read" })).toEqual(okRead);
  });

  it("a second read while one runs answers busy", async () => {
    let finish: (value: unknown) => void = () => {};
    const stub = makeStub({
      tabs: [{ id: 1, status: "complete", lastAccessed: 1 }],
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });

    const first = stub.send({ type: "magomap.read" });
    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());

    expect(await stub.send({ type: "magomap.read" })).toEqual({ ok: false, error: "busy" });

    finish(okRead);
    expect(await first).toEqual(okRead);
    // Once it is done, a new read can start.
    finish = () => {};
    const third = stub.send({ type: "magomap.read" });
    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalledTimes(2));
    finish(okRead);
    expect(await third).toEqual(okRead);
  });

  it("a failed injection is kakao_unavailable", async () => {
    const stub = makeStub({
      tabs: [{ id: 1, status: "complete", lastAccessed: 1 }],
      read: () => Promise.reject(new Error("Cannot access contents of the page")),
    });

    expect(await stub.send({ type: "magomap.read" })).toEqual({
      ok: false,
      error: "kakao_unavailable",
    });
  });

  it("passes the reader's own error through", async () => {
    const stub = makeStub({
      tabs: [{ id: 1, status: "complete", lastAccessed: 1 }],
      read: async () => ({ ok: false, error: "kakao_signed_out" }),
    });

    expect(await stub.send({ type: "magomap.read" })).toEqual({
      ok: false,
      error: "kakao_signed_out",
    });
  });

  it("messages from other origins are ignored", async () => {
    const stub = makeStub({ tabs: [{ id: 1, status: "complete", lastAccessed: 1 }] });

    for (const origin of [
      // The release build doesn't answer local dev servers (tests run as the release build).
      "http://localhost:5173",
      "http://localhost:8787",
      "https://evil.example",
      "https://magomap.jmn8718.workers.dev.evil.example",
      "http://magomap.jmn8718.workers.dev",
      "http://localhost:3000",
    ]) {
      expect(await stub.send({ type: "magomap.ping" }, origin)).toBeUndefined();
      expect(await stub.send({ type: "magomap.read" }, origin)).toBeUndefined();
    }
    expect(stub.query).not.toHaveBeenCalled();
    expect(stub.executeScript).not.toHaveBeenCalled();

    for (const origin of ALLOWED_ORIGINS) {
      expect(await stub.send({ type: "magomap.ping" }, origin)).toEqual({
        ok: true,
        version: "1.2.3",
      });
    }
  });

  it("unknown messages get no answer", async () => {
    const stub = makeStub({});

    expect(await stub.send({ type: "magomap.write" })).toBeUndefined();
    expect(await stub.send("magomap.ping")).toBeUndefined();
    expect(await stub.send(null)).toBeUndefined();
  });

  it("checks sender.origin against the same list as externally_connectable", () => {
    // manifest.json carries no list of its own: vite.config.ts writes
    // externally_connectable from origins.ts, the list ALLOWED_ORIGINS comes from.
    // dist.test.ts checks both built manifests against it.
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as { externally_connectable?: unknown; permissions?: string[] };

    expect(manifest.externally_connectable).toBeUndefined();
    expect(ALLOWED_ORIGINS).toEqual(allowedOrigins(false));
    expect(ALLOWED_ORIGINS).toEqual(["https://magomap.jmn8718.workers.dev"]);
  });

  it("skips map.kakao.com tabs that Memory Saver discarded", async () => {
    const stub = makeStub({
      tabs: [
        { id: 1, status: "unloaded", discarded: true, lastAccessed: 500 },
        { id: 2, status: "unloaded", lastAccessed: 400 },
        { id: 3, status: "complete", lastAccessed: 100 },
      ],
    });

    expect(await stub.send({ type: "magomap.read" })).toEqual(okRead);
    expect(stub.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 3 } }),
    );
    expect(stub.create).not.toHaveBeenCalled();
  });

  it("opens a fresh tab when every map.kakao.com tab is discarded", async () => {
    const stub = makeStub({
      tabs: [{ id: 1, status: "unloaded", discarded: true, lastAccessed: 500 }],
      created: { id: 42, status: "complete" },
    });

    expect(await stub.send({ type: "magomap.read" })).toEqual(okRead);
    expect(stub.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 42 } }),
    );
    expect(stub.remove).toHaveBeenCalledWith(42);
  });

  describe("with fake timers", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a tab that never finishes loading answers kakao_unavailable and is cleaned up", async () => {
      const stub = makeStub({ tabs: [], created: { id: 42, status: "loading" } });

      const answer = stub.send({ type: "magomap.read" });
      await vi.advanceTimersByTimeAsync(0);
      expect(stub.updatedListenerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await answer).toEqual({ ok: false, error: "kakao_unavailable" });
      expect(stub.updatedListenerCount()).toBe(0);
      expect(stub.executeScript).not.toHaveBeenCalled();
      expect(stub.remove).toHaveBeenCalledWith(42);
    });

    it("a read stuck in the page times out, and the next read isn't busy", async () => {
      let calls = 0;
      const stub = makeStub({
        tabs: [{ id: 1, status: "complete", lastAccessed: 1 }],
        read: () => {
          calls += 1;
          return calls === 1 ? new Promise(() => {}) : Promise.resolve(okRead);
        },
      });

      const stuck = stub.send({ type: "magomap.read" });
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
      expect(await stub.send({ type: "magomap.read" })).toEqual({ ok: false, error: "busy" });
      await vi.advanceTimersByTimeAsync(1);

      expect(await stuck).toEqual({ ok: false, error: "kakao_unavailable" });
      expect(await stub.send({ type: "magomap.read" })).toEqual(okRead);
    });
  });

  describe("an injection result of the wrong shape is kakao_unavailable", () => {
    const bad: [string, unknown][] = [
      ["start is null", { ok: true, start: null, favorites: {} }],
      ["folders isn't an array", { ok: true, start: { folders: {}, counts: [] }, favorites: {} }],
      ["counts is missing", { ok: true, start: { folders: [] }, favorites: {} }],
      ["favorites is null", { ok: true, start: { folders: [], counts: [] }, favorites: null }],
      ["favorites is an array", { ok: true, start: { folders: [], counts: [] }, favorites: [] }],
      ["an unknown error", { ok: false, error: "nope" }],
      ["an error without ok: false", { error: "kakao_signed_out" }],
      ["nothing", undefined],
    ];

    for (const [name, result] of bad) {
      it(name, async () => {
        const stub = makeStub({
          tabs: [{ id: 1, status: "complete", lastAccessed: 1 }],
          read: async () => result,
        });

        expect(await stub.send({ type: "magomap.read" })).toEqual({
          ok: false,
          error: "kakao_unavailable",
        });
      });
    }
  });
});

describe("writing to Kakao Map", () => {
  const tab = [{ id: 1, status: "complete", lastAccessed: 1 }];
  const goodPlace = {
    key: "1063803587",
    title: "청라창해문화공원",
    address: "인천 서해구 청라동 155-19",
    x: 421032,
    y: 1120559,
  };

  it("account asks the page for her folder records, in the page's own world", async () => {
    const folders = [{ folderid: 5, map_user_id: "772826870" }, null];
    const stub = makeStub({ tabs: tab, write: async () => ({ ok: true, folders }) });
    expect(await stub.send({ type: "magomap.account" })).toEqual({ ok: true, folders });
    expect(stub.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      world: "MAIN",
      func: writeInPage,
      args: [{ op: "account" }],
    });
  });

  it("createList sends the name to the page and answers with the new list's id", async () => {
    const stub = makeStub({ tabs: tab, write: async () => ({ ok: true, folderId: 25038639 }) });
    expect(await stub.send({ type: "magomap.createList", name: "제주 (복사본)" })).toEqual({
      ok: true,
      folderId: 25038639,
    });
    expect(stub.executeScript.mock.calls[0]?.[0]).toMatchObject({
      args: [{ op: "create", name: "제주 (복사본)" }],
    });
  });

  it("addPlaces sends only the fields a place needs", async () => {
    const stub = makeStub({ tabs: tab, write: async () => ({ ok: true, added: 1, skipped: 0 }) });
    const answer = await stub.send({
      type: "magomap.addPlaces",
      folderId: 25038639,
      places: [{ ...goodPlace, color: "06", secret: "never sent", memo: "also never" }],
    });
    expect(answer).toEqual({ ok: true, added: 1, skipped: 0 });
    expect(stub.executeScript.mock.calls[0]?.[0]).toMatchObject({
      args: [{ op: "add", folderId: 25038639, places: [{ ...goodPlace, color: "06" }] }],
    });
    const injection = stub.executeScript.mock.calls[0]?.[0] as {
      args: [{ places: object[] }];
    };
    const sent = injection.args[0].places[0];
    expect(Object.keys(sent as object).sort()).toEqual([
      "address",
      "color",
      "key",
      "title",
      "x",
      "y",
    ]);
  });

  it("refuses bad input as invalid, without touching Kakao Map", async () => {
    const stub = makeStub({ tabs: tab, write: async () => ({ ok: true, folderId: 1 }) });
    const bad: unknown[] = [
      { type: "magomap.createList" },
      { type: "magomap.createList", name: "" },
      { type: "magomap.createList", name: "   " },
      { type: "magomap.createList", name: "x".repeat(101) },
      { type: "magomap.createList", name: 5 },
      { type: "magomap.addPlaces", folderId: 0, places: [goodPlace] },
      { type: "magomap.addPlaces", folderId: 1.5, places: [goodPlace] },
      { type: "magomap.addPlaces", folderId: "7", places: [goodPlace] },
      { type: "magomap.addPlaces", folderId: 7, places: [] },
      { type: "magomap.addPlaces", folderId: 7, places: "nope" },
      {
        type: "magomap.addPlaces",
        folderId: 7,
        places: Array.from({ length: 101 }, () => goodPlace),
      },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, key: "12ab" }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, key: "0" }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, key: "0123" }] },
      {
        type: "magomap.addPlaces",
        folderId: 7,
        places: [{ ...goodPlace, title: "t".repeat(1001) }],
      },
      {
        type: "magomap.addPlaces",
        folderId: 7,
        places: [{ ...goodPlace, address: "a".repeat(1001) }],
      },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, x: 10_000_001 }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, y: -10_000_001 }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, key: "" }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, title: "" }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, x: Number.NaN }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, y: "1" }] },
      { type: "magomap.addPlaces", folderId: 7, places: [{ ...goodPlace, color: 3 }] },
      { type: "magomap.addPlaces", folderId: 7, places: [null] },
    ];
    for (const message of bad) {
      expect(await stub.send(message)).toEqual({ ok: false, error: "invalid" });
    }
    expect(stub.executeScript).not.toHaveBeenCalled();
    expect(stub.query).not.toHaveBeenCalled();
  });

  it("answers magomap's origin only", async () => {
    const stub = makeStub({ tabs: tab, write: async () => ({ ok: true, folderId: 1 }) });
    for (const message of [
      { type: "magomap.account" },
      { type: "magomap.createList", name: "x" },
      { type: "magomap.addPlaces", folderId: 7, places: [goodPlace] },
    ]) {
      expect(await stub.send(message, "https://evil.example")).toBeUndefined();
    }
    expect(stub.executeScript).not.toHaveBeenCalled();
  });

  it("a write and a read never run together: the second answers busy", async () => {
    let finish: (value: unknown) => void = () => {};
    const stub = makeStub({
      tabs: tab,
      write: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const first = stub.send({ type: "magomap.createList", name: "x" });
    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());
    expect(await stub.send({ type: "magomap.read" })).toEqual({ ok: false, error: "busy" });
    expect(await stub.send({ type: "magomap.account" })).toEqual({ ok: false, error: "busy" });
    finish({ ok: true, folderId: 3 });
    expect(await first).toEqual({ ok: true, folderId: 3 });
    expect(await stub.send({ type: "magomap.read" })).toEqual(okRead);
  });

  it("a failed injection is kakao_unavailable", async () => {
    const stub = makeStub({ tabs: tab, write: () => Promise.reject(new Error("no access")) });
    expect(await stub.send({ type: "magomap.account" })).toEqual({
      ok: false,
      error: "kakao_unavailable",
    });
    expect(await stub.send({ type: "magomap.createList", name: "x" })).toEqual({
      ok: false,
      error: "kakao_unavailable",
    });
  });

  it("an answer of the wrong shape is kakao_unavailable", async () => {
    for (const wrong of [
      undefined,
      null,
      "ok",
      { ok: true },
      { ok: true, folderId: "7" },
      { ok: true, folders: "nope" },
      { ok: true, folders: Array.from({ length: 2001 }, () => null) },
      { ok: false, error: "weird" },
    ]) {
      const stub = makeStub({ tabs: tab, write: async () => wrong });
      expect(await stub.send({ type: "magomap.createList", name: "x" })).toEqual({
        ok: false,
        error: "kakao_unavailable",
      });
    }
    const accountWrong = makeStub({
      tabs: tab,
      write: async () => ({ ok: true, folders: "nope" }),
    });
    expect(await accountWrong.send({ type: "magomap.account" })).toEqual({
      ok: false,
      error: "kakao_unavailable",
    });
    // The page's own failure passes through, with how far an add got.
    const failed = makeStub({
      tabs: tab,
      write: async () => ({ ok: false, error: "kakao_unavailable", added: 20 }),
    });
    expect(
      await failed.send({ type: "magomap.addPlaces", folderId: 7, places: [goodPlace] }),
    ).toEqual({
      ok: false,
      error: "kakao_unavailable",
      added: 20,
    });
    const signedOut = makeStub({
      tabs: tab,
      write: async () => ({ ok: false, error: "kakao_signed_out" }),
    });
    expect(await signedOut.send({ type: "magomap.account" })).toEqual({
      ok: false,
      error: "kakao_signed_out",
    });
  });

  it("opens a background tab when none is open, and closes it again", async () => {
    const stub = makeStub({
      tabs: [],
      created: { id: 42, status: "complete" },
      write: async () => ({ ok: true, folders: [] }),
    });
    expect(await stub.send({ type: "magomap.account" })).toEqual({ ok: true, folders: [] });
    expect(stub.create).toHaveBeenCalledWith({ url: "https://map.kakao.com/", active: false });
    expect(stub.remove).toHaveBeenCalledWith(42);
  });

  it("a stuck write times out, and the next one isn't busy", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const stub = makeStub({
        tabs: tab,
        write: () => {
          calls += 1;
          return calls === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true, folderId: 9 });
        },
      });
      const stuck = stub.send({ type: "magomap.createList", name: "x" });
      await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 1);
      expect(await stub.send({ type: "magomap.createList", name: "y" })).toEqual({
        ok: false,
        error: "busy",
      });
      await vi.advanceTimersByTimeAsync(1);
      expect(await stuck).toEqual({ ok: false, error: "kakao_unavailable" });
      expect(await stub.send({ type: "magomap.createList", name: "z" })).toEqual({
        ok: true,
        folderId: 9,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the page less time than the worker, so the page always stops first", () => {
    expect(WRITE_DEADLINE_MS).toBeLessThan(WRITE_TIMEOUT_MS);
  });
});
