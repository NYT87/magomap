import { describe, expect, it, vi } from "vitest";
import { registerBeforeUpdate, runBeforeUpdate } from "./beforeUpdate";

describe("before an update", () => {
  it("runs every registered hook and waits for them", async () => {
    let done = 0;
    const a = registerBeforeUpdate(async () => {
      await new Promise((r) => setTimeout(r, 20));
      done++;
    });
    const b = registerBeforeUpdate(async () => {
      done++;
    });
    await runBeforeUpdate();
    expect(done).toBe(2);
    a();
    b();
  });

  it("unregistered hooks don't run", async () => {
    const fn = vi.fn(async () => {});
    registerBeforeUpdate(fn)();
    await runBeforeUpdate();
    expect(fn).not.toHaveBeenCalled();
  });

  it("a hook that rejects or hangs doesn't block", async () => {
    const off = [
      registerBeforeUpdate(() => Promise.reject(new Error("boom"))),
      registerBeforeUpdate(() => new Promise<void>(() => {})),
    ];
    const started = Date.now();
    await expect(runBeforeUpdate(100)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
    for (const o of off) o();
  });
});
