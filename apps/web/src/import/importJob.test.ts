import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runImport = vi.fn();
vi.mock("./runImport", async (original) => ({
  ...(await original<typeof import("./runImport")>()),
  runImport: (...args: unknown[]) => runImport(...args),
}));
const release = vi.fn();
const holdScreenOn = vi.fn(() => release);
vi.mock("./wakeLock", () => ({ holdScreenOn: () => holdScreenOn() }));
const { openUserDb } = await import("../data/db");
const { ME_CHANGED } = await import("../auth/useMe");
const { ImportError } = await import("./runImport");
const { currentImportJob, forgetImportJob, startImportJob, subscribeImportJob } = await import(
  "./importJob"
);

beforeEach(() => {
  openUserDb("A");
});

afterEach(() => {
  forgetImportJob();
  runImport.mockReset();
  holdScreenOn.mockClear();
  release.mockClear();
});

describe("importJob", () => {
  it("holds the screen on from start to end, whoever is looking", async () => {
    let finish: (v: unknown) => void = () => {};
    runImport.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const job = startImportJob();
    expect(currentImportJob()).toBe(job);
    await Promise.resolve();
    expect(holdScreenOn).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    finish({ placesAdded: 1 });
    await expect(job.promise).resolves.toMatchObject({ summary: { placesAdded: 1 } });
    expect(release).toHaveBeenCalledTimes(1);
    expect(currentImportJob()).toBeNull();
  });

  it("keeps one job: a second start returns the running one", () => {
    runImport.mockReturnValue(new Promise(() => {}));
    const first = startImportJob();
    expect(startImportJob("r9")).toBe(first);
    expect(holdScreenOn).toHaveBeenCalledTimes(1);
  });

  it("publishes the run id and progress as they become known", async () => {
    runImport.mockImplementation(
      async (
        onProgress: (p: { listIndex: number; listCount: number }) => void,
        opts: { onRun: (id: string) => void },
      ) => {
        opts.onRun("r1");
        onProgress({ listIndex: 1, listCount: 3 });
        return {};
      },
    );
    const seen = vi.fn();
    const stop = subscribeImportJob(() => seen(currentImportJob()));
    await startImportJob().promise;
    stop();
    expect(seen.mock.calls.map((c) => c[0])).toContainEqual(
      expect.objectContaining({ runId: "r1", current: 2, total: 3 }),
    );
  });

  it("lets go of the screen when the import fails", async () => {
    runImport.mockRejectedValue(new Error("boom"));
    await expect(startImportJob().promise).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledTimes(1);
    expect(currentImportJob()).toBeNull();
  });

  it("keeps each account's job apart, so another account can start its own", async () => {
    let finishA: (v: unknown) => void = () => {};
    runImport.mockReturnValueOnce(new Promise((resolve) => (finishA = resolve)));
    const a = startImportJob();
    openUserDb("B");
    expect(currentImportJob()).toBeNull();
    runImport.mockReturnValueOnce(new Promise(() => {}));
    const b = startImportJob();
    expect(b).not.toBe(a);
    expect(currentImportJob()).toBe(b);
    await Promise.resolve();
    expect(holdScreenOn).toHaveBeenCalledTimes(2);
    openUserDb("A");
    expect(currentImportJob()).toBe(a);
    finishA({});
    await a.promise;
    expect(release).toHaveBeenCalledTimes(1);
    expect(currentImportJob()).toBeNull();
    openUserDb("B");
    expect(currentImportJob()).toBe(b);
  });

  it("asks again who is signed in when an import ends, so a filled nickname shows", async () => {
    const changed = vi.fn();
    window.addEventListener(ME_CHANGED, changed);
    try {
      runImport.mockResolvedValueOnce({ placesAdded: 1 });
      await startImportJob().promise;
      expect(changed).toHaveBeenCalledTimes(1);
      runImport.mockRejectedValueOnce(new ImportError("start", "up_to_date"));
      await startImportJob().promise.catch(() => {});
      expect(changed).toHaveBeenCalledTimes(2);
      // Signed out: the import says so; nothing sends the open screen to sign-in.
      runImport.mockRejectedValueOnce(new ImportError("list", "signed_out"));
      await startImportJob().promise.catch(() => {});
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(ME_CHANGED, changed);
    }
  });
});
