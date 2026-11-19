import { renderHook, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { useUserDb } from "./useUserDb";

describe("useUserDb", () => {
  it("swaps in a fresh database, under a new key, when another tab deletes this one", async () => {
    const { result } = renderHook(() => useUserDb("ud1"));
    const first = result.current;
    await first.db.drafts.put({ key: "k", visitedOn: null, body: "a", updatedAt: 1 });
    await Dexie.delete("magomap-ud1");
    await waitFor(() => expect(result.current.key).not.toBe(first.key));
    expect(result.current.db).not.toBe(first.db);
    expect(await result.current.db.drafts.count()).toBe(0);
  });

  it("keeps its key when another account's database is replaced", async () => {
    const { result } = renderHook(() => useUserDb("ud2"));
    const first = result.current;
    const other = new Dexie("magomap-ud3");
    other.version(1).stores({ drafts: "key" });
    await other.open();
    other.close();
    const { openUserDb } = await import("./db");
    const third = openUserDb("ud3");
    await third.drafts.count();
    openUserDb("ud2");
    await Dexie.delete("magomap-ud3");
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.key).toBe(first.key);
  });
});
