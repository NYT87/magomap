# Reading Kakao Map — access test results

Phase 0 of the direct Kakao Map sync (`docs/superpowers/specs/2026-11-20-kakao-direct-sync-design.md`). These are the results of tests run on 2026-11-20 with the owner's account, signed in on his computer. The tests used throwaway scripts that are not kept in the repo. No cookie, token or list contents are recorded here.

**Verdict:** `Phone sync: cookie, pending the Worker read and the 7-day lifetime check`. The Kakao Login token route is closed. `seq` matches across accounts (section 6), so the mapping work can go ahead.

## Endpoints

Undocumented `map.kakao.com` endpoints, also described in `kakao-list/docs/kakao-maps-private-api.md`:

- `GET /folder/list` returns `200 { status: { code: "SUCCESS" }, folders: [...] }`. It lists every folder, including folder 0.
- `GET /favorite/mine/list?folderid=<id>` returns the favourites of one folder.

## 1. The Kakao Login token

Both endpoints answered **403 HTML** with `Authorization: Bearer <access token>` from a real magomap sign-in (scope `openid`). The same happened for `/favorite/timestamp`. The token magomap gets at sign-in doesn't open Kakao Map, so it can't be used for phone sync.

## 2. The Kakao Map cookie (from the owner's computer)

- **One cookie is enough: `_kawlt`**, the Kakao account web login token, set on `.kakao.com`. Taking the other cookies away one at a time changed nothing.
- **Headers.** From a plain HTTP client, Kakao answers 403 HTML even with the cookie, unless the request also carries browser-like headers: `User-Agent`, `Referer: https://map.kakao.com/`, and `Origin` and `Sec-Fetch-*`. Inside a `map.kakao.com` tab (the extension) the browser sends these itself.
- **Signed out is a success, not an error.** Without the cookie, `/folder/list` answers **200 SUCCESS with zero folders**. A reader must treat zero folders as "signed out". Treating it as "every list was deleted" would mark every list removed.
- With the cookie, the owner's account showed 29 folders: 2 with `status: "D"` (deleted) and 23 flagged with `subscribe`.
- **Not tested yet:** the same requests from Cloudflare's network (a throwaway Worker). Kakao might block or challenge data-centre addresses.

## 3. Lifetime

- `_kawltea`, the cookie's stated expiry, was 2026-11-20 20:00 KST, about 10 hours after it was copied.
- After that time, the same `_kawlt` still read all 29 folders, so the session outlives its stated expiry.
- **Not tested yet:** reads after 1, 3 and 7 days without opening Kakao Map.

## 4. Phone edits reaching the web

Not tested yet.

## 5. Data details

### Coordinates

- Favourites carry `x`/`y` in WCONGNAMUL, which is EPSG:5181 scaled by 2.5. Some newer ones also carry Kakao's own **`lat` and `lon` (WGS84)**. Older ones have only `x`/`y`. Use `lat`/`lon` when present, and convert `x`/`y` otherwise.
- proj4 `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs`, applied to `(x / 2.5, y / 2.5)`, matches Kakao's numbers within 3e-9°. Fixtures in `packages/domain/src/providers/wcongnamul.fixtures.ts`:

  | x | y | lat | lng | source of lat/lng |
  |---|---|---|---|---|
  | 471350 | -32433 | 33.37661909 | 126.87684594 | the favourite's own `lat`/`lon` (Jeju) |
  | 608064 | 1159067 | 37.67127631 | 127.48995646 | Kakao's place-detail endpoint |

- **Negative `y` is valid**: places south of about 33.5°N (southern Jeju) have one. kakao-list used to drop such coordinates; its PR #29 fixed that.

### Folder 0

Folder 0 is **each person's default favourites list**, and `/folder/list` includes it. Every Kakao user has their own folder 0, so magomap gives it a per-person list id, `0~<Kakao Login id>` (`kakaoListExternalId`).

### Favourite types

