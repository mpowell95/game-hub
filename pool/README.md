# Pool

8-ball, real cue-ball physics. Vs. the computer, a friend, or practice alone.

## Run it

From the repo root:

```
node server.mjs
```

Then open `http://localhost:8123/pool/` (standalone) or launch it from the hub
(`http://localhost:8123/` — Pool is `devOnly`, so it only shows for a dev profile;
see root `CLAUDE.md`'s "Adding a game" for what that means).

`?debug=1` on the URL auto-loads the fixed visual-verification layout
(`loadScreenshotState()`); Shift+S does the same once the game view is mounted.

## Controls

- **Aim + power**: press and drag anywhere on the table. The angle and distance from
  your finger to the cue ball set the aim and power live; a second finger held down
  while dragging fine-tunes the angle. Release to shoot — a short drag cancels.
- **Power meter** (right edge of the table): drag it directly instead, top = no power,
  bottom = full power. Both input paths set the same power value.
- **Spin**: tap the blue striped button (top-right of the table) to open the spin
  selector, drag the red dot on the cue ball, double-tap to recenter, tap outside or
  the × to close. The chosen spin applies to your next shot only, then resets.
- **Ball in hand**: drag the cue ball into position, tap to place. A white ring means
  the spot is legal, red means it isn't (overlapping a ball, inside a pocket, off the
  felt, or — right after a scratch on the break only — outside the head string).

## Tuning (`pool/js/ui.js`, top of file — `CONFIG`)

Every renderer/layout constant lives in one `CONFIG` object: the stage size, and the
fraction-of-stage rectangles for the HUD bar, tray, spin button, power track, table
box, felt, and spin panel, plus the pocket-radius multipliers. Physics constants
(friction, restitution, spin gain, etc.) are **not** here — they live in
`physics.js`'s own header, documented against their published sources; duplicating
them into `ui.js` is exactly how the two would drift apart.

## Tests

```
node pool/js/test-physics.mjs   # TABLE/pocket geometry, break/settle behavior
node pool/js/test-rules.mjs     # ball-in-hand head-string restriction
```

Both are wired into the repo-root `node run-all-tests.mjs`.
