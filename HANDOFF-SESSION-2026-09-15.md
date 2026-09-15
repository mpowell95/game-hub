# Session handoff — Baseball BB-3b, 2026-09-15

For the next session picking this up. Everything below happened in one continuous session,
starting from a request to merge and deploy already-committed BB-3b work, then continuing through
gameplay feedback and the rest of BB-3b commit 6.

**Status: BB-3b is NOT finished.** Commits 1–6 of the handoff's own 9-commit plan are live.
Commit 6's league picker redesign is deliberately not built (needs Matt's decision first).
Commits 7 (formal test suites) and 8 (docs sweep) were not done as separate commits — docs were
kept current incrementally in `baseball/CLAUDE.md` instead, but no dedicated commit closed them
out. Commit 9 (final ship) is effectively subsumed by this session's own merge-and-deploy-per-round
cadence — every round below is already live on `main`.

Every round below was: implemented → tested (headless + real Playwright device tests) → committed
→ pushed → PR opened → merged to `main` → Pages deploy verified `success` → confirmed live. Nothing
is sitting on a branch. Current deployed version: **`game-hub-v840`**.

## What shipped, in order

### 1. Deploy checkpoint (v834 → v835)
Picked up mid-session: previous work (BB-3b commits 1-4, the art pipeline, plate-view picture,
real batter/pitcher figures, ball flight + steering) was committed but only on the feature branch.
Bumped `sw.js` CACHE, regenerated `REST_MANIFEST`/`version.json`, ran the full baseball test
battery, merged to `main`, verified the Pages deploy. This made everything already-built actually
live for the first time.

### 2. Swing-timing cue (v835 → v836)
Matt, immediately after seeing it live: *"I can't make contact with the ball or anything."*

Diagnosed BEFORE changing anything: a Playwright session bypassed the UI and fed the engine
synthetic swings at `timingErrorMs: 0` / perfect placement — **8 for 8 in play**. This proved the
engine and UI data plumbing were already correct; the gap was that batting had zero visual signal
for when to release, unlike pitching's own Nice-zone ring.

Fix: `_scheduleSwingCue()` in `baseball/js/ui.js` fires a ring glow (`.bb-ringwrap.is-swingcue`,
CSS `filter`/`box-shadow`, respects reduced motion) at the exact instant `timingFromRelease`
already scores a release against — no widened window, no engine change, no tuned constant
touched. Verified with a SECOND real Playwright session driving the actual production UI (real
`touchscreen.tap()` calls timed off the cue): **5 real taps, 5 real balls in play, 0 whiffs.**

