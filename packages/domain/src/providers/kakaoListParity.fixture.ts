// TEST FIXTURE ONLY. kakao-list's deployed Kakao Map mapping, copied so the parity test in
// kakaoMap.test.ts can run one raw fixture through both kakao-list's code and magomap's adapter.
//
// Source: kakao-list (same owner), commit 730ee2d (`main` on 2026-11-20, after PRs #27 and #29).
//   - apps/extension/src/kakaoMapsExtractor.ts, `extractSnapshotInPageEnvelope`: the record types,
//     `metadataScore`, `dedupeFolders`, `normalizeFavoriteItem`, `flagged`, `ownerOf`,
//     `ownFolderOwners` and the list mapping.
//   - packages/domain/src/index.ts, `parseSnapshot`: only the lines that change an item's Kakao
//     fields on the way into storage (`coordinate`, `shortText`, the kakaoX/kakaoY/kakaoType
//     spread). Its refusals (over-long text, duplicate ids) reject a whole push and are not copied.
//   - apps/server/src/magomapIntegration.ts: `MAGOMAP_PLACE_TYPES`, `defined`, `folderIdOf`,
//     `kakaoLists`, `toMagomapLists`, `toMagomapItem` and `toMagomapItems`.
//   - packages/domain/src/coordinates.ts: `wcongnamulToLatLng`.
// Logic is unchanged; only syntax is adapted (plain functions instead of closures in the page,
// Biome formatting, fetches replaced by arguments, a fixed `importedAt`). Left out because
// magomap's items and lists never read them: `updatedAt`/`resolveListUpdatedAt`, `href`,
// `kakaoFolderId` on items, `ownerId`, and `toMagomapLists`' `ownerNickname`. (kakao-list's
// `ownerId` line calls `.trim()` on `map_user_id`, which throws when Kakao sends it as a number.)
import proj4 from "proj4";
import { z } from "zod";
import type {
  ImportItem,
  ImportItemsPage,
  ImportListSummary,
  ImportListsSnapshot,
} from "../importContract";
import { LIMITS } from "../limits";
import { position, storableText } from "../sync";
import { KAKAO, kakaoListExternalId, usableNickname } from "./kakao";

// --- kakaoMapsExtractor.ts: record types ---

interface KakaoMapsFolderRecord {
  folderid?: number;
  title?: string;
  memo?: string;
  status?: string;
  icon?: string;
  favorite_cnt?: number;
  created_at?: string;
  folder_updated_at?: string;
  nickname?: string;
  kakao_map_user_id?: string;
  map_user_id?: string;
  /** Present on folders this account follows (and possibly on public ones; see G2). */
  subscribe?: unknown;
}

interface KakaoMapsFavoriteRecord {
  seq?: number;
  type?: string;
  display1?: string;
  display2?: string;
  memo?: string;
  key?: string;
  x?: number;
  y?: number;
  color?: string;
  folderid?: number;
  created_at?: string;
  item_updated_at?: string;
}

// The parts of kakao-list's @kakao-lists/domain FavoriteListItem / FavoriteList read here.
interface FavoriteListItem {
  id: string;
  title: string;
  placeKey?: string;
  color?: string;
  subtitle?: string;
  kakaoNote?: string;
  localNote?: string;
  kakaoX?: number;
  kakaoY?: number;
  kakaoType?: string;
}

interface FavoriteList {
  id: string;
  name: string;
  description?: string;
  creatorName?: string;
  itemCount: number;
  items: FavoriteListItem[];
  subscribed?: boolean;
}

// --- coordinates.ts ---

const EPSG_5181 =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs";
const toWgs84 = proj4(EPSG_5181, "WGS84");

const usable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v !== 0;

function wcongnamulToLatLng(x: unknown, y: unknown): { lat: number; lng: number } | undefined {
  if (!usable(x) || !usable(y)) return undefined;
  const [lng, lat] = toWgs84.forward([x / 2.5, y / 2.5]) as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < 32 || lat > 40 || lng < 123 || lng > 133) return undefined;
  return { lat, lng };
}

// --- kakaoMapsExtractor.ts: extractSnapshotInPageEnvelope ---

