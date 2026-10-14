# Handoff: observations, 2026-09-02

## What this is, and what it is not

A list of things a session on 2026-09-01/02 **observed**. Nothing here has been confirmed as a
defect, and nothing here proposes a change.

- **These are observations, not findings.** Each one says what was seen and how to see it again.
  Whether it matters, and what to do about it, is for the session picking it up to decide.
- **No cause is given and no remedy is suggested**, deliberately. Matt asked for the observations
  stated and nothing more, so that the next session reaches its own conclusion rather than
  inheriting one.
- **Reproduce before acting.** Every item below carries the command or the file that produced it.
  Several observations recorded earlier in this repo's history turned out, on re-measurement, to
  point somewhere other than where they first appeared to.
- Some items may be intentional, already known, not worth changing, or simply wrong.

**Baseline at the time of writing:** deployed `game-hub-v560`; branch
`claude/skeeball-launch-performance-efawz3` at `c525e9a`. All node suites listed at the bottom
were green when this was written.

---

## A. Reported by the repo's own suites

These are printed by the test suites on every run. They are listed in `KNOWN_GAPS`, so they do
**not** fail the suites — they are surfaced, not enforced.

Reproduce all of section A with:

```
node test-visual.mjs --all          # ~15 min, prints its gap list at the end
node test-game-conventions.mjs      # seconds
```

### A1. Three games measure taller than one screen when mounted in the hub

Measured at two phone sizes, in two hosts (standalone page, and mounted in the hub).

| game | observation |
|---|---|
| mancala | up to 222px taller than the screen (hub, 390x664), and 34px taller even at 393x852 — the only one of the three that exceeds a full-size screen |
| escoba | up to 165px taller than the screen (hub, 390x664). Measures within both heights standalone |
| chinchon | 136px taller than the screen (hub, 390x664) only. Both standalone heights and the tall hub measure within the screen as of 2026-09-01 |

### A2. Two games measure wider than the screen at 393px

| game | observation |
|---|---|
| chinchon | ~30px wider than the viewport |
| dots-boxes | ~5px wider than the viewport |

### A3. Twenty-two CSS declarations set text below 11px

`docs/BUILDING-A-GAME.md` states 11px as the floor. These are the current exceptions, by exact
file and line:

```
boggle/css/boggle.css:106          10.5px    score summary micro-label
boggle/css/boggle.css:242          10px      tally count micro-label
chinchon/css/chinchon.css:646       9px      stats chart axis label
escoba/css/escoba.css:314           9px      card badge
escoba/css/escoba.css:677          10px      stats chart axis label
filler/css/filler.css:247          10px
filler/css/filler.css:290          10px
mancala/css/mancala.css:284        10px
mancala/css/mancala.css:868         8px      pit-count micro-label
mancala/css/mancala.css:876         9px      pit-count micro-label
nuts-bolts/css/nuts-bolts.css:186  10px
yahtzee/css/yahtzee.css:575         8px      scorecard micro-label
yahtzee/css/yahtzee.css:583         9px      scorecard micro-label
yahtzee/css/yahtzee.css:594         5px      bonus label
yahtzee/css/yahtzee.css:595         9px      bonus value
yahtzee/css/yahtzee.css:597         7px
yahtzee/css/yahtzee.css:623        10px
yahtzee/css/yahtzee.css:628         7px
yahtzee/css/yahtzee.css:635        10px
yahtzee/css/yahtzee.css:652         7px      help-tip text
yahtzee/css/yahtzee.css:659         8px      help-tip text
yahtzee/css/yahtzee.css:702        10px
```

The descriptions after each line are the notes already attached to those entries in
`test-game-conventions.mjs`; they were not re-verified.

**Note on the line numbers:** CSS edits on 2026-09-01 shifted several of these, and the
`KNOWN_GAPS` entries were updated to follow. The declarations themselves were not changed. If a
line number looks wrong, check whether the file moved under it.

---

## B. Observations about test coverage

### B1. Sixteen of twenty-one games have never been played by an automated test

`test-visual.mjs` prints this on every full run. Games with a probe that actually plays them:
**battleship, pinball, pool, skeeball**. Games with no such probe:

```
ball-run, boggle, chinchon, connect-four, dominoes, dots-boxes, escoba, filler,
hill-climb, mancala, nuts-bolts, pipes, snake, tic-tac-toe, uno, yahtzee
```

