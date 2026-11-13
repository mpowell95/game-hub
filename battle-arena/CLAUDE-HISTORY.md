# Battle Arena — history

## 2026-10-24: built (phase 1)

Built from `docs/BATTLE-ARENA-SPEC.md` (Matt's three Match Monsters recordings, 2026-10-23): vs the
computer only, admin only. The engine is pure JSON with a seeded RNG so phase 2 (live rooms and
turn-by-turn challenges) can replay moves on every phone. Twelve original monsters drawn as inline
SVG, each with an evolved form.

Tuning: the spec's numbers gave ~7 turns per side in an AI-vs-AI soak with ~25 specials a match, so
every HP went up by half and the weakest/strongest monsters were nudged (list in CLAUDE.md). Bombs
first went off from ANY orthogonal neighbour, which blew ~11 a match; they now go off only in line
with a match. The soak then found a match between two healing teams still going at 3000 moves, which
is where the Sudden death rule (no heals after each side's 20th turn) came from.


## 2026-10-24: v2, the battle screen rebuilt

Matt, after his first test: *"This game is NOT ready for me to waste my time testing it. It's very bad.
It's in no way, shape, or form a clone of the other game. Gameplay is missing pieces, it doesn't register
4 in a rows, it gives you 3 turns to begin, there's little to no animation at all."* A recording of the
first build confirmed it: specials were a small box, damage a tiny number, the extra move a tiny "+1 move"
pill, the move dots showed 3 after an extra move (likely the "3 turns"), gems vanished, monsters were
static. The rules missed that berries MATCH in the reference (they were picked up next to matches).
Rebuilt: engine (matchable berries, bombs set off by an adjacent match, a `pass` move for the 30 s timer),
glossy gems, a Boiler Room scene, and the whole event-to-animation layer (see CLAUDE.md, "The battle screen").


## 2026-10-24: v3, a frame-by-frame comparison with the reference

Matt: *"Now go back and review everything again. Compare the real game with ours. Find the
discrepancies. Fix them."* A move-by-move log of rec3 (vs oksurely09, 22 moves) plus my own frame
checks found: any adjacent swap is legal (fixed earlier the same night); a 5-match (incl. L/T) gives
an extra move outside the once-a-turn 4 cap and heals; evolving is a chosen move that costs a move and
heals nothing (the +5 seen in the bravomike match was a 5-match in the same turn); specials clear part
of the board; the timer is per move; the board dims on the other side's turn; the HUD, banners, stage
reveal and ending all looked different. The first two recordings (vs bravomike) were no longer in
Dropbox, so they could not be re-checked move by move.


## 2026-10-24: Online (turn-by-turn challenges and live rooms)

Matt wanted both: challenges like Darts / Chinchón (async) and live rooms like Chinchón's. Built on the
engine as it was designed: a match is a seed, two teams and a list of moves, and every phone replays it.

Decisions where the brief was open:
- **Who moves first**: the challenger (Darts' convention, challenge delivered when their first turn ends)
  and, in a live room, the host (`round.dealer = 0`). One match per room (Pool's precedent: no in-room
  rematch series); "Done" leaves the room.
- **The receiver drafts later.** The challenger picks a team when making the challenge; the other person
  picks on first open, from their own unlocked monsters. That works only because the engine never reads
  the non-mover's monster ids during the challenger's first turn (charging, specials and evolving are the
  mover's own); the challenger's turn is played against a placeholder team and replays identically once
  b drafts. `tools/test-battlearena-mp.mjs` checks it over 300 seeds x 3 teams. Drafting is not an
  answer (cancel/decline still work) and does not move `updated` (the 3-day expiry runs from delivery).
- **The mirror instead of a rewritten screen.** ui.js draws its player on the right as side 0 in a
  hundred places; rather than thread a seat through all of them, side b's phone draws a mirrored copy of
  the state (teams swapped, board untouched) and every move is applied to the stored state (`step`). The
  test also proves the engine is symmetric (apply on the mirror = mirror of apply, events included).
- **Live rooms are lockstep with a hash** (js/CLAUDE.md invariants): each move carries the FNV-1a of the
  whole match after it; a mismatch makes the guest ask the host for its state.
- **The clock** shows on both phones in a live room (counting locally, paused while animating); only the
  mover's own phone passes the turn at 0. A phone that vanishes can be resigned for after 90 s
  ("Claim win"). Leaving is resigning; closing the app is not (the room code is kept and rejoined).
- **Records**: challenges `recordResult('battlearena', 'mp', won)` only (the Multiplayer screen reads them
  from the index); live rooms also `recordHeadToHead` (js/mp-records.js `LIVE_GAMES`), as Chinchón.

Verified with two headless phones (390x844) sharing an in-memory database: the Firebase SDK modules
were routed to a stand-in, so nothing could reach Firebase. A full live match (incl. a clock run-out and
chat both ways) and a full challenge were recorded on both phones and read frame by frame.


## Own attacks, evolution scene, test mode (2026-10-28)

Matt wanted to test Battle Arena against specific real players and named three things first: an unlock
system ("I don't think we have any"), attack and evolve animations ("every attack looks the same: an energy
ball that hits other players. This is where the game must stand out"), and testers knowing it is a test ("must
be obvious and always clearly present"). The unlock system already existed (wins-based, derived, this
device's store only); Matt chose to keep testers on the 6 starters with normal unlocks, so this added the
"N more wins" count on locked tiles and a "New monster!" reveal. A mockup (Emberkit, Zapup, Gloomite +
evolve) was approved ("those are sick"), then all 12 were built in `js/attacks.js`, each verified by
replaying a synthetic special on the real battle screen and reading the frames. The projectile ball and the
old flicker evolution are gone. Cross-device win counting for unlocks was proposed but not built.


## 2026-10-29: the arena look outside a match, and the Monsters screen

Matt sent screenshots of the home and Online screens: "Make these screens better. They're lackluster.
And we need a monsters thing so you can view all of them and their abilities and evolved versions. You
should only be able to see silhouettes of the [locked] monsters and the number of wins needed to unlock them."

- Home, draft, Online (every `online-ui.js` frame), Monsters and the overlays now wear the battle's Boiler
  Room look in both themes (they followed the hub theme before, so light mode was beige). Home: a two-line
  logo (first words white, last word huge yellow), two random unlocked monsters facing off with "VS" on the
  hazard-edged floor, the menu standing on the floor: difficulty, PLAY, Online + Monsters (unlocked count pill).
- Monsters: the draft's 4x3 grid with names. Locked tiles show a black silhouette (`filter: brightness(0)`
  plus a faint white rim), a lock and the wins still to go; no name, no element badge (the aria-label says
  "Locked, N more wins"). The card: big art in its element's glow, name, element + charge, special, and the
  normal and evolved forms side by side as the toggle (pictures instead of the "Normal / Evolved" words).
- The draft's locked monsters used to be grey but fully drawn, and their card showed everything; now both
  are silhouettes, matching Monsters. A monster seen in a battle (an opponent's) still shows in full.
- `tools/check-no-scroll.mjs` measures "monsters + card" (evolved form). 56 screens, 0 scroll.

## Release review (2026-11-13)

Matt asked for "a full exhaustive thorough review of Battle Arena to get it ready to be released". Two
read-only reviews (rules/online, screens) plus a 600-match engine soak: the engine was clean (no stuck
board, no first-turn KO, one extra move a turn, JSON-safe state, deterministic replay, mirror correct).
What was wrong and fixed:

- Vs the computer, the menu opened during the WINNING move's animation offered New match / Home with
  `winner` already set; `quitCostsLoss()` needs `winner == null`, so the save was cleared and nothing
  recorded (a reviewer reproduced it: played 0 after a win). Same hole let a loss by the computer's last
  blow vanish. Now `recordOutcome()` runs from `finish()`, the menu's quit and `destroy()`.
- Live rooms: a claim wrote `{by: <claimed side>, k: 'r'}` at the shared seq; the claimed phone treated
  any entry by its own side as "my move not echoed yet" and never applied it, and its own late move
  (`appendMove` is a plain set) overwrote the 'r'. Both phones could then claim and both win. Now the 'r'
  is applied, and every resign or claim also ends the room with `forfeit/<loser seat>` in the same write
  (the shared `js/live-leave.js` shape), read first on any ended room and on a rejoin.
- Live recovery: the host's state was written as an object; Firebase returned it with keys sorted and
  nulls / empty arrays dropped, so its hash never matched again (every later move re-asked). The host,
  on a guest move it could not replay, simply stopped applying moves for good. Now the state is a JSON
  string and the host keeps its own result and pushes it.
- A live room left through the hub's Back was only detached; the opponent had to wait 90 s and claim
  (into the race above). Now `quitCostsLoss`/`leaveMatch` resign it after your first move.
- A challenge knockout made offline and sent after the turn had timed out was counted as a WIN on this
  phone while the server refused the move. Now it is counted when the move lands (else the launcher
  counts the stored result).
- `drainOutbox` wrote back only what it had read, wiping a move saved meanwhile. `mp.js`'s own
  `writesAllowed` checked only the origin (the automation-guard test passed on the function's name).
- Mode: a challenge counted from the launcher (the usual path for the player who did not make the last
  move) had no mode at all (`'?'`); no online result said who went first or live vs challenge; no
  result carried detail. All added (`onlineMode`, `matchDetail`, index `tm`).
- Screens: battle HUD text at 11-13px (names, Your Turn, clock label, MOVES, badges, the Stage button,
  whose `font: 900 13px/1 inherit` shorthand was invalid and fell back to the browser's 13.3px); help
  lines at 11-14px with the berry line cut off; the monster card's X under the art (`z-index`); "New
  team" split over two lines; the end card upper-casing the profile name; the Online tab stuck on "…"
  when `online-ui.js` could not load. `tabCpu` in Spanish was "Máquina" beside the game's own "Ordenador".
