/**
 * magomap's extension service worker. magomap's web page asks it, through
 * `chrome.runtime.sendMessage(extensionId, message)`, to read her Kakao Map lists. It reads
 * them inside a signed-in map.kakao.com tab and answers with the raw records.
 *
 * Messages:
 * - `{ type: "magomap.ping" }` → `{ ok: true, version }`
 * - `{ type: "magomap.read" }` → `{ ok: true, start, favorites }`, or
 *   `{ ok: false, error: "kakao_signed_out" | "kakao_unavailable" | "busy" }`
 * - `{ type: "magomap.account" }` → `{ ok: true, folders }`: her folder records, so magomap can
 *   tell whose Kakao Map is signed in (it applies the sync's own rule)
 * - `{ type: "magomap.createList", name }` → `{ ok: true, folderId }`: a new Kakao Map list
 * - `{ type: "magomap.setColor", folderId, key, seq?, color }` → `{ ok: true }`: changes one place's colour in
 *   one of her lists (read fresh, sent back with only `color` changed, read again to verify), or
 *   `{ ok: false, error: "not_found" }` when the place isn't in that list
 * - `{ type: "magomap.setNote", folderId, key, seq?, note }` → `{ ok: true }`: changes one place's Kakao
 *   note (`note` may be empty, which clears it) the same way, `memo` the only field that changes
 * - `{ type: "magomap.addPlaces", folderId, places }` → `{ ok: true, added, skipped }`, or
 *   `{ ok: false, error, added? }` (`added`: how many went in before it stopped)
 *   The writes also answer `{ ok: false, error: "invalid" }` for input they refuse.
 *
 * Only magomap's own origins are answered: the list in origins.ts, which the build also writes
 * into the built manifest's `externally_connectable`. Nothing read is ever logged.
 */
import { DEV_ORIGINS, RELEASE_ORIGINS } from "./origins";
import { type ReadResult, readInPage } from "./readInPage";
import { type WriteError, type WritePlace, type WriteRequest, writeInPage } from "./writeList";

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

/** A write is a handful of requests (reading the list, then pages of 20 places). */
export const WRITE_TIMEOUT_MS = 2 * 60_000;
/** Longest Kakao note, as magomap's own (`LIMITS.importText`). */
const MAX_NOTE = 5_000;
/** Kakao Map list names, as magomap's own (`LIMITS.listName`). */
const MAX_LIST_NAME = 100;
/** Places per message; the page sends them to Kakao in smaller requests. */
const MAX_PLACES = 100;
/** Longest title or address, and the largest coordinate (WCONGNAMUL metres ×2.5, either sign). */
const MAX_TEXT = 1000;
const MAX_COORDINATE = 10_000_000;
/** At most the folders magomap's own read accepts (`kakaoMapStartSchema`). */
const MAX_FOLDERS = 2000;

export type ReadAnswer = ReadResult | { ok: false; error: "busy" };
export type PingAnswer = { ok: true; version: string };
export type WriteAnswer =
  | { ok: true; folders: unknown[] }
  | { ok: true; folderId: number }
  | { ok: true; added: number; skipped: number }
  | { ok: true }
  | { ok: false; error: WriteError | "busy" | "invalid"; added?: number; current?: string };

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
  sendResponse: (response: PingAnswer | ReadAnswer | WriteAnswer) => void,
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
  /** Absent in the tests' stub; `chrome` always has it. */
  action?: { onClicked: { addListener: (listener: () => void) => void } };
  scripting: {
    executeScript: (
      injection:
        | { target: { tabId: number }; world: "MAIN"; func: typeof readInPage }
        | {
            target: { tabId: number };
            world: "MAIN";
            func: typeof writeInPage;
            args: [WriteRequest];
          },
    ) => Promise<{ result?: unknown }[]>;
  };
}

const UNAVAILABLE: ReadAnswer = { ok: false, error: "kakao_unavailable" };
const WRITE_UNAVAILABLE: WriteAnswer = { ok: false, error: "kakao_unavailable" };

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

