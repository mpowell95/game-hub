// howto.js -- Mancala's HOW TO PLAY carousel.
//
// CLONED from reference/mancala/*.MOV (seven iPhone screen recordings Matt uploaded 2026-08-11).
// Same chrome as Yahtzee's (yahtzee/js/howto.js) because the reference app is the same one: dark
// rounded modal, white card, a coloured illustration panel, six dots, [|<] [OK] [>|].
//
// TWO THINGS THE RECORDINGS SHOW THAT ARE EASY TO MISS:
//
// 1. There are SEVEN recordings but SIX pages. Two pages change their caption PART-WAY through
//    their own animation - the sow page says "…distributed counterclockwise…" while the stones
//    are travelling and then "Each pit receives one stone…" as they land; the end page says "The
//    game ends when all six pits on one side are empty" and then "Any remaining stones on the
//    other side are captured by that player". The trailing ellipsis in the first half is the
//    reference's own signal that it continues. Hence PAGES[].parts.
// 2. The illustration panel is TURN-COLOURED - salmon while the vermilion player is acting, blue
//    while the blue player is. Our own board already does this (`.mancala[data-turn]` in
//    mancala.css), so the sheet is showing a real property of the game, not decoration.
//
// THE ONE DELIBERATE DEVIATION, as with Yahtzee: the reference draws ITS board, which is vertical
// (two columns of pits, stores top and bottom). Ours is horizontal - your blue pits along the
// bottom, your mancala on the right, the opponent's vermilion pits along the top, their mancala on
// the left - so that is what the illustration draws. A tutorial pointing at a board the player is
// about to not see teaches the wrong thing.
//
// Reduced motion: every page paints a still, informative pose instead of looping. Never blank.

import { makeT } from '../../js/i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);

const REDUCE = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Six pages. `parts` are caption keys shown in order across the page's own timeline; `side`
 *  is which player is acting, which the panel colour follows. */
const PAGES = [
  { key: 'board',   parts: ['ht_board'],            side: 'p2' },
  { key: 'sow',     parts: ['ht_sow_a', 'ht_sow_b'], side: 'p2' },
  { key: 'again',   parts: ['ht_again'],            side: 'p1' },
  { key: 'capture', parts: ['ht_capture'],          side: 'p2' },
  { key: 'end',     parts: ['ht_end_a', 'ht_end_b'], side: 'p1' },
  { key: 'win',     parts: ['ht_win'],              side: 'p1' },
];

/* ---------- the little board ------------------------------------------------------------------
 * Drawn at a fixed 200x132 and scaled by CSS. Indices match game.js exactly: 0-5 are the blue
 * (bottom, "you") pits left to right, 6 is the blue mancala on the right, 7-12 are the vermilion
 * (top) pits RIGHT TO LEFT, 13 is the vermilion mancala on the left. Sowing is i+1 mod 14, which
 * on this layout traces one continuous counterclockwise loop -- the whole point of the diagram. */
const PIT_X = [40, 62, 84, 106, 128, 150];
const BOTTOM_Y = 96;
const TOP_Y = 36;

/** Screen position of any index, so the travelling stone and the hand share one source. */
function posOf(i) {
  if (i === 6) return { x: 178, y: 66 };            // your mancala, right
  if (i === 13) return { x: 22, y: 66 };            // theirs, left
  if (i <= 5) return { x: PIT_X[i], y: BOTTOM_Y };
  return { x: PIT_X[12 - i], y: TOP_Y };            // 7..12 run right to left
}

