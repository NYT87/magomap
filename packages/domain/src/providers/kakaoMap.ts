// The Kakao Map adapter: raw Kakao Map records (folders and favourites, as magomap's extension
// reads them) into the neutral import format. It gives exactly the ids and fields the earlier
// kakao-list import gave (kakao-list 730ee2d: extractor `normalizeFavoriteItem` and list mapping,
// server `magomapIntegration.ts`), so rows that import created keep being updated, not duplicated.
// kakaoMap.test.ts checks that against a copy of kakao-list's code.
// The one difference: coordinates prefer Kakao's own lat/lon (kakaoFavoritePoint).
// Raw records are read leniently: an odd value is ignored, never thrown on.
import { z } from "zod";
import type { ImportItem, ImportListSummary } from "../importContract";
import { LIMITS } from "../limits";
import { isStorableText } from "../sync";
import { kakaoListExternalId, usableNickname } from "./kakao";
import { kakaoFavoritePoint } from "./wcongnamul";

/** What the extension sends at the start of an upload run. */
export interface KakaoMapStart {
  /** Raw `/folder/list` records, as received. */
  folders: unknown[];
  counts: { folderid: number; itemCount: number; firstDisplay2?: string }[];
}

export const kakaoMapStartSchema: z.ZodType<KakaoMapStart> = z.object({
  folders: z.array(z.unknown()).max(2000),
  counts: z
    .array(
      z.object({
        folderid: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        itemCount: z.number().int().nonnegative().max(LIMITS.importListItems),
        firstDisplay2: z.string().optional(),
      }),
    )
    .max(LIMITS.importLists),
});

/** The Kakao Map account a read came from: the owner of its own lists. */
export interface KakaoMapAccount {
  kakaoMapUserId: string;
  nickname?: string;
}

/** The read's own lists don't name exactly one Kakao Map account; nothing may be written. */
export class KakaoAccountUnclearError extends Error {
  constructor() {
    super("Can't tell which Kakao Map account these lists belong to");
    this.name = "KakaoAccountUnclearError";
  }
}

/** Kakao Map answered with no folders: it isn't signed in (signed in, folder 0 always exists). */
export class KakaoSignedOutError extends Error {
  constructor() {
    super("Kakao Map is signed out");
    this.name = "KakaoSignedOutError";
  }
}

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : undefined;

/** A trimmed, non-empty string, or undefined (kakao-list's `value?.trim() || undefined`). */
const trimmed = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() || undefined : undefined;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Text ready for the neutral schemas: unstorable characters dropped, trimmed, and cut to `max`
 * UTF-16 units (the schemas' measure) without splitting a character. Undefined when empty.
 */
function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replaceAll("\u0000", "").replace(LONE_SURROGATE, "").trim();
  if (clean.length <= max) return clean || undefined;
  let cut = "";
  for (const char of clean) {
    if (cut.length + char.length > max) break;
    cut += char;
  }
  return cut.trimEnd() || undefined;
}

/** An id: kept whole or not at all, never cut. */
const id = (value: string): string | undefined =>
  value.length >= 1 && value.length <= 200 && isStorableText(value) ? value : undefined;

const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

// --- Folders ---

interface Folder {
  folderid: number;
  raw: Raw;
}

/** kakao-list's `metadataScore`: which of two records of one folder says more. */
const metadataScore = (r: Raw): number =>
  (r.title ? 3 : 0) + (r.favorite_cnt !== undefined ? 2 : 0) + (r.folder_updated_at ? 1 : 0);

/**
 * kakao-list's `dedupeFolders`: numeric folder ids, deleted (`status: "D"`) folders skipped, one
 * record per folder (the one with more metadata, the later on a tie), in first-seen order.
 */
function dedupeFolders(records: unknown[]): Folder[] {
  const byId = new Map<number, Raw>();
  for (const value of records) {
    const r = record(value);
    if (!r || typeof r.folderid !== "number" || r.status === "D") continue;
    const current = byId.get(r.folderid);
    byId.set(r.folderid, !current || metadataScore(r) >= metadataScore(current) ? r : current);
  }
  return Array.from(byId, ([folderid, raw]) => ({ folderid, raw }));
}

/** kakao-list's `flagged`: Kakao sets `subscribe` on followed folders and on public ones. */
function flagged(value: unknown): boolean {
  if (value == null || value === false) return false;
  const text = String(value).trim().toLowerCase();
  return text !== "" && text !== "0" && text !== "n" && text !== "false";
}

