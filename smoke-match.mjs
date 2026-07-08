// smoke-match.mjs — plays FULL matches through the real UI in jsdom.
// Human decisions are scripted; every prompt checks DOM invariants against the engine.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/chinchon/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.Image = dom.window.Image;
global.HTMLElement = dom.window.HTMLElement;

const { init } = await import('./chinchon/js/ui.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };
const tick = () => new Promise((r) => setTimeout(r, 0));
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }

async function playMatch(seed, setupPatch) {
  const rnd = lcg(seed);
  const ui = init(document.getElementById('app'));
  ui.beat = () => Promise.resolve();               // no AI pacing delays
  Object.assign(ui._setup, setupPatch);
  Object.assign(ui._setup.config, { victoryCondition: 'points', scoreLimit: 40 }, setupPatch.config || {});
  ui.startGame();

  const root = document.querySelector('.cc-root');
  const handEl = root.querySelector('.cc-hand');
  let prompts = 0;

  for (let i = 0; i < 60000 && !ui._matchEnded; i++) {
    await tick();
    if (ui._modalResolve) { ui._resolveModal(); continue; }
    if (ui._placeResolve) { ui._resolvePlace(rnd() < 0.5 ? (ui._placeIds || []) : []); continue; }
    const p = ui._pending;
    if (!p) continue;
    prompts++;

    // --- DOM invariants at every human prompt ---
    const engineHand = ui.game.players[0].hand;
    const domCards = [...handEl.querySelectorAll('.cc-card[data-drag]')];
    if (domCards.length !== engineHand.length) { ok(false, `hand mismatch: DOM ${domCards.length} vs engine ${engineHand.length}`); }
    const domIds = new Set(domCards.map((el) => el.dataset.drag));
    if (![...engineHand].every((c) => domIds.has(c.id))) ok(false, 'DOM hand ids diverged from engine');
    const brk = handEl.querySelector('.cc-hand-break');
    if (engineHand.length > 4) {
      const kids = [...handEl.children];
      if (kids.indexOf(brk) !== engineHand.length - 4) ok(false, `break at ${kids.indexOf(brk)} for ${engineHand.length} cards`);
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
    if (prompts % 23 === 0) { root.querySelector('[data-action="sort-cycle"]').click(); }

    // --- scripted human decision ---
    if (p.kind === 'draw') {
      ui._resolvePending(ui.game.discardTop() && rnd() < 0.4 ? 'discard' : 'stock');
    } else if (p.kind === 'discard') {
      const h = ui.game.players[0].hand;
      const pick = h[Math.floor(rnd() * h.length)].id;
      if (rnd() < 0.3) {
        // simulate drag-to-discard through the real pointer path
        const el = handEl.querySelector(`[data-drag="${pick}"]`);
        ui.onHandPointerDown({ pointerType: 'touch', target: el, clientX: 5, clientY: 5, button: 0 });
        if (ui._drag) { ui._drag.moved = true; ui._drag.overDiscard = true; ui.onPointerUp(); }
        else ui._resolvePending(pick);
      } else {
        ui._resolvePending(pick);
      }
    } else if (p.kind === 'close') {
      ui._resolvePending(rnd() < 0.5);
    }
  }

  ok(ui._matchEnded, `match(seed ${seed}) completed`);
  ok(!!ui.game.winner, `match(seed ${seed}) has a winner`);
  ui.destroy();
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

console.log(`\nMatch-through-UI: ${pass} passed, ${fail} failed (${total} human prompts exercised across 5 full matches).`);
process.exit(fail ? 1 : 0);
