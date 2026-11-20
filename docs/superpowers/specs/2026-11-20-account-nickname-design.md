# Account nickname — design

Agreed with the owner on 2026-11-20. Touches magomap and kakao-list.

## Why

On 2026-11-20 the owner and his wife each signed in with their own Kakao account. Both accounts had no name (`users.display_name` empty), so neither the Account screen nor the "Sign in again" prompt could say whose data a device held, and the second account was first taken for a login bug. magomap does **not** ask Kakao Login for the nickname (the owner doesn't want that consent screen). The name comes from what the person types, or from their Kakao lists via kakao-list.

## Goals

1. **Nickname rule (owner's):** a nickname is filled only while it's empty.
   - Empty when an account is created.
   - An import fills it from kakao-list when it's empty and kakao-list has one.
   - Once set, by an import or by hand, no import changes it.
   - Editable on the Account page. Clearing it makes it empty again, so the next import may fill it.
2. The Account page shows the nickname, or the existing "unnamed" text when it's empty.
3. The "Sign in again" prompt names the account the device's data belongs to, when that account has a nickname ("Sign in again as 지은").
4. Deploying the Postgres setup can't replace production: its Worker is renamed `magomap-postgres`.

## Non-goals

- Asking Kakao Login for `profile_nickname`.
- Showing nicknames to other people (shared lists, owners). The nickname is shown only to its own account.
- Changing what list owners (`ownerName`) mean: still only for lists someone else made.

## Anti-goals

- An import overwriting a nickname the person typed.
- One person's nickname landing on another account (the laptop's kakao-list data is read by the signed-in account's own Kakao id, as today).

## Approaches

- **A. kakao-list adds the account's own nickname to its lists response (chosen).** A new optional top-level `ownerNickname` on `GET /api/integrations/magomap/lists`, taken from the account's own lists. magomap reads it when an import starts. List owners keep their meaning.
- B. kakao-list sends `ownerName` on every list and magomap picks it from its own lists. Same size of change, but own lists would start showing "by 지은" unless filtered everywhere.
- C. No kakao-list change; nickname only by hand. Doesn't meet the owner's ask to fill it from Kakao.

## Design

**Where Kakao keeps it:** Kakao Map's folder list carries `nickname` only on **subscribed or public** folders (`kakao-list/docs/kakao-maps-private-api.md`). kakao-list already stores it as each list's `creatorName`. So an account with only private lists has no nickname to send; its name stays empty until typed.

**kakao-list**
- `toMagomapLists` (`apps/server/src/magomapIntegration.ts`) adds `ownerNickname`: the first non-empty, trimmed `creatorName` among the account's **own** lists (`subscribed !== true`), in snapshot order; absent when none. Contract version stays 1 (an optional field).
- Its tests cover: own public list with a nickname → sent; only subscribed lists with names → absent; no names → absent.

**magomap server**
- `kakaoListsToImport`'s schema (`packages/domain/src/providers/kakao.ts`) accepts `ownerNickname: text(LIMITS.importTitle).optional()` and returns it on the snapshot.
- `POST /api/import/runs`: after the snapshot is read, when `ownerNickname` is present, set `users.display_name = ownerNickname` **only where `display_name IS NULL`** (one conditional update, so a name typed meanwhile is never overwritten). This happens whether or not the rest of the import later finishes.
- Kakao sign-in stops passing a nickname to `findOrCreateUserByIdentity` (Kakao never sends one now anyway), so a new account starts with `display_name` null. The dev login keeps its optional nickname for tests.
- New `PATCH /api/me` (behind `requireUser`), body `{ displayName: string }`: trimmed; empty → stored as null; otherwise 1–40 characters through `storableText`. Answers the updated `Me`.

**magomap app**
- Account page: the name heading gets an **Edit** button that opens an inline field with Save and Cancel; Save calls `PATCH /api/me`. Offline: the button is disabled with the existing offline note pattern. Errors show inline.
- After an import, the app re-reads `/api/me`, so a newly filled nickname shows without a reload.
- Each device remembers the nickname of the account whose data it holds (saved alongside that account's local database whenever `/api/me` is read). The "Sign in again" prompt uses it: "Sign in again as {{name}} to keep syncing"; without a nickname, today's text.
- Strings in Korean and English.

**Deploy**
- `apps/api/wrangler.toml`: `[env.postgres] name = "magomap-postgres"`. `docs/deploy.md` mentions that the Postgres setup deploys to its own Worker.

## Builder's calls

- Nickname length 40, matching a reasonable display; longer kakao-list nicknames are cut to 40 when filled.
- The fill happens at the import's start, not at its completion, because the nickname isn't list data and a stopped import shouldn't delay it.
- Order of work: kakao-list first (deployed), then magomap. magomap tolerates the field being absent, so either order is safe.
