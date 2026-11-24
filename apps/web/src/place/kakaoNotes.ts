import type { ListItemRow, ListRow } from "@magomap/domain";
import type { ListSection } from "../data/queries";

/** A list item's Kakao note, trimmed; null when it has none (or only spaces). */
export function kakaoNoteOf(item: Pick<ListItemRow, "providerNote">): string | null {
  const text = item.providerNote?.trim();
  return text ? text : null;
}

/**
 * The note the peek card shows: one Kakao note of the place. Lists he owns come before lists he
 * follows, then by list name; empty notes and items removed from Kakao are skipped.
 */
export function peekNoteOf(
  memberships: { item: ListItemRow; list: ListRow; section: ListSection }[],
): string | null {
  const rank = (section: ListSection) => (section === "provider" ? 0 : 1);
  const kakao = memberships
    .filter(({ list, item }) => list.provider === "kakao" && item.removedAtProvider == null)
    .sort((a, b) => rank(a.section) - rank(b.section) || a.list.name.localeCompare(b.list.name));
  for (const { item } of kakao) {
    const note = kakaoNoteOf(item);
    if (note) return note;
  }
  return null;
}
