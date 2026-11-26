import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn(async (_db: unknown) => "pushed");
vi.mock("../lists/pushKakaoAdds", () => ({ pushKakaoAdds: (db: unknown) => push(db) }));
const { openUserDb } = await import("./db");
const { RETRY_AFTER_STOP_MS, startKakaoAddTriggers } = await import("./kakaoAddTriggers");

let n = 0;
beforeEach(() => {
  n += 1;
  push.mockReset();
  push.mockResolvedValue("pushed");
});

const pendingAdd = (failed: "list_missing" | null = null) => ({
  id: "ka_l_kakao_9_p_kakao_1",
  listId: "l_kakao_9",
  placeId: "p_kakao_1",
  failed,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
const settle = () => new Promise((r) => setTimeout(r, 50));

/** Her own Kakao list 9 and place 1, so the pending add can go. */
async function target(db: ReturnType<typeof openUserDb>, removedAtProvider: number | null = null) {
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
  await db.lists.put({
    id: "l_kakao_9",
    provider: "kakao",
    externalId: "9",
    name: "제주",
    description: null,
    color: null,
    ownerName: null,
    removedAtProvider,
    providerSnapshotAt: 1,
    ...base,
  });
  await db.user_lists.put({
    id: "ul_l_kakao_9",
    listId: "l_kakao_9",
    role: "owner",
    removedAt: null,
    ...base,
  });
  await db.places.put({
    id: "p_kakao_1",
    title: "x",
    address: null,
    roadAddress: null,
    addressSource: null,
    category: null,
    phone: null,
    lat: 1,
    lng: 1,
    providerSnapshotAt: null,
    ...base,
  });
}
const showing = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("startKakaoAddTriggers", () => {
  it("pushes this account's adds after the opening delay, only with adds pending", async () => {
    const db = openUserDb(`kat${n}`);
    await target(db);
    await db.kakao_adds.put(pendingAdd());
    const stop = startKakaoAddTriggers(db, 30);
    await new Promise((r) => setTimeout(r, 10));
    expect(push).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith(db));
    stop();
  });

  it("does nothing with nothing pending, or only failed adds", async () => {
    const db = openUserDb(`kat${n}`);
    const stop = startKakaoAddTriggers(db, 0);
    await settle();
    await db.kakao_adds.put(pendingAdd("list_missing"));
    showing("visible");
    await settle();
    expect(push).not.toHaveBeenCalled();
    stop();
  });

  it("doesn't load the push for an add whose list can't take places any more", async () => {
    const db = openUserDb(`kat${n}`);
    await target(db, 5);
    await db.kakao_adds.put(pendingAdd());
    const stop = startKakaoAddTriggers(db, 0);
    await settle();
    expect(push).not.toHaveBeenCalled();
    stop();
  });

  it("pushes when the app comes back into view, not when it's hidden, and not once stopped", async () => {
    const db = openUserDb(`kat${n}`);
    const stop = startKakaoAddTriggers(db, 60_000);
    await target(db);
    await db.kakao_adds.put(pendingAdd());
    showing("hidden");
    await settle();
    expect(push).not.toHaveBeenCalled();
    showing("visible");
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    stop();
    showing("visible");
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("after a push that stopped, waits before trying again", async () => {
    const db = openUserDb(`kat${n}`);
    await target(db);
    await db.kakao_adds.put(pendingAdd());
    let clock = 1_000;
    push.mockResolvedValue("stopped");
    const stop = startKakaoAddTriggers(db, 60_000, () => clock);
    showing("visible");
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    clock += RETRY_AFTER_STOP_MS - 1;
    showing("visible");
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    clock += 1;
    showing("visible");
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    stop();
  });
});
