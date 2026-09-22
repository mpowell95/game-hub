// test-hoops4-mp.mjs - the PURE halves of Connect 4 Hoops' turn-by-turn multiplayer.
//
// `node test-hoops4-mp.mjs`. No browser, no network.
//
// What it covers, and why each one is here rather than being obvious:
//
//   validateGame   WHOLE-DOCUMENT REJECTION. A half-accepted match is worse than none: one bad
//                  move entry and the log replays into a DIFFERENT position on the two devices,
//                  with nothing on either screen saying so.
//   replay         the only thing that gives an async match a board at all. It must reproduce the
//                  position AND the shot counts, because the shot counts are the accuracy line.
//   the turn       who may shoot. Under one-shot a miss is a log entry; under shoot-until it is
//                  not, and getting that backwards desyncs the match on the first airball.
//   the listing    what a player sees, and what a launcher badge would count.
//
// The Firebase write path and `hoops4/js/mp-ui.js` are NOT covered - the same honest scope
// `test-messages.mjs` states about its own halves.
import { readFileSync } from 'node:fs';
import * as MP from './hoops4/js/mp.js';
import { Match, RED, YELLOW } from './hoops4/js/game.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  -- ' + detail : ''}`); }
};

console.log('\nCONNECT 4 HOOPS - turn-by-turn multiplayer\n');

const A = 'ABCDE', B = 'FGHJK';
const doc = (over) => ({
  v: 1, created: 1, updated: 2, oneShot: false,
  a: { code: A, name: 'Matt', emoji: '🏀' },
  b: { code: B, name: 'Anita', emoji: '🌟' },
  turn: 'a',
  moves: { '0000': { by: 'a', col: 3, shots: 2, at: 10 }, '0001': { by: 'b', col: 3, shots: 1, at: 20 } },
  over: over || null,
});

// --- validateGame -----------------------------------------------------------------------------
check('a well-formed match validates', !!MP.validateGame(doc()));
check('a match with no b side is refused', MP.validateGame({ ...doc(), b: null }) === null);
check('a match with the SAME player on both sides is refused',
  MP.validateGame({ ...doc(), b: { code: A } }) === null);
check('a match with a nonsense turn is refused', MP.validateGame({ ...doc(), turn: 'c' }) === null);
check('a move in a column that does not exist is refused',
  MP.validateGame({ ...doc(), moves: { '0000': { by: 'a', col: 7 } } }) === null);
check('a move by nobody is refused',
  MP.validateGame({ ...doc(), moves: { '0000': { by: 'x', col: 1 } } }) === null);
check('a non-integer column is refused',
  MP.validateGame({ ...doc(), moves: { '0000': { by: 'a', col: 1.5 } } }) === null);
check('a winner who is not a player is refused',
  MP.validateGame({ ...doc({ winner: 'c' }) }) === null);
check('a DRAW (winner null) is a legal ending',
  !!MP.validateGame(doc({ winner: null, why: 'full', at: 9 })));

{
  const many = {}; for (let i = 0; i < 700; i++) many[String(i).padStart(4, '0')] = { by: 'a', col: 0 };
  check('an absurdly long move log is refused', MP.validateGame({ ...doc(), moves: many }) === null);
}
{
  const g = MP.validateGame({ ...doc(), moves: { '0000': { by: 'a', miss: true, at: 5 } } });
  check('a one-shot MISS is a legal log entry', !!g && g.moves[0].miss === true && g.moves[0].col === null);
}
{
  // Keys are read in SORTED order, not insertion order: a move list handed back by Firebase has no
  // guaranteed key order, and applying two moves the wrong way round is a different board.
  const g = MP.validateGame({ ...doc(), moves: {
    '0001': { by: 'b', col: 5, shots: 1 }, '0000': { by: 'a', col: 2, shots: 1 },
  } });
  check('moves come back in key order, whatever order the object arrived in',
    g.moves[0].col === 2 && g.moves[1].col === 5);
}

// --- sides and turns ----------------------------------------------------------------------------
{
  const g = MP.validateGame(doc());
  check('sideOf finds each player', MP.sideOf(g, A) === 'a' && MP.sideOf(g, B) === 'b');
  check('sideOf refuses a stranger', MP.sideOf(g, 'MNPQR') === null);
  check('isMyTurn follows `turn`', MP.isMyTurn(g, A) === true && MP.isMyTurn(g, B) === false);
  check('otherLabel is the other person', MP.otherLabel(g, A).name === 'Anita');
  const done = MP.validateGame(doc({ winner: 'a', why: 'four', at: 3 }));
  check('a finished match is nobody\'s turn',
    MP.isMyTurn(done, A) === false && MP.isMyTurn(done, B) === false);
}

// --- replay -------------------------------------------------------------------------------------
{
  // The position: a plays column 3 (having missed once first), b plays column 3.
  const g = MP.validateGame(doc());
  const m = MP.replay(new Match({ oneShot: false }), g);
  const cells = m.cells();
  check('replay puts the discs where the log says', cells[3][0] === RED && cells[3][1] === YELLOW);
  check('replay hands the turn back to a', m.turn === RED);
  // THE SHOT COUNTS ARE THE ACCURACY LINE. a took 2 shots for its disc, b took 1.
  check('replay charges the shooter the misses that came before the make',
    m.shots[RED] === 2 && m.shots[YELLOW] === 1, JSON.stringify(m.shots));
}
{
  // Under one-shot a miss is in the log and PASSES the turn. Replay must honour that or the two
  // devices disagree about whose move it is from there on.
  const raw = { ...doc(), oneShot: true, moves: {
    '0000': { by: 'a', miss: true, at: 1 },
    '0001': { by: 'b', col: 0, shots: 1, at: 2 },
  } };
  const g = MP.validateGame(raw);
  const m = MP.replay(new Match({ oneShot: true }), g);
  check('a one-shot miss replays as a turn handed over',
    m.cells()[0][0] === YELLOW && m.turn === RED, `turn ${m.turn}`);
}
{
  // A replay must stop at the win rather than running past it into an illegal position.
  const moves = {};
  let k = 0;
  for (const col of [0, 1, 0, 1, 0, 1, 0]) {       // a wins with four in column 0
    moves[String(k).padStart(4, '0')] = { by: k % 2 ? 'b' : 'a', col, shots: 1 };
    k++;
  }
  const g = MP.validateGame({ ...doc(), moves });
  const m = MP.replay(new Match({}), g);
  check('replay stops at the win', m.over === true && m.winner === RED);
}

// --- the listing ----------------------------------------------------------------------------------
{
  const rows = [
    { id: 'a1', with: B, name: 'Anita', updated: 10, yourTurn: false, over: false },
    { id: 'a2', with: B, name: 'Anita', updated: 5, yourTurn: true, over: false },
    { id: 'a3', with: B, name: 'Anita', updated: 99, yourTurn: true, over: true },
    { id: 'a4', with: B, name: 'Anita', updated: 20, yourTurn: true, over: false },
  ];
  const sorted = MP.sortRows(rows);
  check('games waiting on you come first, newest first, finished last',
    sorted.map((r) => r.id).join(',') === 'a4,a2,a1,a3', sorted.map((r) => r.id).join(','));
  check('the badge counts only the unfinished games waiting on you',
    MP.countMyTurns(rows, A) === 2, String(MP.countMyTurns(rows, A)));
  check('the badge is zero without a player code', MP.countMyTurns(rows, 'nope') === 0);
}

// --- ids ---------------------------------------------------------------------------------------
{
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(MP.mintGameId());
  check('a game id never repeats over 1000 mints', seen.size === 1000, String(seen.size));
  check('every minted id matches the id the reader accepts',
    [...seen].every((id) => /^[a-z0-9]{6,24}$/.test(id)));
}

// --- codes --------------------------------------------------------------------------------------
check('a player code is normalised and validated',
  MP.asCode(' abcde ') === 'ABCDE' && MP.asCode('ABCD') === null && MP.asCode('ABCDI') === null);

// --- structural ----------------------------------------------------------------------------------
// The two things a future edit could quietly get wrong, both of which this suite cannot see at
// runtime because they live in the Firebase half.
{
  const src = readFileSync(new URL('./hoops4/js/mp.js', import.meta.url), 'utf8');
  check('every write is followed by a fresh re-read (THE LAW rule 6)',
    /write VERIFY FAILED/.test(src) && (src.match(/await readGame\(id\)/g) || []).length >= 3);
  check('a dev origin cannot write to the family database',
    /writesAllowed\('createGame'\)/.test(src) && /writesAllowed\('pushMove'\)/.test(src));
  check('nothing in the store touches a gamehub.* STATS key',
    !/gamehub\.stats/.test(src));
  check('a permission failure is never retried for ever',
    /PERMISSION_DENIED/.test(src) && /retryableOf/.test(src));
  const rules = readFileSync(new URL('./database.rules.json', import.meta.url), 'utf8');
  check('the `hoops` node is enumerated in database.rules.json (the root is deny-by-default)',
    /"hoops"\s*:/.test(rules));
  const backup = readFileSync(new URL('./backups/rtdb-backup.mjs', import.meta.url), 'utf8');
  check('the backup script knows about the `hoops` branch', /'hoops'/.test(backup));
}

// The UI half is DOM code this suite cannot mount, so it is checked structurally - each of these
// is a rule that, if it were quietly dropped, would look fine in a solo game and be wrong in a
// multiplayer one, which is exactly the class of defect nobody notices until two people play.
{
  const ui = readFileSync(new URL('./hoops4/js/ui.js', import.meta.url), 'utf8');
  check('shooting goes through ONE turn gate', /isMyShot\(\)/.test(ui)
    && /shoot\(power, aim\) \{[\s\S]{0,240}?if \(!this\.isMyShot\(\)\) return;/.test(ui));
  check('the gate reads THIS DEVICE\'s side, not RED',
    /return this\.match\.turn === this\.myPlayer;/.test(ui));
  check('a remote move is applied strictly in sequence, exactly once',
    /entry\.seq !== this\.mp\.applied/.test(ui) && /entry\.by === this\.mp\.role/.test(ui));
  check('a multiplayer result records against the repo\'s own \'mp\' difficulty',
    /recordResult\('hoops4', 'mp'/.test(ui));
  check('the win/lose headline is read from THIS device\'s side in multiplayer',
    /m\.winner === this\.myPlayer \? t\('youWin'\)/.test(ui));
  check('leaving detaches from the room and ends it', /_stopRoom\(\)/.test(ui)
    && /leaveRoom\(mp\.code, mp\.role\)/.test(ui) && /teardownEngine\(\) \{\n    this\._stopRoom\(\);/.test(ui));
  check('a failed turn-by-turn send never also says it was sent',
    /this\.toast\(t\('mpUnavailable'\)\);\n      return;/.test(ui));
  check('a fresh solo match clears the multiplayer state', /if \(!opts\.keepMp\)/.test(ui));

  const mpui = readFileSync(new URL('./hoops4/js/mp-ui.js', import.meta.url), 'utf8');
  check('a live guest takes the HOST\'s shot rule, not its own',
    /oneShot: !!\(res\.room\.config && res\.room\.config\.oneShot\)/.test(mpui));
  check('the sheet closes once, however many backdrops are bound', /if \(closed\) return;/.test(mpui));

  const css = readFileSync(new URL('./hoops4/css/hoops4.css', import.meta.url), 'utf8');
  check('the one scrolling overlay contains its own scroll',
    /\.h4-mp-body[\s\S]{0,300}overscroll-behavior: contain/.test(css));
}

// -----------------------------------------------------------------------------------------------
// THE LAUNCHER ALERT (hoops4/js/alert.js)
// -----------------------------------------------------------------------------------------------
// Matt: "to see a challenge, you must go into the hoops connect 4, click play a friend, then it's
// displayed below 'Challenge'. There is no other notification anywhere." decideAlert is the whole
// decision behind the launcher's speech bubble, and it is pure - so it is tested here rather than
// discovered by a screenshot.
{
  const A = await import('./hoops4/js/alert.js');
  const row = (id, o = {}) => ({ id, name: o.name || 'Anita', emoji: '🐱',
    updated: o.updated == null ? 100 : o.updated, yourTurn: !!o.yourTurn, over: !!o.over });

  const nothingSeen = A.decideAlert([row('g1', { updated: 100 })], {});
  check('an unseen match is a CHALLENGE, named after the person',
    nothingSeen && nothingSeen.kind === 'challenge' && nothingSeen.name === 'Anita');
  check('a match acknowledged at its own stamp says nothing',
    A.decideAlert([row('g1', { updated: 100 })], { g1: 100 }) === null);
  const moved = A.decideAlert([row('g1', { updated: 200, yourTurn: true })], { g1: 100 });
  check('a SEEN match whose turn came back round is a TURN, not a challenge',
    moved && moved.kind === 'turn');
  check('a seen match that moved but is NOT your turn says nothing',
    A.decideAlert([row('g1', { updated: 200, yourTurn: false })], { g1: 100 }) === null);
  check('a finished match never alerts, however new it is',
    A.decideAlert([row('g1', { updated: 999, over: true, yourTurn: true })], {}) === null);
  // A brand new match outranks a turn: it is the bigger event and the one with a name attached.
  const both = A.decideAlert([
    row('old', { updated: 300, yourTurn: true, name: 'Ana' }),
    row('new', { updated: 200, name: 'Bea' }),
  ], { old: 100 });
  check('a new challenge outranks an older match whose turn it is',
    both && both.kind === 'challenge' && both.name === 'Bea');
  check('the count covers every match wanting attention, not just the one shown',
    both && both.count === 2);
  check('a malformed listing cannot throw',
    A.decideAlert(null, {}) === null && A.decideAlert([null, {}], {}) === null);

  // STRUCTURAL: the hub must not learn what a Connect 4 Hoops challenge is. The registry hands it
  // a module; js/hub.js only handles the shape that module returns.
  const hub = readFileSync(new URL('./js/hub.js', import.meta.url), 'utf8');
  check('the hub reaches the alert module through a registry entry, not by name',
    /alerts: \(\) => import\('\.\.\/hoops4\/js\/alert\.js'\)/.test(hub)
    && /typeof g\.alerts !== 'function'/.test(hub));
  check('the alert check runs AFTER the launcher has painted, never on the critical path',
    /_afterPaint\(\(\) => this\._checkGameAlerts\(\)\)/.test(hub));
  check('a game tile cannot break the launcher', /console\.warn\('\[hub\] alert check failed for'/.test(hub));

  // [KNOWN-BUG PROBE] THE BUBBLE THAT WOULD NOT GO AWAY (2026-09-22). Matt, having played the
  // turn it was pointing at: "it should go away. I just did that and it stayed there even though
  // it's not my turn." Two faults, and each one alone is enough to bring it back:
  //   1. _dismissGameAlert took a `paint = false` on the open-the-game path, so the element was
  //      never removed - and neither launch() nor showLauncher() re-renders the grid, they only
  //      hide and un-hide it, so the same node came back into view on return.
  //   2. _checkGameAlerts only assigned this._gameAlert when it FOUND something, so an alert
  //      that had stopped being true was never cleared.
  check('[KNOWN-BUG PROBE] dismissing an alert always removes it from the DOM',
    !/_dismissGameAlert\(false\)/.test(hub)
    && /_dismissGameAlert\(\) \{[\s\S]{0,600}this\._gameAlert = null;\n    this\._paintGameAlert\(\);/.test(hub));
  check('[KNOWN-BUG PROBE] the alert check clears a stale alert, not just sets a new one',
    /this\._gameAlert = found;\n    this\._paintGameAlert\(\);/.test(hub));
  check('[KNOWN-BUG PROBE] returning to the launcher re-asks who is waiting',
    /showLauncher\(\)[\s\S]{0,1400}this\._checkGameAlerts\(\);/.test(hub));

  // The two states differ by their WORDS, not only their colour (Matt is red/green colourblind).
  const strings = readFileSync(new URL('./js/strings.js', import.meta.url), 'utf8');
  check('the bubble says which state it is in, in words',
    /hub_alert_challenged/.test(strings) && /hub_alert_your_turn/.test(strings));

  const h4css = readFileSync(new URL('./hoops4/css/hoops4.css', import.meta.url), 'utf8');
  check('the ceremony settles to its final pose under reduced motion, never hidden',
    /is-still[\s\S]{0,400}animation: none;[\s\S]{0,120}opacity: 1;/.test(h4css)
    && !/prefers-reduced-motion[\s\S]{0,400}\.h4-cer[\s\S]{0,200}display: none/.test(h4css));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
