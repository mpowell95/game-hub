# HANDOFF-FB2-INDEX: the 2026-07-24 feedback arc — batch map

Matt's second feedback round (2026-07-24), investigated and organized the same day. Same
conventions as the FB arc: every doc has decisions made and code citations verified against
the working tree; executors commit, Matt reviews and pushes; `sw.js` CACHE bump is the LAST
edit before each commit.

## FIRST: run Snake's dark-mode pass (no new doc needed)

Matt's "snake settings screen is not colorblind friendly / can't read the labels" is
code-verified as a DARK MODE gap, not a palette problem: Snake's setup has no
`:root.gh-dark` override yet, so its near-black ink (`--sn-ink:#1c2410`) sits on the now-dark
hub background. The fix is Snake's already-specced Phase 2 pass in `HANDOFF-FB-THEME.md`.
Run it before or alongside this arc, and give the other unthemed games' setups the same
priority check while Phase 2 proceeds.

```
Read HANDOFF-FB-THEME.md and do Phase 2 for Snake only, as one commit. While in there, verify the setup screen labels are readable in BOTH themes. Do not push.
```

## The batches, in run order (one at a time; A, B, C share files)

| # | Doc | Scope | Effort |
|---|---|---|---|
| A | `HANDOFF-FB2-DIFFICULTY.md` | Colored tier shapes everywhere, Easy/Medium/Hard/Expert rename (display only), Connect Four + Nuts & Bolts setup overflow fixes, N&B How-to button on the difficulty screen, Ball Run setup redesign (no faces, no slider, no blurb) | med-high |
| B | `HANDOFF-FB2-HOWTO2.md` | How-to round 2: Mancala overhaul, Ball Run slideshow RESTORED with real prev button + an obstacles slide, Filler before/after diagram + copy redo, Boggle dedup + cuts, Snake trim, Nuts & Bolts 7→4 bullets | med-high |
| C | `HANDOFF-FB2-BOGGLE-CUE.md` | Remove the dead iOS switch hack; gold visual cue when the traced word is valid and new (Android keeps real vibration) | medium |
| D | `HANDOFF-FB2-STATS-NAV.md` | My Stats and the leaderboard player page both become the leaderboard-style game-list drill-down (kills the 13-tab strip and the giant player scroll) | high |
| E | `HANDOFF-FB2-PARCHIS.md` | Hub language toggle controls Parchís (deliberate precedence reversal); its How-to rebuilt from scratch. Needs the sibling `../Parchís/` source + recombine build | med-high |

Prompts, same shape as always:

```
Read HANDOFF-FB2-INDEX.md, then read and execute HANDOFF-FB2-DIFFICULTY.md. Commit when done. Do not push.
```

(and so on for HOWTO2, BOGGLE-CUE, STATS-NAV, PARCHIS.)

## Decided facts executors must not re-litigate

- iPhone haptics are DEAD for web apps: `navigator.vibrate` doesn't exist on iOS and the
  switch hack was tested on Matt's real iPhone 2026-07-24 and did not fire. Batch C removes
  it. Do not re-try.
- Tier display vocabulary is now Easy/Medium/Hard/Expert (es Fácil/Normal/Difícil/Experto),
  Matt's explicit reversal of batch 8's Beginner/Intermediate/Pro. Stored ids never change.
- Tier colors: green `#2e9e44` / blue `#1F5FA8` / black `#1c2430` (t4 same black, shape
  differs) — the leaderboard's existing `TIER_COLOR`, promoted to the shared module.
- Ball Run gets its SLIDESHOW back (Matt reversed the single-sheet decision); the fix he
  wanted was a real previous button and art that shows what the captions say, obstacles
  included.
- Nuts & Bolts HAS a How-to sheet (game screen bottom bar); the gap is a button on the
  difficulty screen.
- Snake wrap-vs-walls stats are ONE combined pool by design (batch 5); whether to split them
  on the leaderboard is an open product question for Matt, not an executor call.

## Not in any batch (needs Matt's input)

1. **Uno** — new game, full arc of its own (rules/house-rules decisions, cards, AI, art).
2. **Play against another user** (Tic Tac Toe / Filler / etc. vs a named person) — needs a
   design conversation; Chinchón/Escoba's live room-code multiplayer (`js/net.js`) is the
   proven base to extend.
3. Splitting Snake's leaderboard by walls on/off.
