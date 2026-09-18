# Baseball play-screen work, 2026-09-14 — session screenshots

Per `reference/README.md`: this work is still OPEN (a second session is reviewing it), so these
stay committed for now. Once review closes, convert anything worth keeping into
`baseball/CLAUDE.md` (most of it already is — see "The camera was rebuilt to match the reference")
and delete the images in the same commit, per the Retention rule.

**Matt's own two reference screenshots (Mario Superstar Baseball) are NOT here.** They arrived as
chat attachments — content this session could see, not a file it could write to disk (the exact
case `reference/README.md`'s own history section describes). A reviewing session cannot open them
either; go by the description below and by `baseball/CLAUDE.md`'s own account of what they showed.

## What each file is

- **`camera-rebuild-batting-view.png`** — the rebuilt plate camera, batting mode, mounted in the
  real hub at 393x852/dpr3. What Matt's reference showed: a low camera behind/above the batter,
  the batter huge in the near foreground, the pitcher small in the middle distance, foul lines
  diverging toward the bottom corners. This is the FINAL state after fixing two bugs found along
  the way (see `baseball/CLAUDE.md`'s "Two bugs found only by rendering the pitching mirror" —
  figures invisible at first from a bad size formula, then off-canvas from too wide a lateral
  offset).
- **`camera-rebuild-pitching-view-mirrored.png`** — the same camera turned 180 degrees: pitcher
  huge/foreground, batter tiny/distant at the plate. Also final state, after fixing the mound/
  rubber self-crossing "bowtie" distortion described in the same CLAUDE.md section (the broken
  intermediate frame was not saved separately — it was overwritten by the fix before this session
  thought to keep a copy; the bug and fix are written up in prose instead).
- **`camera-rebuild-overhead-cutaway-landing-marker.png`** — the OLD elevated/overhead camera
  (unchanged from the previous round), now repurposed as the cutaway that plays when a ball is put
  in play. Shows the out-zone hatching and a "2B" landing marker. This is Matt's chosen answer
  (from three options put to him) to "how should a hit/out read from a camera that can't show the
  whole field" — see `baseball/CLAUDE.md`'s "What to do about out zones."
- **`camera-rebuild-ball-grown-near-plate.png`** — the ball at ~98% of the way from the mound to
  the plate, captured via `canvas.toDataURL()` to verify growth directly (a `page.screenshot()` a
  frame later intermittently missed it — an async repaint race in the test harness itself, not a
  rendering defect; see CLAUDE.md's "Verification").
- **`approved-mocks-own-render-batting-tall.png`** — for comparison: the APPROVED MOCKS' own HTML
  (`mocks/baseball/play-batting-tall.html` on `claude/baseball-mocks`), rendered standalone. This
  is the elevated/overhead camera the *previous* round matched exactly — useful context for why
  that round was correct on its own terms (it matched the mocks) and still had to be redone (the
  mocks were never the same shot as Matt's actual reference; see CLAUDE.md).
- **`layout-fix-hud-clears-hub-back-pill.png`** / **`layout-fix-mid-game-verdict-line.png`** — from
  the EARLIER, separate round (`game-hub-v831` → `v832`): the real-device layout bugs (HUD hidden
  behind the hub's floating back button, verdict text overlapping it) and their fix, verified on a
  real hub mount. Kept here for the same reason as the rest — committed evidence a second session
  can actually look at, not a claim to take on faith.

## Where to read the full account

`baseball/CLAUDE.md`, sections (newest first):
1. "The camera was rebuilt to match the reference" (`game-hub-v833` → `v834`) — this round.
2. "The approved mocks arrived; the field renderer and control band were re-lifted from them"
   (`v832` → `v833`) — the previous round, superseded by (1) but not wrong on its own terms.
3. "The phase 3 deploy was broken on a real phone" (`v831` → `v832`) — the layout-fix round the
   last two screenshots above are from.

All three shipped and were verified live (GitHub Actions `pages build and deployment`, `conclusion:
success`, each time) before the next round started.
