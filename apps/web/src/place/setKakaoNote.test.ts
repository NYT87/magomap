import type { ListItemRow, ListRow, PlaceSourceRow, UserListRow } from "@magomap/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/client";

type Msg = { type: string; [k: string]: unknown };
const ask = vi.fn<(message: Msg, timeoutMs: number) => Promise<unknown>>();
vi.mock("../import/kakaoMap", () => ({
  askExtension: (m: Msg, t: number) => ask(m, t),
  runKakaoMapSync: vi.fn(),
}));
const post = vi.fn<(account: string, path: string, body?: unknown) => Promise<unknown>>();
vi.mock("../import/runImport", async (orig) => {
  const actual = await orig<typeof import("../import/runImport")>();
  return { ...actual, post: (a: string, p: string, b?: unknown) => post(a, p, b) };
});
const { openUserDb } = await import("../data/db");
const { NoteChangedError, NoteError, setKakaoNote } = await import("./setKakaoNote");

let n = 0;
let db: ReturnType<typeof openUserDb>;
const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
beforeEach(() => {
  n += 1;
  db = openUserDb(`note${n}`);
  ask.mockReset();
  post.mockReset();
  post.mockResolvedValue({ ok: true, updated: true });
  ask.mockImplementation(async (m) => {
    if (m.type === "magomap.account") return { ok: true, folders: [{ folderid: 0 }] };
    if (m.type === "magomap.setNote") return { ok: true };
    return undefined;
  });
});

const list = (id: string, provider: string | null): ListRow => ({
  id,
  provider,
  externalId: provider ? "555" : null,
  name: "목록",
  description: null,
  color: null,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  ...base,
});
const role = (listId: string, r: UserListRow["role"]): UserListRow => ({
  id: `ul_${listId}`,
  listId,
  role: r,
  removedAt: null,
  ...base,
});
const item = (id: string, listId: string, extra: Partial<ListItemRow> = {}): ListItemRow => ({
  id,
  listId,
  placeId: "p1",
  position: 0,
  addedAt: 1,
  externalId: null,
  providerNote: null,
  providerColor: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  ...base,
  ...extra,
});
const kakaoSource: PlaceSourceRow = {
  id: "ps1",
  placeId: "p1",
  provider: "kakao",
  externalId: "1063803587",
  ...base,
};

async function seedKakao(r: UserListRow["role"] = "owner") {
  await db.lists.put(list("K", "kakao"));
  await db.user_lists.put(role("K", r));
  await db.place_sources.put(kakaoSource);
  await db.list_items.put(item("ik", "K", { providerNote: "옛 메모" }));
}
const types = () => ask.mock.calls.map(([m]) => m.type);

