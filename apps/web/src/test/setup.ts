import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
  setColorScheme("light");
});

/** jsdom has no matchMedia: answer width queries from a settable viewport width. */
let width = 390;
export function setViewportWidth(w: number) {
  width = w;
}

/** ... and prefers-color-scheme from a settable value, telling listeners when it changes. */
let scheme: "light" | "dark" = "light";
const schemeLists = new Set<{ mql: MediaQueryList; listener: (e: MediaQueryListEvent) => void }>();
export function setColorScheme(next: "light" | "dark") {
  if (next === scheme) return;
  scheme = next;
  for (const { mql, listener } of [...schemeLists]) {
    listener({ matches: mql.matches, media: mql.media } as MediaQueryListEvent);
  }
}

window.matchMedia = (query: string) => {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const colour = /prefers-color-scheme:\s*(light|dark)/.exec(query);
  const mql = {
    get matches() {
      if (colour) return scheme === colour[1];
      return min ? width >= Number(min[1]) : false;
    },
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: (e: MediaQueryListEvent) => void) => {
      if (colour && type === "change") schemeLists.add({ mql, listener });
    },
    removeEventListener: (type: string, listener: (e: MediaQueryListEvent) => void) => {
      if (!colour || type !== "change") return;
      for (const entry of schemeLists) if (entry.listener === listener) schemeLists.delete(entry);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  return mql;
};
