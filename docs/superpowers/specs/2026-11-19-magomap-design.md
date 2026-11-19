# magomap — Design

Date: 2026-11-19
Status: draft, awaiting approval

## Intent

A map app, installed on the phone as a PWA, for keeping a personal record of places. Each saved place has its own **visit diary** (a new, dated note every visit) and its own **links**. Places are grouped into **lists**, like Google Maps lists; a place can be in many lists, and its diary and links belong to the place, so they are the same whichever list it is opened from.

**Why.** The first user is the owner's wife. Her saved places live in Kakao Map lists, which are poor for managing and re-reading what she thought of a place. The sibling project `kakao-list` already pulls her Kakao lists out of Kakao Map (through its browser extension) into its own server. `magomap` is where she actually uses them: search the map, see her places, and write about them, including offline, standing at the place with bad signal (the main case).

**Later (phase 2, not in this design):** trips in the style of TREK (plan and record trips over saved places), sharing between accounts (which will come mostly through trips), and linking a Google login to an account.

## Users

- Two people for now (the owner and his wife), each with a **separate account**. No sharing between accounts in this phase.
- Phone first; desktop must work too.

## Goals

1. Sign in with Kakao. Separate accounts.
2. A full-screen map showing the user's saved places, with a list picker to show/hide lists.
3. Search the map for new places (Kakao place search) and save them.
4. Lists of two kinds:
   - **Kakao lists**: imported from `kakao-list`, and they keep following Kakao.
   - **Own lists**: created and edited in `magomap`.
5. A place page with:
   - name, address, category, links to open it in Kakao Map;
   - the **visit diary**: unlimited dated entries, newest first, add/edit/delete;
   - **links**: URL, optional title, add/edit/delete;
   - the lists it is in, and each Kakao list's Kakao note (read-only);
   - add to / remove from own lists.
6. **Offline**: everything saved is browsable and searchable offline, and diary entries, links and own-list changes can be made offline and sync later.
7. **Import from Kakao**: one button pulls the user's lists from the `kakao-list` server and updates `magomap`.
8. Deployable on Cloudflare, with the deployer choosing SQLite (D1) or Postgres.

## Non-goals (this phase)

- Trips, sharing, Google login (designed-for, not built; see "Ready for phase 2").
- Editing Kakao notes, or changing Kakao lists' membership from `magomap`. Kakao data is read-only here; editing it stays in Kakao Map / the `kakao-list` extension.
- Talking to Kakao Map's private endpoints directly. Only the `kakao-list` extension does that.
- Offline map downloads. Map tiles need a connection (already-viewed areas may come from the browser cache).
- Photos in diary entries. *(Builder's note: designer's call to keep scope down; easy to add later as an attachment table.)*
- Multi-user editing of the same data, real-time collaboration.

## Anti-goals (failure even if it "works")

- **Losing diary entries or links.** No import, sync, or Kakao-side change may ever delete or overwrite them. Places are never deleted automatically.
- **A note written offline that silently disappears.** Unsynced changes must be visible and must survive app restarts.
- **Pulling another person's Kakao account data** into an account (her subscribed lists are hers to import; someone else's Kakao account is not).
- **Duplicate places**: the same Kakao place saved by search and by import must be one place with one diary.

## Constraints

