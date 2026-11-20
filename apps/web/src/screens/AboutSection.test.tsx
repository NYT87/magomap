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

const check = vi.hoisted(() => vi.fn());
vi.mock("../update/useAppUpdate", async (orig) => {
  const actual = await orig<typeof import("../update/useAppUpdate")>();
  return { ...actual, checkForUpdate: check };
});

function health(build: BuildInfo) {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true, db: "ok", ...build })));
}

beforeEach(async () => {
  check.mockClear();
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
    vi.stubGlobal(
      "fetch",
      health({ ...app, version: "0.1.2", commit: "e4f5a6b", builtAt: "2026-11-21T08:30:00.000Z" }),
    );
    render(<AboutSection />);
    expect(await screen.findByText(/The app is older than the server/)).toBeInTheDocument();
  });

  it("checks for an update on opening, and once more when the server is on another commit", async () => {
    vi.stubGlobal("fetch", health({ ...app, commit: "e4f5a6b" }));
    render(<AboutSection />);
    expect(check).toHaveBeenCalledTimes(1);
    await screen.findByText("The app and the server are on different versions.");
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("does not look again when the commits match", async () => {
    vi.stubGlobal("fetch", health(app));
    render(<AboutSection />);
    await screen.findByText("Server");
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("says only that versions differ when the app is not provably older", async () => {
    vi.stubGlobal(
      "fetch",
      health({ ...app, commit: "e4f5a6b", builtAt: "2026-11-19T08:30:00.000Z" }),
    );
    render(<AboutSection />);
    expect(
      await screen.findByText("The app and the server are on different versions."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/older than the server/)).not.toBeInTheDocument();
  });

  it("says nothing about versions when the commits match", async () => {
    vi.stubGlobal("fetch", health({ ...app, builtAt: "2026-11-21T08:30:00.000Z" }));
    render(<AboutSection />);
    await screen.findByText("Server");
    expect(screen.queryByText(/different versions|older than/)).not.toBeInTheDocument();
  });

  it("renders a line without a date when builtAt is invalid", async () => {
    vi.stubGlobal("fetch", health({ ...app, commit: "e4f5a6b", builtAt: "not a date" }));
    render(<AboutSection />);
    const server = (await screen.findByText("Server")).closest("div") as HTMLElement;
    expect(within(server).getByText("0.1.1 · e4f5a6b")).toBeInTheDocument();
    expect(server.textContent).not.toMatch(/built/);
    expect(
      screen.getByText("The app and the server are on different versions."),
    ).toBeInTheDocument();
  });

  it("announces the status: the region exists while loading and holds the note after", async () => {
    vi.stubGlobal(
      "fetch",
      health({ ...app, commit: "e4f5a6b", builtAt: "2026-11-21T08:30:00.000Z" }),
    );
    render(<AboutSection />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    const note = await screen.findByText(/older than the server/);
    expect(region).toContainElement(note);
    expect(within(region).getByText("Server")).toBeInTheDocument();
  });

  it("lists the lines as terms and definitions", async () => {
    vi.stubGlobal("fetch", health(app));
    render(<AboutSection />);
    await screen.findByText("Server");
    expect(screen.getByText("App").tagName).toBe("DT");
    expect(screen.getByText("Server").tagName).toBe("DT");
    for (const v of screen.getAllByText("0.1.1 · a1b2c3d")) expect(v.closest("dd")).not.toBeNull();
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