const metadataScore = (record: KakaoMapsFolderRecord): number => {
  let score = 0;
  if (record.title) score += 3;
  if (record.favorite_cnt !== undefined) score += 2;
  if (record.folder_updated_at) score += 1;
  return score;
};

const dedupeFolders = (
  records: KakaoMapsFolderRecord[],
): Array<Required<Pick<KakaoMapsFolderRecord, "folderid">> & KakaoMapsFolderRecord> => {
  const byId = new Map<number, KakaoMapsFolderRecord>();

  for (const record of records) {
    if (typeof record.folderid !== "number") {
      continue;
    }
    if (record.status === "D") {
      continue;
    }

    const current = byId.get(record.folderid);
    if (!current) {
      byId.set(record.folderid, record);
      continue;
    }

    byId.set(record.folderid, metadataScore(record) >= metadataScore(current) ? record : current);
  }

  return Array.from(byId.entries()).map(([folderid, record]) => ({
    folderid,
    ...record,
  }));
};

const normalizeFavoriteItem = (
  folderId: number,
  favorite: KakaoMapsFavoriteRecord,
  index: number,
): FavoriteListItem => {
  return {
    id: String(favorite.seq ?? favorite.key ?? `${folderId}-${index}`),
    title: favorite.display1?.trim() || `Saved place ${index + 1}`,
    placeKey: favorite.key?.trim() || undefined,
    color: favorite.color?.trim() || undefined,
    subtitle: favorite.display2?.trim() || undefined,
    kakaoNote: favorite.memo?.trim() || undefined,
    localNote: undefined,
    // Raw values only: this runs inside the Kakao page and can't import the converter.
    kakaoX: favorite.x,
    kakaoY: favorite.y,
    kakaoType: favorite.type,
  };
};

function extractLists(
  folderRecords: KakaoMapsFolderRecord[],
  favoritesOf: (folderid: number) => KakaoMapsFavoriteRecord[],
): FavoriteList[] {
  const folders = dedupeFolders(folderRecords);
  const folderFavorites = folders.map((folder) => ({
    folder,
    favorites: favoritesOf(folder.folderid),
  }));

  // Kakao sets `subscribe` on followed folders and on public ones, her own included. A flagged
  // folder is followed only when someone other than the owner of her unflagged folders made it.
  const flagged = (value: unknown): boolean => {
    if (value == null || value === false) return false;
    const text = String(value).trim().toLowerCase();
    return text !== "" && text !== "0" && text !== "n" && text !== "false";
  };
  const ownerOf = (folder: KakaoMapsFolderRecord): string | undefined =>
    folder.kakao_map_user_id?.trim() ||
    (folder.map_user_id ? String(folder.map_user_id).trim() : undefined) ||
    undefined;
  const ownFolderOwners = new Set(
    folders
      .filter((folder) => !flagged(folder.subscribe))
      .map(ownerOf)
      .filter((owner): owner is string => Boolean(owner)),
  );

  return folderFavorites.map(({ folder, favorites }) => {
    const items = favorites.map((favorite, index) =>
      normalizeFavoriteItem(folder.folderid, favorite, index),
    );

    return {
      id: `kakao-folder-${folder.folderid}`,
      name: folder.title?.trim() || `Folder ${folder.folderid}`,
      description: folder.memo?.trim() || favorites[0]?.display2?.trim() || undefined,
      creatorName:
        folder.nickname?.trim() ||
        folder.kakao_map_user_id?.trim() ||
        (folder.map_user_id ? `map:${folder.map_user_id}` : undefined),
      itemCount: items.length,
      items,
      subscribed: flagged(folder.subscribe) && !ownFolderOwners.has(ownerOf(folder) ?? ""),
    };
  });
}

// --- packages/domain/src/index.ts: parseSnapshot, the item's Kakao fields ---

const coordinate = (input: unknown): input is number =>
  typeof input === "number" && Number.isFinite(input) && input !== 0;
const shortText = (input: unknown, max: number): string | undefined =>
  typeof input === "string" &&
  input.trim() &&
  input.length <= max &&
  !Array.from(input).some((char) => char.charCodeAt(0) < 32)
    ? input
    : undefined;

