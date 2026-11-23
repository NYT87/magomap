# magomap extension

A small Chrome/Brave desktop extension (Manifest V3) for magomap's **Sync from Kakao Map**. When magomap asks, it reads her Kakao Map lists inside a signed-in `map.kakao.com` tab and hands the records, trimmed to the fields magomap reads, to the page; and, when she asks magomap to copy a list to Kakao Map, it creates that list and adds the places (see "Writing a list"). It has no popup or screen of its own; all UI is in magomap.

- Permissions: `scripting`, and host access to `https://map.kakao.com/*` only. No `tabs` permission: the host permission is enough to find, open and close `map.kakao.com` tabs and see their url, status and last use.
- Only magomap's own pages can talk to it (`externally_connectable`, and the same list checked against `sender.origin`). The **release build** allows only `https://magomap.jmn8718.workers.dev`. The **dev build** also allows `http://localhost:5173` and `http://localhost:8787`. Both lists come from `src/origins.ts`.
- It uses the most recently used `map.kakao.com` tab, skipping tabs Memory Saver discarded. If there is none, it opens one in the background, reads, and closes it again.
- It reads every page of each folder: Kakao sends a folder's favourites at most 500 per page, with a `next_id` for the next one, and the extension follows it (`/favorite/mine/list?folderid=X&next_id=…`) until there is none. A repeating `next_id`, an empty later page that still has one, or more than 50 pages in a folder is refused as `kakao_unavailable`.
- Each Kakao request (each page too) times out after 30 s and the whole read after 5 minutes. A read over 2000 folder records or 50,000 favourites is refused as `kakao_unavailable`.
- It never logs what it reads, and it sends no cookies anywhere: the read happens in the Kakao Map page, and the records go only to the magomap page that asked.

## Extension id

```
eccgkehfioodkgllihgbgkgfcifmghif
```

The id is fixed by the public `key` in `manifest.json`, so it is the same on every computer and for every unpacked load. magomap's web app uses it to reach the extension. `src/extensionId.ts` holds the same value, and a test recomputes it from the key (sha256 of the key, first 32 hex digits, `0-f` written as `a-p`).

### The key

- `manifest.json` holds only the **public** key (base64 DER).
- The matching private key is **not** in the repo and is not needed to load the extension unpacked. It was generated on the owner's computer at `~/.config/magomap/extension-key.pem`.
- It is only needed to pack a `.crx` with this same id ("Pack extension" in `chrome://extensions`, with that file as the private key). Keep it there, or in a password manager, and never commit it. If it is lost, unpacked loading still works with the same id; only packing with this id needs it.

## Build and load it unpacked

```sh
pnpm --filter @magomap/extension build       # release build, production magomap only → apps/extension/dist/
pnpm --filter @magomap/extension build:dev   # dev build, also localhost:5173 and :8787 → apps/extension/dist/
pnpm --filter @magomap/extension bundle      # release build, then apps/extension/magomap-extension.zip
```

Both builds write `dist/` and have the same id. For local development (magomap on `http://localhost:5173` or `:8787`), load the **dev build**. For everyday use, load the **release build** (or the zip): it doesn't answer pages on localhost, so no other local program can read her lists through it. Rebuild with `build` before going back to everyday use.

1. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/dist`.
3. Check that the id shown is `eccgkehfioodkgllihgbgkgfcifmghif`.
4. From the magomap page's console (production with the release build, `http://localhost:5173` with the dev build):

   ```js
   chrome.runtime.sendMessage("eccgkehfioodkgllihgbgkgfcifmghif", { type: "magomap.ping" }, console.log)
   // { ok: true, version: "0.1.0" }
   ```

5. **Real-browser check (owner):** with Kakao Map signed in, send `{ type: "magomap.read" }` the same way and check it answers `ok: true` with her folders, both with a `map.kakao.com` tab open and with none (it should open and close one). This confirms reads work without the `tabs` permission, which the unit tests can't. Then sign out of Kakao Map and check it answers `kakao_signed_out`.

## Messages

| Sent by the page           | Answer                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `{ type: "magomap.ping" }` | `{ ok: true, version }`                                                                                                                 |
| `{ type: "magomap.read" }` | `{ ok: true, start: { folders, counts }, favorites }`, or `{ ok: false, error }` with `kakao_signed_out`, `kakao_unavailable` or `busy` |

