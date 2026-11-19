import type { Me } from "@magomap/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, NetworkError, UnauthorizedError } from "../api/client";

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
  const refresh = useCallback(() => {
    apiFetch<Me>("/api/me")
      .then((me) => {
        try {
          localStorage.setItem(KEY, JSON.stringify(me));
        } catch {
          // storage blocked
        }
        if (live.current) setState({ me, loading: false, offline: false });
      })
      .catch((error) => {
        if (!live.current) return;
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
    return () => {
      live.current = false;
    };
  }, [refresh]);
  return { ...state, refresh };
}