| type | key | in magomap |
|---|---|---|
| `PLACE` | Kakao place id | a place |
| `ADDRESS` | an address docid (`N…` or `J…`) | a place (kakao-list's `MAGOMAP_PLACE_TYPES`) |
| `POINT` | none | a pin at its own coordinates |
| `ROUTE_BICYCLE` | none, and no `x`/`y` (waypoints in `route_form`) | a list item with no pin |

`memo` is missing on some favourites.

### Owner ids

Folder records carry `map_user_id`, but not always `kakao_map_user_id`. The own account is `kakao_map_user_id || map_user_id` of the folders not flagged with `subscribe`, as in kakao-list's extractor.

### Other endpoints, not used

- `/api/v1/mapsearch/srcid?id=<place key>` (place detail) gives lat/lon, category (`cate_name_depth1..3`), `tel` and `new_address`. It could fill in places later, through the extension only.
- `/api/v1/mapsearch/search_addr?docid=…` (address lookup) answers `403 Gate Token Rejected` outside the Kakao Map page.

## 6. Two accounts, one folder (2026-11-21)

Read in each account's own signed-in tab with a console snippet (no cookie copied). Only folder ids, `seq` numbers and place keys were compared.

- **`seq` is the same for both readers.** Folder `16499871` (hers; he follows it): 500 favourites in both accounts, and the first 8 `[seq, key]` pairs are identical. Memberships can stay keyed by `seq`.
- **Owner ids** are filled for every folder of her own account (`kakao_map_user_id` or `map_user_id`), and `subscribe` is `1` only on folders she follows.
- **Followed folders can come back bare.** In his account about a dozen followed folders (for example `2052505`, "Jeju" in hers) have **no title and no owner id**, only `folderid` and `subscribe: 1`. Probably lists the owner has since made private. A reader must never treat such a folder as the reader's own, and must cope if its favourites can't be read. While kakao-list runs beside the direct sync, its fallback name (`Folder <id>`) is kept so both sources name the list the same way.
- **Favourites come in pages of 500.** `/favorite/mine/list?folderid=X` (and `/favorite/list`) return `{ favorites: [...up to 500], next_id }`; Kakao Map's own page then asks for `...&next_id=<next_id>` until there is no `next_id`. Her folder `2869579` ("Seúl 0") has more than 500, and a place on its second page (돌솥추어탕) never reached kakao-list or magomap, because both read only the first page. A reader must follow `next_id` (correcting an earlier note that a list holds at most 500 places).

## 7. Writing a list (2026-11-23)

Captured from Kakao Map's own page in the owner's browser (a sanitized HAR: no cookies or tokens), while creating a list, adding one place to it, removing the place and deleting the list. Each call is a same-origin `POST` from the page with `content-type: application/json` and `x-requested-with: XMLHttpRequest`, and the signed-in cookie. **No gate token** is involved (the gate token is only for `/api/v1/mapsearch/*`). Every answer is `200` with `{ "status": { "code": "SUCCESS" }, … }`. A write from the extension must run inside a `map.kakao.com` tab, as the reads do.

| Step | Request | Body | Answer |
|---|---|---|---|
| Create a list | `POST /folder/add` | `{ "title": "test-list", "memo": "test list har", "out_link": "", "icon": 10, "status": "P" }` | `req.folderid` (a number, e.g. `25038639`), `req.map_user_id`, `req.status`, `req.title`, `req.memo`, `req.icon` |
| Add places | `POST /favorite/add` | `{ "datas": [ { "type": "place", "key": 1063803587, "display1": "청라창해문화공원", "display2": "인천 서해구 청라동 155-19", "x": 421032, "y": 1120559, "color": "03", "memo": "", "folderid": 25038639 } ] }` | `data[i].status.code` per place, `data[i].req.seq` (the new favourite's `seq`), echoing `type: "PLACE"`, `key` as a string, `x`, `y`, `color`, `folderid` |
| Remove a place | `POST /favorite/remove` | `{ "seqs": [1234147931] }` | `data[i].req.seq`, and the removed favourite |
| Delete a list | `POST /folder/delete` | `{ "folderids": [25038639] }` | `data[i].req.folderid` |
| Read a list back | `GET /favorite/mine/list?folderid=<id>` | | `{ favorites: [...] }`, as in section 6 |

What the capture shows:
- **A list is identified by `req.folderid`** in the create answer. `status: "P"` and `icon: 10` are what the page sent for a new list; `memo` and `out_link` may be empty.
- **`/favorite/add` takes an array** (`datas`), so several places can go in one request. Only single places were captured, so the largest batch Kakao accepts is **not known**: the extension must test it on a throwaway list before choosing a page size, and fall back to smaller batches.
- **A place is added by its Kakao place key** (`key`, the same id as `p_kakao_<key>`), with the title (`display1`), the address (`display2`) and Kakao's own coordinates (`x`, `y`). `color` is the Kakao colour code: the page sent `03` and `06` for two adds (the first is the default). `memo` is the note and may be empty. `type` is lowercase in the request (`"place"`) and uppercase in the answer.
- **`x` and `y` are WCONGNAMUL** (section 5), and magomap stores WGS84. The conversion reproduces the capture exactly: lat `37.53297188`, lon `126.64262495` → x `421032`, y `1120559` (proj4 forward on the section 5 definition, times 2.5, rounded).
- **Adding the same place twice** was not captured. The extension reads the list first and adds only the keys that aren't there.
- **Cleanup calls exist** (`/favorite/remove`, `/folder/delete`), which tests against a throwaway list can use.
- A place that has no Kakao place key (a custom pin, an address favourite) has no `type: "place"` request in this capture, so it is left out of a copy.

## 8. Changing a favourite's colour (2026-11-23)

Captured from the owner's browser (a place's colour changed from the colour picker on `map.kakao.com`):

| What | Request | Body | Answer |
|---|---|---|---|
| Update a favourite | `POST /favorite/update` | `{ "datas": [ { "seq": 1119211517, "display1": "<title>", "display2": "<address>", "color": "07", "memo": "racing cafe z" } ] }` | `status.code: "SUCCESS"`, `data[i].status.code`, `data[i].req` (the stored favourite: `seq`, `type`, `display1`, `display2`, `memo`, `color`), `data[i].last_updated_at` (`"2026-11-23 17:53:01"`) |

- The favourite is named by its **`seq`** (not its place key), so a colour change reads the list first to find the `seq`.
- The page sends **the whole editable record** (`display1`, `display2`, `memo`, `color`), not only the colour: a colour change must send the favourite's current `memo`, `display1` and `display2` back unchanged, or the note could be cleared.
- It works the same for an `ADDRESS` favourite (the answer's `type` is `ADDRESS`).
- Colour codes seen: `01`, `06`, `07`.

## Still open

- Phone edits reaching the endpoint (step 4).
- The read from a Worker and the multi-day lifetime, both needed before phase 2 (phone sync).