/** kakao-list's `ownerOf`: `kakao_map_user_id`, else `map_user_id`. */
const ownerOf = (r: Raw): string | undefined =>
  trimmed(r.kakao_map_user_id) ||
  (r.map_user_id && (typeof r.map_user_id === "string" || typeof r.map_user_id === "number")
    ? String(r.map_user_id).trim()
    : undefined) ||
  undefined;

/** kakao-list's folder ids as magomap reads them back (`kakao-folder-<1–15 digits>`). */
const listable = (folderid: number) =>
  Number.isSafeInteger(folderid) && folderid >= 0 && String(folderid).length <= 15;

/**
 * The one account owning the read's unflagged folders. An unflagged folder that carries only
 * `map_user_id` counts as the account whose unflagged folders carry that `map_user_id` beside a
 * `kakao_map_user_id`. Only her own (unflagged) folders vouch for that pairing; a `map_user_id`
 * paired with two different `kakao_map_user_id`s is unclear.
 */
function accountOf(folders: Folder[]): { account: string; alias: Map<string, string> } {
  const own = folders.filter(({ raw }) => !flagged(raw.subscribe)).map(({ raw }) => raw);
  const alias = new Map<string, string>();
  for (const raw of own) {
    const kakaoId = trimmed(raw.kakao_map_user_id);
    const mapId = ownerOf({ map_user_id: raw.map_user_id });
    if (!kakaoId || !mapId) continue;
    const seen = alias.get(mapId);
    if (seen !== undefined && seen !== kakaoId) throw new KakaoAccountUnclearError();
    alias.set(mapId, kakaoId);
  }
  const owners = new Set<string>();
  for (const raw of own) {
    const kakaoId = trimmed(raw.kakao_map_user_id);
    if (kakaoId) {
      owners.add(kakaoId);
      continue;
    }
    const mapId = ownerOf(raw);
    if (mapId) owners.add(alias.get(mapId) ?? mapId);
  }
  const [only, ...more] = owners;
  if (!only || more.length > 0) throw new KakaoAccountUnclearError();
  return { account: only, alias };
}

/**
 * The read's lists, its account, that it knows which lists are followed, and each list's Kakao
 * owner (by external id): the Kakao Map account that owns the folder in Kakao, which decides who
 * owns the list in magomap. Kept apart from `lists`, which match kakao-list's mapping exactly.
 * - `providerOwnerIds`: her own folders (her account) and followed folders that carry a
 *   `kakao_map_user_id`.
 * - `mapOwnerIds`: followed folders that carry only a `map_user_id`. That id may not be the one
 *   the owner's account is bound by, so the server keeps it only when it names a bound account
 *   (by its id or alias), and never records it bare.
 * - `accountAlias`: the one `map_user_id` her own folders carry beside her `kakao_map_user_id`,
 *   so folders named by either id match her account.
 * - `bareFolders`: followed folders that came back with no owner id and no title (probably made
 *   private by their owner; docs/kakao-map-access.md section 6). Such a read shows only that she
 *   follows the list, not its name or contents, so the server imports it as access only.
 */
