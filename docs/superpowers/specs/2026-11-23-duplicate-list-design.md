# Duplicate a list — design

From the owner's request on 2026-11-23, with the calls below marked as the designer's. Size: a project, in two parts: a local copy (buildable now) and a copy on Kakao Map (needs two Kakao calls nobody has captured yet).

## Why

She and the owner build lists of places. He wants to start a new list from an existing one: from one of his own lists ("two lists with the same content"), or from a list his wife owns and he only follows ("a copy on my account"). For a Kakao list he wants the copy to exist on Kakao Map too, so it shows in Kakao Map and syncs back; when he doesn't want that, a copy that lives only in magomap.

## What he wants

1. A **Duplicate** action on a list.
2. A new list with the places the source list has now.
3. On a Kakao list, a prompt: create the copy on Kakao Map too (a new Kakao list holding all the places), or copy only in magomap.
4. Works for a Kakao list he owns and for one he follows. The Kakao part is not offered for lists that aren't Kakao lists.

## Goals

- A local copy works for every list: own, Kakao owned, Kakao followed. It is an own list, editable and removable like any, so it also works offline.
- The Kakao copy creates a **new Kakao list** on his Kakao Map account and puts every place that has a Kakao place id into it, then brings it into magomap by the existing Sync from Kakao Map.
- Nothing is changed in the source list, and a Kakao list he doesn't own is never written to.

## Non-goals

- Copying notes: Kakao notes belong to the source's list item (and on his wife's list they are hers); diary notes and links belong to the place and are already his. Only places are copied, each with its colour (agreed 2026-11-23): an own-list item carries the Kakao colour code of the place it was copied from, and the Kakao copy sends it. *(Designer's call on notes.)*
- Places with no Kakao place id (a custom pin, an address favourite) in the Kakao copy: they are left out and counted in the result.
- The Kakao copy on a phone or without the extension: not offered (the local copy still is).
- Merging a copy back, or keeping a copy in step with its source.
- Duplicating "Saved" (it isn't a list).

## Anti-goals (failure even if it "works")

- A list written into the wrong person's Kakao Map (a different Kakao account signed in than the one linked to his magomap account).
- Two Kakao lists created by one confirmation (a retry or double tap), or a Kakao list left half-filled with no way to know.
- Two copies in magomap for one Kakao copy: the Kakao option makes the Kakao list and lets sync bring it in; it does not also make a local own list. *(Designer's call.)*
- The source list changed or its places lost.

## Approaches considered

- **Local copy now, Kakao copy behind an owner gate (chosen).** The local part needs nothing new. The Kakao part needs Kakao Map's create-list and add-places requests, which have to be captured from his browser first; guessing them could write to the wrong place in Kakao.
- Build both together after capturing: delays the part that already works.
- Kakao copy first, local later: the opposite of what is possible today.

## Design

**Local copy.** `duplicateList(sourceListId, name)` writes one new own list (`provider: null`) and one own-list item per live place of the source (item not deleted, not removed from Kakao), in the source's order, in one local transaction (so it syncs like any change, and works offline). The default name is "<source name> (copy)" (Korean: "<이름> (복사본)"); the dialog lets him change it; a blank name is refused. After it, the app opens the new list.

**The prompt.** A **Duplicate** button on a list's page opens a dialog with a name field and two actions: "Copy in magomap" (always) and "Copy to Kakao Map" (only for a Kakao list, on a computer with the extension; otherwise absent, with a line saying why).

**Kakao copy.** The app asks the extension to (1) say which Kakao Map account is signed in on that page and compares it with the account linked to his magomap account (the sync's existing binding); a mismatch stops everything; (2) create the Kakao list; (3) add the places in pages (the page size is whatever Kakao Map's own page sends), skipping any already in it; the result is `{ created, added, skipped }`. The new Kakao list's id is kept so a retry fills the same list rather than making another. Then the app runs Sync from Kakao Map so the new list appears as his own Kakao list.

**Owner gate.** Kakao Map's create-list and add-places requests are undocumented. Before the extension work, the owner captures, in the Network tab of his browser on map.kakao.com while creating a list and adding a place to it: the URL, method and JSON body of each request, and the response JSON, with no cookies or headers. They go into `docs/kakao-map-access.md`.

## Constraints

- Kakao writes happen only inside a `map.kakao.com` tab through the extension, sending what Kakao Map's own page sends (as the note editing in `2026-11-21-extension-editing-design.md` does).
- No Kakao write without the account check, and none to a list he doesn't own.
- The Kakao copy needs a connection and the extension; the local copy needs neither.
- Strings in Korean and English; both themes; 44 px targets.

## Left to the builder

- The dialog's visual layout, the progress wording, and how the page size is chosen once the capture is known.
- Where the extension keeps the created list's id between a failure and a retry.

## Done when

- Duplicating an own list, a Kakao list he owns, and one he follows each makes a new own list with the same places in the same order; the source is unchanged; a blank name is refused.
- With the capture done: "Copy to Kakao Map" creates one new Kakao list with the places, a retry fills the same list, and after the sync it shows in magomap as his Kakao list with no extra local copy.
- A mismatched Kakao account, a missing extension, and a failure midway each show a clear message and leave nothing half-claimed as done.
