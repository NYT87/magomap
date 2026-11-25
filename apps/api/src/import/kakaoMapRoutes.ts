// The upload run: magomap's page sends what the magomap extension read from Kakao Map in her
// browser (raw folders, then each folder's raw favourites), and the Worker maps it with the Kakao
// Map adapter and imports it through the import runs (routes.ts finishes and completes them).
// Only allowlisted users may upload, and only from the Kakao Map account bound to them. Never log
// a raw read.
import {
  importListChunk,
  RunNotFoundError,
  runSnapshot,
  startImportRun,
} from "@magomap/db/stores/importRuns";
import { recordKakaoColorEdit } from "@magomap/db/stores/kakaoColors";
import {
  bindKakaoMapAccount,
  boundKakaoMapAccount,
  fillKakaoMapAlias,
  KakaoMapAccountTakenError,
  kakaoMapAccountHolder,
  kakaoMapAccountsNamed,
} from "@magomap/db/stores/kakaoMapAccounts";
import { recordKakaoNoteEdit } from "@magomap/db/stores/kakaoNotes";
import { fillDisplayName } from "@magomap/db/stores/users";
import {
  type ApiErrorCode,
  type ImportListSummary,
  importItemsChunkSchema,
  isStorableText,
  type KakaoMapAccountHint,
  LIMITS,
} from "@magomap/domain";
import { KAKAO, kakaoFolderIdOf } from "@magomap/domain/providers/kakao";
import {
  KakaoAccountUnclearError,
  type KakaoMapAccount,
  KakaoSignedOutError,
  kakaoMapItemsToImport,
  kakaoMapListsToImport,
  kakaoMapStartSchema,
} from "@magomap/domain/providers/kakaoMap";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { requireUser } from "../auth/session";
import type { AppEnv } from "../env";
import { handled, kakaoLoginIdOf, PAGE } from "./routes";

export const kakaoMapRoutes = new Hono<AppEnv>();
kakaoMapRoutes.use("/import/kakao-map/*", requireUser);
kakaoMapRoutes.use("/kakao-colors", requireUser);
kakaoMapRoutes.use("/kakao-notes", requireUser);

/** The largest request body an upload route reads (1 MiB). */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

/** A refusal with its own status and body; everything else goes through `handled`. */
class Refusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: {
      error: ApiErrorCode;
      account?: KakaoMapAccountHint;
      bound?: KakaoMapAccountHint;
    },
  ) {
    super(body.error);
  }
}

const invalid = () => new Refusal(400, { error: "invalid" });

async function uploadHandled<T>(c: Context<AppEnv>, fn: () => Promise<T>) {
  try {
    return await handled(c, fn);
  } catch (error) {
    if (error instanceof Refusal) return c.json(error.body, error.status);
    throw error;
  }
}

/**
 * The JSON body, read up to MAX_UPLOAD_BYTES. A declared content-length over the limit is refused
 * before reading; the bytes are counted while reading too, so a missing or wrong content-length
 * can't let a larger body through.
 */
async function readJson(c: Context<AppEnv>): Promise<unknown> {
  const declared = c.req.header("content-length");
  if (declared !== undefined) {
    if (!/^\d+$/.test(declared.trim())) throw invalid();
    if (Number(declared) > MAX_UPLOAD_BYTES) throw new Refusal(413, { error: "too_large" });
  }
  const body = c.req.raw.body;
  if (!body) throw invalid();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Refusal(413, { error: "too_large" });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw invalid();
  }
}

/**
 * The caller's Kakao Login id, when they may upload: their id is in a non-empty
 * ALLOWED_KAKAO_USER_IDS, or ALLOW_DEV_UPLOAD is "true" (local dev and tests only). Unlike
 * sign-in, an empty allowlist opens nothing: open sign-up must not mean open writes to shared rows.
 */
async function uploader(c: Context<AppEnv>): Promise<string> {
  const loginId = await kakaoLoginIdOf(c);
  const allowlist = (c.env.ALLOWED_KAKAO_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    loginId === undefined ||
    !(c.env.ALLOW_DEV_UPLOAD === "true" || allowlist.includes(loginId))
  ) {
    throw new Refusal(403, { error: "not_allowed" });
  }
  return loginId;
}

