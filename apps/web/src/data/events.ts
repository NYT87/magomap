// A tiny signal so the sync engine can follow local writes without importing the UI.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onWrite(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyWrite() {
  for (const fn of listeners) fn();
}

/** The longest a hold lasts, should its holder never let go. */
const HOLD_MAX_MS = 30_000;
/** Each hold's end time, until released. */
const holds = new Set<{ until: number }>();

/**
 * Keeps local changes from being sent (pulling goes on) until the returned release is called,
 * or HOLD_MAX_MS at most: while an Undo is offered, what it would take back stays on the device.
 * Releasing tells the sync to send what waited.
 */
export function holdPushes(): () => void {
  const hold = { until: Date.now() + HOLD_MAX_MS };
  holds.add(hold);
  return () => {
    if (holds.delete(hold)) notifyWrite();
  };
}

/** Whether a hold is on now. */
export function pushesHeld(): boolean {
  const now = Date.now();
  for (const hold of holds) if (hold.until <= now) holds.delete(hold);
  return holds.size > 0;
}
