# Theme choice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** The Account page lets each device choose its theme: Same as this device (default), Light or Dark.

**Architecture:**
- Today dark mode follows only the system: the dark tokens sit in `@media (prefers-color-scheme: dark) { :root { … } }` in `apps/web/src/styles/tokens.css:78`.
- A `data-theme` attribute on `<html>` lets a saved choice override the system: `light` turns the dark tokens off, `dark` turns them on, no attribute means "follow the device".
- A small `theme.ts` reads, saves and applies the choice. An inline script in `index.html` applies it before the CSS paints, so there's no flash. The Account page gets a select under Language.

**Tech Stack:** React 19, i18next (ko/en), plain CSS tokens, Vite (`apps/web/index.html`), Vitest + Testing Library, Playwright (projects `phone` and `desktop`).

**Spec:** the owner's request of 2026-11-20: "it is missing the switch theme color, it should be on the accounts page", then "make it its own plan". The three choices and per-device saving were proposed in the phone header plan and kept.

## Global Constraints

- **Choices:** exactly `system`, `light`, `dark`; default `system`.
- **Saved per device** in `localStorage["mm.theme"]`, like `mm.lang`. Not synced to the server, not per account, and not removed by sign-out.
- **No flash:** a saved choice applies before first paint.
- **Dark values have one source:** the dark token values must not exist as two copies that can drift.
- **Map pins** use CSS variables (`apps/web/src/map/markerHtml.ts`), so they follow the theme with no map code changes.
- **Strings:** in both `apps/web/src/i18n/ko.json` and `en.json`.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh` must PASS. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Protected paths:** `scripts/`, `biome.json`, `tsconfig.base.json`, `docs/superpowers/**` except this plan.
- **Commits:** on branch `feat/theme-choice`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Dark chosen on a light-mode phone opens dark with no light flash**, and the browser's top bar (`theme-color`) matches. (Task 1, e2e.)
2. **"Same as this device" follows the device live:** switching the phone to dark while the app is open turns the app dark, including the `theme-color` bar. (Task 1.)
3. **Blocked storage** (private mode): choosing a theme still applies it for the session and nothing throws, on load or on change. (Task 1.)
4. **Native controls in dark:** selects, inputs and scrollbars use dark styling when Dark is chosen on a light-mode device (`color-scheme`). (Task 1.)
5. **Another tab** changing the theme updates this one through the `storage` event, so two open tabs never disagree. (Task 1.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Theme mechanism | code, ui |
| 2 Theme select on Account | code, ui, ux, a11y |

---

### Task 1: The theme can be chosen, saved and applied before paint

**Files:**
- Create: `apps/web/src/theme.ts`
- Modify: `apps/web/src/styles/tokens.css` (dark block at line 78), `apps/web/index.html` (inline script; `theme-color` meta at line 6), `apps/web/src/main.tsx` (start following the system and other tabs)
- Test: `apps/web/src/theme.test.ts` (create), `apps/web/e2e/theme.spec.ts` (create)

**Interfaces:**
- Produces, in `theme.ts`:
  - `export type ThemeChoice = "system" | "light" | "dark"`
  - `storedTheme(): ThemeChoice` — `localStorage["mm.theme"]`; missing, unknown, or a storage error → `"system"`.
  - `applyTheme(choice: ThemeChoice): void` — `system` removes `data-theme` from `document.documentElement`; `light`/`dark` set it. Sets `<meta name="theme-color">` to the resolved theme's bar colour: light `#1F6F5C` (today's value), dark the dark `--color-bg`.
  - `setTheme(choice: ThemeChoice): void` — saves (storage errors ignored) and applies.
  - `followTheme(): () => void` — while the choice is `system`, re-applies when `prefers-color-scheme` changes; on a `storage` event for `mm.theme`, applies the new value. Returns a cleanup. Called once from `main.tsx`.
- `tokens.css`: the dark values move into one rule whose selector covers both cases: `:root[data-theme="dark"]` plus the system case `:root:not([data-theme="light"])` inside `@media (prefers-color-scheme: dark)`. CSS can't join a media query and a plain selector in one rule, so keep the values once as custom properties (for example `--dark-color-bg` … defined on `:root`) and map them in both places with one line per token, or another approach that keeps one copy of each value. Also `:root[data-theme="light"] { color-scheme: light }`, `:root[data-theme="dark"] { color-scheme: dark }`, and `color-scheme: light dark` on `:root` otherwise.
- `index.html`: an inline `<script>` before the stylesheet that reads `mm.theme` inside `try`, and sets `data-theme` for `light`/`dark`.

- [ ] **Step 1: Write the failing tests**
  - `theme.test.ts`:
    - `defaults to the device's setting` — empty storage → `"system"`; `"purple"` → `"system"`; `getItem` throws → `"system"`.
    - `applies and remembers a choice` — `setTheme("dark")` → `documentElement.dataset.theme === "dark"`, storage `"dark"`, `theme-color` content is the dark bar colour; `setTheme("system")` → no `data-theme`.
    - `still applies when storage is blocked` — `setItem` throws → `setTheme("light")` sets `data-theme="light"` and doesn't throw.
    - `follows the device while on system` — with the test setup's `matchMedia`, flip `prefers-color-scheme: dark` → `theme-color` becomes the dark colour; with `light` chosen, flipping changes nothing.
    - `follows another tab` — dispatch `new StorageEvent("storage", { key: "mm.theme", newValue: "dark" })` → `data-theme="dark"`.
  - `e2e/theme.spec.ts` (both projects):
    - `a chosen dark theme opens dark with no flash` — `page.emulateMedia({ colorScheme: "light" })`, `addInitScript` setting `mm.theme = "dark"`, then `goto("/")`; at `domcontentloaded`, `html` has `data-theme="dark"` and `getComputedStyle(document.body).backgroundColor` is the dark background.
    - `the device's theme is the default` — no saved choice, `emulateMedia({ colorScheme: "dark" })` → dark background and no `data-theme`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- theme` and `pnpm --filter @magomap/web e2e -- theme` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified. The test setup's `matchMedia` stub (`apps/web/src/test/setup.ts:16`) answers width queries; extend it to answer `prefers-color-scheme` from a settable value, keeping its width behaviour.
- [ ] **Step 4: Run** the same commands, then the full `pnpm --filter @magomap/web test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): a saved theme choice that overrides the device's`

### Task 2: The Theme select on the Account page

**Files:**
- Modify: `apps/web/src/screens/Account.tsx` (under the Language select, near line 104), `apps/web/src/i18n/en.json`, `ko.json`
- Test: `apps/web/src/screens/Account.test.tsx`

**Interfaces:**
- Consumes: `ThemeChoice`, `storedTheme()`, `setTheme()` (Task 1).
- Produces: a `select` in the same card and markup as Language (`mm-field`, `mm-field__label`, `mm-input`), label `account.theme`, options in this order:

```json
"account.theme": "Theme",
"account.themeSystem": "Same as this device",
"account.themeLight": "Light",
"account.themeDark": "Dark"
```
Korean in the same plain tone as the nearby `account.*` strings (for example 테마 / 기기 설정과 같이 / 밝게 / 어둡게). Its value starts at `storedTheme()`; changing it calls `setTheme`.

- [ ] **Step 1: Write the failing tests**
  - `chooses the theme` — render Account, select "Dark" in the field labelled "Theme" → `document.documentElement.dataset.theme === "dark"` and `localStorage["mm.theme"] === "dark"`.
  - `shows the saved choice` — `mm.theme = "light"` before render → the select's value is `light`.
  - `defaults to the device` — nothing saved → "Same as this device" selected.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- Account` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** the same command, then `./scripts/gate.sh main` → `GATE: PASS`. Screenshots of the Account page on phone and desktop with Light and with Dark chosen, in Korean and English.
- [ ] **Step 5: Commit** `feat(web): choose the theme on the Account page`
