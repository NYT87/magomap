import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
