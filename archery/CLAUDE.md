# Archery — archery/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

A clone of the archery game in Snapchat's Games (Matt, 2026-10-14: *"I just uploaded a screen
recording of an archery game to Dropbox. Analyze it and plan to create a 1 to 1 exact clone of
it"*, then *"Build everything now"*). The reference is a 34 s recording,
`/Claude Code Refs/ScreenRecording_10-13-2026 23-31-02_1.MP4` in Matt's Dropbox. The plan, with
every timing read off that video at 0.25 s and Matt's answers to the open questions, is
`docs/ARCHERY-BRIEF.md`. **Read it first**: it is the spec this game was built to.

**Copied: the game, the screens, the timing. Not copied: the art, the name, the faces.** Everything
on screen is drawn from code here (the stadium, the target, the bow and arm SVG, the tile art). The
game is "Archery" (Matt: *"Yup"*). Avatars are profile emoji. No sound (root `CLAUDE.md`).

## Hub integration

- In-hub `module: '../archery/js/ui.js'`, **immersive**. Hub id and stats id are both `archery`.
  Prefix `.ar-root` / `.ar-`. Settings `gamehub.archery.v1`, save `gamehub.archery.save.v1`.
- **ADMIN ONLY at first** (`devOnly: true`, `added: '2026-10-14'`, no `released` date). Matt
  releases it from the admin page with no commit; the `GAME_META` row, My Stats tab and leaderboard
  wiring already ship.
- `isInProgress()` is always `false`: a match vs the computer is saved after every arrow and the
  setup card offers **Continue match**; an online match lives on the server.
- Stats: `recordResult('archery', difficulty, won)` vs the computer (`easy`/`medium`/`hard`), once
  per match (`match.recorded`); online in the `mp` bucket through `mp.js countResult` (once per
  phone, `gamehub.archery.counted.v1`); pass and play and practice record nothing. total/byDiff
  only (no sub-counter), so My Stats draws it with the generic screen.

## Files

| File | What |
|---|---|
| `js/engine.js` | the rules, pure: scoring, the match (rounds, turn order, shoot-off), the wind, the ring and sway, panic, the computer. `node archery/js/test.js` |
| `js/render.js` | the range in three.js (`skeeball/js/vendor`): stadium, lane, target, arrows, the three cameras, the sight's magnified view |
| `js/ui.js` | DOM: setup, HUD, the bow SVG, hold-to-draw input, the turn flow, replays, menus, autosave, stats, the online match |
| `js/mp.js` / `js/mp-ui.js` / `js/alert.js` | online challenges (data, list screens, launcher bubble). `node test-archery-mp.mjs` |
| `js/strings.js` | every word, EN/ES |

## The rules (Matt's answers, 2026-10-14)

- **3 rounds of 3 arrows**, highest total wins. Standard 10-ring face; a line-cutter takes the
  higher ring (`scoreAt`). Off the face is 0 ("M" on the tile).
