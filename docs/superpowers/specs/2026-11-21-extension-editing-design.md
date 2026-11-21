# Edit Kakao notes, visit notes and links from the extension — design

Agreed with the owner on 2026-11-21. It builds on the direct Kakao Map sync (`2026-11-20-kakao-direct-sync-design.md`) and its extension (`apps/extension`), and **reverses** that spec's non-goal "Editing Kakao notes or list membership from magomap. Kakao data stays read-only here." for **Kakao notes only**.

## Why

kakao-list's extension lets her, while looking at a place on the Kakao Map site, edit that place's Kakao note (saved in Kakao Map itself) and keep her own notes. The owner wants magomap's extension to be that, with magomap's own data: **while she's on a place in Kakao Map, she sees and edits its Kakao note, its visit notes and its links, without leaving the page.** As a nice-to-have, the Kakao note can also be edited from the magomap app on a computer, reaching Kakao Map through the extension.

## Goals

1. **Panel on Kakao Map.** On `map.kakao.com`, the magomap icon opens a side panel for the place open in the Kakao Map page: its name, its magomap lists, its Kakao note, its visit notes and its links.
2. **Edit the Kakao note there**, saved to Kakao Map and to magomap.
3. **Add and edit visit notes and links there** (magomap data, as in the app).
4. **Edit the Kakao note from the magomap app** on a computer that has the extension.
5. **Kakao-only for now, built to take other map providers later** (Google Maps, …): the Kakao-specific parts live in one provider module.

## Non-goals

- Adding or removing places from Kakao lists, moving them between lists, or changing a favourite's title, address or colour.
- Editing the Kakao note on the phone (no extension there). It shows read-only with a line saying it can be edited on the computer. Phone editing becomes possible with phone sync (phase 2 of the direct-sync spec), and is a later change.
- Offline editing in the extension: it works only online; nothing is queued.
- Other map providers (Google Maps …) — later.
- The extension's own magomap login (see "Who is signed in").

## Anti-goals (failure even if it "works")

- **A note written into the wrong person's Kakao Map, or a magomap edit made as the wrong person.** Today's lesson from kakao-list: a stale separate login in the extension.
- **A note saved in magomap but not in Kakao Map** (or the other way round) without her knowing.
- **Editing a list she only follows**: Kakao lets only a list's owner change its favourites.
- **An older import or sync reverting a note she just edited.**
- A visit note or link lost or duplicated.

## Approaches

- **A. Edit inside the extension (chosen), plus editing the Kakao note from the app.** A side panel on Kakao Map shows and edits the place; the app's place screen can also edit the Kakao note, asking the extension to write it to Kakao Map. Most work, but it's what she's used to from kakao-list, and in-place on Kakao Map.
- B. Edit only in magomap, with the extension as a bridge (the icon opens the place in magomap; the app writes the Kakao note through the extension). Less code, one editing screen, but a step away from the page she's on. Kept as part of A (goal 4), not instead of it.

## Who is signed in (designer's call)

The extension has **no magomap login of its own**. It calls magomap's API with the **magomap session already in that browser**: the extension gets a host permission for magomap's origin, so the browser sends the session cookie with its requests (Chrome treats an extension's requests to its permitted hosts as first-party). So "who the extension acts as" is always whoever is signed in to magomap in that browser, and signing out of magomap signs the extension out too. If no one is signed in, the panel says "Sign in to magomap in this browser" with a link.

No origin check is added: today the API relies on the `SameSite=Lax` cookie plus the required `x-magomap-user` header, which a cross-site page can't send without a preflight. The extension sends that header like the app does, after asking `/api/me` who is signed in. *(Designer's call.)*

## Account check (every write)

Before any write, the extension reads the Kakao Map account signed in to that page (`kakao_map_user_id || map_user_id` of her own folders, as the sync does) and magomap's bound Kakao Map account for the signed-in magomap user (the direct-sync binding). The panel header always shows both:

```
magomap: 수지 · Kakao Map: 수지 (••••7800) ✓
```

If they differ, or the user has no binding yet, **writes are blocked** with "This Kakao Map account isn't the one linked to your magomap account. Sync from Kakao Map once to link it, or sign in to the right account." Reading still works.

## The panel (extension)

