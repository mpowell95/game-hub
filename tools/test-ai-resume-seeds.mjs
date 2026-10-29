// tools/test-ai-resume-seeds.mjs (2026-10-29): killing the app before the computer moves and resuming
// must not re-roll its choice. Mancala, Escoba, Uno, Flick Soccer and Pool draw their computer's
// random numbers from a stream that is a pure function of (the game's saved seed, the position).
// Checked here: the same seed + position gives the same choice every time; different seeds spread
// over different choices (so a memorised game does not replay); and each ui.js saves and restores
// the seed (source probes). Headless, no browser. Run: node tools/test-ai-resume-seeds.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', label, extra); } };
const src = (rel) => fs.readFileSync(ROOT + rel, 'utf8');
const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);

// ---- Mancala (Beginner is the only tier that rolls dice) ---------------------------------------------
{
  const G = await import('../mancala/js/game.js');
  const A = await import('../mancala/js/ai.js');
  const state = G.newGame(G.P2);
  const pick = (seed) => A.chooseMove(state, 1, A.seededRand(seed, state));
  ok('mancala: the same seed + position picks the same pit every time', SEEDS.every((s) => pick(s) === pick(s) && pick(s) === pick(s)));
  ok('mancala: different seeds spread over different pits', new Set(SEEDS.map(pick)).size >= 2);
  const u = src('mancala/js/ui.js');
  ok('mancala: the seed is saved, loaded and used', /aiSeed: ui\.aiSeed/.test(u) && /aiSeed: Number\.isInteger\(raw\.aiSeed\)/.test(u)
    && /this\.aiSeed = saved\.aiSeed/.test(u) && /seededRand\(this\.aiSeed, this\.state\)/.test(u));
}

// ---- Escoba (Easy is the only tier that rolls dice) -----------------------------------------------------
{
  const D = await import('../escoba/js/deck.js');
  const A = await import('../escoba/js/ai.js');
  const deck = D.makeDeck('spanish');
  const view = { hand: deck.slice(0, 3), table: deck.slice(3, 7), me: { captured: [] }, others: [], deckMode: 'spanish' };
  const move = (seed) => JSON.stringify(new A.AIAgent({ difficulty: 'easy', seed }).chooseMove(view));
  ok('escoba: the same seed + position plays the same card every time', SEEDS.every((s) => move(s) === move(s) && move(s) === move(s)));
  ok('escoba: different seeds spread over different plays', new Set(SEEDS.map(move)).size >= 2);
  const u = src('escoba/js/ui.js');
  ok('escoba: the seed is saved, restored and handed to every agent', /aiSeed: this\._aiSeed/.test(u) && /save\.aiSeed/.test(u)
    && (u.match(/new AIAgent\(\{ difficulty: [^}]*seed: this\._aiSeed/g) || []).length === 2);
}

// ---- Uno (every tier breaks ties and picks wild colours at random) -------------------------------------
{
  const { UnoGame } = await import('../uno/js/game.js');
  const A = await import('../uno/js/ai.js');
  const g = new UnoGame({ playerCount: 3, rng: A.seededRng(5, 'deal') });
  const pi = g.currentPlayer;
  const act = (seed) => JSON.stringify(A.chooseAction(g, pi, 'medium', A.seededRng(seed, A.positionKey(g, pi))));
  ok('uno: the same seed + position gives the same action every time', SEEDS.every((s) => act(s) === act(s) && act(s) === act(s)));
  const a = new UnoGame({ playerCount: 3, rng: A.seededRng(5, 'deal') });
  const b = new UnoGame({ playerCount: 3, rng: A.seededRng(5, 'deal') });
  ok('uno: a seeded deal is reproducible', JSON.stringify(a.players.map((p) => p.hand.map((c) => c.id))) === JSON.stringify(b.players.map((p) => p.hand.map((c) => c.id))));
  const u = src('uno/js/ui.js');
  ok('uno: the seed is saved, loaded and used for actions and wild colours', /aiSeed: ui\._aiSeed/.test(u) && /saved\.aiSeed/.test(u)
    && /chooseAction\(g, pi, this\.difficulty, seededRng\(this\._aiSeed, positionKey\(g, pi\)\)\)/.test(u)
    && /pickWildColor\([^;]*seededRng\(this\._aiSeed/.test(u));
  ok('uno: no Math.random is left in the computer paths', !/Math\.random, null/.test(u) && !/chooseAction\([^)]*Math\.random/.test(u));
}

// ---- Flick Soccer -------------------------------------------------------------------------------------
{
  const E = await import('../flick-soccer/js/engine.js');
  const A = await import('../flick-soccer/js/ai.js');
  const m = E.newMatch(3, 0);
  const shot = (seed) => JSON.stringify(A.plan(m.b, m.turn, 'easy', A.seededRng(seed, m.b, m.turn)));
  const few = SEEDS.slice(0, 8);
  ok('flick soccer: the same seed + position plans the same shot every time', few.every((s) => shot(s) === shot(s)));
  ok('flick soccer: different seeds plan different shots', new Set(few.map(shot)).size >= 2);
  const u = src('flick-soccer/js/ui.js');
  ok('flick soccer: the seed is saved with the match, restored on Continue and used', /aiSeed: this\.aiSeed/.test(u) && /aiSeed: sv\.aiSeed/.test(u)
    && /seededRng\(this\.aiSeed, m\.b, m\.turn\)/.test(u));
}

// ---- Pool ---------------------------------------------------------------------------------------------
{
  const E = await import('../eight-ball/js/engine.js');
  const A = await import('../eight-ball/js/ai.js');
  const shotOf = (seed) => { const m = E.newMatch('8', 1, 0, seed, {}); return JSON.stringify(A.plan(m, m.turn, 'easy', A.seededRng(m, m.turn))); };
  const few = SEEDS.slice(0, 6);
  ok('pool: the same match seed + position plans the same shot every time', few.every((s) => shotOf(s) === shotOf(s)));
  ok('pool: different matches plan different shots', new Set(few.map(shotOf)).size >= 2);
  const u = src('eight-ball/js/ui.js');
  ok('pool: planShot gets the position-keyed stream', /planShot\(m, m\.turn, this\.diff, seededRng\(m, m\.turn\)\)/.test(u));
}

console.log(`AI resume seeds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
