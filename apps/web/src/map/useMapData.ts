import { useMemo } from "react";
import { type Library, SAVED_GROUP, savedNotInList, sectionOf, useLibrary } from "../data/queries";
import type { PickerList } from "./ListPicker";
import { useMapPrefs } from "./mapPrefs";
import { buildMarkers, membershipColor, THEME_PRIMARY } from "./markers";

/** A list's swatch: its own colour, or the colour of its first place at the provider. */
function swatch(lib: Library, listId: string): string {
  const list = lib.lists.find((l) => l.id === listId);
  if (!list) return THEME_PRIMARY;
  const first = lib.items.find((i) => i.listId === listId && i.removedAtProvider == null);
  return first ? membershipColor(first, list) : (list.color ?? THEME_PRIMARY);
}

/** The picker sections, visible places and markers, from the local library and the map prefs. */
export function useMapData() {
  const lib = useLibrary();
  const { hidden, showPrevious } = useMapPrefs();
  return useMemo(() => {
    if (!lib) return null;
    const count = (id: string) =>
      lib.items.filter((i) => i.listId === id && i.removedAtProvider == null).length;
    const sections = {
      mine: [] as PickerList[],
      provider: [] as PickerList[],
      subscribed: [] as PickerList[],
    };
    for (const list of [...lib.lists].sort((a, b) => a.name.localeCompare(b.name))) {
      sections[sectionOf(list, lib.roles)].push({
        list,
        count: count(list.id),
        color: swatch(lib, list.id),
      });
    }
    const visibleListIds = new Set(
      [...lib.lists.map((l) => l.id), SAVED_GROUP].filter((id) => !hidden.has(id)),
    );
    const markers = buildMarkers({
      places: [...lib.places.values()],
      memberships: lib.items,
      lists: lib.lists,
      locations: lib.locations,
      roles: lib.roles,
      saved: lib.saved,
      visibleListIds,
      showPrevious,
    });
    const visibleIds = new Set(markers.filter((m) => m.kind === "saved").map((m) => m.id));
    const shownPlaces = [...lib.places.values()].filter(
      (p) =>
        visibleIds.has(p.id) ||
        (p.lat == null &&
          (lib.items.some((i) => i.placeId === p.id && visibleListIds.has(i.listId)) ||
            (visibleListIds.has(SAVED_GROUP) && savedNotInList(lib).includes(p.id)))),
    );
    const withoutLocation = shownPlaces.filter((p) => p.lat == null || p.lng == null).length;
    return {
      lib,
      sections: { ...sections, savedNotInList: savedNotInList(lib).length },
      markers,
      shownPlaces,
      withoutLocation,
    };
  }, [lib, hidden, showPrevious]);
}
