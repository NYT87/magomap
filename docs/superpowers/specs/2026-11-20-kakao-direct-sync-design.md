# Sync from Kakao Map directly — design

Agreed with the owner on 2026-11-20. It amends the main spec (`2026-11-19-magomap-design.md`), whose non-goal "Talking to Kakao Map's private endpoints directly. Only the `kakao-list` extension does that." is **reversed** by this document.

## Why

Today getting a Kakao Map change into magomap takes two steps in two apps. She edits a list in the Kakao Map phone app, opens Kakao Map on a computer, runs the kakao-list extension's import, then opens magomap and runs "Import from kakao-list". The owner wants **one step inside magomap**: "Sync from Kakao" and her lists are current, both the first time and every time she comes back.

## The constraint everything rests on

Kakao has no public API for saved lists. The lists are read from undocumented `map.kakao.com` endpoints (`GET /folder/list`, `GET /favorite/mine/list?folderid=`), documented in `kakao-list/docs/kakao-maps-private-api.md`. Those endpoints are authorised by the **Kakao Map web session (cookies on `map.kakao.com`)**, not by the Kakao Login token magomap gets at sign-in. A web page on another site can't send those cookies, and magomap's Worker doesn't have them. So one of these must happen:
- code runs inside a signed-in Kakao Map tab (an extension), or
- the Worker holds something Kakao Map accepts: her Kakao Map session, or the Kakao Login token **if** Kakao Map happens to accept it (unverified; see the test below).

## Goals

1. **One-step sync in magomap.** A "Sync from Kakao Map" action brings her Kakao lists and places up to date, with the same results and rules as today's import (nothing deleted, diaries untouched, removals only after a complete read).
2. **On a computer** (Chrome or Brave on desktop), always: through a magomap browser extension.
3. **On her phone too, if the test allows it**: the Worker reads Kakao Map itself, using a credential the user connected once.
4. **kakao-list keeps working until migration is done.** "Import from kakao-list" stays, side by side with the new sync, and both update the same lists and places.
5. **Then kakao-list is retired from magomap**: its import, settings and code are removed.

## Non-goals

- Editing Kakao notes or list membership from magomap. Kakao data stays read-only here.
- Automatic or background sync. It's one tap; scheduled sync can come later.
- Safari, Firefox or mobile-browser extensions.
- Changes in the kakao-list repo. Its magomap endpoint (plan 03, already merged there) is used as is until retirement.
- Publishing the extension on the Chrome Web Store. It's loaded unpacked from a release zip, like kakao-list's.

## Anti-goals (failure even if it "works")

- **One person's Kakao Map account imported into another person's magomap account.** The laptop may be signed into his Kakao Map while she is signed into magomap. That must not make her the "owner" of his lists, or mark anything removed.
- **A stored Kakao credential that leaks**: readable by the client, logged, or kept after she disconnects or deletes her account.
- **The new sync undoing kakao-list data, or the other way round**, for example an older kakao-list snapshot rolling back a fresher direct sync.
- **Losing her kakao-list local notes.** Those exist only on the kakao-list server; Kakao Map doesn't have them.
- Anything from the main spec's anti-goals (deleting places, diaries or links, duplicate places).

## Approaches

1. **Chosen: extension first, phone sync added on top, gated by a test.** A short test with real accounts decides whether the Worker can read Kakao Map (with the Login token, or with her Kakao Map cookie) and for how long. The magomap extension is built regardless: it is the computer path and the easy way to connect phone sync. Phone sync is built only if the test passes.
2. **Phone sync only, the cookie pasted by hand.** Less code, but copying a cookie out of developer tools is a poor task for her, and there's no fallback if the Worker can't reach Kakao Map. Rejected.
3. **Extension only.** No credential stored ever, but no phone sync. Kept as the outcome of approach 1 if the test fails.

