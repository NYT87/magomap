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
 * Only magomap's own origins are answered (the same list as `externally_connectable` in
 * manifest.json). Nothing read is ever logged.
 */
import { type ReadResult, readInPage } from "./readInPage";

/** magomap's origins. manifest.json's `externally_connectable.matches` is this list + `/*`. */
export const ALLOWED_ORIGINS = [
  "https://magomap.jmn8718.workers.dev",
  "http://localhost:5173",
  "http://localhost:8787",
] as const;

const KAKAO_MAP_TABS = "https://map.kakao.com/*";
const KAKAO_MAP_URL = "https://map.kakao.com/";
const TAB_LOAD_TIMEOUT_MS = 30_000;

export type ReadAnswer = ReadResult | { ok: false; error: "busy" };
export type PingAnswer = { ok: true; version: string };

export interface TabInfo {
  id?: number;
  status?: string;
  lastAccessed?: number;
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

function isReadResult(value: unknown): value is ReadResult {
  if (!value || typeof value !== "object") return false;
  const result = value as { ok?: unknown; error?: unknown; start?: unknown; favorites?: unknown };
  if (result.ok === true)
    return typeof result.start === "object" && typeof result.favorites === "object";
  return result.error === "kakao_signed_out" || result.error === "kakao_unavailable";
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
    .filter((candidate) => candidate.id !== undefined)
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

    const [injection] = await api.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readInPage,
    });
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
