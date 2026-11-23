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
const { ColorError, setPlaceColor } = await import("./setPlaceColor");

let n = 0;
let db: ReturnType<typeof openUserDb>;
const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
beforeEach(() => {
  n += 1;
  db = openUserDb(`color${n}`);
  ask.mockReset();
  post.mockReset();
  post.mockResolvedValue({ ok: true, updated: true });
  ask.mockImplementation(async (m) => {
    if (m.type === "magomap.account") return { ok: true, folders: [{ folderid: 0 }] };
    if (m.type === "magomap.setColor") return { ok: true };
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
  await db.list_items.put(item("ik", "K", { providerColor: "01" }));
}
async function seedOwn() {
  await db.lists.put(list("O", null));
  await db.user_lists.put(role("O", "owner"));
  await db.list_items.put(item("io", "O", { itemColor: "01" }));
}
const types = () => ask.mock.calls.map(([m]) => m.type);

describe("setPlaceColor on a Kakao list he owns", () => {
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
    await setPlaceColor({ itemId: "ik", color: "05" });
    expect(order).toEqual([
      "magomap.account",
      "/api/import/kakao-map/account",
      "magomap.setColor",
      "/api/kakao-colors",
    ]);
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.setColor")?.[0]).toMatchObject({
      folderId: 555,
      key: "1063803587",
      color: "05",
    });
    expect(post.mock.calls.at(-1)?.[2]).toEqual({ listId: "K", itemId: "ik", color: "05" });
    expect((await db.list_items.get("ik"))?.providerColor).toBe("05");
    // It is Kakao's data: nothing is queued to push.
    expect(await db.outbox.count()).toBe(0);
  });

  it("changes nothing here or on the server when Kakao Map refuses", async () => {
    await seedKakao();
    ask.mockImplementation(async (m) =>
      m.type === "magomap.account"
        ? { ok: true, folders: [] }
        : { ok: false, error: "kakao_unavailable" },
    );
    await expect(setPlaceColor({ itemId: "ik", color: "05" })).rejects.toMatchObject({
      code: "kakao_unavailable",
    });
    expect(post.mock.calls.map((c) => c[1])).toEqual(["/api/import/kakao-map/account"]);
    expect((await db.list_items.get("ik"))?.providerColor).toBe("01");
  });

  it("says the place is gone from the Kakao list, changing nothing", async () => {
    await seedKakao();
    ask.mockImplementation(async (m) =>
      m.type === "magomap.account" ? { ok: true, folders: [] } : { ok: false, error: "not_found" },
    );
    await expect(setPlaceColor({ itemId: "ik", color: "05" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await db.list_items.get("ik"))?.providerColor).toBe("01");
  });

  it("when Kakao took it but the server didn't, says so and leaves the local colour", async () => {
    await seedKakao();
    post.mockImplementation(async (_a, path) => {
      if (path === "/api/kakao-colors") throw new NetworkError();
      return { ok: true };
    });
    await expect(setPlaceColor({ itemId: "ik", color: "05" })).rejects.toMatchObject({
      code: "server_failed",
    });
    expect((await db.list_items.get("ik"))?.providerColor).toBe("01");
  });

  it("stops before Kakao Map for another account", async () => {
    await seedKakao();
    post.mockRejectedValue(new ApiError(409, { error: "kakao_account_mismatch" }));
    await expect(setPlaceColor({ itemId: "ik", color: "05" })).rejects.toMatchObject({
      code: "account_mismatch",
    });
    expect(types()).toEqual(["magomap.account"]);
  });

  it("says so when the extension isn't there", async () => {
    await seedKakao();
    ask.mockResolvedValue(undefined);
    await expect(setPlaceColor({ itemId: "ik", color: "05" })).rejects.toMatchObject({
      code: "extension_missing",
    });
  });

  it("makes no call at all for a list he follows", async () => {
    await seedKakao("follower");
    await expect(setPlaceColor({ itemId: "ik", color: "05" })).rejects.toMatchObject({
      code: "not_owner",
    });
    expect(ask).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a colour that isn't a Kakao colour", async () => {
    await seedKakao();
    await expect(setPlaceColor({ itemId: "ik", color: "99" })).rejects.toBeInstanceOf(ColorError);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("setPlaceColor on his own list", () => {
  it("is saved locally and queued to sync, with no call to Kakao Map or the server", async () => {
    await seedOwn();
    await setPlaceColor({ itemId: "io", color: "04" });
    expect((await db.list_items.get("io"))?.itemColor).toBe("04");
    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ table: "list_items", id: "io", op: "upsert" });
    expect(ask).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
