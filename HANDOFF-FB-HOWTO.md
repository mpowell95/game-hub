# HANDOFF-FB-HOWTO: How-to-play overhauls (Filler, Ball Run, Dots and Boxes, Boggle)

**Batch 1 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md for the full set.**
**For a Sonnet execution session. Recommended effort: medium.** All decisions made; execute,
verify, commit (Matt pushes after review).

One skill, four games: rewrite help sheets to the repo's proven pattern. **The reference is
Tic Tac Toe's How-to-play screen** (`tic-tac-toe/CLAUDE.md` documents the pattern): one bold
goal line, ONE diagram of the single non-obvious mechanic, a plain-word caption, an "X = Y"
example line, then at most a few one-sentence bullets. Matt's standing rule, restated in his
own words in this feedback round: he hates walls of words. Minimal functional text everywhere.
Every string change goes through each game's `strings.js` in BOTH `en` and `es` (Spain
Spanish, no em dashes in user copy); run `node test-i18n-strings.mjs` after.

## 1. Filler — full overhaul (Matt: "I absolutely hate this screen... hundreds of words... You have to scroll to keep reading")

Current sheet is multiple scrolling sections of prose. Replace wholesale with the TTT pattern:

- Goal line: en `Own more than half the board.` / es equivalent.
- One diagram: a small SVG of a corner region flood-filling — your corner cells + an adjacent
  same-color region joining it on a color pick. Compose it; don't reuse the old text sections.
- Caption (one sentence): picking a color captures every touching cell of that color.
- Example line: `Pick blue = every blue cell touching your area joins it`.
- Bullets, maximum three, one sentence each: you can't pick your own or the opponent's current
  color; first to more than half wins; that's it. Delete everything else (strategy tips, color
  lists, setup explanations — all of it).
- Delete the now-unused `strings.js` keys from BOTH languages (orphaned `es` keys fail the
  tripwire; orphaned `en` keys are dead weight — remove both sides).

## 2. Ball Run — replace the 4-slide pager with one sheet (Matt: "very very bad. it doesn't show what the words describe. And the left button brings you back to the first page every time")

Verified from the screenshots: the slides are abstract shapes (a magenta dot on sparse purple
lines) that don't depict the caption underneath, and the left `|←` control is skip-to-FIRST, so
tapping what looks like "previous" always restarts the deck.

- **Kill the pager entirely** (dots, `|←`, `→|`, OK): one static sheet, no pagination.
- Content: goal line (`Survive as long as you can.`), ONE diagram that actually shows the
  mechanic: a finger/arrow dragging horizontally at the bottom and the ball shifting left-right
  on a track with a visible gap ahead. Draw the track as the game draws it (dark track, bright
  edges) so the sheet matches what the player sees in-game.
- Caption: drag anywhere to steer; falling off the track ends the run.
- One bullet max (speed increases as you go). Delete the speedpoint slide's text; the mechanic
  is self-evident in play.
- `ball-run/js/strings.js` holds the current slide copy; same both-languages rule.

## 3. Dots and Boxes — keep the sheet, apply Matt's exact edits

The current sheet (verified in screenshot) is already the right pattern. Four changes, his words:

- Diagram (`_extraTurnDiagram()` in `dots-boxes/js/ui.js:424`): **replace the red checkmark
  inside the completed box with a red fill/shade of the box** (the completed box reads as
  claimed by color, not by a check). Keep the arrow to the next box. Keep contrast high; red
  fill on white with the existing dark outline is fine for Matt's red/green colorblindness
  because the meaning is carried by which box is filled, not by hue distinction.
- Lead (`help_lead`): `Claim the most boxes to win.` → `Fill in the most boxes to win.`
- Caption (`help_caption`): → `Draw the 4th side of a box to fill it in.`
- Example (`help_example`): `Complete a box = You play again` (unchanged if already this).
- Rule (`help_rule`): drop the leading "Otherwise," → `The turn passes to your opponent.`
- Update `es` to match each edited string.

## 4. Boggle — trim the bullet list (Matt: "way too many words")

**Sequencing: HANDOFF-BOGGLE-SPANISH.md is being executed in a parallel session and touches
`boggle/js/ui.js` + `boggle/js/strings.js`. Do not start this section until that work is
COMMITTED; then edit the translated strings (both languages).**

Keep the goal line, the path diagram, its caption, and the corner-to-corner example. Cut the
five bullets to three short ones:

1. Swipe through letters; let go to submit. (Fold "slide back to undo" into this line or drop
   it — one sentence total.)
2. Qu is one tile, two letters.
3. Longer words score more.

Drop the scoring-numbers bullet and the both-find-count bullet entirely. Keep the
words-are-English bullet the Spanish handoff added — that one is load-bearing, not verbosity.

## Verification

1. `node test-i18n-strings.mjs` and `node run-all-tests.mjs` green.
2. `node server.mjs`, open each of the four sheets in EN and ES at phone width: no scrolling
   inside any sheet, each diagram depicts its caption, Ball Run's sheet has no pager controls.
3. `sw.js` CACHE bump as the LAST edit before commit (read current vN then, don't hold it dirty).