export function kakaoMapListsToImport(
  start: KakaoMapStart,
  kakaoLoginId: string,
): {
  lists: ImportListSummary[];
  account: KakaoMapAccount;
  accountAlias?: string;
  subscriptionKnown: boolean;
  providerOwnerIds: Map<string, string>;
  mapOwnerIds: Map<string, string>;
  bareFolders: Set<string>;
} {
  const folders = dedupeFolders(start.folders);
  if (folders.length === 0) throw new KakaoSignedOutError();
  const { account: kakaoMapUserId, alias } = accountOf(folders);
  const aliases = [...alias].filter(
    ([mapId, kakaoId]) => kakaoId === kakaoMapUserId && mapId !== kakaoId,
  );
  const accountAlias =
    aliases.length === 1 && aliases[0] !== undefined ? id(aliases[0][0]) : undefined;

  // Followed as kakao-list decides it: flagged, and not made by an owner of an unflagged folder
  // (a folder with no owner id, such as a bare followed one, is never her own). Unlike kakao-list,
  // a flagged folder that names only the map_user_id her own folders pair with her account is
  // hers too: her own public list, which Kakao flags like a followed one.
  const ownOwners = new Set(
    folders.flatMap(({ raw }) => {
      const owner = flagged(raw.subscribe) ? undefined : ownerOf(raw);
      return owner ? [owner] : [];
    }),
  );
  const counts = new Map(start.counts.map((c) => [c.folderid, c]));

  const lists: ImportListSummary[] = [];
  const providerOwnerIds = new Map<string, string>();
  const mapOwnerIds = new Map<string, string>();
  const bareFolders = new Set<string>();
  let nickname: string | undefined;
  for (const { folderid, raw } of folders) {
    const rawOwner = ownerOf(raw) ?? "";
    // The alias is a map_user_id: it applies only to a folder that names no kakao_map_user_id.
    const viaAlias = trimmed(raw.kakao_map_user_id) ? undefined : alias.get(rawOwner);
    const followed =
      flagged(raw.subscribe) &&
      !ownOwners.has(rawOwner) &&
      !(viaAlias !== undefined && ownOwners.has(viaAlias));
    if (!followed) nickname ??= usableNickname(raw.nickname);
    if (!listable(folderid)) continue;
    const externalId = kakaoListExternalId(folderid, kakaoLoginId);
    // `kakao_map_user_id || map_user_id`; a bare map_user_id joins her account only on her own
    // folders, and is kept apart on followed ones. A bare folder names no owner.
    const owner = ownerOf(raw);
    const bareMapId = owner !== undefined && !trimmed(raw.kakao_map_user_id);
    const ownerId = owner && !followed && bareMapId ? (alias.get(owner) ?? owner) : owner;
    const storedOwner = ownerId === undefined ? undefined : id(ownerId);
    if (storedOwner)
      (followed && bareMapId ? mapOwnerIds : providerOwnerIds).set(externalId, storedOwner);
    const title = clip(raw.title, LIMITS.importTitle);
    if (followed && owner === undefined && title === undefined) bareFolders.add(externalId);
    const count = counts.get(folderid);
    const mapUserId = raw.map_user_id;
    const creatorName =
      trimmed(raw.nickname) ||
      trimmed(raw.kakao_map_user_id) ||
      (mapUserId && (typeof mapUserId === "string" || typeof mapUserId === "number")
        ? `map:${mapUserId}`
        : undefined);
    lists.push(
      defined({
        externalId,
        name: title ?? `Folder ${folderid}`,
        description: clip(trimmed(raw.memo) || count?.firstDisplay2, LIMITS.importText),
        followed,
        ownerName: followed ? clip(creatorName, LIMITS.importTitle) : undefined,
        itemCount: count?.itemCount ?? 0,
      }),
    );
  }

  return {
    lists,
    account: nickname ? { kakaoMapUserId, nickname } : { kakaoMapUserId },
    ...(accountAlias === undefined ? {} : { accountAlias }),
    subscriptionKnown: true,
    providerOwnerIds,
    mapOwnerIds,
    bareFolders,
  };
}

// --- Favourites ---

/** Favourite types that are places, with their `key` (kakao-list's `MAGOMAP_PLACE_TYPES`). */
const PLACE_TYPES: ReadonlySet<string> = new Set(["PLACE", "ADDRESS"]);

/** kakao-list keeps a favourite's type only when it is short, plain text; otherwise it's untyped. */
function typeOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 40) return undefined;
  return Array.from(value).some((char) => char.charCodeAt(0) < 32) ? undefined : value;
}

/** kakao-list's `seq ?? key` part of the item id, when it can be stored. */
function seqOrKey(f: Raw): string | undefined {
  const { seq, key } = f;
  if (typeof seq === "number" && Number.isFinite(seq)) return id(String(seq));
  if (typeof seq === "string") return id(seq);
  if (typeof key === "string") return id(key);
  return undefined;
}

function toItem(folderid: number, value: unknown, index: number): ImportItem {
  const f = record(value) ?? {};
  const type = typeOf(f.type);
  const isPlace = type === undefined || PLACE_TYPES.has(type);
  const placeKey = trimmed(f.key);
  const point = kakaoFavoritePoint(f);
  return defined({
    externalId: seqOrKey(f) ?? `${folderid}-${index}`,
    placeExternalId: isPlace && placeKey ? id(placeKey) : undefined,
    title: clip(f.display1, LIMITS.importTitle) ?? `Saved place ${index + 1}`,
    address: clip(f.display2, LIMITS.importText),
    lat: point?.lat,
    lng: point?.lng,
    providerNote: clip(f.memo, LIMITS.importText),
    providerColor: clip(f.color, 40),
    position: index,
  });
}

/** One page of a folder's raw favourites; `offset` is the page's first index in the folder. */
export function kakaoMapItemsToImport(
  folderid: number,
  offset: number,
  favorites: unknown[],
): ImportItem[] {
  return favorites.map((favorite, i) => toItem(folderid, favorite, offset + i));
}
