import { type BrowserContext, expect, type Page } from "@playwright/test";

export async function devLogin(context: BrowserContext, kakaoUserId: string) {
  const res = await context.request.post("/api/auth/dev", {
    data: { kakaoUserId, nickname: "tester" },
  });
  if (!res.ok()) throw new Error(`dev login ${res.status()}`);
}

export const BADA = "p_kakao_27324155"; // 바다정원 카페, favourite 9001 in 제주 카페, with a Kakao note

/** How her Kakao Map looks for one sync: as it is, or changed the way a test needs. */
export type Variant =
  | { name: "base" }
  /** The favourite with this seq is gone from every folder. */
  | { name: "withoutFavourite"; args: [string] }
  /** The favourite with this seq moved this many metres north. */
  | { name: "moved"; args: [string, number] };

interface Favourite {
  seq: number;
  key: string;
  title: string;
  address: string;
  lat: number;
  lon: number;
  memo?: string;
  color: string;
}

/** Her Kakao Map: two folders of her own and one she follows (민수's). */
const FOLDERS: {
  folderid: number;
  title: string;
  owner?: { id: string; nickname: string };
  favourites: Favourite[];
}[] = [
  {
    folderid: 101,
    title: "제주 카페",
    favourites: [
      {
        seq: 9001,
        key: "27324155",
        title: "바다정원 카페",
        address: "제주 애월읍",
        lat: 33.4627,
        lon: 126.3095,
        memo: "창가 자리",
        color: "01",
      },
      {
        seq: 9002,
        key: "8125123",
        title: "돌담 브런치",
        address: "제주 한림읍",
        lat: 33.4101,
        lon: 126.2659,
        color: "03",
      },
    ],
  },
  {
    folderid: 102,
    title: "서울 맛집",
    favourites: [
      {
        seq: 9101,
        key: "11223344",
        title: "명동 칼국수",
        address: "서울 중구 명동",
        lat: 37.5636,
        lon: 126.9852,
        color: "05",
      },
    ],
  },
  {
    folderid: 205,
    title: "민수의 부산 여행",
    owner: { id: "e2e-kakao-map-minsu", nickname: "민수" },
    favourites: [
      {
        seq: 9201,
        key: "55667788",
        title: "해운대 시장",
        address: "부산 해운대구",
        lat: 35.1631,
        lon: 129.1636,
        color: "02",
      },
    ],
  },
];

/**
 * A read as the magomap extension hands it to the page (raw `/folder/list` records and each
 * folder's raw favourites), from Kakao Map account `account`.
 */
export function kakaoMapRead(account: string, variant: Variant = { name: "base" }) {
  const folders = FOLDERS.map((f) => ({
    folderid: f.folderid,
    title: f.title,
    status: "O",
    subscribe: f.owner ? "Y" : "N",
    kakao_map_user_id: f.owner?.id ?? account,
    nickname: f.owner?.nickname ?? "tester",
  }));
  const favorites: Record<string, unknown[]> = {};
  for (const f of FOLDERS) {
    favorites[String(f.folderid)] = f.favourites
      .filter((v) => !(variant.name === "withoutFavourite" && String(v.seq) === variant.args[0]))
      .map((v) => ({
        seq: v.seq,
        key: v.key,
        type: "PLACE",
        display1: v.title,
        display2: v.address,
        lat:
          variant.name === "moved" && String(v.seq) === variant.args[0]
            ? v.lat + variant.args[1] / 111_320
            : v.lat,
        lon: v.lon,
        color: v.color,
        ...(v.memo ? { memo: v.memo } : {}),
        folderid: f.folderid,
      }));
  }
  return {
    ok: true,
    start: {
      folders,
      counts: FOLDERS.map((f) => ({
        folderid: f.folderid,
        itemCount: favorites[String(f.folderid)]?.length ?? 0,
      })),
    },
    favorites,
  };
}

