# How magomap tasks are built and reviewed

This document sets how every task in `docs/superpowers/plans/` is carried out. Each plan's header points here.

It is written for this project, and contains no third-party code or text.

## The loop for one task

```
builder (fresh subagent) ──► gate ──FAIL──► back to the builder, with the gate log
                              │
                             PASS
                              ▼
                 reviewers for this task, in parallel
                              │
              any CHANGES ────┴──── all PASS ──► commit stays, next task
                   │
                   ▼
          builder fixes ──► gate ──► the same reviewers again
```

1. **Builder.** A fresh subagent gets the task text, the plan header (Global Constraints, Review Focus) and the spec. It follows the task's steps (test first, then code) and commits on the working branch.
2. **Gate.** `scripts/gate.sh` runs the project's checks. **No reviewer runs on a failing build.** A failure goes straight back to the builder with `gate.log`.
3. **Reviewers.** Only the ones listed for the task in "Who reviews which task" below. They run in parallel, and each reads the task, the diff and its checklist. Each answers `PASS`, or `CHANGES` with a numbered list of findings.
4. **Fix rounds.** At most **3 rounds** (build → gate → review). If round 3 still fails, stop and ask the owner with a specific question; never weaken a test or a rule to get through.
5. **Owner gates.** Steps marked "owner" in a plan wait for the owner. The build pauses there and says exactly what is needed.

## The gate

`scripts/gate.sh [base-ref]` (base-ref defaults to `origin/main`, or to the commit the task started from):

- **Runs `scripts/checks.sh`.** That script holds the project's real commands, written once over the whole workspace so new packages are covered without editing it: `pnpm install --frozen-lockfile`, `pnpm check` (Biome, no writes), `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` and `pnpm -r --if-present build`. Postgres tests run when `TEST_DATABASE_URL` is set. The end-to-end tests are not part of the gate; they run in plan 02 Task 7 and in CI.
- **Fails if the task changed a protected path.** Builders may not edit what they are judged by. The protected paths are:
  - `scripts/checks.sh` and `scripts/gate.sh`;
  - `.github/workflows/**`;
  - `biome.json` and `tsconfig.base.json`;
  - `docs/superpowers/**` and `docs/brand-guidelines.md`.

  Exception: the task that **creates** one of these files (for example, plan 01 Task 1 creates `checks.sh`). The owner changes the others deliberately, outside a task.
- **Output.** It writes `gate.log`, and prints one line: `GATE: PASS` or `GATE: FAIL <reason>`.
- **Requirements.** It must be non-interactive, must not rewrite files (no `--write`/`--fix`), and must exit non-zero on failure.

Tests are **not** protected: tasks legitimately change them. The code reviewer fails any test that was deleted, skipped, loosened or special-cased to pass.

## Reviewers

Each reviewer writes its verdict in this shape:

```
VERDICT: PASS | CHANGES
1. <file:line> — <what is wrong> — <what to do>
```

Every reviewer stays inside its own checklist and doesn't repeat another reviewer's job.

### code (every task)

- The task is done as written: its files, interfaces, names and types match the plan exactly, so later tasks can rely on them.
- Every test named in the task exists and asserts what the task says, and the Review Focus items owned by this task are tested.
- No test was removed, skipped, weakened or made to pass with a special case.
- It is correct beyond the tests: edge cases, error paths, off-by-one, null handling.
- It is no bigger than needed: no speculative abstractions and no unused code.
- For both database dialects: no SQL that only works on one, unless it lives in a dialect file.

### security (tasks that touch identity, data access, secrets or input)

- **User scoping.** Every query is scoped by `user_id`, and no route can reach another user's rows.
- **Sessions and cookies.** Only the token hash is stored; the cookie flags are as specified; logout really revokes the session.
- **Kakao OAuth.** The `state` is checked, Kakao tokens are not kept, and the allowlist is applied before any row is created.
- **Secrets.** The REST key, client secret and import secret never reach the client, a response body or a log, and secrets are compared in constant time.
- **Input.** Every request body is validated with the shared schemas, the size limits are enforced, and link URLs are `http(s)` only.
- **The app.** Imported or user text is never rendered as HTML, external links use `rel="noopener noreferrer"`, and private data never goes into the service-worker cache.

### ui (tasks that change what people see)

- **Brand.** Colours, type, radius, elevation and marker styles come from `docs/brand-guidelines.md` and the token CSS, never as one-off values. Kakao yellow is never used.
- **Themes.** Light and dark both work, and contrast is at least AA.
- **Layouts.** Both work: phone (390×844) and desktop (1440×900, with the left panel). There is no horizontal scroll, and nothing is clipped or overlapping.
- **Targets and focus.** Touch targets are at least 44 px, and keyboard focus is visible.
- **Language.** Korean text uses `word-break: keep-all`, and long Korean addresses and titles wrap cleanly.
- **How it's checked.** The reviewer looks at screenshots of the changed screens at both sizes, in both themes. The builder takes them with Playwright and saves them in `tmp/review-shots/<plan>-<task>/`, which is gitignored.

### ux (tasks that change how people use the app)

- **The user** is the owner's wife: not technical, phone first, often outdoors with bad signal, and writing a note at the place. Is the main path short and obvious?
- **Nothing she writes is ever lost silently.** Unsynced and rejected changes are visible, and drafts survive.
- **Words follow the brand voice.** Korean uses 해요체, English uses sentence case, and there are no technical words. Every string exists in both `ko.json` and `en.json`.
- **States are designed:** empty, loading, offline, error and "needs sign-in". Every error says what to do next.
- **Kakao data looks read-only** where it is read-only, and destructive actions say exactly what will happen.

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
| 02 · 1 App shell, layouts, PWA, i18n, account | code, ui, ux, security |
| 02 · 2 Local store, outbox, sync engine | code, ux |
| 02 · 3 Map, markers, list picker | code, ui, ux |
| 02 · 4 Search | code, ui, ux |
| 02 · 5 Place page | code, ui, ux, security |
| 02 · 6 Lists and import screens | code, ui, ux |
| 02 · 7 Sync indicator and end-to-end tests | code, ui, ux |
| 02 · 8 Homepage | code, ui, ux |
| 03 · 1 Coordinate helper (kakao-list) | code |
| 03 · 2 Raw coordinates, type, flags (kakao-list) | code |
| 03 · 3 magomap endpoint (kakao-list) | code, security |

**Models.** The builder and the security reviewer use the most capable model. The code, ui and ux reviewers use a mid-tier model, except that the code reviewer uses the most capable model on 01·4 and 01·5, where a mistake could lose diary entries.

## kakao-list tasks (plan 03)

Plan 03 runs in the `kakao-list` repo, which has its own commands. Its gate is a one-off command run from that repo:

```
pnpm typecheck && pnpm -r test && pnpm check
```

The plan 03 steps define what `pnpm check` means there. Nothing is copied into kakao-list from here.
