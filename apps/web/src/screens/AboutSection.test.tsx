import type { BuildInfo } from "@magomap/domain";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n from "../i18n";
import { AboutSection } from "./AboutSection";

const app: BuildInfo = { version: "0.1.1", commit: "a1b2c3d", builtAt: "2026-11-20T08:30:00.000Z" };

vi.mock("../version", async (orig) => {
  const actual = await orig<typeof import("../version")>();
  return {
    ...actual,
    APP_BUILD: { version: "0.1.1", commit: "a1b2c3d", builtAt: "2026-11-20T08:30:00.000Z" },
  };
});

function health(build: BuildInfo) {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true, db: "ok", ...build })));
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AboutSection", () => {
  it("shows the app and server lines", async () => {
    const fetchStub = health(app);
    vi.stubGlobal("fetch", fetchStub);
    render(<AboutSection />);
    const server = (await screen.findByText("Server")).closest("p, div, li") as HTMLElement;
    const appLine = screen.getByText("App").closest("p, div, li") as HTMLElement;
    await within(server).findByText("0.1.1 · a1b2c3d");
    expect(within(appLine).getByText("0.1.1 · a1b2c3d")).toBeInTheDocument();
    expect(appLine.textContent).toMatch(/built .*2026/);
    expect(server.textContent).toMatch(/built .*2026/);
    expect(screen.queryByText(/older than the server/)).not.toBeInTheDocument();
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("says when the app is older than the server", async () => {
    vi.stubGlobal("fetch", health({ ...app, version: "0.1.2", commit: "e4f5a6b" }));
    render(<AboutSection />);
    expect(await screen.findByText(/The app is older than the server/)).toBeInTheDocument();
  });

  it("says the server is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    render(<AboutSection />);
    expect(await screen.findByText("Server: offline")).toBeInTheDocument();
    expect(screen.queryByText("Server")).not.toBeInTheDocument();
    // Only the app line has a version.
    expect(screen.getAllByText("0.1.1 · a1b2c3d")).toHaveLength(1);
  });

  it("values are plain selectable text", async () => {
    vi.stubGlobal("fetch", health(app));
    render(<AboutSection />);
    await screen.findByText("Server");
    const values = screen.getAllByText("0.1.1 · a1b2c3d");
    expect(values).toHaveLength(2);
    for (const v of values) {
      expect(v.tagName).toBe("CODE");
      expect(v.closest("button")).toBeNull();
    }
  });
});
