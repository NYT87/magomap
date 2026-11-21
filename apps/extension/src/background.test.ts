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
} from "./background";
import { allowedOrigins } from "./origins";
import { readInPage } from "./readInPage";

const MAGOMAP = "https://magomap.jmn8718.workers.dev";

const okRead: ReadAnswer = {
  ok: true,
  start: { folders: [{ folderid: 0 }], counts: [{ folderid: 0, itemCount: 0 }] },
  favorites: { "0": [] },
};

interface Stub {
  api: ExtensionApi;
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
  getStatus?: string;
}): Stub {
  let listener: ExternalListener | undefined;
  const updatedListeners = new Set<TabUpdatedListener>();

  const executeScript = vi.fn(async () => [
    { frameId: 0, result: options.read ? await options.read() : okRead },
  ]);
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
