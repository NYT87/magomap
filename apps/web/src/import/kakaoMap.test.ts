import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/client";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
const sync = vi.fn(async () => ({ pushed: 0, pulled: 0, rejected: 0 }));
vi.mock("../data/sync", () => ({ syncNow: () => sync() }));
const { detectExtension, forgetKakaoMapRead, KakaoMapSyncError, runKakaoMapSync } = await import(
  "./kakaoMap"
);
const { openUserDb } = await import("../data/db");

const ACCOUNT = "kakaomap-user-7800";
const summary = {
  listsAdded: 2,
  listsUpdated: 0,
  listsRemoved: 0,
  placesAdded: 538,
  placesMoved: 0,
  membershipsRemoved: 0,
  membershipsRestored: 0,
  notesImported: 0,
};

const folder = (folderid: number) => ({
  folderid,
  title: `리스트 ${folderid}`,
  status: "O",
  subscribe: "N",
  kakao_map_user_id: ACCOUNT,
  nickname: "수지",
});
const favorites = (folderid: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ seq: folderid * 10_000 + i, key: String(i) }));

/** A read of folder 0 (1 favourite) and folder 101 (1,037 favourites: three pages). */
const READ = {
  ok: true,
  start: {
    folders: [folder(0), folder(101)],
    counts: [
      { folderid: 0, itemCount: 1 },
      { folderid: 101, itemCount: 1037 },
    ],
  },
  favorites: { "0": favorites(0, 1), "101": favorites(101, 1037) },
};

/** A fake extension: answers each message with `answer(message)`, or isn't there at all. */
function extension(answer?: (message: { type: string }) => unknown) {
  const sendMessage = vi.fn(
    (_id: string, message: { type: string }, callback: (response: unknown) => void) => {
      const response = answer?.(message);
      if (response !== undefined) setTimeout(() => callback(response), 0);
    },
  );
  vi.stubGlobal("chrome", answer ? { runtime: { sendMessage } } : undefined);
  return sendMessage;
}

/** A fake server; `fail(path, body)` decides which call errors. */
function server(fail?: (path: string, body: unknown) => unknown) {
  api.mockImplementation(async (path: string, init: { body?: string }) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    const err = fail?.(path, body);
    if (err) throw err;
    if (path === "/api/import/kakao-map/runs") {
      return {
        runId: "r1",
        lists: [
          { externalId: "0~kakao-login-1", name: "리스트 0", itemCount: 1 },
          { externalId: "101", name: "리스트 101", itemCount: 1037 },
        ],
      };
    }
    if (/\/pages\/\d+$/.test(path)) return { ...summary, done: false };
    if (path.endsWith("/finish") || path.endsWith("/complete")) return summary;
    throw new Error(`unexpected ${path}`);
  });
}

const paths = () => api.mock.calls.map((c) => c[0]);
const bodyOf = (path: string) => {
  const call = api.mock.calls.find((c) => c[0] === path);
  return call?.[1]?.body ? JSON.parse(call[1].body) : undefined;
};

