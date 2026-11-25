import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { deviceKeys } from "../data/deviceKeys";
import { MAP_CHOICES, type MapChoice } from "./providerChoice";

interface MapPrefs {
  /** Lists (and the saved group) the user turned off; everything else shows. */
  hidden: Set<string>;
  setVisible: (ids: string[], visible: boolean) => void;
  showPrevious: boolean;
  setShowPrevious: (on: boolean) => void;
  /** Which map to show: Automatic (by where the map is), Kakao or OpenStreetMap. */
  mapChoice: MapChoice;
  setMapChoice: (choice: MapChoice) => void;
  /** Whether Kakao Map loaded on this page; null until the map has tried. Not stored. */
  kakaoAvailable: boolean | null;
  setKakaoAvailable: (available: boolean) => void;
  /** Where this account's last fit of the map to its places is kept (mapFitMemo). */
  fitKey: string;
}

const Ctx = createContext<MapPrefs | null>(null);

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // the choice still applies for this session
  }
};

/** Which lists show on the map, previous locations and which map; remembered per account. */
export function MapPrefsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const listsKey = deviceKeys.visibleLists(userId);
  const prevKey = deviceKeys.showPrevious(userId);
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set((JSON.parse(read(listsKey) ?? "{}") as { hidden?: string[] }).hidden ?? []);
    } catch {
      return new Set();
    }
  });
  const [showPrevious, setPrev] = useState(() => read(prevKey) !== "0");
  const choiceKey = deviceKeys.mapProvider(userId);
  const [mapChoice, setChoice] = useState<MapChoice>(() => {
    const stored = read(choiceKey);
    return MAP_CHOICES.find((c) => c === stored) ?? "auto";
  });
  const [kakaoAvailable, setKakaoAvailable] = useState<boolean | null>(null);
  const setMapChoice = useCallback(
    (choice: MapChoice) => {
      setChoice(choice);
      write(choiceKey, choice);
    },
    [choiceKey],
  );

  const setVisible = useCallback(
    (ids: string[], visible: boolean) => {
      setHidden((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (visible) next.delete(id);
          else next.add(id);
        }
        write(listsKey, JSON.stringify({ hidden: [...next] }));
        return next;
      });
    },
    [listsKey],
  );
  const setShowPrevious = useCallback(
    (on: boolean) => {
      setPrev(on);
      write(prevKey, on ? "1" : "0");
    },
    [prevKey],
  );
  const value = useMemo(
    () => ({
      hidden,
      setVisible,
      showPrevious,
      setShowPrevious,
      mapChoice,
      setMapChoice,
      kakaoAvailable,
      setKakaoAvailable,
      fitKey: deviceKeys.mapFit(userId),
    }),
    [
      hidden,
      setVisible,
      showPrevious,
      setShowPrevious,
      mapChoice,
      setMapChoice,
      kakaoAvailable,
      userId,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMapPrefs(): MapPrefs {
  const v = useContext(Ctx);
  if (!v) throw new Error("MapPrefsProvider missing");
  return v;
}