- **Hosting: Cloudflare.** One Worker serves the API and the PWA's static assets from one origin (no CORS, simple cookies).
- **Database behind a connector**: the deployer picks D1 (SQLite) or Postgres (reached from the Worker through Cloudflare Hyperdrive) by configuration. Application code is the same for both.
- **Kakao identity is per Kakao Developers app.** Kakao gives the same person a different user id in each app (see `kakao-list/docs/architecture-decisions.md`). `magomap` must use the **same Kakao app as `kakao-list`** (same REST API key; add `magomap`'s redirect URI and domain to that app), so that a `magomap` user's Kakao id equals their `kakao-list` id.
- **Kakao Maps JS SDK quota**: free only for the first app on the developer account with Kakao Maps on (see `kakao-list/docs/map-view.md`). Using the same Kakao app helps; Leaflet + OpenStreetMap is the fallback.
- **`kakao-list` dependencies** (see "Import from Kakao"): its importer must keep coordinates, and its server must expose a read endpoint for `magomap`. These are changes in the `kakao-list` repo.
- Tooling follows `kakao-list` conventions: pnpm workspaces, TypeScript, Biome, 14-day minimum dependency release age.

## Approaches considered

| | Approach | Trade-offs | Outcome |
|---|---|---|---|
| A | **Cloudflare Workers + database connector (D1 or Postgres) + hand-rolled offline sync** | Free at this scale, no cold starts, one deploy. Sync must be written (a few hundred lines; simple because each account is one person and diary entries are append-mostly). | **Chosen.** Owner asked for the DB to sit behind a connector so a deployer can pick SQLite or Postgres. |
| B | Vercel functions + Postgres, like `kakao-list` | Familiar, Kakao OAuth code reusable. Two projects plus a Postgres to run, cold starts, `kakao-list` already hit a Vercel crash (TASK-27). | Rejected. |
| C | A sync engine (PowerSync / ElectricSQL / Replicache-style) | Offline and conflicts handled by a library. Built for many users editing shared data; adds a paid service or infrastructure for little gain here. | Rejected. |

**Import direction**, also decided: `magomap` **pulls** from the `kakao-list` server (rather than the extension pushing to `magomap`, or file export/import). It keeps the projects loosely coupled; the extension doesn't change.

## Architecture

```
 phone / desktop browser
 ┌───────────────────────────────┐
 │ PWA (Vite + React + TS)       │
 │  map (Kakao SDK │ Leaflet)    │
 │  IndexedDB: places, lists,    │
 │   diary, links + outbox       │
 │  service worker: app shell    │
 └──────────────┬────────────────┘
                │ same origin
 ┌──────────────▼────────────────┐        ┌────────────────────┐
 │ Cloudflare Worker (Hono)      │──────▶ │ kakao-list server  │
 │  /api/* + static assets       │ import │ (Vercel, Postgres) │
 │  Kysely ─┬─ D1                │        └────────────────────┘
 │          └─ Postgres/Hyperdrive│──────▶ Kakao OAuth, Kakao Local search
 └───────────────────────────────┘
```

**Repo layout** (pnpm monorepo, in `/home/motoko/workspace/magomap`):

- `apps/web`: the PWA.
- `apps/api`: the Worker (Hono). It also serves `apps/web`'s build as static assets.
- `packages/domain`: shared types and validation schemas (request/response shapes, sync mutations).
- `packages/db`: the database connector. It holds the schema types, migrations and the dialect factory.

### Database connector

- **Kysely** as the single query layer, with two dialects: D1 and Postgres (Hyperdrive). *(Designer's call: Kysely runs one query codebase on both; Drizzle would need a schema file per dialect.)*
- `DB_DRIVER=d1|postgres` selects the dialect at startup; D1 uses the `DB` binding, Postgres uses the `HYPERDRIVE` binding.
- Portable column types only: ids are text (UUIDv7, generated on the client so offline-created rows have stable ids); timestamps are integer epoch milliseconds; booleans are integers; no JSON columns in queries.
- Migrations are plain, ordered migration files run by a `pnpm db:migrate` command for the chosen driver (for D1 via Wrangler, for Postgres via a direct connection). Where SQL differs, a migration has one variant per dialect.
- Both dialects are covered by the test suite (D1 through Miniflare/local SQLite; Postgres through a local container).

### Data model

Every table except `users`/`identities` has `user_id`, and every query is scoped by the signed-in user.

| Table | One row per | Main columns |
|---|---|---|
| `users` | account | id, display name, created_at, `change_seq` (sync counter) |
| `identities` | login method | user_id, provider (`kakao`; `google` later), provider_user_id; unique (provider, provider_user_id) |
| `sessions` | signed-in device | token hash, user_id, expires_at, created_at |
| `places` | place, per user | id, `kakao_place_id` (nullable, unique per user), title, address, road address, category, phone, lat, lng (nullable), source (`kakao_import` / `search`) |
| `lists` | list | id, kind (`kakao` / `own`), `kakao_folder_id` (unique per user, kakao lists only), `subscribed`, `owner_name`, name, description, colour, `removed_from_kakao_at` |
| `list_items` | place in a list | id, list_id, place_id, position, added_at; for kakao lists: `kakao_favorite_seq`, `kakao_note`, `kakao_color`, `removed_from_kakao_at` |
| `visit_notes` | diary entry | id, place_id, `visited_on` (date, defaults to today, editable; null for imported notes), body, `origin` (`user` / `kakao_list`), `origin_key` (for imported notes: the source list id; used to update instead of duplicate), `edited_by_user`, created_at |
| `links` | saved link | id, place_id, url, title (optional) |
| `import_runs` | import | started/finished, status, counts (lists/places added, updated, removed, restored), error |

All syncable rows (`places`, `lists`, `list_items`, `visit_notes`, `links`) also have `created_at`, `updated_at`, `deleted_at` (soft delete), and `seq`: the value of the user's `change_seq` when the row last changed.

Rules:
- **A place is one row per user per Kakao place.** Matching is by `kakao_place_id`, so a place first saved from search and later found in a Kakao import is the same row, with one diary.
- **Diary and links belong to the place** (`visit_notes.place_id`, `links.place_id`), never to a list.
- **Kakao notes belong to the membership** (`list_items.kakao_note`), because Kakao keeps one per list. They are read-only in `magomap`.
- **Place fields are not editable by the user** in this phase. They come from Kakao (search or import), and imports refresh them. There are no manual places: `source` is `kakao_import` or `search`. *(Designer's call.)*
- **A diary entry or link arriving for a deleted place restores the place.** The server clears `deleted_at` instead of rejecting the write, so an entry written offline is never lost. *(Designer's call, from the anti-goal.)*
- **Soft delete everywhere**; places are never deleted by import. A user may delete a place themselves (it then disappears from all lists; its diary and links go with it, after a confirmation).

### Sync (offline)

Each account is one person on a few devices, so a simple design is enough:

- **Local copy.** The PWA keeps all the user's syncable rows in IndexedDB (Dexie). The UI reads only from it, so online and offline behave the same.
- **Outbox.** Every local change (create/update/delete of a place, own list, own list item, diary entry, link) is written to IndexedDB **and** appended to an outbox in the same transaction. The UI shows a count of unsynced changes, and per-item "not synced yet" marks.
- **Push.** `POST /api/sync/push` with a batch of mutations `{id, table, op: upsert|delete, row, clientUpdatedAt}`. The server applies them in one transaction, increments `change_seq`, stamps `seq`, and returns per-mutation results. **Conflict rule: the most recent `clientUpdatedAt` wins, per row.** Diary entries are almost always new rows, so they never collide. Mutations are idempotent (client ids), so a retried push is safe.
- **Pull.** `GET /api/sync/pull?since=<seq>` returns every row with `seq > since` (deletes included as tombstones) and the new cursor. Paged for the first full download.
- **When.** Push then pull on app start, on regaining connectivity, after each local change (debounced), and after an import. No background sync is required (iOS doesn't support it reliably).
- **Server rejects** client writes to Kakao-owned data: kakao lists, their memberships, Kakao fields on memberships.
- Sessions that expire while offline must not lose the outbox: on re-sign-in, the outbox is pushed for the same user; if a different user signs in, the old outbox is kept aside and not pushed.

### Import from Kakao

**Flow.** The user taps "Import from Kakao". Then:

1. The `magomap` Worker calls the `kakao-list` server with the user's Kakao user id and a shared secret: `GET <KAKAO_LIST_URL>/api/integrations/magomap/snapshot?kakaoUserId=…`, `Authorization: Bearer <MAGOMAP_IMPORT_SECRET>`.
2. It receives the user's latest Kakao data in the **import contract** below. This is not the raw `kakao-list` `SyncSnapshot`; `magomap` relies only on this contract.
3. It applies it in one transaction, recorded as an `import_run`:
   - Each Kakao folder is upserted as a `kakao` list keyed by `kakao_folder_id`, and its name, description and colour are updated.
   - Each favourite is matched to a place by `placeKey` → `kakao_place_id`, creating the place if new. Title, address and coordinates are refreshed. Diary entries and links are never touched.
   - Memberships are upserted, with Kakao note, colour and position refreshed.
   - Memberships missing from a list get `removed_from_kakao_at`. Lists missing from the snapshot get the same. Neither is deleted.
   - Memberships and lists that reappear are restored.
   - Custom pins without a `placeKey` become places keyed by a stable id derived from the favourite `seq`.
4. The response is a summary ("12 added, 3 removed from Kakao, 1 restored"). The client then pulls.

**Import contract** (JSON, versioned with `contractVersion: 1`):

```
{ contractVersion: 1, kakaoUserId, importedAt, complete: boolean,
  lists: [{ kakaoFolderId, name, description?, icon?, subscribed: boolean, ownerName?,
            items: [{ favoriteSeq, placeKey?, title, address?, category?, phone?,
                      lat?, lng?, kakaoNote?, kakaoColor?, localNote?, position }] }] }
```

- `complete` is true only when the last extension import finished, i.e. its final chunk carried `expectedListIds`. **If `complete` is false, `magomap` adds and updates but marks nothing as removed.** That way a half-finished import can never mark lists as "Removed from Kakao". *(Designer's call.)*
- Coordinates arrive as WGS84 `lat`/`lng`. The conversion happens in `kakao-list`.
- **Marker colour for Kakao lists comes from each favourite's `kakaoColor`**, as in Kakao Map. Own lists use the list colour. *(Designer's call.)*
- **Subscribed lists** (other people's lists she follows in Kakao Map) **are imported too** (owner's decision). They become `kakao` lists with `subscribed = 1` and the owner's name, and are shown read-only in their own "Subscribed in Kakao" section of the list picker. Her diary and links still work on their places, because those belong to the place. `kakao-list` must keep Kakao's `subscribe` field as `subscribed` (its importer drops it today).
- **`kakao-list` local notes come in as diary entries** (owner's decision). Each non-empty `localNote` becomes one diary entry with no visit date, marked "from kakao-list" (`visit_notes.origin = 'kakao_list'`, `visited_on` null). That entry is keyed to the place, and later imports update it rather than adding another. If the same place has different local notes in several lists, each becomes its own entry, labelled with the list name. If she edits the imported entry in `magomap`, later imports no longer change it.
- **Whose data it is.** The snapshot is the one stored under the same Kakao Login id in `kakao-list`. `kakao-list` already makes the user confirm the Kakao Maps account on each import, and `magomap` accepts that as enough. *(Designer's call: these are two personal accounts.)*

**Removed places.** These stay in their Kakao list, at the end, marked "Removed from Kakao", with their diary intact. They are shown read-only as a membership. The user can remove the place themselves.

**Changes needed in `kakao-list`.** They are made in that repo, as the **first phase of the implementation plan** (`magomap`'s import is built against a fake server serving the contract until they land). *(Designer's call.)*
1. **Keep coordinates.** The extension importer stores Kakao's `x`/`y` on each item (raw values; they appear to be WCONGNAMUL), plus category if available. A shared helper converts them to latitude/longitude, as `kakao-list/docs/map-view.md` already plans. `magomap` stores lat/lng.
2. **Integration endpoint.** `GET /api/integrations/magomap/snapshot?kakaoUserId=` returns that user's latest data in the import contract above, including the `complete` flag. It is authorised by a shared secret (constant-time compare), rate-limited, and logged. It is read-only.
3. When `kakao-list`'s place storage refactor (TASK-24) lands, the endpoint can switch to the new records without changing the contract `magomap` relies on.
4. `kakao-list`'s planned `apps/map` (TASK-26) and place links (TASK-25) are covered by `magomap` and should probably be dropped there. *(Owner to confirm in that repo.)*

**Places without coordinates.** These are imported anyway. They appear in lists and search but not on the map, with a hint to re-import from the extension once it keeps coordinates.

**The user must have signed in to both apps with Kakao.** With the same Kakao app, the Kakao user id is the same in both. If `kakao-list` has no data for that id, the import says so and links to the extension.

### Accounts and sign-in

- **Who can sign up.** An allowlist of Kakao user ids in configuration (`ALLOWED_KAKAO_USER_IDS`). If it's empty, sign-up is open. Anyone not on the list gets a polite "not invited" page. *(Designer's call: the Kakao search key and the Maps quota are shared and limited.)*

- **Kakao Login (OAuth authorization code).** The Worker exchanges the code, reads the Kakao user id from `/v2/user/me`, and finds or creates the `identities` row and its user.
- **Session.** An opaque random token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored. It lasts 30 days, sliding. *(Designer's call; long because offline phone use shouldn't force frequent sign-ins.)* Kakao tokens are not kept after sign-in. `magomap` only needs the Kakao id.
- **Account page.**
  - Shows the connected login, with a disabled "Link Google" placeholder for later.
  - Sign out, and sign out everywhere.
  - Delete account, which removes all the user's rows.

### Place search

- `GET /api/search/places?q=&lat=&lng=` proxies **Kakao Local keyword search** with the server-held REST key, biased to the map centre.
- Results show on the map. Saving one creates a place with its `kakao_place_id`, title, address, category, phone and lat/lng (WGS84 from Kakao Local). If the place already exists, the existing place opens instead.
- Search needs a connection. Offline, the search box searches the user's own places (title, address, diary text, link titles) locally.

### Map

- **Kakao Maps JS SDK by default**, with **Leaflet + OpenStreetMap** as an automatic fallback. The fallback is used when no JavaScript key is configured, when the SDK fails to load, or when it is over quota. A small note says which map is shown.
- Both sit behind one small interface: set markers, cluster, fit bounds, select a place. The rest of the app doesn't know which is active.
- **Markers** are coloured by list: own lists get a colour picked by the user, Kakao lists use their Kakao colour. A place in several visible lists uses the first. Markers cluster when zoomed out.
- **List picker.** A bottom sheet on phones and a side panel on desktop. It has three sections, "My lists", "Kakao lists" and "Subscribed in Kakao", with per-list toggles, show all / hide all, and counts. The selection is remembered on the device.
- **Search-result markers** are drawn differently from saved ones.
- **"My location"** asks for permission only when tapped.
- **An accessible list view** of the visible places sits alongside the map. It is also what offline users see where tiles are missing.

### Language

- **Korean and English**, with Korean or English chosen from the browser language, and a switch on the account page (owner's decision).
- Every string goes through an i18n layer from the start. Dates are formatted for the locale (e.g. `2026년 11월 19일` / `Nov 19, 2026`).
- Kakao data (names, addresses, Kakao notes) is shown as it comes, without translation.

### Screens

- **Map.** The home screen: map, search bar, list picker, unsynced-changes indicator.
- **Place.**
  - Header: name, address, category, "Open in Kakao Map" (app link `kakaomap://place?id=`, web `https://place.map.kakao.com/<id>`).
  - **Diary**: an "Add visit note" button opens a text box with the date pre-set to today; entries are listed newest first.
  - **Links.**
  - **Lists**: membership chips; Kakao lists are read-only and show their Kakao note; own lists can be added or removed.
- **Lists.** All lists, then the places in one list. Own lists can be created, renamed, recoloured or deleted. Deleting a list never deletes places.
- **Import.** A button with the last run's summary and time.
- **Account.** As above.

### Ready for phase 2

- **Trips** will reference `places.id`. The stable client-generated ids and the place-centred diary are meant for that.
- **Sharing** will need list/trip membership by user. Nothing in this phase assumes one user per list beyond `user_id` scoping.
- **Google login** adds an `identities` row with provider `google`. The account page gets the link flow. No migration is needed.

## Decided by the owner

- Separate accounts, Kakao sign-in now, Google linking later.
- No sharing now.
- Kakao lists follow Kakao.
  - An import creates or updates them with new places and Kakao notes.
  - Own lists are separate.
  - `magomap`'s own notes and links are never affected by Kakao changes.
- Kakao notes are read-only. They come from the extension through `kakao-list`. Editing them directly is a later decision.
- `magomap` pulls from the `kakao-list` server.
- Offline behaviour as described. Writing notes at the place is the main case.
- Cloudflare, with the database behind a connector: SQLite (D1) or Postgres.
- Trips are phase 2.

- Subscribed Kakao lists are imported, read-only, in their own section.
- `kakao-list` local notes become diary entries without a date, marked "from kakao-list".
- The UI is in Korean and English.

## Designer's calls (open to correction)

- Kysely as the connector, with UUIDv7 ids generated on the client and integer timestamps.
- One Worker serves both the API and the PWA.
- Last-write-wins per row by client timestamp. Soft deletes everywhere.
- Removed-from-Kakao places are kept and marked, and restored if they reappear.
- Session length is 30 days, sliding.
- No photos in diary entries yet.
- The two `kakao-list` changes come first in the plan; `magomap` builds against a fake server until they land.
- The import contract has a `complete` flag, and removals are only marked from complete imports.
- Kakao-list markers use each favourite's Kakao colour.
- `kakao-list`'s own Kakao Maps account confirmation counts as proof of whose data it is.
- Sign-up is limited by an allowlist of Kakao ids.
- Place fields can't be edited, and there are no manual places.
- A diary entry written for a deleted place brings the place back.

## Left to the builder

- Exact UI styling. It should be light and calm and familiar to Kakao Map users, like `kakao-list`.
- Pagination sizes and debounce timings.
- The WCONGNAMUL → WGS84 conversion. This belongs in `kakao-list`; `magomap` receives lat/lng.
- Test tooling details beyond "both DB dialects are tested, and the sync and import rules have tests".
