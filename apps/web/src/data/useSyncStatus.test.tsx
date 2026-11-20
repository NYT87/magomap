import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => ({ state: "idle" }));
vi.mock("./sync", async (original) => ({
  ...(await original<typeof import("./sync")>()),
  syncState: () => sync,
}));
const { openUserDb } = await import("./db");
const { useListArrival } = await import("./useSyncStatus");

describe("useListArrival", () => {
  it("says downloading while a sync runs, and waiting while a full download is owed", async () => {
    const db = openUserDb("arrival");
    const { result, rerender } = renderHook(() => useListArrival());
    expect(result.current).toBeNull();
    await db.meta.put({ key: "fullPull", value: 1 });
    await waitFor(() => expect(result.current).toBe("waiting"));
    sync.state = "syncing";
    rerender();
    expect(result.current).toBe("downloading");
    sync.state = "idle";
    await db.meta.delete("fullPull");
    rerender();
    await waitFor(() => expect(result.current).toBeNull());
  });
});
