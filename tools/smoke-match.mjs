import { fileURLToPath as __toolsF2P } from 'node:url';
// Moved from the repo root to tools/ (2026-10-15): paths below resolve from the repo root.
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// smoke-match.mjs — plays FULL matches through the real UI in jsdom.
// Human decisions are scripted; every prompt checks DOM invariants against the engine.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/chinchon/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.Image = dom.window.Image;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
// Browser globals ui.js and the hub modules it imports read bare (not via window.): jsdom has
// them on its window only. pretendToBeVisual gives jsdom requestAnimationFrame.
for (const k of ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'Node', 'location', 'sessionStorage']) {
  if (typeof globalThis[k] === 'undefined' && dom.window[k] !== undefined) globalThis[k] = typeof dom.window[k] === 'function' && /^[a-z]/.test(k) ? dom.window[k].bind(dom.window) : dom.window[k];
}

const { init } = await import('../chinchon/js/ui.js');
const { DEFAULT_CONFIG } = await import('../chinchon/js/game.js');
const { AIAgent } = await import('../chinchon/js/ai.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };
const tick = () => new Promise((r) => setTimeout(r, 0));
// startGame() runs the match with `.catch(err => console.error('Chinchón match error', err))`, so a
// throw inside the engine or a render is NOT an unhandled rejection; collect it here instead.
const matchErrors = [];
const consoleError = console.error;
console.error = (...a) => { if (a[0] === 'Chinchón match error') matchErrors.push(a[1]); consoleError(...a); };
let rounds = 0, dragCount = 0;
const seen = { place: 0 };   // prompt kinds reached (SMOKE_VERBOSE=1 prints them)
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }

