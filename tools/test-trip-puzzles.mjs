// tools/test-trip-puzzles.mjs - the puzzle and word games' own trip wires (js/trip-wires/<game>.js, 2026-11-25): Arrow
// Maze, Gridlock, Word Ladder, Word Weaver, Sudoku, Murdoku, Minesweeper, Nuts & Bolts, Contexto, Spelling Bee, Boggle.
// Pure, no network.
//   node tools/test-trip-puzzles.mjs                                        a passing and a failing case for every rule
//   node tools/test-trip-puzzles.mjs --db <playLog.json> [--input <playInput.json>]   replay every real result: every hit
import fs from 'node:fs';
import { runTripWires, TRIP_GAMES, TRIP_PROVEN } from '../js/trip-wires/index.js';
import { createGame, generate } from '../minesweeper/js/engine.js';
import { NutsBoltsGame } from '../nuts-bolts/js/game.js';
import { replayBolts } from '../js/trip-wires/nutsbolts.js';

const GAMES = ['wayout', 'gridlock', 'wordladder', 'wordweaver', 'sudoku', 'murdoku', 'minesweeper', 'nutsbolts', 'contexto', 'spellingbee', 'boggle'];
let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };
const J = JSON.stringify;
const hits = (e, n = null) => runTripWires(e, n).map((h) => h.rule);
const has = (e, rule, n = null) => hits(e, n).includes(rule);
/** A touch log with `k` real presses (and `fake` made-up ones). */
const touches = (k, fake = 0) => J({ v: 1, t0: 1, w: 400, h: 800, pt: 'touch', ev: [...Array.from({ length: k }, () => '300d10,10 80u10,10'), ...Array.from({ length: fake }, () => '5!d1,1')].join(' ') });
const touchesCut = (k) => J({ v: 1, t0: 1, w: 400, h: 800, pt: 'touch', cut: 4, ev: Array.from({ length: k }, () => '300d10,10').join(' ') });

// Contract: every game has at least 3 rules, a mix of proven and suspicious, unique ids, text and a check.
const ids = new Set();
for (const g of GAMES) {
  const rules = TRIP_GAMES[g];
  ok(`${g}: 3 or more rules`, Array.isArray(rules) && rules.length >= 3);
  ok(`${g}: proven AND suspicious rules`, rules.some((r) => r.proven === true) && rules.some((r) => r.proven === false));
  for (const r of rules) {
    ok(`${r.id}: id, text, check`, r.id.startsWith(g + '-') && typeof r.text === 'string' && r.text.length > 5 && typeof r.check === 'function' && !ids.has(r.id));
    ids.add(r.id);
    // A rule returns null when its data is missing (an older play).
    let bare = 'threw';
    try { bare = r.check({ f: 'recordX', g }, { a: null, x: null, d: null, i: null, n: null, score: null }); } catch { /* threw */ }
    ok(`${r.id}: no data, no hit`, bare === null);
  }
}

// --- Arrow Maze
const wo = (taps, extra = {}) => ({ f: 'recordWayOut', g: 'wayout', a: '["easy",{}]', x: J({ arrows: 22, hints: 0, taps, ...extra }) });
const human = Array.from({ length: 22 }, (_, k) => `${k}g@${k * 400 + ((k * 137) % 5) * 120}`);
ok('wayout: 22 taps, 30 touches passes', !hits(wo(human, { pre: 0 }), touches(30)).length);
ok('wayout: 22 taps, 10 touches is PROVEN', has(wo(human), 'wayout-taps-without-presses', touches(10)));
ok('wayout: a cut touch log is not judged', !has(wo(human), 'wayout-taps-without-presses', touchesCut(3)));
ok('wayout: a level with hints is not judged', !has(wo(human, { hints: 1 }), 'wayout-taps-without-presses', touches(3)));
ok('wayout: 19 tapped + 3 already gone passes', !has(wo(human.slice(0, 19), { pre: 3 }), 'wayout-cleared-without-taps'));
ok('wayout: 19 tapped + 0 gone is PROVEN', has(wo(human.slice(0, 19), { pre: 0 }), 'wayout-cleared-without-taps'));
ok('wayout: an old log with no pre is not judged', !has(wo(human.slice(0, 19)), 'wayout-cleared-without-taps'));
ok('wayout: even taps are suspicious', has(wo(Array.from({ length: 22 }, (_, k) => `${k}g@${k * 300}`)), 'wayout-even-rhythm'));
ok('wayout: uneven taps pass', !has(wo(human), 'wayout-even-rhythm'));

