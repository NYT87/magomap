/**
 * Writes to her Kakao Map from inside a signed-in map.kakao.com tab: hands over her folder
 * records (so magomap can tell whose account is signed in), creates a list, and adds places.
 *
 * The requests are the ones Kakao Map's own page sends, captured on 2026-11-23 (see
 * docs/kakao-map-access.md, "Writing a list"): `POST /folder/add`, `POST /favorite/add`, both
 * JSON, same origin, with the signed-in cookie. No gate token is involved.
 *
 * Like `readInPage`, this runs in the page through
 * `chrome.scripting.executeScript({ world: "MAIN", func, args })`, which serialises the function
 * and drops its closure. So `writeInPage` must not use anything outside its own body at
 * runtime: no imports, no module-level values. Types are fine, they disappear at build time.
 * (One function with an `op`, not three: helpers can't be shared between serialised functions.)
 *
 * It never logs what it sends or reads.
 */

/** A place to add: Kakao's place key, the two lines Kakao Map shows, and its own coordinates. */
export interface WritePlace {
  /** Kakao's place id, digits only (the `<id>` of `p_kakao_<id>`). */
  key: string;
  /** Shown as the favourite's name (`display1`). */
  title: string;
  /** Shown under it (`display2`). */
  address: string;
  /** Kakao's coordinates (WCONGNAMUL, as `/favorite/add` takes them), whole numbers. */
  x: number;
  y: number;
  /** Kakao's colour code; `"03"`, what the page sends first, when left out. */
  color?: string;
}

export type WriteRequest =
  | { op: "account" }
  | { op: "create"; name: string }
  | { op: "add"; folderId: number; places: WritePlace[] }
  | {
      op: "color";
      folderId: number;
      key: string;
      /** The favourite's own id; when given, it must be that favourite, with that place key. */
      seq?: number;
      color: string;
    }
  | {
      op: "note";
      folderId: number;
      key: string;
      seq?: number;
      note: string;
      /** The note magomap last knew; if Kakao's differs, nothing is written (unless `overwrite`). */
      expected?: string;
      overwrite?: boolean;
    };

export type WriteError = "kakao_signed_out" | "kakao_unavailable" | "not_found" | "note_changed";

/**
 * How long the page keeps working on one write before it stops by itself. It is less than the
 * worker's own timeout, so the page has always stopped before the worker frees its "busy" flag
 * (a retry can't then run beside a write that is still going).
 */
export const WRITE_DEADLINE_MS = 90_000;

export type WriteResult =
  | { ok: true; folders: unknown[] }
  | { ok: true; folderId: number }
  | { ok: true; added: number; skipped: number }
  | { ok: true }
  | { ok: false; error: WriteError; added?: number; current?: string };