function stored(item: FavoriteListItem): FavoriteListItem {
  const { kakaoX, kakaoY, kakaoType, ...rest } = item;
  return {
    ...rest,
    ...(coordinate(kakaoX) && coordinate(kakaoY) ? { kakaoX, kakaoY } : {}),
    ...(shortText(kakaoType, 40) !== undefined ? { kakaoType: kakaoType as string } : {}),
  };
}

// --- magomapIntegration.ts ---

const MAGOMAP_PLACE_TYPES: ReadonlySet<string> = new Set(["PLACE", "ADDRESS"]);

const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

function folderIdOf(list: FavoriteList): number | undefined {
  const match = /^kakao-folder-(\d{1,15})$/.exec(list.id);
  const id = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(id) ? id : undefined;
}

const kakaoLists = (lists: FavoriteList[]) =>
  lists.flatMap((list) => {
    const kakaoFolderId = folderIdOf(list);
    return kakaoFolderId === undefined ? [] : [{ list, kakaoFolderId }];
  });

const IMPORTED_AT = "2026-11-20T00:00:00.000Z";

function toMagomapLists(kakaoUserId: string, lists: FavoriteList[]) {
  return {
    contractVersion: 1,
    kakaoUserId,
    importedAt: IMPORTED_AT,
    complete: true,
    subscriptionKnown: true,
    lists: kakaoLists(lists).map(({ list, kakaoFolderId }) =>
      defined({
        kakaoFolderId,
        name: list.name,
        description: list.description,
        subscribed: list.subscribed === true,
        // The owner's name only means something on a list someone else made.
        ownerName: list.subscribed === true ? list.creatorName : undefined,
        itemCount: list.items.length,
      }),
    ),
  };
}

function toMagomapItem(
  item: FavoriteListItem,
  position: number,
  placeTypes: ReadonlySet<string> | undefined,
) {
  // A favourite is a place when its type says so; untyped (older) favourites keep their key.
  const isPlace =
    placeTypes === undefined || item.kakaoType === undefined || placeTypes.has(item.kakaoType);
  const point = wcongnamulToLatLng(item.kakaoX, item.kakaoY);
  return defined({
    favoriteSeq: item.id,
    favoriteType: item.kakaoType,
    placeKey: isPlace ? item.placeKey : undefined,
    title: item.title,
    address: item.subtitle,
    lat: point?.lat,
    lng: point?.lng,
    kakaoNote: item.kakaoNote,
    kakaoColor: item.color,
    localNote: item.localNote,
    position,
  });
}

function toMagomapItems(
  lists: FavoriteList[],
  kakaoFolderId: number,
  offset: number,
  limit: number,
  placeTypes?: ReadonlySet<string>,
) {
  const found = kakaoLists(lists).find((l) => l.kakaoFolderId === kakaoFolderId);
  if (!found) return undefined;
  const { items } = found.list;
  return {
    contractVersion: 1,
    kakaoFolderId,
    importedAt: IMPORTED_AT,
    total: items.length,
    offset,
    items: items
      .slice(offset, offset + limit)
      .map((item, i) => toMagomapItem(item, offset + i, placeTypes)),
  };
}

// --- magomap's reading of kakao-list's magomap endpoints (the import magomap had before the
// Kakao Map sync; providers/kakao.ts until it was removed), the last step of the old path ---

const text = (max: number) => storableText(max);
const required = (max: number) => text(max).pipe(z.string().min(1));