- `start.folders` is the `/folder/list` records as received, each keeping only the fields magomap reads (`packages/domain/src/providers/kakaoMapFields.ts`; values unchanged, anything that isn't a record sent as `null`); `start.counts` has one `{ folderid, itemCount, firstDisplay2? }` per non-deleted folder.
- `favorites` holds every favourite of every non-deleted folder, likewise trimmed (a route's waypoints never leave the page), all pages in page order, keyed by `String(folderid)`; `counts[].itemCount` is the folder's full count across pages.
- `kakao_signed_out`: Kakao Map isn't signed in in this browser (Kakao answers zero folders, an auth status, a redirect or an HTML page). Sign in at `map.kakao.com` and try again.
- `kakao_unavailable`: Kakao failed (5xx, network, an unexpected answer) or the tab couldn't be read. Nothing partial is returned.
- `busy`: a read or a write is already running (one job at a time).

### Writing a list (for "Copy to Kakao Map")

These write to **her own** Kakao Map, inside the `map.kakao.com` tab, with the requests the Kakao Map page sends (`docs/kakao-map-access.md`, section 7). magomap checks `magomap.account` against the account linked to her magomap account before any write.

| Sent by the page                                                          | Answer                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ type: "magomap.account" }`                                             | `{ ok: true, folders }`: her `/folder/list` records, trimmed to the fields magomap reads. magomap decides whose account is signed in with the same rule as the sync (the domain's Kakao Map adapter), not the extension |
| `{ type: "magomap.createList", name }` (1 to 100 characters)              | `{ ok: true, folderId }`                                                                                                                                                                                                |
| `{ type: "magomap.addPlaces", folderId, places }` (1 to 100 places)       | `{ ok: true, added, skipped }`; `skipped` places were already in the list (or were sent twice), so a retry adds nothing twice                                                                                           |
| `{ type: "magomap.setColor", folderId, key, color }` (`color` two digits) | `{ ok: true }` once Kakao Map shows the new colour (the favourite is read fresh, sent back with only `color` changed, then read again), or `{ ok: false, error: "not_found" }` when the place isn't in that list        |
| `{ type: "magomap.setNote", folderId, key, note }` (`note` up to 5000 characters, may be empty) | `{ ok: true }` once Kakao Map shows the new note (the favourite is read fresh, sent back with only `memo` changed, then read again); an empty `note` clears it; `{ ok: false, error: "not_found" }` when the place isn't in that list. Nothing is sent if the favourite's title, address or current note can't be read as text |

- A place is `{ key, title, address, x, y, color? }`: Kakao's place id (digits), the two lines Kakao Map shows, and Kakao's own `x`/`y` (WCONGNAMUL, whole numbers). Nothing else is sent.
- A failure is `{ ok: false, error }` with `kakao_signed_out`, `kakao_unavailable`, `busy`, or `invalid` (input refused before anything is sent). `addPlaces` failures may carry `added`: how many went in before it stopped. Without it, read the list again.
- The page sends 20 places per request to Kakao Map. Kakao's own maximum isn't known, so that size is cautious.
- A new list is created the way the page creates one (`status: "P"`, `icon: 10`). What `P` means for who can see the list isn't known: check a new list's visibility in Kakao Map.
- A write stops by itself after 90 seconds (the worker waits 120), so a retry never runs beside one that is still going. If `createList` times out after Kakao has made the list, the answer has no `folderId` and a retry makes a second list: look for a list with the same name first.
- Each write picks the most recently used `map.kakao.com` tab. Check `magomap.account` right before writing; Chrome doesn't run extensions in incognito windows unless she allows it for this one.

### Real-browser check of the writes (owner)

With Kakao Map signed in, on a throwaway list only (all six from the page's console, as for `ping`, with the extension id from step 4):

1. `{ type: "magomap.account" }` answers `ok: true` with her folders (no title or place data beyond the trimmed fields).
2. `{ type: "magomap.createList", name: "magomap test" }` answers `ok: true, folderId`; the list appears in Kakao Map. Check its visibility there.
3. `{ type: "magomap.addPlaces", folderId, places: [{ key: "1063803587", title: "청라창해문화공원", address: "인천 서해구 청라동 155-19", x: 421032, y: 1120559 }] }` answers `added: 1`; send it again and it answers `added: 0, skipped: 1`.
4. Change one of those places' colour in Kakao Map: `{ type: "magomap.setColor", folderId, key: "1063803587", color: "05" }` answers `{ ok: true }`, and the place shows blue in Kakao Map.
5. Change a place's Kakao note: `{ type: "magomap.setNote", folderId, key: "1063803587", note: "test note" }` answers `{ ok: true }` and Kakao Map shows the note (title, address and colour unchanged). Send `note: ""` and the note is gone. Check what Kakao does with a very long note and with line breaks (the read-back ignores line-break style and edge spaces).
6. Try a larger `places` list (for example 30, then 100 places) to see that Kakao accepts the batches, then delete the test list in Kakao Map.

## Tests

```sh
pnpm --filter @magomap/extension test
```

The reader is ported from kakao-list's `apps/extension/src/kakaoMapsExtractor.ts` (kakao-list commit `730ee2d`): only the read path, with records returned unchanged but for the fields magomap doesn't read.