function boardHtml() {
  let h = '<div class="mc-ht-board" data-role="board"><div class="mc-ht-wood"></div>';
  h += '<div class="mc-ht-store mc-ht-store-p2" data-idx="13"><i data-count="13">0</i></div>';
  h += '<div class="mc-ht-store mc-ht-store-p1" data-idx="6"><i data-count="6">0</i></div>';
  for (let i = 0; i <= 5; i++) {
    h += `<span class="mc-ht-pit mc-ht-p1" data-idx="${i}" style="left:${PIT_X[i] - 9}px;top:${BOTTOM_Y - 9}px"><i data-count="${i}">4</i></span>`;
  }
  for (let i = 7; i <= 12; i++) {
    const p = posOf(i);
    h += `<span class="mc-ht-pit mc-ht-p2" data-idx="${i}" style="left:${p.x - 9}px;top:${p.y - 9}px"><i data-count="${i}">4</i></span>`;
  }
  h += '<span class="mc-ht-stone" data-role="stone"></span>';
  h += '<span class="mc-ht-cap" data-role="cap"></span>';
  h += '<div class="mc-ht-win" data-role="win"><span></span></div>';
  h += '<div class="mc-ht-hand" data-role="hand">'
    + '<svg viewBox="0 0 48 60" aria-hidden="true">'
    + '<path d="M17 30V10a5 5 0 0 1 10 0v14m0-4a4.5 4.5 0 0 1 9 0v6m0-3a4.5 4.5 0 0 1 9 0v14c0 12-8 20-19 20-8 0-12-3-16-10L4 38c-2-4 3-8 6-4l7 8" '
    + 'fill="#FBE0C0" stroke="#8A5A2B" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
    + '</svg></div>';
  h += '</div>';
  return h;
}

