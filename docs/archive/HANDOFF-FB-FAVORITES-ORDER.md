# HANDOFF-FB-FAVORITES-ORDER: custom order for launcher favorites

**Batch 4 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: medium.** Decisions made; execute,
verify, commit.

Matt: "Allow custom order for favorites."

## Current state (verified)

`gamehub.favorites.v1` = `{ version:1, ids:[...], updatedAt }` (`js/favorites.js:5,13`), ids
are hub registry ids. The launcher renders favorites first but **alphabetically by displayed
title** (`js/hub.js:258-271`), so the ids array's order is currently ignored. No reorder UI.
Favorites are preferences under THE LAW's rule-2 carve-out (recreatable in one tap) — reorder
and removal are allowed; nothing here touches stats.

## Decisions

1. **The `ids` array becomes the display order.** The favorites group renders in array order
   (drop the `byTitle` sort for that group ONLY — the non-favorites group stays alphabetical,
   and the hub-games-alphabetical rule now applies to the "All games" group; note the changed
   scope in the code comment there). `toggleFavorite` already appends on add, so a new
   favorite lands at the end of the group.
2. **Reorder UI: an edit mode on the launcher, arrow-based (no drag).** Next to the favorites
   group divider, a small "Reorder" ghost button (hidden when fewer than 2 favorites). Tapping
   it toggles edit mode: each favorite tile shows ↑ / ↓ buttons (44px targets), tapping moves
   the game one slot, persisted immediately via a new `moveFavorite(id, delta)` in
   `js/favorites.js` (pure array splice, same normalize/validate discipline as the module's
   existing functions). The button reads "Done" while in edit mode. Edit mode suppresses
   card navigation on the favorite tiles so a mis-tap can't launch a game.
3. Strings (`js/strings.js`, `hub_` keys): Reorder / Done + aria-labels for the arrows, EN+ES.
4. No new storage key, no version bump of the shape — array order was always there, we are
   just honoring it (additive semantics).

## Verification

1. `node run-all-tests.mjs` green.
2. `node server.mjs`: favorite 3 games, reorder them, reload — order sticks; unfavoriting and
   re-favoriting appends at the end; non-favorites stay alphabetical in EN and ES (titles sort
   differently per language — that stays true); edit mode can't launch a game by mis-tap.
3. Keyboard: the arrow buttons are real buttons, tabbable, with aria-labels.
4. `sw.js` CACHE bump as the LAST edit before commit.