**Trust rule change (owner's decision).** The shared-places addendum says "the server fetches import data itself; the app never sends import contents." The extension path breaks this: the extension reads Kakao Map and **uploads** the data. The owner accepted this, because it's the same trust kakao-list already has (its server stores whatever her extension uploaded, and magomap imports it). The alternative (the extension only hands over her login and the Worker always reads) was rejected because it leaves no computer fallback if the Worker can't reach Kakao Map. The phone path still follows the original rule: the Worker reads Kakao Map itself.

## Phase 0 — the test (owner gate, before any build)

Done with the owner, signed in, using throwaway scripts. Nothing from it is kept as product code. Results go into `docs/kakao-map-access.md` (new).

1. **Token.** Call `GET https://map.kakao.com/folder/list` with `Authorization: Bearer <Kakao Login access token>` from a real magomap sign-in (temporarily logged by a local dev build, never in production). Record the status and body.
2. **Cookie from the Worker.** From a deployed throwaway Worker, call both endpoints with the `Cookie` header copied from her signed-in `map.kakao.com` tab. Record:
   - which cookies are actually needed (remove them one by one);
   - whether Kakao answers Cloudflare's servers normally (status, body, any block or captcha page).
3. **Lifetime.** Record each needed cookie's expiry, then repeat step 2 after 1, 3 and 7 days without touching Kakao Map.
4. **Phone edits reach the web.** Change a list in the Kakao Map phone app; read it through the endpoint a minute later.
5. **Plan 03 G1 and G2 checks, which still apply.** Collect the three coordinate fixtures for the converter. Compare one shared favourite's `seq` as seen by her and by the owner.

**Decision.** Phase 2 (phone sync) is built if step 1 works, or if step 2 works and the cookie lasts at least about a week (the owner can accept less after seeing the numbers). Otherwise this project ends after phase 1, and the document is updated to say so.

## Phase 1 — computer sync through a magomap extension

### Extension (`apps/extension`, new)

- Manifest V3, Chrome and Brave desktop. Permissions: `scripting`, `tabs`; host permission `https://map.kakao.com/*`. `externally_connectable` matches magomap's own origins (production and local dev) only.
- **Reader.** Ported from `kakao-list/apps/extension/src/kakaoMapsExtractor.ts` (same owner; note the origin in the file header). Only the read path is ported: `/folder/list`, then `/favorite/mine/list` per folder, run in the page with `credentials: "include"`. The note-editing and place-detection code is not ported. It returns **raw** Kakao fields (folders and favourites, including `x`/`y`, `type`, `subscribe`, `kakao_map_user_id`, `nickname`). It does no mapping, so all interpretation lives on the server, shared with phase 2.
- **Tab.** It uses an open `map.kakao.com` tab, or opens one in the background if there's none. If Kakao Map isn't signed in, it reports `kakao_signed_out`, and magomap tells her to sign in to Kakao Map in that browser.
- **No popup or UI of its own** beyond an icon that says "Use Sync from Kakao Map in magomap". All UI is in magomap.

### Web app

- Account screen gets a **"Sync from Kakao Map / 카카오맵에서 동기화"** section, above the existing "Import from kakao-list" section. It reuses that section's progress, summary, error and last-sync parts.
- The page asks the extension for a read through `chrome.runtime.sendMessage(extensionId, …)`. If the extension isn't there, the section says how to install it (desktop) or what phone sync needs (phone; see phase 2).
- The page then drives an **upload run**, list by list and page by page (≤ 500 items), like today's run. The difference is that it sends the data instead of saying "next page".

### Server

- **One Kakao adapter for raw Kakao Map data** (`packages/domain/src/providers/kakaoMap.ts`). It turns raw folders and favourites into the neutral import format, applying the rules kakao-list applies today:
  - skip folders with `status: "D"`;
  - followed = `subscribe` set (not `N`, `0`, `""`, `false`) **and** `kakao_map_user_id` differs from the owner of the unflagged folders;
  - only `type: "PLACE"` favourites get a place external id;
  - `favorite.seq` → item external id;
  - `display1`/`display2`/`memo`/`color` → title, address, provider note, provider colour.

  It also converts WCONGNAMUL `x`/`y` to WGS84. That conversion moves into magomap: proj4 with the definition in plan 03's Global Constraints, tested against the published pair and phase 0's fixtures, and invalid coordinates are dropped, never thrown. This supersedes "conversion belongs in kakao-list" in the main spec's "Left to the builder".
- **Upload runs.** New routes beside the existing ones. They take the run's list summaries, then each page's raw favourites. They validate everything with the same limits and schemas, and reuse `importRuns` (start, chunk, finish, complete) unchanged. All existing run rules hold: pages in order, exact sizes, removals only after a complete run.
  - `importedAt` for an upload run is the **server's clock when the run starts**, never the client's.
  - `subscriptionKnown` is true; `complete` is true once every list finished.
- **Who may upload.** Only users whose Kakao id is in `ALLOWED_KAKAO_USER_IDS`. If that list is empty, uploads are refused (`not_allowed`). *(Designer's call: open sign-up must not mean open writes to shared rows.)*
- **Kakao Map account binding (the anti-goal).** The read includes the Kakao Map account id (the `kakao_map_user_id` of her own, unflagged folders) and its nickname.
  - **First sync:** magomap shows "This is the Kakao Map account of <nickname>. Sync it into your magomap?" and, on yes, stores the binding on the user.
  - **Later syncs:** reads from a different Kakao Map account are refused (`kakao_account_mismatch`), with a way to re-confirm.
  - **One Kakao Map account is bound to at most one magomap user.**

  *(Designer's call; it replaces kakao-list's per-import confirmation.)*
- The Worker never logs raw Kakao payloads, cookies or tokens.

## Phase 2 — phone sync (only if phase 0 passes)

- **Credential.** Whichever phase 0 showed works:
  - **Token works:** at sign-in the Worker keeps the Kakao **refresh token** (today it keeps nothing) and refreshes it when needed.
  - **Cookie works:** the extension gets the `cookies` permission and a **"Connect phone sync"** action. It reads only the cookies phase 0 named and sends them once to magomap.
- **Storage.** A new per-user table holds the credential, **encrypted** (AES-GCM, key in a new Worker secret). It also holds the bound Kakao Map account id, when it was connected, and when it last worked. The credential is never sent to the client. **Disconnect** (in Account) deletes it, and deleting the account deletes it.
- **Server-driven run.** "Sync from Kakao Map" on a device without the extension starts a run the Worker drives itself. The client says "next", and the Worker reads the next folder from Kakao Map with the stored credential, keeping the original trust rule. The account-binding check applies to every read.
- **Expiry.** If Kakao answers signed-out (an auth status, a redirect to login, or a non-JSON body), the credential is marked expired. The section then says "Phone sync needs reconnecting — open magomap on your computer and tap Connect phone sync" (or "sign in again" for the token case).
- The Account section on the phone shows one of: **Sync** (connected), **Not connected** (how to connect from the computer), or **Needs reconnecting**.

## Living with kakao-list (until migration)

- Both sources use the same provider (`kakao`) and the same external ids (folder id, favourite `seq`, Kakao place id), because the reader is kakao-list's. They update the same shared rows.
- The existing **newer snapshot wins** rule (`provider_snapshot_at`) settles the order. An old kakao-list snapshot can't roll back a newer direct sync, and the other way round.
- **Local notes** come only from kakao-list, as today (diary entries with `origin = 'kakao_list'`).
- **Migration is done** when each user has finished **one complete kakao-list import after this ships**, so their kakao-list local notes are in magomap as diary entries. magomap shows each user whether theirs is done (from `import_runs`). *(Designer's call on the definition; the owner confirms when to retire.)*

## Phase 3 — retire kakao-list (owner-triggered, later)

When the owner says both accounts are migrated:
- remove the "Import from kakao-list" section and the `/import` redirect target;
- remove the kakao-list routes (`apps/api/src/import/routes.ts`'s fetch path), the kakao-list contract adapter (`providers/kakao.ts`'s contract schemas), `apps/api/scripts/fake-kakao-list.ts`, and the `KAKAO_LIST_URL` and `MAGOMAP_IMPORT_SECRET` settings;
- keep imported diary entries (`origin = 'kakao_list'`) as they are;
- update the main spec and README.

Deprecating kakao-list itself is the owner's call in that repo.

## Spec changes this makes

- Main spec, Non-goals: "Talking to Kakao Map's private endpoints directly" → removed.
- Main spec, "Left to the builder": the coordinate conversion now lives in magomap.
- Shared-places addendum, trust rules: an **allowlisted user's extension upload** is an accepted import source, alongside server-fetched imports.
- Plan 03's go-live gates G1/G2 move into phase 0 here. Its Task 4 (deploy and set `KAKAO_LIST_URL`) still applies, for the migration import.

## Left to the builder

- How the extension id is configured in the web app (build-time constant per environment is fine).
- Route names and the exact shape of the upload requests, within the rules above.
- Exact wording in Korean and English, following existing `import.*` strings and the brand guidelines.
- Whether the Worker-driven run reads one folder per request or splits a large folder further, staying inside the Workers CPU limit. Measure with her largest folder.
- Test layout, following the existing import-run tests on both database dialects.
