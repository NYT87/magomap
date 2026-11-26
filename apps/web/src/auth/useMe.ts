import type { Me } from "@magomap/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT_CHANGED, apiFetch, NetworkError, UnauthorizedError } from "../api/client";
import { deviceKeys } from "../data/deviceKeys";

const KEY = "mm.me";

export function storedMe(): Me | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

/** Fired when the signed-in account's details changed (a new name), so useMe asks again. */
export const ME_CHANGED = "mm:me-changed";
export const notifyMeChanged = () => window.dispatchEvent(new Event(ME_CHANGED));

/** Where this device keeps an account's name, so it can be named after its session ends. */
export const accountNameKey = deviceKeys.name;

/** The name of the account whose data this device holds, if it has one. */
export function accountName(userId: string): string | null {
  try {
    return localStorage.getItem(accountNameKey(userId));
  } catch {
    return null;
  }
}

function rememberName(me: Me) {
  try {
    if (me.displayName) localStorage.setItem(accountNameKey(me.userId), me.displayName);
    else localStorage.removeItem(accountNameKey(me.userId));
  } catch {
    // storage blocked
  }
}

/** Forgets who is signed in (the per-account name stays, for "Sign in again as …"). */
export function forgetMe() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** Who is signed in. The last known account is used until the server answers, and offline. */
export function useMe(): {
  me: Me | null;
  loading: boolean;
  offline: boolean;
  refresh: () => void;
} {
  // The account this device last knew opens the app at once; the server's answer follows.
  const [state, setState] = useState<{ me: Me | null; loading: boolean; offline: boolean }>(() => {
    const known = storedMe();
    return { me: known, loading: known === null, offline: false };
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
        rememberName(me);
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
    window.addEventListener(ME_CHANGED, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      live.current = false;
      window.removeEventListener(ACCOUNT_CHANGED, refresh);
      window.removeEventListener(ME_CHANGED, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);
  return { ...state, refresh };
}
