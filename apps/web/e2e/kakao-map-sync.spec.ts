import { type BrowserContext, expect, type Page, test } from "@playwright/test";

// Sync from Kakao Map with the magomap extension stubbed: an init script gives the page a fake
// `chrome.runtime.sendMessage` that answers ping and read with a synthetic read (folder 0 with one
// favourite, and a folder with 537, so the upload sends two pages for it). What the read returns is
// switched through sessionStorage, which survives reloads.
// Init scripts: https://playwright.dev/docs/api/class-page#page-add-init-script

const SHOTS = "../../tmp/review-shots/kakao-direct-sync-7";
const MODE = "e2e.kakaoMapMode";

type Mode = "mine" | "other" | "signed_out";

interface Stub {
  /** Kakao Map account ids: hers, and the one a different person is signed in with. */
  mine: string;
  other: string;
  /** The big folder's id and the first favourite key: apart per test, so nothing is shared. */
  folder: number;
  keyBase: number;
}

/** Installs the fake extension for every page load from now on. */
async function stubExtension(page: Page, stub: Stub) {
  await page.addInitScript(
    ({ stub, MODE }) => {
      const read = (account: string, nickname: string) => {
        const folder = (folderid: number) => ({
          folderid,
          title: folderid === 0 ? "즐겨찾기" : "제주 가볼 곳",
          status: "O",
          subscribe: "N",
          kakao_map_user_id: account,
          nickname,
        });
        const favorites = (folderid: number, n: number, from: number) =>
          Array.from({ length: n }, (_, i) => ({
            seq: from + i,
            key: String(from + i),
            type: "PLACE",
            display1: `장소 ${i + 1}`,
            display2: "제주 애월읍",
            lat: 33.4 + (i % 50) / 1000,
            lon: 126.3 + Math.floor(i / 50) / 1000,
            color: "01",
            folderid,
          }));
        return {
          ok: true,
          start: {
            folders: [folder(0), folder(stub.folder)],
            counts: [
              { folderid: 0, itemCount: 1 },
              { folderid: stub.folder, itemCount: 537 },
            ],
          },
          favorites: {
            "0": favorites(0, 1, stub.keyBase),
            [String(stub.folder)]: favorites(stub.folder, 537, stub.keyBase + 1),
          },
        };
      };
      const sendMessage = (
        _id: string,
        message: { type?: string },
        callback: (response: unknown) => void,
      ) => {
        const mode = sessionStorage.getItem(MODE) ?? "mine";
        let answer: unknown;
        if (message.type === "magomap.ping") answer = { ok: true, version: "0.1.0" };
        else if (mode === "signed_out") answer = { ok: false, error: "kakao_signed_out" };
        else answer = mode === "other" ? read(stub.other, "민수") : read(stub.mine, "수지");
        setTimeout(() => callback(answer), 50);
      };
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: { runtime: { sendMessage } },
      });
    },
    { stub, MODE },
  );
}

const setMode = (page: Page, mode: Mode) =>
  page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [MODE, mode] as const);

async function signIn(context: BrowserContext, kakaoUserId: string, nickname: string) {
  await context.clearCookies();
  const res = await context.request.post("/api/auth/dev", { data: { kakaoUserId, nickname } });
  if (!res.ok()) throw new Error(`dev login ${res.status()}`);
}

