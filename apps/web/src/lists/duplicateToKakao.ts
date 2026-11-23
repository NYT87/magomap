// Copies a Kakao list to Kakao Map as a new list on his own account, through the extension:
// check which Kakao Map account is signed in, create the list, add the places in pages, then run
// the usual sync so the new list comes in as his own Kakao list. Kakao Map is written first and
// magomap only follows by that sync; nothing here writes magomap's own rows.
import { latLngToWcongnamul } from "@magomap/domain/providers/wcongnamul";
import { currentDb, dbUserId } from "../data/db";
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
  | "not_kakao_list";

export class KakaoCopyError extends Error {
  constructor(
    readonly code: KakaoCopyCode,
    /** `partial` only: the Kakao list that was made, and how many places it holds from this copy. */
    readonly folderId?: number,
    readonly added?: number,
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
const PAGE = 50;
/** The extension's own limit per write is 2 minutes; the page waits a little longer. */
const WRITE_WAIT_MS = 150_000;
const ACCOUNT_WAIT_MS = 60_000;

const KEY = /^[1-9]\d{0,14}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

interface SendPlace {
  key: string;
  title: string;
  address: string;
  x: number;
  y: number;
  color?: string;
}

/** One answer from the extension: its ok body, or the copy's error for it. */
async function ask(message: { type: string; [k: string]: unknown }, wait: number) {
  const answer = await askExtension(message, wait);
  if (answer === undefined) throw new KakaoCopyError("extension_missing");
  if (!isRecord(answer)) throw new KakaoCopyError("kakao_unavailable");
  return answer;
}

const failureOf = (answer: Record<string, unknown>): KakaoCopyCode => {
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
  const places: SendPlace[] = [];
  let leftOut = 0;
  const seen = new Set<string>();
  for (const item of items) {
    const place = await db.places.get(item.placeId);
    const sources = await db.place_sources.where("placeId").equals(item.placeId).toArray();
    const key = sources.find((s) => s.provider === "kakao" && s.deletedAt == null)?.externalId;
    const point = place ? latLngToWcongnamul(place.lat, place.lng) : undefined;
    const title = place?.title.trim() ?? "";
    if (!place || !key || !KEY.test(key) || !point || title === "" || seen.has(key)) {
      leftOut += 1;
      continue;
    }
    seen.add(key);
    const color = item.providerColor ?? item.itemColor ?? undefined;
    places.push({
      key,
      title,
      address: place.roadAddress?.trim() || place.address?.trim() || "",
      ...point,
      ...(color && /^\d{2}$/.test(color) ? { color } : {}),
    });
  }
  return { places, leftOut };
}

/** Whether the Kakao Map account signed in on the page is the one linked to his magomap account. */
export async function checkKakaoAccount(): Promise<void> {
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
}

let working = false;

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
    await checkKakaoAccount();
    let folderId = input.resume?.folderId;
    if (folderId === undefined) {
      const made = await ask(
        { type: "magomap.createList", name: input.name.trim() },
        WRITE_WAIT_MS,
      );
      if (made.ok !== true || typeof made.folderId !== "number") {
        throw new KakaoCopyError(failureOf(made));
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
        if (error instanceof KakaoCopyError) {
          throw new KakaoCopyError("partial", folderId, added);
        }
        throw error;
      }
      if (answer.ok !== true) {
        const some = typeof answer.added === "number" ? answer.added : 0;
        throw new KakaoCopyError("partial", folderId, added + some);
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
