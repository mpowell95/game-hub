// howto.js -- Yahtzee's HOW TO PLAY carousel.
//
// CLONED, ON PURPOSE, FROM reference/yahtzee/*.MOV (six iPhone screen recordings Matt uploaded
// 2026-08-11, one per page). Matt: "Clone the how to pages. Exactly. Animations included."
// The chrome, the page order, the wording, the six dots, the three-button footer and every
// animation beat below are taken from those recordings.
//
// THE ONE DELIBERATE DEVIATION, stated up front so nobody "fixes" it: the reference's little
// illustration shows the REFERENCE app's scorecard (pale card, teal/coral slots). Ours draws OUR
// scorecard (gold rows, red combo tiles, blue field) at the same small scale. A tutorial that
// showed a board the player is about to not see would teach the wrong thing -- the point of the
// clone is the teaching device, not the other game's artwork.
//
// Structure per page, matching the recordings top to bottom:
//   dark rounded modal
//     HOW TO PLAY               white, bold, wide-tracked caps
//     white card
//       salmon panel            the animated illustration
//       caption                 navy, 1-3 lines
//     six dots                  the current one filled orange
//     [|<-]  [ OK ]  [->|]      square, wide, square; the end arrows grey out at each end
//
// Reduced motion: every page still SHOWS its final, informative pose -- the dice rolled, the dice
// held, the score committed, the tooltip open, the bonus earned. Nothing is hidden, nothing loops.
// That is this repo's standing rule (root CLAUDE.md): an animation's reduced-motion branch is an
// instant state change, never a removal.

const REDUCE = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The six pages, in the recordings' own order, with their captions verbatim. */
const PAGES = [
  { key: 'roll',    text: 'Roll your dice at the start of each turn' },
  { key: 'hold',    text: 'Tap on the dice you wish to save.\nEach turn you can roll the dice 3 times' },
  { key: 'commit',  text: 'Tap the combo box you wish to submit and press <b>Play</b>' },
  { key: 'once',    text: 'You can only use each combo once per game' },
  { key: 'learn',   text: 'Learn about each combo by pressing its symbol on the board' },
  { key: 'bonus',   text: 'Score 63 or higher on the left column to earn 35 bonus points!' },
];

/* ---------- the little board the illustration animates ---------------------------------------
 * Drawn at a fixed 200x244 and scaled by CSS to whatever the salmon panel is. Every part an
 * animation touches carries a data- attribute so the timelines below never depend on DOM order. */
