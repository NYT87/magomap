# Phone search bar, sync icon and page titles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** On phones, the map's search bar spans the full width, the sync status is a single icon at the top right that never covers content, the Account and Lists titles sit in the header beside the back arrow, and the Account page lets her choose light, dark or the system theme.

**Architecture:**
- The search bar is pushed in by `right: 72px` in `.mm-map-top` (`apps/web/src/styles/app.css:573`), although the map buttons start below it at `top: 64px`. It becomes full width.
- The floating badge (`.mm-phone-status`, `app.css:195`) sits outside the map with `z-index: 3`. The list view (`.mm-list-overlay`) lives inside the map, so the badge shows through over the list. It is removed: on the map the sync icon becomes the first button of the map-buttons column (`.mm-map-tools`); on pages it stays in the header, as an icon.
- `SyncIndicator` gets a `compact` form for phones: one 44 px icon button whose tap opens a sheet with the full status and its actions. Desktop keeps today's pills.
- `AppLayout`'s phone header can show a page title; Account and Lists use it and drop their own on phones.
- Dark mode today follows only the system (`@media (prefers-color-scheme: dark)` in `tokens.css`). A `data-theme` attribute on `<html>` lets a saved choice override it.

**Tech Stack:** React 19, wouter, i18next (ko/en), plain CSS (`apps/web/src/styles/app.css`, tokens in `tokens.css`), lucide-react icons, Vitest + Testing Library, Playwright (projects `phone` and `desktop`).

**Spec:** the owner's requests of 2026-11-20, quoted:
> on the mobile, the search bar does not take all the width as on the right side, the actions for show list, location, the search bar does not go over their position. also the sync badge, it is always over the screen so when the list page opens, the sync badges stays there and it covers the data under. but on the account page, the synced appears on the header top right. i think for mobile, rather that the icon and text, it should show only the icon, on the top right. also on the accounts page, the account title, rather that be on the page, it should appear on the header, beside the back arrow
>
> same for the lists page, the title is on the content, and it should be on the header. and it is missing the switch theme color, it should be on the accounts page

## Decisions (the planner's calls; the owner checks these)

- **Where the icon goes on the map:** top of the map-buttons column, right under the search bar, so it is "top right" and lines up with Layers / My location / List.
- **What tapping the icon does:** opens a sheet titled "Sync" with the same sentence the pill shows today. When signing in is needed, the sheet has the "Sign in again" link; when changes were refused, it has the existing "{{count}} changes couldn't be saved" button that opens the refused-changes sheet. A refused change also puts a small error dot on the icon.
- **Colours:** the icon keeps today's tone colours (success, warning, error), with the state also in the button's accessible name, so colour isn't the only signal.
- **Desktop:** unchanged (the side panel header keeps the full pills).
- **Header titles:** Account and Lists, as asked. Place pages keep the place's name in the page (it can be long). Lists' **New list** button stays at the top of the page content, since the header's right side holds the sync icon.
- **Theme choice:** a "Theme" select under Language on the Account page with System (default), Light and Dark. It is saved per device (`mm.theme`, like `mm.lang`) and applied before the first paint, so there's no flash. On desktop it's in the same place.
- **List view on the map:** the map buttons stay over the list, so the list gets right padding equal to the buttons column, and no row is covered.

## Global Constraints

