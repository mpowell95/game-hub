# HANDOFF-FB-CHINCHON: auto-close on a fully melded hand, setup screen cleanup

**Batch 6 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: medium-high.** Decisions made; execute,
verify, commit. Read `chinchon/CLAUDE.md` and the "Multiplayer lockstep — invariants" section
of `js/CLAUDE.md` BEFORE touching the close flow — Chinchón is one of the two lockstep MP
games and `test-mp-lockstep.mjs` mirrors its UI glue.

## 1. Auto-close when the hand is fully melded (Matt: "when closing with sets of 3 and 4, don't give option to close. Close automatically")

Current flow (verified): when eligible, the engine awaits `decideClose` and the human gets a
Close round / Keep playing prompt (`chinchon/js/game.js:447-455`, `chinchon/js/ui.js:713`,
`:981`, `:1114-1116`). A hand of two complete melds covering all 7 cards is `doubleMeld`
(scores −10, `chinchon/js/meld.js:222-225`); the 7-card single-suit run is `chinchon`
(`meld.js:205-219`); classification priority in `classifyClosingHand` (`meld.js:238-266`).

Decisions:

- When the close decision is offered AND the human's best arrangement has **zero leftover
  cards** (classification `chinchon` or `doubleMeld`), **resolve the close automatically as
  yes** — no prompt. There is no rational reason to keep playing either hand: chinchón ends or
  dominates the match, and a doubleMeld (−10) cannot be improved by drawing (it is already
  perfect; only a 7-card straight-flush would beat it and you cannot get there from two mixed
  melds without first unmaking them).
- Implement at the PROMPT layer, not the engine: `promptClose()` (or its caller) computes the
  classification for the human's hand and, on zero leftover, resolves `true` immediately and
  shows the normal closing banner/toast (the player must still SEE what happened — show the
  classification result exactly as if they had tapped Close). The engine's
  `decideClose`-driven flow, event order, and MP move emission stay byte-identical — an
  auto-yes is indistinguishable from a fast tap, which is what keeps the lockstep invariants
  and `test-mp-lockstep.mjs`'s mirror untouched. If you find yourself editing `game.js` or the
  MP glue, stop and rethink.
- Partial closes (leftover 1-3 under `maxClose`) keep the prompt exactly as today — Matt's
  instruction covers only the fully melded case.
- AI players: unchanged (their `decideClose` policy is theirs).

## 2. Setup screen cleanup (Matt: "Remove 'Ana banana'. it scrolls a little bit. I dont like that. have the players thing default to being collapsed")

Verified state: the giant gold "Ana Banana" header line is the anita deck's rebrand of the
title (`chinchon/js/ui.js:487-488`); the accordion already collapses every row on entry
(`_setupExpanded = null`, `ui.js:325`) — but Matt's screenshots show the players row open with
three name fields, so something re-opens it in practice; and the setup card overflows a phone
viewport when a row is open (the compact pass `fitToViewport` targets the game screen, not
setup, `ui.js:300-310`).

Decisions:

1. **Delete the Ana Banana title rebrand** (`ui.js:487-488` renders plain `t('title')`
   regardless of deck). The deck keeps its name in the Card deck row and in `cards.js` —
   nothing else about the deck changes. Also remove the now-dead `.cc-title-anita` /
   `.cc-title-bonita` CSS.
2. **Find and kill whatever re-opens the players row.** Reproduce first (change player count,
   return from a finished match, switch Solo/Host/Join — one of these paths expands it);
   the row must start collapsed on every entry to the setup screen. Report in the commit
   message which path it was.
3. **No scroll at phone height with all rows collapsed:** tighten the setup card's vertical
   rhythm (stats line, mode segment, row heights, start-button margins) until the whole screen
   fits 375x812 with zero page scroll. An OPEN accordion row may still scroll if it genuinely
   cannot fit — that is acceptable; the resting state is not allowed to.
4. While in the file: the difficulty label "Average" is being renamed by the
   HANDOFF-FB-SETUP-CONVENTIONS batch — do not touch difficulty labels here; avoid colliding
   edits (see the index doc's sequencing).

## Verification

1. `node run-all-tests.mjs` green — `test-mp-lockstep.mjs` especially; if it fails, the close
   change leaked into the glue (see decision above).
2. Solo: rig a hand to two complete melds (use the engine test helpers in `chinchon/js/` the
   existing tests use) — the round closes itself with the −10 banner; a 1-leftover hand still
   prompts. Chinchón hand: auto-closes, match ends per `winWithChinchon`.
3. MP smoke (two browser tabs, Host/Join): human auto-close mid-match keeps both clients in
   lockstep (no desync banner, hashes agree), guest sees the close normally.
4. Setup at 375x812: no Ana Banana header, no scroll with rows collapsed, players collapsed
   on every entry path. EN and ES.
5. `sw.js` CACHE bump LAST; update `chinchon/CLAUDE.md` (auto-close rule + setup notes), rule 9.