export async function writeInPage(request: WriteRequest): Promise<WriteResult> {
  const SIGNED_OUT = "kakao_signed_out";
  const UNAVAILABLE = "kakao_unavailable";
  const NOT_FOUND = "not_found";
  /** Per request, body included. A hung request must not hold the write forever. */
  const REQUEST_TIMEOUT_MS = 30_000;
  /** The whole write; the same value as WRITE_DEADLINE_MS (module values aren't reachable here). */
  const DEADLINE_MS = 90_000;
  const deadline = Date.now() + DEADLINE_MS;
  /** The `/folder/list` fields magomap's Kakao Map adapter reads, as readInPage keeps them. */
  const FOLDER_FIELDS = [
    "folderid",
    "status",
    "title",
    "memo",
    "nickname",
    "kakao_map_user_id",
    "map_user_id",
    "subscribe",
    "favorite_cnt",
    "folder_updated_at",
  ];
  /** Places per `/favorite/add`. Kakao Map's own maximum wasn't captured: a cautious size. */
  const BATCH_SIZE = 20;
  /** Pages of a list's favourites (500 each), a guard against a paging loop. */
  const MAX_PAGES = 50;
  /** The colour the page sent first for a new favourite. */
  const DEFAULT_COLOR = "03";
  /** What the page sent when it made a new list (the visibility code is Kakao's own). */
  const NEW_LIST = { memo: "", out_link: "", icon: 10, status: "P" };

  class Failure extends Error {
    reason: typeof SIGNED_OUT | typeof UNAVAILABLE | typeof NOT_FOUND;
    constructor(reason: typeof SIGNED_OUT | typeof UNAVAILABLE | typeof NOT_FOUND) {
      super(reason);
      this.reason = reason;
    }
  }

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  /** One request as the page makes it. Throws a Failure; returns the parsed answer. */
  const send = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    // Nothing is sent once the write's time is up, and no request outlives it.
    const left = deadline - Date.now();
    if (left <= 0) throw new Failure(UNAVAILABLE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, left));
    try {
      let response: Response;
      try {
        response = await fetch(new URL(path, window.location.origin).toString(), {
          credentials: "include",
          redirect: "manual",
          signal: controller.signal,
          ...(body === undefined
            ? {}
            : {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-requested-with": "XMLHttpRequest",
                },
                body: JSON.stringify(body),
              }),
        });
      } catch {
        throw new Failure(UNAVAILABLE);
      }
      if (
        response.type === "opaqueredirect" ||
        response.status === 0 ||
        response.redirected ||
        response.status === 401 ||
        response.status === 403
      ) {
        throw new Failure(SIGNED_OUT);
      }
      if (!response.ok) throw new Failure(UNAVAILABLE);
      let raw: string;
      try {
        raw = await response.text();
      } catch {
        throw new Failure(UNAVAILABLE);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // A login page, not JSON.
        throw new Failure(SIGNED_OUT);
      }
      if (!isRecord(parsed)) throw new Failure(UNAVAILABLE);
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  };

  const succeeded = (answer: Record<string, unknown>) =>
    isRecord(answer.status) && answer.status.code === "SUCCESS";

  /** Every favourite of a list, every page of it. */
  const favoritesIn = async (folderId: number): Promise<Record<string, unknown>[]> => {
    const all: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let nextId: string | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const path =
        nextId === undefined
          ? `/favorite/mine/list?folderid=${folderId}`
          : `/favorite/mine/list?folderid=${folderId}&next_id=${encodeURIComponent(nextId)}`;
      const answer = await send(path);
      if (!Array.isArray(answer.favorites)) throw new Failure(UNAVAILABLE);
      for (const favorite of answer.favorites) {
        if (isRecord(favorite)) all.push(favorite);
      }
      const raw = answer.next_id;
      const more =
        (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) ||
        (typeof raw === "string" && raw !== "" && raw !== "0");
      if (!more) return all;
      nextId = String(raw);
      if (seen.has(nextId)) throw new Failure(UNAVAILABLE);
      seen.add(nextId);
    }
    throw new Failure(UNAVAILABLE);
  };

  /** The keys of the places a list already holds. */
  const keysIn = async (folderId: number): Promise<Set<string>> => {
    const keys = new Set<string>();
    for (const favorite of await favoritesIn(folderId)) {
      if (favorite.key !== undefined) keys.add(String(favorite.key));
    }
    return keys;
  };

  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  let added = 0;
  try {
    if (request.op === "account") {
      const answer = await send("/folder/list");
      if (!succeeded(answer) || !Array.isArray(answer.folders)) throw new Failure(UNAVAILABLE);
      if (answer.folders.length === 0) throw new Failure(SIGNED_OUT);
      // Whose account it is, is the app's to decide with the same rule as the sync (the domain's
      // Kakao Map adapter): this only hands over the records, trimmed to what that rule reads.
      const folders = answer.folders.map((folder) => {
        if (!isRecord(folder)) return null;
        const kept: Record<string, unknown> = {};
        for (const field of FOLDER_FIELDS) {
          if (Object.hasOwn(folder, field)) kept[field] = folder[field];
        }
        return kept;
      });
      return { ok: true, folders };
    }

    if (request.op === "create") {
      const answer = await send("/folder/add", { title: request.name, ...NEW_LIST });
      const folderId = isRecord(answer.req) ? answer.req.folderid : undefined;
      if (!succeeded(answer) || typeof folderId !== "number" || !Number.isSafeInteger(folderId)) {
        throw new Failure(UNAVAILABLE);
      }
      if (folderId <= 0) throw new Failure(UNAVAILABLE);
      return { ok: true, folderId };
    }

    if (request.op === "color" || request.op === "note") {
      // Read fresh, then send the favourite back as the page does: only one field differs.
      // By the favourite's own seq when the app gives it (a place can be in one list twice);
      // its place key must still match, or it's another favourite.
      const found = (await favoritesIn(request.folderId)).find(
        (f) =>
          f.key !== undefined &&
          String(f.key) === request.key &&
          (request.seq === undefined || f.seq === request.seq),
      );
      if (!found) throw new Failure(NOT_FOUND);
      const { seq, display1, display2, memo } = found;
      if (typeof seq !== "number" || typeof display1 !== "string" || typeof display2 !== "string") {
        throw new Failure(UNAVAILABLE);
      }
      // A note that can't be read as text must never be sent back as empty: that would erase it.
      if (memo !== undefined && memo !== null && typeof memo !== "string") {
        throw new Failure(UNAVAILABLE);
      }
      // The note was changed in Kakao Map since magomap last knew it: write nothing, hand it back.
      if (request.op === "note" && request.expected !== undefined && request.overwrite !== true) {
        const plainNote = (text: unknown) =>
          typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim() : "";
        if (plainNote(memo) !== plainNote(request.expected)) {
          return {
            ok: false,
            error: "note_changed",
            current: typeof memo === "string" ? memo : "",
          };
        }
      }
      const colour = request.op === "color" ? request.color : found.color;
      if (typeof colour !== "string") throw new Failure(UNAVAILABLE);
      const answer = await send("/favorite/update", {
        datas: [
          {
            seq,
            display1,
            display2,
            color: colour,
            memo: request.op === "note" ? request.note : (memo ?? ""),
          },
        ],
      });
      const results = Array.isArray(answer.data) ? answer.data : [];
      const done = results.some(
        (r) => isRecord(r) && isRecord(r.status) && r.status.code === "SUCCESS",
      );
      if (!succeeded(answer) || !done) throw new Failure(UNAVAILABLE);
      // Kakao may store line breaks or edge spaces its own way: compare without them.
      const plain = (text: unknown) =>
        typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim() : "";
      const matches = (again: Record<string, unknown>) =>
        request.op === "color"
          ? String(again.color) === request.color
          : plain(again.memo) === plain(request.note);
      // Verify by reading it again, a few short tries (the page's own list can lag a moment).
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) await pause(300);
        const again = (await favoritesIn(request.folderId)).find((f) => f.seq === seq);
        if (again && matches(again)) return { ok: true };
      }
      throw new Failure(UNAVAILABLE);
    }

    // Add: only what the list doesn't hold yet, so running it again adds nothing.
    const present = await keysIn(request.folderId);
    const toAdd: WritePlace[] = [];
    for (const place of request.places) {
      if (present.has(place.key)) continue;
      present.add(place.key);
      toAdd.push(place);
    }
    const skipped = request.places.length - toAdd.length;
    for (let start = 0; start < toAdd.length; start += BATCH_SIZE) {
      const batch = toAdd.slice(start, start + BATCH_SIZE);
      const answer = await send("/favorite/add", {
        datas: batch.map((place) => ({
          type: "place",
          key: Number(place.key),
          display1: place.title,
          display2: place.address,
          x: place.x,
          y: place.y,
          color: place.color ?? DEFAULT_COLOR,
          memo: "",
          folderid: request.folderId,
        })),
      });
      const results = Array.isArray(answer.data) ? answer.data : [];
      const done = results.filter(
        (r) => isRecord(r) && isRecord(r.status) && r.status.code === "SUCCESS",
      ).length;
      added += done;
      if (!succeeded(answer) || done !== batch.length) throw new Failure(UNAVAILABLE);
    }
    return { ok: true, added, skipped };
  } catch (error) {
    const reason = error instanceof Failure ? error.reason : UNAVAILABLE;
    return request.op === "add"
      ? { ok: false, error: reason, added }
      : { ok: false, error: reason };
  }
}