/**
 * Runs `run` against a signed-in map.kakao.com tab: the most recently used one, or a background
 * tab opened for the job (and closed afterwards). Any failure answers `fallback`.
 */
async function inKakaoTab<T>(
  api: ExtensionApi,
  run: (tabId: number) => Promise<T>,
  fallback: T,
): Promise<T> {
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
    if (tabId === undefined) return fallback;
    if (tab.status !== "complete") await waitForLoad(api, tabId);
    return await run(tabId);
  } catch {
    return fallback;
  } finally {
    if (openedTabId !== undefined) {
      // The tab was only opened for this job; close it again.
      await api.tabs.remove(openedTabId).catch(() => {});
    }
  }
}

function read(api: ExtensionApi): Promise<ReadAnswer> {
  return inKakaoTab(
    api,
    async (tabId) => {
      const [injection] = await withTimeout(
        api.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readInPage }),
        READ_TIMEOUT_MS,
      );
      return isReadResult(injection?.result) ? injection.result : UNAVAILABLE;
    },
    UNAVAILABLE,
  );
}

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isKakaoError = (value: unknown): value is WriteError =>
  value === "kakao_signed_out" ||
  value === "kakao_unavailable" ||
  value === "not_found" ||
  value === "note_changed";

/** What a write may ask for, or null when the message isn't a valid one. */
function parseWrite(type: unknown, message: unknown): WriteRequest | null {
  if (type === "magomap.account") return { op: "account" };
  const m = isPlainObject(message) ? message : {};
  if (type === "magomap.createList") {
    const name = typeof m.name === "string" ? m.name.trim() : "";
    return name !== "" && name.length <= MAX_LIST_NAME ? { op: "create", name } : null;
  }
  const folderId = m.folderId;
  if (!Number.isSafeInteger(folderId) || Number(folderId) <= 0) return null;
  // The favourite's own id, when the app sends it (older apps don't).
  const { seq } = m;
  if (seq !== undefined && (!Number.isSafeInteger(seq) || (seq as number) <= 0)) return null;
  const seqPart = seq === undefined ? {} : { seq: seq as number };
  if (type === "magomap.setNote") {
    const { key, note } = m;
    if (typeof key !== "string" || !/^[1-9]\d{0,14}$/.test(key)) return null;
    // An empty note is allowed: it clears the note.
    if (typeof note !== "string" || note.length > MAX_NOTE) return null;
    const { expected, overwrite } = m;
    if (expected !== undefined && (typeof expected !== "string" || expected.length > MAX_NOTE)) {
      return null;
    }
    if (overwrite !== undefined && typeof overwrite !== "boolean") return null;
    return {
      op: "note",
      folderId: folderId as number,
      key,
      ...seqPart,
      note,
      ...(expected === undefined ? {} : { expected }),
      ...(overwrite === undefined ? {} : { overwrite }),
    };
  }
  if (type === "magomap.setColor") {
    const { key, color } = m;
    if (typeof key !== "string" || !/^[1-9]\d{0,14}$/.test(key)) return null;
    if (typeof color !== "string" || !/^\d{2}$/.test(color)) return null;
    return { op: "color", folderId: folderId as number, key, ...seqPart, color };
  }
  const list = m.places;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_PLACES) return null;
  const places: WritePlace[] = [];
  for (const raw of list) {
    if (!isPlainObject(raw)) return null;
    const { key, title, address, x, y, color } = raw;
    // Kakao place ids have no leading zeros, so a key means the same number as its text.
    if (typeof key !== "string" || !/^[1-9]\d{0,14}$/.test(key)) return null;
    if (typeof title !== "string" || title === "" || title.length > MAX_TEXT) return null;
    if (typeof address !== "string" || address.length > MAX_TEXT) return null;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
    if (Math.abs(x as number) > MAX_COORDINATE || Math.abs(y as number) > MAX_COORDINATE) {
      return null;
    }
    if (color !== undefined && (typeof color !== "string" || !/^\d{1,2}$/.test(color))) return null;
    places.push({
      key,
      title,
      address,
      x: x as number,
      y: y as number,
      ...(color === undefined ? {} : { color }),
    });
  }
  return { op: "add", folderId: folderId as number, places };
}