- **The challenger (online) or the starter (locally) shoots first in EVERY round** (Matt: *"The
  challenger shoots first. They go first each round. You can alternate on the next game"*). Vs the
  computer, "Shoots first" on the setup card (Alternate by default, flipping every match).
- **A tie after 3 rounds is a shoot-off** (Matt: *"One more arrow"*): one arrow each, starter first,
  higher score wins. **The same score goes to the arrow closer to the middle** - my choice (the
  standard archery rule), not Matt's; exactly level shoots again. Shoot-off arrows are not added to
  the round totals.
- **The wind**: one value per round, the same for both players, new every round and stronger every
  round (Matt: *"Yes. But it must vary per round"*, *"the wind gets more difficult. Round 1 of the
  match you saw was wind at 1.5mph"*). Ranges 0.5-2.0, 2.0-4.0, 4.0-6.0 mph (a shoot-off uses
  round 3's); 8 directions; 0.09 face radii of drift per mph. Worked out from the match's seed
  (online: the match id), so two phones agree with nothing stored. The target never moves (Matt).
- **The ring round the sight** (measured off the recording): full for 0.4 s, then drains 0.3 a
  second while the aim moves and 0.1 while still; yellow below a third. **Empty = PANIC** (Matt:
  *"Make it so the animated person panics and shoots it over the target"*): the bow shakes for
  0.6 s, jerks up, and the arrow goes over the target (`panicPoint`, always 0). This drain model
  is my best reading of two arrows' worth of frames, not a certainty; tune `GAUGE` if it feels off.
- **The sight sways** on its own, more as the ring drains (`swayAt`).

## The turn (timed off the recording; docs/ARCHERY-BRIEF.md section 2)

Touch and hold anywhere on the range: the bow comes up in 0.18 s with the target magnified in the
sight (a second camera drawn into a disc under the ring). Drag to aim (about a ring per 6 px of
finger at phone width). Let go: the camera chases the arrow for 0.75 s, cuts to the target, the
number pops 0.6 s later with stars, and the target stays up 2 s. After the other player's round
(the computer's, or the other person's online), their arrows land in the target one by one with red
tiles, then the yellow **Your Turn** button takes you to the line, as in the recording. Pass and
play hands over with a **Pass to <name>** card instead.

**The point under the sight's crosshair IS the aim.** `render.js setScope` draws the zoomed view
at the screen point `ui.js` puts the ring at, from the same numbers, so they cannot disagree.

## Modes

- **Vs the computer**, Easy / Medium / Hard (`CPU` in engine.js: a gaussian miss and how much of
  the wind it allows for). Measured per arrow: about 5.1 / 7.0 / 8.6.
- **2 players on one phone** (Multiplayer › Pass & play). Not recorded.
- **Practice** (setup card): endless rounds of 3 with a new wind each round, best round kept on
  screen. Not recorded, not saved.
- **Online challenges**, below.

## Online challenges

The sixth challenge game. Darts' design, copied (`darts/CLAUDE.md`, "Online challenges"):

- **Node**: `archery/games/<id>` + `archery/index/<CODE>/<id>`, chat at `archery/chat/<id>`.
  `archery` is in `database.rules.json` and `backups/rtdb-backup.mjs`. **NOT YET PUBLISHED**
  (2026-10-14): until Matt pastes the rules, every read is refused and the online screens say so.
- **A match is a LOG of arrows**, each the face point it landed on (x, y, 1/10000 of a radius).
  `validateGame` replays it and refuses the whole document if one arrow does not replay. One
  online turn = one round (3 arrows), written arrow by arrow (`appendLog`), with the offline
  outbox `gamehub.archery.outbox.v1`.
- **Opening a match** replays the log up to the other person's latest run, then SHOWS that run on
  the target (`_mpCatchUp` / `_mpReplayNext`), then the Your Turn button.
- Cancel / decline / resign / 3-day expiry exactly as root `CLAUDE.md`, "Cancel, decline, resign,
  expire". The hub's Challenges screen reads it through `js/challenges.js` `SOURCES.archery`.
- **Push**: `archeryTurnPush` in `functions/index.js` (`decideArchery` in `functions/decide.js`):
  a challenge, your turn (with the round and score; a shoot-off says so), the end. **NOT YET
  DEPLOYED** (2026-10-14): live only after Matt runs `firebase deploy --only functions`.
- Quick chat (`js/match-chat-ui.js`): the button sits under the menu button on the right edge
  (`CHAT_PLACE`), clear of the round pill and tiles on a 320 px phone.

## Tests

- `node archery/js/test.js` (46): scoring at every ring and line, the wind (same on both phones,
  in range, never weaker round to round), the match and its turn order, shoot-offs, save
  validation, the ring and sway, panic always 0, the computer's averages.
- `node test-archery-mp.mjs` (42): a whole challenge between two "phones" against an in-memory
  database, delivery, rounds, a shoot-off, whole-document rejection, cancel / decline / resign /
  expire, the outbox, the rules file and backup list.
- `node test-push.mjs` (the `decideArchery` cases), `node test-challenges.mjs`,
  `node test-admin-config.mjs` (the online gate), `node check-no-scroll.mjs archery` (56 screens).
- **Checked in headless Chromium (2026-10-14)**: a whole match vs the computer, a pass-and-play
  match that went to a shoot-off, practice, and a whole ONLINE match through the real UI with two
  players taking turns against an in-page stand-in database (replays, Your Turn, waiting, result,
  the `mp` result recorded). `window.__arTest.ui` is the test seam; `ui.speed` fast-forwards game
  time. Not yet played on a real phone.

## Not built / open

- Real-phone feel: the drag gain, the ring's drain and the sway were set from the video, not from
  a thumb. Expect Matt to tune them.
- No series (best of 3/5) online.
- No sound, and none is ever to be added unless Matt asks (root `CLAUDE.md`).
