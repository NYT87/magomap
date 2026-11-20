import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

const sw = vi.hoisted(() => ({ calls: 0, immediate: undefined as boolean | undefined }));
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: { immediate?: boolean }) => {
    sw.calls++;
    sw.immediate = options.immediate;
    return {
      needRefresh: [false, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: async () => {},
    };
  },
}));

import { App } from "./App";

beforeEach(() => {
  sw.calls = 0;
});

describe("App", () => {
  it("registers the service worker on the sign-in screen, with nobody signed in", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    window.history.pushState({}, "", "/signin");
    render(<App />);
    expect(sw.calls).toBe(1);
    expect(sw.immediate).toBe(true);
    vi.unstubAllGlobals();
  });
});