/** Light and dark shots of what is on screen now. */
async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({
      path: `${SHOTS}/${test.info().project.name}-${name}-${scheme}.png`,
      fullPage: false,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const isComplete = (url: string, method: string) =>
  method === "POST" && /\/api\/import\/runs\/[^/]+\/complete$/.test(new URL(url).pathname);

/** Scrolls the section into view, so the shots show it. */
const showSection = (page: Page, name: string | RegExp) =>
  page.getByRole("region", { name }).scrollIntoViewIfNeeded();

test("syncs from Kakao Map through the extension: confirm, pages, done, mismatch, signed out", async ({
  page,
  context,
}, info) => {
  const phone = info.project.name === "phone";
  await signIn(context, phone ? "444" : "445", "José");
  const sync = page.getByRole("region", { name: "Sync from Kakao Map" });

  // No extension: the desktop says how to get it, the phone that it works on a computer.
  await page.goto("/account");
  if (phone) await expect(sync).toContainText("Syncing from Kakao Map happens on a computer.");
  else await expect(sync.getByRole("link", { name: /Get the magomap extension/ })).toBeVisible();
  await showSection(page, "Sync from Kakao Map");
  await shoot(page, "en-missing");

  await stubExtension(page, {
    mine: phone ? "km-phone-1111" : "km-desktop-2222",
    other: "km-someone-9999",
    folder: phone ? 870_001 : 870_002,
    keyBase: phone ? 97_100_000 : 97_200_000,
  });
  await page.goto("/account");
  const button = sync.getByRole("button", { name: "Sync from Kakao Map" });

  // Signed out of Kakao Map: nothing is sent.
  await setMode(page, "signed_out");
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/import/")) uploads.push(new URL(r.url()).pathname);
  });
  await button.click();
  await expect(sync.getByRole("alert")).toContainText("Sign in to Kakao Map in this browser");
  await expect(sync.getByRole("link", { name: /Open Kakao Map/ })).toHaveAttribute(
    "href",
    "https://map.kakao.com",
  );
  expect(uploads.filter((p) => p.includes("/kakao-map/"))).toEqual([]);
  await showSection(page, "Sync from Kakao Map");
  await shoot(page, "en-signed-out");

  // First sync: the confirmation names both accounts.
  await setMode(page, "mine");
  await button.click();
  const confirm = page.getByRole("alertdialog");
  const tail = phone ? "1111" : "2222";
  await expect(confirm).toContainText(
    `Sync 수지's Kakao Map account ending in ${tail} into José's magomap?`,
  );
  await expect(confirm).toContainText("If you cancel, nothing changes.");
  await shoot(page, "en-confirm");

  const pages: number[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/kakao-map\/runs\/[^/]+\/lists\/[^/]+\/pages\/\d+$/.test(r.url())
    ) {
      pages.push((r.postDataJSON() as { favorites: unknown[] }).favorites.length);
    }
  });
  const completed = page.waitForResponse((r) => isComplete(r.url(), r.request().method()), {
    timeout: 45_000,
  });
  await confirm.getByRole("button", { name: "Sync", exact: true }).click();
  expect((await completed).ok()).toBe(true);
  await expect(sync.getByText("Synced with Kakao Map")).toBeVisible({ timeout: 30_000 });
  await expect(sync).toContainText("538 added");
  // Folder 0's one favourite, then 537 in pages of 500 and 37.
  expect(pages).toEqual([1, 500, 37]);
  await showSection(page, "Sync from Kakao Map");
  await shoot(page, "en-done");

  // The lists arrived.
  await page.goto("/lists");
  await expect(page.getByText("제주 가볼 곳").first()).toBeVisible();

  // Another Kakao Map account in this browser: refused, with a way to switch.
  await page.goto("/account");
  await expect(sync).toContainText("Last sync:");
  await setMode(page, "other");
  await button.click();
  const mismatch = page.getByRole("alertdialog");
  await expect(mismatch).toContainText(
    `Your magomap syncs from 수지's Kakao Map account ending in ${tail}, but this browser is signed in to 민수's Kakao Map account ending in 9999. Sign in to yours, or switch to this account.`,
  );
  await expect(mismatch).toContainText(
    "Your notes and saved places stay. Lists that aren't in this Kakao Map account will show as “Removed from Kakao” after the sync.",
  );
  await expect(mismatch.getByRole("link", { name: /Sign in to yours/ })).toBeVisible();
  await expect(mismatch.getByRole("button", { name: "Switch to this account" })).toBeVisible();
  await shoot(page, "en-mismatch");
  await mismatch.getByRole("button", { name: "Cancel" }).click();
  await expect(mismatch).toBeHidden();
});

test("Korean: the same states read naturally", async ({ page, context }, info) => {
  const phone = info.project.name === "phone";
  await signIn(context, phone ? "446" : "447", "호세");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "ko"));
  // No extension yet: both sections, the kakao-list import as the fallback.
  await page.goto("/account");
  await expect(page.getByRole("region", { name: "카카오맵에서 동기화" })).toContainText(
    phone ? "카카오맵 동기화는 컴퓨터에서 해요." : "magomap 확장 프로그램 받기",
  );
  await showSection(page, "카카오맵에서 동기화");
  await shoot(page, "ko-missing");
  await stubExtension(page, {
    mine: phone ? "km-phone-ko-3333" : "km-desktop-ko-4444",
    other: "km-someone-ko-8888",
    folder: phone ? 870_003 : 870_004,
    keyBase: phone ? 97_300_000 : 97_400_000,
  });
  await page.goto("/account");
  const sync = page.getByRole("region", { name: "카카오맵에서 동기화" });
  const button = sync.getByRole("button", { name: "카카오맵에서 동기화" });

  await setMode(page, "signed_out");
  await button.click();
  await expect(sync.getByRole("alert")).toContainText("카카오맵에 로그인한 뒤");
  await showSection(page, "카카오맵에서 동기화");
  await shoot(page, "ko-signed-out");

  await setMode(page, "mine");
  await button.click();
  const confirm = page.getByRole("alertdialog");
  const tail = phone ? "3333" : "4444";
  await expect(confirm).toContainText(
    `수지님의 카카오맵 계정(끝자리 ${tail})을 호세님의 magomap에 동기화할까요?`,
  );
  await shoot(page, "ko-confirm");
  const completed = page.waitForResponse((r) => isComplete(r.url(), r.request().method()), {
    timeout: 45_000,
  });
  await confirm.getByRole("button", { name: "동기화", exact: true }).click();
  expect((await completed).ok()).toBe(true);
  await expect(sync.getByText("카카오맵과 동기화했어요")).toBeVisible({ timeout: 30_000 });
  await showSection(page, "카카오맵에서 동기화");
  await shoot(page, "ko-done");

  await setMode(page, "other");
  await sync.getByRole("button", { name: "다시 동기화" }).click();
  const mismatch = page.getByRole("alertdialog");
  await expect(mismatch).toContainText(
    `내 magomap은 수지님의 카카오맵 계정(끝자리 ${tail})에서 동기화해요. 지금 이 브라우저는 민수님의 카카오맵 계정(끝자리 8888)으로 로그인되어 있어요.`,
  );
  await expect(mismatch).toContainText(
    "메모와 저장한 장소는 그대로 남아요. 이 카카오맵 계정에 없는 리스트는 동기화 후 '카카오에서 삭제됨'으로 표시돼요.",
  );
  await shoot(page, "ko-mismatch");
  await mismatch.getByRole("button", { name: "취소" }).click();
});
