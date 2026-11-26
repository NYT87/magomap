// Pushes her pending adds to Kakao Map (#83): where the extension answers, each of her own Kakao
// lists gets its pending places through the extension's addPlaces (which adds only to her own
// lists and skips places already there), then one Kakao Map sync brings them in, and the pull
// after it clears the pending adds. Nothing is logged.
//
// A push works for one account's database from start to end: if the open account changes while
// it runs, it stops before its next step and writes nothing more.
import type { KakaoAddRow } from "@magomap/domain";
import { kakaoFolderIdOf } from "@magomap/domain/providers/kakao";
import { dbUserId, type MagomapDexie, openDbOrNull } from "../data/db";
import { kakaoListsFor, loadLibrary } from "../data/queries";
import { markKakaoAddsFailed } from "../data/writes";
import { detectExtension, runKakaoMapSync } from "../import/kakaoMap";
import {
  ask,
  checkKakaoAccount,
  claimKakaoWrites,
  KakaoCopyError,
  PAGE,
  releaseKakaoWrites,
  sendPlacesOf,
  WRITE_WAIT_MS,
} from "./duplicateToKakao";

export type PushOutcome =
  /** Nothing pending that can be pushed. */
  | "nothing"
  /** Pending adds, but the extension isn't in this browser: they wait. */
  | "no_extension"
  /** Another write to Kakao Map (a push, or a copy) is running. */
  | "busy"
  /** Sent; lists Kakao Map couldn't find and places that can't be sent are marked failed. */
  | "pushed"
  /** Stopped (the account, Kakao Map, the extension): what wasn't sent stays pending. */
  | "stopped";

/** Pending adds to push, by list: only her own Kakao lists the place can still go into. */
async function pendingByList(db: MagomapDexie): Promise<Map<string, KakaoAddRow[]>> {
  const lib = await loadLibrary(db);
  const byList = new Map<string, KakaoAddRow[]>();
  for (const { add } of lib.pending) {
    if (add.failed != null) continue;
    // Checked again here: the list may have stopped being hers since she asked.
    if (!kakaoListsFor(lib, add.placeId).some((l) => l.id === add.listId)) continue;
    byList.set(add.listId, [...(byList.get(add.listId) ?? []), add]);
  }
  return byList;
}

/** Stops a push whose account is no longer the open one. */
class AccountChanged extends Error {}

/** Sends the pending adds of `db` (the open account's database) to Kakao Map. */
export async function pushKakaoAdds(db: MagomapDexie): Promise<PushOutcome> {
  if (!claimKakaoWrites()) return "busy";
  const stillOpen = () => {
    if (openDbOrNull() !== db) throw new AccountChanged();
  };
  const account = dbUserId(db);
  let sent = false;
  try {
    stillOpen();
    const byList = await pendingByList(db);
    if (byList.size === 0) return "nothing";
    if ((await detectExtension()) !== "ready") return "no_extension";
    stillOpen();
    try {
      await checkKakaoAccount(account);
    } catch {
      return "stopped";
    }
    let marked = false;
    for (const listId of [...byList.keys()].sort()) {
      const adds = byList.get(listId) ?? [];
      stillOpen();
      const list = await db.lists.get(listId);
      const folderId = list?.externalId ? kakaoFolderIdOf(list.externalId) : undefined;
      if (folderId === undefined || folderId <= 0) continue;
      const { places, leftOut } = await sendPlacesOf(
        db,
        adds.map((a) => ({ placeId: a.placeId })),
      );
      const addOf = new Map(adds.map((a) => [a.placeId, a.id]));
      // A place with no location or no name can't be added in Kakao Map: say so, once.
      if (leftOut.length > 0) {
        stillOpen();
        await markKakaoAddsFailed(
          leftOut.flatMap((p) => addOf.get(p) ?? []),
          "cant_send",
          db,
        );
        marked = true;
      }
      for (let start = 0; start < places.length; start += PAGE) {
        const chunk = places.slice(start, start + PAGE);
        // Only what the extension takes: magomap's own place ids stay here.
        const page = chunk.map(({ placeId: _, ...send }) => send);
        stillOpen();
        let answer: Record<string, unknown>;
        try {
          answer = await ask({ type: "magomap.addPlaces", folderId, places: page }, WRITE_WAIT_MS);
        } catch (error) {
          if (error instanceof KakaoCopyError) return "stopped";
          throw error;
        }
        if (answer.ok === true) {
          sent = true;
          continue;
        }
        if (answer.error !== "not_found") return "stopped";
        // Kakao Map can't find the list for the signed-in account. Only if that account is still
        // hers is the list gone: then the places not sent yet are marked, and the others go on.
        stillOpen();
        try {
          await checkKakaoAccount(account);
        } catch {
          return "stopped";
        }
        stillOpen();
        await markKakaoAddsFailed(
          places.slice(start).flatMap((p) => addOf.get(p.placeId) ?? []),
          "list_missing",
          db,
        );
        marked = true;
        break;
      }
    }
    return sent || marked ? "pushed" : "nothing";
  } catch (error) {
    if (error instanceof AccountChanged) return "stopped";
    throw error;
  } finally {
    // What was added is brought in, so its pending adds clear (unless the account changed).
    if (sent && openDbOrNull() === db) {
      try {
        await runKakaoMapSync(() => undefined, { account });
      } catch {
        // The next Kakao Map sync brings them in.
      }
    }
    releaseKakaoWrites();
  }
}