// --- Gridlock
const gl = (seq, extra = {}) => ({ f: 'recordGridlock', g: 'gridlock', a: '["easy",{}]', d: J({ moves: extra.moves ?? 3, fewest: 3 }), x: J({ seq, final: extra.final || [[1, 0, 1], [2, 0, 1], [3, 0, 1]], res: extra.res || 0, tu: 'ms' }) });
const glSeq = ['1:0>1@900', '2:0>1@2100', '3:0>1@3500'];
ok('gridlock: 3 slides, 5 touches passes', !hits(gl(glSeq), touches(5)).length);
ok('gridlock: 3 slides, 1 touch is PROVEN', has(gl(glSeq), 'gridlock-moves-without-presses', touches(1)));
ok('gridlock: only slides after the last hint count', !has(gl(['1:0>1@1', '2:0>1@2', 'h3>1@3', '3:0>1@9']), 'gridlock-moves-without-presses', touches(1)));
ok('gridlock: 3 moves from 1 slide is PROVEN', has(gl(['1:0>1@900']), 'gridlock-moves-not-made'));
ok('gridlock: a resumed level is not judged that way', !has(gl(['1:0>1@900'], { res: 1 }), 'gridlock-moves-not-made'));
ok('gridlock: a solve in 0 moves is PROVEN', has(gl([], { moves: 0, final: [] }), 'gridlock-solved-without-moving'));
const fast = Array.from({ length: 12 }, (_, k) => `${k}:0>1@${k * 100}`);
ok('gridlock: slides 100 ms apart are suspicious', has(gl(fast, { moves: 12, final: [] }), 'gridlock-machine-pace'));
ok('gridlock: slides a second apart pass', !has(gl(Array.from({ length: 12 }, (_, k) => `${k}:0>1@${k * 1000}`), { moves: 12, final: [] }), 'gridlock-machine-pace'));

// --- Word Ladder
const wl = (seq, extra = {}) => ({ f: 'recordWordLadder', g: 'wordladder', a: '[1,{}]', d: J({ moves: 3, par: 3 }),
  x: J({ start: 'ASK', target: 'AYE', chain: extra.chain || ['ASK', 'ARK', 'ARE', 'AYE'], moves: extra.moves ?? 3, wall: 30000, cut: 0, seq }) });
const wlSeq = ['p1@2000', 'k:R@3500', 'w:ARK@3500', 'p2@6000', 'k:E@8000', 'w:ARE@8000', 'p1@11000', 'k:Y@13000', 'w:AYE@13000'];
ok('word ladder: a real ladder passes', !hits(wl(wlSeq), touches(10)).length);
ok('word ladder: 6 keys and picks, 2 touches is PROVEN', has(wl(wlSeq), 'wordladder-keys-without-presses', touches(2)));
ok('word ladder: only lines after the last resume count', !has(wl(['p1@1', 'k:R@2', 'w:ARK@2', 'B:500@9', 'p2@10', 'k:E@11', 'w:ARE@11']), 'wordladder-keys-without-presses', touches(2)));
ok('word ladder: a word with no key is PROVEN', has(wl(['w:ARK@3500', 'k:E@8000', 'w:ARE@8000']), 'wordladder-word-without-key'));
ok('word ladder: an old log (no wall) is not judged', !has({ ...wl(['w:ARK@3']), x: J({ seq: ['w:ARK@3'] }) }, 'wordladder-word-without-key'));
ok('word ladder: a broken chain is PROVEN', has(wl(wlSeq, { chain: ['ASK', 'ARE', 'AYE'] }), 'wordladder-chain-broken'));
ok('word ladder: a chain not at the target is PROVEN', has(wl(wlSeq, { chain: ['ASK', 'ARK', 'ARE'] }), 'wordladder-chain-broken'));
ok('word ladder: fewer moves than steps is PROVEN', has(wl(wlSeq, { moves: 2 }), 'wordladder-chain-broken'));
const wlFast = Array.from({ length: 8 }, (_, k) => [`p0@${k * 200}`, `k:A@${k * 200 + 100}`]).flat();
ok('word ladder: keys 200 ms apart are suspicious', has(wl(wlFast), 'wordladder-machine-typing'));