### 3. BB-3b commit 5: the overhead cutaway is the painted stadium (v836 → v837)
`overhead.webp` (shipped in commit 1, unused until now) replaces the vector-drawn overhead field
that plays on contact. The mapping from world feet to picture pixels is a full 2D projective
homography — measured, not eyeballed: home/first/second/third base were located as their own
white-pixel blobs in the shipped image via a Python/PIL scan (home plate needed its own tight crop
first, since it's partly occluded by the painted catcher). An affine fit through only 3 of the 4
points predicted the 4th ~46px (2.4% of the image height) off its true position — a real
perspective term, not noise — so the full 4-point homography (exact via standard DLT) shipped
instead.

`project()` now tries the picture first, falls back to the old calibrated-camera trig while the
image loads. This exposed and fixed a real bug: `test-baseball-device.mjs` calls `project()` from
plain Node with no DOM at all, which crashed the moment `project()` started reaching for `Image`.

Out-zone hatching draws OVER the picture at low alpha rather than literally under the baked-in
painted fielders (not achievable with one flat image, despite SPEC.md's "under the fielders"
wording) — documented as the closest honest approximation, not a silent reinterpretation.

Verified with a real render: bases land exactly on the picture's own painted squares, the mound
sits under the painted pitcher, sample landing markers (a single, a double, a groundout) place
sensibly.

**Deferred, documented, not silently dropped**: runners sliding base-to-base, and the painted
fielder nearest the landing point hopping once on an out. Both are real new state-driven animation
work, not wiring gaps.

### 4. BB-3b commit 6, part 1: Line 1/2's real vocabulary + real leave-confirm (v837 → v838)
Line 1 had exactly two words its whole life: "Out" and "Hit!". Now shows SPEC.md's real
vocabulary — Ball/Strike/Foul on a take or miss; Early/Late/Perfect on a swing (from the same
`timingErrorMs`/`perfectMs`/`timingWindow` axis `swing.js`'s contact-quality model already scores
against); Single/Double/Triple/Home run/Out/Walk/Strikeout once resolved. `game.js`'s
`count`/`atBatEnd` events carry two new additive fields (`verdict`, `timingWord`) for this — `null`
for every existing caller, same discipline as every prior additive engine seam this project has
shipped.

Line 2 ("pitch name and mph") was never painted at all. Now shows it the instant a pitch crosses
the plate.

`isInProgress()` returned `false` unconditionally its whole life (a phase-4-autosave note, not a
design choice) — meaning the hub's own leave dialog never fired for baseball; the back pill
silently dropped an in-progress Quick Play game every time. Now answers honestly. `window.confirm`
(the only one anywhere in this repo, and banned by the handoff's own contract) is replaced with a
real `.gh-overlay`/`.gh-modal` confirm.

Verified with a real Playwright session: forced-perfect-contact swings produced the actual DOM
write sequence "Strike" / "Fastball 55" on a take, then "Triple" / "Fastball 55" on a real hit.

### 5. BB-3b commit 6, part 2: the pitch strip is 8 fixed tiles, one row (v838 → v839)
Both states now render the same `.bb-strip-tiles` layout (a flex row, `flex:1` tiles, 92px tall —
matching the handoff's own "8 by 44 by 92" number by construction) instead of a 4×2 grid
(pitching) and flex-wrap chips (batting). Pitching always shows all 8 `SETTINGS.PITCH_TYPES`
wells — a locked pitch is an empty well with a lock glyph, never omitted (omitting one would
reflow every tile after it). Batting fills the last 8 pitches of the current at-bat left to right,
blank dashed wells for what hasn't thrown yet.

The ball/strike mark is a real shape cue (filled square vs. circle), colored to match, not color
alone — root CLAUDE.md's colorblind rule.

One real fix caught by `test-game-conventions.mjs` itself: the first draft's mph/mark text was
under the 11px UX-floor minimum. Raised to 11px, re-verified all 8 tiles still fit without overflow
at 393px width via a real screenshot + `scrollWidth`/`clientWidth` check.

### 6. BB-3b commit 6, part 3: the half-inning transition cross-fades in place (v839 → v840)
Per SPEC.md section 5's transition row, none of which existed before: the swap (mode flip,
HUD/strip/action-wells/labels/foreground figure) now happens genuinely at the midpoint of the
3000ms "Side retired" beat, cross-faded (`_crossFadeSwap()`: fade the five swapping elements to 0,
swap while invisible, force a reflow, fade back to 1), never abruptly at the very end. Reduced
motion skips the fade entirely and swaps instantly at the same midpoint — verified with a real
Playwright `reducedMotion: 'reduce'` context and a `MutationObserver` proving the fade class is
never applied in that path.

The three action-slot wells now genuinely differ by state (`_paintActionSlots()`, new): batting
carries Bunt/Steal with an empty third well, pitching carries Pickoff with two empty wells — all
three remain fully disabled placeholders (`RESERVED_PHASE_6`; no baserunning between pitches
exists yet), only which well is occupied changed.

Handled a real edge case found by reasoning about event order: a game that ends ON a
half-inning-ending pitch gets no following `halfInningStart` to clear the pending-swap flag/text —
`gameEnd`'s own handler now clears both defensively.

Verified with a real Playwright session polling the live DOM through a forced transition: the
fade class appeared ~1500ms after "Side retired" first painted (exactly `BETWEEN_MS/2`), mode and
action wells flipped ~127ms later (matching `FADE_MS`).

## What is explicitly NOT done

- **The Quick Play league picker redesign.** The handoff itself names this Matt's call, not
  something to build and hope he likes — five rows in ladder order with each league's fence
  distance instead of the current `.gh-seg`. Not started.
- **Runners sliding base-to-base and the fielder-hop-on-out** in the overhead cutaway (BB-3b
  commit 5's own deferred items — real new animation work, not wiring).
- **BB-3b commit 7**: the formal steering/R2 timing test suites the original handoff asked for as
  their own commit. The underlying behavior (steering clamp, R2 pacing) was built and spot-verified
  earlier in this project's history, but no dedicated formal test suite commit was made this
  session.
- **BB-3b commit 8**: a dedicated docs-sweep commit. In practice `baseball/CLAUDE.md` was kept
  current after every round in this session (see the six numbered sections above, each with its
  own dated entry in that file) — but that's incremental documentation, not the formal sweep
  commit 8 describes.
- **The original handoff's own report-back list (section 11)**, largely still open from BEFORE
  this session and not revisited in it: the pitching-camera-behind-the-plate reversal was never
  put to Matt for confirmation; the overhead-cut-on-contact decision was never ratified by him
  either (built as the spec's default, per the handoff's own instruction, but still awaiting his
  word); R2's measured intervals on a real device were reported in an earlier round, not re-measured
  this session.

## Where to find things

- `baseball/CLAUDE.md` — the full dated history, in reverse-chronological order at the top of the
  file. Every round in this session has its own header with the before/after `CACHE` version, what
  changed, why, and its own verification block.
- `HANDOFF-BASEBALL-3B.md` (repo root) — the original 9-commit handoff this whole session's work
  traces back to. Still the source of truth for what commits 7-9 and the league picker are
  supposed to contain.
- `reference/baseball/SPEC.md` — the design spec this session built against (Line 1/2 vocabulary
  section 3/9, the strip/control-band geometry section 5, the transition rules section 5).
- Six merged PRs, in order: #615 (deploy checkpoint), #616 (swing cue), #617 (commit 5, overhead
  picture), #618 (commit 6 part 1, Line 1/2 + leave-confirm), #619 (commit 6 part 2, strip), #620
  (commit 6 part 3, transition). All merged to `main`, all Pages deploys verified `success`.

## Suggested next steps

1. Ask Matt for the league picker redesign decision (or propose one with a mockup for his
   reaction) — the one deliberately-blocked item.
2. If Matt wants BB-3b formally closed out, commits 7-8 (a dedicated test-suite commit and a docs
   sweep) are what's left on paper, though the actual behavior and documentation are both already
   in place in substance.
3. Runners-sliding and fielder-hop are natural next visual polish once the league picker is
   settled.
