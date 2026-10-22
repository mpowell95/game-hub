# HOTFIX: Skeeball resumes a rack on the wrong machine's engine

## Context

Matt, with a screenshot of HOT SHOT: RUNAWAY: *"You broke skeeball. I can go back to the hub but
nothing else."* The HUD is fully painted — score 100, the ball pips, all three goal rails — and the
playfield below it is **empty**. Nothing responds. The hub's own back button works because that is
hub chrome, not Skeeball's.

**This is my bug, from this morning's PR #300** (the lazy-engine change that took Skeeball's launch
from 2,188 KB to 19 KB). Reproduced and attributed, not inferred:

```
                                   save.board=runaway, settings.board=classic
  before PR #300   canvas 196x345, no errors            <- worked
  after  PR #300   canvas 300x150 (never sized)         <- dead screen
                   "[skeeball] engine 'runaway' is not loaded"
```

### The mechanism

`_startGame(snap)` loads the engine for **the carousel's selection**, but restores the game from
**the snapshot's board**:

- `skeeball/js/ui.js` `_startGame` → `boardById(this.settings.board)` → `await loadEngine(board.id)`
- `skeeball/js/game.js:81` `SkeeballGame.restore(snap)` → `new SkeeballGame(snap.board)`
- `skeeball/js/ui.js:1116` → `engineFor(this.game.board.id)` → **throws** when those differ

They diverge routinely: the carousel writes `settings.board` on **every swipe settle**
(`skeeball/js/ui.js:719`, and `_popLock`'s `done()` at `:452`), while a mid-rack autosave stays
pinned to the machine it was banked on. So: play a rack, leave mid-rack, swipe the gallery to any
other machine, come back — the constructor's resume path (`:380-381`) restores the saved rack and
loads the wrong engine.

Before PR #300 `engineFor` returned a statically-imported engine for any id, so the divergence was
harmless. Now it throws, and the throw lands **after** the HUD's `innerHTML` is written but
**before** `_pushScoreboard`, `_bindPlay`, `_fit` and `_startLoop` — which is exactly a painted HUD
over a dead, unsized canvas with no input bound.

The Resume *button* is guarded (`snap.board === this.settings.board`), which is why this only shows
up on the automatic resume at mount.

**No player data is at risk.** The snapshot is untouched — `_startGame` throws before anything
writes, and `clearSave()` only runs on an explicit Play/New game. Matt's rack is still on the
device and comes back the moment this ships.

**Why my morning verification missed it:** `test-visual.mjs`'s PLAY probe plays THE CLASSIC from
the gallery, with no banked save and no swipe. Nothing in the suite resumes a rack, and nothing
exercises a second machine.

---

## The fix — `skeeball/js/ui.js`

**1. Load the engine the GAME will use, not the one the carousel is showing.** In `_startGame`,
derive the board from the snapshot when there is one:

```js
const board = boardById(snap && snap.board ? snap.board : this.settings.board);
```

`SkeeballGame.restore` already resolves `snap.board` through the same `boardById`, so the two agree
by construction rather than by coincidence. The `new SkeeballGame(board.id)` branch is unchanged.

**2. A failed mount must land on the gallery, not on a dead screen.** The wrong engine was the bug;
the unrecoverable screen is the reason it cost Matt a session. Wrap the post-`await` body of
`_startGame` so any throw logs loudly (rule 6) and falls back to `_renderSetup()`. Had this been
there, the incident would have been "it bounced me to the machine picker" — annoying, recoverable,
and reportable.

**3. Regression cover, two layers**, because prose did not stop this and neither did the existing
suite:

- **Structural, node-only** (`test-skeeball-machine-spec.mjs`, which already reads `ui.js` as text):
  assert `_startGame` derives its board from `snap` and not from `this.settings.board` alone. Cheap,
  runs everywhere, and fails the moment someone re-introduces the divergence.
- **Behavioural** (`test-visual.mjs`): a Skeeball probe that seeds a mid-rack save on one machine
  with the selection on another, mounts, and asserts the canvas gets a real size and no error is
  thrown. This is the check that would actually have caught it; my scratch repro is already exactly
  this and can be lifted in.

**Deliberately NOT doing:** having resume also rewrite `settings.board` to the resumed machine.
It would remove the divergence at the source, but it is a behaviour change to the gallery's
selection on every mount, and the minimal fix is the right shape for a hotfix. Worth revisiting if
the gallery ever feels wrong after a resume.

---

## Verification

- **The repro first, red then green.** Seed `gamehub.skeeball.save.v1` with `board: 'runaway'` and
  `gamehub.skeeball.v1` with `board: 'classic'`, mount `skeeball/`, and check the canvas is sized
  and no `engine ... is not loaded` reaches the console. Confirm it fails on the current build
  before the fix and passes after.
- Both orderings (`runaway` save + `classic` selection, and the matching case) plus a fresh mount
  with no save at all, so the ordinary path is untouched.
- `node skeeball/js/test.js`, `node test-skeeball-machine-spec.mjs`, `node test-game-conventions.mjs`,
  `node test-visual.mjs skeeball`, `node validate-sw-assets.mjs`.
- Bump `CACHE` past whatever is on `main` at that moment.

## Deploy

Straight out, per root `CLAUDE.md`: commit → push → PR into `main` → merge → verify the
`pages build and deployment` run reaches `completed`/`success` → confirm against the deployed file.
This is a live breakage, so it ships on its own rather than waiting for Batch 2.

## Afterwards

Batch 2 (the tap: loading state, re-entrancy, the CSS gate across all 20 games) is unchanged and
still queued. One item earns a promotion into it from this incident: `js/hub.js`'s `launch()` has
the same "throws mid-mount, leaves a dead container" shape, and its `catch` currently only handles a
failed `import()`, not a failed `init()`.
