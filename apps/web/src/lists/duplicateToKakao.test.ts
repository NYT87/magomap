import type { ListItemRow, ListRow, PlaceRow, PlaceSourceRow } from "@magomap/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

type Msg = { type: string; [k: string]: unknown };
const ask = vi.fn<(message: Msg, timeoutMs: number) => Promise<unknown>>();
const sync = vi.fn(async (_progress: unknown, _opts?: unknown) => ({}));
vi.mock("../import/kakaoMap", () => ({
  askExtension: (m: Msg, t: number) => ask(m, t),
  runKakaoMapSync: (p: unknown, o?: unknown) => sync(p, o),
}));
const post = vi.fn<(account: string, path: string, body?: unknown) => Promise<unknown>>();
vi.mock("../import/runImport", async (orig) => {
  const actual = await orig<typeof import("../import/runImport")>();
  return { ...actual, post: (a: string, p: string, b?: unknown) => post(a, p, b) };
});
const { openUserDb } = await import("../data/db");
const { duplicateToKakao, KakaoCopyError } = await import("./duplicateToKakao");

let n = 0;
let db: ReturnType<typeof openUserDb>;
beforeEach(() => {
  n += 1;
  db = openUserDb(`d2k${n}`);
  ask.mockReset();
  post.mockReset();
  sync.mockClear();
  post.mockResolvedValue({ ok: true });
});

const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
const list = (id: string, provider: string | null): ListRow => ({
  id,
  provider,
  externalId: provider ? "555" : null,
  name: "제주 카페",
  description: null,
  color: null,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  ...base,
});
const place = (id: string, extra: Partial<PlaceRow> = {}): PlaceRow => ({
  id,
  title: `이름 ${id}`,
  address: `지번 ${id}`,
  roadAddress: `도로 ${id}`,
  addressSource: null,
  category: null,
  phone: null,
  lat: 33.4627,
  lng: 126.3095,
  providerSnapshotAt: null,
  ...base,
  ...extra,
});
const source = (placeId: string, key: string | null): PlaceSourceRow => ({
  id: `src_${placeId}`,
  placeId,
  provider: key === null ? "naver" : "kakao",
  externalId: key ?? "n1",
  ...base,
});
const item = (
  listId: string,
  placeId: string,
  position: number,
  extra: Partial<ListItemRow> = {},
) =>
  ({
    id: `i_${placeId}`,
    listId,
    placeId,
    position,
    addedAt: 1,
    externalId: null,
    providerNote: null,
    providerColor: null,
    removedAtProvider: null,
    providerSnapshotAt: null,
    ...base,
    ...extra,
  }) as ListItemRow;

/** A source list "L" of three places: one with a colour, one with no Kakao key, one with no point. */
async function seed(provider: string | null = "kakao") {
  await db.lists.put(list("L", provider));
  await db.places.bulkPut([
    place("a"),
    place("b"),
    place("c", { lat: null, lng: null }),
    place("d"),
  ]);
  await db.place_sources.bulkPut([
    source("a", "1111"),
    source("b", null),
    source("c", "3333"),
    source("d", "4444"),
  ]);
  await db.list_items.bulkPut([
    item("L", "a", 0, { providerColor: "05" }),
    item("L", "b", 1),
    item("L", "c", 2),
    item("L", "d", 3, { itemColor: "02" }),
    item("L", "gone", 4, { removedAtProvider: 9 }),
  ]);
}

/** An extension that behaves, recording what it was asked. */
const behaves = (over: Partial<Record<string, (m: Msg) => unknown>> = {}) =>
  ask.mockImplementation(async (m) => {
    const custom = over[m.type];
    if (custom) return custom(m);
    if (m.type === "magomap.account") return { ok: true, folders: [{ folderid: 0 }] };
    if (m.type === "magomap.createList") return { ok: true, folderId: 777 };
    if (m.type === "magomap.addPlaces") {
      const places = m.places as unknown[];
      return { ok: true, added: places.length, skipped: 0 };
    }
    return undefined;
  });
const types = () => ask.mock.calls.map(([m]) => m.type);

