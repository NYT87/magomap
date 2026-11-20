# Account nickname — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each magomap task follows `docs/superpowers/build-process.md` (builder → gate → reviewers). Task 1 is in the kakao-list repo and follows that repo's own checks.

**Goal:** Every magomap account has a nickname that starts empty, is filled from the account's own Kakao lists (via kakao-list) only while empty, can be edited on the Account page, and names the account in the "Sign in again" prompt. The Postgres setup deploys to its own Worker. On a shared device, another person can sign in with their own Kakao account, and signing out can remove your data from the device.

**Architecture:**
- kakao-list's `GET /api/integrations/magomap/lists` gains an optional `ownerNickname`, from the account's own lists' `creatorName`.
- magomap reads it when an import starts and fills `users.display_name` with one conditional update (`WHERE display_name IS NULL`). No migration: the column exists and is nullable.
- `PATCH /api/me` edits the nickname. The app keeps a per-account copy of the name on the device so the sign-in prompt can use it after the session ends.

**Tech Stack:** kakao-list: Express, `node:test`. magomap: Hono on Cloudflare Workers, Kysely (D1 + Postgres), zod, React 19, i18next (ko/en), Vitest + Testing Library, msw.

**Spec:** `docs/superpowers/specs/2026-11-20-account-nickname-design.md`

## Global Constraints

