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

Done with the owner, signed in, using throwaway scripts. Nothing from it is kept as product code. Results go into `docs/kakao-map-access.md` (new). **Steps 1, 2 (from the owner's computer), part of 3, and 5's fixtures ran on 2026-11-20; see "Phase 0 results" below.**

1. **Token.** Call `GET https://map.kakao.com/folder/list` with `Authorization: Bearer <Kakao Login access token>` from a real magomap sign-in (temporarily logged by a local dev build, never in production). Record the status and body.
2. **Cookie from the Worker.** From a deployed throwaway Worker, call both endpoints with the `Cookie` header copied from her signed-in `map.kakao.com` tab. Record:
   - which cookies are actually needed (remove them one by one);
   - whether Kakao answers Cloudflare's servers normally (status, body, any block or captcha page).
3. **Lifetime.** Record each needed cookie's expiry, then repeat step 2 after 1, 3 and 7 days without touching Kakao Map.
4. **Phone edits reach the web.** Change a list in the Kakao Map phone app; read it through the endpoint a minute later.
5. **Plan 03 G1 and G2 checks, which still apply.** Collect the three coordinate fixtures for the converter. Compare one shared favourite's `seq` as seen by her and by the owner.

**Decision.** Phase 2 (phone sync) is built if step 1 works, or if step 2 works and the cookie lasts at least about a week (the owner can accept less after seeing the numbers). Otherwise this project ends after phase 1, and the document is updated to say so.

### Phase 0 results (2026-11-20)

- **The Kakao Login token doesn't open Kakao Map.** `/folder/list` and `/favorite/timestamp` with `Authorization: Bearer <token>` answer 403 HTML. Phone sync, if any, uses the cookie.
- **One cookie is enough: `_kawlt`** (the Kakao account web login token, on `.kakao.com`). From a plain HTTP client it also needs browser-like headers: `User-Agent`, `Referer: https://map.kakao.com/` (and `Origin`, `Sec-Fetch-*`). Without them Kakao answers 403 HTML even with the cookie. Inside a `map.kakao.com` tab (the extension) the browser sends these itself.
- **Signed out is not an error.** Without the cookie, `/folder/list` answers 200 `{ status: { code: "SUCCESS" }, folders: [] }`. A read must treat **zero folders** as "signed out of Kakao Map", never as "she deleted every list" (that would mark every list removed).
- **Responses use a `folders` key** (`{ status, folders }`), as the kakao-list extractor already handles.
- **Lifetime.** `_kawltea` (its expiry) said 2026-11-20 20:00 KST; after that time the same `_kawlt` still read all 29 folders. The multi-day check (1, 3, 7 days) and the read **from Cloudflare's network** are still open, so the phase 2 decision is still open.
- **Coordinates.**
  - Some favourites now carry Kakao's own `lat`/`lon` (WGS84) beside `x`/`y`; older ones only `x`/`y`. **Use `lat`/`lon` when present, else convert `x`/`y`.**
  - The projection is confirmed: proj4 (EPSG:5181 × 2.5) on `x`/`y` agrees with Kakao's `lat`/`lon` within 3e-9° on two fixtures (Jeju PLACE `471350, -32433` → `33.37661909, 126.87684594`; `608064, 1159067` → `37.67127631, 127.48995646`).
  - **Negative `y` is valid** (south of about 33.5°N, southern Jeju). Only missing, zero, non-finite input or a result outside Korea gives no coordinates. (kakao-list had the same bug; fixed there in its PR #29.)
- **Folder 0 is each person's default favourites list** and is listed by `/folder/list`. Its list external id is per person: `0~<Kakao Login id>` (magomap PR #2, `kakaoListExternalId`), the same for both sources.
- **Favourite types:** `PLACE` and `ADDRESS` are shown as places (kakao-list `MAGOMAP_PLACE_TYPES = {"PLACE","ADDRESS"}`, its PR #29; an `ADDRESS` key is an `N…`/`J…` address docid). `POINT` and `ROUTE_BICYCLE` arrive without a key, as pins at their own coordinates; a `ROUTE_BICYCLE` has no `x`/`y`, so it is a list item with no pin. Nothing more is done for routes for now.
- **Owner ids.** Folder records carry `map_user_id` and not always `kakao_map_user_id`. Own-account detection uses `kakao_map_user_id || map_user_id`, as kakao-list's extractor does.
- **Not needed now:** the place-detail endpoint (`/api/v1/mapsearch/srcid`) could add category and phone later, through the extension only. The address lookup (`search_addr`) is gated and unusable outside the page.
- **Still open (owner gates):**
  - **Step 4,** phone edits reaching the web endpoint;
  - **the `seq` comparison** of one shared favourite between her account and the owner's. It needs her signed in once on the computer; it blocks Task 2's parity work if the `seq`s differ (see "Settled after the builder check");
  - **step 2 from a Worker and the multi-day lifetime,** before phase 2.

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

  Coordinates: Kakao's `lat`/`lon` when the favourite has them, otherwise WCONGNAMUL `x`/`y` converted to WGS84. That conversion moves into magomap: proj4 with the definition in plan 03's Global Constraints, tested against the published pair and phase 0's fixtures. Negative values are valid; invalid coordinates are dropped, never thrown. This supersedes "conversion belongs in kakao-list" in the main spec's "Left to the builder".
  - **Zero folders is "signed out"** (phase 0): the read stops with `kakao_signed_out` and nothing is uploaded.
- **Upload runs.** New routes beside the existing ones. They take the run's list summaries, then each page's raw favourites. They validate everything with the same limits and schemas, and reuse `importRuns` (start, chunk, finish, complete) unchanged. All existing run rules hold: pages in order, exact sizes, removals only after a complete run.
  - `importedAt` for an upload run is the **server's clock when the run starts**, never the client's. So every direct sync is a new snapshot; the "already imported this sync" refusal stays kakao-list only.
  - An upload run can't be continued after the page closes (the read lived in that page). Starting a new sync supersedes it, as a new kakao-list import does. Within the page, the existing single retry per request applies.
  - `subscriptionKnown` is true; `complete` is true once every list finished.
- **Who may upload.** Only users whose Kakao id is in `ALLOWED_KAKAO_USER_IDS`. If that list is empty, uploads are refused (`not_allowed`). *(Designer's call: open sign-up must not mean open writes to shared rows.)*
- **Kakao Map account binding (the anti-goal).** The read includes the Kakao Map account id (the `kakao_map_user_id`, else `map_user_id`, of her own, unflagged folders) and its nickname.
  - **First sync:** magomap shows "This is the Kakao Map account of <nickname>. Sync it into your magomap?" and, on yes, stores the binding on the user.
  - **Later syncs:** reads from a different Kakao Map account are refused (`kakao_account_mismatch`), with a way to re-confirm.
  - **One Kakao Map account is bound to at most one magomap user.**

  *(Designer's call; it replaces kakao-list's per-import confirmation.)*
- **Account mix-ups (owner, 2026-11-21).** The owner saw kakao-list's extension keep showing his data after his Kakao Map session expired and his wife signed in to Kakao Map, because that extension keeps its own login. kakao-list is out of scope; magomap's extension must not have the problem:
  - **No login or data of its own.** The extension stores no session and no read. Every sync reads whoever is signed in to Kakao Map at that moment.
  - **Kakao Map signed out or expired:** zero folders → "Sign in to Kakao Map in this browser", nothing uploaded.
  - **First sync, the other person signed in to Kakao Map:** the confirmation names **both** accounts, e.g. "Sync 수지's Kakao Map (••••7800) into José's magomap?", so a mix-up is visible before anything is written.
  - **Later syncs:** a Kakao Map account other than the bound one is refused: "This browser is signed in to a different Kakao Map account (••••7800). Sign in to yours, or confirm to switch."
  - **An account bound to another magomap user** is refused outright (`kakao_account_taken`).
  - Signing out of Kakao doesn't sign anyone out of magomap: Kakao is only used to sign in, and magomap can't see the Kakao web session. That's expected and unchanged.
- **Who owns a list (owner, 2026-11-21).** A shared Kakao list's owner in magomap is the magomap user **bound to the Kakao Map account that owns that folder in Kakao**, never simply whoever imported it first.
  - Every upload carries each folder's Kakao owner id (`kakao_map_user_id || map_user_id`); magomap records it on the list.
  - The recorded Kakao owner id is set once, from the first read that names it, and never changes.
  - An upload grants `owner` only when the folder's Kakao owner id equals the uploader's bound Kakao Map account; otherwise the uploader is a follower. A folder with no owner id in the read (a bare followed folder) is followed.
  - A kakao-list import can't name the Kakao owner. When the list already has a recorded Kakao owner id and the importer's bound account differs, the import makes them a follower; otherwise kakao-list's own rule applies as today.
  - Only the owner's complete sync can remove a list for everyone. Followers with a newer snapshot still update a shared list's contents (newest snapshot wins), including removing items when they finish a complete read of that list.
