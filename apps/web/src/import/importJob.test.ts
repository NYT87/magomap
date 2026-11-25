import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runKakaoMapSync = vi.fn();
vi.mock("./kakaoMap", async (original) => ({
  ...(await original<typeof import("./kakaoMap")>()),
  runKakaoMapSync: (...args: unknown[]) => runKakaoMapSync(...args),
}));
const release = vi.fn();
const holdScreenOn = vi.fn(() => release);
vi.mock("./wakeLock", () => ({ holdScreenOn: () => holdScreenOn() }));
const { openUserDb } = await import("../data/db");
const { ME_CHANGED } = await import("../auth/useMe");
const { KakaoMapSyncError } = await import("./kakaoMap");
const { currentKakaoMapJob, forgetImportJob, startKakaoMapJob, subscribeKakaoMapJob } =
  await import("./importJob");

beforeEach(() => {
  openUserDb("A");
});

afterEach(() => {
  forgetImportJob();
  runKakaoMapSync.mockReset();
  holdScreenOn.mockClear();
  release.mockClear();
});

describe("the Kakao Map sync job", () => {
  it("holds the screen on from start to end, whoever is looking", async () => {
    let finish: (v: unknown) => void = () => {};
    runKakaoMapSync.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const job = startKakaoMapJob();
    expect(currentKakaoMapJob()).toBe(job);
    await Promise.resolve();
    expect(holdScreenOn).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    finish({ placesAdded: 1 });
    await expect(job.promise).resolves.toMatchObject({ placesAdded: 1 });
    expect(release).toHaveBeenCalledTimes(1);
    expect(currentKakaoMapJob()).toBeNull();
  });

  it("keeps one job: a second start returns the running one", () => {
    runKakaoMapSync.mockReturnValue(new Promise(() => {}));
    const first = startKakaoMapJob();
    expect(startKakaoMapJob("1234")).toBe(first);
    expect(holdScreenOn).toHaveBeenCalledTimes(1);
  });

  it("publishes its progress as it goes, and acts for the account it started in", async () => {
    runKakaoMapSync.mockImplementation(
      async (onProgress: (p: { listIndex: number; listCount: number }) => void) => {
        onProgress({ listIndex: 1, listCount: 3 });
        return {};
      },
    );
    const seen = vi.fn();
    const stop = subscribeKakaoMapJob(() => seen(currentKakaoMapJob()));
    await startKakaoMapJob().promise;
    stop();
    expect(seen.mock.calls.map((c) => c[0])).toContainEqual(
      expect.objectContaining({ account: "A", current: 2, total: 3 }),
    );
    expect(runKakaoMapSync).toHaveBeenCalledWith(expect.any(Function), { account: "A" });
  });

  it("lets go of the screen when the sync fails", async () => {
    runKakaoMapSync.mockRejectedValue(new Error("boom"));
    await expect(startKakaoMapJob().promise).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledTimes(1);
    expect(currentKakaoMapJob()).toBeNull();
  });

  it("keeps each account's job apart, so another account can start its own", async () => {
    let finishA: (v: unknown) => void = () => {};
    runKakaoMapSync.mockReturnValueOnce(new Promise((resolve) => (finishA = resolve)));
    const a = startKakaoMapJob();
    openUserDb("B");
    expect(currentKakaoMapJob()).toBeNull();
    runKakaoMapSync.mockReturnValueOnce(new Promise(() => {}));
    const b = startKakaoMapJob();
    expect(b).not.toBe(a);
    expect(currentKakaoMapJob()).toBe(b);
    await Promise.resolve();
    expect(holdScreenOn).toHaveBeenCalledTimes(2);
    openUserDb("A");
    expect(currentKakaoMapJob()).toBe(a);
    finishA({});
    await a.promise;
    expect(release).toHaveBeenCalledTimes(1);
    expect(currentKakaoMapJob()).toBeNull();
    openUserDb("B");
    expect(currentKakaoMapJob()).toBe(b);
  });

  it("asks again who is signed in when a sync ends, unless she was signed out", async () => {
    const changed = vi.fn();
    window.addEventListener(ME_CHANGED, changed);
    try {
      runKakaoMapSync.mockResolvedValueOnce({ placesAdded: 1 });
      await startKakaoMapJob().promise;
      expect(changed).toHaveBeenCalledTimes(1);
      runKakaoMapSync.mockRejectedValueOnce(new KakaoMapSyncError("kakao_signed_out"));
      await startKakaoMapJob().promise.catch(() => {});
      expect(changed).toHaveBeenCalledTimes(2);
      // Signed out of magomap: the sync says so; nothing sends the open screen to sign-in.
      runKakaoMapSync.mockRejectedValueOnce(new KakaoMapSyncError("signed_out"));
      await startKakaoMapJob().promise.catch(() => {});
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(ME_CHANGED, changed);
    }
  });
});
