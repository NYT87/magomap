const hooks = new Set<() => Promise<void>>();

/** Something to finish (like saving a half-typed note) before the app reloads for an update. */
export function registerBeforeUpdate(fn: () => Promise<void>): () => void {
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}

/** Runs every hook and waits for them, but never longer than `timeoutMs`; never rejects. */
export async function runBeforeUpdate(timeoutMs = 2000): Promise<void> {
  const all = Promise.allSettled(
    [...hooks].map(async (fn) => {
      await fn();
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([all, limit]);
  } finally {
    clearTimeout(timer);
  }
}
