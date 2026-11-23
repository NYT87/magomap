import type { ListRow } from "@magomap/domain";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { DuplicateDialog } from "./DuplicateDialog";

const source: ListRow = {
  id: "l_kakao_1",
  provider: "kakao",
  externalId: "1",
  name: "제주 카페",
  description: null,
  color: null,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

let n = 0;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
});

async function open(onClose = vi.fn()) {
  const db = openUserDb(`dup-dialog${n}`);
  await db.lists.put(source);
  const location = memoryLocation({ path: "/lists/l_kakao_1", record: true });
  render(
    <Router hook={location.hook}>
      <DuplicateDialog list={source} onClose={onClose} />
    </Router>,
  );
  return { db, onClose, location };
}
const copies = async (db: Awaited<ReturnType<typeof open>>["db"]) =>
  (await db.lists.toArray()).filter((l) => l.id !== source.id);

describe("DuplicateDialog", () => {
  it("starts with the name '<name> (copy)'", async () => {
    await open();
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("제주 카페 (copy)");
  });

  it("starts with '<이름> (복사본)' in Korean", async () => {
    await i18n.changeLanguage("ko");
    await open();
    expect(await screen.findByRole("textbox")).toHaveValue("제주 카페 (복사본)");
  });

  it("disables 'Copy in magomap' for a blank name", async () => {
    const user = userEvent.setup();
    await open();
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.clear(name);
    expect(screen.getByRole("button", { name: "Copy in magomap" })).toBeDisabled();
    await user.type(name, "  ");
    expect(screen.getByRole("button", { name: "Copy in magomap" })).toBeDisabled();
  });

  it("copies once even when confirmed twice quickly, opens the new list, and closes", async () => {
    const user = userEvent.setup();
    const { db, onClose, location } = await open();
    await user.dblClick(await screen.findByRole("button", { name: "Copy in magomap" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const made = await copies(db);
    expect(made).toHaveLength(1);
    expect(location.history?.at(-1)).toBe(`/lists/${encodeURIComponent(made[0]?.id ?? "")}`);
  });

  it("Escape closes without writing", async () => {
    const user = userEvent.setup();
    const { db, onClose } = await open();
    await screen.findByRole("textbox", { name: "Name" });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await copies(db)).toEqual([]);
  });

  it("Cancel closes without writing", async () => {
    const user = userEvent.setup();
    const { db, onClose } = await open();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await copies(db)).toEqual([]);
  });
});
