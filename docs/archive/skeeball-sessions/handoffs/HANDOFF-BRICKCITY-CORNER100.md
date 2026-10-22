# Handoff: Brick City corner 100 still broken — prior session's fix failed

## The problem

On Skeeball's HOT SHOT: BRICK CITY machine (`skeeball/js/boards.js`, board id `brickcity`),
the two corner 100 baskets (`topL`/`topR`, `p100a`/`p100b`) are wildly inconsistent to throw.
Matt's own description: a swipe that visually looks aimed at the basket (he estimates ~10-20
degrees of real throw angle) sometimes scores, sometimes misses completely — and a change of
0.01% power or 1 degree of angle can flip the outcome entirely. This is not a "the hole is
small, be more precise" complaint — Matt is saying the sensitivity itself is disproportionate
to the size of the input change, and he has video of it still failing after a session's
attempted fix (see below).

## What the prior session found (measured, not guessed)

Using `skeeball/js/machines/brickcity/physics.js`'s `simulateThrow(board, {power, aim})` run
directly in node (no browser needed — the engine is DOM-free), against `BOARDS.find(b =>
b.id === 'brickcity')` from `skeeball/js/boards.js`:

- The corner 100 mouth is `r: X * 0.4` = 3.20 in diameter against a 3.00 in ball (`ballR: X *
  0.375`) — 0.10 in clearance per side. Documented in `boards.js` around line 758-770 as
  deliberately the tightest opening on the board.
- At the original `aimMax: 0.45` (25.8 degrees), a throw aimed roughly 7-21 degrees — which is
  the range a natural "aimed at the corner" swipe actually produces once it goes through the
  swipe-to-aim curve in `skeeball/js/ui.js` (`const aim = Math.sign(raw) * (raw * raw);` around
  line 1447) — does not fly directly into the basket. It overshoots the basket's own position,
  clips the RIGHT SIDE WALL, and then rides that wall (frictionless, low-restitution contact)
  for up to ~2 seconds before landing somewhere unrelated (traced with position logging; the
  ball's x coordinate pins near the wall at ~0.44-0.48m against a 0.50m board half-width for
  over a second before peeling off).
- Only two narrow angle bands threw the ball in with zero wall/board contact: roughly 4-6.75
  degrees, and roughly 22-25.5 degrees.

## What the prior session did — DO NOT REPEAT THIS

Capped `brickcity`'s `geom.aimMax` from `0.45` to `0.12` (radians) in `skeeball/js/boards.js`
(around line 775), on the theory that shrinking the maximum reachable angle would force every
possible swipe into the "clean" 4-6.75 degree band. This was committed, pushed, PR'd (#329),
merged into `main` (commit `c4a309e`), and verified live-deployed (Pages build succeeded).

**This is backwards from what Matt asked for**, and he said so directly, repeatedly:

> "why would we move the physical basket around instead of simply correcting that physics
> issue? if the natural aim would be 10+ degrees - if that's a swipe that looks aimed at the
> basket - why the fuck did you make it hit the outside wall? Just fix that."

He wants the natural ~10-20 degree throw angle to be the one that hits the basket. Capping
`aimMax` to 0.12 rad (6.9 degrees) does the opposite: it makes it PHYSICALLY IMPOSSIBLE to
throw at 10-20 degrees at all — no swipe, however hard or confident, can reach that angle
anymore. It did not fix what happens at the natural angle; it removed the natural angle from
the game entirely.

## The fix did not work

Even setting aside that it solved the wrong problem, a re-test after shipping (same
`simulateThrow` harness, fine sweep at 0.25% power steps and 0.1 degree angle steps, around the
first solution found inside the new 0-6.88 degree range) showed the accept window is STILL
patchy and narrow — hits and misses alternating almost point-to-point (e.g. power 0.6575 hits,
0.6600 hits, 0.6625 misses, 0.6650 misses, 0.6675 hits, 0.6700 hits, 0.6725 misses — no clean
contiguous safe band at all). Matt confirmed via two screen recordings
(`ec9723ea-ScreenRecording_09022026_171300_1.mov`,
`9b8137b9-ScreenRecording_09022026_171300_1.mov`, both under
`C:\Users\powel\.claude\uploads\ff3fa848-d837-4f95-b8e9-33fb8fbcb99a\`) that gameplay still does
not look or feel fixed.

**This was a wasted deploy and a wasted round of Matt's time and tokens.** The `aimMax: 0.12`
change is live on `main` right now and should be treated as suspect / likely wrong, not as a
foundation to build on. Matt has explicitly told the prior session not to propose solutions in
this handoff — this document is a statement of the problem and the failed attempt only.
