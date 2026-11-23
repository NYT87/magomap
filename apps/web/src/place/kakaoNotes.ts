import type { ListItemRow } from "@magomap/domain";

/** A list item's Kakao note, trimmed; null when it has none (or only spaces). */
export function kakaoNoteOf(item: Pick<ListItemRow, "providerNote">): string | null {
  const text = item.providerNote?.trim();
  return text ? text : null;
}
