# magomap extension

A small Chrome/Brave desktop extension (Manifest V3) for magomap's **Sync from Kakao Map**. When magomap's Account page asks, it reads her Kakao Map lists inside a signed-in `map.kakao.com` tab and hands the raw records to the page. It has no popup or screen of its own; all UI is in magomap.

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

- `start.folders` is the raw `/folder/list` records as received; `start.counts` has one `{ folderid, itemCount, firstDisplay2? }` per non-deleted folder.
- `favorites` holds every raw favourite of every non-deleted folder, all pages in page order, keyed by `String(folderid)`; `counts[].itemCount` is the folder's full count across pages.
- `kakao_signed_out`: Kakao Map isn't signed in in this browser (Kakao answers zero folders, an auth status, a redirect or an HTML page). Sign in at `map.kakao.com` and try again.
- `kakao_unavailable`: Kakao failed (5xx, network, an unexpected answer) or the tab couldn't be read. Nothing partial is returned.
- `busy`: a read is already running.

## Tests

```sh
pnpm --filter @magomap/extension test
```

The reader is ported from kakao-list's `apps/extension/src/kakaoMapsExtractor.ts` (kakao-list commit `730ee2d`): only the read path, with records returned unchanged.
