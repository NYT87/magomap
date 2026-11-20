# How magomap tasks are built and reviewed

This document sets how every task in `docs/superpowers/plans/` is carried out. Each plan's header points here.

Sources:
- The gate and per-task reviewer ideas are our own design, inspired by software-factory patterns. No third-party code or text is used for them.
- The security, accessibility and performance reviewers are adapted from addyosmani/agent-skills (MIT). See `.claude/agents/THIRD-PARTY-NOTICES.md`.

## The loop for one task

```
builder (fresh subagent) ──► gate ──FAIL──► back to the builder, with gate.log
                              │
                             PASS
                              ▼
          the task's reviewers (.claude/agents/reviewer-*), in parallel
                              │
              any CHANGES ────┴──── all PASS ──► definition of done ──► next task
                   │
                   ▼
          builder fixes ──► gate ──► the same reviewers again
```

1. **Builder.** A fresh subagent gets the task text, the plan header (Global Constraints, Review Focus) and the spec.
   - It follows the task's steps (test first, then code) and **checks official docs first** (below).
   - It commits on the working branch.
   - On screen tasks, it saves screenshots for the reviewers.
2. **Gate.** `scripts/gate.sh` runs the project's checks and the quality-bar guard. **No reviewer runs on a failing build.** A failure goes straight back to the builder with `gate.log`.
3. **Reviewers.** Only the ones listed for the task in "Who reviews which task". They run in parallel, each with its agent file in `.claude/agents/`. Each answers `VERDICT: PASS`, or `VERDICT: CHANGES` with numbered findings.
4. **Fix rounds.** At most **3 rounds** (build → gate → review). If round 3 still fails, stop and ask the owner a specific question. Never weaken a test, a check or a rule to get through.
5. **Definition of done.** The task is finished only when the standing checklist below holds.
6. **Owner gates.** Steps marked "owner" in a plan wait for the owner. The build pauses and says exactly what is needed.

## Check official docs first

These APIs change often, and the plan review already caught several outdated ones. Before writing code against any of the following, the builder reads its **current official documentation** and puts the doc URL it relied on in the commit message body:
- Cloudflare Workers, D1, Hyperdrive, rate limiting, static assets, and Wrangler or the Vitest plugin;
- Kakao Login, Kakao Local and the Kakao Maps JS SDK;
- Kysely and its dialects, Dexie, `vite-plugin-pwa`/Workbox, Leaflet, and Playwright.

When the docs disagree with the plan, the docs win for **how** to call the API. The builder says so in `build` notes and keeps the plan's **behaviour**. If the behaviour itself can't be done as planned, stop and ask.

## The gate

`scripts/gate.sh [base-ref]`. `base-ref` is the commit the task started from, and defaults to `origin/main`.

1. **Checks.** It runs `scripts/checks.sh`. That script is written once over the whole workspace, so new packages are covered without editing it:
   - `pnpm install --frozen-lockfile`;
   - `pnpm check` (Biome, with no writes);
   - `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` and `pnpm -r --if-present build`.

   Postgres tests run when `TEST_DATABASE_URL` is set. The end-to-end tests run in plan 02 Task 7 and in CI, not in the gate.
2. **Protected paths.** It fails if the task changed any of these:
   - `scripts/checks.sh`, `scripts/gate.sh`;
   - `.github/workflows/**`;
   - `biome.json`, `tsconfig.base.json`;
   - `docs/superpowers/**`, `docs/brand-guidelines.md`;
   - `.claude/agents/**`.

   The exception is the task that **creates** a file. The owner changes these deliberately, outside a task.
3. **Quality-bar guard.** It fails if the task's diff (`git diff base-ref`, added lines only) adds any of:
   - `@ts-ignore`, `@ts-nocheck` or `biome-ignore`;
   - `@ts-expect-error` without a reason on the same line;
   - `.skip(`, `.only(`, `it.todo(`, `test.todo(` or `describe.skip`;
   - `eslint-disable`;
   - `as any` in a non-test file.

   It also fails if the diff **deletes a test file**, or removes more `expect(`/`assert` lines than it adds in a test file without adding a new test file. An intentional exception needs the comment `gate-allow: <reason>` on the same line; reviewers judge the reason.
4. **Output.** It writes `gate.log`, and prints one line: `GATE: PASS` or `GATE: FAIL <reason>`. It is non-interactive, never rewrites files, and exits non-zero on failure.

Tests are not protected paths, because tasks legitimately change them. The guard and the code reviewer catch weakening instead.

## Reviewers

Each reviewer has an agent file in `.claude/agents/`. Each agent's own instructions hold its checklist, and its final message uses this format:

