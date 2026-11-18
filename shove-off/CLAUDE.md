# Shove Off — shove-off/CLAUDE.md

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost, never put at
> risk. The law and its nine working rules are at the top of the root `CLAUDE.md` (full text: `js/CLAUDE.md`).

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in
`CLAUDE-HISTORY.md` (append a dated section).

Matt filmed GamePigeon's Knockout (2026-11-18): *"Yes, this is gamepigeons knockout. And yes I want our own
version of this"*. Looks: *"Can we have sumo wrestlers, bumper boats/cars, and plain pucks as options? Two colors
of each. And let people choose which they play with. Like tower stack or brick lock"*. Tie: *"Sudden death"*.
Modes: *"Online challenges"* ONLY. Our OWN game: never GamePigeon's name, penguins, art or look.

## Status: ADMIN ONLY (`devOnly: true`), NOT cleared for players

Ships to players only when Matt says "release it". Release = drop `devOnly` + add `released` (js/hub.js), remove
`shoveoff` from `ADMIN_ONLY` (js/game-stats.js) and `devOnly` from `js/game-stats-ui.js` TABS, add the folder's files to
`sw.js` ASSETS, `tools/validate-sw-assets.mjs`, bump CACHE. While admin-only its plays go to the TEST record.

## Hub integration

- Module, `immersive: true`, hub id = folder `shove-off`, stats id `shoveoff`, CSS root `.so-root` / prefix `.so-`.
  `alerts: () => import('../shove-off/js/alert.js')` (launcher bubble, Multiplayer screen). In `BUG_BTN_GAMES` (the
  top-right corner is clear on every screen: the chat button sits a row lower, the menu bottom left).
- **`isInProgress()` is always `false`**: every round's aims are written the moment Launch is tapped (an outbox,
  `gamehub.shoveoff.outbox.v1`, keeps them with no signal) and arrows not yet launched are kept per match and round
  in `gamehub.shoveoff.draft.v1`. Exports `back()`: the hub button / back swipe step back one screen
  (`js/back-stack.js`; setup 0, people / challenge / match 1, challenge from people 2), hub pill reads "‹ Back".
- Settings `gamehub.shoveoff.v1` = `{ look, tab }`, saved on tap. Other keys: `.seen.v1`, `.shown.v1` (rounds already
  slid on this phone), `.counted.v1` (the ledger), `.unseenResults.v1`, `.mlogged.v1`, `.open.v1` (sessionStorage).
- Files: `js/engine.js` (rules + physics, PURE), `js/mp.js` (data), `js/alert.js`, `js/ui.js` (screens), `js/art.js`
  (all drawing), `js/strings.js` (EN + ES "Empujón"), `css/shove-off.css`, `index.html` (name gate, no-zoom, noindex).

## Rules (engine.js) and every choice made (Matt may want to change any of these)

- Square platform, half-size `H0` 1000 units; piece radius `R` 100; 4 pieces each, interleaved on a ring
  (`START`): a quarter turn maps every challenger spot onto a receiver spot, so neither side has better spots.
- A round: both aim every living piece in secret (drag from a piece; the arrow's direction is where it slides, its
  length how hard, capped at `MAX_AIM` 560). Launch appears once every living piece has an arrow; a tap on a piece
  clears its arrow. **No piece can stay still**: every piece must be aimed (the shortest arrow is about one radius).
- When both have sent, everything slides at once: speed = aim x `SPEED_K` 0.07 per step, friction `DAMP` 0.965 per
  step, stops under 0.05/step, equal-mass bounces (`REST` 0.92), at most `MAX_STEPS` 900. A piece whose CENTRE
  leaves the platform at any step falls in at once.
- **The platform shrinks AFTER each round** (round 1 is the full platform): half-size x `SHRINK` 0.88, floor `H_MIN`
  460 (reached after 7 rounds). A piece whose centre is outside the new edge falls too ("the edge melts").
- One side out: the other wins (`why: 'off'`). **Both out in the same round = SUDDEN DEATH**: one piece each on the
  small platform (`SD_H` 520) at mirrored spots (-230, 0) / (230, 0); a sudden-death round where both survive
  plays on (shrinking); both out again resets the sudden-death pieces. **After `SD_MAX` 10 sudden-death rounds
  with no winner: a DRAW.** A sudden-death win is `why: 'sudden'`.
- **`ROUND_MAX` 30 normal rounds** with both still on (nobody shoving): more pieces wins (`why: 'count'`), equal
  goes to sudden death.
- Colours: hub safe palette. Sumo vermilion / blue, Bumper cars yellow / teal, Pucks black / white. **The two sides
  always differ by SHAPE too**: the challenger's pieces wear a white CIRCLE, the receiver's a white TRIANGLE. If both
  chose the identical look, the receiver's pieces are drawn in that look's other colour (`art.js` `sideLooks`).