- **Nickname rule:** filled by an import only while `display_name IS NULL`; once set (import or by hand), no import changes it; saving an empty or whitespace-only name stores `null`.
- **Length:** at most 40 characters. A longer kakao-list nickname is cut to 40 when filled; a typed one over 40 is refused (`400 invalid`).
- **No Kakao consent:** magomap never asks Kakao Login for `profile_nickname`; Kakao sign-in creates accounts with `display_name` null.
- **Nickname only for its own account:** never shown to other people, never taken from a list someone else made.
- **Strings:** every new string in both `apps/web/src/i18n/ko.json` and `en.json`.
- **Gate (magomap):** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh` must PASS. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Protected paths (magomap):** `scripts/`, `biome.json`, `tsconfig.base.json`, `docs/superpowers/**` except this plan.
- **kakao-list:** contract version stays 1; only package versions at least 14 days old (its `AGENTS.md`).
- **Commits:** magomap on branch `feat/account-nickname`; kakao-list on a new branch `feat/magomap-owner-nickname`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A bad nickname from kakao-list must never fail the import:** too long, empty, or with characters `storableText` refuses → treated as absent (or cut to 40), and the import goes on. (Task 2.)
2. **A name typed on the Account page survives every later import**, including one whose kakao-list nickname differs. (Task 2.)
3. **Clearing the name** (empty or spaces) stores `null`, so the next import may fill it again. (Task 2.)
4. **After a 401 the app forgets `mm.me`**; the "Sign in again as …" prompt must still find the name, so it's stored per account under its own key, not inside `mm.me`. (Task 3.)
5. **A followed list's creator never becomes your nickname**, even when your own lists have no names. (Task 1.)
6. **"Remove my data" with unsynced changes:** the data must stay, even after "Sign out anyway". Deleting unsynced notes is the worst failure here. (Task 6.)
7. **`?account=other` with any other value or extra parameters** must not change the Kakao URL beyond adding the forced-login parameter; the OAuth `state` check is untouched. (Task 5.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 kakao-list `ownerNickname` | code |
| 2 Server: fill on import, edit, sign-up | code, security |
| 3 App: edit, refresh, sign-in prompt | code, ui, ux, a11y |
| 4 Postgres Worker name | code, security |
| 5 Sign in with a different Kakao account | code, security, ux |
| 6 Remove my data on sign-out | code, ux, a11y |

---

### Task 1 (kakao-list repo): send the account's own nickname

**Files:**
- Modify: `kakao-list/apps/server/src/magomapIntegration.ts` (`MagomapLists`, `toMagomapLists`)
- Test: `kakao-list/apps/server/src/magomapIntegration.test.ts`

**Interfaces:**
- Produces: `MagomapLists.ownerNickname?: string` — the first non-empty, trimmed `creatorName` among `stored.snapshot.lists` with `subscribed !== true`, in snapshot order; the key is absent (not `undefined`-valued in JSON) when there is none.

- [ ] **Step 1: Write the failing tests** (the file's `stored(...)` helper, `node:test` + `assert`)
  - `sends the nickname from the account's own lists`: lists `[{ subscribed: false, creatorName: "  지은 " }, …]` → `ownerNickname === "지은"`.
  - `skips own lists without a name and uses the next one`: first own list `creatorName: ""`, second `"지은"` → `"지은"`.
  - `never takes the nickname of a followed list's creator`: only `{ subscribed: true, creatorName: "Other" }` plus an own list without a name → `ownerNickname` absent (`!("ownerNickname" in body)`).
  - `leaves it out when no list has a name` → absent.
- [ ] **Step 2: Run** `pnpm --filter <server package> test` (the `test` script in `apps/server/package.json`) — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `toMagomapLists`.
- [ ] **Step 4: Run** the same command plus the repo's lint/typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): send magomap the account's own Kakao nickname`, push, and open a PR in kakao-list.
- [ ] **Step 6 (owner):** merge and deploy kakao-list. magomap tolerates the field's absence, so Tasks 2–4 don't wait for this.

### Task 2 (magomap): fill on import, edit, empty at sign-up

**Files:**
- Modify: `packages/domain/src/providers/kakao.ts` (lists summary schema near line 123 and `kakaoListsToImport`), `packages/domain/src/importContract.ts` (`ImportListsSnapshot`)
- Modify: `packages/db/src/stores/users.ts`
- Modify: `apps/api/src/import/routes.ts` (`POST /import/runs`), `apps/api/src/auth/routes.ts` (Kakao callback; new `PATCH /me`)
- Test: `packages/domain/src/providers/kakao.test.ts` (create if missing), `packages/db/src/stores/users.test.ts`, `apps/api/test/import.test.ts`, `apps/api/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `ImportListsSnapshot.ownerNickname?: string` — from the wire field, trimmed and cut to 40; dropped (never a parse error) when not a string, empty after trimming, or refused by `isStorableText`.
  - In `users.ts`: `fillDisplayName(db: Db, userId: string, name: string): Promise<void>` (one `UPDATE users SET display_name = ? WHERE id = ? AND display_name IS NULL`) and `setDisplayName(db: Db, userId: string, name: string | null): Promise<void>`.
  - `PATCH /api/me` (`requireUser`), body `{ displayName: string }` → `200 Me`; trimmed; empty → `null`; over 40 or not storable → `400 { error: "invalid" }`.
  - The Kakao callback calls `signIn(c, kakaoUserId, null)`; `kakaoUserFromCode` keeps returning `nickname` but it is no longer used. The dev login is unchanged.

- [ ] **Step 1: Write the failing tests**
  - domain `kakaoListsToImport`: `ownerNickname: " 지은 "` → `"지은"`; 60 characters → first 40; `""`, `123` and a string with a control character → absent, and the snapshot still parses with all its lists.
  - db (`forEachDialect`): `fillDisplayName fills an empty name only` — null → filled; already "Jose" → stays "Jose". `setDisplayName(null)` → null.
  - api import: `an import fills an empty nickname from kakao-list` — serve the fixture with `ownerNickname: "지은"`, start → `/api/me` `displayName: "지은"`; `a typed nickname survives imports` — `PATCH /api/me {displayName:"Jose"}`, then start with `ownerNickname: "지은"` → still "Jose"; `a cleared nickname is filled again` — PATCH `"  "` → `displayName: null`, then start → "지은".
  - api auth: `PATCH /api/me` saves a trimmed name and answers `Me`; 41 characters → 400 `invalid`; no session → 401. `Kakao sign-in leaves the nickname empty` — mock Kakao's `/v2/user/me` with `kakao_account.profile.nickname: "K"` → new account's `displayName` is null.
- [ ] **Step 2: Run** `pnpm --filter @magomap/domain test`, `pnpm --filter @magomap/db test -- users`, `pnpm --filter @magomap/api test -- import auth` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** as specified. In `POST /import/runs`, call `fillDisplayName` right after the snapshot is parsed and before `startImportRun`, so it happens even if the import later stops.
- [ ] **Step 4: Run** the same commands with `TEST_DATABASE_URL` set — Expected: PASS, every existing test included.
- [ ] **Step 5: Commit** `feat(api): an account nickname, filled from kakao-list while empty and editable`

### Task 3 (magomap): edit the nickname, refresh it, name the account when signing in again

**Files:**
- Modify: `apps/web/src/auth/useMe.ts`, `apps/web/src/screens/Account.tsx`, `apps/web/src/import/ImportSection.tsx`, `apps/web/src/components/SyncIndicator.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/ko.json`
- Test: `apps/web/src/screens/Account.test.tsx`, Create: `apps/web/src/components/SyncIndicator.test.tsx` (or extend it if it exists by then), `apps/web/src/auth/useMe.test.ts`

**Interfaces:**
- Consumes: `PATCH /api/me` → `Me` (Task 2).
- Produces, in `useMe.ts`:
  - `ME_CHANGED = "mm:me-changed"`; `useMe` refreshes on it. `notifyMeChanged(): void` dispatches it.
  - `accountName(userId: string): string | null` and the write that `useMe` does on every successful `/api/me`: `localStorage["mm.name." + userId]` = the nickname, removed when null. `forgetMe()` does **not** remove it.
- Behaviour:
  - Account card: the name (or `account.unnamed`) plus an **Edit name** button → inline text field (label "Nickname", max 40) with **Save** and **Cancel**; Save → `PATCH /api/me` → `notifyMeChanged()`; offline → Edit disabled; failure → inline `account.failed`.
  - `ImportSection` calls `notifyMeChanged()` after an import ends (done or failed), so a filled nickname shows at once.
  - `SyncIndicator`, in `needs_signin`: with `accountName(dbUserId(currentDb()))` → `sync.needsSigninAs` / `sync.needsSigninAs_*` (with `{{name}}`); without → today's text.

New English strings (Korean equivalents in the same tone as nearby keys):
```json
"account.editName": "Edit name",
"account.nameLabel": "Nickname",
"account.save": "Save",
"sync.needsSigninAsNone": "Sign in again as {{name}} to keep syncing",
"sync.needsSigninAs_one": "Sign in again as {{name}} to save {{count}} change",
"sync.needsSigninAs_other": "Sign in again as {{name}} to save {{count}} changes"
```
(`account.cancel` already exists.)

- [ ] **Step 1: Write the failing tests**
  - Account: `edits the nickname` — click Edit name, type "지은", Save → `apiFetch` called with `/api/me`, `method: "PATCH"`, body `{"displayName":"지은"}`; the field closes. `Cancel keeps the name`. `Edit is off offline`.
  - useMe: `remembers each account's name, even after the session ends` — `/api/me` answers `{ userId: "u1", displayName: "지은" }` → `accountName("u1") === "지은"`; then a 401 → `storedMe()` null but `accountName("u1")` still "지은"; a later answer with `displayName: null` → `accountName("u1")` null. `refreshes on ME_CHANGED`.
  - SyncIndicator: `names the account when signing in again` — state `needs_signin`, `unsynced: 0`, stored name "지은" for the open db → "Sign in again as 지은 to keep syncing"; with no stored name → "Sign in again to keep syncing".
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- Account useMe SyncIndicator` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified; the Edit and Save buttons keep the 44 px target and existing `mm-button` classes.
- [ ] **Step 4: Run** the same command, then `./scripts/gate.sh main` — Expected: PASS and `GATE: PASS`. Save phone and desktop screenshots, both themes, of the Account card (reading and editing) and the sign-in prompt.
- [ ] **Step 5: Commit** `feat(web): edit your nickname, and see whose data needs signing in again`

### Task 4 (magomap): the Postgres setup deploys to its own Worker

**Files:**
- Modify: `apps/api/wrangler.toml` (`[env.postgres] name`), `docs/deploy.md`

**Interfaces:** none.

- [ ] **Step 1: Check** — `cd apps/api && npx wrangler deploy --env postgres --dry-run --outdir /tmp/x 2>&1 | grep -i "magomap"` shows the Worker name `magomap` (the risk).
- [ ] **Step 2: Change** `[env.postgres] name = "magomap"` to `name = "magomap-postgres"`. In `docs/deploy.md`, next to `pnpm deploy:postgres`, say: the Postgres setup deploys to the separate Worker `magomap-postgres`; before its first real deploy, set its own secrets (`--env postgres`), its `KAKAO_REDIRECT_URI` on its own `workers.dev` host, register that URI in the Kakao console, and fill `ALLOWED_KAKAO_USER_IDS` (empty means open sign-up).
- [ ] **Step 3: Verify** — the dry run for `--env postgres` names `magomap-postgres`; the dry run for `--env d1` still names `magomap`; `./scripts/gate.sh main` → `GATE: PASS`.
- [ ] **Step 4: Commit** `chore(api): deploy the Postgres setup to its own Worker`

### Task 5 (magomap): sign in with a different Kakao account

**Files:**
- Modify: `apps/api/src/auth/kakao.ts` (`authorizeUrl`), `apps/api/src/auth/routes.ts` (`/auth/kakao/start`)
- Modify: `apps/web/src/screens/SignIn.tsx`, `apps/web/src/i18n/en.json`, `ko.json`
- Test: `apps/api/test/auth.test.ts`, `apps/web/src/screens/SignIn.test.tsx` (create if missing)

**Interfaces:**
- Produces: `authorizeUrl(env: Env, state: string, opts?: { forceLogin?: boolean }): string` — with `forceLogin`, adds Kakao's forced-login parameter. Before coding, read Kakao Login's REST API docs (`https://developers.kakao.com/docs/latest/en/kakaologin/rest-api`, "Request additional consent / prompt") and confirm the parameter and value (expected `prompt=login`); put the URL in the commit body.
- `GET /api/auth/kakao/start?account=other` → `forceLogin: true`; any other value or none → today's URL.
- Sign-in screen: under the Kakao button, a secondary link to `/api/auth/kakao/start?account=other` with text `signin.otherAccount`: "Sign in with a different Kakao account".

- [ ] **Step 1: Write the failing tests**
  - api: `start asks Kakao for a fresh login only when asked` — `/api/auth/kakao/start?account=other` → 302 whose `Location` has `prompt=login` and the same `client_id`, `redirect_uri`, `state` params as a plain start; `/api/auth/kakao/start` and `?account=me` → no `prompt`.
  - web: `offers signing in with a different Kakao account` — the link exists with that text and `href="/api/auth/kakao/start?account=other"`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/api test -- auth` and `pnpm --filter @magomap/web test -- SignIn` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified (link styled as the screen's existing secondary actions, 44 px target).
- [ ] **Step 4: Run** the same commands — Expected: PASS. Then `./scripts/gate.sh main` → `GATE: PASS`.
- [ ] **Step 5: Commit** `feat(auth): sign in with a different Kakao account on a shared device`

### Task 6 (magomap): remove my data from this device on sign-out

**Files:**
- Modify: `apps/web/src/screens/Account.tsx` (sign-out area and `signOut`), `apps/web/src/i18n/en.json`, `ko.json`
- Possibly modify: `apps/web/src/map/mapPrefs.tsx` and `apps/web/src/auth/useMe.ts` to export the per-account key names, so removal uses them instead of repeating string literals.
- Test: `apps/web/src/screens/Account.test.tsx`

**Interfaces:**
- Consumes: `closeUserDb`, `dbName` (`data/db.ts`); `accountName` key from Task 3.
- Produces: `forgetAccountOnDevice(userId: string): Promise<void>` in `apps/web/src/data/db.ts` — `closeUserDb(userId)`, `Dexie.delete(dbName(userId))`, and removes `mm.visibleLists.<id>`, `mm.showPrevious.<id>`, `mm.name.<id>`. Leaves `mm.lang`, `mm.config`, `mm.persisted`.
- Behaviour (spec "Removing your data on sign-out"):
  - A checkbox above the sign-out buttons, label `account.removeData` "Also remove my data from this device", unchecked by default, not remembered.
  - Checked, and nothing unsynced after the sign-out's sync → after the server sign-out succeeds, `forgetAccountOnDevice(me.userId)`, then leave.
  - Checked, and changes unsynced → the existing unsynced dialog shows, with an added line `account.removeDataKept` "Your unsynced changes will stay on this device, so its data won't be removed." "Sign out anyway" signs out and **keeps** the data.
  - Unchecked → exactly today's behaviour.

- [ ] **Step 1: Write the failing tests**
  - `removes this account's data from the device when asked` — checkbox on, `unsynced: 0` → after sign-out, `Dexie.exists(dbName("u1"))` is false and `mm.visibleLists.u1` / `mm.name.u1` are gone; `mm.lang` stays.
  - `keeps the data when changes are unsynced, even after "Sign out anyway"` — checkbox on, `unsynced: 2` → dialog shows `removeDataKept`; "Sign out anyway" → database still exists.
  - `keeps the data by default` — checkbox off → database still exists after sign-out.
  - `keeps the data when the server sign-out fails` — checkbox on, logout rejects → database still exists, `account.failed` shown.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- Account` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** the same command, then `./scripts/gate.sh main` → `GATE: PASS`. Screenshots of the sign-out area (phone and desktop, both themes) and the unsynced dialog with the added line.
- [ ] **Step 5: Commit** `feat(web): sign out and remove my data from this device`
