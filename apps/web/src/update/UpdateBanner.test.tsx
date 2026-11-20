import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { AboutSection } from "../screens/AboutSection";
import { registerBeforeUpdate } from "./beforeUpdate";
import { UpdateBanner } from "./UpdateBanner";
import { UpdateRegistration } from "./UpdateRegistration";
import { checkForUpdate, resetAppUpdate } from "./useAppUpdate";

const sw = vi.hoisted(() => ({
  options: {} as {
    onRegisteredSW?: (url: string, reg: unknown) => void;
    onNeedRefresh?: () => void;
    immediate?: boolean;
  },
  calls: 0,
  updateServiceWorker: vi.fn(async (_reload?: boolean) => {}),
}));
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: typeof sw.options) => {
    sw.calls++;
    sw.options = options;
    return {
      needRefresh: [false, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: sw.updateServiceWorker,
    };
  },
}));

let sinceLoad = 10_000;
beforeEach(() => {
  resetAppUpdate();
  sw.updateServiceWorker.mockClear();
  sw.calls = 0;
  sinceLoad = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => sinceLoad);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const found = () => act(() => sw.options.onNeedRefresh?.());

describe("UpdateBanner", () => {
  it("the banner never registers; mounting it again doesn't register again", () => {
    const reg = render(<UpdateRegistration />);
    const first = render(<UpdateBanner />);
    first.unmount();
    const second = render(<UpdateBanner />);
    second.unmount();
    render(<UpdateBanner />);
    expect(sw.calls).toBe(1);
    reg.unmount();
  });

  it("no banner without a waiting update", () => {
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("banner says a new version is ready, and Update runs the hooks then updateServiceWorker(true)", async () => {
    const order: string[] = [];
    const off = registerBeforeUpdate(async () => {
      order.push("hook");
    });
    sw.updateServiceWorker.mockImplementation(async () => {
      order.push("update");
    });
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    expect(sw.options.immediate).toBe(true);
    found();
    expect(await screen.findByText("A new version is ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(order).toEqual(["hook", "update"]);
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
    off();
  });

  it("Dismiss hides it for the session", async () => {
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    found();
    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText("A new version is ready")).toBeNull();
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
    expect(document.body).not.toHaveFocus();
    // Focus rests on the banner's slot, which holds the live region.
    expect(screen.getByRole("status").closest(".mm-update-slot")).toHaveFocus();
  });

  it("an update found within the first 3 s applies at once, without a banner", async () => {
    sinceLoad = 1200;
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    found();
    await vi.waitFor(() => expect(sw.updateServiceWorker).toHaveBeenCalledWith(true));
    expect(screen.queryByText("A new version is ready")).toBeNull();
  });

  it("returning to the foreground asks the registration to check every time", () => {
    const reg = { update: vi.fn(async () => undefined) };
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    act(() => sw.options.onRegisteredSW?.("/sw.js", reg));
    for (let i = 0; i < 2; i++) {
      document.dispatchEvent(new Event("visibilitychange"));
    }
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it("the 30-minute check: one update() when visible after 31 min, none while hidden", async () => {
    vi.useFakeTimers();
    const reg = { update: vi.fn(async () => undefined) };
    render(<UpdateRegistration />);
    act(() => sw.options.onRegisteredSW?.("/sw.js", reg));
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    });
    expect(reg.update).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("checkForUpdate asks the kept registration, and is a no-op without one", () => {
    expect(() => checkForUpdate()).not.toThrow();
    const reg = { update: vi.fn(async () => undefined) };
    render(<UpdateRegistration />);
    act(() => sw.options.onRegisteredSW?.("/sw.js", reg));
    checkForUpdate();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("About checks for an update when it opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const reg = { update: vi.fn(async () => undefined) };
    render(<UpdateRegistration />);
    act(() => sw.options.onRegisteredSW?.("/sw.js", reg));
    render(<AboutSection />);
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("About offers Update only while one is waiting, even after Later", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
        <AboutSection />
      </>,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    found();
    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("only the message is in the live region, not the buttons", async () => {
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    await found();
    expect(status).toHaveTextContent("A new version is ready");
    expect(status.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("Update says it is updating, and a second tap does nothing", async () => {
    let finish: () => void = () => {};
    const off = registerBeforeUpdate(() => new Promise<void>((resolve) => (finish = resolve)));
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    await found();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Update" }));
    const busy = screen.getByRole("button", { name: "Updating…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Updating…");
    await user.click(busy);
    await act(async () => finish());
    expect(sw.updateServiceWorker).toHaveBeenCalledTimes(1);
    off();
  });

  it("Update becomes available again if no reload follows", async () => {
    render(
      <>
        <UpdateRegistration />
        <UpdateBanner />
      </>,
    );
    await found();
    // Only timers: faking performance.now too would make this look like a cold start.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      screen.getByRole("button", { name: "Update" }).click();
    });
    expect(screen.getByRole("button", { name: "Updating…" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });
    expect(screen.getByRole("button", { name: "Update" })).not.toHaveAttribute("aria-disabled");
  });
});