- The PLATFORM follows the VIEWER's look: Sumo = clay ring with straw bales in a dark hall; Bumper cars = rubber
  arena with a striped tyre wall on water; Pucks = air table on a dark floor. Original canvas art, no images.
- The match fixes each side's look: the challenger's at create, the receiver's with their first send (until then
  the receiver sees their CURRENT choice).

## Determinism (critical)

Both phones replay the match from the log. `engine.js` uses ONLY `+ - * /` and `Math.sqrt` (plus exact
`Math.round`/`Math.sign`/`Math.max` on integers or comparisons), a fixed step, a fixed step cap and a fixed
order over pieces and pairs; no clock, no random, no trig (drawing only, `art.js`). Aims are INTEGERS.
`shove-off/js/test.js` scans the engine's text for trig/pow/exp/hypot/random/`**` and pins one round's result
bit for bit (**change a physics number = re-pin it on purpose**).

## Online challenges (`mp.js`, Darts' and Golf's pattern, no code shared)

- Node `shoveoff/games/<id>`, `shoveoff/index/<CODE>/<id>`, chat `shoveoff/chat/<id>`. Log entries
  `{ by: 'a'|'b', r: <round>, aims: "dx,dy;dx,dy;-;dx,dy", at }` (one per side per round; `-` = a piece that is
  out; a string because Firebase drops array holes). Server timestamps (`js/challenge-clock.js`), every write
  verified by a fresh re-read, nothing deleted. `validateGame` replays the whole log and refuses a bad document WHOLE.
- **Rounds are SIMULTANEOUS**: "your turn" = you have not sent this round, so BOTH rows say `yourTurn` at the start
  of every round after the first (rows also carry `both`). Rows change only on delivery, the receiver's first send,
  a RESOLVED round (both rows: your move), and the end; one side sending first touches only its own row (no push to
  the other). **Known limit: the first sender's aims sit in the database until the other sends; the app never shows
  them, but someone with dev tools could read them.**
- Delivered when the challenger sends round 1 (Darts' rule). OPEN until the receiver's first send: cancel / decline;
  once the challenger has sent (always true after delivery), a cancel or decline is the caller's LOSS
  (`js/challenge-life.js` `callOffCosts`). Resign: the other wins. 3 days unanswered: expired. **7 days on a round
  (from when it began): whoever still owes it loses; BOTH still owing = a DRAW by timeout** (my choice; the shared
  `rowTimeout` would call both rows a loss, so `mp.js` has its own `rowLate`).
- Gates: `onlineGate()`, `codeMayPlayOnline(code, 'shove-off', name)` on create and on the picker (admin-only: only
  codes Matt opened it to), test automation never writes (`automationBlocks`), a dev origin never writes.
- Push: `shoveOffTurnPush` + `decideShoveOff` (`functions/`), in `REMINDER_GAMES` and the nudges key pattern; rules
  branch `shoveoff` in `database.rules.json`; `backups/rtdb-backup.mjs` BRANCHES. **Deploys with the merge.**
- Results: once per phone per match (`gamehub.shoveoff.counted.v1`), `recordResult('shoveoff', 'mp', won|null)` via
  `withChallengeMatch` + `withMode`. Mode `{ on: 1, look, them (their look), first: 'me'|'them', sd: 0|1 }`; detail
  `{ rounds, kos (their pieces that fell), lost (own), sdr, end }`; the private play log gets every round's aims and
  every piece before and after (`privateMatch`). Index rows carry `md`/`dt` so a count from the list has them.
  `VOIDED_MATCHES` honoured.

## Screens (fewest words)

Setup: title, record chip, "?", the six looks (3 kinds x 2 colours), tabs Matches | Challenge (opens on Matches
when a match is going). Challenge: Anyone (search, paged list) + 4 recent first names -> the challenge card (their
face and name, your look, Challenge). Match: both players' face, first name and pieces left as icons (yellow frame =
still owes this round), "Round N" / "Sudden death", the board, bottom: menu, "2 / 4" -> Launch -> "Sent ✓ Waiting for
<name>". A resolved round plays on screen: both sides' arrows (1.1 s), the slide, the shrink. Menu: How to play,
Cancel / Decline / Resign (two taps; "Counts as a loss." when it does), Matches. Game over: winner's face,
"<name> wins!", how (resigned, timed out, sudden death, more pieces left), X, Again, Matches. Nothing scrolls.

## Tests

`node shove-off/js/test.js` (engine: fairness, aims, collisions, falls, shrink, sudden death, draw ceiling,
determinism + text scan), `node tools/test-shoveoff-mp.mjs` (challenges end to end), plus `tools/test-push.mjs`,
`tools/test-challenges.mjs`, `tools/test-no-deletes-rules.mjs`, `tools/check-no-scroll.mjs shove-off`.
Screens were checked in headless Chromium against an in-memory database (393x852 and 360x640, light/dark, EN/ES);
**real phones, the real database and real push are unverified.**
