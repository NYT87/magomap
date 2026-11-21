# magomap extension

A small Chrome/Brave desktop extension (Manifest V3) for magomap's **Sync from Kakao Map**. When magomap's Account page asks, it reads her Kakao Map lists inside a signed-in `map.kakao.com` tab and hands the raw records to the page. It has no popup or screen of its own; all UI is in magomap.

- Permissions: `scripting`, `tabs`, and host access to `https://map.kakao.com/*` only.
- Only magomap's own pages can talk to it (`externally_connectable`): `https://magomap.jmn8718.workers.dev`, and `http://localhost:5173` and `http://localhost:8787` for local development.
- It uses the most recent `map.kakao.com` tab. If none is open, it opens one in the background, reads, and closes it again.
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
pnpm --filter @magomap/extension build    # writes apps/extension/dist/
pnpm --filter @magomap/extension bundle   # also writes apps/extension/magomap-extension.zip for a release
```

1. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/dist`.
3. Check that the id shown is `eccgkehfioodkgllihgbgkgfcifmghif`.
4. From the magomap page's console (production or `http://localhost:5173`):

   ```js
   chrome.runtime.sendMessage("eccgkehfioodkgllihgbgkgfcifmghif", { type: "magomap.ping" }, console.log)
   // { ok: true, version: "0.1.0" }
   ```

## Messages

| Sent by the page           | Answer                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `{ type: "magomap.ping" }` | `{ ok: true, version }`                                                                                                                 |
| `{ type: "magomap.read" }` | `{ ok: true, start: { folders, counts }, favorites }`, or `{ ok: false, error }` with `kakao_signed_out`, `kakao_unavailable` or `busy` |

- `start.folders` is the raw `/folder/list` records as received; `start.counts` has one `{ folderid, itemCount, firstDisplay2? }` per non-deleted folder.
- `favorites` holds every raw favourite of every non-deleted folder, keyed by `String(folderid)`.
- `kakao_signed_out`: Kakao Map isn't signed in in this browser (Kakao answers zero folders, an auth status, a redirect or an HTML page). Sign in at `map.kakao.com` and try again.
- `kakao_unavailable`: Kakao failed (5xx, network, an unexpected answer) or the tab couldn't be read. Nothing partial is returned.
- `busy`: a read is already running.

## Tests

```sh
pnpm --filter @magomap/extension test
```

The reader is ported from kakao-list's `apps/extension/src/kakaoMapsExtractor.ts` (kakao-list commit `730ee2d`): only the read path, with records returned unchanged.