/** What the start route reads beyond the adapter's schema: bounded free text, the confirmation. */
const startExtras = z.object({
  counts: z.array(z.object({ firstDisplay2: z.string().max(LIMITS.importText).optional() })),
  confirmAccount: z.string().min(1).max(200).optional(),
});

/** Every list is counted exactly once, and nothing else is. */
function checkCounts(counts: { folderid: number }[], lists: ImportListSummary[]): void {
  const known = new Set(lists.map((l) => kakaoFolderIdOf(l.externalId)));
  const seen = new Set<number>();
  for (const { folderid } of counts) {
    if (seen.has(folderid) || !known.has(folderid)) throw invalid();
    seen.add(folderid);
  }
  if (seen.size !== known.size) throw invalid();
}

/**
 * The binding decision, before anything is written:
 * - an account another user holds is refused outright;
 * - an account already bound to the caller goes ahead;
 * - otherwise the caller must have confirmed exactly this account (first sync: unconfirmed;
 *   a different bound account: mismatch), and it is bound now.
 * A 409 names the read's account (and, on a mismatch, the bound one) by nickname and the id's
 * last 4 characters, never the whole id.
 */
async function checkAccount(
  c: Context<AppEnv>,
  account: KakaoMapAccount,
  alias: string | undefined,
  confirmAccount: string | undefined,
  now: number,
): Promise<void> {
  const { db, userId } = c.var;
  const holder = await kakaoMapAccountHolder(db, account.kakaoMapUserId);
  if (holder === userId) {
    // A later read can show the alias an earlier one didn't; it's kept once, never replaced.
    if (alias !== undefined && (await boundKakaoMapAccount(db, userId))?.alias === undefined) {
      await fillKakaoMapAlias(db, userId, alias);
    }
    return;
  }
  if (holder !== null) throw new Refusal(409, { error: "kakao_account_taken" });
  if (confirmAccount !== account.kakaoMapUserId) {
    const bound = await boundKakaoMapAccount(db, userId);
    throw new Refusal(409, {
      error: bound ? "kakao_account_mismatch" : "kakao_account_unconfirmed",
      account: {
        ...(account.nickname ? { nickname: account.nickname } : {}),
        idTail: account.kakaoMapUserId.slice(-4),
      },
      // A mismatch also names the account she synced from before, the same way.
      ...(bound
        ? {
            bound: {
              ...(bound.nickname ? { nickname: bound.nickname } : {}),
              idTail: bound.kakaoMapUserId.slice(-4),
            },
          }
        : {}),
    });
  }
  try {
    await bindKakaoMapAccount(
      db,
      userId,
      alias === undefined ? account : { ...account, alias },
      now,
    );
  } catch (error) {
    // Another user bound it between the check and the write.
    if (error instanceof KakaoMapAccountTakenError) {
      throw new Refusal(409, { error: "kakao_account_taken" });
    }
    throw error;
  }
}

/**
 * Each list's Kakao owner, as the account it names: an owner id that a bound account goes by
 * (its id or alias) becomes that account's id. A followed folder's bare map_user_id is kept only
 * then; one no account goes by is dropped (never recorded bare: it might not match its owner's
 * binding later), and a later, better read fills it in.
 */
async function ownerIdsOf(
  c: Context<AppEnv>,
  read: ReturnType<typeof kakaoMapListsToImport>,
): Promise<Map<string, string>> {
  const named = await kakaoMapAccountsNamed(c.var.db, [
    ...read.providerOwnerIds.values(),
    ...read.mapOwnerIds.values(),
  ]);
  const owners = new Map<string, string>();
  for (const [externalId, ownerId] of read.providerOwnerIds) {
    owners.set(externalId, named.get(ownerId) ?? ownerId);
  }
  for (const [externalId, mapId] of read.mapOwnerIds) {
    const account = named.get(mapId);
    if (account !== undefined) owners.set(externalId, account);
  }
  return owners;
}

