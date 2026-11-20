import { render, screen } from "@testing-library/react";
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
      "Your data was kept on this device: some changes hadn't reached the server, or it couldn't be checked.",
    );
  });

  it("says when the data was removed", async () => {
    await i18n.changeLanguage("en");
    sessionStorage.setItem("mm.removeResult", "removed");
    render(<SignIn />);
    expect(await screen.findByText("Your data was removed from this device.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your data was removed from this device.");
  });
});
