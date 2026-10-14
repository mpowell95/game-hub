# HANDOFF-FB-RESUME: every game defaults to resumable

**Batch 9 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: high.** Wide batch (six games) — do not
run in parallel with other batches. Decisions made; execute, verify, commit.

Matt: "all games should default to being able to resume game."

## The model (do not invent a new one)

Escoba and Mancala are the proven references: snapshot after every state-changing event to a
localStorage key, silently restore on mount, clear on game end. Read `escoba/js/ui.js`
(`_saveSnapshot` :187, `_resumeGame` :677, key `escoba-save`) and `mancala/js/ui.js`
(`saveGame` :108, `resumeGame` :389, auto-resume on mount :238, key
`gamehub.mancala.game.v1`) before writing any new save path. Their `isInProgress()` contract
is documented in root `CLAUDE.md` ("two legitimate meanings"): **a game with lossless solo
resume returns `false` for solo play even mid-game** — leaving is not abandoning. Every game
this batch converts flips to that meaning, with a comment at `isInProgress()` saying so
(the contract requires the comment).

## Per-game decisions

| Game | Save key (new, convention form) | Notes |
|---|---|---|
| Connect Four | `gamehub.connect4.save.v1` | Snapshot after every move (board, turn, settings incl. hint-toggle + `_statsDisqualified` — a resumed hint-assisted game must stay disqualified). Restore on mount, straight into the game screen. |
| Tic Tac Toe | `gamehub.tictactoe.save.v1` | Matters mostly for Ultimate (multi-minute). Snapshot both variants anyway — one code path. |
| Dots and Boxes | `gamehub.dotsboxes.save.v1` | Board + owners + turn + settings. |
| Filler | `gamehub.filler.save.v1` | Small state; same pattern. |
| Chinchón (solo) | `gamehub.chinchon.solo.v1` | Mirror the existing MP snapshot mechanism (`_mpSaveSnapshot` :2107 / `_mpRestore` :2119) for solo: match scores + current round state. Same 30-min freshness window the MP save uses; staler saves are ignored (a card game abandoned yesterday should not ambush the player). MP path untouched. |
| Boggle | `gamehub.boggle.save.v1` | The special case: a live countdown. Save `{board, solved words already found, remainingSec, settings}` on every found word and on `destroy()`; on resume, rebuild the board and found list and restart the timer from `remainingSec` (recompute `_endsAt` fresh — the clock was PAUSED while away; that is the deliberate design, favoring the player). The dictionary reload path already exists (module-scope cache). |
| Ball Run, Snake | none | Live-action runs; mid-run resume is meaningless. Explicitly out of scope — record that in each CLAUDE.md so the next session doesn't "finish" it. |
| Escoba, Mancala | already done | Zero edits. |
| Nuts & Bolts | none needed | Its kept-aside board already survives; ALSO make it auto-resume on mount when an in-progress board exists (today it waits for a same-tier tap, `nuts-bolts/js/ui.js:204-208`). |

## Cross-cutting rules

- Saves clear on: game end (recorded result), explicit restart/new-game, and "Give up" — never
  on hub navigation or `destroy()` (that is the whole point).
- A malformed/failed-parse save is treated as absent (try/catch, same discipline as
  profile reads); never let a bad save crash a mount (module contract: a game must always
  come up).
- Resume is SILENT (straight back into the game, like Escoba/Mancala) — no "resume?" dialog
  anywhere; the hub's leave-confirm disappears for these games via the `isInProgress()` flip,
  which is the visible half of this feature.
- Stats recording paths are untouched — a resumed game records exactly as an uninterrupted one
  (verify the Connect Four `_statsDisqualified` carry explicitly).
- New keys only, `gamehub.<game>.save.v1` form; nothing existing is renamed or repurposed
  (rule 5). Settings keys are not touched.
- Add each new save key to `js/device-report.js`'s by-name key list (it enumerates every key
  this app writes; the raw dump would catch them anyway, but the named list is the contract).

## Verification

1. `node run-all-tests.mjs` green.
2. Per converted game: start a game, make distinctive progress, hub-back (no confirm should
   appear), reopen — exact position restored; finish the game — stats record once; reopen —
   fresh setup (save cleared). Boggle: leave mid-round, return, timer resumes from where it
   left off, found-word list intact, result records normally at time-out.
3. Chinchón MP: unchanged behavior end to end (`test-mp-lockstep.mjs` green; a solo save must
   never be restored into an MP context — key separation makes that structural, verify anyway).
4. Kill-test rule 6: after one snapshot write per game, fresh-read the key in devtools and
   confirm shape; a failed write must console.error, not vanish.
5. `sw.js` CACHE bump LAST. Update root `CLAUDE.md`'s `isInProgress()` meanings paragraph
   (the "no mid-game resume" list shrinks to Ball Run + Snake) and each `<game>/CLAUDE.md`
   (rule 9).
