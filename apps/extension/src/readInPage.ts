/**
 * Reads her Kakao Map lists from inside a signed-in map.kakao.com tab.
 *
 * Ported from kakao-list (same owner), apps/extension/src/kakaoMapsExtractor.ts,
 * `extractSnapshotInPageEnvelope`, at kakao-list commit 730ee2d. Only the fetch-and-parse
 * read path is kept: `/folder/list`, then `/favorite/mine/list?folderid=` per folder.
 * Unlike kakao-list, it follows Kakao's paging: a folder's favourites come at most 500 per
 * page, with a `next_id` for the next page (`&next_id=`), which Kakao Map's own page follows.
 * Note editing, place detection and kakao-list's normalisation are not ported. Records are
 * returned unchanged; the server's Kakao Map adapter interprets them (dedupe, followed
 * folders, coordinates).
 *
 * This runs in the page through `chrome.scripting.executeScript({ world: "MAIN", func })`,
 * which serialises the function and drops its closure. So `readInPage` must not use
 * anything from outside its own body at runtime: no imports, no module-level values.
 * Types are fine, they disappear at build time.
 *
 * It sets no headers: the browser sends the Kakao cookie and the Referer/Origin Kakao
 * expects, because the request comes from the map.kakao.com page itself.
 * It never logs what it reads.
 */

/** What the extension sends at the start of an upload run (plan Task 2's `KakaoMapStart`). */
export interface KakaoMapStart {
  /** Raw `/folder/list` records, as received. */
  folders: unknown[];
  counts: { folderid: number; itemCount: number; firstDisplay2?: string }[];
}

export type ReadError = "kakao_signed_out" | "kakao_unavailable";

export type ReadResult =
  | {
      ok: true;
      start: KakaoMapStart;
      /** Every raw favourite of every non-deleted folder, keyed by `String(folderid)`. */
      favorites: Record<string, unknown[]>;
    }
  | { ok: false; error: ReadError };

export async function readInPage(): Promise<ReadResult> {
  const SIGNED_OUT: ReadError = "kakao_signed_out";
  const UNAVAILABLE: ReadError = "kakao_unavailable";
  const MAX_PARALLEL = 4;
  /** Per request, body included. A hung request must not hold the read forever. */
  const REQUEST_TIMEOUT_MS = 30_000;
  /** The server's `kakaoMapStartSchema` takes at most 2000 folder records. */
  const MAX_FOLDERS = 2000;
  /** Far above a real account (the owner had about 3,000), but bounded. */
  const MAX_FAVORITES = 50_000;
  /** Pages per folder (500 favourites each), a guard against a paging loop. */
  const MAX_PAGES = 50;

  class ReadFailure extends Error {
    constructor(readonly reason: ReadError) {
      super(reason);
    }
  }

  const fetchJson = async (path: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(new URL(path, window.location.origin).toString(), {
          credentials: "include",
          // Signed out, Kakao may redirect to its login page on another domain. Followed,
          // that fails as a CORS error; not followed, it is an opaque redirect we can see.
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        throw new ReadFailure(UNAVAILABLE);
      }
      // Kakao answers a signed-out session with an auth status, a redirect to its login
      // page, or an HTML page.
      if (
        response.type === "opaqueredirect" ||
        response.status === 0 ||
        response.redirected ||
        response.status === 401 ||
        response.status === 403
      ) {
        throw new ReadFailure(SIGNED_OUT);
      }
      if (!response.ok) throw new ReadFailure(UNAVAILABLE);
      let raw: string;
      try {
        raw = await response.text();
      } catch {
        throw new ReadFailure(UNAVAILABLE);
      }
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new ReadFailure(SIGNED_OUT);
      }
    } finally {
      clearTimeout(timer);
    }
  };

  /** `payload[key]` when it is an array, the payload itself when it is one, else null. */
  const arrayIn = (payload: unknown, key: string): unknown[] | null => {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
    return null;
  };

  try {
    const folders = arrayIn(await fetchJson("/folder/list"), "folders");
    if (!folders || folders.length > MAX_FOLDERS) throw new ReadFailure(UNAVAILABLE);

    // Each non-deleted folder id once. The raw records stay as received, duplicates and
    // deleted ones included; choosing between duplicates is the server's job.
    const folderIds: number[] = [];
    for (const folder of folders) {
      if (!folder || typeof folder !== "object") continue;
      const { folderid, status } = folder as { folderid?: unknown; status?: unknown };
      if (typeof folderid !== "number" || status === "D") continue;
      if (!folderIds.includes(folderid)) folderIds.push(folderid);
    }
    // Signed out, Kakao still answers SUCCESS, with zero folders. Signed in, there is
    // always folder 0, her default list.
    if (folderIds.length === 0) throw new ReadFailure(SIGNED_OUT);

    const favoritesById = new Map<number, unknown[]>();
    let next = 0;
    let failed = false;
    let favoriteTotal = 0;

    /** Every page of one folder, in page order. Pages are read one after another. */
    const readFolder = async (folderid: number): Promise<unknown[]> => {
      const all: unknown[] = [];
      const seen = new Set<string>();
      let nextId: string | undefined;
      for (let pageNumber = 1; ; pageNumber += 1) {
        const path =
          nextId === undefined
            ? `/favorite/mine/list?folderid=${folderid}`
            : `/favorite/mine/list?folderid=${folderid}&next_id=${encodeURIComponent(nextId)}`;
        const payload = await fetchJson(path);
        const favorites = arrayIn(payload, "favorites");
        if (!favorites) throw new ReadFailure(UNAVAILABLE);
        favoriteTotal += favorites.length;
        if (favoriteTotal > MAX_FAVORITES) throw new ReadFailure(UNAVAILABLE);
        for (const favorite of favorites) all.push(favorite);

        const raw =
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as { next_id?: unknown }).next_id
            : undefined;
        // Missing, null, 0, "" (or "0") is the last page.
        const usable =
          (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) ||
          (typeof raw === "string" && raw !== "" && raw !== "0");
        if (!usable) return all;
        nextId = String(raw);
        // A next_id seen before, a later page with nothing on it, or too many pages:
        // Kakao's paging is looping, and the read can't be trusted.
        if (seen.has(nextId) || (pageNumber > 1 && favorites.length === 0)) {
          throw new ReadFailure(UNAVAILABLE);
        }
        if (pageNumber >= MAX_PAGES) throw new ReadFailure(UNAVAILABLE);
        seen.add(nextId);
      }
    };
    const worker = async (): Promise<void> => {
      // After one failure the read is lost, so the other workers start nothing new.
      while (!failed && next < folderIds.length) {
        const folderid = folderIds[next] as number;
        next += 1;
        try {
          favoritesById.set(folderid, await readFolder(folderid));
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_PARALLEL, folderIds.length) }, () => worker()),
    );

    const favorites: Record<string, unknown[]> = {};
    const counts: KakaoMapStart["counts"] = [];
    for (const folderid of folderIds) {
      const list = favoritesById.get(folderid) ?? [];
      favorites[String(folderid)] = list;
      const first = list[0];
      const firstDisplay2 =
        first && typeof first === "object" ? (first as { display2?: unknown }).display2 : undefined;
      counts.push(
        typeof firstDisplay2 === "string"
          ? { folderid, itemCount: list.length, firstDisplay2 }
          : { folderid, itemCount: list.length },
      );
    }

    return { ok: true, start: { folders, counts }, favorites };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ReadFailure ? error.reason : UNAVAILABLE,
    };
  }
}
