import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn(async () => "pushed");
vi.mock("../lists/pushKakaoAdds", () => ({ pushKakaoAdds: () => push() }));
const { openUserDb } = await import("./db");
const { startKakaoAddTriggers } = await import("./kakaoAddTriggers");

let n = 0;
beforeEach(() => {
  n += 1;
  push.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
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

describe("startKakaoAddTriggers", () => {
  it("pushes a little after opening, and when the app comes back, only with adds pending", async () => {
    const db = openUserDb(`kat${n}`);
    const stop = startKakaoAddTriggers(db);
    await new Promise((r) => setTimeout(r, 0));
    await vi.waitFor(() => expect(push).not.toHaveBeenCalled());
    await db.kakao_adds.put(pendingAdd());
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 20));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("doesn't load the push for adds that already failed", async () => {
    const db = openUserDb(`kat${n}`);
    await db.kakao_adds.put(pendingAdd("list_missing"));
    const stop = startKakaoAddTriggers(db, 0);
    await new Promise((r) => setTimeout(r, 30));
    expect(push).not.toHaveBeenCalled();
    stop();
  });

  it("runs on opening after the delay", async () => {
    const db = openUserDb(`kat${n}`);
    await db.kakao_adds.put(pendingAdd());
    const stop = startKakaoAddTriggers(db, 0);
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    stop();
  });
});
