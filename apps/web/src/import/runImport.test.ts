import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
const sync = vi.fn(async () => ({ pushed: 0, pulled: 0, rejected: 0 }));
vi.mock("../data/sync", () => ({ syncNow: () => sync() }));
const { ImportError, runImport } = await import("./runImport");

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

/** A fake server: lists with item counts; `fail` decides which call errors. */
function server(
  lists: { externalId: string; itemCount: number }[],
  fail?: (path: string) => unknown,
) {
  api.mockImplementation(async (path: string) => {
    const err = fail?.(path);
    if (err) throw err;
    if (path === "/api/import/runs") return { runId: "r1", lists };
    const page = /\/lists\/([^/]+)\/pages\/(\d+)$/.exec(path);
    if (page) {
      const list = lists.find((l) => l.externalId === page[1]);
      const pages = Math.max(1, Math.ceil((list?.itemCount ?? 0) / 500));
      return { ...summary, done: Number(page[2]) + 1 >= pages };
    }
    if (path.endsWith("/finish")) return summary;
    if (path.endsWith("/complete")) return summary;
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  api.mockReset();
  sync.mockClear();
});

describe("runImport", () => {
  it("asks for each page in order, finishes each list, then completes and syncs", async () => {
    server([{ externalId: "101", itemCount: 1200 }]);
    const progress = vi.fn();
    const result = await runImport(progress);
    expect(api.mock.calls.map((c) => c[0])).toEqual([
      "/api/import/runs",
      "/api/import/runs/r1/lists/101/pages/0",
      "/api/import/runs/r1/lists/101/pages/1",
      "/api/import/runs/r1/lists/101/pages/2",
      "/api/import/runs/r1/lists/101/finish",
      "/api/import/runs/r1/complete",
    ]);
    expect(api.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ provider: "kakao" }),
    });
    expect(result).toEqual(summary);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith({ listIndex: 0, listCount: 1 });
  });

  it("stops at a failing list and never completes, so nothing is marked removed", async () => {
    server(
      [
        { externalId: "1", itemCount: 3 },
        { externalId: "2", itemCount: 3 },
        { externalId: "3", itemCount: 3 },
      ],
      (path) =>
        path.includes("/lists/2/") ? new ApiError(409, { error: "snapshot_changed" }) : null,
    );
    await expect(runImport(() => {})).rejects.toMatchObject({
      step: "list",
      listIndex: 1,
      code: "snapshot_changed",
    });
    expect(api.mock.calls.some((c) => String(c[0]).endsWith("/complete"))).toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it("reports when kakao-list has nothing for this account", async () => {
    server([], (path) =>
      path === "/api/import/runs" ? new ApiError(404, { error: "no_snapshot" }) : null,
    );
    const error = await runImport(() => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ step: "start", code: "no_snapshot" });
  });

  it("retries a page once when the connection drops", async () => {
    let failed = false;
    server([{ externalId: "101", itemCount: 1 }], (path) => {
      if (path.endsWith("/pages/0") && !failed) {
        failed = true;
        return new ApiError(503, { error: "busy" });
      }
      return null;
    });
    await runImport(() => {});
    expect(api.mock.calls.filter((c) => String(c[0]).endsWith("/pages/0"))).toHaveLength(2);
  });
});
