// When to push her pending adds to Kakao Map (#83): a little after the app opens (once the first
// sync has had its turn) and whenever it comes back into view. Only with adds pending: the push
// (and the extension check it makes) is loaded then, never on a device with nothing to send.
// After a push that stopped (signed out of Kakao Map, another account, Kakao unavailable), the
// next try waits a while, so switching tabs doesn't knock on Kakao Map again and again.
import type { MagomapDexie } from "./db";
import { loadLibrary } from "./queries";

/** How long after opening: the first sync of the day goes first. */
const OPEN_DELAY_MS = 3_000;
/** After a push that stopped, the least time before the next try. */
export const RETRY_AFTER_STOP_MS = 5 * 60_000;

export function startKakaoAddTriggers(
  db: MagomapDexie,
  openDelayMs = OPEN_DELAY_MS,
  now: () => number = Date.now,
): () => void {
  let stopped = false;
  let notBefore = 0;
  const run = async () => {
    if (stopped || now() < notBefore) return;
    const stored = await db.kakao_adds
      .filter((a) => a.deletedAt == null && a.failed == null)
      .count();
    if (stored === 0 || stopped) return;
    // Only adds that can still go: one whose list can't take places any more counts as failed.
    const lib = await loadLibrary(db);
    if (!lib.pending.some((p) => p.add.failed == null) || stopped) return;
    const { pushKakaoAdds } = await import("../lists/pushKakaoAdds");
    if (stopped) return;
    const outcome = await pushKakaoAdds(db);
    if (outcome === "stopped") notBefore = now() + RETRY_AFTER_STOP_MS;
  };
  const go = () => {
    // A push that fails leaves everything pending for the next try: nothing to report here.
    run().catch(() => undefined);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") go();
  };
  const timer = setTimeout(go, openDelayMs);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