/**
 * Whether the Kakao Map account signed in on the page is the one bound to the caller, before a
 * copy writes to Kakao Map. The same decision as the sync's start, without confirming or binding
 * anything and without writing a run: bound goes ahead; otherwise the usual 409 with the accounts
 * named by their last 4 characters.
 */
kakaoMapRoutes.post("/import/kakao-map/account", (c) =>
  uploadHandled(c, async () => {
    const loginId = await uploader(c);
    const raw = await readJson(c);
    const body = z.object({ folders: z.array(z.unknown()).max(2000) }).safeParse(raw);
    if (!body.success) throw invalid();
    let read: ReturnType<typeof kakaoMapListsToImport>;
    try {
      read = kakaoMapListsToImport({ folders: body.data.folders, counts: [] }, loginId);
    } catch (error) {
      if (error instanceof KakaoSignedOutError) {
        throw new Refusal(422, { error: "kakao_signed_out" });
      }
      if (error instanceof KakaoAccountUnclearError) {
        throw new Refusal(422, { error: "kakao_account_unclear" });
      }
      throw error;
    }
    const accountId = read.account.kakaoMapUserId;
    if (accountId.length > 200 || !isStorableText(accountId)) {
      throw new Refusal(422, { error: "kakao_account_unclear" });
    }
    // No confirmation is ever passed, so nothing is bound here.
    await checkAccount(c, read.account, read.accountAlias, undefined, Date.now());
    return { ok: true };
  }),
);

/**
 * Records a Kakao colour the owner has just changed in Kakao Map (the extension did that first;
 * magomap only follows). Only the list's Kakao owner may, and only allowlisted users write.
 */
const colorBody = z.object({
  listId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  color: z.string().regex(/^\d{2}$/),
});
kakaoMapRoutes.post("/kakao-colors", (c) =>
  uploadHandled(c, async () => {
    await uploader(c);
    const body = colorBody.safeParse(await readJson(c));
    if (!body.success) throw invalid();
    const result = await recordKakaoColorEdit(c.var.db, c.var.userId, body.data, Date.now());
    switch (result) {
      case "updated":
        return { updated: true };
      case "invalid":
        throw invalid();
      case "not_found":
        throw new Refusal(404, { error: "not_found" });
      case "not_owner":
        throw new Refusal(403, { error: "not_owner" });
      case "owner_unknown":
        throw new Refusal(409, { error: "owner_unknown" });
      case "kakao_account_unconfirmed":
        throw new Refusal(409, { error: "kakao_account_unconfirmed" });
    }
  }),
);

/**
 * Records a Kakao note the owner has just saved in Kakao Map (the extension did that first;
 * magomap only follows). Only the list's Kakao owner may. An empty note clears it.
 */
const noteBody = z.object({
  listId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  note: z.string().max(LIMITS.importText),
});
kakaoMapRoutes.post("/kakao-notes", (c) =>
  uploadHandled(c, async () => {
    await uploader(c);
    const body = noteBody.safeParse(await readJson(c));
    if (!body.success) throw invalid();
    const result = await recordKakaoNoteEdit(c.var.db, c.var.userId, body.data, Date.now());
    switch (result) {
      case "updated":
        return { updated: true };
      case "invalid":
        throw invalid();
      case "not_found":
        throw new Refusal(404, { error: "not_found" });
      case "not_owner":
        throw new Refusal(403, { error: "not_owner" });
      case "owner_unknown":
        throw new Refusal(409, { error: "owner_unknown" });
      case "kakao_account_unconfirmed":
        throw new Refusal(409, { error: "kakao_account_unconfirmed" });
    }
  }),
);

