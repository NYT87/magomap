# Text that follows the device's text size — design

Agreed with the owner on 2026-11-20 (approach A).

## Why

Every text size in the web app is a fixed pixel value (`body` 16px, 40 `font-size` rules from 11px to 26px in `apps/web/src/styles/app.css`). Text grows with page zoom but not with the device's text-size setting. The owner's wife uses an **iPhone**, where Safari only passes the system **Text Size** (Dynamic Type) to pages that opt in with the `-apple-system-body` font, so switching units alone would do nothing for her.

## Goals

1. On iPhone Safari (and the installed PWA), magomap's text follows Settings → Display & Brightness → Text Size, and Accessibility → Larger Text, up to a cap.
2. On other browsers, text follows the browser's default font size setting (rem).
3. Growth is capped at **2×** the normal size (a base of 32px), so the map screen, the header, sheets and the bottom nav stay usable.
4. Layouts stretch instead of overlapping or clipping when text is larger: controls grow with their text, and the phone map-button column sits below the search bar however tall it is.

## Non-goals

- The marketing homepage (`apps/homepage`): separate site, untouched.
- Map content: pins and clusters (the cluster count stays 13px inside its fixed circle) and the map providers' own controls (Kakao Map, Leaflet zoom and attribution).
- An in-app text-size setting (approach C).
- Changing spacing, radii or icon sizes to rem; only text, and the boxes that hold text, adapt.

## Anti-goals

- Text that overlaps, is clipped, or pushes a control off-screen at the largest capped size.
- Tap targets shrinking below 44 × 44 px at any size.
- A visible change on desktop or Android at default settings (iPhone may differ slightly, see below).

## Approaches

- **A. rem everywhere + `-apple-system-body` on iPhone, capped at 2× (chosen).** Follows the setting she already uses; the cap keeps the map usable.
- B. rem only. Smaller, but does nothing on her iPhone.
- C. Keep px and add an in-app "Text size" choice. Consistent on every device, but she'd set it separately from her phone, and it's another setting to keep.

## Design

**Base size.**
- `html` uses the browser's default font size (`font-size: 100%`), and on Safari it uses `font: -apple-system-body` (feature-detect with `@supports (font: -apple-system-body)`), then restores the brand font family on `body` as today (`--font-body`).
- At iPhone's default Text Size the base is **17px** (Safari's body size), so text there is about 6% larger than today — the same size as iOS apps' body text. Accepted by the owner. Elsewhere the base stays 16px, so nothing changes at default settings.

**Cap.**
- A single token defines the capped base, e.g. `--text-base: min(1rem, 32px)`, and every text size is written relative to it (e.g. today's 14px becomes `calc(var(--text-base) * 0.875)`; a small helper set of tokens like `--text-sm`, `--text-md`, … is fine). Exact mechanism is the builder's call as long as: one place sets the cap, today's sizes are reproduced exactly at a 16px base, and no rule bypasses the cap.

**Every `font-size`** in `apps/web/src/styles/app.css` becomes relative to the capped base, keeping today's ratios (14px → 0.875, 12px → 0.75, 26px → 1.625, …), including desktop media-query variants.

**Boxes that hold text grow with it.**
- Buttons, inputs, nav items, chips and the sync pill keep their `min-height` (44/48px) as minimums, never fixed `height`, so they get taller when text needs it.
- The phone map-button column (`.mm-map-tools`, today `top` = search bar assumed 48px tall) is placed below the search bar whatever its height (e.g. both in one flex column, or a measured offset); the list-overlay padding keeps clearing it.
- The phone page header (back · title · sync icon) already wraps its title; check it at the cap.
- The bottom nav labels (12px) may wrap or grow the bar; the map notes stack's bottom offset clears the bar at the cap.
- Icon-anchored bits that sit inside fixed-size icons (the sync count badge, the refused-changes dot) stay fixed in px — they live inside a 44px icon and must not outgrow it.

**Checks.**
- Unit/e2e: an e2e in the phone project sets the root font size to the cap (and above it, to prove the cap) and asserts on Map, Lists, Account, a place page and the Sync sheet: nothing clipped horizontally, no element off-screen, tap targets ≥ 44px, the search bar and the button column don't overlap, header title not clipped.
- Screenshots at default and at the cap, phone and desktop, light and dark, Korean and English, for the UI reviewer.
- A manual check on the owner's wife's iPhone at a larger Text Size (owner step), **after merge** — the owner chose to build everything first rather than check `-apple-system-body` on the iPhone up front. If that check shows Safari doesn't pass the size through, a follow-up drops the iPhone hook and keeps the rem conversion (goal 2 still holds).

## Settled after the builder check (planner's calls)

- **The cap is a fixed 32px base** (2× the 16px design base) on every device, including iPhone (where the default is 17px and Larger Text can go far higher — it simply stops at 32px). The e2e proves it by setting the root to 32px and to 48px and getting the same sizes.
- **Widths:** boxes that hold text (chips, the desktop sync pill, nav items, buttons with labels, notes) use `min-width`/`max-width` in the text unit or no fixed width, so text never clips horizontally. Icon-only boxes stay px: the map buttons and `--mm-tools-width: 64px`, the 44px sync icon, the count badge and the refused dot.
- **Heights:** fixed `height` on a control that holds text becomes `min-height` with the same value; icon boxes, the badge (`line-height` and size) and the dot stay fixed.
- **Very tall text:** pages and sheets scroll; at the cap, on the phone map screen, the search bar + bottom nav + notes leave at least half the viewport height as map (e2e asserts it at 390 × 844).
- **e2e mechanics:** the test sets `document.documentElement.style.fontSize` (16px default, 32px cap, 48px over-cap). Korean wraps at spaces (`word-break: keep-all` stays) and must never clip.

## Builder's calls

- The exact token names and how the cap is expressed.
- Whether line-heights need adjusting for the larger sizes (keep unitless line-heights).
- The `-apple-system-body` feature detection form, verified against WebKit docs (put the URL in the commit).