// --- Word Weaver
const ww = (tried, extra = {}) => ({ f: 'recordWordWeaver', g: 'wordweaver', a: '[5,{}]', x: J({ found: extra.found || ['ASH', 'HAS', 'CASH', 'CHAOS', 'OHS'], hints: 0, free: 0, pre: extra.pre ?? 0, order: ['CHAOS', 'CASH', 'ASH', 'HAS', 'OHS'], tu: 'ms', tried }) });
const wwT = ['ASH:g:2000', 'SAC:b:4500', 'HAS:g:6000', 'CASH:g:9800', 'CHAOS:g:15000', 'OHS:g:19000'];
ok('word weaver: a real level passes', !hits(ww(wwT), touches(8)).length);
ok('word weaver: 6 swipes, 3 touches is PROVEN', has(ww(wwT), 'wordweaver-words-without-presses', touches(3)));
ok('word weaver: only swipes after the last hint count', !has(ww(['ASH:g:1', 'HAS:g:2', ':h:3', 'CASH:g:5']), 'wordweaver-words-without-presses', touches(1)));
ok('word weaver: covered words need no swipe', !has(ww([...wwT.slice(0, 4), 'CHAOS:c:9800', 'OHS:g:19000']), 'wordweaver-words-without-presses', touches(5)));
ok('word weaver: a found word never swiped is PROVEN', has(ww(wwT.slice(0, 5)), 'wordweaver-found-without-trying'));
ok('word weaver: a resumed level is not judged that way', !has(ww(wwT.slice(0, 5), { pre: 2 }), 'wordweaver-found-without-trying'));
const wwFast = ['ASH', 'HAS', 'CASH', 'CHAOS', 'OHS'].map((w, k) => `${w}:g:${k * 400}`);
ok('word weaver: 5 right words 400 ms apart are suspicious', has(ww(wwFast), 'wordweaver-flawless-fast'));
ok('word weaver: one miss among them passes that rule', !has(ww([...wwFast, 'SOC:b:2100']), 'wordweaver-flawless-fast'));
ok('word weaver: words in the stored order are suspicious', has(ww(['CHAOS', 'CASH', 'ASH', 'HAS', 'OHS'].map((w, k) => `${w}:g:${k * 3000}`)), 'wordweaver-level-order'));
ok('word weaver: words in their own order pass', !has(ww(wwT), 'wordweaver-level-order'));

// --- Sudoku (a real generated-style grid: givens with 30 blanks)
const SOL = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const blanks = Array.from({ length: 30 }, (_, k) => (k * 7) % 81).filter((v, k, a) => a.indexOf(v) === k);
const givens = SOL.split('').map((c, i) => (blanks.includes(i) ? '0' : c)).join('');
const order = blanks.slice().sort((p, q) => ((p * 31) % 17) - ((q * 31) % 17));
const sdEv = order.map((i, k) => ['d', i, Number(SOL[i]), (k + 1) * 9000]);
const sd = (ev, extra = {}) => ({ f: 'recordSudoku', g: 'sudoku', a: J([extra.tier || 'easy', {}]), x: J({ givens, final: SOL, ev, res: extra.res || 0, mistakes: 0, hints: 0, tu: 'ms', cut: 0 }) });
ok('sudoku: a real solve passes', !hits(sd(sdEv), touches(70)).length);
ok('sudoku: more entries than touches is PROVEN', has(sd(sdEv), 'sudoku-entries-without-presses', touches(10)));
ok('sudoku: a square never filled is PROVEN', has(sd(sdEv.slice(1)), 'sudoku-filled-without-entry'));
ok('sudoku: a resumed puzzle is not judged that way', !has(sd(sdEv.slice(1), { res: 1 }), 'sudoku-filled-without-entry'));
const rowOrder = blanks.slice().sort((p, q) => p - q).map((i, k) => ['d', i, Number(SOL[i]), (k + 1) * 9000]);
ok('sudoku: digits in reading order are suspicious', has(sd(rowOrder), 'sudoku-reading-order'));
ok('sudoku: digits in a logical order pass', !has(sd(sdEv), 'sudoku-reading-order'));
ok('sudoku: a flawless hard solve at 1 s a square is suspicious', has(sd(sdEv.map((q, k) => ['d', q[1], q[2], (k + 1) * 1000]), { tier: 'hard' }), 'sudoku-flawless-fast'));
ok('sudoku: the same at 9 s a square passes', !has(sd(sdEv, { tier: 'hard' }), 'sudoku-flawless-fast'));

