# Go-live checklist

Run this before the owner's wife starts using magomap (plan 03, Task 4). Each line is checked by doing it, not by reading code. Its shape follows agent-skills' `shipping-and-launch` idea of a release floor, written for this project.

## Data safety

- [ ] **Backups exist and a restore has been tried once.**
  - D1: Time Travel is on. Restore a copy to a scratch database and confirm a known diary entry is there.
  - Postgres: the provider's point-in-time recovery or daily dumps are on, and one restore has been tested.
- [x] **An export of all of one user's data** (places, notes, links, lists, locations) can be produced with one documented command. It is listed in `docs/deploy.md`. Tried on production by the owner on 2026-11-23 (Account → Download my data, v0.1.5).
- [x] **Account deletion** removes everything for that user, and nothing for the other account.

## It works for real

- [ ] **A real Kakao sign-in** works for both accounts, and someone not on the allowlist sees "not invited".
- [x] **Owner gates from plan 03 are done.** G1: Kakao's coordinates convert correctly (the fixtures in `packages/domain/src/providers/wcongnamul.fixtures.ts` and their test pass). G2: a real read through the magomap extension confirmed the favourite `type` values, and which folders carry `subscribe` (her own public lists must not read as followed); the answers are in `docs/kakao-map-access.md`. Checked 2026-11-26: the fixture test passes (11 cases) and `docs/kakao-map-access.md` records the `type` values and that `subscribe` marks followed folders only (her own public lists need the alias, #82).
- [ ] **A real sync from Kakao Map** (Account → Sync from Kakao Map, with the magomap extension) brings in her lists. The places have coordinates and appear on the map, and syncing again changes nothing.
- [ ] **On her actual phone:**
  - install the PWA;
  - go offline and write a note;
  - close the app and reopen it;
  - go online, and check the note appears on a second device.
- [ ] **Kakao Maps loads with the production key** on the production domain. With the key removed, the OpenStreetMap fallback shows.

## Watching it

- [ ] **Workers logs** (or Logpush) show requests and errors. The secret, cookies and note bodies never appear in logs.
  - Code checked 2026-11-26: Workers Logs are on (`observability`, kept 7 days). The API writes two log lines: unexpected errors in `app.onError` (`apps/api/src/index.ts`), and the daily clean-up count. Known refusals are answered without a log line. Still to do by looking at the dashboard: one real error, and that no note text or cookie shows in it. Request URLs are logged, so a search query or a sign-in callback's one-time code can appear there.
- [ ] **A failed sync shows up** for her ("Can't reach the server — retrying") and in the logs.
- [ ] **Kakao Maps quota.** Check the quota page in Kakao Developers and note today's usage.

## Way back

- [ ] **Rolling back the Worker** to the previous version (`wrangler rollback` or the dashboard) has been tried once.
- [x] **Every database migration in this release** can be undone, or has been checked to be safe to leave in place. Checked 2026-11-26 (0.1.11): 0004–0006 only add nullable columns to `list_items`, and 0007 adds the new `kakao_adds` table with its index. An older Worker ignores all of them, so a Worker rollback needs no database change. Every release takes a D1 Time Travel bookmark before migrating.

## Quality

- [ ] The `auditor-performance` audit from plan 02 Task 7 has no open Critical or High findings.
- [ ] A manual screen-reader pass on her phone works: VoiceOver on iOS Safari, or TalkBack on Android Chrome. Open a place, add a note, and find it in the list.
- [x] The homepage is live, and "Open magomap" points to the production URL. Checked 2026-11-26: `https://nyt87.github.io/magomap/` and `/ko/` answer 200 and link to `https://magomap.jmn8718.workers.dev`.
