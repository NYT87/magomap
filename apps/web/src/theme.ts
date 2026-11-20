export type ThemeChoice = "system" | "light" | "dark";

const KEY = "mm.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
// The browser bar colours. Dark is --dark-color-bg in styles/tokens.css and is repeated in the
// inline script in index.html (it runs before any CSS): keep the three in step.
// theme.test.ts fails if this one drifts from tokens.css.
export const LIGHT_BAR = "#1F6F5C";
export const DARK_BAR = "#141816";

const isChoice = (v: unknown): v is ThemeChoice => v === "system" || v === "light" || v === "dark";

// The choice made this session when storage would not take it (private mode); null otherwise.
let sessionChoice: ThemeChoice | null = null;

/** The saved choice for this device; anything unreadable is the device's own setting. */
export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (isChoice(v)) return v;
  } catch {
    // unreadable: fall back to this session's choice
  }
  return sessionChoice ?? "system";
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  const dark = choice === "dark" || (choice === "system" && window.matchMedia(DARK_QUERY).matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? DARK_BAR : LIGHT_BAR);
}

const listeners = new Set<(choice: ThemeChoice) => void>();

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
    sessionChoice = null;
  } catch {
    sessionChoice = choice; // storage is blocked: the choice still holds for this session
  }
  applyTheme(choice);
  for (const cb of [...listeners]) cb(choice);
}

/** Calls back with the current choice when it changes here or in another tab. */
export function onThemeChange(cb: (choice: ThemeChoice) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb(isChoice(e.newValue) ? e.newValue : storedTheme());
    else if (e.key === null) cb(storedTheme()); // storage was cleared
  };
  listeners.add(cb);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Keeps the page in step with the device (while on system) and with other tabs. */
export function followTheme(): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onDevice = () => {
    if (storedTheme() === "system") applyTheme("system");
  };
  media.addEventListener("change", onDevice);
  const stop = onThemeChange(applyTheme);
  return () => {
    media.removeEventListener("change", onDevice);
    stop();
  };
}