kakaoMapRoutes.post("/import/kakao-map/runs", (c) =>
  uploadHandled(c, async () => {
    const loginId = await uploader(c);
    const raw = await readJson(c);
    const start = kakaoMapStartSchema.safeParse(raw);
    const extras = startExtras.safeParse(raw);
    if (!start.success || !extras.success) throw invalid();

    let read: ReturnType<typeof kakaoMapListsToImport>;
    try {
      read = kakaoMapListsToImport(start.data, loginId);
    } catch (error) {
      if (error instanceof KakaoSignedOutError) {
        throw new Refusal(422, { error: "kakao_signed_out" });
      }
      if (error instanceof KakaoAccountUnclearError) {
        throw new Refusal(422, { error: "kakao_account_unclear" });
      }
      throw error;
    }
    // Folders, but none magomap can list: treated like no folders, so a complete run with no
    // lists can't remove all of hers.
    if (read.lists.length === 0) throw new Refusal(422, { error: "kakao_signed_out" });
    // An account id magomap can't store whole (over 200 characters, like confirmAccount, or
    // unstorable text) names no account it can bind. The nickname is already cut to its limit.
    const accountId = read.account.kakaoMapUserId;
    if (accountId.length > 200 || !isStorableText(accountId)) {
      throw new Refusal(422, { error: "kakao_account_unclear" });
    }
    checkCounts(start.data.counts, read.lists);

    const now = Date.now();
    await checkAccount(c, read.account, read.accountAlias, extras.data.confirmAccount, now);
    // Her Kakao Map nickname names a new account; a name she typed is never replaced.
    if (read.account.nickname) await fillDisplayName(c.var.db, c.var.userId, read.account.nickname);
    const providerOwnerIds = await ownerIdsOf(c, read);
    const { runId } = await startImportRun(
      c.var.db,
      c.var.userId,
      {
        provider: KAKAO,
        source: "kakao_map",
        complete: true,
        subscriptionKnown: read.lists.length > 0,
        // The Worker's clock, never the client's: every direct sync is a new snapshot.
        importedAt: new Date(now).toISOString(),
        // Each list's Kakao owner decides who owns it in magomap (spec: "Who owns a list").
        // A bare followed folder only grants access (its fallback name and missing contents
        // never overwrite the shared list; docs/kakao-map-access.md section 6).
        lists: read.lists.map((l) => {
          const providerOwnerId = providerOwnerIds.get(l.externalId);
          return {
            ...l,
            ...(providerOwnerId === undefined ? {} : { providerOwnerId }),
            ...(read.bareFolders.has(l.externalId) ? { accessOnly: true } : {}),
          };
        }),
      },
      now,
    );
    return {
      runId,
      lists: read.lists.map((l) => ({
        externalId: l.externalId,
        name: l.name,
        itemCount: l.itemCount,
      })),
    };
  }),
);

const pageBody = z.object({ favorites: z.array(z.unknown()).max(PAGE) });

kakaoMapRoutes.post("/import/kakao-map/runs/:runId/lists/:externalId/pages/:index", (c) =>
  uploadHandled(c, async () => {
    await uploader(c);
    const body = pageBody.safeParse(await readJson(c));
    if (!body.success) throw invalid();
    const favorites = body.data.favorites;

    const runId = c.req.param("runId");
    const externalId = c.req.param("externalId");
    const index = Number(c.req.param("index"));
    const run = await runSnapshot(c.var.db, c.var.userId, runId);
    // An upload page never feeds a run left by the old kakao-list import.
    if (run.source !== "kakao_map") throw new RunNotFoundError();
    const meta = run.lists.find((l) => l.externalId === externalId);
    const pages = Math.max(1, Math.ceil((meta?.itemCount ?? 0) / PAGE));
    if (!meta || !Number.isSafeInteger(index) || index < 0 || index >= pages) {
      throw new RunNotFoundError();
    }
    const folderId = kakaoFolderIdOf(externalId);
    if (folderId === undefined) throw new RunNotFoundError();

    // Exactly the page the run's count promised, so a finished list really had every item.
    const offset = index * PAGE;
    if (favorites.length !== Math.min(PAGE, meta.itemCount - offset)) throw invalid();
    const items = importItemsChunkSchema.safeParse(
      kakaoMapItemsToImport(folderId, offset, favorites),
    );
    if (!items.success) throw invalid();
    // Two favourites with one id (seq) are a broken read.
    if (new Set(items.data.map((i) => i.externalId)).size !== items.data.length) throw invalid();

    const summary = await importListChunk(
      c.var.db,
      c.var.userId,
      runId,
      externalId,
      index,
      items.data,
      Date.now(),
    );
    return { ...summary, done: index + 1 >= pages };
  }),
);
