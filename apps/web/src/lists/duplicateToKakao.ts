// Copies a Kakao list to Kakao Map as a new list on his own account, through the extension:
// check which Kakao Map account is signed in, create the list, add the places in pages, then run
// the usual sync so the new list comes in as his own Kakao list. Kakao Map is written first and
// magomap only follows by that sync; nothing here writes magomap's own rows.
import { currentDb, dbUserId, type MagomapDexie } from "../data/db";
import { askExtension, runKakaoMapSync } from "../import/kakaoMap";
import { codeOf, post } from "../import/runImport";

export type KakaoCopyCode =
  | "extension_missing"
  | "account_mismatch"
  | "account_unconfirmed"
  | "kakao_signed_out"
  | "kakao_unavailable"
  | "busy"
  | "offline"
  | "partial"
  /** The list being filled is gone from her Kakao Map, or isn't one of her own lists. */
  | "list_missing"
  | "not_kakao_list";

export class KakaoCopyError extends Error {
  constructor(
    readonly code: KakaoCopyCode,
    /** `partial` only: the Kakao list that was made, and how many places it holds from this copy. */
    readonly folderId?: number,
    readonly added?: number,
    /** `partial` only: the request that failed gave no count, so more may have been added. */
    readonly atLeast = false,
  ) {
    super(`Copy to Kakao Map failed: ${code}`);
    this.name = "KakaoCopyError";
  }
}

export interface KakaoCopyResult {
  folderId: number;
  added: number;
  /** Places Kakao Map already had in that list (a retry), so nothing was added twice. */
  skipped: number;
  /** Places with no Kakao place id, no usable point or no name: not sent. */
  leftOut: number;
  /** Whether the sync afterwards worked; if not, the next "Sync from Kakao Map" brings the list in. */
  synced: boolean;
}

/** Places per message: the extension takes up to 100; fewer keeps a failure's progress fine. */
export const PAGE = 50;
/** The extension's own limit per write is 2 minutes; the page waits a little longer. */
export const WRITE_WAIT_MS = 150_000;
const ACCOUNT_WAIT_MS = 60_000;

const KEY = /^[1-9]\d{0,14}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface SendPlace {
  key: string;
  title: string;
  address: string;
  x: number;
  y: number;
  color?: string;
}

/** One answer from the extension: its ok body, or the copy's error for it. */
export async function ask(message: { type: string; [k: string]: unknown }, wait: number) {
  const answer = await askExtension(message, wait);
  if (answer === undefined) throw new KakaoCopyError("extension_missing");
  if (!isRecord(answer)) throw new KakaoCopyError("kakao_unavailable");
  return answer;
}

export const failureOf = (answer: Record<string, unknown>): KakaoCopyCode => {
  const error = answer.error;
  if (error === "kakao_signed_out" || error === "busy") return error;
  return "kakao_unavailable";
};

/** The places of a source list that can be sent, and how many can't. */
async function placesOf(sourceListId: string): Promise<{ places: SendPlace[]; leftOut: number }> {
  const db = currentDb();
  const source = await db.lists.get(sourceListId);
  if (!source || source.deletedAt != null) throw new Error("no such list");
  if (source.provider !== "kakao") throw new KakaoCopyError("not_kakao_list");
  const items = (await db.list_items.where("listId").equals(sourceListId).toArray())
    .filter((i) => i.deletedAt == null && i.removedAtProvider == null)
    .sort((a, b) => a.position - b.position);
  const { places, leftOut } = await sendPlacesOf(
    db,
    items.map((i) => ({ placeId: i.placeId, color: i.providerColor ?? i.itemColor ?? undefined })),
  );
  // Only what the extension takes: magomap's own place ids stay here.
  return { places: places.map(({ placeId: _, ...send }) => send), leftOut: leftOut.length };
}

/**
 * Places as the extension adds them: Kakao's place id, the two lines Kakao Map shows, its own
 * coordinates and a Kakao colour when there is one. A place with no Kakao place id, no point or
 * no name can't be sent (`leftOut`); a place twice is sent once.
 */
export async function sendPlacesOf(
  db: MagomapDexie,
  entries: { placeId: string; color?: string | undefined }[],
): Promise<{ places: (SendPlace & { placeId: string })[]; leftOut: string[] }> {
  // Loaded only to send: the conversion brings proj4 (about 44 kB gzip) along, which must not
  // be in the first JavaScript every phone downloads (scripts/check-bundle.mjs).
  const { latLngToWcongnamul } = await import("@magomap/domain/providers/wcongnamul");
  const places: (SendPlace & { placeId: string })[] = [];
  const leftOut: string[] = [];
  const seen = new Set<string>();
  for (const { placeId, color } of entries) {
    const place = await db.places.get(placeId);
    const sources = await db.place_sources.where("placeId").equals(placeId).toArray();
    const key = sources.find((s) => s.provider === "kakao" && s.deletedAt == null)?.externalId;
    const point = place ? latLngToWcongnamul(place.lat, place.lng) : undefined;
    const title = place?.title.trim() ?? "";
    if (!place || !key || !KEY.test(key) || !point || title === "" || seen.has(key)) {
      leftOut.push(placeId);
      continue;
    }
    seen.add(key);
    places.push({
      placeId,
      key,
      title,
      address: place.roadAddress?.trim() || place.address?.trim() || "",
      ...point,
      ...(color && /^\d{2}$/.test(color) ? { color } : {}),
    });
  }
  return { places, leftOut };
}

