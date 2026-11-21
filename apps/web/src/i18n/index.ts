import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ko from "./ko.json";

export type Lang = "ko" | "en";
const KEY = "mm.lang";

/** A stored choice wins; otherwise Korean for a Korean browser, English for everything else. */
export function detectLanguage(browser: string | undefined, stored: string | null): Lang {
  if (stored === "ko" || stored === "en") return stored;
  return browser?.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function storedLang(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLanguage(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // the choice still applies for this session
  }
  void i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: detectLanguage(
    typeof navigator === "undefined" ? undefined : navigator.language,
    storedLang(),
  ),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  initAsync: false,
});

i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
});

/** Dates as the brand asks: long style in the current language. */
export const formatDate = (value: Date | number, lang = i18n.language) =>
  new Intl.DateTimeFormat(lang, { dateStyle: "long" }).format(value);

export const formatDateTime = (value: Date | number, lang = i18n.language) =>
  new Intl.DateTimeFormat(lang, { dateStyle: "long", timeStyle: "short" }).format(value);

export default i18n;
