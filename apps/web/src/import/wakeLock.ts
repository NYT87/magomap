// Keeps the screen on while an import runs, so the phone doesn't sleep and stop it.
// https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API

/** Holds the screen on until the returned function is called. Does nothing where unsupported. */
export function holdScreenOn(): () => void {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return () => {};
  let held = true;
  let sentinel: WakeLockSentinel | null = null;

  const acquire = async () => {
    try {
      const next = await navigator.wakeLock.request("screen");
      if (held) sentinel = next;
      else await next.release();
    } catch {
      // Refused (power saving, hidden page): the import still works, the screen may just sleep.
    }
  };
  // The browser drops the lock when the page is hidden; ask again when it is back.
  const onVisible = () => {
    if (held && document.visibilityState === "visible") void acquire();
  };

  document.addEventListener("visibilitychange", onVisible);
  void acquire();
  return () => {
    held = false;
    document.removeEventListener("visibilitychange", onVisible);
    const current = sentinel;
    sentinel = null;
    current?.release().catch(() => {});
  };
}