const kakaoItem = z.object({
  favoriteSeq: required(200),
  favoriteType: text(40).optional(),
  placeKey: required(200).optional(),
  title: required(LIMITS.importTitle),
  address: text(LIMITS.importText).optional(),
  category: text(LIMITS.importTitle).optional(),
  phone: text(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  kakaoNote: text(LIMITS.importText).optional(),
  kakaoColor: text(40).optional(),
  localNote: text(LIMITS.importText).optional(),
  position,
});

const kakaoListSummary = z.object({
  kakaoFolderId: z.number().int().nonnegative(),
  name: required(LIMITS.importTitle),
  description: text(LIMITS.importText).optional(),
  icon: text(200).optional(),
  subscribed: z.boolean(),
  ownerName: text(LIMITS.importTitle).optional(),
  itemCount: z.number().int().nonnegative().max(LIMITS.importListItems),
});

/** kakao-list's GET /api/integrations/magomap/lists body. */
export const kakaoListsSchema = z.object({
  contractVersion: z.literal(1),
  kakaoUserId: required(200),
  importedAt: required(40),
  complete: z.boolean(),
  subscriptionKnown: z.boolean().optional(),
  // Checked by hand, not by the schema: a nickname we can't use must never fail the import.
  ownerNickname: z.unknown().optional(),
  lists: z
    .array(kakaoListSummary)
    .max(LIMITS.importLists)
    .refine((lists) => new Set(lists.map((l) => l.kakaoFolderId)).size === lists.length, {
      message: "A list appears twice",
    }),
});

/** kakao-list's GET /api/integrations/magomap/lists/:folderId/items body. */
export const kakaoItemsSchema = z.object({
  contractVersion: z.literal(1),
  kakaoFolderId: z.number().int().nonnegative(),
  importedAt: required(40),
  total: z.number().int().nonnegative().max(LIMITS.importListItems),
  offset: z.number().int().nonnegative(),
  items: z.array(kakaoItem).max(LIMITS.importChunkItems),
});

export type KakaoLists = z.infer<typeof kakaoListsSchema>;
export type KakaoItems = z.infer<typeof kakaoItemsSchema>;

function kakaoListsToImport(raw: unknown, kakaoUserId: string): ImportListsSnapshot {
  const c = kakaoListsSchema.parse(raw);
  const ownerNickname = usableNickname(c.ownerNickname);
  return {
    provider: KAKAO,
    importedAt: c.importedAt,
    complete: c.complete,
    subscriptionKnown: c.subscriptionKnown ?? false,
    ...(ownerNickname ? { ownerNickname } : {}),
    lists: c.lists.map((l) =>
      defined({
        externalId: kakaoListExternalId(l.kakaoFolderId, kakaoUserId),
        name: l.name,
        description: l.description,
        followed: l.subscribed,
        ownerName: l.ownerName,
        itemCount: l.itemCount,
      }),
    ),
  };
}

function kakaoItemsToImport(raw: unknown, kakaoUserId: string): ImportItemsPage {
  const c = kakaoItemsSchema.parse(raw);
  return {
    externalId: kakaoListExternalId(c.kakaoFolderId, kakaoUserId),
    importedAt: c.importedAt,
    total: c.total,
    offset: c.offset,
    items: c.items.map((i) =>
      defined({
        externalId: i.favoriteSeq,
        placeExternalId: i.placeKey,
        title: i.title,
        address: i.address,
        category: i.category,
        phone: i.phone,
        lat: i.lat,
        lng: i.lng,
        providerNote: i.kakaoNote,
        providerColor: i.kakaoColor,
        localNote: i.localNote,
        position: i.position,
      }),
    ),
  };
}

// --- The whole path: extractor → storage → magomap endpoints → magomap's kakao-list adapter ---

/**
 * kakao-list's mapping of raw Kakao Map records, as magomap imports it today: the neutral list
 * summaries, and each folder's items (one page from offset 0), keyed by `String(folderid)`.
 */
export function kakaoListParity(
  folders: unknown[],
  favorites: Record<string, unknown[]>,
  kakaoUserId: string,
): { lists: ImportListSummary[]; items: Record<string, ImportItem[]> } {
  const extracted = extractLists(
    folders as KakaoMapsFolderRecord[],
    (folderid) => (favorites[String(folderid)] ?? []) as KakaoMapsFavoriteRecord[],
  ).map((list) => ({ ...list, items: list.items.map(stored) }));

  const lists = kakaoListsToImport(toMagomapLists(kakaoUserId, extracted), kakaoUserId).lists;
  const items: Record<string, ImportItem[]> = {};
  for (const { kakaoFolderId } of kakaoLists(extracted)) {
    const page = toMagomapItems(extracted, kakaoFolderId, 0, 500, MAGOMAP_PLACE_TYPES);
    if (page) items[String(kakaoFolderId)] = kakaoItemsToImport(page, kakaoUserId).items;
  }
  return { lists, items };
}