// --- Murdoku
const mu = (ev, extra = {}) => ({ f: 'recordMurdoku', g: 'murdoku', a: '["medium",{"hints":0}]', x: J({ n: extra.n || 5, pos: extra.pos || [19, 2, 11, 20, 8], ev, res: extra.res || 0, hints: 0, wrongFull: 0, tu: 'ms', cut: 0 }) });
const muEv = [['p', 3, 20, 8000], ['p', 2, 11, 25000], ['p', 4, 8, 35000], ['p', 0, 19, 38000], ['p', 1, 2, 40000]];
ok('murdoku: a real solve passes', !hits(mu(muEv), touches(12)).length);
ok('murdoku: more placements than touches is PROVEN', has(mu(muEv), 'murdoku-moves-without-presses', touches(3)));
ok('murdoku: a person never placed is PROVEN', has(mu(muEv.slice(1)), 'murdoku-placed-without-move'));
ok('murdoku: a resumed case is not judged that way', !has(mu(muEv.slice(1), { res: 1 }), 'murdoku-placed-without-move'));
const mu6 = [0, 7, 14, 21, 28, 35].map((s, q) => ['p', q, s, (q + 1) * 4000]);
ok('murdoku: 6 people straight to the answer at 4 s each is suspicious', has(mu(mu6, { n: 6, pos: [0, 7, 14, 21, 28, 35] }), 'murdoku-straight-to-answer'));
ok('murdoku: Easy 5x5 straight to the answer passes', !has(mu(muEv), 'murdoku-straight-to-answer'));

// --- Minesweeper (a real board from the game's own generator, solved by opening every safe square)
const g0 = createGame('hard');
generate(g0, 5, 5, ((s) => () => ((s = (s * 16807) % 2147483647) / 2147483647))(7));
const mines = g0.mine.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
const safe = g0.mine.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
const msx = (acts, extra = {}) => ({ f: 'recordMinesweeper', g: 'minesweeper', m: 'marks=1|ng=0@hard', a: J(['hard', extra.won ?? true, { flagsRight: extra.fr ?? 0, mines: 38 }]), x: J({ w: 12, h: 16, mines, acts, resumed: 0 }) });
const digs = safe.map((i, k) => `d${i}:${k * 15}`);
ok('minesweeper: a real clear passes', !hits(msx(digs), touches(digs.length + 5)).length);
ok('minesweeper: more taps than touches is PROVEN', has(msx(digs), 'minesweeper-taps-without-presses', touches(20)));
ok('minesweeper: a win the taps do not clear is PROVEN', has(msx(digs.slice(0, digs.length - 1).filter((_, k) => k % 2)), 'minesweeper-win-not-from-taps'));
ok('minesweeper: a loss is never judged that way', !has(msx(digs.slice(0, 5), { won: false }), 'minesweeper-win-not-from-taps'));
const flagsFast = [...mines.map((i, k) => `f${i}:${k * 3}`), ...safe.map((i, k) => `d${i}:${200 + k * 3}`)];
ok('minesweeper: every flag right at 0.3 s a tap is suspicious', has(msx(flagsFast, { fr: 38 }), 'minesweeper-flawless-fast'));
ok('minesweeper: the same with a wrong flag passes that rule', !has(msx([`f${safe[0]}:0`, ...flagsFast], { fr: 38 }), 'minesweeper-flawless-fast'));

// --- Nuts & Bolts: a two-bolt puzzle solved by hand, and one the moves cannot solve
const nb = (seq, extra = {}) => ({ f: 'recordNutsBolts', g: 'nutsbolts', a: J([1, extra.rec ?? seq.filter((q) => />/.test(q)).length, 'easy']),
  x: J({ tier: 'easy', level: 1, start: ['red.red.red.blue', 'blue.blue.blue.red', ''], hid: ['0000', '0000', ''], seq, res: 0, tu: 'ms', cut: 0 }) });
