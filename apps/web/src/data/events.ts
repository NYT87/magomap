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
/** Holds on, per account database, each until released or timed out. */
const holds = new Map<object, Set<object>>();

/**
 * Keeps `owner`'s (an account database's) local changes from being sent, pulling going on, until
 * the returned release is called or HOLD_MAX_MS pass: while an Undo is offered, what it would
 * take back stays on the device. Another account's sending is never held. When the hold ends,
 * either way, the sync is told to send what waited.
 */
export function holdPushes(owner: object): () => void {
  const hold = {};
  const mine = holds.get(owner) ?? new Set<object>();
  holds.set(owner, mine);
  mine.add(hold);
  const end = () => {
    clearTimeout(timer);
    if (!mine.delete(hold)) return;
    if (mine.size === 0 && holds.get(owner) === mine) holds.delete(owner);
    notifyWrite();
  };
  const timer = setTimeout(end, HOLD_MAX_MS);
  return end;
}

/** Whether `owner`'s sending is held now. */
export function pushesHeld(owner: object): boolean {
  return (holds.get(owner)?.size ?? 0) > 0;
}

/** Ends every hold on `owner` at once (its database closed: nothing of it is held any more). */
export function dropHolds(owner: object) {
  holds.delete(owner);
}
