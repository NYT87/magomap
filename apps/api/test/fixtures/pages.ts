import type { KakaoListContract } from "@magomap/domain/providers/kakao";

/** kakao-list's paged endpoints, built from a whole-contract fixture. */
export function listsBody(c: KakaoListContract) {
  return {
    contractVersion: 1,
    kakaoUserId: c.kakaoUserId,
    importedAt: c.importedAt,
    complete: c.complete,
    subscriptionKnown: true,
    lists: c.lists.map(({ items, ...meta }) => ({ ...meta, itemCount: items.length })),
  };
}

export function itemsBody(c: KakaoListContract, folderId: number, offset: number, limit = 500) {
  const list = c.lists.find((l) => l.kakaoFolderId === folderId);
  if (!list) return null;
  return {
    contractVersion: 1,
    kakaoFolderId: folderId,
    importedAt: c.importedAt,
    total: list.items.length,
    offset,
    items: list.items.slice(offset, offset + limit),
  };
}
