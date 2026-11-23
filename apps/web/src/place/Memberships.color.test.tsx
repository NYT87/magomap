import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { PLACE, seed } from "./testData";

const detect = vi.fn<() => Promise<"ready" | "missing">>();
vi.mock("../import/kakaoMap", () => ({ detectExtension: () => detect() }));
const setColor = vi.fn();
vi.mock("./setPlaceColor", () => {
  class ColorError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return { ColorError, setPlaceColor: (i: unknown) => setColor(i) };
});
const { Memberships } = await import("./Memberships");
const { ColorError } = await import("./setPlaceColor");

let n = 0;
beforeEach(async () => {
  n += 1;
  detect.mockReset();
  detect.mockResolvedValue("ready");
  setColor.mockReset();
  setColor.mockResolvedValue(undefined);
  await i18n.changeLanguage("en");
});

async function open() {
  const db = openUserDb(`mcolor${n}`);
  await seed(db);
  render(<Memberships placeId={PLACE.id} />);
  await screen.findByText("제주 카페", { selector: ".mm-chip__name" });
  return db;
}
const button = (list: string) => screen.queryByRole("button", { name: `Change colour in ${list}` });

describe("Memberships: changing a colour", () => {
  it("is offered on own lists and Kakao lists he owns, never on one he follows", async () => {
    await open();
    expect(await screen.findByRole("button", { name: "Change colour in 빵 지도" })).toBeEnabled();
    expect(await screen.findByRole("button", { name: "Change colour in 제주 카페" })).toBeEnabled();
    expect(button("가을 산책")).toBeEnabled();
    expect(button("아내의 맛집")).toBeNull();
  });

  it("is off for Kakao lists, with a line saying why, when the extension doesn't answer", async () => {
    detect.mockResolvedValue("missing");
    await open();
    await waitFor(() => expect(button("제주 카페")).toBeDisabled());
    expect(screen.getByText(/needs the magomap extension/i)).toBeInTheDocument();
    expect(button("빵 지도")).toBeEnabled();
  });

  it("opens a labelled group of the 7 Kakao colours with the current one checked", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Change colour in 제주 카페" }));
    const group = screen.getByRole("group", { name: "Colour in 제주 카페" });
    const radios = within(group).getAllByRole("button");
    expect(radios).toHaveLength(7);
    expect(within(group).getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(group).getByRole("button", { name: "Blue" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("moving between colours with the arrow keys changes nothing; only Enter or a click does", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Change colour in 제주 카페" }));
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowLeft}");
    expect(setColor).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(setColor).toHaveBeenCalledTimes(1);
  });

  it("puts focus back on the colour button after a change", async () => {
    const user = userEvent.setup();
    await open();
    const trigger = await screen.findByRole("button", { name: "Change colour in 제주 카페" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Blue" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("choosing a colour changes it and closes the group", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Change colour in 제주 카페" }));
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(setColor).toHaveBeenCalledWith({ itemId: "i_kakao_1_10", color: "05" });
    await waitFor(() => expect(screen.queryByRole("group", { name: /Colour in/ })).toBeNull());
  });

  it("shows why it failed and keeps the group open", async () => {
    setColor.mockRejectedValue(new ColorError("account_mismatch"));
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Change colour in 제주 카페" }));
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/different Kakao Map account/i);
    expect(screen.getByRole("group", { name: "Colour in 제주 카페" })).toBeInTheDocument();
  });

  it("says Kakao Map has the colour when only magomap's own save failed", async () => {
    setColor.mockRejectedValue(new ColorError("server_failed"));
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Change colour in 제주 카페" }));
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Kakao Map has the new colour/i);
  });
});