beforeEach(() => {
  api.mockReset();
  sync.mockClear();
  forgetKakaoMapRead();
  openUserDb("sync-a");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("detectExtension", () => {
  it("missing extension → missing", async () => {
    extension();
    await expect(detectExtension()).resolves.toBe("missing");
  });

  it("an extension that never answers is missing after 1.5 s", async () => {
    vi.useFakeTimers();
    extension(() => undefined);
    const state = detectExtension();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(state).resolves.toBe("missing");
  });

  it("an answering extension is ready", async () => {
    const send = extension((m) =>
      m.type === "magomap.ping" ? { ok: true, version: "0.1.0" } : {},
    );
    await expect(detectExtension()).resolves.toBe("ready");
    expect(send.mock.calls[0]?.[0]).toBe("eccgkehfioodkgllihgbgkgfcifmghif");
  });
});

describe("runKakaoMapSync", () => {
  it("a full sync posts start, pages of ≤500, finish, complete, then syncs", async () => {
    extension((m) => (m.type === "magomap.read" ? READ : undefined));
    server();
    const progress = vi.fn();
    await expect(runKakaoMapSync(progress)).resolves.toEqual(summary);
    const run = "/api/import/kakao-map/runs";
    const list0 = "/api/import/runs/r1/lists/0~kakao-login-1";
    expect(paths()).toEqual([
      run,
      `${run}/r1/lists/0~kakao-login-1/pages/0`,
      `${list0}/finish`,
      `${run}/r1/lists/101/pages/0`,
      `${run}/r1/lists/101/pages/1`,
      `${run}/r1/lists/101/pages/2`,
      "/api/import/runs/r1/lists/101/finish",
      "/api/import/runs/r1/complete",
    ]);
    // The start carries the raw read's folders and counts, and no confirmation.
    expect(bodyOf(run)).toEqual(READ.start);
    // Each page is that folder's favourites, 500 at a time, in order.
    expect(bodyOf(`${run}/r1/lists/0~kakao-login-1/pages/0`)).toEqual({
      favorites: READ.favorites["0"],
    });
    const pages = [0, 1, 2].map(
      (i) => bodyOf(`${run}/r1/lists/101/pages/${i}`).favorites as { seq: number }[],
    );
    expect(pages.map((p) => p.length)).toEqual([500, 500, 37]);
    expect(pages.flat()).toEqual(READ.favorites["101"]);
    expect(progress.mock.calls.map((c) => c[0])).toEqual([
      { listIndex: 0, listCount: 2 },
      { listIndex: 1, listCount: 2 },
    ]);
    expect(sync).toHaveBeenCalledTimes(1);
    // Every request acts for the account the sync started in.
    for (const [, init] of api.mock.calls) {
      expect(new Headers(init.headers).get("x-magomap-user")).toBe("sync-a");
    }
  });

  it("a failed page stops before complete", async () => {
    extension((m) => (m.type === "magomap.read" ? READ : undefined));
    server((path) =>
      path.endsWith("/101/pages/1") ? new ApiError(400, { error: "invalid" }) : null,
    );
    const error = await runKakaoMapSync(() => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KakaoMapSyncError);
    expect(error).toMatchObject({ code: "invalid" });
    expect(paths().some((p) => p.endsWith("/complete"))).toBe(false);
    expect(paths().some((p) => p.endsWith("/101/finish"))).toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it("retries the start and a page once when the connection drops", async () => {
    extension((m) => (m.type === "magomap.read" ? READ : undefined));
    const dropped = new Set<string>();
    server((path) => {
      if (path.endsWith("/runs") || path.endsWith("/101/pages/1")) {
        if (!dropped.has(path)) {
          dropped.add(path);
          return new NetworkError();
        }
      }
      return null;
    });
    await expect(runKakaoMapSync(() => {})).resolves.toEqual(summary);
    expect(paths().filter((p) => p === "/api/import/kakao-map/runs")).toHaveLength(2);
    expect(paths().filter((p) => p.endsWith("/101/pages/1"))).toHaveLength(2);
  });

  it("an unconfirmed account throws with idTail, and the retry sends confirmAccount without reading again", async () => {
    const send = extension((m) => (m.type === "magomap.read" ? READ : undefined));
    server((path, body) =>
      path === "/api/import/kakao-map/runs" &&
      (body as { confirmAccount?: string }).confirmAccount === undefined
        ? new ApiError(409, {
            error: "kakao_account_unconfirmed",
            account: { nickname: "수지", idTail: "7800" },
          })
        : null,
    );
    const error = await runKakaoMapSync(() => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KakaoMapSyncError);
    expect(error).toMatchObject({
      code: "kakao_account_unconfirmed",
      account: { nickname: "수지", idTail: "7800" },
    });
    // The error never carries the whole account id.
    expect(JSON.stringify(error)).not.toContain(ACCOUNT);
    expect(send).toHaveBeenCalledTimes(1);

    api.mockClear();
    await expect(runKakaoMapSync(() => {}, { confirmAccount: "7800" })).resolves.toEqual(summary);
    expect(send).toHaveBeenCalledTimes(1);
    expect(bodyOf("/api/import/kakao-map/runs")).toEqual({
      ...READ.start,
      confirmAccount: ACCOUNT,
    });
  });

  it("never confirms an account other than the one she was shown", async () => {
    const send = extension((m) => (m.type === "magomap.read" ? READ : undefined));
    server(
      () => new ApiError(409, { error: "kakao_account_mismatch", account: { idTail: "7800" } }),
    );
    await runKakaoMapSync(() => {}).catch(() => {});
    await runKakaoMapSync(() => {}, { confirmAccount: "1234" }).catch(() => {});
    // A confirmation for another account reads again and sends no confirmation.
    expect(send).toHaveBeenCalledTimes(2);
    expect(bodyOf("/api/import/kakao-map/runs")).toEqual(READ.start);
    expect(api.mock.calls.every(([, init]) => !String(init.body).includes("confirmAccount"))).toBe(
      true,
    );
  });

  it("reports what the extension says, and writes nothing", async () => {
    for (const code of ["kakao_signed_out", "kakao_unavailable", "busy"] as const) {
      extension((m) => (m.type === "magomap.read" ? { ok: false, error: code } : undefined));
      server();
      await expect(runKakaoMapSync(() => {})).rejects.toMatchObject({ code });
      expect(api).not.toHaveBeenCalled();
    }
  });

  it("an answer it can't read is kakao_unavailable", async () => {
    extension((m) => (m.type === "magomap.read" ? { ok: true, start: {} } : undefined));
    server();
    await expect(runKakaoMapSync(() => {})).rejects.toMatchObject({ code: "kakao_unavailable" });
    expect(api).not.toHaveBeenCalled();
  });

  it("a server refusal at the start keeps its code", async () => {
    extension((m) => (m.type === "magomap.read" ? READ : undefined));
    server(() => new ApiError(422, { error: "kakao_signed_out" }));
    await expect(runKakaoMapSync(() => {})).rejects.toMatchObject({ code: "kakao_signed_out" });
  });
});
