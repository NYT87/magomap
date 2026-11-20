import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runImport = vi.fn();
vi.mock("./runImport", () => ({ runImport: (...args: unknown[]) => runImport(...args) }));
const release = vi.fn();
const holdScreenOn = vi.fn(() => release);
vi.mock("./wakeLock", () => ({ holdScreenOn: () => holdScreenOn() }));
const { openUserDb } = await import("../data/db");
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
});