/** The page's answer to a write, rebuilt field by field, so nothing else it says gets out. */
function writeAnswerOf(request: WriteRequest, value: unknown): WriteAnswer {
  if (!isPlainObject(value)) return WRITE_UNAVAILABLE;
  if (value.ok === false) {
    if (!isKakaoError(value.error)) return WRITE_UNAVAILABLE;
    // Kakao's note, handed back when it was changed since magomap last knew it (bounded).
    if (request.op === "note" && value.error === "note_changed") {
      return {
        ok: false,
        error: "note_changed",
        current: typeof value.current === "string" ? value.current.slice(0, MAX_NOTE) : "",
      };
    }
    return request.op === "add" && isCount(value.added)
      ? { ok: false, error: value.error, added: value.added }
      : { ok: false, error: value.error };
  }
  if (value.ok !== true) return WRITE_UNAVAILABLE;
  if (request.op === "account") {
    const folders = value.folders;
    return Array.isArray(folders) && folders.length <= MAX_FOLDERS
      ? { ok: true, folders }
      : WRITE_UNAVAILABLE;
  }
  if (request.op === "color" || request.op === "note") return { ok: true };
  if (request.op === "create") {
    const id = value.folderId;
    return Number.isSafeInteger(id) && Number(id) > 0
      ? { ok: true, folderId: id as number }
      : WRITE_UNAVAILABLE;
  }
  return isCount(value.added) && isCount(value.skipped)
    ? { ok: true, added: value.added, skipped: value.skipped }
    : WRITE_UNAVAILABLE;
}

function write(api: ExtensionApi, request: WriteRequest): Promise<WriteAnswer> {
  return inKakaoTab<WriteAnswer>(
    api,
    async (tabId) => {
      const [injection] = await withTimeout(
        api.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: writeInPage,
          args: [request],
        }),
        WRITE_TIMEOUT_MS,
      );
      return writeAnswerOf(request, injection?.result);
    },
    WRITE_UNAVAILABLE,
  );
}

export function install(api: ExtensionApi): void {
  let working = false;

  // The button has no popup: a click takes her to where the sync is, magomap's Account page.
  api.action?.onClicked.addListener(() => {
    void api.tabs.create({ url: `${ALLOWED_ORIGINS[0]}/account`, active: true }).catch(() => {});
  });

  api.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // Answer magomap only. Anything else gets no answer at all.
    if (!isAllowedOrigin(sender.origin)) return false;

    const type = messageType(message);
    if (type === "magomap.ping") {
      sendResponse({ ok: true, version: api.runtime.getManifest().version });
      return false;
    }
    // One job at a time, reads and writes alike: Kakao Map is one tab with one login.
    const start = <T extends PingAnswer | ReadAnswer | WriteAnswer>(job: Promise<T>) => {
      working = true;
      job
        .catch((): ReadAnswer | WriteAnswer => UNAVAILABLE)
        .then((answer) => {
          working = false;
          sendResponse(answer);
        });
    };

    if (type === "magomap.read") {
      if (working) {
        sendResponse({ ok: false, error: "busy" });
        return false;
      }
      start(read(api));
      // Keeps the message channel open until sendResponse is called.
      return true;
    }

    if (
      type === "magomap.account" ||
      type === "magomap.createList" ||
      type === "magomap.addPlaces" ||
      type === "magomap.setColor" ||
      type === "magomap.setNote"
    ) {
      const request = parseWrite(type, message);
      if (!request) {
        sendResponse({ ok: false, error: "invalid" });
        return false;
      }
      if (working) {
        sendResponse({ ok: false, error: "busy" });
        return false;
      }
      start(write(api, request));
      return true;
    }
    return false;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal) {
  install(chrome);
}
