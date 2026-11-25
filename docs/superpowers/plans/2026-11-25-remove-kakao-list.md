# Remove the kakao-list import

kakao-list (a separate service the Worker fetched her Kakao lists from, server-side, with
`KAKAO_LIST_URL` + `MAGOMAP_IMPORT_SECRET`) is replaced by "Sync from Kakao Map" through the
magomap extension. The owner decided to remove kakao-list completely.

## Removed

- Web: Account's "Import from kakao-list" section (`import/ImportSection.tsx` + tests), the
  kakao-list start/resume in `runImport.ts` (`runImport`), the kakao-list job in `importJob.ts`,
  the "an import is running" guard in `KakaoMapSyncSection`, the `import.*` i18n strings.
  `summaryText` moves next to the Kakao Map section, which still uses it.
- API (`import/routes.ts`): `POST /import/runs`, `GET /import/status` (only the section read it),
  `POST /import/runs/:id/resume`, `POST /import/runs/:id/lists/:id/pages/:n` (the server-side page
  fetch), the kakao-list client and its errors. They answer 404 afterwards.
- Config: `KAKAO_LIST_URL`, `MAGOMAP_IMPORT_SECRET` (env.ts, wrangler.toml, .dev.vars.example,
  test bindings, Playwright vars); `scripts/fake-kakao-list.ts`, its package script, the
  Playwright webServer entry; `scripts/dev-seed.ts` (it drove the kakao-list routes).
- Test fixtures `apps/api/test/fixtures/{contract,contractVariants,pages}.ts` and
  `test/import.test.ts`'s kakao-list tests; domain types that only typed kakao-list's wire
  formats (`ImportStatus`, `kakao_list_unavailable`/`no_snapshot`/`snapshot_changed`/`up_to_date`).
- Mentions on the homepage (en/ko index and get-started, the kakao-list GitHub link) and in the
  current docs (deploy, launch checklist, kakao-map-access, brand guidelines, extension README).
  Historical docs under `docs/superpowers/` stay as written.

## Kept, and why

- `packages/db/src/stores/importRuns.ts` and `ImportSource`'s `'kakao_list'`: the Kakao Map sync
  runs through the same import runs, and existing rows carry `source = 'kakao_list'`. No migration.
- Shared routes the sync calls (`driveRun` in `runImport.ts`): `.../lists/:id/finish`,
  `.../complete`, `GET /import/runs/latest`, plus `handled`/`kakaoLoginIdOf`/`PAGE`.
- `post`, `codeOf`, `driveRun` in `runImport.ts` (the sync and duplicate-to-Kakao use them).
- The scheduled closing of abandoned runs, notes imported earlier (`visit_notes` origin `import`).
- The domain's kakao-list page parsers (`kakaoListsToImport`/`kakaoItemsToImport`) stay only as
  the reference the Kakao Map adapter's parity test compares against; they move into that
  test-only fixture. `kakaoListExternalId`, `kakaoFolderIdOf`, `usableNickname`, colours stay.
- API tests that prove existing kakao-list data still merges with a Kakao Map sync seed a
  `kakao_list` run straight through the store.

## E2E seeding

`importFromKakao(page)` becomes `syncFromKakao(page, variant?)`: a fake extension (init script,
as in `kakao-map-sync.spec.ts`) answers `magomap.ping` and `magomap.read` with a synthetic raw
Kakao Map read built from the same data the fake kakao-list served (제주 카페 101 with 바다정원 카페
`p_kakao_27324155` and its Kakao note, 돌담 브런치; 서울 맛집 102 with 명동 칼국수; the followed
민수의 부산 여행 205 with 해운대 시장) and the same variants (`withoutFavourite`, `moved`). Each
magomap test user reads from its own Kakao Map account; the helper confirms the account on the
first sync. `import.spec.ts` keeps its behaviour (re-sync keeps the Kakao note, marks a removed
favourite, shows previous locations) through the sync.

## Order

1. This plan.
2. Web: tests first (Account has no kakao-list section), then remove the section, job, strings.
3. API: tests first (removed routes answer 404), remove routes, client, env, fixtures, scripts.
4. E2E: new seeding helper, port every spec, drop the fake kakao-list server.
5. Homepage and docs.
6. Verify: biome, typecheck, unit suites, build, full Playwright on both projects.
