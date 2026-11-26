// Pushes her pending adds to Kakao Map (#83): where the extension answers, each of her own Kakao
// lists gets its pending places through the extension's addPlaces (which adds only to her own
// lists and skips places already there), then one Kakao Map sync brings them in, and the pull
// after it clears the pending adds. Nothing is logged.
import type { KakaoAddRow } from "@magomap/domain";
import { kakaoFolderIdOf } from "@magomap/domain/providers/kakao";
import { currentDb } from "../data/db";
import { kakaoListsFor, loadLibrary } from "../data/queries";
import { markKakaoAddsFailed } from "../data/writes";
import { detectExtension, runKakaoMapSync } from "../import/kakaoMap";
import {
  ask,
  checkKakaoAccount,
  KakaoCopyError,
  PAGE,
  sendPlacesOf,
  WRITE_WAIT_MS,
} from "./duplicateToKakao";

export type PushOutcome =
  /** Nothing pending that can be pushed. */
  | "nothing"
  /** Pending adds, but the extension isn't in this browser: they wait. */
  | "no_extension"
  /** Another push is running. */
  | "busy"
  /** Sent; lists Kakao Map couldn't find are marked failed. */
  | "pushed"
  /** Stopped (the account, Kakao Map, the extension): every add still pending, for next time. */
  | "stopped";

let running = false;

/** Pending adds to push, by list: only her own Kakao lists the place can still go into. */
async function pendingByList(): Promise<Map<string, KakaoAddRow[]>> {
  const lib = await loadLibrary(currentDb());
  const byList = new Map<string, KakaoAddRow[]>();
  for (const { add } of lib.pending) {
    if (add.failed != null) continue;
    // Checked again here: the list may have stopped being hers since she asked.
    if (!kakaoListsFor(lib, add.placeId).some((l) => l.id === add.listId)) continue;
    byList.set(add.listId, [...(byList.get(add.listId) ?? []), add]);
  }
  return byList;
}

/** Sends her pending adds to Kakao Map, when this browser has the extension. */
export async function pushKakaoAdds(): Promise<PushOutcome> {
  if (running) return "busy";
  running = true;
  try {
    const byList = await pendingByList();
    if (byList.size === 0) return "nothing";
    if ((await detectExtension()) !== "ready") return "no_extension";
    try {
      await checkKakaoAccount();
    } catch {
      return "stopped";
    }
    const db = currentDb();
    let sent = false;
    for (const listId of [...byList.keys()].sort()) {
      const adds = byList.get(listId) ?? [];
      const list = await db.lists.get(listId);
      const folderId = list?.externalId ? kakaoFolderIdOf(list.externalId) : undefined;
      if (folderId === undefined || folderId <= 0) continue;
      const { places } = await sendPlacesOf(
        db,
        adds.map((a) => ({ placeId: a.placeId })),
      );
      let missing = false;
      for (let start = 0; start < places.length && !missing; start += PAGE) {
        // Only what the extension takes: magomap's own place ids stay here.
        const page = places.slice(start, start + PAGE).map(({ placeId: _, ...send }) => send);
        let answer: Record<string, unknown>;
        try {
          answer = await ask({ type: "magomap.addPlaces", folderId, places: page }, WRITE_WAIT_MS);
        } catch (error) {
          if (error instanceof KakaoCopyError) return sent ? await syncAfter("stopped") : "stopped";
          throw error;
        }
        if (answer.ok === true) {
          sent = true;
          continue;
        }
        // The list is gone from her Kakao Map (or isn't hers there): say so, and go on.
        if (answer.error === "not_found") {
          await markKakaoAddsFailed(
            adds.map((a) => a.id),
            "list_missing",
          );
          missing = true;
          continue;
        }
        return sent ? await syncAfter("stopped") : "stopped";
      }
    }
    return sent ? await syncAfter("pushed") : "pushed";
  } finally {
    running = false;
  }
}

/** Brings what was added in, so its pending adds clear; a failed sync leaves them for later. */
async function syncAfter(outcome: PushOutcome): Promise<PushOutcome> {
  try {
    await runKakaoMapSync(() => undefined);
  } catch {
    // The next Kakao Map sync brings them in.
  }
  return outcome;
}
