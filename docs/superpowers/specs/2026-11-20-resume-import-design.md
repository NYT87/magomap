# Resume a stopped import — design

Agreed with the owner on 2026-11-20. A small change to the server-driven kakao-list import (plan 03).

## Why

On 2026-11-20 his wife's import stopped after 12 of 30 lists, 37 seconds in, and nothing told her. The app drives the import one page at a time, so when the page stops asking (screen locked, app backgrounded, a request failing twice, an account switch) the run stays `running` forever. The only way forward today is to start again from list 1. She imports on her phone, often with large lists (up to 500 places), so this will happen again.

## Goals

1. When the last import stopped partway, the import section says so and offers **Continue**, which picks up at the first unfinished page.
2. Continuing gives the same result as one uninterrupted import: same summary rules, and nothing is marked removed unless every list finished.
3. Fewer stops in the first place: the screen stays on while an import runs.
4. **No pointless imports** (added by the owner): when the account's last completed import already used kakao-list's latest sync, importing is turned off and the section says the data is up to date, with the date of that kakao-list sync. Syncing in the kakao-list extension again turns it back on.

## Non-goals

- Continuing automatically when the app comes back to the foreground (approach B). It can be added on top later.
- Running the import on the server without the app (approach C).
- The coordinates problem: that was old kakao-list data, fixed by re-syncing kakao-list (no code).
- The Kakao Map direct sync (`2026-11-20-kakao-direct-sync-design.md`). That path isn't built yet. This change puts resume in the shared run bookkeeping and the app's import runner, so the direct sync can reuse it, but doesn't build it there.

## Anti-goals

- Continuing a run against **newer** kakao-list data than it started with: lists would mix two snapshots. That case starts a fresh import instead.
- Marking memberships removed after a continued run that skipped a list.
- A Continue button for a run of another account (the run belongs to the signed-in account; the account header check already guards every request).

## Approaches

- **A. A Continue button (chosen).** The app offers to continue an unfinished run; the server reports which lists and pages are done. Small, uses the existing `pages_done`/`finished` bookkeeping, and someone sees what's happening.
- B. A plus continuing automatically on return to the foreground. Smoother, but an unasked-for import is surprising, and two open devices would both drive one run. Left for later.
- C. Run the import on the server (Cloudflare Workflows). Survives a locked phone entirely, but new infrastructure and failure modes, for both the D1 and Postgres setups. Too big for the problem.

## Design

**What exists:** `import_run_lists` keeps `pages_done` and `finished` per list. Sending a page again is accepted (`importListChunk` allows any index up to `pages_done`). Starting a new run marks an open one `superseded`. `GET /api/import/runs/latest` already returns the latest run, `running` included.

**Server**
- New `POST /api/import/runs/:runId/resume` (behind `requireUser`). It loads the running run (`runningRun`, so a closed or someone else's run is `404`/`409 run_closed`), asks kakao-list for the current lists snapshot, and compares its `importedAt` with the run's `snapshot_at`. Different → `409 snapshot_changed`. Same → `200 { runId, lists: [{ externalId, name, itemCount, pagesDone, finished }] }`, in the run's list order.
- `ImportRunInfo` (from `GET /api/import/runs/latest` and `/import/status`) adds `snapshotAt`: the kakao-list sync date the run was read from. For a `running` run only, it also adds `progress: { listsDone, listCount }`, so the section can say how far it got without a second call.
- New `GET /api/import/status` (behind `requireUser`) answers `{ latest: ImportRunInfo | null, sourceSnapshotAt: number | null, upToDate: boolean }`. `sourceSnapshotAt` is the `importedAt` of kakao-list's current lists snapshot for the caller's Kakao id (`null` on `no_snapshot`; `502` when kakao-list is down). `upToDate` is true when the account has a `completed` run whose `snapshot_at` equals `sourceSnapshotAt`. The section uses this instead of `/runs/latest` (which stays for compatibility).
- `POST /api/import/runs` refuses with `409 up_to_date` when the same condition holds, so the rule holds even for an old app or two tabs. The check uses the snapshot it just fetched, so there's no extra kakao-list call.

**App (`runImport`)**
- Takes an optional run to continue. For each list: skip if `finished`; otherwise start at page `pagesDone`, then finish it. Then complete the run and sync, exactly as today.
- A `snapshot_changed` answer to resume starts a new import instead and says why.

**App (import section)**
- On load (online), ask `/api/import/status`. When `upToDate`: the import button is disabled and the section says "Up to date with your kakao-list sync of 20 Nov, 13:32. Sync in the kakao-list extension to import again." When kakao-list has no snapshot, today's "no snapshot" message shows up front instead of after pressing the button.
- When the latest run is `running` and this tab isn't running it, the section compares the run's `snapshotAt` with `sourceSnapshotAt` (added by the owner: a stopped import must know which kakao-list sync it came from):
  - **Same sync:** "The last import stopped at 12 of 30 lists." with **Continue** (primary) and **Start over** (secondary). Start over is today's import, which supersedes the open run.
  - **kakao-list has a newer sync:** no Continue. "The last import stopped, and kakao-list has a newer sync from 21 Nov, 09:10." with **Import** only, which starts a fresh run (superseding the stopped one).
  - **kakao-list unreachable:** Continue and Start over are both shown. The resume call still checks the sync, so a newer one falls back to a fresh import.
- Progress while continuing counts from the lists already done (13 of 30, not 1 of 18).
- While an import runs, hold a screen wake lock (`navigator.wakeLock.request("screen")`) and release it when it ends; re-acquire on `visibilitychange` if the page comes back during the run. Where the API is missing it's skipped silently.
- Korean and English text for the new note, buttons and the "kakao-list has newer data, starting a fresh import" message.

## Builder's calls

- Two devices pressing Continue on the same run: pages are idempotent and the second `complete` gets `run_closed`. Accepted as harmless; the loser shows the existing "changed" error.
- "Up to date" means the same snapshot **and** a completed run. A run that stopped, was superseded or failed on that snapshot doesn't count, so Continue or Start over stay available.
- No "import anyway" override. Re-importing the same snapshot changes nothing (places, notes and memberships come out the same), so there is nothing to gain from it. If a real need appears, an override can be added.
- If kakao-list is unreachable when the section loads, the button stays enabled and the server's check at start still applies.
- No age limit on continuing: an old open run can be continued as long as kakao-list's snapshot hasn't changed.
- Tests: the store/route for resume (matching snapshot, changed snapshot, closed run, other user's run), `runImport` skipping finished lists and starting mid-list, the `up_to_date` refusal and `/import/status` (completed on the same snapshot, stopped on the same snapshot, newer snapshot, no snapshot), and the section's states: stopped on the same sync (Continue / Start over), stopped with a newer sync (Import only), and up to date. Follows `docs/superpowers/build-process.md`.
