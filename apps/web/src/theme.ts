export type ThemeChoice = "system" | "light" | "dark";

const KEY = "mm.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
// The browser bar colours. Dark is --dark-color-bg in styles/tokens.css and is repeated in the
// inline script in index.html (it runs before any CSS): keep the three in step.
// theme.test.ts fails if this one drifts from tokens.css.
export const LIGHT_BAR = "#1F6F5C";
export const DARK_BAR = "#141816";

const isChoice = (v: unknown): v is ThemeChoice => v === "system" || v === "light" || v === "dark";

/** The saved choice for this device; anything unreadable is the device's own setting. */
export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return isChoice(v) ? v : "system";
  } catch {
    return "system";
  }
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

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // the choice still applies for this session
  }
  applyTheme(choice);
}

/** Keeps the page in step with the device (while on system) and with other tabs. */
export function followTheme(): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onDevice = () => {
    if (storedTheme() === "system") applyTheme("system");
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) applyTheme(isChoice(e.newValue) ? e.newValue : "system");
  };
  media.addEventListener("change", onDevice);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onDevice);
    window.removeEventListener("storage", onStorage);
  };
}
