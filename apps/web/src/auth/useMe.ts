import type { Me } from "@magomap/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT_CHANGED, apiFetch, NetworkError, UnauthorizedError } from "../api/client";

const KEY = "mm.me";

export function storedMe(): Me | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export function forgetMe() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** Who is signed in. Offline, the last known account is used so the app still opens. */
export function useMe(): {
  me: Me | null;
  loading: boolean;
  offline: boolean;
  refresh: () => void;
} {
  const [state, setState] = useState<{ me: Me | null; loading: boolean; offline: boolean }>({
    me: null,
    loading: true,
    offline: false,
  });
  const live = useRef(true);
  // Only the latest question counts: an older, slower answer may name an account since replaced.
  const asked = useRef(0);
  const refresh = useCallback(() => {
    const ask = ++asked.current;
    const current = () => live.current && ask === asked.current;
    apiFetch<Me>("/api/me")
      .then((me) => {
        if (!current()) return;
        try {
          localStorage.setItem(KEY, JSON.stringify(me));
        } catch {
          // storage blocked
        }
        setState({ me, loading: false, offline: false });
      })
      .catch((error) => {
        if (!current()) return;
        if (error instanceof UnauthorizedError) {
          forgetMe();
          setState({ me: null, loading: false, offline: false });
        } else {
          setState({ me: storedMe(), loading: false, offline: error instanceof NetworkError });
        }
      });
  }, []);
  useEffect(() => {
    live.current = true;
    refresh();
    // Another tab signed in or out, or the server saw another account's session: ask again.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) refresh();
    };
    window.addEventListener(ACCOUNT_CHANGED, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      live.current = false;
      window.removeEventListener(ACCOUNT_CHANGED, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);
  return { ...state, refresh };
}
