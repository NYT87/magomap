// The adapter (loaded only to confirm an account) can't be fetched: the connection dropped
// after the read. Confirming must fail as offline and keep the read for the next try, never
// fall back to a fresh read that confirms nothing.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
vi.mock("../data/sync", () => ({ syncNow: async () => ({}) }));
vi.mock("@magomap/domain/providers/kakaoMap", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});
const { forgetKakaoMapRead, runKakaoMapSync } = await import("./kakaoMap");
const { openUserDb } = await import("../data/db");

const READ = {
  ok: true,
  start: { folders: [{ folderid: 1 }], counts: [{ folderid: 1, itemCount: 0 }] },
  favorites: { "1": [] },
};

beforeEach(() => {
  api.mockReset();
  forgetKakaoMapRead();
  openUserDb("sync-offline");
});
afterEach(() => vi.unstubAllGlobals());

it("a confirmation whose adapter can't load fails as offline and keeps the read", async () => {
  const sendMessage = vi.fn((_id: string, _m: unknown, cb: (r: unknown) => void) => cb(READ));
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  api.mockRejectedValue(
    new ApiError(409, { error: "kakao_account_unconfirmed", account: { idTail: "7800" } }),
  );
  await runKakaoMapSync(() => {}).catch(() => {});
  expect(sendMessage).toHaveBeenCalledTimes(1);
  api.mockClear();

  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(runKakaoMapSync(() => {}, { confirmAccount: "7800" })).rejects.toMatchObject({
      code: "offline",
    });
  }
  // Nothing was posted and Kakao Map wasn't read again: the kept read waits for the next try.
  expect(api).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledTimes(1);
});