```
VERDICT: PASS | CHANGES
1. <file:line> — <what is wrong> — <what to do>
```

| Reviewer | Agent | Looks at |
|---|---|---|
| code | `reviewer-code` | plan conformance (exact names and types), test honesty, correctness, both DB dialects, scope |
| security | `reviewer-security` | trust boundaries, user scoping, sessions, OAuth, secrets, input, rendering, caching |
| ui | `reviewer-ui` | brand guidelines, both themes, phone and desktop layouts, markers, Korean wrapping |
| ux | `reviewer-ux` | the wife's path, nothing lost silently, states, voice in Korean and English |
| a11y | `reviewer-a11y` | WCAG 2.2 AA: keyboard, screen readers, the accessible place list, sheets and panel, live status, zoom |

**Screenshots for ui, ux and a11y.** On screen tasks, the builder saves Playwright screenshots of the changed screens to `tmp/review-shots/<plan>-<task>/`, which is gitignored. They are taken at 390×844 and 1440×900, in light and dark.

## Who reviews which task

| Plan · Task | Reviewers |
|---|---|
| 01 · 1 Monorepo, domain types, ids, location rule | code |
| 01 · 2 Database connector and migrations | code |
| 01 · 3 Worker, Kakao sign-in, sessions, account | code, security |
| 01 · 4 Sync push/pull | code, security |
| 01 · 5 Import from kakao-list | code, security |
| 01 · 6 Place search proxy | code, security |
| 01 · 7 Deploy config, CI, docs | code, security |
| 02 · 1 App shell, layouts, PWA, i18n, account | code, ui, ux, a11y, security |
| 02 · 2 Local store, outbox, sync engine | code, ux |
| 02 · 3 Map, markers, list picker | code, ui, ux, a11y |
| 02 · 4 Search | code, ui, ux, a11y |
| 02 · 5 Place page | code, ui, ux, a11y, security |
| 02 · 6 Lists and import screens | code, ui, ux, a11y |
| 02 · 7 Sync indicator, end-to-end tests, performance audit | code, ui, ux, a11y, plus `auditor-performance` once |
| 02 · 8 Homepage | code, ui, ux, a11y |
| 03 · 1 Coordinate helper (kakao-list) | code |
| 03 · 2 Raw coordinates, type, flags (kakao-list) | code |
| 03 · 3 magomap endpoint (kakao-list) | code, security |
| 03 · 4 Go-live | the owner, with `docs/launch-checklist.md` |
| kakao-direct-sync · 0 Kakao Map access test | the owner |
| kakao-direct-sync · 1 Coordinate converter | code |
| kakao-direct-sync · 2 Raw Kakao Map adapter | code |
| kakao-direct-sync · 3 Older imports keep roles | code (most capable model) |
| kakao-direct-sync · 4 Kakao Map account binding | code, security |
| kakao-direct-sync · 5 Upload-run API | code (most capable model), security |
| kakao-direct-sync · 6 Extension | code, security |
| kakao-direct-sync · 7 Sync in Account | code, ui, ux, a11y |
| kakao-direct-sync · 8 Ship | the owner |
| place-lists-notes · 1 Kakao notes as cards | code, ui, ux, a11y |
| place-lists-notes · 2 Lists first | code, ui, ux, a11y |

**Models.**
- The builder and `reviewer-security` use the most capable model.
- The other reviewers use the model in their frontmatter, a mid-tier one.
- `reviewer-code` runs on the most capable model for 01·4 and 01·5, where a mistake could lose diary entries.

## Definition of done

These apply to every task, on top of the task's own steps.

**Correctness**
- Every step of the task is done, and every test it names exists and passes.
- **Checked by running it**, not only by tests: the API route was called, or the screen was opened, at least once.
- New behaviour has tests that fail without the change.
- No existing test was weakened.
- Error paths and empty states are handled, not only the happy path.

**Quality**
- Names and signatures match the plan exactly.
- There is no dead code, debug output, commented-out blocks, or unrelated refactor.
- The gate passes, including the quality-bar guard.

**magomap-specific**
- Database code works on **both** SQLite/D1 and Postgres.
- Screens work in **both** themes and **both** layouts, and every string exists in **both** `ko.json` and `en.json`.
- Nothing the user writes can be lost silently.

**Records**
- A decision that changes the design is added to the spec's "Implementation notes", stating what was decided and why.
- The README stays true.

## kakao-list tasks (plan 03)

Plan 03 runs in the `kakao-list` repo with its own commands. Its gate is run from that repo:

```
pnpm typecheck && pnpm -r test && pnpm check
```

The magomap reviewer agents are given that repo's diff. Nothing is copied into kakao-list from here.
