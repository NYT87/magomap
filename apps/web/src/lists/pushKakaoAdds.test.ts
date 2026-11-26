// Pushing her pending adds to Kakao Map through the extension (#83, task 3).
import type { ListRow, PlaceRow } from "@magomap/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Msg = { type: string; [k: string]: unknown };
const ask = vi.fn<(message: Msg, timeoutMs: number) => Promise<unknown>>();
const detect = vi.fn<() => Promise<"ready" | "missing">>();
const sync = vi.fn(async (_progress: unknown) => ({}));
vi.mock("../import/kakaoMap", () => ({
  askExtension: (m: Msg, t: number) => ask(m, t),
  detectExtension: () => detect(),
  runKakaoMapSync: (p: unknown) => sync(p),
}));
const post = vi.fn<(account: string, path: string, body?: unknown) => Promise<unknown>>();
vi.mock("../import/runImport", async (orig) => {
  const actual = await orig<typeof import("../import/runImport")>();
  return { ...actual, post: (a: string, p: string, b?: unknown) => post(a, p, b) };
});
const { openUserDb } = await import("../data/db");
const { addToKakaoList } = await import("../data/writes");
const { pushKakaoAdds } = await import("./pushKakaoAdds");
const { claimKakaoWrites, releaseKakaoWrites } = await import("./duplicateToKakao");

let n = 0;
let db: ReturnType<typeof openUserDb>;
beforeEach(() => {
  n += 1;
  db = openUserDb(`pka${n}`);
  ask.mockReset();
  detect.mockReset();
  post.mockReset();
  sync.mockClear();
  detect.mockResolvedValue("ready");
  post.mockResolvedValue({ ok: true });
});

const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
const kakaoList = (folder: number): ListRow => ({
  id: `l_kakao_${folder}`,
  provider: "kakao",
  externalId: String(folder),
  name: `리스트 ${folder}`,
  description: null,
  color: null,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: 1,
  ...base,
});
const place = (key: string): PlaceRow => ({
  id: `p_kakao_${key}`,
  title: `장소 ${key}`,
  address: "제주 애월읍",
  roadAddress: `애월로 ${key}`,
  addressSource: null,
  category: null,
  phone: null,
  lat: 33.4627,
  lng: 126.3095,
  providerSnapshotAt: null,
  ...base,
});

/** Her own lists 9 and 8, and places 1, 2 and 3 with Kakao ids. */
async function seed() {
  await db.lists.bulkPut([kakaoList(9), kakaoList(8)]);
  await db.user_lists.bulkPut(
    [9, 8].map((f) => ({
      id: `ul_l_kakao_${f}`,
      listId: `l_kakao_${f}`,
      role: "owner" as const,
      removedAt: null,
      ...base,
    })),
  );
  for (const key of ["1", "2", "3"]) {
    await db.places.put(place(key));
    await db.place_sources.put({
      id: `s_kakao_${key}`,
      placeId: `p_kakao_${key}`,
      provider: "kakao",
      externalId: key,
      ...base,
    });
    await db.user_places.put({
      id: `up_p_kakao_${key}`,
      placeId: `p_kakao_${key}`,
      savedAt: 1,
      ...base,
    });
  }
}

/** An extension that behaves, recording what it was asked. */
const behaves = (over: Partial<Record<string, (m: Msg) => unknown>> = {}) =>
  ask.mockImplementation(async (m) => {
    const custom = over[m.type];
    if (custom) return custom(m);
    if (m.type === "magomap.account") return { ok: true, folders: [{ folderid: 0 }] };
    if (m.type === "magomap.addPlaces") {
      return { ok: true, added: (m.places as unknown[]).length, skipped: 0 };
    }
    return undefined;
  });
const adds = () => ask.mock.calls.filter(([m]) => m.type === "magomap.addPlaces").map(([m]) => m);

