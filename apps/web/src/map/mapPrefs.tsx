import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

interface MapPrefs {
  /** Lists (and the saved group) the user turned off; everything else shows. */
  hidden: Set<string>;
  setVisible: (ids: string[], visible: boolean) => void;
  showPrevious: boolean;
  setShowPrevious: (on: boolean) => void;
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

/** Which lists show on the map, and previous locations; remembered per account. */
export function MapPrefsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const listsKey = `mm.visibleLists.${userId}`;
  const prevKey = `mm.showPrevious.${userId}`;
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set((JSON.parse(read(listsKey) ?? "{}") as { hidden?: string[] }).hidden ?? []);
    } catch {
      return new Set();
    }
  });
  const [showPrevious, setPrev] = useState(() => read(prevKey) !== "0");

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
    () => ({ hidden, setVisible, showPrevious, setShowPrevious }),
    [hidden, setVisible, showPrevious, setShowPrevious],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMapPrefs(): MapPrefs {
  const v = useContext(Ctx);
  if (!v) throw new Error("MapPrefsProvider missing");
  return v;
}