/** Where the fake extension finds the read it answers with (survives reloads, per tab). */
const READ_KEY = "e2e.kakaoMapRead";
const stubbed = new WeakSet<Page>();

/**
 * Gives the page a fake magomap extension, for every load from now on: `chrome.runtime` answers
 * `magomap.ping`, and `magomap.read` with the read stored under READ_KEY.
 * Init scripts: https://playwright.dev/docs/api/class-page#page-add-init-script
 */
async function stubExtension(page: Page) {
  if (stubbed.has(page)) return;
  stubbed.add(page);
  await page.addInitScript((key) => {
    const sendMessage = (
      _id: string,
      message: { type?: string },
      callback: (response: unknown) => void,
    ) => {
      const stored = sessionStorage.getItem(key);
      const answer =
        message.type === "magomap.ping"
          ? { ok: true, version: "0.1.0" }
          : stored
            ? JSON.parse(stored)
            : { ok: false, error: "kakao_signed_out" };
      setTimeout(() => callback(answer), 20);
    };
    Object.defineProperty(window, "chrome", {
      configurable: true,
      value: { runtime: { sendMessage } },
    });
  }, READ_KEY);
}

const isComplete = (url: string, method: string) =>
  method === "POST" && /\/api\/import\/runs\/[^/]+\/complete$/.test(new URL(url).pathname);

/**
 * Syncs the signed-in account from Kakao Map (in Account) through a fake magomap extension, and
 * waits for it to finish. Each magomap account syncs from its own Kakao Map account; the first
 * sync confirms it. Works in English and Korean.
 */
export async function syncFromKakao(page: Page, variant: Variant = { name: "base" }) {
  await stubExtension(page);
  const me = await page.request.get("/api/me");
  if (!me.ok()) throw new Error(`not signed in: ${me.status()}`);
  const { userId } = (await me.json()) as { userId: string };
  await page.goto("/account");
  await page.evaluate(([key, read]) => sessionStorage.setItem(key, read), [
    READ_KEY,
    JSON.stringify(kakaoMapRead(`e2e-kakao-map-${userId}`, variant)),
  ] as const);
  const section = page.getByRole("region", { name: /^(Sync from Kakao Map|카카오맵에서 동기화)$/ });
  const completed = page.waitForResponse((r) => isComplete(r.url(), r.request().method()), {
    timeout: 45_000,
  });
  await section
    .getByRole("button", { name: /^(Sync from Kakao Map|카카오맵에서 동기화)$/ })
    .click();
  // The first sync into this account asks to confirm the Kakao Map account; a failure says why.
  const confirm = page.getByRole("alertdialog");
  const failed = section.getByRole("alert");
  // The losers keep waiting; each settles quietly instead of rejecting unhandled later.
  const settle = <T>(p: Promise<unknown>, value: T) => p.then(() => value).catch(() => "timeout");
  const next = await Promise.race([
    settle(completed, "done"),
    settle(confirm.waitFor({ timeout: 45_000 }), "confirm"),
    settle(failed.waitFor({ timeout: 45_000 }), "failed"),
  ]);
  if (next === "failed") throw new Error(`The sync failed: ${await failed.textContent()}`);
  if (next === "confirm") {
    await confirm.getByRole("button", { name: /^(Sync|동기화)$/ }).click();
  }
  const done = await completed;
  if (!done.ok()) throw new Error(`The sync didn't complete: ${done.status()}`);
  await expect(section.getByText(/^(Synced with Kakao Map|카카오맵과 동기화했어요)$/)).toBeVisible({
    timeout: 30_000,
  });
}

/** Sets the page's root font size, as the device's text size would. */
export async function setRootSize(page: Page, px: number) {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${size}px`;
  }, px);
}

/** Stores the app's language choice (read at start-up), before the next page load. */
export async function setLanguage(page: Page, lang: "en" | "ko") {
  await page.addInitScript((value) => {
    localStorage.setItem("mm.lang", value);
  }, lang);
}
