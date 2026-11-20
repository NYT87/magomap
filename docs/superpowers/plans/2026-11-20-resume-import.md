# Continue a stopped import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** An import that stopped partway can be continued from the page it reached while kakao-list still has the same sync; a newer kakao-list sync starts a fresh import instead; an account already imported from kakao-list's latest sync can't import again.

**Architecture:**
- The run bookkeeping that exists (`import_runs.snapshot_at`, `import_run_lists.pages_done`/`finished`) is enough; no migration.
- `packages/db/src/stores/importRuns.ts` gains three reads: run progress, "already imported this sync", and richer `latestImportRun`.
- `apps/api/src/import/routes.ts` gains `GET /import/status` and `POST /import/runs/:runId/resume`, and `POST /import/runs` refuses an already-imported sync.
- In the app, `runImport` can continue a run, a small `wakeLock.ts` keeps the screen on, and `ImportSection` picks between Import, Continue / Start over, and Up to date.

**Tech Stack:** Hono on Cloudflare Workers, Kysely (D1 + Postgres), zod, React 19, i18next (ko/en), Vitest + Testing Library, msw (API tests).

**Spec:** `docs/superpowers/specs/2026-11-20-resume-import-design.md`

## Global Constraints

- **Strings:** every new string exists in both `apps/web/src/i18n/ko.json` and `en.json`, under `import.*`.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh` must PASS. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Protected paths:** `scripts/`, `biome.json`, `tsconfig.base.json`, `docs/superpowers/**` except this plan.
- **Both databases:** store tests run under `forEachDialect` (SQLite/D1 and Postgres).
- **Account scoping:** every new route sits behind `requireUser`; every new store read filters by `user_id`.
- **"Up to date"** = the account has an `import_runs` row with `status = 'completed'` and `snapshot_at` equal to kakao-list's current lists snapshot `importedAt` (epoch ms). A stopped, superseded or failed run on that snapshot does not count.
- **No "import anyway" override** (spec: builder's call).
- **Commits:** on branch `feat/resume-import`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A completed run, then the same kakao-list sync:** Import is disabled and `POST /import/runs` answers `409 up_to_date` — but after kakao-list syncs again (new `importedAt`) importing works. (Task 2 tests both.)
2. **Stopped run, then kakao-list syncs again:** the section shows Import only, never Continue; and a stale app calling `/resume` gets `409 snapshot_changed`, after which `runImport` starts fresh. (Tasks 2 and 3.)
3. **Continue skips finished lists but redoes a half-done list from `pagesDone`**, and the progress text counts from the lists already done ("13 of 30"). (Task 3.)
4. **kakao-list unreachable when the section loads:** the button stays enabled, Continue and Start over both show, nothing claims "up to date". (Task 4.)
5. **Existing API tests that import the same fixture twice** would now hit `up_to_date`. They must be changed to bump the fixture's `importedAt` for the second import (an honest change, not a weakening), never by removing assertions. (Task 2.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Store reads | code |
| 2 Routes | code, security |
| 3 runImport and wake lock | code |
| 4 Import section | code, ui, ux, a11y |

---

### Task 1: Store reads for progress and "already imported"

**Files:**
- Modify: `packages/domain/src/api.ts` (types)
- Modify: `packages/db/src/stores/importRuns.ts` (`latestImportRun` near line 791; new functions next to `runSnapshot`)
- Test: `packages/db/src/stores/importRuns.test.ts`

**Interfaces:**
- Produces, in `packages/domain/src/api.ts`:
  ```ts
  export interface ImportRunInfo {
    runId: string;
    status: "running" | "completed" | "failed" | "superseded";
    startedAt: number;
    finishedAt: number | null;
    summary: ImportSummary | null;
    /** The kakao-list sync (epoch ms) the run was read from. */
    snapshotAt: number;
    /** Only on a running run. */
    progress?: { listsDone: number; listCount: number };
  }
  export interface ImportStatus {
    latest: ImportRunInfo | null;
    /** kakao-list's current sync for this account; null when it has none or couldn't be reached. */
    sourceSnapshotAt: number | null;
    upToDate: boolean;
  }
  export interface ResumeList { externalId: string; name: string; itemCount: number; pagesDone: number; finished: boolean }
  export interface ResumeRun { runId: string; lists: ResumeList[] }
  ```
  and `"up_to_date"` added to `ApiErrorCode`.
- Produces, in `importRuns.ts`:
  - `latestImportRun(db, userId)` — now also fills `snapshotAt` and, for `running`, `progress` (`listsDone` = rows with `finished = 1`).
  - `runProgress(db: Db, userId: string, runId: string): Promise<{ snapshotAt: number; lists: ResumeList[] }>` — throws `RunNotFoundError` / `RunClosedError` via `runningRun`; lists in `position` order.
  - `importedSnapshot(db: Db, userId: string, snapshotAt: number): Promise<boolean>` — the "up to date" rule from Global Constraints.

- [ ] **Step 1: Write the failing tests** (inside `forEachDialect`, using the file's existing testkit helpers to start, page and complete runs)
  - `latestImportRun reports the snapshot and, while running, how many lists are done`: start a run with 3 lists, finish 1 → `{ status: "running", snapshotAt: <run's snapshot>, progress: { listsDone: 1, listCount: 3 } }`; after completing all → `progress` is `undefined`.
  - `runProgress gives each list's pages done and finished flag, in order`: one list finished, one with `pagesDone: 1` of 2 pages, one untouched → exactly those values; a completed run → rejects `RunClosedError`; another user's run id → rejects `RunNotFoundError`.
  - `importedSnapshot is true only for a completed run on that snapshot`: running run on S → false; completed on S → true; completed on S, asked for S+1 → false; another user's completed run on S → false; superseded run on S → false.
- [ ] **Step 2: Run** `pnpm --filter @magomap/db test -- importRuns` — Expected: the new tests FAIL (functions missing / fields undefined).
- [ ] **Step 3: Implement** the types and the three functions as specified above.
- [ ] **Step 4: Run** the same command with `TEST_DATABASE_URL` set — Expected: PASS on both dialects; then `pnpm -r typecheck` passes (callers of `ImportRunInfo` still compile).
- [ ] **Step 5: Commit** `feat(db): read an import run's progress and whether a sync was already imported`

### Task 2: Routes — status, resume, and refusing an imported sync

**Files:**
- Modify: `apps/api/src/import/routes.ts`
- Test: `apps/api/test/import.test.ts`

**Interfaces:**
- Consumes: `latestImportRun`, `runProgress`, `importedSnapshot` (Task 1); existing `kakaoIdentity`, `fromKakaoList`, `kakaoListsToImport`, `handled`.
- Produces:
  - `GET /api/import/status` → `200 ImportStatus`. `sourceSnapshotAt = Date.parse(snapshot.importedAt)`; `no_snapshot` and `kakao_list_unavailable` both give `sourceSnapshotAt: null, upToDate: false` (never an error status, so the section always renders).
  - `POST /api/import/runs/:runId/resume` → `200 ResumeRun`; `409 snapshot_changed` when kakao-list's current `importedAt` ≠ the run's `snapshotAt`; `404 not_found` / `409 run_closed` from `runProgress`; `404 no_snapshot` / `502 kakao_list_unavailable` from kakao-list.
  - `POST /api/import/runs` → `409 { error: "up_to_date" }` when `importedSnapshot(userId, Date.parse(snapshot.importedAt))`, checked before `startImportRun` (so the open run is not superseded).

- [ ] **Step 1: Write the failing tests** (use the file's `serveKakaoList`, `start`, `devLogin`)
  - `status says up to date only after a completed import of kakao-list's current sync`: before any import → `{ latest: null, sourceSnapshotAt: Date.parse("2026-11-19T00:00:00.000Z"), upToDate: false }`; after a full import → `upToDate: true`, `latest.status: "completed"`.
  - `status survives kakao-list being down`: lists endpoint returns 500 → `200 { sourceSnapshotAt: null, upToDate: false }`.
  - `a new import of an already-imported sync is refused`: full import, then `start` again → `409 { error: "up_to_date" }`; then serve the contract with `importedAt: "2026-11-20T00:00:00.000Z"` → `start` answers 200.
  - `resume returns each list's progress while the sync is unchanged`: start, import page 0 of list 101 and finish it → resume answers `lists[0]` `{ externalId: "101", pagesDone: 1, finished: true }` and the other lists `pagesDone: 0, finished: false`.
  - `resume refuses when kakao-list has synced since`: start, then serve a contract with a newer `importedAt` → `409 { error: "snapshot_changed" }`.
  - `resume refuses another account's run`: start as "111", resume as "222" → 404.
  - Fix existing tests that import the same fixture twice after a completed run (Review Focus 5) by bumping `importedAt` for the second import.
- [ ] **Step 2: Run** `pnpm --filter @magomap/api test -- import` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the two routes and the refusal in `apps/api/src/import/routes.ts`; map the refusal through `handled` with a new `UpToDateError` → `409 up_to_date`.
- [ ] **Step 4: Run** the same command — Expected: PASS, including every pre-existing import test.
- [ ] **Step 5: Commit** `feat(api): import status, continuing a run, and refusing a sync already imported`

### Task 3: `runImport` continues a run; the screen stays on

**Files:**
- Modify: `apps/web/src/import/runImport.ts`
- Create: `apps/web/src/import/wakeLock.ts`
- Test: `apps/web/src/import/runImport.test.ts`, Create: `apps/web/src/import/wakeLock.test.ts`

**Interfaces:**
- Consumes: `POST /api/import/runs/:runId/resume` → `ResumeRun` (Task 2).
- Produces:
  - `runImport(onProgress: (p: { listIndex: number; listCount: number }) => void, opts?: { resumeRunId?: string; onFreshStart?: () => void }): Promise<ImportSummary>`. With `resumeRunId`: post `/resume`; on `ApiError` code `snapshot_changed` or `run_closed`, call `onFreshStart` and do today's fresh start; otherwise skip `finished` lists, start each other list at page `pagesDone`, then finish, complete and `syncNow()` as today. `listIndex` is the list's index in the whole run, so progress reads 13 of 30 when 12 were done. Resume errors other than those two throw `ImportError("start", code)`.
  - `holdScreenOn(): () => void` in `wakeLock.ts`: requests `navigator.wakeLock.request("screen")` when available, re-requests on `visibilitychange` to visible while held, and the returned function releases it and removes the listener. Missing API or a rejected request is ignored silently.

- [ ] **Step 1: Write the failing tests** (extend the fake `server` in `runImport.test.ts` to answer `/resume`)
  - `continues a run: skips finished lists and starts a half-done list at its next page`: resume answers lists A finished, B `pagesDone: 1` of 3 pages (`itemCount: 1200`), C untouched → calls are exactly `/resume`, B pages 1 and 2, B finish, C page 0, C finish, complete; no `/api/import/runs` start; `syncNow` called once.
  - `counts progress from the lists already done`: same run → first `onProgress` is `{ listIndex: 1, listCount: 3 }`.
  - `starts fresh when kakao-list synced since the run stopped`: `/resume` throws `ApiError(409, { error: "snapshot_changed" })` → `onFreshStart` called once, then the normal start/page/finish/complete sequence.
  - `wakeLock.test.ts`: with a fake `navigator.wakeLock` → one request on hold, a second after `visibilitychange` to visible, `release()` called by the returned function and no request after it; without `navigator.wakeLock` → `holdScreenOn()` returns a function and doesn't throw.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- runImport wakeLock` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** the same command — Expected: PASS, including the existing `runImport` tests unchanged.
- [ ] **Step 5: Commit** `feat(web): continue a stopped import and keep the screen on while importing`

### Task 4: Import section — Continue, Start over, Up to date

**Files:**
- Modify: `apps/web/src/import/ImportSection.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/ko.json`
- Create: `apps/web/src/import/ImportSection.test.tsx`

**Interfaces:**
- Consumes: `GET /api/import/status` → `ImportStatus` (Tasks 1–2); `runImport(onProgress, { resumeRunId, onFreshStart })` and `holdScreenOn()` (Task 3).
- Produces: the section's states (spec "App (import section)"):
  - `upToDate` → button disabled, `import.upToDate` note with the sync date.
  - latest `running`, `sourceSnapshotAt` equal to its `snapshotAt` → `import.stopped` note, **Continue** (primary) and **Start over** (secondary).
  - latest `running`, `sourceSnapshotAt` different and not null → `import.stoppedNewer` note, **Import** only (fresh).
  - latest `running`, `sourceSnapshotAt` null → Continue and Start over.
  - otherwise today's behaviour. The status is re-read after an import ends (done or failed).
  - `holdScreenOn()` is held from start to end of any import.

New English strings (Korean equivalents written in the same plain tone as the existing `import.*` keys):
```json
"continue": "Continue import",
"startOver": "Start over",
"stopped": "The last import stopped at {{done}} of {{total}} lists.",
"stoppedNewer": "The last import stopped, and kakao-list has a newer sync from {{date}}.",
"upToDate": "Up to date with your kakao-list sync of {{date}}. Sync in the kakao-list extension to import again.",
"freshStart": "kakao-list has a newer sync, so the import started again from the beginning."
```
Dates use the existing `formatDate`.

- [ ] **Step 1: Write the failing tests** (mock `apiFetch` like `runImport.test.ts`; render `<ImportSection />` with i18n in English)
  - `turns importing off when the last import used kakao-list's latest sync`: status `upToDate: true` → the import button is disabled and the up-to-date text with the date is shown.
  - `offers Continue and Start over for a run stopped on the same sync`: running run `progress { listsDone: 12, listCount: 30 }`, same snapshot → text "The last import stopped at 12 of 30 lists." and both buttons; pressing Continue posts `/api/import/runs/<id>/resume`.
  - `offers only a fresh import when kakao-list synced after the run stopped`: newer `sourceSnapshotAt` → "stopped, and kakao-list has a newer sync" text, no Continue button; pressing Import posts `/api/import/runs`.
  - `offers both when kakao-list can't be reached`: `sourceSnapshotAt: null`, running run → Continue and Start over both shown, button enabled.
  - `explains a fresh start after Continue`: `/resume` rejects `snapshot_changed` → the `freshStart` text appears.
  - The existing "offers importing from kakao-list" test in `screens/Account.test.tsx` keeps passing (its mock answers `/api/import/status` with `{ latest: null, sourceSnapshotAt: null, upToDate: false }`).
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- ImportSection Account` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the section and strings. Buttons keep the 44 px target and existing `mm-button` classes; notes use `mm-note`/`mm-muted` as today; the live region stays `aria-live="polite"`.
- [ ] **Step 4: Run** the same command, then `./scripts/gate.sh main` — Expected: PASS and `GATE: PASS`. Save phone and desktop screenshots, both themes, of the stopped and up-to-date states for the ui reviewer.
- [ ] **Step 5: Commit** `feat(web): continue a stopped import, or say kakao-list has nothing new`
