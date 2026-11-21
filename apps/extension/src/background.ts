/**
 * magomap's extension service worker. magomap's web page asks it, through
 * `chrome.runtime.sendMessage(extensionId, message)`, to read her Kakao Map lists. It reads
 * them inside a signed-in map.kakao.com tab and answers with the raw records.
 *
 * Messages:
 * - `{ type: "magomap.ping" }` → `{ ok: true, version }`
 * - `{ type: "magomap.read" }` → `{ ok: true, start, favorites }`, or
 *   `{ ok: false, error: "kakao_signed_out" | "kakao_unavailable" | "busy" }`
 *
 * Only magomap's own origins are answered: the list in origins.ts, which the build also writes
 * into the built manifest's `externally_connectable`. Nothing read is ever logged.
 */
import { DEV_ORIGINS, RELEASE_ORIGINS } from "./origins";
import { type ReadResult, readInPage } from "./readInPage";

/**
 * magomap's origins for this build (see origins.ts): production only in the release build,
 * plus the local dev servers in the dev build. vite.config.ts writes the same list into
 * manifest.json's `externally_connectable.matches`.
 */
export const ALLOWED_ORIGINS: readonly string[] =
  // Written as a literal condition so the release bundle drops the dev origins entirely.
  import.meta.env.MODE === "development"
    ? [...RELEASE_ORIGINS, ...DEV_ORIGINS]
    : [...RELEASE_ORIGINS];

const KAKAO_MAP_TABS = "https://map.kakao.com/*";
const KAKAO_MAP_URL = "https://map.kakao.com/";
const TAB_LOAD_TIMEOUT_MS = 30_000;
/**
 * The whole in-page read. Each Kakao request already times out after 30 s in the page; this
 * is the backstop so a stuck injection can't leave every later read answering busy.
 */
export const READ_TIMEOUT_MS = 5 * 60_000;

export type ReadAnswer = ReadResult | { ok: false; error: "busy" };
export type PingAnswer = { ok: true; version: string };

export interface TabInfo {
  id?: number;
  status?: string;
  lastAccessed?: number;
  /** Memory Saver unloaded it; it won't load again by itself. */
  discarded?: boolean;
}

export type TabUpdatedListener = (tabId: number, changeInfo: { status?: string }) => void;

export type ExternalListener = (
  message: unknown,
  sender: { origin?: string; url?: string },
  sendResponse: (response: PingAnswer | ReadAnswer) => void,
) => boolean | undefined;

/** The part of the `chrome` API this worker uses; `chrome` itself satisfies it. */
export interface ExtensionApi {
  runtime: {
    getManifest: () => { version: string };
    onMessageExternal: { addListener: (listener: ExternalListener) => void };
  };
  tabs: {
    query: (query: { url: string }) => Promise<TabInfo[]>;
    create: (properties: { url: string; active: boolean }) => Promise<TabInfo>;
    get: (tabId: number) => Promise<TabInfo>;
    remove: (tabId: number) => Promise<void>;
    onUpdated: {
      addListener: (listener: TabUpdatedListener) => void;
      removeListener: (listener: TabUpdatedListener) => void;
    };
  };
  scripting: {
    executeScript: (injection: {
      target: { tabId: number };
      world: "MAIN";
      func: typeof readInPage;
    }) => Promise<{ result?: unknown }[]>;
  };
}

const UNAVAILABLE: ReadAnswer = { ok: false, error: "kakao_unavailable" };

function isAllowedOrigin(origin: string | undefined): boolean {
  return ALLOWED_ORIGINS.some((allowed) => allowed === origin);
}

function messageType(message: unknown): unknown {
  return message && typeof message === "object" ? (message as { type?: unknown }).type : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadResult(value: unknown): value is ReadResult {
  if (!isPlainObject(value)) return false;
  if (value.ok === true) {
    const start = value.start;
    return (
      isPlainObject(start) &&
      Array.isArray(start.folders) &&
      Array.isArray(start.counts) &&
      isPlainObject(value.favorites)
    );
  }
  return (
    value.ok === false &&
    (value.error === "kakao_signed_out" || value.error === "kakao_unavailable")
  );
}

/** Rejects when `promise` hasn't settled after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Resolves once the tab has finished loading, or rejects after the timeout. */
function waitForLoad(api: ExtensionApi, tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated: TabUpdatedListener = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") done();
    };
    const timer = setTimeout(() => done(new Error("tab load timed out")), TAB_LOAD_TIMEOUT_MS);
    api.tabs.onUpdated.addListener(onUpdated);
    // It may have finished before the listener was added.
    api.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") done();
      },
      (error: unknown) => done(error instanceof Error ? error : new Error("tab is gone")),
    );
  });
}

async function read(api: ExtensionApi): Promise<ReadAnswer> {
  const tabs = await api.tabs.query({ url: KAKAO_MAP_TABS });
  let tab = tabs
    // A tab Memory Saver discarded doesn't load again until she opens it; skip it.
    .filter(
      (candidate) =>
        candidate.id !== undefined && !candidate.discarded && candidate.status !== "unloaded",
    )
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];
  let openedTabId: number | undefined;

  try {
    if (!tab) {
      tab = await api.tabs.create({ url: KAKAO_MAP_URL, active: false });
      openedTabId = tab.id;
    }
    const tabId = tab.id;
    if (tabId === undefined) return UNAVAILABLE;
    if (tab.status !== "complete") await waitForLoad(api, tabId);

    const [injection] = await withTimeout(
      api.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readInPage }),
      READ_TIMEOUT_MS,
    );
    return isReadResult(injection?.result) ? injection.result : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  } finally {
    if (openedTabId !== undefined) {
      // The tab was only opened for this read; close it again.
      await api.tabs.remove(openedTabId).catch(() => {});
    }
  }
}

export function install(api: ExtensionApi): void {
  let reading = false;

  api.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // Answer magomap only. Anything else gets no answer at all.
    if (!isAllowedOrigin(sender.origin)) return false;

    const type = messageType(message);
    if (type === "magomap.ping") {
      sendResponse({ ok: true, version: api.runtime.getManifest().version });
      return false;
    }
    if (type !== "magomap.read") return false;

    if (reading) {
      sendResponse({ ok: false, error: "busy" });
      return false;
    }
    reading = true;
    read(api)
      .catch((): ReadAnswer => UNAVAILABLE)
      .then((answer) => {
        reading = false;
        sendResponse(answer);
      });
    // Keeps the message channel open until sendResponse is called.
    return true;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal) {
  install(chrome);
}
