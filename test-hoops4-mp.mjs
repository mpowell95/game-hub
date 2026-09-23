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
    && /leaveRoom\(mp\.code, mp\.role\)/.test(ui) && /teardownEngine\(\) \{\n    (?:this\._unmountChat\(\);\n    )?this\._stopRoom\(\);/.test(ui));
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
// A SERIES, AND THE TERMS OF A CHALLENGE (2026-09-22)
// -----------------------------------------------------------------------------------------------
// Matt: "Before you challenge someone or anything, you should be able to select the shots per turn
// setting and if you want to play a single game, best of 3 series or best of 5 series."
{
  const g = (o) => ({ series: 3, seriesNo: 1, seriesWins: { a: 0, b: 0 }, over: { winner: 'a' }, ...o });

  check('a best of 3 needs two wins, a best of 5 needs three',
    MP.seriesTarget(3) === 2 && MP.seriesTarget(5) === 3 && MP.seriesTarget(1) === 1);
  check('a junk series length is a single game, never a crash',
    MP.seriesTarget(4) === 1 && MP.seriesTarget(null) === 1 && MP.seriesTarget('x') === 1);

  const g1 = MP.seriesAfter(g({}));
  check('winning game 1 of 3 does not take the series', g1.wins.a === 1 && !g1.done);
  const g2 = MP.seriesAfter(g({ seriesNo: 2, seriesWins: { a: 1, b: 0 } }));
  check('winning game 2 at 1-0 takes it', g2.done && g2.winner === 'a' && g2.wins.a === 2);
  const lvl = MP.seriesAfter(g({ seriesNo: 2, seriesWins: { a: 1, b: 0 }, over: { winner: 'b' } }));
  check('losing game 2 at 1-0 levels it and plays on', !lvl.done && lvl.wins.a === 1 && lvl.wins.b === 1);
  // A DRAWN BOARD GIVES NOBODY A WIN, so a series of draws has to end on its own length rather
  // than run for ever looking for a target neither side can reach.
  const drawn = MP.seriesAfter(g({ seriesNo: 3, seriesWins: { a: 1, b: 1 }, over: { winner: null } }));
  check('a series that runs out of games ends, and a dead tie is a draw',
    drawn.done && drawn.winner === null);
  const lead = MP.seriesAfter(g({ seriesNo: 3, seriesWins: { a: 1, b: 0 }, over: { winner: null } }));
  check('and if it runs out with somebody ahead, they take it', lead.done && lead.winner === 'a');
  check('a single game is its own whole series', MP.seriesAfter(g({ series: 1, seriesNo: 1 })).done);

  check('a caption is trimmed, collapsed and clamped',
    MP.cleanCaption('  good   luck  ') === 'good luck'
    && MP.cleanCaption('x'.repeat(500)).length === MP.MAX_CAPTION
    && MP.cleanCaption(null) === '' && MP.cleanCaption(undefined) === '');

  // THE ONE THAT MATTERS MOST: every match document written before series existed must still
  // open. validateGame returning null is a REFUSAL TO OPEN THE MATCH, so a required new field
  // would have made every existing game in the database unplayable the day this shipped.
  const legacy = {
    v: 1, id: 'abc123', created: 1, updated: 2, oneShot: false,
    a: { code: 'AAAAA', name: 'Ana' }, b: { code: 'BBBBB', name: 'Bea' },
    turn: 'a', moves: null, over: null,
  };
  const val = MP.validateGame(legacy);
  check('a document written before series existed still validates', !!val);
  check('...and reads as a single game with no caption',
    !!val && val.series === 1 && val.seriesNo === 1 && val.caption === ''
    && val.seriesWins.a === 0 && val.seriesWins.b === 0 && val.seriesOf === 'abc123');
  const withSeries = MP.validateGame({ ...legacy, series: 5, seriesNo: 3, seriesWins: { a: 1, b: 1 },
    seriesOf: 'zzz999', caption: '  hi  there  ' });
  check('a series document round-trips its own fields',
    !!withSeries && withSeries.series === 5 && withSeries.seriesNo === 3
    && withSeries.seriesWins.a === 1 && withSeries.seriesOf === 'zzz999'
    && withSeries.caption === 'hi there');
  check('a nonsense series length falls back to a single game, it does not reject the match',
    (MP.validateGame({ ...legacy, series: 4 }) || {}).series === 1
    && (MP.validateGame({ ...legacy, seriesNo: 99, series: 3 }) || {}).seriesNo === 3);

  const ui2 = readFileSync(new URL('./hoops4/js/ui.js', import.meta.url), 'utf8');
  check('the terms are read from the MATCH, not from the launcher row',
    /armed\.terms = bits\.join/.test(ui2) && /armed\.caption = game\.caption/.test(ui2));
  // A series must NOT advance itself inside pushMove: the device that finishes a game may be
  // offline at that moment, and a silently stalled series has nobody to report it to. Check
  // pushMove's OWN BODY - the first draft of this split the file at pushMove and asserted
  // nextInSeries never appeared after it, which is just where the function is defined.
  const mpSrc = readFileSync(new URL('./hoops4/js/mp.js', import.meta.url), 'utf8');
  const pushBody = (mpSrc.split('export async function pushMove')[1] || '').split('\nexport ')[0];
  check('the next game of a series is started by a button, never automatically',
    /nextInSeries\(\{ \.\.\.mp\.game/.test(ui2) && pushBody.length > 200 && !/nextInSeries/.test(pushBody));
  const mpui2 = readFileSync(new URL('./hoops4/js/mp-ui.js', import.meta.url), 'utf8');
  check('a failed challenge keeps the form and what was typed in it',
    /e2\.textContent = failure\(res\.reason\)/.test(mpui2) && /return;\n      \}\n      state\.terms = null;/.test(mpui2));
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

// -----------------------------------------------------------------------------------------------
// QUICK CHAT INSIDE A MATCH (2026-09-22)
// -----------------------------------------------------------------------------------------------
// The chat field is OPTIONAL and is NOT part of the replay. validateGame returning null is a
// refusal to open the match, so neither a match written before chat existed nor a match with a
// mangled chat entry may ever be refused because of it.
{
  // A HAND-WRITTEN PRE-CHAT DOCUMENT, shaped like one `createGame` + two `pushMove`s wrote before
  // this change: series fields present (it post-dates the series work), NO `chat` key at all.
  const preChat = {
    v: 1, id: 'mf3k2p9x4q7r1t8w', created: 1758520000000, updated: 1758520900000, oneShot: false,
    series: 3, seriesNo: 1, seriesWins: { a: 0, b: 0 }, seriesOf: 'mf3k2p9x4q7r1t8w',
    caption: 'First to two',
    a: { code: 'ABCDE', name: 'Matt', emoji: '🏀' },
    b: { code: 'FGHJK', name: 'Anita', emoji: '🌟' },
    turn: 'a',
    moves: {
      '0000': { by: 'a', col: 3, shots: 2, at: 1758520100000 },
      '0001': { by: 'b', col: 4, shots: 1, at: 1758520900000 },
    },
  };
  const g = MP.validateGame(preChat);
  check('a document written before chat existed still validates', !!g);
  check('...and reads as a match with no chat', !!g && Array.isArray(g.chat) && g.chat.length === 0);
  const withChat = MP.validateGame({ ...preChat, chat: {
    k2: { by: 'b', t: 'p', v: 'nice', at: 1758520950000 },
    k1: { by: 'a', t: 'e', v: '🔥', at: 1758520920000 },
  } });
  const replayOf = (doc) => {
    const m = MP.replay(new Match({ oneShot: false }), doc);
    return JSON.stringify({ cells: m.cells(), turn: m.turn, shots: m.shots, over: m.over });
  };
  check('chat changes nothing about the replay',
    !!withChat && replayOf(g) === replayOf(withChat) && withChat.turn === g.turn
    && withChat.moves.length === g.moves.length);
  check('chat comes back oldest first, whatever order the keys arrived in',
    !!withChat && withChat.chat.map((c) => c.v).join(',') === '🔥,nice');

  // GARBAGE CHAT: every bad entry is DROPPED and the match still opens.
  const junk = MP.validateGame({ ...preChat, chat: {
    ok1: { by: 'a', t: 'c', v: '  good   luck  ', at: 5 },
    nobody: { by: 'x', t: 'c', v: 'who?', at: 6 },
    badType: { by: 'b', t: 'z', v: 'hmm', at: 7 },
    empty: { by: 'b', t: 'c', v: '   ', at: 8 },
    notObj: 'hello',
    nullish: null,
    long: { by: 'b', t: 'c', v: 'x'.repeat(500), at: 9 },
  } });
  check('a match with garbage chat entries still validates', !!junk);
  check('...with the bad entries dropped and the good ones cleaned',
    !!junk && junk.chat.length === 2 && junk.chat[0].v === 'good luck'
    && junk.chat[1].v.length === MP.CHAT_MAXLEN);
  check('a chat field that is not even an object is ignored, not fatal',
    (MP.validateGame({ ...preChat, chat: 'lol' }) || {}).chat.length === 0
    && (MP.validateGame({ ...preChat, chat: [1, 2, 3] }) || { chat: [9] }).chat.length === 0);

  // THE PURE HELPERS
  check('cleanChat trims, collapses and clamps',
    MP.cleanChat('  hi   there ') === 'hi there' && MP.cleanChat('y'.repeat(99)).length === MP.CHAT_MAXLEN
    && MP.cleanChat(null) === '' && MP.cleanChat(undefined) === '');
  {
    const many = {};
    for (let i = 0; i < MP.MAX_CHAT + 15; i++) many['k' + i] = { by: i % 2 ? 'a' : 'b', t: 'e', v: '👍', at: 1000 + i };
    const list = MP.chatFrom(many);
    check('only the newest MAX_CHAT lines are kept, oldest of those first',
      list.length === MP.MAX_CHAT && list[0].at === 1015 && list[list.length - 1].at === 1000 + MP.MAX_CHAT + 14);
  }
  check('equal timestamps fall back to key order, so both phones agree',
    MP.chatFrom({ b: { by: 'a', t: 'e', v: '2', at: 1 }, a: { by: 'b', t: 'e', v: '1', at: 1 } })
      .map((c) => c.v).join('') === '12');
  {
    const list = MP.chatFrom({
      x: { by: 'a', t: 'e', v: '1', at: 10 }, y: { by: 'b', t: 'e', v: '2', at: 20 },
      z: { by: 'b', t: 'e', v: '3', at: 30 },
    });
    check('unseenChat is only the OTHER side\'s lines newer than the mark',
      MP.unseenChat(list, 'a', 20).map((c) => c.v).join('') === '3'
      && MP.unseenChat(list, 'b', 0).map((c) => c.v).join('') === '1'
      && MP.unseenChat(null, 'a', 0).length === 0);
  }

  // STRUCTURAL: the chat write is additive, verified, and never touches the move log or turn.
  const src = readFileSync(new URL('./hoops4/js/mp.js', import.meta.url), 'utf8');
  const sendBody = (src.split('export async function sendChat')[1] || '').split('\nexport ')[0];
  check('a chat line is written at its own new key under chat/, and verified by re-read',
    /hoops\/games\/\$\{id\}\/chat\/\$\{key\}/.test(sendBody) && /chat VERIFY FAILED/.test(sendBody)
    && /writesAllowed\('sendChat'\)/.test(sendBody));
  check('a chat line never writes moves, turn, updated, over or an index row',
    sendBody.length > 200 && !/moves|turn:|updated|over:|writeRows|api\.update/.test(sendBody));
  // NOTHING IN mp.js DELETES DATA (THE LAW). No remove(), no write of null over a path.
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('mp.js contains no delete or remove of data',
    !/\bremove\s*\(/.test(code) && !/\.delete\s*\(/.test(code) && !/removeItem/.test(code)
    && !/api\.(set|update)\([^;]*,\s*null\s*\)/.test(code));

  const ui = readFileSync(new URL('./hoops4/js/ui.js', import.meta.url), 'utf8');
  check('live chat rides room.reactions, never the move log',
    /this\._chat\.onReactions\(room\.reactions/.test(ui) && /sendReaction\(mp\.code, mp\.role, payload\)/.test(ui)
    && !/appendMove\([^)]*payload/.test(ui));
  check('the chat is torn down with the engine', /teardownEngine\(\) \{\n    this\._unmountChat\(\);/.test(ui));
  check('a reviewed (finished) match can neither be shot in nor recorded again',
    /if \(this\.mp\.review\) return false;/.test(ui) && /if \(review\) this\.recorded = true;/.test(ui));
}

// -----------------------------------------------------------------------------------------------
// CHALLENGE HISTORY WITH RECORDS (2026-09-22)
// -----------------------------------------------------------------------------------------------
{
  const C = 'MNPQR';
  const row = (id, o = {}) => ({ id, with: o.with || B, name: o.name || 'Anita', emoji: '🌟',
    updated: o.updated == null ? 100 : o.updated, over: o.over !== false, yourTurn: false,
    series: o.series || 1, seriesNo: o.seriesNo || 1,
    ...(o.result !== undefined ? { result: o.result } : {}), ...(o.why ? { why: o.why } : {}),
    ...(o.game ? { game: o.game } : {}) });
  const rows = [
    row('w1', { result: 'won', updated: 10 }),
    row('w2', { result: 'won', updated: 50 }),
    row('l1', { result: 'lost', updated: 30 }),
    row('d1', { result: 'draw', updated: 20 }),
    row('r1', { result: 'lost', why: 'resign', updated: 40 }),
    row('r2', { result: 'won', why: 'resign', updated: 45, with: C, name: 'Bea' }),
    row('live', { over: false, updated: 999 }),
  ];
  const { opponents, finished } = MP.recordsFrom(rows, A);
  const anita = opponents.find((o) => o.code === B);
  check('wins, losses and draws are counted from YOUR side',
    anita && anita.won === 2 && anita.lost === 2 && anita.draw === 1 && anita.played === 5,
    JSON.stringify(anita));
  check('an unfinished match is not in the history', !finished.some((r) => r.id === 'live'));
  check('finished matches come newest first',
    finished.map((r) => r.id).join(',') === 'w2,r2,r1,l1,d1,w1', finished.map((r) => r.id).join(','));
  check('a resignation is a loss for who resigned and says so',
    finished.find((r) => r.id === 'r1').resigned === 'me' && finished.find((r) => r.id === 'r2').resigned === 'them');
  check('opponents are sorted by games played', opponents[0].code === B && opponents[1].code === C);

  // GROUPED BY CODE, NOT NAME: a renamed person is still one record, two people who share a name
  // are still two.
  const renamed = MP.recordsFrom([
    row('a', { result: 'won', name: 'Anita', updated: 1 }),
    row('b', { result: 'lost', name: 'Nita', updated: 2 }),
    row('c', { result: 'won', name: 'Anita', with: C, updated: 3 }),
  ], A).opponents;
  check('records group by the opponent\'s CODE, not their name',
    renamed.length === 2 && renamed.find((o) => o.code === B).played === 2);
  check('...labelled by the name on their most recent match',
    renamed.find((o) => o.code === B).name === 'Nita');

  // OLD ROWS: no `result` on the row. With the match read, the result is worked out from it;
  // without it, the row is counted as played and in NO column rather than guessed into one.
  const oldGame = MP.validateGame({ ...doc({ winner: 'b', why: 'four', at: 5 }) });
  const oldRows = MP.recordsFrom([
    row('o1', { game: oldGame }),                                       // A is side a, b won
    row('o2', {}),                                                      // match unreadable
    row('o3', { game: MP.validateGame({ ...doc({ winner: null, why: 'full', at: 6 }) }) }),
  ], A);
  const o = oldRows.opponents[0];
  check('an old row with no result takes it from its match',
    oldRows.finished.find((r) => r.id === 'o1').result === 'lost' && o.lost === 1 && o.draw === 1);
  check('an old row whose match cannot be read is counted, but in no column',
    o.unknown === 1 && o.played === 3 && oldRows.finished.find((r) => r.id === 'o2').result === null);
  check('the same old match reads as a WIN for the other side',
    MP.recordsFrom([row('o1', { with: A, game: oldGame })], B).opponents[0].won === 1);

  check('rows missing fields cannot throw or count',
    MP.recordsFrom([null, {}, { over: true }, { over: true, with: 'nope' }, 'x'], A).finished.length === 0
    && MP.recordsFrom(null, A).opponents.length === 0
    && MP.recordsFrom([row('self', { with: A, result: 'won' })], A).finished.length === 0);
  check('a junk result on a row is treated as unknown, not as a win',
    MP.recordsFrom([row('j', { result: 'WINNER' })], A).opponents[0].unknown === 1);

  check('resultOf reads a match from each side',
    MP.resultOf(oldGame, 'a') === 'lost' && MP.resultOf(oldGame, 'b') === 'won'
    && MP.resultOf(MP.validateGame(doc()), 'a') === null && MP.resultOf(oldGame, 'z') === null);

  // New finished rows carry the result, optionally; an unfinished row writes no result field.
  const src = readFileSync(new URL('./hoops4/js/mp.js', import.meta.url), 'utf8');
  check('a finished index row carries its result; an unfinished one writes no such field',
    /\.\.\.\(game\.over \? \{ result: resultOf\(game, side\)/.test(src));
  const mpui = readFileSync(new URL('./hoops4/js/mp-ui.js', import.meta.url), 'utf8');
  check('the history opens a finished match READ ONLY',
    /openGame\(b\.dataset\.past, \{ review: true \}\)/.test(mpui));
}

// THE CHALLENGE THAT WAS NOT A CHALLENGE (2026-09-23). Matt sent the King of Games a challenge,
// went back to the hub, and the popup said the King had challenged HIM. Any match id this device
// had never seen counted as "a challenge", including its own. Every write this device makes now
// stamps the seen map, so only the other person's writes can raise the bubble.
{
  const A = await import('./hoops4/js/alert.js');
  const MPsrc = readFileSync(new URL('./hoops4/js/mp.js', import.meta.url), 'utf8');
  const body = (name) => { const i = MPsrc.indexOf(`export async function ${name}(`); return i < 0 ? '' : MPsrc.slice(i, MPsrc.indexOf('\nexport ', i + 10)); };
  check('createGame marks the match it just made as seen on this device', /markSeen\(id, game\.updated\)/.test(body('createGame')));
  check('pushMove marks our own move as seen', /markSeen\(id, back/.test(body('pushMove')));
  check('resignGame marks our own resignation as seen', /markSeen\(id, back/.test(body('resignGame')));
  // A match I created (stamped at its `updated`) raises nothing; when THEY move it, it is a turn.
  const mine = { id: 'Zq1', with: 'KING1', name: 'King of Games', emoji: 'x', updated: 500, yourTurn: true, over: false };
  check('a challenge I SENT never reads as one sent to me', A.decideAlert([mine], { Zq1: 500 }) === null);
  const back = A.decideAlert([{ ...mine, updated: 900 }], { Zq1: 500 });
  check('when they play it back, it is "your turn", not "a challenge"', !!back && back.kind === 'turn');
  check('the launcher can watch the list live', typeof A.watch === 'function');
  const hub = readFileSync(new URL('./js/hub.js', import.meta.url), 'utf8');
  check('the hub subscribes to that watch once per game, not per paint',
    /_watchGameAlerts\(\)/.test(hub) && /this\._alertWatches\[g\.id\]/.test(hub));
}

// QUIT, AND COUNTING A FINISHED MATCH ON BOTH PHONES (2026-09-23). Only the phone that played the
// last move used to record a result, and a resignation would have scored the winner a loss.
{
  const MPm = await import('./hoops4/js/mp.js');
  const S = MPm.LEDGER_SINCE;
  const rows = [
    { id: 'A1', over: true, result: 'won', updated: S + 10 },
    { id: 'A2', over: true, result: 'lost', updated: S + 20 },
    { id: 'A3', over: true, result: null, updated: S + 30 },        // an old row: never guessed
    { id: 'A4', over: true, result: 'won', updated: S - 1000 },     // finished before the ledger
    { id: 'A5', over: false, result: null, updated: S + 40 },       // still being played
  ];
  const todo = MPm.rowsToCount(rows, new Set()).map((r) => r.id).join(',');
  check('only finished rows with a result, from after the ledger started, are counted', todo === 'A1,A2', todo);
  check('a row already in the ledger is never counted again', MPm.rowsToCount(rows, new Set(['A1', 'A2'])).length === 0);
  const ui = readFileSync(new URL('./hoops4/js/ui.js', import.meta.url), 'utf8');
  check('finish() counts an async match through the ledger, from the STORED winner',
    /markCounted\(this\.mp\.id\)/.test(ui) && /g\.over\.winner === this\.mp\.side/.test(ui));
  const mpui = readFileSync(new URL('./hoops4/js/mp-ui.js', import.meta.url), 'utf8');
  check('every active game row has a Quit that resigns (and asks first)',
    /data-quit=/.test(mpui) && /MP\.resignGame\(id\)/.test(mpui) && /mpQuitQ/.test(mpui));
  check('the multiplayer screen counts finished matches when it loads', /MP\.recordFinished\(rows\)/.test(mpui));
  check('the pause sheet can quit a turn-by-turn match', /data-role="quit"/.test(ui) && /resignGame\(this\.mp\.id\)/.test(ui));
}

// LIVE TURNS, NAMES ON THE BUBBLE, THE CARD ONCE (2026-09-23).
{
  const A = await import('./hoops4/js/alert.js');
  const MPm = await import('./hoops4/js/mp.js');
  const r = (id, name, upd, yours) => ({ id, name, with: 'X' + id, emoji: 'e', updated: upd, yourTurn: yours, over: false });
  const al = A.decideAlert([r('Q1', 'HDJ, Inc.', 900, true), r('Q2', 'test1', 800, true), r('Q3', 'Anita', 950, false)],
    { Q1: 100, Q2: 100, Q3: 100 });
  check('"Your turn" names everybody whose turn it is (and nobody whose it is not)',
    !!al && al.kind === 'turn' && al.names.join('|') === 'HDJ, Inc.|test1', al && al.names.join('|'));
  const hub = readFileSync(new URL('./js/hub.js', import.meta.url), 'utf8');
  check('the hub writes those names into the bubble', /_turnLine\(a\.names\)/.test(hub) && /hub_alert_your_turn_vs/.test(hub));
  check('an open match can be watched live', typeof MPm.watchGame === 'function');
  const ui = readFileSync(new URL('./hoops4/js/ui.js', import.meta.url), 'utf8');
  check('the open match subscribes, applies only NEW entries, and skips its own',
    /MP\.watchGame\(id, \(g\) => this\._onAsyncGame\(g\)\)/.test(ui) && /g\.moves\.slice\(mp\.applied\)/.test(ui)
    && /e\.by === mp\.side\) continue/.test(ui));
  check('our own move is counted as applied BEFORE it is sent (so the watch never re-plays it)',
    /mp\.applied\+\+;[^\n]*\n\s*const r = await mp\.MP\.pushMove/.test(ui));
  check('leaving the match stops the watch', /this\._gameStop\(\)/.test(ui));
  check('the challenge card plays once per match, then goes straight to the board',
    /gamehub\.hoops4\.cerShown\.v1/.test(ui) && /shown\.includes\(armed\.id\)/.test(ui));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
