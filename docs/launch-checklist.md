# Go-live checklist

Run this before the owner's wife starts using magomap (plan 03, Task 4). Each line is checked by doing it, not by reading code. Its shape follows agent-skills' `shipping-and-launch` idea of a release floor, written for this project.

## Data safety

- [ ] **Backups exist and a restore has been tried once.**
  - D1: Time Travel is on. Restore a copy to a scratch database and confirm a known diary entry is there.
  - Postgres: the provider's point-in-time recovery or daily dumps are on, and one restore has been tested.
- [x] **An export of all of one user's data** (places, notes, links, lists, locations) can be produced with one documented command. It is listed in `docs/deploy.md`.
- [x] **Account deletion** removes everything for that user, and nothing for the other account.

## It works for real

- [ ] **A real Kakao sign-in** works for both accounts, and someone not on the allowlist sees "not invited".
- [ ] **Owner gates from plan 03 are done.** G1: three Kakao SDK coordinate fixtures (Seoul, Busan, Jeju) are in kakao-list's `packages/domain/src/coordinates.fixtures.ts` and its test passes. G2: a real extension import confirmed the favourite `type` values, and which folders carry `subscribe` (her own public lists must not read as followed); the answers are in kakao-list's `docs/kakao-maps-private-api.md`.
- [ ] **A real import** from kakao-list (plan 03) brings in her lists. The places have coordinates and appear on the map, and a re-import changes nothing.
- [ ] **On her actual phone:**
  - install the PWA;
  - go offline and write a note;
  - close the app and reopen it;
  - go online, and check the note appears on a second device.
- [ ] **Kakao Maps loads with the production key** on the production domain. With the key removed, the OpenStreetMap fallback shows.

## Watching it

- [ ] **Workers logs** (or Logpush) show requests and errors. The secret, cookies and note bodies never appear in logs.
- [ ] **A failed sync shows up** for her ("Can't reach the server — retrying") and in the logs.
- [ ] **Kakao Maps quota.** Check the quota page in Kakao Developers and note today's usage.

## Way back

- [ ] **Rolling back the Worker** to the previous version (`wrangler rollback` or the dashboard) has been tried once.
- [ ] **Every database migration in this release** can be undone, or has been checked to be safe to leave in place.

## Quality

- [ ] The `auditor-performance` audit from plan 02 Task 7 has no open Critical or High findings.
- [ ] A manual screen-reader pass on her phone works: VoiceOver on iOS Safari, or TalkBack on Android Chrome. Open a place, add a note, and find it in the list.
- [ ] The homepage is live, and "Open magomap" points to the production URL.
