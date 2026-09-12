// test-rate-guard.mjs - "No human plays this fast" (js/game-stats.js, 2026-09-12).
//
// A player botted Tic Tac Toe (4,725 games, one loss) and Matt asked for a safeguard covering
// every game. The gate is a RATE gate, and the whole risk of a rate gate is the FALSE POSITIVE:
// a threshold set too low costs a real player a real play, which is THE LAW rule 1 and is worse
// than any bot getting through. So most of this file is about what must NOT be refused.
//
// Run: node test-rate-guard.mjs

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name); } };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

const G = await import('./js/game-stats.js');

// --- the pure decision -------------------------------------------------------------------------
console.log('\n--- the rate decision ---');
const now = 1_757_000_000_000;
const nStamps = (n, spacingMs) => Array.from({ length: n }, (_, i) => now - (n - i) * spacingMs);

ok('an empty history is never too fast', G.rateDecision([], now).blocked === false);
ok('junk is not a history', G.rateDecision('nonsense', now).blocked === false);
ok('one result is never too fast', G.rateDecision([now - 10], now).blocked === false);

// A person sprinting at Beginner Tic Tac Toe: ~5-8 s a game. Nowhere near the gate, and this is
// the case the whole threshold was chosen around.
ok('a human sprinting at 5s a game is never refused', G.rateDecision(nStamps(12, 5000), now).blocked === false);
ok('a human at 8s a game is never refused', G.rateDecision(nStamps(8, 8000), now).blocked === false);
// Twice as fast as anyone here can actually play, and STILL allowed - the headroom is the point.
ok('even 2.5s a game is still allowed', G.rateDecision(nStamps(24, 2500), now).blocked === false);

// A bot: one every second, for a minute.
ok('a bot at 1s a game IS refused', G.rateDecision(nStamps(45, 1000), now).blocked === true);
ok('a bot with no pause at all IS refused', G.rateDecision(nStamps(60, 200), now).blocked === true);

// The window must actually slide, or a long session eventually locks a real player out.
ok('old results fall out of the window',
  G.rateDecision(nStamps(100, 1000).map((t) => t - 120000), now).blocked === false);
ok('a long honest session never accumulates into a refusal',
  G.rateDecision(nStamps(500, 30000), now).blocked === false);
ok('the window keeps only what is inside it', G.rateDecision(nStamps(5, 90000), now).recent.length === 0);

// --- the live recorders ------------------------------------------------------------------------
console.log('\n--- through the real recorders ---');
store.clear();
let recorded = 0;
for (let i = 0; i < 25; i++) if (G.recordTicTacToe('classic', 'beginner', true)) recorded++;
ok('25 fast games in a row are all recorded (under the gate)', recorded === 25);
const mid = G.loadStats().games.tictactoe.total.played;
ok('...and every one of them reached the store', mid === 25);

let blocked = 0;
for (let i = 0; i < 40; i++) if (G.recordTicTacToe('classic', 'beginner', true) === null) blocked++;
ok('a run of 65 in one burst starts being refused', blocked > 0);
const after = G.loadStats().games.tictactoe.total.played;
ok('a refused result changes NO counter', after === mid + (40 - blocked));
ok('a refused result is counted in the report', (G.rateReport() || {}).tictactoe.n === blocked);

// The gate is per game, so one game's bot cannot lock a person out of a different game.
const c4 = G.recordConnect4('easy', 'player', true);
ok('another game is unaffected by a blocked one', c4 !== null && G.loadStats().games.connect4.total.played === 1);

// --- what the report says ----------------------------------------------------------------------
console.log('\n--- the report ---');
store.clear();
ok('a device that has never tripped it reports nothing', G.rateReport() === null);
G.recordSnake(5, 'easy', false);
ok('...and still reports nothing after ordinary play', G.rateReport() === null);

// --- structural: the gate is actually wired to every recorder ----------------------------------
// Prose does not enforce anything (root CLAUDE.md, test-game-conventions.mjs's own rationale). A
// recorder added later with no guard is the silent failure this block exists for.
console.log('\n--- every recorder is guarded ---');
const src = readFileSync('./js/game-stats.js', 'utf8');
const recorders = [...src.matchAll(/^export function (record[A-Za-z0-9]*)\(/gm)].map((m) => m[1]);
// recordHeadToHead rides an existing result rather than being one, and recordBaseballCareerFinished
// is a career summary, not a play - neither is a per-play counter, so neither takes the gate.
const EXEMPT = new Set(['recordHeadToHead', 'recordBaseballCareerFinished']);
ok('found the recorders', recorders.length >= 18);
for (const r of recorders) {
  if (EXEMPT.has(r)) continue;
  const body = src.slice(src.indexOf(`export function ${r}(`));
  const firstLines = body.split('\n').slice(1, 3).join('\n');
  ok(`${r} refuses an impossible rate before touching the store`, /if \(tooFast\(/.test(firstLines));
}

// The guard must come BEFORE loadStats(), or a refusal has already read and could still write.
for (const r of recorders) {
  if (EXEMPT.has(r)) continue;
  const body = src.slice(src.indexOf(`export function ${r}(`));
  const head = body.slice(0, body.indexOf('\n}\n'));
  ok(`${r} guards before it reads the store`, head.indexOf('tooFast(') < head.indexOf('loadStats()'));
}

console.log(`\nRate guard tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