describe("duplicateToKakao", () => {
  it("checks the account, creates the list, adds the places, then syncs", async () => {
    await seed();
    behaves();
    const done = await duplicateToKakao({ sourceListId: "L", name: " 사본 " });
    expect(types()).toEqual(["magomap.account", "magomap.createList", "magomap.addPlaces"]);
    expect(post.mock.calls[0]?.[1]).toBe("/api/import/kakao-map/account");
    expect(ask.mock.calls[1]?.[0]).toMatchObject({ name: "사본" });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(done).toMatchObject({ folderId: 777, added: 2, leftOut: 2, synced: true });
  });

  it("sends each place's key, texts, Kakao x/y and colour; leaves out places it can't send", async () => {
    await seed();
    behaves();
    await duplicateToKakao({ sourceListId: "L", name: "copy" });
    const sent = ask.mock.calls.find(([m]) => m.type === "magomap.addPlaces")?.[0];
    const places = sent?.places as {
      key: string;
      title: string;
      address: string;
      x: number;
      y: number;
      color?: string;
    }[];
    expect(sent?.folderId).toBe(777);
    expect(places.map((p) => p.key)).toEqual(["1111", "4444"]);
    expect(places[0]).toMatchObject({ title: "이름 a", address: "도로 a", color: "05" });
    expect(Number.isInteger(places[0]?.x)).toBe(true);
    expect(Number.isInteger(places[0]?.y)).toBe(true);
    // d has an own-list colour only.
    expect(places[1]?.color).toBe("02");
    // Only what the extension takes: never magomap's own place ids.
    expect(Object.keys(places[0] ?? {}).sort()).toEqual([
      "address",
      "color",
      "key",
      "title",
      "x",
      "y",
    ]);
  });

  it("stops before creating anything when the signed-in account isn't his", async () => {
    await seed();
    behaves();
    post.mockRejectedValue(new ApiError(409, { error: "kakao_account_mismatch" }));
    await expect(duplicateToKakao({ sourceListId: "L", name: "x" })).rejects.toMatchObject({
      code: "account_mismatch",
    });
    expect(types()).toEqual(["magomap.account"]);
  });

  it("tells an unlinked account and a server failure apart from a different account", async () => {
    await seed();
    behaves();
    post.mockRejectedValueOnce(new ApiError(409, { error: "kakao_account_unconfirmed" }));
    await expect(duplicateToKakao({ sourceListId: "L", name: "x" })).rejects.toMatchObject({
      code: "account_unconfirmed",
    });
    post.mockRejectedValueOnce(new ApiError(500, {}));
    await expect(duplicateToKakao({ sourceListId: "L", name: "x" })).rejects.toMatchObject({
      code: "kakao_unavailable",
    });
  });

  it("names the copy's own account to the sync afterwards, not whichever is open then", async () => {
    await seed();
    behaves();
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    expect(sync.mock.calls[0]?.[1]).toEqual({ account: `d2k${n}` });
  });

  it("cuts a title or address longer than the extension takes, so the page still goes", async () => {
    await seed();
    await db.places.update("a", { title: "가".repeat(1500), roadAddress: "길".repeat(5000) });
    behaves();
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    const sent = ask.mock.calls.find(([m]) => m.type === "magomap.addPlaces")?.[0];
    const places = (sent?.places ?? []) as { title: string; address: string }[];
    expect(places[0]?.title).toHaveLength(1000);
    expect(places[0]?.address).toHaveLength(1000);
  });

  it("never cuts an emoji in half at the limit", async () => {
    await seed();
    await db.places.update("a", { roadAddress: `${"길".repeat(999)}😀 끝` });
    behaves();
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    const sent = ask.mock.calls.find(([m]) => m.type === "magomap.addPlaces")?.[0];
    const places = (sent?.places ?? []) as { address: string }[];
    expect(places[0]?.address).toBe("길".repeat(999));
  });

  it("sends the address when the road address is empty", async () => {
    await seed();
    await db.places.update("a", { roadAddress: "" });
    behaves();
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    const sent = ask.mock.calls.find(([m]) => m.type === "magomap.addPlaces")?.[0];
    const places = (sent?.places ?? []) as { address: string }[];
    expect(places[0]?.address).toBe("지번 a");
  });

  it("says so when the extension isn't there", async () => {
    await seed();
    ask.mockResolvedValue(undefined);
    await expect(duplicateToKakao({ sourceListId: "L", name: "x" })).rejects.toMatchObject({
      code: "extension_missing",
    });
  });

  it("maps a signed-out Kakao Map and an unavailable one", async () => {
    await seed();
    behaves({ "magomap.account": () => ({ ok: false, error: "kakao_signed_out" }) });
    await expect(duplicateToKakao({ sourceListId: "L", name: "x" })).rejects.toMatchObject({
      code: "kakao_signed_out",
    });
    behaves({ "magomap.createList": () => ({ ok: false, error: "kakao_unavailable" }) });
    await expect(duplicateToKakao({ sourceListId: "L", name: "x" })).rejects.toMatchObject({
      code: "kakao_unavailable",
    });
  });

  it("sends only keys from his wife's list, never her list id", async () => {
    await seed();
    behaves();
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    expect(JSON.stringify(ask.mock.calls)).not.toContain("555");
  });

  it("after a failure midway, throws partial with the list and how many were added; resuming adds to the same list", async () => {
    await seed();
    await db.places.bulkPut(Array.from({ length: 60 }, (_, i) => place(`m${i}`)));
    await db.place_sources.bulkPut(
      Array.from({ length: 60 }, (_, i) => source(`m${i}`, `${9000 + i}`)),
    );
    await db.list_items.bulkPut(Array.from({ length: 60 }, (_, i) => item("L", `m${i}`, 10 + i)));
    let adds = 0;
    behaves({
      "magomap.addPlaces": (m) => {
        adds += 1;
        const count = (m.places as unknown[]).length;
        return adds === 2
          ? { ok: false, error: "kakao_unavailable", added: 3 }
          : { ok: true, added: count, skipped: 0 };
      },
    });
    const failure = await duplicateToKakao({ sourceListId: "L", name: "x" }).catch((e) => e);
    expect(failure).toBeInstanceOf(KakaoCopyError);
    expect(failure).toMatchObject({ code: "partial", folderId: 777, added: 50 + 3 });
    ask.mockClear();
    behaves();
    const done = await duplicateToKakao({
      sourceListId: "L",
      name: "x",
      resume: { folderId: 777 },
    });
    expect(types()).not.toContain("magomap.createList");
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.addPlaces")?.[0].folderId).toBe(777);
    expect(done.folderId).toBe(777);
  });

  /** Her lists as the account check hands them over. */
  const folders = (...lists: { folderid: number; title?: string; status?: string }[]) => ({
    ok: true,
    folders: [{ folderid: 0 }, ...lists],
  });

  it("after a create that got no answer, a retry fills the same-named list that appeared, not a second one", async () => {
    await seed();
    behaves({
      "magomap.account": () => folders({ folderid: 5, title: "사본" }),
      "magomap.createList": () => undefined,
    });
    expect(
      await duplicateToKakao({ sourceListId: "L", name: "사본" }).catch((e) => e),
    ).toMatchObject({
      code: "extension_missing",
    });
    ask.mockClear();
    behaves({
      "magomap.account": () =>
        folders({ folderid: 5, title: "사본" }, { folderid: 888, title: "사본" }),
    });
    const done = await duplicateToKakao({ sourceListId: "L", name: " 사본 " });
    expect(types()).not.toContain("magomap.createList");
    expect(ask.mock.calls.find(([m]) => m.type === "magomap.addPlaces")?.[0].folderId).toBe(888);
    expect(done.folderId).toBe(888);
  });

  it("takes the appeared list after Kakao Map answered the create as unavailable too", async () => {
    await seed();
    behaves({
      "magomap.account": () => folders(),
      "magomap.createList": () => ({ ok: false, error: "kakao_unavailable" }),
    });
    await duplicateToKakao({ sourceListId: "L", name: "x" }).catch(() => undefined);
    ask.mockClear();
    behaves({ "magomap.account": () => folders({ folderid: 888, title: "x" }) });
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    expect(types()).not.toContain("magomap.createList");
  });

  it("makes a new list when nothing new by that exact name appeared, or two did, or the name changed", async () => {
    for (const [after, name] of [
      [folders({ folderid: 5, title: "x" }), "x"],
      [folders({ folderid: 5, title: "x" }, { folderid: 888, title: "x " }), "x"],
      [
        folders(
          { folderid: 5, title: "x" },
          { folderid: 888, title: "x" },
          { folderid: 889, title: "x" },
        ),
        "x",
      ],
      [folders({ folderid: 5, title: "x" }, { folderid: 888, title: "x", status: "D" }), "x"],
      [folders({ folderid: 5, title: "x" }, { folderid: 888, title: "x" }), "y"],
    ] as const) {
      await seed();
      ask.mockReset();
      behaves({
        "magomap.account": () => folders({ folderid: 5, title: "x" }),
        "magomap.createList": () => undefined,
      });
      await duplicateToKakao({ sourceListId: "L", name: "x" }).catch(() => undefined);
      ask.mockClear();
      behaves({ "magomap.account": () => after });
      const done = await duplicateToKakao({ sourceListId: "L", name });
      expect(types()).toContain("magomap.createList");
      expect(done.folderId).toBe(777);
    }
  });

  it("doesn't look for an appeared list after a create Kakao Map refused outright", async () => {
    await seed();
    behaves({
      "magomap.account": () => folders(),
      "magomap.createList": () => ({ ok: false, error: "kakao_signed_out" }),
    });
    await duplicateToKakao({ sourceListId: "L", name: "x" }).catch(() => undefined);
    ask.mockClear();
    behaves({ "magomap.account": () => folders({ folderid: 888, title: "x" }) });
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    expect(types()).toContain("magomap.createList");
  });

  it("looks for an appeared list only once: a later copy by the same name makes its own list", async () => {
    await seed();
    behaves({ "magomap.account": () => folders(), "magomap.createList": () => undefined });
    await duplicateToKakao({ sourceListId: "L", name: "x" }).catch(() => undefined);
    behaves({ "magomap.account": () => folders({ folderid: 888, title: "x" }) });
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    ask.mockClear();
    behaves({ "magomap.account": () => folders({ folderid: 888, title: "x" }) });
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    expect(types()).toContain("magomap.createList");
  });

  it("forgets an unsure create once a resumed copy runs, so a later copy makes its own list", async () => {
    await seed();
    behaves({ "magomap.account": () => folders(), "magomap.createList": () => undefined });
    await duplicateToKakao({ sourceListId: "L", name: "x" }).catch(() => undefined);
    behaves({ "magomap.account": () => folders() });
    await duplicateToKakao({ sourceListId: "L", name: "x", resume: { folderId: 42 } });
    ask.mockClear();
    behaves({ "magomap.account": () => folders({ folderid: 888, title: "x" }) });
    await duplicateToKakao({ sourceListId: "L", name: "x" });
    expect(types()).toContain("magomap.createList");
  });

  it("stops with list_missing, and no list to resume, when the list isn't one of hers any more", async () => {
    await seed();
    behaves({ "magomap.addPlaces": () => ({ ok: false, error: "not_found", added: 0 }) });
    const failure = await duplicateToKakao({
      sourceListId: "L",
      name: "x",
      resume: { folderId: 777 },
    }).catch((e) => e);
    expect(failure).toMatchObject({ code: "list_missing", folderId: undefined });
  });

  it("says the count is only a lower bound when the failed page gave none", async () => {
    await seed();
    await db.places.bulkPut(Array.from({ length: 60 }, (_, i) => place(`m${i}`)));
    await db.place_sources.bulkPut(
      Array.from({ length: 60 }, (_, i) => source(`m${i}`, `${9000 + i}`)),
    );
    await db.list_items.bulkPut(Array.from({ length: 60 }, (_, i) => item("L", `m${i}`, 10 + i)));
    for (const [second, expected] of [
      [() => undefined, { added: 50, atLeast: true }],
      [() => ({ ok: false, error: "kakao_unavailable" }), { added: 50, atLeast: true }],
      [() => ({ ok: false, error: "kakao_unavailable", added: 2 }), { added: 52, atLeast: false }],
    ] as const) {
      let adds = 0;
      ask.mockReset();
      behaves({
        "magomap.addPlaces": (m) => {
          adds += 1;
          return adds === 2
            ? second()
            : { ok: true, added: (m.places as unknown[]).length, skipped: 0 };
        },
      });
      const failure = await duplicateToKakao({ sourceListId: "L", name: "x" }).catch((e) => e);
      expect(failure).toMatchObject({ code: "partial", folderId: 777, ...expected });
    }
  });

  it("makes one list when called twice at once", async () => {
    await seed();
    behaves();
    const first = duplicateToKakao({ sourceListId: "L", name: "x" });
    const second = duplicateToKakao({ sourceListId: "L", name: "x" }).catch((e) => e);
    expect(await second).toMatchObject({ code: "busy" });
    await first;
    expect(types().filter((t) => t === "magomap.createList")).toHaveLength(1);
  });

  it("still reports the copy when the sync afterwards fails", async () => {
    await seed();
    behaves();
    sync.mockRejectedValueOnce(new Error("boom"));
    expect(await duplicateToKakao({ sourceListId: "L", name: "x" })).toMatchObject({
      folderId: 777,
      synced: false,
    });
  });

  it("refuses a list that isn't a Kakao list", async () => {
    await seed(null);
    behaves();
    await expect(duplicateToKakao({ sourceListId: "L", name: "x" })).rejects.toThrow();
    expect(ask).not.toHaveBeenCalled();
  });
});