export function howToHtml() {
  return `
  <div class="mc-ht-scrim" data-role="howto" hidden>
    <div class="mc-ht-modal" role="dialog" aria-modal="true" aria-label="${t('howto')}">
      <div class="mc-ht-title">${t('ht_title')}</div>
      <div class="mc-ht-card">
        <div class="mc-ht-panel" data-role="panel">${boardHtml()}</div>
        <p class="mc-ht-caption"><span data-role="caption"></span></p>
      </div>
      <div class="mc-ht-dots" data-role="dots">
        ${PAGES.map((_, i) => `<i data-dot="${i}"></i>`).join('')}
      </div>
      <div class="mc-ht-nav">
        <button type="button" class="mc-ht-sq" data-action="ht-first" aria-label="${t('ht_first')}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M20 5l-9 7 9 7z"/></svg>
        </button>
        <button type="button" class="mc-ht-ok" data-action="ht-close">${t('ht_ok')}</button>
        <button type="button" class="mc-ht-sq" data-action="ht-next" aria-label="${t('ht_next')}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M4 5l9 7-9 7z"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

/** One carousel. `root` is the game's own root element, never document. */
export function createHowTo(root) {
  const scrim = root.querySelector('[data-role="howto"]');
  if (!scrim) return null;
  const board = scrim.querySelector('[data-role="board"]');
  const panel = scrim.querySelector('[data-role="panel"]');
  const caption = scrim.querySelector('[data-role="caption"]');
  const hand = scrim.querySelector('[data-role="hand"]');
  const stone = scrim.querySelector('[data-role="stone"]');
  const capMark = scrim.querySelector('[data-role="cap"]');
  const winMark = scrim.querySelector('[data-role="win"]');
  const dots = [...scrim.querySelectorAll('[data-dot]')];
  const btnFirst = scrim.querySelector('[data-action="ht-first"]');
  const btnNext = scrim.querySelector('[data-action="ht-next"]');

  let page = 0;
  let timers = [];
  let open = false;

  const after = (ms, fn) => { timers.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const el = (sel) => board.querySelector(sel);

  function fit() {
    if (!panel.clientWidth) return;
    board.style.transform = `scale(${panel.clientWidth / 200})`;
  }

  // A REAL model, not numbers derived from "everything started at 4". sow() used to compute a
  // landed pit's new count as 4 + drops, which is right on a fresh board and wrong on every page
  // that sets a pit up differently -- the capture page starts one pit empty and it rendered 5.
  const counts = new Array(14).fill(0);
  const paint = (i) => {
    const c = el(`[data-count="${i}"]`);
    if (c) c.textContent = String(counts[i]);
    const holder = el(`[data-idx="${i}"]`);
    if (holder) holder.classList.toggle('mc-ht-empty', counts[i] === 0);
  };
  const setCount = (i, n) => { counts[i] = n; paint(i); };
  const addStone = (i) => { counts[i] += 1; paint(i); };
  const lift = (i, on) => { const e = el(`[data-idx="${i}"]`); if (e) e.classList.toggle('mc-ht-lit', !!on); };
  const clearLit = () => board.querySelectorAll('.mc-ht-lit').forEach((e) => e.classList.remove('mc-ht-lit'));

  /** Move an absolutely-positioned marker to a board index. */
  const moveTo = (node, i, extraClass) => {
    const p = posOf(i);
    node.style.transform = `translate(${p.x}px, ${p.y}px)`;
    if (extraClass) node.classList.add(extraClass);
  };
  const handTo = (i, press) => {
    const p = posOf(i);
    hand.style.opacity = '1';
    hand.style.transform = `translate(${p.x}px, ${p.y + 4}px) scale(${press ? 0.86 : 1})`;
  };
  const hideHand = () => { hand.style.opacity = '0'; };

  /** Every page starts from the same board: four stones a pit, empty stores. */
  function resetBoard() {
    for (let i = 0; i <= 5; i++) setCount(i, 4);
    for (let i = 7; i <= 12; i++) setCount(i, 4);
    setCount(6, 0); setCount(13, 0);
    clearLit();
    stone.classList.remove('mc-ht-show');
    capMark.classList.remove('mc-ht-show');
    winMark.classList.remove('mc-ht-show');
    hideHand();
  }

  /** The shared beat every page but the first uses: sow `n` stones from `from`, one per index,
   *  skipping the opponent's store exactly as game.js does. Calls back with the final index. */
  function sow(from, n, startAt, step, done) {
    setCount(from, 0);
    let i = from, dropped = 0;
    const tick = () => {
      i = (i + 1) % 14;
      if (i === 13 && from <= 6) { i = 0; }          // blue never sows into the vermilion store
      dropped++;
      stone.classList.add('mc-ht-show');
      moveTo(stone, i);
      addStone(i);
      lift(i, true);
      after(step * 0.7, () => lift(i, false));
      if (dropped < n) after(step, tick);
      else after(step, () => { stone.classList.remove('mc-ht-show'); if (done) done(i); });
    };
    after(startAt, tick);
  }

  const TIMELINES = {
    // 1. what the board IS: the six pits light along one side, then the mancala
    board(loop) {
      resetBoard();
      [0, 1, 2, 3, 4, 5].forEach((i, n) => after(400 + n * 150, () => lift(i, true)));
      after(1500, () => { clearLit(); lift(6, true); });
      after(2600, clearLit);
      after(3400, loop);
    },
    // 2. pick a pit; the stones travel one per pit. The caption changes as they land.
    sow(loop, showPart) {
      resetBoard();
      after(300, () => handTo(2));
      after(800, () => handTo(2, true));
      after(1000, hideHand);
      sow(2, 4, 1050, 420, () => {
        showPart(1);                                  // "Each pit receives one stone…"
        after(1400, loop);
      });
    },
    // 3. the last stone lands in your own mancala -> another turn
    again(loop) {
      resetBoard();
      after(300, () => handTo(2));
      after(800, () => handTo(2, true));
      after(1000, hideHand);
      sow(2, 4, 1050, 400, () => {
        after(200, () => lift(6, true));
        after(1500, () => { clearLit(); loop(); });
      });
    },
    // 4. last stone into an EMPTY pit -> take it and the pit opposite
    capture(loop) {
      resetBoard();
      setCount(5, 0);                                 // the empty pit it will land in
      setCount(4, 1);                                 // one stone, so it lands exactly there
      after(300, () => handTo(4));
      after(800, () => handTo(4, true));
      after(1000, hideHand);
      sow(4, 1, 1050, 420, () => {
        after(150, () => { lift(5, true); lift(7, true); moveTo(capMark, 5); capMark.classList.add('mc-ht-show'); });
        // the landed stone (1) plus everything opposite (4) go to your mancala
        after(1200, () => { setCount(6, counts[5] + counts[7]); setCount(5, 0); setCount(7, 0); });
        after(2100, () => { clearLit(); capMark.classList.remove('mc-ht-show'); loop(); });
      });
    },
    // 5. one side empties; the other player keeps what is left. Caption changes at the sweep.
    end(loop, showPart) {
      resetBoard();
      for (let i = 0; i <= 5; i++) setCount(i, 0);
      setCount(6, 21);
      after(500, () => [0, 1, 2, 3, 4, 5].forEach((i) => lift(i, true)));
      after(1400, () => {
        clearLit();
        showPart(1);                                  // "Any remaining stones…"
        [7, 8, 9, 10, 11, 12].forEach((i, n) => after(n * 160, () => { lift(i, true); setCount(i, 0); }));
      });
      after(2600, () => { setCount(13, 24); clearLit(); lift(13, true); });
      after(3600, () => { clearLit(); loop(); });
    },
    // 6. most stones wins
    win(loop) {
      resetBoard();
      for (let i = 0; i <= 5; i++) setCount(i, 0);
      for (let i = 7; i <= 12; i++) setCount(i, 0);
      setCount(6, 27); setCount(13, 21);
      after(500, () => lift(6, true));
      after(1200, () => { winMark.querySelector('span').textContent = t('ht_you_win'); winMark.classList.add('mc-ht-show'); });
      after(3000, () => { winMark.classList.remove('mc-ht-show'); clearLit(); loop(); });
    },
  };

  /** The still pose per page when motion is off: the END of each story, which is the part that
   *  carries the rule. */
  const STILLS = {
    board() { resetBoard(); lift(6, true); },
    sow() { resetBoard(); setCount(2, 0); [3, 4, 5].forEach((i) => setCount(i, 5)); setCount(6, 1); },
    again() { resetBoard(); setCount(2, 0); [3, 4, 5].forEach((i) => setCount(i, 5)); setCount(6, 1); lift(6, true); },
    capture() {
      resetBoard(); setCount(4, 0); setCount(5, 0); setCount(7, 0); setCount(6, 5);
      lift(5, true); lift(7, true); moveTo(capMark, 5); capMark.classList.add('mc-ht-show');
    },
    end() {
      resetBoard();
      for (let i = 0; i <= 5; i++) setCount(i, 0);
      for (let i = 7; i <= 12; i++) setCount(i, 0);
      setCount(6, 21); setCount(13, 24); lift(13, true);
    },
    win() {
      resetBoard();
      for (let i = 0; i <= 5; i++) setCount(i, 0);
      for (let i = 7; i <= 12; i++) setCount(i, 0);
      setCount(6, 27); setCount(13, 21); lift(6, true);
      winMark.querySelector('span').textContent = t('ht_you_win');
      winMark.classList.add('mc-ht-show');
    },
  };

  const showPart = (n) => {
    const parts = PAGES[page].parts;
    caption.innerHTML = t(parts[Math.min(n, parts.length - 1)]);
  };

  function play() {
    clearTimers();
    const p = PAGES[page];
    showPart(REDUCE() ? p.parts.length - 1 : 0);   // motion off: show the half that states the rule
    if (REDUCE()) { STILLS[p.key](); return; }
    const loop = () => { if (open) play(); };
    TIMELINES[p.key](loop, showPart);
  }

  function render() {
    const p = PAGES[page];
    panel.dataset.side = p.side;                   // the turn colour, same idea as the real board
    dots.forEach((d, i) => d.classList.toggle('mc-ht-dot-on', i === page));
    btnFirst.classList.toggle('mc-ht-off', page === 0);
    btnFirst.disabled = page === 0;
    btnNext.classList.toggle('mc-ht-off', page === PAGES.length - 1);
    btnNext.disabled = page === PAGES.length - 1;
    play();
  }

  return {
    open(startAt) {
      page = Math.min(Math.max(startAt || 0, 0), PAGES.length - 1);
      open = true;
      scrim.hidden = false;
      requestAnimationFrame(() => { fit(); render(); });
    },
    close() { open = false; clearTimers(); scrim.hidden = true; },
    next() { if (page < PAGES.length - 1) { page++; render(); } },
    first() { if (page > 0) { page = 0; render(); } },
    isOpen() { return open; },
    refit() { if (open) { fit(); play(); } },
    /** Language changed with the sheet open: relabel the static chrome in place rather than
     *  rebuilding, which would throw away the running timeline. */
    relabel() {
      const title = scrim.querySelector('.mc-ht-title');
      if (title) title.textContent = t('ht_title');
      const ok = scrim.querySelector('[data-action="ht-close"]');
      if (ok) ok.textContent = t('ht_ok');
      btnFirst.setAttribute('aria-label', t('ht_first'));
      btnNext.setAttribute('aria-label', t('ht_next'));
      render();
    },
    destroy() { open = false; clearTimers(); },
  };
}

export default { howToHtml, createHowTo };
