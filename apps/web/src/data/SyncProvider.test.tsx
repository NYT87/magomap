import { render } from "@testing-library/react";
import { useContext } from "react";
import { describe, expect, it, vi } from "vitest";
import { NetworkError } from "../api/client";

vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return {
    ...actual,
    apiFetch: vi.fn(async () => {
      throw new NetworkError();
    }),
  };
});
const { openUserDb } = await import("./db");
const { SyncContext } = await import("./SyncContext");
const { SyncProvider } = await import("./SyncProvider");

let controls: { countUnsynced?: () => Promise<number> } = {};
function Probe() {
  controls = useContext(SyncContext);
  return null;
}

describe("SyncProvider", () => {
  it("counts its own account's unsent changes, even after another account opens", async () => {
    openUserDb("sp-a");
    render(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
    const b = openUserDb("sp-b");
    await b.outbox.add({
      mutationId: "m",
      table: "visit_notes",
      id: "n",
      op: "delete",
      clientUpdatedAt: 1,
    });
    expect(await controls.countUnsynced?.()).toBe(0);
  });
});