describe("pushKakaoAdds", () => {
  it("sends nothing without the extension, or with nothing pending", async () => {
    await seed();
    behaves();
    expect(await pushKakaoAdds(db)).toBe("nothing");
    expect(ask).not.toHaveBeenCalled();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    detect.mockResolvedValue("missing");
    expect(await pushKakaoAdds(db)).toBe("no_extension");
    expect(ask).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("checks the account, adds each list's places by its folder, then syncs once", async () => {
    await seed();
    behaves();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    await addToKakaoList("l_kakao_9", "p_kakao_2");
    await addToKakaoList("l_kakao_8", "p_kakao_3");
    expect(await pushKakaoAdds(db)).toBe("pushed");
    expect(ask.mock.calls[0]?.[0].type).toBe("magomap.account");
    expect(
      adds().map((m) => [m.folderId, (m.places as { key: string }[]).map((p) => p.key)]),
    ).toEqual([
      [8, ["3"]],
      [9, ["1", "2"]],
    ]);
    // Exactly what the extension takes: never magomap's own place ids.
    expect(adds()[0]?.places).toEqual([
      {
        key: "3",
        title: "장소 3",
        address: "애월로 3",
        x: expect.any(Number),
        y: expect.any(Number),
      },
    ]);
    expect(sync).toHaveBeenCalledTimes(1);
    // The sync comes after the adds.
    expect(sync.mock.invocationCallOrder[0]).toBeGreaterThan(
      ask.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY,
    );
  });

  it("marks a list Kakao Map can't find as failed, and still adds to the others", async () => {
    await seed();
    behaves({
      "magomap.addPlaces": (m) =>
        m.folderId === 8
          ? { ok: false, error: "not_found", added: 0 }
          : { ok: true, added: (m.places as unknown[]).length, skipped: 0 },
    });
    await addToKakaoList("l_kakao_8", "p_kakao_3");
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect(await pushKakaoAdds(db)).toBe("pushed");
    expect((await db.kakao_adds.get("ka_l_kakao_8_p_kakao_3"))?.failed).toBe("list_missing");
    expect((await db.kakao_adds.get("ka_l_kakao_9_p_kakao_1"))?.failed).toBeNull();
    expect(adds().map((m) => m.folderId)).toEqual([8, 9]);
    expect(sync).toHaveBeenCalledTimes(1);
    // A failed add isn't sent again.
    ask.mockClear();
    behaves();
    await pushKakaoAdds(db);
    expect(adds().map((m) => m.folderId)).toEqual([9]);
  });

  it("stops at any other failure, keeping every add pending for next time", async () => {
    await seed();
    behaves({ "magomap.addPlaces": () => ({ ok: false, error: "kakao_signed_out" }) });
    await addToKakaoList("l_kakao_8", "p_kakao_3");
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect(await pushKakaoAdds(db)).toBe("stopped");
    expect(adds()).toHaveLength(1);
    // Nothing went in, so there's nothing to bring in.
    expect(sync).not.toHaveBeenCalled();
    const rows = await db.kakao_adds.toArray();
    expect(rows.map((r) => [r.deletedAt, r.failed])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("stops before adding when the signed-in Kakao Map account isn't hers", async () => {
    await seed();
    behaves();
    post.mockRejectedValue(new Error("mismatch"));
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect(await pushKakaoAdds(db)).toBe("stopped");
    expect(adds()).toHaveLength(0);
  });

  it("skips a list that is no longer hers to add to, without sending", async () => {
    await seed();
    behaves();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    await db.user_lists.update("ul_l_kakao_9", { role: "follower" });
    expect(await pushKakaoAdds(db)).toBe("nothing");
    expect(ask).not.toHaveBeenCalled();
  });

  it("runs once at a time: a second call while one runs does nothing", async () => {
    await seed();
    let finish: (v: unknown) => void = () => undefined;
    behaves({ "magomap.addPlaces": () => new Promise((r) => (finish = r)) });
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    const first = pushKakaoAdds(db);
    await vi.waitFor(() => expect(adds()).toHaveLength(1));
    expect(await pushKakaoAdds(db)).toBe("busy");
    finish({ ok: true, added: 1, skipped: 0 });
    expect(await first).toBe("pushed");
  });

  /** Seeds `count` more places with Kakao ids, all pending for list 9. */
  async function manyPending(count: number) {
    for (let i = 0; i < count; i++) {
      const key = String(1000 + i);
      await db.places.put(place(key));
      await db.place_sources.put({
        id: `s_kakao_${key}`,
        placeId: `p_kakao_${key}`,
        provider: "kakao",
        externalId: key,
        ...base,
      });
      await db.user_places.put({
        id: `up_p_kakao_${key}`,
        placeId: `p_kakao_${key}`,
        savedAt: 1,
        ...base,
      });
      await addToKakaoList("l_kakao_9", `p_kakao_${key}`);
    }
  }

  it("sends a list's places 50 at a time", async () => {
    await seed();
    behaves();
    await manyPending(60);
    expect(await pushKakaoAdds(db)).toBe("pushed");
    expect(adds().map((m) => (m.places as unknown[]).length)).toEqual([50, 10]);
  });

  it("stopping on the second page keeps what wasn't sent pending, and brings in what was", async () => {
    await seed();
    let page = 0;
    behaves({
      "magomap.addPlaces": (m) => {
        page += 1;
        return page === 2
          ? undefined
          : { ok: true, added: (m.places as unknown[]).length, skipped: 0 };
      },
    });
    await manyPending(60);
    expect(await pushKakaoAdds(db)).toBe("stopped");
    expect(sync).toHaveBeenCalledTimes(1);
    const rows = await db.kakao_adds.toArray();
    expect(rows.every((r) => r.deletedAt == null && r.failed == null)).toBe(true);
  });

  it("a list gone on the second page marks only the places not sent yet", async () => {
    await seed();
    let page = 0;
    behaves({
      "magomap.addPlaces": (m) => {
        page += 1;
        return page === 2
          ? { ok: false, error: "not_found", added: 0 }
          : { ok: true, added: (m.places as unknown[]).length, skipped: 0 };
      },
    });
    await manyPending(60);
    expect(await pushKakaoAdds(db)).toBe("pushed");
    const failed = (await db.kakao_adds.toArray()).filter((r) => r.failed === "list_missing");
    expect(failed).toHaveLength(10);
  });

  it("marks a place it can't send (no location), and sends the rest", async () => {
    await seed();
    behaves();
    await db.places.update("p_kakao_2", { lat: null, lng: null });
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    await addToKakaoList("l_kakao_9", "p_kakao_2");
    expect(await pushKakaoAdds(db)).toBe("pushed");
    expect((await db.kakao_adds.get("ka_l_kakao_9_p_kakao_2"))?.failed).toBe("cant_send");
    expect(adds().map((m) => (m.places as { key: string }[]).map((p) => p.key))).toEqual([["1"]]);
    // Nothing to send next time: no extension check, no account check.
    ask.mockClear();
    await db.kakao_adds.update("ka_l_kakao_9_p_kakao_1", { deletedAt: 5 });
    expect(await pushKakaoAdds(db)).toBe("nothing");
    expect(ask).not.toHaveBeenCalled();
  });

  it("doesn't mark a list gone when the signed-in Kakao Map account has changed meanwhile", async () => {
    await seed();
    behaves({ "magomap.addPlaces": () => ({ ok: false, error: "not_found", added: 0 }) });
    // The first account check passes; the one after not_found doesn't.
    post.mockResolvedValueOnce({ ok: true }).mockRejectedValue(new Error("mismatch"));
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect(await pushKakaoAdds(db)).toBe("stopped");
    expect((await db.kakao_adds.get("ka_l_kakao_9_p_kakao_1"))?.failed).toBeNull();
  });

  it("stops, writing nothing more, when the open account changes during a push", async () => {
    await seed();
    let release: (v: unknown) => void = () => undefined;
    behaves({ "magomap.addPlaces": () => new Promise((r) => (release = r)) });
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    await addToKakaoList("l_kakao_8", "p_kakao_3");
    const running = pushKakaoAdds(db);
    await vi.waitFor(() => expect(adds()).toHaveLength(1));
    openUserDb(`pka-other${n}`);
    release({ ok: true, added: 1, skipped: 0 });
    expect(await running).toBe("stopped");
    // List 9's add went no further, and no sync ran for the other account.
    expect(adds()).toHaveLength(1);
    expect(sync).not.toHaveBeenCalled();
  });

  it("waits while Copy to Kakao Map is writing", async () => {
    await seed();
    behaves();
    await addToKakaoList("l_kakao_9", "p_kakao_1");
    expect(claimKakaoWrites()).toBe(true);
    try {
      expect(await pushKakaoAdds(db)).toBe("busy");
      expect(ask).not.toHaveBeenCalled();
    } finally {
      releaseKakaoWrites();
    }
  });
});
