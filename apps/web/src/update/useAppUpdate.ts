import { useRegisterSW } from "virtual:pwa-register/react";
import { useEffect, useSyncExternalStore } from "react";
import { runBeforeUpdate } from "./beforeUpdate";
import { dueForCheck, onUpdateFound } from "./timing";

// One registration for the whole app: the state lives here, outside React, so the banner and the
// About card read the same thing. https://vite-pwa-org.netlify.app/frameworks/react.html
interface State {
  waiting: boolean;
  dismissed: boolean;
  /** Update was tapped and the reload hasn't happened yet. */
  updating: boolean;
}
const INITIAL: State = { waiting: false, dismissed: false, updating: false };
/** If no reload follows an Update tap by then, Update becomes available again. */
const UPDATING_GIVE_UP_MS = 10_000;
let state: State = INITIAL;
let registration: ServiceWorkerRegistration | undefined;
let applyWaiting: ((reloadPage?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

async function update(): Promise<void> {
  // A second tap while the first is still saving drafts or reloading does nothing.
  if (state.updating) return;
  set({ updating: true });
  // The page normally reloads once the new version takes over. If it doesn't (no reload
  // follows), don't leave a dead button.
  setTimeout(() => set({ updating: false }), UPDATING_GIVE_UP_MS);
  await runBeforeUpdate();
  await applyWaiting?.(true);
}
function dismiss() {
  set({ dismissed: true });
}

/** For tests: forget everything the store learned. */
export function resetAppUpdate() {
  state = INITIAL;
  registration = undefined;
  applyWaiting = undefined;
}

/** Ask the server now whether a new version exists. Does nothing before a registration is kept. */
export function checkForUpdate(): void {
  registration?.update().catch(() => {});
}

/**
 * Registers the service worker and watches for new versions. Mounted once, by UpdateRegistration.
 * Found within the cold-start window: applied at once. Later: she is asked; the app never
 * reloads by itself then.
 */
export function useRegisterUpdates() {
  const { updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg;
    },
    onNeedRefresh() {
      if (onUpdateFound(performance.now()) === "apply") void update();
      else set({ waiting: true });
    },
  });
  applyWaiting = updateServiceWorker;

  useEffect(() => {
    let last = Date.now();
    const check = () => {
      last = Date.now();
      checkForUpdate();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && dueForCheck(Date.now(), last)) check();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
}

export function useAppUpdate(): {
  waiting: boolean;
  updating: boolean;
  update: () => Promise<void>;
  dismissed: boolean;
  dismiss: () => void;
} {
  const s = useSyncExternalStore(subscribe, () => state);
  return { waiting: s.waiting, updating: s.updating, dismissed: s.dismissed, update, dismiss };
}
