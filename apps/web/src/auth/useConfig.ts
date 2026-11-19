import type { PublicConfig } from "@magomap/domain";
import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";

const KEY = "mm.config";

function cached(): PublicConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PublicConfig) : null;
  } catch {
    return null;
  }
}

/** The server's public config, cached for offline starts. */
export function useConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(cached);
  useEffect(() => {
    let live = true;
    apiFetch<PublicConfig>("/api/config")
      .then((c) => {
        if (!live) return;
        setConfig(c);
        try {
          localStorage.setItem(KEY, JSON.stringify(c));
        } catch {
          // storage full or blocked: the in-memory value still works
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return config;
}
