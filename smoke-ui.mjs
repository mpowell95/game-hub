// smoke-ui.mjs — headless checks for the gameplay/UX overhaul (not deployed).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/chinchon/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.Image = dom.window.Image;
global.HTMLElement = dom.window.HTMLElement;

const { init } = await import('./chinchon/js/ui.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };

const ui = init(document.getElementById('app'));

// --- setup screen ---
const root = document.querySelector('.cc-root');
ok(root.querySelector('.cc-title-bonita')?.textContent === 'Anita Attack', 'title renamed to Anita Attack');
ok(!root.querySelector('.cc-subtitle'), 'family-edition subtitle removed');
ok(root.innerHTML.includes('Game Settings'), 'Rules renamed to Game Settings');
ok(root.querySelector('.cc-topbar .cc-menu-btn')?.textContent === '☰', 'small menu button in topbar');
ok(!root.querySelector('.cc-gamebar'), 'old gamebar row gone');

// --- fake a mid-game state (no async match loop) ---
const cfg = { maxResets: 2, showRemaining: false, extended: false, joker: false, aceOrosWild: false, figuresFaceValue: false, maxClose: 3, winWithChinchon: true, chinchonNegative: -25, victoryCondition: 'points', scoreLimit: 100 };
const card = (suit, rank) => ({ id: `${suit}-${rank}`, suit, rank, value: rank >= 10 ? 10 : rank, isJoker: false, isWild: false });
const hand = [card('oros', 1), card('oros', 2), card('oros', 3), card('copas', 5), card('espadas', 7), card('bastos', 9), card('copas', 12)];
const human = { id: 0, isHuman: true, name: 'Matt', avatar: '😎', hand, totalScore: 12 };
const opp = { id: 1, isHuman: false, name: 'Lucía', avatar: '💃', hand: [], totalScore: 30, difficulty: 'normal' };
ui.game = {
  players: [human, opp], config: cfg, round: 1, resetsUsed: 0, stock: [card('oros', 6)],
  byId: (id) => (id === 0 ? human : opp),
  discardTop: () => card('espadas', 4),
  abort() {},
};
ui.el.setup.hidden = true; ui.el.header.hidden = true; ui.el.game.hidden = false;
ui._buildPiles();
ui._pending = { kind: 'draw', resolve: () => {} };
ui.render();

// piles + status + chip
ok(root.querySelector('.cc-stock').classList.contains('is-actionable'), 'stock actionable in draw mode');
const pills = [...root.querySelectorAll('.cc-pill')].map((p) => p.textContent);
ok(pills.includes('Round 1') && pills.includes('Resets 0/2'), 'round/resets pills render');
ok(root.querySelector('.cc-status-text').textContent === '', 'no "Your turn — draw" text');
ok(root.querySelector('.cc-self-chip').classList.contains('is-myturn'), 'self chip glows on your turn');
const oppPill = root.querySelector('.cc-opp-pill');
ok(oppPill && !root.querySelector('.cc-opp-count'), 'opponent is a pill, no card-count badge');
ok(oppPill.textContent.includes('30'), 'opponent pill shows score');

// hand: 2 rows, break at len-4
const handEl = root.querySelector('.cc-hand');
const kids = [...handEl.children];
ok(kids.filter((k) => k.classList.contains('cc-card')).length === 7, '7 hand cards');
ok(kids[3].classList.contains('cc-hand-break'), 'break sits after 3 cards (3 top / 4 bottom)');

// node reuse: same element objects (and imgs) survive a re-render
const before = [...handEl.querySelectorAll('.cc-card')];
const imgsBefore = [...handEl.querySelectorAll('img')];
ui._pending = { kind: 'discard', resolve: () => {} };
ui._selectedCardId = 'copas-5';
ui.render();
const after = [...handEl.querySelectorAll('.cc-card')];
ok(before.length === after.length && before.every((el, i) => el === after[i]), 'card nodes reused across renders');
ok(imgsBefore.every((img, i) => img === [...handEl.querySelectorAll('img')][i]), 'img elements never recreated');
ok(handEl.querySelector('.is-selected')?.dataset.drag === 'copas-5', 'selection applied in place');

// sets highlight: oros 1-2-3 run keeps meld ring; others dim
ui._highlightSets = true;
ui.render();
const dimmed = [...handEl.querySelectorAll('.cc-card.is-dimmed')].map((el) => el.dataset.drag);
ok(dimmed.length === 4 && !dimmed.includes('oros-1'), 'non-set cards dimmed, run stays lit');
ui._highlightSets = false;
ui.render();
ok(!handEl.querySelector('.is-dimmed'), 'dim clears when Sets toggled off');

// 8th card after a draw -> 4/4 split
human.hand = hand.concat([card('bastos', 2)]);
ui.render();
ok([...handEl.children][4].classList.contains('cc-hand-break'), '8 cards split 4 top / 4 bottom');

// drag-to-discard plumbing
ok(typeof ui._overDiscard === 'function' && ui._canDropDiscard() === true, 'drop-to-discard active while discarding');
let resolved = null;
ui._pending = { kind: 'discard', resolve: (v) => { resolved = v; } };
ui.onHandPointerDown({ pointerType: 'touch', target: handEl.querySelector('[data-drag="copas-12"]'), clientX: 10, clientY: 10 });
ui._drag.moved = true; ui._drag.overDiscard = true;
ui.onPointerUp();
ok(resolved === 'copas-12', 'dropping on discard resolves the discard with that card');

// handbar: icon sort + small Sets
ok(root.querySelector('.cc-tool-icon')?.textContent === '↕', 'sort is arrow-only');
ok(root.querySelector('.cc-tool-sm')?.textContent === 'Sets', 'highlight renamed to small Sets');

// newly-drawn card indicator: rings exactly the tracked id, clears when null
ui._newCardId = 'bastos-9';
ui.render();
const newRinged = [...handEl.querySelectorAll('.cc-card.is-new')].map((el) => el.dataset.drag);
ok(newRinged.length === 1 && newRinged[0] === 'bastos-9', 'is-new rings exactly the drawn card');
ui._newCardId = null;
ui.render();
ok(!handEl.querySelector('.is-new'), 'is-new clears once the draw id is unset');

// round summary: chinchón bonus and banner read the engine's actual value, not hardcoded
ui.game.whoClosed = 0;
human.closeInfo = { category: 'chinchon', score: -25 };
ui._renderRoundModal();
ok(document.querySelector('.cc-chinchon-banner')?.textContent.includes('¡CHINCHÓN!'), 'chinchón banner leads the round summary');
ok(document.querySelector('.cc-bonus-line')?.textContent === 'Chinchón bonus: -25', 'chinchón bonus line shows the engine-recorded score');
ui._resolveModal();

// all-cards-melded (double meld) close: -10 read from the engine, no chinchón banner
human.closeInfo = { category: 'doubleMeld', score: -10 };
ui._renderRoundModal();
ok(!document.querySelector('.cc-chinchon-banner'), 'no chinchón banner on a plain double-meld close');
ok(document.querySelector('.cc-bonus-line')?.textContent === 'All cards melded: -10', 'double-meld bonus line shows the engine-recorded score');
ui._resolveModal();

console.log(`\nUI smoke: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