The remaining checks for those sixteen confirm they render, mount without a JS error, and fit a
screen. They do not confirm a game can be played to an outcome.

### B2. No automated test in this container reaches Firebase

Chromium in this environment cannot load `https://www.gstatic.com/firebasejs/...`. Everything
that depends on it — the leaderboard's data, stats sync, hub-wide records, the players node — is
therefore exercised by no test here. Observed repeatedly on 2026-09-01; `curl` to the same host
behaves differently from the browser, so check both before concluding anything about reachability.

### B3. `test-visual.mjs`'s skeeball PLAY probe failed 2 of 3 consecutive runs on untouched `main`

Measured by stashing all local changes and running `node test-visual.mjs skeeball` three times
against a clean checkout. Failures reported `"threw a full rack and the rack-over sheet never
appeared"`; the third run passed. Recorded in `skeeball/CLAUDE.md` under Testing.

---

## C. Observed on Matt's device, not reproduced here

### C1. The app reloaded itself with no input

In `reference/ScreenRecording_09-01-2026 17-19-40_1.mp4`, at approximately **2.1 seconds**, the
launcher's first-paint skeleton appears for roughly 170ms and the launcher then re-renders. Matt
had not touched the screen at that point. A similar event appears in
`reference/ScreenRecording_09-01-2026 10-38-16_1.mp4` at approximately 10.3s.

No cause was established. Not reproduced in this container.

Lifecycle breadcrumbs were added to `js/error-log.js`'s existing buffer on 2026-09-01, so a bug
report filed after a recurrence should carry a timeline. Whether they capture this specific event
is unverified.

### C2. Everything shipped on 2026-09-01 was verified in Chromium only

Matt's device is iOS/WebKit. No change made that day was observed running on it. This applies to
all of: the Skeeball gallery work, the version-chip work, the leaderboard loading state, and the
six games' fit changes.

---

## D. Already recorded elsewhere — listed so they are not mistaken for new

- **The profile emoji does not appear everywhere the profile name does.** The hub's top-bar pill,
  Ball Run, Dominoes, Hill Climb, Nuts & Bolts, Snake, Pinball and Skeeball show the name with no
  avatar; Chinchón and Escoba use their own avatar list. Written up in root `CLAUDE.md` under
  "The shared profile". Paused by Matt on 2026-08-25.
- **Performance batches 2, 3 and 4** from the 2026-09-01 plan (tap feedback, prefetch on
  pointerdown, two games' non-compositor transitions, self-hosted fonts) were scoped and then
  paused by Matt. They are not started.
- **`chinchon`'s and `dots-boxes`'s horizontal measurements (A2)** and **`escoba`/`mancala`'s
  heights (A1)** predate 2026-09-01 and are long-standing `KNOWN_GAPS` entries.

---

## E. Suite state when this was written

Green, run on 2026-09-02 against `c525e9a`:

```
test-visual.mjs --all              255 passed, 0 failed
test-game-conventions.mjs           11 passed, 0 failed   (22 known gaps printed, see A3)
test-sw-strategy.mjs                82 passed, 0 failed
test-sw-update.mjs                   5 passed, 0 failed
players-agg.test.mjs                ALL PASS
test-stats-replay.mjs               ALL PASS
test-stats-identity.mjs             ALL PASS
test-recorder-contract.mjs          ALL PASS
test-leaderboard-rank.mjs           ALL PASS
test-mp-lockstep.mjs                ALL PASS
test-new-badge.mjs                  ALL PASS
test-admin-config.mjs               45 passed, 0 failed
test-stats-corrections.mjs          32 passed, 0 failed
test-messages.mjs                   58 passed, 0 failed
test-bug-report.mjs                 78 passed, 0 failed
test-emoji.mjs                      63 passed, 0 failed
test-skeeball-machine-spec.mjs     116 passed, 0 failed (11 rules under waiver)
snake/js/test.js                    49 passed, 0 failed
boggle/js/test.js                   62 passed, 0 failed
chinchon/js/test.js                111 passed, 0 failed
dots-boxes/js/test.js               25 passed, 0 failed
skeeball/js/test.js                 62 passed, 0 failed
validate-sw-assets.mjs              clean
```

Not run: the engine suites for games untouched that day (root `CLAUDE.md` asks that
`run-all-tests.mjs` only be run when Matt asks for it by name).
