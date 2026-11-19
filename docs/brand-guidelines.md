# Brand Guidelines v1.0

> Last updated: 2026-11-19
> Status: Draft. Every choice here is the designer's call, open to the owner's correction.

## Quick Reference

| Element | Value |
|---------|-------|
| Primary Color | #1F6F5C |
| Secondary Color | #B4552A |
| Primary Font | Pretendard |
| Voice | Warm, Calm, Personal |

**The idea in one line:** magomap is your own map, shaped by you. It is named after **Mago Halmi (마고할미)**, the giant creation goddess of Korean mythology who sculpted the mountains, rivers and islands. In magomap, each person shapes their own personal geography: the places they keep, and what they remember about them.

**The balance:**
- **Use** should feel as easy as Kakao Map. People shouldn't have to learn anything new.
- **Identity** is its own: earthy, hand-made and personal, drawn from the Mago story.
- It must never look like Kakao. **No Kakao yellow (#FEE500)**, Kakao logos or Kakao fonts. kakao-list and Kakao Map are referred to, not imitated.

---

## 1. Color Palette

The colours come from the land Mago shaped: pine-covered mountains, clay earth, rivers, and paper (hanji, 한지) for the place you write.

### Primary Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Pine (솔) | #1F6F5C | rgb(31,111,92) | Primary actions, links, active toggles, own-list default marker |
| Pine Deep | #185848 | rgb(24,88,72) | Hover/pressed, emphasis text on paper |

### Secondary Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Clay (흙) | #B4552A | rgb(180,85,42) | Accents: the "Moved" note, previous-location markers' outline, highlights on the homepage |
| River (강) | #2F6FA3 | rgb(47,111,163) | Information and links inside notes, the "my location" dot |

### Neutral Palette

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Hanji (Background) | #FBF8F2 | rgb(251,248,242) | Page and panel backgrounds |
| Surface | #F3EEE4 | rgb(243,238,228) | Cards, sheets, diary entries |
| Ink (Text Primary) | #1E2321 | rgb(30,35,33) | Headings, body text |
| Stone (Text Secondary) | #5E6660 | rgb(94,102,96) | Dates, captions, addresses |
| Border | #E3DCCF | rgb(227,220,207) | Dividers, input borders |

### Dark Theme

| Name | Hex | Usage |
|------|-----|-------|
| Night Background | #141816 | Page background |
| Night Surface | #1D2220 | Cards, sheets, panel |
| Night Text | #E8E4DC | Body text |
| Night Text Secondary | #A7AFA9 | Captions |
| Night Border | #2E3532 | Dividers |
| Pine (dark) | #6FC2A8 | Primary on dark; text on it uses #141816 |
| Clay (dark) | #E38B5E | Accent on dark |
| River (dark) | #7DB3E0 | Info on dark |

### Semantic Colors

| State | Hex | Usage |
|-------|-----|-------|
| Success | #2E7D4F | "Synced", saved confirmations |
| Warning | #A86A12 | "Offline — N changes saved on this phone", pending |
| Error | #B3261E | "Couldn't be saved", destructive confirmations |
| Info | #2F6FA3 | Neutral notices (uses River) |

### Map Markers

- **Kakao lists** keep Kakao's own favourite colours (`KAKAO_PLACE_COLORS`), so places look the way she knows them from Kakao Map.
- **Own lists** choose from 8 brand-derived presets: Pine #1F6F5C, Clay #B4552A, River #2F6FA3, Persimmon #D9662B, Plum #7A4E7E, Moss #6B7A2F, Slate #4A5A68, Rose #B84A62.
- **Previous locations** use the place's colour at 45% opacity, with a 1.5 px Clay outline.
- **Search results** are hollow rings in Ink, to set them apart from saved places.

### Accessibility

These contrast ratios are measured:
- Ink on Hanji: 15.0:1 (AAA).
- Stone on Hanji: 5.6:1, and on Surface 5.1:1 (AA).
- Pine on Hanji: 5.7:1. White on Pine: 6.0:1 (AA).
- Clay on Hanji: 4.6:1 (AA). River on Hanji: 5.1:1 (AA).
- Dark theme: Night Text on Night Background 14.1:1, and Pine (dark) on Night Background 8.5:1.
- Colour is never the only signal. Markers carry shapes or labels, and sync states carry text.

---

## 2. Typography

### Font Stack

```css
--font-heading: 'Pretendard', system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
--font-body: 'Pretendard', system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
--font-display: 'Gowun Batang', 'Nanum Myeongjo', serif; /* homepage titles and the wordmark only */
--font-mono: ui-monospace, 'SF Mono', Menlo, monospace;
```

- **Pretendard** handles Korean and Latin evenly, is open-source (SIL OFL), and stays readable at small sizes. The app self-hosts it from the `pretendard` npm package, so offline use works.
- **Gowun Batang** (Google Fonts, SIL OFL) adds a quiet, storybook feel. It is used on the homepage and in the wordmark only, **never inside the app UI**.

### Type Scale

| Element | Size (Desktop) | Size (Mobile) | Weight | Line Height |
|---------|----------------|---------------|--------|-------------|
| H1 | 32px | 26px | 700 | 1.25 |
| H2 | 24px | 22px | 600 | 1.3 |
| H3 | 20px | 18px | 600 | 1.35 |
| H4 | 17px | 17px | 600 | 1.4 |
| Body | 16px | 16px | 400 | 1.6 |
| Body Large | 18px | 17px | 400 | 1.65 |
| Small | 14px | 14px | 400 | 1.5 |
| Caption | 12px | 12px | 500 | 1.4 |

- Diary entries use Body Large, so they read like writing, not like data.
- Korean text uses `word-break: keep-all`, so words aren't split mid-word.

### Font Loading

```html
<!-- Homepage only; the app self-hosts Pretendard -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap" rel="stylesheet">
```

---

## 3. Logo Usage

**The mark: "the shaped peaks"** (chosen 2026-11-19).
- Two hand-shaped peaks, the land Mago sculpted, whose outline quietly forms an "m".
- A clay pin sits on the higher summit: a place that is yours.
- It is drawn on a 64-unit grid: peaks in Pine, pin in Clay, and the pin hole in Hanji.
- On dark, the peaks are Pine (dark) `#6FC2A8`, the pin is Clay (dark) `#E38B5E`, and the hole is Night `#141816`.
- **No river line under the peaks** (owner's decision). The mark is only the peaks and the pin.

The wordmark `magomap` is in lowercase Gowun Batang 700, with `마고맵` in Pine beneath it as the Korean line.

**App icon:** a Pine square holding Hanji peaks and a light-clay pin (`#E38B5E`), with a Pine hole. It is full-bleed, so the same artwork also serves as the maskable icon; the maskable version scales the mark down to keep it inside the central 80%.

### Variants

| Variant | File | Use Case |
|---------|------|----------|
| Lockup (mark + wordmark) | `assets/brand/magomap-lockup.svg` | Homepage header, README. The text uses Gowun Batang, so load that font or outline it before using the file elsewhere |
| Mark | `assets/brand/magomap-mark.svg` | Light backgrounds; also `icons/favicon.svg` |
| Mark (dark) | `assets/brand/magomap-mark-dark.svg` | Dark backgrounds |
| Monochrome | `assets/brand/magomap-mark-mono.svg` | One-colour contexts |
| App icon | `assets/brand/icons/app-icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon-180.png` | PWA manifest, iOS home screen |
| Maskable icon | `assets/brand/icons/app-icon-maskable.svg`, `icon-maskable-512.png` | PWA manifest (`purpose: "maskable"`) |

### Clear Space

The minimum clear space equals the height of the pin's head.

### Minimum Size

| Context | Minimum Width |
|---------|---------------|
| Digital - Full Logo | 120px |
| Digital - Icon | 24px |
| PWA icon | 192px and 512px; the maskable version keeps the mark inside the central 80% |

### Don'ts

- Don't use Kakao yellow, or anything that looks like a Kakao mark.
- Don't rotate, skew or add effects.
- Don't change the colours outside this palette.
- Don't place it on busy map tiles without a Hanji or Night plate behind it.

---

## 4. Voice & Tone

### Brand Personality

| Trait | Description |
|-------|-------------|
| **Warm** | Like a friend who remembers the places with you |
| **Calm** | Quiet, unhurried, never alarming, even when something fails |
| **Personal** | It's *her* map and *her* notes; the app stays in the background |
| **Clear** | Plain words in both languages; no technical terms |

### Voice Chart

| Trait | We Are | We Are Not |
|-------|--------|------------|
| Warm | Kind, encouraging | Cute, gushing, emoji-heavy |
| Calm | Reassuring, steady | Alarmist, shouty (no ALL CAPS, no "!!") |
| Personal | "Your places", "your notes" | Social, "share with friends", growth-hacky |
| Clear | Short sentences, everyday words | "Sync conflict", "mutation", "payload" |

### Korean and English

- **Korean** uses 해요체 (polite and friendly), for example "저장했어요", "다시 시도해 주세요". Never 합니다체 in the UI, and never 반말.
- **English** uses sentence case for everything, including buttons, and contractions ("can't", "you'll").
- Write each language naturally; don't translate word for word. The two may differ in length and order.

### Tone by Context

| Context | Tone | Example (EN / KO) |
|---------|------|---------|
| Homepage | Inviting, story-led | "Shape your own map." / "나만의 지도를 빚어 보세요." |
| Empty diary | Gentle nudge | "No visits yet. What was it like?" / "아직 방문 기록이 없어요. 어땠나요?" |
| Saved offline | Reassuring | "Saved on this phone. It'll sync when you're back online." / "이 휴대폰에 저장했어요. 연결되면 자동으로 동기화돼요." |
| Error | Calm, with a next step | "Couldn't reach the server. We'll keep trying." / "서버에 연결하지 못했어요. 계속 다시 시도할게요." |
| Destructive confirm | Plain about consequences | "Delete this place? Its 3 notes are kept if you save it again." / "이 장소를 삭제할까요? 다시 저장하면 메모 3개가 돌아와요." |
| Success | Brief | "Imported 12 places." / "장소 12곳을 가져왔어요." |

### Prohibited Terms

| Avoid | Reason |
|-------|--------|
| Sync conflict / mutation / payload / 동기화 충돌 | Technical; say what happened to *her* notes instead |
| Oops! / 앗! | Flippant when something failed |
| Seamless, revolutionary, AI-powered | Empty claims |
| Kakao-branded wording ("카카오 공식", "Kakao app") | We're independent; say "Kakao Map" only to refer to it |
| Users / 사용자 (in UI copy) | Speak to "you" (생략 in Korean) |

---

## 5. Imagery Guidelines

### Photography Style

- **The places themselves:** cafés, streets, coastlines and mountains in Korea, in natural light.
- **No people posing with phones**, and no stock "happy users".
- **Colour treatment:** slightly warm and slightly muted, sitting well on Hanji.

### Illustrations

- **Style:** simple ink-line landscapes (mountain ridges, river curves, islands), like a hand-drawn map margin. Flat fills from the palette, with no gradients.
- **Line weight:** 1.5–2 px, round caps.
- **Use:** homepage hero, empty states, the not-invited page. **Never on the map itself.**

### Icons

- **Style:** outlined, on a 24 px grid, with a 1.75 px stroke and round joins.
- **Set:** Lucide, for consistency and an open licence, plus three custom icons: diary (an open notebook with a pin), moved (a pin with a dotted trail), and previous location (a hollow pin).

---

### Banners

The banners are in `assets/banners/launch/`. Regenerate them with `banner.html?style=ink|type|product&w=…&h=…`.
- **Type-led (`type`)** is used where the banner is seen small: the share card (`type-1200x630.png`) and GitHub's social preview (`type-1280x640.png`).
- **Ink-line landscape (`ink`)** is used where it's seen large: the homepage hero (`ink-1920x720.png`) and the README header (`ink-1280x400.png`).
- **Product shot (`product`)** is kept for later use, for example a store listing or a release post.

## 6. Design Components

### Buttons

| Type | Background | Text | Border Radius |
|------|------------|------|---------------|
| Primary | #1F6F5C | #FFFFFF | 12px |
| Secondary | Transparent | #1F6F5C | 12px |
| Tertiary | Transparent | #5E6660 | 12px |
| Destructive | #B3261E | #FFFFFF | 12px |

Every button is at least 44 px tall.

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Tight spacing |
| sm | 8px | Compact elements |
| md | 16px | Standard spacing, the phone gutter |
| lg | 24px | Section spacing |
| xl | 32px | Large gaps, the desktop panel padding |
| 2xl | 48px | Section dividers (homepage) |

### Border Radius

| Element | Radius |
|---------|--------|
| Buttons | 12px |
| Cards | 16px |
| Inputs | 12px |
| Modals | 20px |
| Bottom sheets | 20px (top corners) |
| Pills/Tags | 9999px |

### Elevation

- Shadows are soft and warm, never grey-blue: `0 1px 2px rgba(30,35,33,.06), 0 4px 16px rgba(30,35,33,.08)`.
- Sheets and the desktop panel sit on the map with this shadow, plus a 1 px Border.

---

## AI Image Generation

### Base Prompt Template

Always prepend this to image generation prompts:

```
Calm hand-drawn Korean landscape in ink-line style, pine green #1F6F5C, clay #B4552A, river blue #2F6FA3 on warm hanji paper #FBF8F2, soft natural light, flat fills, generous empty space, quiet and personal mood
```

### Style Keywords

| Category | Keywords |
|----------|----------|
| **Lighting** | soft, natural, early morning |
| **Mood** | calm, personal, warm, unhurried |
| **Composition** | lots of negative space, centred subject, horizon low |
| **Treatment** | muted, warm, paper texture |
| **Aesthetic** | ink-line illustration, hand-drawn map, Korean landscape |

### Visual Mood Descriptors

- A map drawn by hand in a personal notebook.
- Mountains, rivers and islands, as if just shaped.
- Quiet places you want to remember.

### Visual Don'ts

| Avoid | Reason |
|-------|--------|
| Kakao yellow or Kakao-like characters | Independence from Kakao, and trademark respect |
| Literal depictions of the goddess Mago | Respect for the myth; the story is a quiet reference, not a mascot |
| Neon, glossy 3D, gradients | Breaks the calm, paper-like feel |
| Crowds, selfies, social-media framing | magomap is personal, not social |

### Example Prompts

**Hero Banner:**
```
[base prompt], a winding river between pine-covered mountains leading to small islands, three tiny map pins marking places along the river, wide banner composition
```

**Social Media Post:**
```
[base prompt], a single open notebook on paper showing a hand-drawn map with one pin and handwritten-looking lines, square composition
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-11-19 | Initial guidelines: the Mago origin, the earthy palette, Pretendard and Gowun Batang, bilingual voice |
| 1.1 | 2026-11-19 | Logo chosen: "the shaped peaks" (concept B, without the river line). Mark, lockup and PWA icons added in `assets/brand/` |
