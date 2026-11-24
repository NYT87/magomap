// Whether Back stays inside magomap. `history.length` can't tell (it counts pages from before the
// app was opened), so every entry the app makes is tagged with its index in `history.state`:
// a push is one more than the page it left, a replace keeps the index, Back and Forward read it
// back. wouter patches pushState/replaceState to fire events of those names, which this listens to.
import "wouter/use-browser-location";

const KEY = "mmIndex";
let current = 0;

const indexOf = (state: unknown): number | undefined => {
  const value = (state as Record<string, unknown> | null)?.[KEY];
  return typeof value === "number" ? value : undefined;
};

/** Tags the current entry with `index`, keeping whatever state the router stored there. */
function tag(index: number) {
  current = index;
  if (indexOf(history.state) === index) return;
  const state = history.state && typeof history.state === "object" ? history.state : {};
  history.replaceState({ ...state, [KEY]: index }, "");
}

if (typeof window !== "undefined") {
  tag(indexOf(history.state) ?? 0);
  addEventListener("pushState", () => tag(current + 1));
  addEventListener("replaceState", () => {
    if (indexOf(history.state) === undefined) tag(current);
  });
  addEventListener("popstate", () => {
    current = indexOf(history.state) ?? 0;
  });
}

/** True when Back would land on an earlier page of this app, not leave it. */
export function canGoBackInApp(): boolean {
  return current > 0;
}

/** Back, when it stays in the app; otherwise replace this entry with `fallback`. */
export function goBackOr(
  navigate: (to: string, options?: { replace?: boolean }) => void,
  fallback: string,
): void {
  if (canGoBackInApp()) history.back();
  else navigate(fallback, { replace: true });
}