/**
 * Whether the Kakao Map account signed in on the page is the one linked to his magomap account.
 * Returns her folder records as the extension handed them over.
 */
export async function checkKakaoAccount(): Promise<unknown[]> {
  const answer = await ask({ type: "magomap.account" }, ACCOUNT_WAIT_MS);
  if (answer.ok !== true || !Array.isArray(answer.folders))
    throw new KakaoCopyError(failureOf(answer));
  try {
    await post(dbUserId(currentDb()), "/api/import/kakao-map/account", { folders: answer.folders });
  } catch (error) {
    const code = codeOf(error);
    if (code === "offline") throw new KakaoCopyError("offline");
    if (code === "kakao_signed_out") throw new KakaoCopyError("kakao_signed_out");
    if (code === "kakao_account_unconfirmed") throw new KakaoCopyError("account_unconfirmed");
    if (code === "kakao_account_mismatch" || code === "kakao_account_taken") {
      throw new KakaoCopyError("account_mismatch");
    }
    // Anything else (an expired magomap session, a server error): nothing was written.
    throw new KakaoCopyError("kakao_unavailable");
  }
  return answer.folders;
}

let working = false;

/**
 * A create that got no clear answer (none in time, or Kakao Map unavailable): Kakao may have made
 * the list anyway. Kept in this page's memory only, for the magomap account and the name it was
 * for, with the lists she had before it.
 */
let unsureCreate: { account: string; name: string; before: Set<number> } | null = null;

const liveFolders = (folders: unknown[]) =>
  folders.filter(
    (f): f is Record<string, unknown> =>
      isRecord(f) && typeof f.folderid === "number" && f.status !== "D",
  );

/**
 * The list an unsure create made, if one did: a single list by that exact name that she didn't
 * have before. Two, or none, and it can't be told; then a new list is made as usual.
 */
function madeByUnsureCreate(account: string, name: string, folders: unknown[]) {
  const unsure = unsureCreate;
  unsureCreate = null;
  if (!unsure || unsure.account !== account || unsure.name !== name) return undefined;
  const appeared = liveFolders(folders).filter(
    (f) => f.title === name && !unsure.before.has(f.folderid as number),
  );
  return appeared.length === 1 ? (appeared[0]?.folderid as number) : undefined;
}

/**
 * Copies a Kakao list to a new Kakao Map list named `name`. Resuming with the `folderId` a
 * `partial` failure named fills that same list: places it already holds are skipped by key.
 */
export async function duplicateToKakao(input: {
  sourceListId: string;
  name: string;
  resume?: { folderId: number };
}): Promise<KakaoCopyResult> {
  if (working) throw new KakaoCopyError("busy");
  working = true;
  try {
    const { places, leftOut } = await placesOf(input.sourceListId);
    const account = dbUserId(currentDb());
    const name = input.name.trim();
    const folders = await checkKakaoAccount();
    // Read (and so forgotten) on every copy, a resumed one too: it applies only to the next try.
    const appeared = madeByUnsureCreate(account, name, folders);
    let folderId = input.resume?.folderId ?? appeared;
    if (folderId === undefined) {
      const unsure = {
        account,
        name,
        before: new Set(liveFolders(folders).map((f) => f.folderid as number)),
      };
      let made: Record<string, unknown>;
      try {
        made = await ask({ type: "magomap.createList", name }, WRITE_WAIT_MS);
      } catch (error) {
        // No answer in time: the list may have been made all the same.
        if (error instanceof KakaoCopyError && error.code === "extension_missing") {
          unsureCreate = unsure;
        }
        throw error;
      }
      if (made.ok !== true || typeof made.folderId !== "number") {
        const code = failureOf(made);
        if (code === "kakao_unavailable") unsureCreate = unsure;
        throw new KakaoCopyError(code);
      }
      folderId = made.folderId;
    }
    let added = 0;
    let skipped = 0;
    for (let start = 0; start < places.length; start += PAGE) {
      const page = places.slice(start, start + PAGE);
      let answer: Record<string, unknown>;
      try {
        answer = await ask({ type: "magomap.addPlaces", folderId, places: page }, WRITE_WAIT_MS);
      } catch (error) {
        // No answer: some of this page may be in Kakao Map already.
        if (error instanceof KakaoCopyError) {
          throw new KakaoCopyError("partial", folderId, added, true);
        }
        throw error;
      }
      if (answer.ok !== true) {
        if (answer.error === "not_found") throw new KakaoCopyError("list_missing");
        const counted = typeof answer.added === "number";
        const some = counted ? (answer.added as number) : 0;
        throw new KakaoCopyError("partial", folderId, added + some, !counted);
      }
      added += typeof answer.added === "number" ? answer.added : 0;
      skipped += typeof answer.skipped === "number" ? answer.skipped : 0;
    }
    let synced = true;
    try {
      await runKakaoMapSync(() => undefined);
    } catch {
      synced = false;
    }
    return { folderId, added, skipped, leftOut, synced };
  } finally {
    working = false;
  }
}
