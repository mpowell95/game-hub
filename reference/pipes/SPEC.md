# Pipes — measurements off the reference app

Taken 2026-08-31 from the material Matt put in `pipes/`: eleven screenshots (`IMG_4594` to
`IMG_4604`, dark theme) and a **42-second screen recording of him completing levels 1 and 2**
(`ScreenRecording_08-31-2026 15-57-49_1.mp4`, 1206x2622, light theme). Two different themes of the
same app, which is why the colour table below has both.

**The art half of this file is already implemented** (`pipes/js/art.js`, and `pipes/CLAUDE.md` has
the rationale). **The flow half is not** — it is what the recording showed, and it is written down
here because a video is an input and this file is the artifact. Nothing below is a decision; the
decisions are Matt's and live in `pipes/CLAUDE.md`.

> **The recording needs a real ffmpeg to open.** Playwright's bundled `ffmpeg-linux` and headless
> Chromium both refuse it (no H.264 decoder in either), which is why the first session to try
> reported it unreadable. `npm i --no-save ffmpeg-static` decodes it in seconds. Do that rather
> than concluding the file is broken — it is a perfectly ordinary iOS screen recording.

## Geometry — all fractions of ONE CELL

Measured off `IMG_4602.png`, a 7x9 board on a 155px grid. Every number is that measurement over
155, expressed against a 100-unit cell so it ports to any board size.

| Part | Reference px | Fraction of a cell |
|---|---|---|
| Cell pitch | 155 | **1.000** |
| Pipe outer width | 55 | **0.355** |
| Wall thickness | 3 | **0.019** |
| Pipe interior (what water fills) | 49 | **0.316** |
| Bulb outer radius | 55.5 | **0.358** — almost exactly one pipe width |
| Bulb hole radius (wet only) | 15.5 | **0.100** |

Two relationships worth keeping, because they are what make a run read as continuous:

- **The water is exactly the dry pipe's interior.** A wet run lines up with the dry run it
  continues into, because they are the same construction with two colours swapped.
- **A bulb's outer radius equals the pipe's outer WIDTH**, so a cap reads as a bulge on the pipe
  rather than a separate blob.

**The elbow is two straight arms meeting at the cell centre with a round stroke join** — not a
curve. The inner wall of the turn is a sharp right angle; the outer wall is an arc of exactly half
the stroke width centred on the cell centre. That pair is the signature of a stroke join and is not
something a quadratic reproduces. (An earlier pass wrote down the opposite as if it were a finding,
and the elbows read as lazy S-bends for two deploys.)

**Verify by measuring, not by looking.** A ~60-line dependency-free PNG reader (inflate + unfilter;
node's `zlib` is all it needs) plus these ratios settles in seconds whether a render is right. The
reference PNGs are 16-bit, so a reader that assumes bit depth 8 will throw on them.

## Colour

| Role | Dark theme | Light theme |
|---|---|---|
| Field | `#353535` | `#ebebeb` |
| Dry pipe wall | `#ffffff` | near-black |
| Water | `#73bcf5` | `#4fb5fa` |
| Wet pipe rim | `#040404` | near-black |

The rule underneath: **the wet rim is near-black in both themes**; only the DRY wall flips to
whatever contrasts with the field. Our light theme currently uses a grey-blue dry wall and a deep
blue wet rim rather than black — a deliberate softening, not a match, and worth knowing before
anyone "fixes" it.

## The level flow, as the recording shows it

This is the part that was never captured before. **It is a description of the reference app, not of
ours** — several of these are variants Matt has already decided against.

**Play screen.** Back chevron top-left; centre is **"Level 2"** with an elapsed **timer `00:09`**
directly under it; top-right a hint (lightbulb) and a stats/leaderboard icon. No turn counter and
no "new board" control on this screen.

**Completion.** The headline **"Puzzle Solved!"** appears above the board, the solved board stays
fully visible, and three buttons sit below it:

```
[        Continue        ]   <- full width, dark, primary
[  Replay  ] [ Leaderboard ] <- half width each, outlined
```

**It does NOT advance by itself.** In the recording Matt sits on this screen about five seconds and
then taps Continue. Ours briefly did auto-advance, on his earlier instruction (*"It should
automatically move me to the next board after I complete one"*); shown that the reference waits for
a tap, he chose *"copy the video exactly"*, and ours now does. **Ours matches this screen.**

**Levels are ONE ascending sequence** — Level 1, 2, 3 — with no difficulty picker anywhere in the
recording. Ours has four difficulties each carrying their own level, which is the Nuts & Bolts model
Matt asked for by name. Deliberate divergence.

**A "Levels" map screen**: the levels drawn as a pipe run with numbered nodes, completed ones filled
blue, the next one a raised white card, a valve wheel at the start. A footer of three figures:
**Completed levels · Total time · Total rotations** (2 / 44s / 43 in the recording). Note it tracks
rotations *and* time; only time is on the play screen.

**An achievement toast** slides in from the top on completing a level ("No Hesitation — Complete a
puzzle without pausing f..."). Nothing like it exists in this hub.

## What the reference does that ours deliberately does NOT

Each of these is a settled decision, recorded so nobody re-opens it as a bug:

1. **Full net, not path-with-no-leaks.** In the reference every piece on the board must join up —
   its level-1 solved frame is one single connected blue network. `docs/PIPES-SCOPE.md` put that to
   Matt as option (c) and he chose (b).
2. **Dead-end bulbs as ordinary decoys.** The reference's boards are dotted with them. Matt,
   2026-08-31: *"I do not want decoy bulbs."* Ours has exactly two per board, the inlet and the
   outlet, so a circle always means something.
3. **A timer as the headline stat.** Ours counts turns.

## Retention

Per `reference/README.md`, the media are INPUTS and this file is the artifact. The eleven PNGs and
the recording still live in `pipes/` (not here) because Matt put them there and the art work is
still being iterated against them. When Pipes closes, they come out — everything above is what
needs to survive, and anything removed is recoverable from the commit that removed it.