- **Phone only:** layout `phone` (< 768 px). Desktop renders exactly as today.
- **Touch targets:** at least 44 × 44 px for the sync icon button; map buttons stay 48 px.
- **Accessibility:** the existing hidden `role="status"` live region stays mounted in both forms, so every state change is still announced. The icon button's accessible name is the status sentence (e.g. "Synced", "Sign in again to keep syncing").
- **Both themes** (light and dark) and safe-area insets (`env(safe-area-inset-*)`) are respected, as in the rules being changed.
- **Strings:** every new string in both `apps/web/src/i18n/ko.json` and `en.json`.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh` must PASS. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Protected paths:** `scripts/`, `biome.json`, `tsconfig.base.json`, `docs/superpowers/**` except this plan.
- **Commits:** on branch `fix/phone-header`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The list view with the map buttons over it:** a long place name or a row's action at the right edge must not sit under the buttons column. (Task 1, e2e.)
2. **"Sign in again" on a phone:** the only way to the sign-in link is now through the sheet; it must be reachable by touch and keyboard, and the icon must look different (warning tone) so she notices. (Task 2.)
3. **Search results dropdown at full width:** `.mm-map-top .mm-search__results` must still fit the screen and stay above the map buttons when open. (Task 1, e2e.)
4. **Notch / safe areas:** the search bar and the column keep their `env(safe-area-inset-*)` offsets; nothing slides under the status bar. (Task 1, screenshots.)
5. **Focus on Account and Lists:** the phone moves focus to the page's `h1` on navigation; with the title in the header, focus must land on that header `h1`, and there must be exactly one `h1`. (Task 3.)
6. **A saved theme on first load:** Dark chosen on a light-mode phone must open dark with no light flash, and the browser's `theme-color` bar must match. (Task 4.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Full-width search, map buttons, list padding | code, ui, ux |
| 2 Sync icon on phones | code, ui, ux, a11y |
| 3 Account and Lists titles in the header | code, ui, a11y |
| 4 Theme choice | code, ui, ux, a11y |

---

### Task 1: Full-width search bar; map buttons and list view below it

**Files:**
- Modify: `apps/web/src/styles/app.css` (`.mm-map-top` line 573, `.mm-map-tools` line 581, `.mm-list-overlay` line 643)
- Test: `apps/web/e2e/phone-layout.spec.ts` (create)

**Interfaces:**
- Produces: CSS custom property `--mm-tools-width: 64px` on `.mm-shell--phone` (48 px button + 16 px gutter), used by `.mm-list-overlay`'s right padding. Task 2 adds its icon into `.mm-map-tools` without changing these numbers.

- [ ] **Step 1: Write the failing e2e test** (`phone` project only; `test.skip(info.project.name !== "phone")` is not allowed by the gate, so use `test.describe` with a project check inside the test that returns early, as `lists.spec.ts` does with `if`)
  - `the search bar spans the screen on phones`: after `devLogin` and opening `/`, the box of `.mm-map-top .mm-search__box` has `x ≈ 16` and `x + width ≈ viewport.width - 16` (±1 px).
  - `the map buttons start below the search bar`: the top of `.mm-map-tools` is greater than the bottom of `.mm-map-top`.
  - `the list view isn't covered by the map buttons`: press the List button, then the right edge of the first `.mm-places__list` item is less than the left edge of `.mm-map-tools`.
  - `search results fit the screen`: type a query from the e2e fixtures; `.mm-search__results` right edge ≤ `viewport.width - 16`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web e2e -- phone-layout --project phone` — Expected: the first and third tests FAIL.
- [ ] **Step 3: Implement** in `app.css`: `.mm-map-top { right: var(--space-md) }`; `.mm-map-tools` `top` = the search bar's bottom plus `var(--space-sm)` (keep it a `calc()` with the safe-area inset); `.mm-list-overlay` right padding `calc(var(--mm-tools-width) + var(--space-md))`.
- [ ] **Step 4: Run** the same command, and `pnpm --filter @magomap/web e2e -- lists map-provider` — Expected: PASS. Save phone screenshots (light and dark) of the map and the list view.
- [ ] **Step 5: Commit** `fix(web): full-width search on phones, map buttons below it`

### Task 2: The sync status is one icon on phones

**Files:**
- Modify: `apps/web/src/components/SyncIndicator.tsx`, `apps/web/src/layout/AppLayout.tsx`, `apps/web/src/screens/MapScreen.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles/app.css` (remove `.mm-phone-status` rules at lines 195 and 1405/1427; add `.mm-sync__icon`)
- Modify: `apps/web/src/i18n/en.json`, `ko.json`
- Test: `apps/web/src/components/SyncIndicator.test.tsx` (create), `apps/web/src/layout/AppLayout.test.tsx`

**Interfaces:**
- Produces: `SyncIndicator({ compact }: { compact?: boolean })`. `compact` → a `button.mm-sync__icon` (44 × 44, `data-tone` as today, accessible name = the status sentence, a dot `span.mm-sync__dot` when `status.rejected > 0`) that opens `<Sheet title={t("sync.title")}>` containing the sentence, the "Sign in again" link (`href="/api/auth/kakao/start"`) when `needs_signin`, and the refused-changes button when `rejected > 0`. Not compact → today's markup, unchanged.
- `AppLayout`: on phones, the page header renders `status` as given; the root no longer renders `.mm-phone-status`. A new prop `mapStatus?: ReactNode` is not added; instead `MapScreen` renders `<SyncIndicator compact />` as the first child of `.mm-map-tools` on phones.
- `App.tsx` passes `status={<SyncIndicator compact={layout === "phone"} />}` (using `useLayout`).
- New string: `"sync.title": "Sync"`.

- [ ] **Step 1: Write the failing tests**
  - SyncIndicator: `shows only an icon on phones, named by its status` — `compact`, synced → one button with accessible name "Synced", no visible pill text.
  - `opens the full status with its actions` — `compact`, `needs_signin` → click the button → a dialog "Sync" with the sentence and a link "Sign in again…" to `/api/auth/kakao/start`.
  - `marks refused changes on the icon` — `compact`, `rejected: 2` → `.mm-sync__dot` present; the sheet has the "2 changes couldn't be saved" button, which opens the refused-changes sheet.
  - `keeps announcing changes` — the `role="status"` region exists in compact form and its text follows the state.
  - `desktop keeps the pills` — not compact → today's pill text visible.
  - AppLayout: `doesn't float the sync status over the map on phones` — phone at `/` → no `.mm-phone-status` element.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- SyncIndicator AppLayout` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified. The icon uses the same lucide icons as today at 20 px; tone colours from today's `.mm-sync__pill[data-tone]` rules, applied to the icon.
- [ ] **Step 4: Run** the same command, the Task 1 e2e file and `offline-note.spec.ts` — Expected: PASS. Screenshots (phone, both themes): map with the icon, Account header with the icon, the open sheet in `needs_signin`.
- [ ] **Step 5: Commit** `fix(web): on phones, sync status is one icon at the top right`

### Task 3: Account and Lists titles in the phone header

**Files:**
- Modify: `apps/web/src/layout/AppLayout.tsx`, `apps/web/src/screens/Account.tsx`, `apps/web/src/screens/ListsScreen.tsx`, `apps/web/src/styles/app.css` (add `.mm-page__title`)
- Test: `apps/web/src/layout/AppLayout.test.tsx`, `apps/web/src/screens/Account.test.tsx`, `apps/web/src/screens/ListsScreen.test.tsx` (create if missing), `apps/web/e2e/lists.spec.ts` (its phone heading check keeps passing: the heading now lives in the header)

**Interfaces:**
- Produces: in `AppLayout.tsx`, `const HEADER_TITLES: Record<string, string> = { "/account": "account.title", "/lists": "lists.title" }`, matched on the exact path (a list's own page `/lists/<id>` is not matched). On phones, when it matches, the header renders back button, `<h1 className="mm-page__title">{t(key)}</h1>` (left-aligned beside the arrow, `flex: 1; min-width: 0`, ellipsis on overflow, 18 px, weight 700), then `status` on the right. The focus effect keeps targeting the page's `h1`, now the header one.
- `Account` and `ListsScreen` render their own `h1.mm-screen__title` only when `useLayout() === "desktop"`. On phones, Lists keeps its **New list** button at the top of the content, right-aligned.

- [ ] **Step 1: Write the failing tests**
  - AppLayout: `shows the page title in the header on phones` — phone at `/account` → the `header` contains `heading level 1 "Account"`; at `/lists` → `"Lists"`; in both, exactly one `h1` in the document, and it has focus after navigation.
  - `keeps other titles in the page` — phone at `/lists/abc` → the header has no heading.
  - Account and Lists: `show their title in the page on desktop` — desktop → `heading level 1` inside the screen; phone → no `h1` inside the screen; Lists on a phone still shows the **New list** button.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- AppLayout Account ListsScreen` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified, using tokens for type and spacing.
- [ ] **Step 4: Run** the same command and `pnpm --filter @magomap/web e2e -- lists`, then `./scripts/gate.sh main` → `GATE: PASS`. Screenshots of both headers on a phone, both themes, in Korean and English.
- [ ] **Step 5: Commit** `fix(web): Account and Lists titles sit in the phone header`

### Task 4: Choose the theme on the Account page

**Files:**
- Create: `apps/web/src/theme.ts`
- Modify: `apps/web/src/styles/tokens.css` (the dark block at line 78), `apps/web/index.html` (inline script before the stylesheet; `theme-color` meta), `apps/web/src/screens/Account.tsx` (select under Language), `apps/web/src/i18n/en.json`, `ko.json`
- Test: `apps/web/src/theme.test.ts` (create), `apps/web/src/screens/Account.test.tsx`

**Interfaces:**
- Produces, in `theme.ts`:
  - `type ThemeChoice = "system" | "light" | "dark"`
  - `storedTheme(): ThemeChoice` — reads `localStorage["mm.theme"]`; anything else or a storage error → `"system"`.
  - `applyTheme(choice: ThemeChoice): void` — `system` removes `data-theme` from `<html>`; `light`/`dark` set it. Also sets `<meta name="theme-color">` to the resolved theme's background (light: today's `#1F6F5C`; dark: the dark `--color-bg` value) and keeps it in step with the system while `system`.
  - `setTheme(choice: ThemeChoice): void` — saves (try/catch) and applies.
- `tokens.css`: the dark tokens apply under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` **and** under `:root[data-theme="dark"] { … }`; `:root[data-theme="light"]` and `[data-theme="dark"]` set `color-scheme` accordingly. Keep a single source for the dark values (e.g. both selectors on one rule outside the media query is not possible, so the builder may duplicate the block once, with a comment, or use a shared custom-property set — the choice is theirs; the values must not drift).
- `index.html`: a tiny inline script reading `mm.theme` and setting `data-theme` before CSS loads (no flash).
- Account: a select labelled `account.theme` "Theme" with options `account.themeSystem` "Same as this device", `account.themeLight` "Light", `account.themeDark` "Dark", styled like the Language select.

- [ ] **Step 1: Write the failing tests**
  - theme: `defaults to the device's setting` — empty storage → `storedTheme() === "system"`; garbage value → `"system"`.
  - `applies and remembers a choice` — `setTheme("dark")` → `document.documentElement.dataset.theme === "dark"`, `localStorage["mm.theme"] === "dark"`; `setTheme("system")` → no `data-theme`.
  - `survives blocked storage` — `localStorage.setItem` throws → `setTheme("light")` still applies `data-theme="light"`.
  - Account: `chooses the theme` — select "Dark" in the "Theme" field → `data-theme="dark"` on `<html>`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test -- theme Account` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** the same command; then an e2e check in `phone-layout.spec.ts`: `a chosen dark theme opens dark` — `page.emulateMedia({ colorScheme: "light" })`, set `mm.theme = "dark"` via `addInitScript`, load `/` → `html[data-theme="dark"]` and the computed `--color-bg` is the dark value. Then `./scripts/gate.sh main` → `GATE: PASS`. Screenshots of the Account page in Light and Dark on a phone and on desktop.
- [ ] **Step 5: Commit** `feat(web): choose light, dark or the device's theme`
