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
on screen is drawn from code here (the stadium, the target, the 3D bow and arm, the tile art). Matt
asked for it to be indistinguishable; the line held is that it matches the recording's look,
layout, colours and motion with our own models, and never traces or lifts their artwork. The
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
| `js/render.js` | the range in three.js (`skeeball/js/vendor`): stadium, lane, target, arrows, the three cameras, the sight's magnified view; draws the bow's scene over the range |
| `js/bow3d.js` | the bow, left hand, sleeve and nocked arrow as lit 3D models (a first-person view model), built from code, laid out from grid measurements of the recording |
| `js/ui.js` | DOM: setup, HUD, the sight's ring SVG (gauge + crosshair), hold-to-draw input, the turn flow, replays, menus, autosave, stats, the online match |
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

## The turn (timed off the recording at 30 fps)

Touch and hold: the bow comes up in 0.25 s (`DRAW_T`). Drag to aim (about a ring per 6 px). Let go:
the bow kicks 0.06 s (`JOLT_T`), then the flight, 0.8 s (`FLIGHT_T`): the camera holds still for the
first fifth while the arrow climbs up and right, then glides to the close-up as the arrow drops in
from the right (`render.js` `_camAt` / `_tipAt`, framed from the camera, not simulated). The number
pops 0.6 s later with stars and the scored ring flashes yellow (`_pop`, `.ar-ringflash`); the target
stays up 2 s; the camera eases back about 5% over the first 0.55 s (`SETTLE_T`, `render.settle`).
Back on the line the view cuts and the bow slides up into place (`BOW_IN_T` 0.2 s).
After the other player's round their arrows land one by one with red tiles, then the yellow **Your
Turn** button. Pass and play hands over with a **Pass to <name>** card.

## The look (matched to the recording, 2026-10-14)

Matt: *"I shouldn't be able to tell the images apart"*, *"Do the 3d rebuild"*, then *"keep working
until you are satisfied"*. Every position below was measured on a grid over the recording's frames,
compared at the recording's own game-area shape (402 x 718 CSS px; the recording's card is wider than
a phone screen). Full story: `archery/CLAUDE-HISTORY.md`.

- **The sight's outer ring is a tenth of the screen width** (`this.k`); the zoom shows the face at
  about two fifths of the sight (`/0.5`). The ring is SVG (`ringSVG`: grey housing, green gauge
  inside it, red crosshair).
- **The bow, hand, sleeve and nocked arrow are 3D** (`bow3d.js`, a lit view model drawn over the
  range; `render.js setBow`). `setPose` puts the bow at the depth that makes its sight match the
  ring. Its layout is in units where the ring's outer radius is 0.635 (`BODY_S` 0.85 converts the
  measured layout to that ring): the blue limb in a black cage on a pocket block at the top, a blue
  fork and column right of the sight, the shelf below-left of the column, the black grip under the
  shelf, the hand round it, the sleeve to a fixed shoulder (`SHOULDER`). The arrow runs from a
  nock by the face (`NOCK`) through the rest (`REST`). No lettering is copied from the recording.
- **Draw calls**: the bow's static parts are merged into one mesh per material (`mergeByMaterial`):
  about 97 a frame while aiming, the bow 23 of them.
- **The close-up**: the board half-width is 1.14 face radii as DRAWN (`BOARD_HALF`; the rules'
  `BOSS` stays 1.3, which only matters for arrows that score 0), 1.06x taller than wide, about half
  the screen wide, seen from the left. Arrows arrive from the right, nearly level (`inDir`); blue in
  front, black behind. Sun shadow of the board (not on software GL).
- **The stadium**: sky with clouds; a pale canopy roof with dark slanted ribs, its front edge at
  about a quarter of the screen height and its back meeting a pale rim at about a third; one deep
  tier of blue-and-yellow seats down to the blue barrier (`_buildRoof`, `paintCrowd`).
- **HUD sizes** match the recording (round pill 18 px, 40 px tiles, 76 px wind card with a square
  white icon, 26 px totals, avatars overlapping the bars, a red V and blue S).
- **No words on the range** (the recording has none): the hint is only the pulsing dot and hand;
  the text goes to screen readers through the live region (`_hint`). The last score number is
  cleared when the Your Turn button shows. The button is 44 px tall, 14 px text.
- **Names, never "You"** on the result card and match lists (root `CLAUDE.md`): `win_name`,
  `{me}` in `mp_scores`, `mp_you_*`.

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

Open items: see the root TODO.md, "Archery".
- No sound, and none is ever to be added unless Matt asks (root `CLAUDE.md`).