- Chrome **side panel** (`chrome.sidePanel`), enabled on `map.kakao.com` tabs, opened from the icon. It follows the place open in the page: when she opens another place in Kakao Map, the panel switches to it.
- **Which place:** the Kakao place open in the page (the place card's `place.map.kakao.com/<id>` link, as kakao-list detects it) → magomap place `p_kakao_<id>`. A favourite without a place id (an address or a dropped pin) is found through the open favourites folder and its `seq` when that's how she opened it.
- **Not in magomap:** "Not in your magomap lists yet. Sync from Kakao Map to bring it in." (No adding from here.)
- **Shows:** title, its magomap lists (as the app's place screen does), the Kakao note of each Kakao list it's in (one per list, each with its own input on lists she owns), visit notes, links.
- **Kakao note:** editable only on lists she owns in Kakao; read-only on followed lists ("Only the list's owner can change this note"). A follower still keeps their own private visit notes and links on those places, as in the app; only the list and its Kakao notes are the owner's.
- **Visit notes and links:** add, edit, delete — the same rules and limits as the app.
- Korean and English, both themes, keyboard and screen-reader accessible, following the brand guidelines.

## Saving a Kakao note (panel or app)

1. **Account check** (above).
2. **Kakao Map first.** In the `map.kakao.com` tab, read the favourite fresh (its folder, all pages) and send what Kakao Map's own page sends: `POST /favorite/update` with `{ datas: [{ seq, display1, display2, color, memo }] }`, every field but `memo` unchanged from the fresh read (kakao-list's `updateKakaoFavoriteNoteInPageEnvelope`, ported read-for-write only).
3. **Verify** by reading the favourite again (as kakao-list does, a few short retries) until `memo` matches.
4. **Then magomap.** A new route records the note on the shared list item (`provider_note`) for everyone who has that list, with the edit time, so **an import or sync whose snapshot is older than the edit never reverts it**. The route checks: allowlisted user, bound account, and that the user is the list's **Kakao owner**: their bound Kakao Map account equals the list's recorded Kakao owner id (direct-sync spec, "Who owns a list"), exactly as Kakao only lets the folder's owner edit its favourites.
5. **Failure handling:** if Kakao refuses (signed out, not the owner, the favourite is gone, the verify never matches), magomap is not changed and she sees why. If Kakao succeeded but magomap failed (offline, server error), she's told the note is saved in Kakao Map and will reach magomap with the next sync — which is true, since the next direct sync reads it.
6. Same Kakao note text limits as Kakao's own editor (to be measured; at most magomap's neutral text limit).

## Editing the Kakao note from the magomap app (goal 4)

- On the place screen, on a **computer with the extension** (detected as the sync section already detects it), the Kakao note on a list she owns gets an Edit button. Saving runs the same steps: the page asks the extension to do steps 1–3 (a new message, alongside `magomap.read`), then calls the route of step 4 itself.
- Without the extension (phone, or not installed), the note stays read-only with "Edit it on your computer with the magomap extension".

## Visit notes and links from the extension

They go through magomap's existing sync push, so the app's rules, conflict handling and limits apply unchanged. The panel is online-only: if a push fails, the edit stays in the panel with "Couldn't save — try again", and nothing is queued. The app picks them up on its next sync.

## Provider-ready structure

Everything Kakao-specific (place detection on the page, the folder and favourite reads, the note write, the account read) lives in one provider module of the extension (`providers/kakao`), behind a small interface (detect the open place, read the account, read a favourite, write a note). A later provider adds a module and a host permission; the panel and the magomap calls don't change.

## Security

- Host permissions: `https://map.kakao.com/*` (existing) and magomap's own origin. Messages from web pages are still accepted only from magomap's origins (`externally_connectable`); the new write message is subject to the same origin check and the account check.
- No cookies or tokens are read or stored by the extension; nothing read or written is logged.
- The Worker never trusts the client for ownership: the note route checks the list role server-side.

## Settled after the builder check (designer's calls, open to correction)

- **Order:** this builds after the direct-sync branch merges. It needs its extension, the Kakao Map binding and the **recorded Kakao owner id** on lists ("Who owns a list", built in that branch's Task 5).
- **Reading one place:** a new read-only route returns one place's magomap data for the signed-in user (the place, its memberships and Kakao notes with each list's role and recorded owner, the user's visit notes and links, with the fields a push needs). The extension keeps nothing between panel openings, matching "the extension stores no session and no read".
- **Lists with no recorded Kakao owner id** (only ever imported from kakao-list) can't have their Kakao note edited yet: the panel says "Sync from Kakao Map once to edit notes on this list". Her next sync is a direct one anyway. The panel decides "lists she owns" from the recorded owner id; the live Kakao read is used only for the account check and the write.
- **A note changed underneath:** before writing, the extension compares Kakao's current memo with the text she started editing from. If they differ (edited in the Kakao Map app meanwhile, or magomap's copy is stale), nothing is written; she sees both and picks "Keep mine" or "Use Kakao's". From the app, the starting text is magomap's copy, so this check matters most there.
- **"An older sync never reverts the edit":** a separate edit time is stored on the list item (server clock). An import or sync whose snapshot is older than it leaves that item's **note** alone; every other field of the item follows the existing rules.
- **One place in several of her lists (owner, 2026-11-21, revised):** each list has its **own** Kakao note input. The note is saved to the list it was typed in, and only that list's favourite is written (in Kakao Map, then magomap). Wherever the note can be edited (the panel, and the app on a computer with the extension), notes are shown per list, not grouped; lists she only follows show their note read-only. Where nothing can be edited (the phone), the app keeps its current grouped cards.
- **No Kakao Map tab open when the app asks for a write:** the extension opens one in the background, as `magomap.read` does, and closes it afterwards.

## Left to the builder

- The exact Kakao note length limit (measure what Kakao's editor allows).
- How the panel detects the open place when Kakao's page markup changes (selectors as kakao-list uses them, with a fallback through the open folder).
- The route's name and body shape, within the checks above.
- Exact wording in Korean and English.
- Whether the panel reuses web components or has its own small UI (it must match the app's look).
