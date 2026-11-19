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
