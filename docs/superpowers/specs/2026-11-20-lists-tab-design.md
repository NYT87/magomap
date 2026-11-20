# One Lists tab, and import from kakao-list in Account — short design

Small change to the magomap PWA (apps/web), agreed with the owner on 2026-11-20.

## Why

- **Import wording.** magomap never talks to Kakao directly: it reads what the kakao-list extension synced to the kakao-list server. Saying "Import from Kakao" hides the step she must do first (sync in the extension).
- **Lists.** Today the map has a list picker (switches: which lists show on the map) and the Lists tab is a separate browser (rows that open a list). They show the same lists twice. The owner wants one place: the Lists tab, where a switch toggles a list on the map and tapping the row opens it.
- **Empty sections.** The owner has no lists made in magomap, yet "My lists" still shows a heading with nothing under it.
- **Import isn't a daily action.** It has its own tab today; the owner wants it as a section of the Account screen instead.

## Goals

1. The import screen's title and start button say **kakao-list**: "kakao-list에서 가져오기" / "Import from kakao-list".
2. The **Lists tab** is the one place to choose what shows on the map:
   - every list row has a **switch** (on the map or not) and **opens the list** when the rest of the row is tapped;
   - the "Saved, not in a list" row has a switch too;
   - each section keeps **Show all / Hide all**;
   - followed lists keep their **owner's name**;
   - the **Show previous locations** switch sits at the bottom of the tab.
3. The map's own picker goes away:
   - **phone:** the map's lists button navigates to the Lists tab instead of opening a sheet;
   - **desktop:** the side panel's home view keeps search and "places in view", without switches; the Lists tab opens in the same panel, with the map still beside it.
4. A section (My lists, Kakao lists, Subscribed in Kakao) shows **only when it has at least one row** (the "Saved, not in a list" row counts for My lists). With no rows anywhere, the screen shows the existing hint. The **New list** button stays at the top of the screen.

5. **Import moves into Account.** The Import tab goes away (the tabs become Map, Lists, Account). The Account screen gets an **"kakao-list에서 가져오기 / Import from kakao-list"** section with everything the Import screen has today: the lead, the offline note, the start/again button, progress, the summary, errors and the last import.

## Non-goals

- Syncing visibility between devices. It stays as today: remembered per account on each device (`mapPrefs`, localStorage).
- Changing other Kakao wording that is really about Kakao: "Removed from Kakao", "Open in Kakao Map", "read-only, change it in Kakao Map", "Subscribed in Kakao".
- New ways to filter (by city, "only this list"), or reordering lists.

## Anti-goals

- Two places to manage lists (keeping the sheet as well).
- A switch that is hard to hit or that also opens the list: the switch and the row link are separate targets, each at least 44 px, and the switch never navigates.

## Approaches

1. **Chosen: move the picker's behaviour into the Lists tab's rows.** Reuse the existing `Switch` and the section show/hide-all logic from `map/ListPicker.tsx` inside `screens/ListsScreen.tsx`; remove the map sheet and the desktop panel's picker. One screen, no duplicate state; the visibility store (`useMapPrefs`) is unchanged.
2. Keep the picker and add switches to the Lists tab as well — rejected: two places to manage the same thing, which is what the owner wants gone.
3. A new combined screen replacing both — rejected: more change than needed; the Lists tab already has the rows, sections, empty hint and New list button.

## Decided

- Wording (ko/en): `import.title` and `import.start` name kakao-list; the lead already does. Strings stay in both `ko.json` and `en.json`.
- Row layout: swatch, name, count (and "by owner" on followed lists), chevron, then the switch at the end. The switch's accessible name is the list's name ("Show B2I on the map" style label), state announced as on/off.
- Phone map: the lists button keeps its place and icon, but goes to `/lists`.
- Desktop home panel: search + missing-location note + places in view.
- (Owner's request, mid-planning.) Import section placement and links — my calls: the section sits right after the signed-in card, before language; the old `/import` address redirects to `/account` so old links still land on it; the hints that say "import your Kakao lists" (empty map, empty Lists) say where it is now: "…from kakao-list in Account". The window title loses the Import entry.
- Empty sections hidden per goal 4.

## Left to the builder

- Exact component split (e.g. whether `ListPicker` is deleted or reduced to shared pieces), and test placement — following the existing tests in `map/ListPicker.test.tsx` and the e2e specs.
- Exact wording of the switch's accessible label in both languages, consistent with the existing `picker.*` strings.