describe("setKakaoNote on a Kakao list he owns", () => {
  it("changes it in Kakao Map first, then tells the server, then saves it here", async () => {
    await seedKakao();
    const order: string[] = [];
    ask.mockImplementation(async (m) => {
      order.push(m.type);
      return m.type === "magomap.account" ? { ok: true, folders: [] } : { ok: true };
    });
    post.mockImplementation(async (_a, path) => {
      order.push(path);
      return { ok: true };
    });
    await setKakaoNote({ itemId: "ik", note: "  새 메모\n둘째 줄  " });
    expect(order).toEqual([
      "magomap.account",
      "/api/import/kakao-map/account",
      "magomap.setNote",
      "/api/kakao-notes",
    ]);
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.setNote")?.[0]).toMatchObject({
      folderId: 555,
      key: "1063803587",
      note: "새 메모\n둘째 줄",
    });
    expect(post.mock.calls.at(-1)?.[2]).toEqual({
      listId: "K",
      itemId: "ik",
      note: "새 메모\n둘째 줄",
    });
    expect((await db.list_items.get("ik"))?.providerNote).toBe("새 메모\n둘째 줄");
    // It is Kakao's data: nothing is queued to push.
    expect(await db.outbox.count()).toBe(0);
  });

  it("sends the note magomap knew, so the extension can see it was changed meanwhile", async () => {
    await seedKakao();
    await setKakaoNote({ itemId: "ik", note: "새 메모" });
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.setNote")?.[0]).toMatchObject({
      expected: "옛 메모",
    });
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.setNote")?.[0]).not.toHaveProperty(
      "overwrite",
    );
  });

  it("when Kakao's note changed meanwhile, throws with Kakao's note and changes nothing", async () => {
    await seedKakao();
    ask.mockImplementation(async (m) =>
      m.type === "magomap.account"
        ? { ok: true, folders: [] }
        : { ok: false, error: "note_changed", current: "아내가 바꾼 메모" },
    );
    const failure = await setKakaoNote({ itemId: "ik", note: "새 메모" }).catch((e) => e);
    expect(failure).toBeInstanceOf(NoteChangedError);
    expect(failure).toMatchObject({ code: "note_changed", current: "아내가 바꾼 메모" });
    expect(post.mock.calls.map((c) => c[1])).toEqual(["/api/import/kakao-map/account"]);
    expect((await db.list_items.get("ik"))?.providerNote).toBe("옛 메모");
  });

  it("overwrites after he confirmed: the message says so and the note is saved", async () => {
    await seedKakao();
    await setKakaoNote({ itemId: "ik", note: "새 메모", overwrite: true });
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.setNote")?.[0]).toMatchObject({
      expected: "옛 메모",
      overwrite: true,
    });
    expect((await db.list_items.get("ik"))?.providerNote).toBe("새 메모");
  });

  it("an empty note clears it, in Kakao Map, on the server and here", async () => {
    await seedKakao();
    await setKakaoNote({ itemId: "ik", note: "   " });
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.setNote")?.[0]).toMatchObject({
      note: "",
    });
    expect(post.mock.calls.at(-1)?.[2]).toMatchObject({ note: "" });
    expect((await db.list_items.get("ik"))?.providerNote ?? "").toBe("");
  });

  it("changes nothing here or on the server when Kakao Map refuses", async () => {
    await seedKakao();
    ask.mockImplementation(async (m) =>
      m.type === "magomap.account"
        ? { ok: true, folders: [] }
        : { ok: false, error: "kakao_unavailable" },
    );
    await expect(setKakaoNote({ itemId: "ik", note: "새" })).rejects.toMatchObject({
      code: "kakao_unavailable",
    });
    expect(post.mock.calls.map((c) => c[1])).toEqual(["/api/import/kakao-map/account"]);
    expect((await db.list_items.get("ik"))?.providerNote).toBe("옛 메모");
  });

  it("says the place is gone from the Kakao list, changing nothing", async () => {
    await seedKakao();
    ask.mockImplementation(async (m) =>
      m.type === "magomap.account" ? { ok: true, folders: [] } : { ok: false, error: "not_found" },
    );
    await expect(setKakaoNote({ itemId: "ik", note: "새" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await db.list_items.get("ik"))?.providerNote).toBe("옛 메모");
  });

  it("when Kakao took it but the server didn't, says so and leaves the local note", async () => {
    await seedKakao();
    post.mockImplementation(async (_a, path) => {
      if (path === "/api/kakao-notes") throw new NetworkError();
      return { ok: true };
    });
    await expect(setKakaoNote({ itemId: "ik", note: "새" })).rejects.toMatchObject({
      code: "server_failed",
    });
    expect((await db.list_items.get("ik"))?.providerNote).toBe("옛 메모");
  });

  it("stops before Kakao Map for another account", async () => {
    await seedKakao();
    post.mockRejectedValue(new ApiError(409, { error: "kakao_account_mismatch" }));
    await expect(setKakaoNote({ itemId: "ik", note: "새" })).rejects.toMatchObject({
      code: "account_mismatch",
    });
    expect(types()).toEqual(["magomap.account"]);
  });

  it("says so when the extension isn't there", async () => {
    await seedKakao();
    ask.mockResolvedValue(undefined);
    await expect(setKakaoNote({ itemId: "ik", note: "새" })).rejects.toMatchObject({
      code: "extension_missing",
    });
  });

  it("makes no call at all for a list he follows", async () => {
    await seedKakao("follower");
    await expect(setKakaoNote({ itemId: "ik", note: "새" })).rejects.toMatchObject({
      code: "not_owner",
    });
    expect(ask).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("makes no call for his own list, which has no Kakao note", async () => {
    await db.lists.put(list("O", null));
    await db.user_lists.put(role("O", "owner"));
    await db.list_items.put(item("io", "O"));
    await expect(setKakaoNote({ itemId: "io", note: "새" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("refuses a note longer than the limit before any call", async () => {
    await seedKakao();
    await expect(setKakaoNote({ itemId: "ik", note: "가".repeat(5001) })).rejects.toBeInstanceOf(
      NoteError,
    );
    expect(ask).not.toHaveBeenCalled();
  });
});