async function playMatch(seed, setupPatch) {
  const rnd = lcg(seed);
  const coach = new AIAgent({ difficulty: 'hard', rng: rnd });
  const ui = init(document.getElementById('app'));
  ui.beat = () => Promise.resolve();               // no AI pacing delays
  // Each match gets exactly its own rules on top of the defaults. (This used to Object.assign the
  // patch's `config` object INTO _setup and then merge the 'points' defaults over that same object,
  // so the patch's victoryCondition was overwritten: seed 5's "rounds" match played by points.)
  const { config: rules = {}, ...rest } = setupPatch;
  Object.assign(ui._setup, rest);
  ui._setup.config = { ...DEFAULT_CONFIG, victoryCondition: 'points', scoreLimit: 40, ...rules };
  // The deal, the stock resets, and the computers' choices all read Math.random (game.js and
  // ai.js default to it); seed it too, so a failing seed replays the same match every run.
  const realRandom = Math.random;
  Math.random = lcg(seed * 7919 + 17);
  ui.startGame();

  const root = document.querySelector('.cc-root');
  const handEl = root.querySelector('.cc-hand');
  let prompts = 0, idle = 0;
  // Rows (2026-10-23, chinchon/CLAUDE.md "Each card keeps its row until the player drags it"):
  // a fresh deal or the sort button = 3 top / 4 bottom; a drawn card goes on the right end of
  // the bottom row; nothing else ever changes a card's row. `rows` is id -> 0 (top) | 1 (bottom)
  // as last seen, `rowsRound` the round it was seen in.
  let rows = null, rowsRound = -1;
  const readRows = () => {
    const kids = [...handEl.children];
    const b = kids.indexOf(handEl.querySelector('.cc-hand-break'));
    const m = new Map();
    kids.forEach((el, i) => { if (el.dataset.drag) m.set(el.dataset.drag, b >= 0 && i > b ? 1 : 0); });
    return { m, b, ids: kids.filter((el) => el.dataset.drag).map((el) => el.dataset.drag) };
  };
  const checkFreshSplit = (where) => {
    const { m, b } = readRows();
    const top = [...m.values()].filter((r) => r === 0).length;
    if (b < 0 || top !== m.size - 4) ok(false, `${where}: expected ${m.size - 4} top / 4 bottom, got ${top} / ${m.size - top}`);
  };

  for (let i = 0; i < 60000 && !ui._matchEnded; i++) {
    // The match loop logs (and swallows) any throw from the engine or a render; stop at once
    // rather than spin out the remaining ticks waiting for a prompt that will never come.
    if (matchErrors.length) break;
    await tick();
    if (ui._modalResolve) { idle = 0; ui._resolveModal(); continue; }
    if (ui._placeResolve) { idle = 0; seen.place++; ui._resolvePlace(rnd() < 0.5 ? (ui._placeIds || []) : []); continue; }
    const p = ui._pending;
    // AI pacing is stubbed and jsdom has no WAAPI (so no card flights): the match never has a
    // reason to sit idle. A stall means a hook is waiting on something nobody will deliver.
    if (!p) { if (++idle > 200) { ok(false, `match(seed ${seed}) stalled: no prompt for ${idle} ticks`); break; } continue; }
    idle = 0;
    prompts++;
    seen[p.kind] = (seen[p.kind] || 0) + 1;

    // --- DOM invariants at every human prompt ---
    const engineHand = ui.game.players[0].hand;
    const domCards = [...handEl.querySelectorAll('.cc-card[data-drag]')];
    if (domCards.length !== engineHand.length) { ok(false, `hand mismatch: DOM ${domCards.length} vs engine ${engineHand.length}`); }
    const domIds = new Set(domCards.map((el) => el.dataset.drag));
    if (![...engineHand].every((c) => domIds.has(c.id))) ok(false, 'DOM hand ids diverged from engine');

    // rows: the break sits at the top row's size, and no card changed row on its own
    const now = readRows();
    if (engineHand.length > 4 && now.b !== ui._handBreak) ok(false, `break at ${now.b}, top row holds ${ui._handBreak}`);
    if (ui.game.round !== rowsRound) {
      checkFreshSplit(`round ${ui.game.round} deal`);
    } else {
      for (const [id, r] of now.m) {
        if (rows.has(id)) { if (rows.get(id) !== r) ok(false, `card ${id} changed row by itself`); }
        else if (r !== 1 || now.ids[now.ids.length - 1] !== id) ok(false, `drawn card ${id} not at the right end of the bottom row`);
      }
    }

    if (p.kind === 'draw') {
      if (!root.querySelector('.cc-stock').classList.contains('is-actionable')) ok(false, 'stock not actionable at draw');
      if (!root.querySelector('.cc-self-chip').classList.contains('is-myturn')) ok(false, 'no turn glow at draw');
      if ((root.querySelector('.cc-status-text').textContent || '').includes('draw')) ok(false, 'draw text leaked back');
    }
    const pills = [...root.querySelectorAll('.cc-pill')].map((x) => x.textContent);
    if (!pills.some((t) => t.startsWith('Round '))) ok(false, 'round pill missing');

    // is-new: the just-drawn card is ringed only between the human's draw and their discard
    const newCards = [...handEl.querySelectorAll('.cc-card.is-new')];
    if (p.kind === 'discard') {
      if (newCards.length !== 1) ok(false, `expected exactly 1 is-new card at discard prompt, got ${newCards.length}`);
    } else if (newCards.length !== 0) {
      ok(false, `expected 0 is-new cards at ${p.kind} prompt, got ${newCards.length}`);
    }

    // occasionally exercise Sets + sort through the real click path
    if (prompts % 17 === 0) { root.querySelector('[data-action="toggle-highlight"]').click(); }
    if (prompts % 23 === 0) { root.querySelector('[data-action="sort-cycle"]').click(); checkFreshSplit('after sort'); }
    // ...and a drag of one card into the other row (the only way a card may change row).
    // jsdom has no layout, so the drop target is set on the drag the way the pointer would.
    let dragged = null;
    if (prompts % 13 === 0) {
      const before = readRows().m;
      const ids = [...before.keys()];
      const id = ids[Math.floor(rnd() * ids.length)];
      const to = before.get(id) === 0 ? 1 : 0;
      ui.onHandPointerDown({ pointerType: 'touch', target: handEl.querySelector(`[data-drag="${id}"]`), clientX: 5, clientY: 5, button: 0 });
      if (!ui._drag) ok(false, 'hand drag did not start');
      else {
        Object.assign(ui._drag, { moved: true, overDiscard: false, targetIndex: Math.floor(rnd() * ids.length), targetRow: to });
        ui.onPointerUp();
        const after = readRows().m;
        if (after.get(id) !== to) ok(false, `dragged card ${id} did not move to row ${to}`);
        for (const [k, r] of after) if (k !== id && before.get(k) !== r) ok(false, `dragging ${id} moved ${k} to the other row`);
        if (ui._pending !== p) ok(false, 'an in-hand drag resolved the prompt');
        dragged = id;
      }
    }
    rows = readRows().m; rowsRound = ui.game.round;
    if (dragged) dragCount++;

    // --- scripted human decision ---
    // Mostly a sensible player (the hard computer's own choice), sometimes a random one. A purely
    // random human never got down to 3 points, so the close prompt was never reached.
    const view = ui.game.getView(0);
    if (p.kind === 'draw') {
      const src = rnd() < 0.75 ? coach.chooseDraw(view) : (ui.game.discardTop() && rnd() < 0.4 ? 'discard' : 'stock');
      ui._resolvePending(src);
    } else if (p.kind === 'discard') {
      const h = ui.game.players[0].hand;
      const pick = rnd() < 0.75 ? coach.chooseDiscard(view) : h[Math.floor(rnd() * h.length)].id;
      if (rnd() < 0.3) {
        // simulate drag-to-discard through the real pointer path
        const el = handEl.querySelector(`[data-drag="${pick}"]`);
        ui.onHandPointerDown({ pointerType: 'touch', target: el, clientX: 5, clientY: 5, button: 0 });
        if (ui._drag) { ui._drag.moved = true; ui._drag.overDiscard = true; ui.onPointerUp(); }
        else ui._resolvePending(pick);
        if (ui._pending === p) ok(false, 'drag onto the discard pile did not discard');
      } else {
        ui._resolvePending(pick);
      }
    } else if (p.kind === 'close') {
      ui._resolvePending(rnd() < 0.5);
    }
  }

  ok(matchErrors.length === 0, `match(seed ${seed}) ran without a match error: ${matchErrors.map(String).join('; ')}`);
  matchErrors.length = 0;
  rounds += ui.game.round;
  if (process.env.SMOKE_VERBOSE) console.log(`seed ${seed}: ${ui.game.round} rounds, totals ${ui.game.players.map((q) => q.totalScore).join("/")}, human prompts ${prompts}`);
  ok(ui._matchEnded, `match(seed ${seed}) completed`);
  const want = { ...DEFAULT_CONFIG, victoryCondition: 'points', scoreLimit: 40, ...rules };
  ok(Object.keys(want).every((k) => ui.game.config[k] === want[k]), `match(seed ${seed}) played with the rules it asked for`);
  if (want.victoryCondition === 'rounds') ok(ui.game.round === want.roundsLimit, `match(seed ${seed}) by rounds lasted ${want.roundsLimit} rounds (got ${ui.game.round})`);
  ok(!!ui.game.winner, `match(seed ${seed}) has a winner`);
  ui.destroy();
  Math.random = realRandom;
  return prompts;
}

let total = 0;
const errs = [];
process.on('unhandledRejection', (e) => errs.push(e));
total += await playMatch(1, { count: 3 });
total += await playMatch(2, { count: 2, config: { joker: true } });
total += await playMatch(3, { count: 4, config: { extended: true, showRemaining: true } });
total += await playMatch(4, { count: 3, config: { aceOrosWild: true, placeOnEnding: 'manual' } });
total += await playMatch(5, { count: 2, config: { victoryCondition: 'rounds', roundsLimit: 4 } });
ok(errs.length === 0, `unhandled rejections: ${errs.map(String).join('; ')}`);

if (process.env.SMOKE_VERBOSE) console.log('prompts seen', JSON.stringify(seen));
console.log(`\nMatch-through-UI: ${pass} passed, ${fail} failed (${total} human prompts, ${rounds} rounds, ${dragCount} row drags across 5 full matches).`);
process.exit(fail ? 1 : 0);