const nbSeq = ['0>2@1500', '1>0@3200', '2>1@5000'];
ok('nuts and bolts: a real solve passes', !hits(nb(nbSeq), touches(8)).length);
ok('nuts and bolts: 3 moves from 5 taps is PROVEN', has(nb(nbSeq), 'nutsbolts-moves-without-taps', touches(5)));
ok('nuts and bolts: moves that do not solve are PROVEN', has(nb(['0>2@1500', '2>0@3000']), 'nutsbolts-moves-do-not-solve'));
ok('nuts and bolts: an illegal move is PROVEN', has(nb(['0>1@1500', '1>0@3200', '2>1@5000']), 'nutsbolts-moves-do-not-solve'));
ok('nuts and bolts: more moves recorded than made is PROVEN', has(nb(nbSeq, { rec: 9 }), 'nutsbolts-moves-not-logged'));
// The replay is the game's own: real generated levels (hidden nuts included), played by random legal taps through
// select(), undo and restart as the screen does, logged by the game, replay to the same bolts and never 'illegal'.
{
  let same = 0, legal = 0, runs = 0;
  for (const [tier, lvl] of [['easy', 3], ['medium', 9], ['hard', 14], ['extraHard', 6], ['extraHard', 30]]) {
    for (let seed = 1; seed <= 4; seed++) {
      const game = new NutsBoltsGame(tier, lvl);
      let r = seed * 9301;
      const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 160 && !game.isWon(); k++) {
        const q = rnd();
        if (q < 0.04) { game.undo(); continue; }
        if (q < 0.05) { game.restart(); continue; }
        game.select(Math.floor(rnd() * game.boltCount));
      }
      const x = JSON.parse(J(game.privateLog()));
      const out = {};
      const res = replayBolts(x, out);
      runs++;
      if (res !== 'illegal') legal++;
      if (out.game && J(out.game.stacks.map((st) => st.map((n) => [n.color, n.hidden]))) === J(game.stacks.map((st) => st.map((n) => [n.color, n.hidden])))) same++;
    }
  }
  ok(`nuts and bolts: ${runs} random real plays replay legal (${legal}) to the same bolts (${same})`, legal === runs && same === runs);
}
ok('nuts and bolts: moves 100 ms apart are suspicious', has(nb(Array.from({ length: 12 }, (_, k) => `0>2@${k * 100}`)), 'nutsbolts-machine-pace'));

// --- Contexto
const ct = (sess, extra = {}) => ({ f: 'recordContexto', g: 'contexto', a: J(['en', extra.won ?? true, { guesses: extra.guesses ?? sess.length, hints: 0 }]), x: J({ sess: { k: 'en-60', t0: 1, ev: sess, cut: 0 } }) });
const ctS = Array.from({ length: 12 }, (_, k) => ['g', 'w' + k, k === 11 ? 1 : 500 - k, k * 3500]);
ok('contexto: a real solve passes', !hits(ct(ctS), touches(40)).length);
ok('contexto: more guesses than presses is PROVEN', has(ct(ctS), 'contexto-guesses-without-presses', touches(4)));
ok('contexto: the answer 300 ms after a guess is suspicious', has(ct([...ctS.slice(0, 10), ['g', 'x', 900, 40000], ['g', 'y', 1, 40300]]), 'contexto-answer-typed-at-once'));
ok('contexto: a win in 2 guesses is suspicious', has(ct(ctS.slice(0, 2), { guesses: 2 }), 'contexto-lucky-solve'));
ok('contexto: a win in 30 guesses passes that rule', !has(ct(ctS, { guesses: 30 }), 'contexto-lucky-solve'));
ok('contexto: guesses 300 ms apart are suspicious', has(ct(ctS.map((q, k) => [q[0], q[1], q[2], k * 300])), 'contexto-machine-pace'));

// --- Spelling Bee
const sbS = ['cinta', 'citan', 'xxx', 'crian', 'inca', 'iran', 'banca', 'rian', 'brinca', 'tranca', 'abanica', 'inicia', 'criban', 'citaban', 'brincar', 'cribaban']
  .map((w, k) => [w, w === 'xxx' ? 'bad' : 'ok', k * 6000]);