const DIE_PIPS = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};
const pipsSvg = (n, cls) => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">`
  + DIE_PIPS[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11"/>`).join('') + '</svg>';

// The seven lower-section tiles, as they read on our own scorecard.
const COMBO_TILES = [
  { key: 'threeKind',    label: '3x' },
  { key: 'fourKind',     label: '4x' },
  { key: 'fullHouse',    label: '⌂' },
  { key: 'smallStraight', label: 'SM' },
  { key: 'largeStraight', label: 'LG' },
  { key: 'yahtzee',      label: '★' },
  { key: 'chance',       label: '?' },
];

// What a long-press on each symbol says. Same text the real game's combo popover uses
// (yz-combo-info in ui.js) -- one source would be better, but this module must stay loadable
// on its own, so they are kept deliberately identical and short.
const COMBO_INFO = [
  { label: '4x', name: '4 of a kind', score: 'Score: sum of all dice' },
  { label: 'LG', name: 'Sequence of 5', score: 'Score: 40' },
  { label: '★', name: 'Yahtzee', score: 'Score: 50' },
];

function boardHtml() {
  let h = '<div class="yz-ht-board" data-role="board">';
  h += '<div class="yz-ht-card2">';
  // upper section: six die faces, each with a score slot
  for (let i = 1; i <= 6; i++) {
    const top = 6 + (i - 1) * 21;
    h += `<div class="yz-ht-r" style="top:${top}px">`
      + `<span class="yz-ht-face">${pipsSvg(i, 'yz-ht-pips')}</span>`
      + `<span class="yz-ht-slot" data-up="${i}"></span>`
      + `</div>`;
  }
  // the section bonus, in the empty cell under the upper column - exactly where our own
  // scorecard now shows it, so the tutorial points at a real place on the real board
  h += `<div class="yz-ht-bonusrow" data-role="bonusrow">`
    + `<span class="yz-ht-bonuslab">SECTION<br>BONUS</span>`
    + `<span class="yz-ht-bonusval" data-role="bonusval">+35</span>`
    + `<span class="yz-ht-bonusprog" data-role="bonusprog">0/63</span>`
    + `</div>`;
  // lower section: seven combo tiles, each with a score slot
  COMBO_TILES.forEach((c, idx) => {
    const top = 6 + idx * 21;
    h += `<div class="yz-ht-r yz-ht-r2" style="top:${top}px">`
      + `<span class="yz-ht-tile" data-tile="${c.key}">${c.label}</span>`
      + `<span class="yz-ht-slot" data-lo="${c.key}"></span>`
      + `</div>`;
  });
  h += '</div>';                                   // .yz-ht-card2
  // the dice tray
  h += '<div class="yz-ht-tray">';
  for (let i = 0; i < 5; i++) h += `<span class="yz-ht-die" data-die="${i}"></span>`;
  h += '</div>';
  // the two buttons
  h += '<div class="yz-ht-roll" data-role="roll">ROLL'
    + '<i class="yz-ht-pip" data-pip="1">1</i><i class="yz-ht-pip" data-pip="2">2</i><i class="yz-ht-pip" data-pip="3">3</i>'
    + '</div>';
  h += '<div class="yz-ht-play" data-role="play">PLAY</div>';
  // the things only some pages use
  h += '<div class="yz-ht-dim" data-role="dim"></div>';
  h += '<div class="yz-ht-tip" data-role="tip"><b data-role="tipname"></b><span data-role="tipscore"></span></div>';
  h += '<div class="yz-ht-arrow" data-role="arrow">↑</div>';
  h += '<div class="yz-ht-hand" data-role="hand">'
    + '<svg viewBox="0 0 48 60" aria-hidden="true">'
    + '<path d="M17 30V10a5 5 0 0 1 10 0v14m0-4a4.5 4.5 0 0 1 9 0v6m0-3a4.5 4.5 0 0 1 9 0v14c0 12-8 20-19 20-8 0-12-3-16-10L4 38c-2-4 3-8 6-4l7 8" '
    + 'fill="#FBE0C0" stroke="#8A5A2B" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
    + '</svg></div>';
  h += '</div>';
  return h;
}

export function howToHtml() {
  return `
  <div class="yz-ht-scrim" data-role="howto" hidden>
    <div class="yz-ht-modal" role="dialog" aria-modal="true" aria-label="How to play">
      <div class="yz-ht-title">HOW TO PLAY</div>
      <div class="yz-ht-card">
        <div class="yz-ht-panel">${boardHtml()}</div>
        <p class="yz-ht-caption" data-role="caption"></p>
      </div>
      <div class="yz-ht-dots" data-role="dots">
        ${PAGES.map((_, i) => `<i data-dot="${i}"></i>`).join('')}
      </div>
      <div class="yz-ht-nav">
        <button type="button" class="yz-ht-sq" data-action="ht-first" aria-label="First page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M20 5l-9 7 9 7z"/></svg>
        </button>
        <button type="button" class="yz-ht-ok" data-action="ht-close">OK</button>
        <button type="button" class="yz-ht-sq" data-action="ht-next" aria-label="Next page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M4 5l9 7-9 7z"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

/** One carousel instance. `root` is the game's own root element (never document). */
export function createHowTo(root) {
  const scrim = root.querySelector('[data-role="howto"]');
  if (!scrim) return null;
  const q = (sel) => scrim.querySelector(sel);
  const board = q('[data-role="board"]');
  const hand = q('[data-role="hand"]');
  const caption = q('[data-role="caption"]');
  const dots = [...scrim.querySelectorAll('[data-dot]')];
  const btnFirst = q('[data-action="ht-first"]');
  const btnNext = q('[data-action="ht-next"]');

  let page = 0;
  let timers = [];
  let open = false;

  /** The board is authored at a fixed 200x244 so every coordinate in the timelines is stable.
   *  This is the one place it becomes phone-sized. Re-run on open and on any real resize. */
  function fit() {
    const panel = scrim.querySelector('.yz-ht-panel');
    if (!panel || !panel.clientWidth) return;
    board.style.transform = `scale(${panel.clientWidth / 200})`;
  }

  const after = (ms, fn) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  /* ---- primitives the timelines are built from ---- */
  const el = (sel) => board.querySelector(sel);
  const setDie = (i, v) => {
    const d = el(`[data-die="${i}"]`);
    d.innerHTML = v ? pipsSvg(v, 'yz-ht-pips') : '';
    d.classList.toggle('yz-ht-empty', !v);
  };
  const holdDie = (i, on) => el(`[data-die="${i}"]`).classList.toggle('yz-ht-held', !!on);
  const setSlot = (sel, text, cls) => {
    const s = el(sel);
    s.textContent = text == null ? '' : String(text);
    s.className = 'yz-ht-slot' + (cls ? ' ' + cls : '');
  };
  /** Move the hand to an element's centre; `press` adds the tap squash. */
  const handTo = (sel, press) => {
    const t = el(sel);
    if (!t) return;
    const b = t.getBoundingClientRect(), p = board.getBoundingClientRect();
    const scale = p.width / 200 || 1;                       // the board is drawn at 200 wide
    hand.style.opacity = '1';
    hand.style.transform = `translate(${(b.left - p.left + b.width * 0.5) / scale}px,`
      + `${(b.top - p.top + b.height * 0.55) / scale}px) scale(${press ? 0.86 : 1})`;
  };
  const hideHand = () => { hand.style.opacity = '0'; };
  const litPips = (n) => [1, 2, 3].forEach((i) =>
    el(`[data-pip="${i}"]`).classList.toggle('yz-ht-pip-on', i <= n));

  /** Wipe every page-specific mark so a page always starts from the same board. */
  function resetBoard() {
    for (let i = 1; i <= 6; i++) setSlot(`[data-up="${i}"]`, '');
    COMBO_TILES.forEach((c) => setSlot(`[data-lo="${c.key}"]`, ''));
    for (let i = 0; i < 5; i++) { setDie(i, 0); holdDie(i, false); }
    litPips(0);
    el('[data-role="play"]').classList.remove('yz-ht-on');
    el('[data-role="dim"]').classList.remove('yz-ht-show');
    el('[data-role="tip"]').classList.remove('yz-ht-show');
    el('[data-role="arrow"]').classList.remove('yz-ht-show');
    el('[data-role="bonusrow"]').classList.remove('yz-ht-earned');
    el('[data-role="bonusprog"]').textContent = '0/63';
    board.querySelectorAll('[data-tile]').forEach((t) => t.classList.remove('yz-ht-used'));
    hideHand();
  }

  /* ---- the six timelines, one per recording ---- */
  const D = [5, 3, 4, 2, 1, 6];        // the roll the illustration always shows

  const TIMELINES = {
    // 1. hand comes in, taps ROLL, five dice appear
    roll(loop) {
      resetBoard();
      after(300, () => handTo('[data-role="roll"]'));
      after(900, () => handTo('[data-role="roll"]', true));
      after(1050, () => {
        litPips(1);
        [0, 1, 2, 3, 4].forEach((i) => after(i * 70, () => setDie(i, D[i])));
      });
      after(1500, () => handTo('[data-role="roll"]'));
      after(2100, hideHand);
      after(3000, loop);
    },
    // 2. taps two dice (they go gold), then ROLL: only the others change
    hold(loop) {
      resetBoard();
      [0, 1, 2, 3, 4].forEach((i) => setDie(i, D[i]));
      litPips(1);
      after(300, () => handTo('[data-die="0"]'));
      after(800, () => { handTo('[data-die="0"]', true); holdDie(0, true); });
      after(1100, () => handTo('[data-die="3"]'));
      after(1500, () => { handTo('[data-die="3"]', true); holdDie(3, true); });
      after(1900, () => handTo('[data-role="roll"]'));
      after(2400, () => {
        handTo('[data-role="roll"]', true);
        litPips(2);
        [1, 2, 4].forEach((i, n) => after(n * 70, () => setDie(i, 1 + ((D[i] + 2) % 6))));
      });
      after(2900, () => handTo('[data-role="roll"]'));
      after(3400, hideHand);
      after(4300, loop);
    },
    // 3. taps a combo box (PLAY lights green), then taps PLAY
    commit(loop) {
      resetBoard();
      [0, 1, 2, 3, 4].forEach((i) => setDie(i, [4, 4, 4, 4, 2][i]));
      litPips(2);
      after(400, () => handTo('[data-tile="fourKind"]'));
      after(950, () => {
        handTo('[data-tile="fourKind"]', true);
        setSlot('[data-lo="fourKind"]', 18, 'yz-ht-pick');
        el('[data-role="play"]').classList.add('yz-ht-on');
      });
      after(1500, () => handTo('[data-role="play"]'));
      after(2000, () => {
        handTo('[data-role="play"]', true);
        setSlot('[data-lo="fourKind"]', 18, 'yz-ht-done');
        el('[data-role="play"]').classList.remove('yz-ht-on');
        for (let i = 0; i < 5; i++) setDie(i, 0);
        litPips(0);
      });
      after(2500, () => handTo('[data-role="play"]'));
      after(3000, hideHand);
      after(4000, loop);
    },
    // 4. a used combo, with an arrow pointing at it
    once(loop) {
      resetBoard();
      setSlot('[data-lo="fourKind"]', 18, 'yz-ht-done');
      el('[data-tile="fourKind"]').classList.add('yz-ht-used');
      const a = el('[data-role="arrow"]'), t = el('[data-tile="fourKind"]');
      const b = t.getBoundingClientRect(), p = board.getBoundingClientRect();
      const scale = p.width / 200 || 1;
      a.style.left = `${(b.left - p.left + b.width * 0.5) / scale - 6}px`;
      a.style.top = `${(b.bottom - p.top) / scale + 1}px`;
      after(500, () => a.classList.add('yz-ht-show'));
      after(2600, () => a.classList.remove('yz-ht-show'));
      after(3400, loop);
    },
    // 5. press a symbol: the board dims and a tooltip names the combo
    learn(loop) {
      resetBoard();
      [0, 1, 2, 3, 4].forEach((i) => setDie(i, D[i]));
      let step = 0;
      const show = () => {
        const info = COMBO_INFO[step % COMBO_INFO.length];
        const tile = board.querySelector(`[data-tile="${COMBO_TILES.find((c) => c.label === info.label).key}"]`);
        handTo(`[data-tile="${tile.dataset.tile}"]`);
        after(450, () => {
          handTo(`[data-tile="${tile.dataset.tile}"]`, true);
          el('[data-role="dim"]').classList.add('yz-ht-show');
          const b = tile.getBoundingClientRect(), p = board.getBoundingClientRect();
          const scale = p.width / 200 || 1;
          const tip = el('[data-role="tip"]');
          tip.querySelector('[data-role="tipname"]').textContent = info.name;
          tip.querySelector('[data-role="tipscore"]').textContent = info.score;
          tip.style.left = `${Math.min(96, (b.left - p.left) / scale - 34)}px`;
          tip.style.top = `${(b.top - p.top) / scale - 2}px`;
          tip.classList.add('yz-ht-show');
        });
        after(1900, () => {
          el('[data-role="dim"]').classList.remove('yz-ht-show');
          el('[data-role="tip"]').classList.remove('yz-ht-show');
          hideHand();
        });
        after(2500, () => { step++; if (step < 3) show(); else loop(); });
      };
      after(300, show);
    },
    // 6. the upper column fills and the bonus counter climbs past 63
    bonus(loop) {
      resetBoard();
      const vals = [5, 8, 12, 16, 15, 12];        // 68 -- comfortably over the line
      let run = 0;
      vals.forEach((v, i) => after(400 + i * 420, () => {
        setSlot(`[data-up="${i + 1}"]`, v, 'yz-ht-done');
        run += v;
        el('[data-role="bonusprog"]').textContent = `${run}/63`;
        if (run >= 63) el('[data-role="bonusrow"]').classList.add('yz-ht-earned');
      }));
      after(400 + vals.length * 420 + 1400, loop);
    },
  };

  /** The still, informative pose for each page when motion is off. */
  const STILLS = {
    roll() { resetBoard(); [0, 1, 2, 3, 4].forEach((i) => setDie(i, D[i])); litPips(1); },
    hold() { STILLS.roll(); holdDie(0, true); holdDie(3, true); litPips(2); },
    commit() {
      resetBoard(); [0, 1, 2, 3, 4].forEach((i) => setDie(i, [4, 4, 4, 4, 2][i]));
      litPips(2); setSlot('[data-lo="fourKind"]', 18, 'yz-ht-pick');
      el('[data-role="play"]').classList.add('yz-ht-on');
    },
    once() {
      resetBoard(); setSlot('[data-lo="fourKind"]', 18, 'yz-ht-done');
      el('[data-tile="fourKind"]').classList.add('yz-ht-used');
      const a = el('[data-role="arrow"]'), t = el('[data-tile="fourKind"]');
      const b = t.getBoundingClientRect(), p = board.getBoundingClientRect();
      const scale = p.width / 200 || 1;
      a.style.left = `${(b.left - p.left + b.width * 0.5) / scale - 6}px`;
      a.style.top = `${(b.bottom - p.top) / scale + 1}px`;
      a.classList.add('yz-ht-show');
    },
    learn() {
      resetBoard(); [0, 1, 2, 3, 4].forEach((i) => setDie(i, D[i]));
      const tile = el('[data-tile="largeStraight"]');
      el('[data-role="dim"]').classList.add('yz-ht-show');
      const b = tile.getBoundingClientRect(), p = board.getBoundingClientRect();
      const scale = p.width / 200 || 1;
      const tip = el('[data-role="tip"]');
      tip.querySelector('[data-role="tipname"]').textContent = 'Sequence of 5';
      tip.querySelector('[data-role="tipscore"]').textContent = 'Score: 40';
      tip.style.left = `${Math.min(96, (b.left - p.left) / scale - 34)}px`;
      tip.style.top = `${(b.top - p.top) / scale - 2}px`;
      tip.classList.add('yz-ht-show');
    },
    bonus() {
      resetBoard();
      const vals = [5, 8, 12, 16, 15, 12];
      vals.forEach((v, i) => setSlot(`[data-up="${i + 1}"]`, v, 'yz-ht-done'));
      el('[data-role="bonusprog"]').textContent = '68/63';
      el('[data-role="bonusrow"]').classList.add('yz-ht-earned');
    },
  };

  function play() {
    clearTimers();
    const key = PAGES[page].key;
    if (REDUCE()) { STILLS[key](); return; }
    const loop = () => { if (open) play(); };
    TIMELINES[key](loop);
  }

  function render() {
    caption.innerHTML = PAGES[page].text.replace(/\n/g, '<br>');
    dots.forEach((d, i) => d.classList.toggle('yz-ht-dot-on', i === page));
    btnFirst.classList.toggle('yz-ht-off', page === 0);
    btnFirst.disabled = page === 0;
    btnNext.classList.toggle('yz-ht-off', page === PAGES.length - 1);
    btnNext.disabled = page === PAGES.length - 1;
    play();
  }

  return {
    open(startAt) {
      page = Math.min(Math.max(startAt || 0, 0), PAGES.length - 1);
      open = true;
      scrim.hidden = false;
      // one frame, so the panel has a real width before fit()/handTo() measure against it
      requestAnimationFrame(() => { fit(); render(); });
    },
    close() { open = false; clearTimers(); scrim.hidden = true; },
    next() { if (page < PAGES.length - 1) { page++; render(); } },
    first() { if (page > 0) { page = 0; render(); } },
    isOpen() { return open; },
    /** Called from the game's own onViewportResize subscription -- never a raw resize listener
     *  here (js/viewport.js owns that; see the root CLAUDE.md's "USE WHAT EXISTS" table). */
    refit() { if (open) { fit(); play(); } },
    destroy() { open = false; clearTimers(); },
  };
}

export default { howToHtml, createHowTo };
