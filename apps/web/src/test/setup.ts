import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** jsdom has no matchMedia: answer width queries from a settable viewport width. */
let width = 390;
export function setViewportWidth(w: number) {
  width = w;
}
window.matchMedia = (query: string) => {
  const min = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: min ? width >= Number(min[1]) : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList;
};