const sb = (sess, words) => ({ f: 'recordResult', g: 'spellingbee', a: '["spellingbee","daily",true]', x: J({ words: words || sess.map((q) => q[0]), sess: { k: 'es:n:abcirt', t0: 1, ev: sess, cut: 0 } }) });
ok('spelling bee: a real Genius passes', !hits(sb(sbS), touches(120)).length);
ok('spelling bee: more words than presses is PROVEN', has(sb(sbS), 'spellingbee-words-without-presses', touches(8)));
ok('spelling bee: fewer presses than letters is suspicious', has(sb(sbS), 'spellingbee-letters-without-presses', touches(40)));
const az = ['abanica', 'banca', 'brinca', 'brincar', 'cinta', 'citan', 'crian', 'criban', 'cribaban', 'inca', 'inicia', 'iran', 'rian', 'tranca', 'trincar', 'zinc'];
ok('spelling bee: A to Z order is suspicious', has(sb(sbS, az), 'spellingbee-alphabetical'));
ok('spelling bee: found order passes', !has(sb(sbS), 'spellingbee-alphabetical'));
ok('spelling bee: 16 words, no miss, 1 s apart is suspicious', has(sb(az.map((w, k) => [w, 'ok', k * 1000])), 'spellingbee-flawless-fast'));

// --- Boggle
const bgEv = ['VETO', 'XQZ', 'TIN', 'HIS', 'NIT'].map((w, k) => [w, w === 'XQZ' ? 'i' : 'v', k * 2500]);
const bg = (ev, extra = {}) => ({ f: 'recordBoggle', g: 'boggle', a: '["beginner",false,{}]', x: J({ end: extra.end || 'over', ev, res: extra.res || 0, found: extra.found || ev.filter((q) => q[1] === 'v').map((q) => [q[0], 1]) }) });
ok('boggle: a real round passes', !hits(bg(bgEv), touches(9)).length);
ok('boggle: more words than touches is PROVEN', has(bg(bgEv), 'boggle-words-without-presses', touches(2)));
ok('boggle: a live room leave is not judged against touches', !has(bg(bgEv, { end: 'leave' }), 'boggle-words-without-presses', touches(2)));
ok('boggle: a word counted, never submitted is PROVEN', has(bg(bgEv, { found: [['VETO', 1], ['ZEBRA', 3]] }), 'boggle-found-not-submitted'));
ok('boggle: a resumed round is not judged that way', !has(bg(bgEv, { res: 1, found: [['ZEBRA', 3]] }), 'boggle-found-not-submitted'));
const words = Array.from({ length: 22 }, (_, k) => 'W' + String.fromCharCode(65 + k) + 'AT');
ok('boggle: words 300 ms apart are suspicious', has(bg(words.map((w, k) => [w, 'v', k * 300])), 'boggle-machine-pace'));
ok('boggle: 22 words with none refused is suspicious', has(bg(words.map((w, k) => [w, 'v', k * 3000])), 'boggle-word-list'));
ok('boggle: 22 words with misses, in their own order, pass', !has(bg([...words.reverse().map((w, k) => [w, 'v', k * 3000]), ['QQQ', 'i', 99999]]), 'boggle-word-list'));

// Every proven rule is in TRIP_PROVEN (Option A voids those).
ok('every proven rule is listed for Option A', [...ids].every((id) => TRIP_PROVEN().has(id) === TRIP_GAMES[id.split('-')[0]].find((r) => r.id === id).proven));

const di = process.argv.indexOf('--db');
if (di > 0) {
  const log = JSON.parse(fs.readFileSync(process.argv[di + 1], 'utf8'));
  const ii = process.argv.indexOf('--input');
  const inp = ii > 0 && fs.existsSync(process.argv[ii + 1]) ? JSON.parse(fs.readFileSync(process.argv[ii + 1], 'utf8')) : {};
  const count = {}, seen = {};
  for (const [code, rows] of Object.entries(log || {})) for (const [id, e] of Object.entries(rows || {})) {
    if (!e || !GAMES.includes(e.g) || !/^record/.test(String(e.f || ''))) continue;
    seen[e.g] = (seen[e.g] || 0) + 1;
    const n = inp[code] && inp[code][id] ? inp[code][id].n : null;
    for (const h of runTripWires(e, n)) {
      count[h.rule] = (count[h.rule] || 0) + 1;
      console.log(`HIT ${h.proven ? 'PROVEN ' : ''}${code} ${id} ${new Date(Number(id.split('-')[0])).toLocaleString('en-US', { timeZone: 'America/New_York' })} ${e.g} ${h.rule}: ${h.v}`);
    }
  }
  for (const g of GAMES) console.log(`${g}: ${seen[g] || 0} real results; ` + TRIP_GAMES[g].map((r) => `${r.id} ${count[r.id] || 0}`).join(', '));
}
process.exit(fail ? 1 : 0);
