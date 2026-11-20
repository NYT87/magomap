import { render, screen } from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";

vi.mock("../auth/useConfig", () => ({
  useConfig: () => ({ kakaoJavascriptKey: null, devLoginEnabled: false }),
}));
const { SignIn } = await import("./SignIn");

describe("SignIn", () => {
  it("offers signing in with a different Kakao account", async () => {
    await i18n.changeLanguage("en");
    render(<SignIn />);
    const link = screen.getByRole("link", { name: "Sign in with a different Kakao account" });
    expect(link).toHaveAttribute("href", "/api/auth/kakao/start?account=other");
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("says when the data was kept on the device", async () => {
    await i18n.changeLanguage("en");
    sessionStorage.setItem("mm.removeResult", "kept");
    render(<SignIn />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Some changes hadn't reached the server, so your data was kept on this device.",
    );
  });

  it("finishes removing data it couldn't remove before", async () => {
    await i18n.changeLanguage("en");
    const db = new Dexie("magomap-u9");
    db.version(1).stores({ outbox: "++seq" });
    await db.open();
    db.close();
    localStorage.setItem("mm.pendingRemoval", JSON.stringify(["u9"]));
    sessionStorage.setItem("mm.removeResult", "pending");
    render(<SignIn />);
    expect(screen.getByRole("status")).toHaveTextContent(/still being removed/);
    await vi.waitFor(async () => expect(await Dexie.exists("magomap-u9")).toBe(false));
    await vi.waitFor(() => expect(localStorage.getItem("mm.pendingRemoval")).toBeNull());
  });
});
