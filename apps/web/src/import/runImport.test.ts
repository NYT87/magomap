import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
const sync = vi.fn(async () => ({ pushed: 0, pulled: 0, rejected: 0 }));
vi.mock("../data/sync", () => ({ syncNow: () => sync() }));
const { driveRun, ImportError, post } = await import("./runImport");

const summary = {
  listsAdded: 1,
  listsUpdated: 0,
  listsRemoved: 0,
  placesAdded: 1200,
  placesMoved: 0,
  membershipsRemoved: 0,
  membershipsRestored: 0,
  notesImported: 0,
};

type Lists = { externalId: string; itemCount: number }[];

/** Sends each page through `post`, as the Kakao Map sync does, and says when a list is done. */
function drive(lists: Lists, account = "acct", onProgress = vi.fn()) {
  const run = { runId: "r1", lists: lists.map((l) => ({ ...l, name: l.externalId })) };
  return driveRun(account, run, onProgress, async (at, page, list) => {
    await post(account, `${at}/pages/${page}`, { favorites: [] });
    return { done: page + 1 >= Math.max(1, Math.ceil(list.itemCount / 500)) };
  });
}

beforeEach(() => {
  api.mockReset();
  sync.mockClear();
});

describe("driveRun", () => {
  it("sends each page in order, finishes each list, then completes and syncs", async () => {
    api.mockImplementation(async (path: string) =>
      path.includes("/pages/") ? { done: false } : summary,
    );
    const progress = vi.fn();
    const result = await drive([{ externalId: "101", itemCount: 1200 }], "acct", progress);
    expect(api.mock.calls.map((c) => c[0])).toEqual([
      "/api/import/runs/r1/lists/101/pages/0",
      "/api/import/runs/r1/lists/101/pages/1",
      "/api/import/runs/r1/lists/101/pages/2",
      "/api/import/runs/r1/lists/101/finish",
      "/api/import/runs/r1/complete",
    ]);
    expect(result).toEqual(summary);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith({ listIndex: 0, listCount: 1 });
  });

  it("sends one page for an empty list", async () => {
    api.mockImplementation(async (path: string) =>
      path.includes("/pages/") ? { done: true } : summary,
    );
    await drive([{ externalId: "7", itemCount: 0 }]);
    expect(api.mock.calls.map((c) => c[0])).toEqual([
      "/api/import/runs/r1/lists/7/pages/0",
      "/api/import/runs/r1/lists/7/finish",
      "/api/import/runs/r1/complete",
    ]);
  });

  it("stops at a failing list and never completes, so nothing is marked removed", async () => {
    api.mockImplementation(async (path: string) => {
      if (path.includes("/lists/2/")) throw new ApiError(409, { error: "run_closed" });
      return path.includes("/pages/") ? { done: true } : summary;
    });
    const error = await drive([
      { externalId: "1", itemCount: 3 },
      { externalId: "2", itemCount: 3 },
      { externalId: "3", itemCount: 3 },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ step: "list", listIndex: 1, code: "run_closed" });
    expect(api.mock.calls.some((c) => String(c[0]).endsWith("/complete"))).toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it("reports a refused complete", async () => {
    api.mockImplementation(async (path: string) => {
      if (path.endsWith("/complete")) throw new ApiError(409, { error: "incomplete" });
      return path.includes("/pages/") ? { done: true } : summary;
    });
    await expect(drive([{ externalId: "1", itemCount: 1 }])).rejects.toMatchObject({
      step: "complete",
      code: "incomplete",
    });
  });

  it("retries a request once when the connection drops or the server is busy", async () => {
    let failed = false;
    api.mockImplementation(async (path: string) => {
      if (path.endsWith("/pages/0") && !failed) {
        failed = true;
        throw new ApiError(503, { error: "busy" });
      }
      return path.includes("/pages/") ? { done: true } : summary;
    });
    await drive([{ externalId: "101", itemCount: 1 }]);
    expect(api.mock.calls.filter((c) => String(c[0]).endsWith("/pages/0"))).toHaveLength(2);
  });

  it("acts for the account it was given on every request", async () => {
    api.mockImplementation(async (path: string) =>
      path.includes("/pages/") ? { done: true } : summary,
    );
    await drive([{ externalId: "a", itemCount: 1 }], "imp-a");
    const accounts = api.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit).headers).get("x-magomap-user"),
    );
    expect(accounts.length).toBe(3);
    expect(new Set(accounts)).toEqual(new Set(["imp-a"]));
  });
});
