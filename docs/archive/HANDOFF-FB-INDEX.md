# HANDOFF-FB-INDEX: the 2026-07-23 feedback arc — batch map

Matt's feedback from 2026-07-23 (a bullet list + 16 annotated screenshots), organized into
eleven executable batches. Written by the investigating session the same day; every batch doc
has decisions made, code citations verified against the working tree at `f6024dd`, and its own
verification list. Matt reviews and pushes; sessions only commit.

## The batches

| # | Doc | Scope | Effort | Touches |
|---|---|---|---|---|
| 1 | `HANDOFF-FB-HOWTO.md` | How-to-play rewrites: Filler, Ball Run, Dots and Boxes, Boggle | medium | 4 games' strings/help code |
| 2 | `HANDOFF-FB-CONNECT4-HINTS.md` | "Best moves" numbers: copy fix (engine verified correct) | low-med | connect-four strings + one render |
| 3 | `HANDOFF-FB-LEADERBOARD.md` | Player drill-down, Snake unit bug, TTT ultimate/classic split + default | high | js/leaderboard-ui, js/game-stats-ui, tic-tac-toe |
| 4 | `HANDOFF-FB-FAVORITES-ORDER.md` | Custom favorites order + reorder UI | medium | js/favorites, js/hub |
| 5 | `HANDOFF-FB-SNAKE.md` | Scroll leak, wrap-around mode, bigger food, bigger board | med-high | snake/ |
| 6 | `HANDOFF-FB-CHINCHON.md` | Auto-close fully melded hands, setup cleanup | med-high | chinchon/ |
| 7 | `HANDOFF-FB-DOTSBOXES.md` | Beginner-only highlight, tie note, 10x10 Large, "Menu" | medium | dots-boxes/ |
| 8 | `HANDOFF-FB-SETUP-CONVENTIONS.md` | Alternate first player, ski-slope symbols, one difficulty vocabulary, restart buttons, N&B setup redesign | high | most games' setups + js/difficulty-tiers |
| 9 | `HANDOFF-FB-RESUME.md` | Autosave/resume in six games, isInProgress flips | high | 6 games + docs |
| 10 | `HANDOFF-FB-THEME.md` | Light/dark hub-wide (phased; Phase 1 then per-game commits) | high | js/theme (new), css everywhere |
| 11 | `HANDOFF-FB-BOGGLE.md` | Haptics, shorter timers | medium | boggle/ |

## Sequencing (parallel-session rules from HANDOFF-NEXT-SESSION.md apply: sw.js CACHE bump is
always the LAST edit before each commit; a file dirty with changes you didn't make belongs to
another session)

- **Prerequisite for anything touching Boggle** (batches 1, 8, 11): the in-flight
  `HANDOFF-BOGGLE-SPANISH.md` execution must be committed first.
- **Safe to run in parallel** (disjoint files): batches 2, 4, 5, 6, 7 and batch 3, in any
  combination — plus batch 1 (touches 4 games' help sheets; avoid pairing with 7's session
  only because both edit dots-boxes strings).
- **Run alone, not in parallel with anything**: batch 8, then batch 9, then batch 10 (each
  spans many games; 8 before 9 keeps setup-screen churn out of the resume diffs; 10 last
  because it re-skins everything the others touched).
- Batch 11 anytime after the Boggle prerequisite.

## Decisions already investigated so executors don't re-litigate

- Connect Four's solver and hint signs are CORRECT (full trace in batch 2's doc) — the fix is
  presentation copy only.
- Dots and Boxes' capturable highlight currently shows at ALL difficulties (not just easy, as
  the feedback assumed) — batch 7 gates it to Beginner.
- The Snake leaderboard "WINS" bug is specifically the game-detail player cards
  (`playerCardHTML` hardcodes the wins unit); the By Game list row was already correct.
- Chinchón's accordion already collapses by default in code; something re-opens the players
  row in practice — batch 6 requires finding that path, not just re-collapsing.
- Only Escoba and Mancala truly resume today; Mancala is the only opener-alternator; no setup
  screen shows ski-slope shapes; Chinchón has the repo's only dark mode.

## Needs Matt (no batch written — blocked on his input)

1. **The multiplayer "send or challenge people" feature** ("this is where the other
   multiplayer feature needs to be added"): needs a spec conversation — what's sent (a room
   code? a push? a standing challenge on the leaderboard?), to whom (username registry
   exists), and where it surfaces. Too many product decisions to delegate; nothing written.
2. **Boggle haptics on iPhone**: `navigator.vibrate` does not exist on iOS Safari — batch 11
   ships it for Android and it is honestly a no-op on the family's iPhones. If iPhone haptics
   matter, that is a native-wrapper conversation, not a web patch.
3. **Dots and Boxes 10x10** ships only if it proves playable on a phone (batch 7 has an
   explicit stop-and-flag rule if tap targets or AI time fail).
4. **Real Spanish Boggle** (word list + dice) remains open from the previous arc, unchanged.

## Cross-arc notes

- Batch 1 (screenshot 1) re-confirmed Ana's Boggle language complaint — already covered by
  `HANDOFF-BOGGLE-SPANISH.md` (in execution), nothing new added.
- Memory updated this session: difficulty-explanation prose and verbose help screens join the
  no-narrative standing rule (Matt: "make sure Claude knows you hate this shit").
