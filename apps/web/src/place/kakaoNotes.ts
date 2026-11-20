import type { ListItemRow, ListRow } from "@magomap/domain";
import { membershipColor } from "../map/markers";

/** One Kakao note on a place, with every list it was written in. */
export interface KakaoNoteCard {
  text: string;
  from: { listId: string; name: string; color: string; removed: boolean }[];
}

/**
 * Groups a place's Kakao notes: one card per distinct note text (compared trimmed), in
 * membership order, naming the lists it comes from. Notes from lists removed from Kakao stay.
 */
export function groupKakaoNotes(
  memberships: { item: ListItemRow; list: ListRow }[],
): KakaoNoteCard[] {
  const cards = new Map<string, KakaoNoteCard>();
  for (const { item, list } of memberships) {
    const text = item.providerNote?.trim();
    if (!text) continue;
    const card = cards.get(text) ?? { text, from: [] };
    card.from.push({
      listId: list.id,
      name: list.name,
      color: membershipColor(item, list),
      removed: item.removedAtProvider != null,
    });
    cards.set(text, card);
  }
  return [...cards.values()];
}
