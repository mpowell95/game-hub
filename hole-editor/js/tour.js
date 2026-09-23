// hole-editor/js/tour.js - THE GUIDED PRACTICE RUN (2026-09-23).
//
// Matt: "there's way too much text on the Help page. The Help page, instead, should be a test (or
// fakeish) version of the tool, that has arrows and pop ups." So Help opens the REAL editor on a
// throwaway course (`?course=tutorial`, course.js: its own storage key, wiped on open, never sent
// to the cloud) and this module walks over it: a ring round the thing to use, an arrow, one short
// sentence. A step with `done` moves on by itself when the player has actually done it; the rest
// have a Next button. Nothing here changes the editor; it only reads `window.__he` and the DOM.

const he = () => window.__he;
const spec = () => { const h = he(); return h && h.doc.holes[h.currentId] && h.doc.holes[h.currentId].spec; };
const count = (k) => ((spec() || {})[k] || []).length;
const visible = (sel) => { const e = document.querySelector(sel); return !!(e && e.offsetParent !== null); };

// Opened by the first visit's redirect (main.js), in the SAME tab: it ends by going to the real
// course rather than closing a tab.
const FIRST = (() => { try { return new URLSearchParams(location.search).has('first'); } catch { return false; } })();

let base = {};

// ON A PHONE (2026-09-23, stage 4 of docs/HANDOFF-GOLF-COURSE-CREATOR-MOBILE.md) the palette and the
// settings are bottom sheets, most tools live behind Tools, and there is no mouse. A step may carry
// `m: {at, say, start, done, side}`, used instead of its own fields under the phone breakpoint;
// every other step's words have "Click" turned into "Tap". `at` may be a function (the Tools
// button, then the tool inside it once the grid is open).
const PHONE = () => !!(window.__he && window.__he.isPhone && window.__he.isPhone());
const sheet = (w) => { const h = he(); if (h && h.openSheet) h.openSheet(w); };
const ribbonOpen = () => { const r = document.getElementById('he-ribbon'); return !!(r && r.classList.contains('is-open')); };
const viaTools = (sel) => () => (ribbonOpen() ? sel : '#he-m-tools');
// THE PASTEL PHONE (2026-09-23): no Tools grid or + Add sheet any more - a bottom bar of seven
// picture buttons, each with a tray. `viaTray(tab, sel)` points at the button, then at the tile in
// its tray once that is open; `phone(fn)` runs one of main.js's phone helpers.
const phone = (name, ...a) => { const h = he(); if (h && h[name]) h[name](...a); };
const trayIs = (tab) => { const h = he(); return !!(h && h.trayTab === tab); };
const viaTray = (tab, sel) => () => (trayIs(tab) ? sel : `[data-ptab="${tab}"]`);
const tapWords = (s) => s.replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap').replace(/\bclicks\b/g, 'taps');
/** The fields of step `st` for this screen: its phone overrides, when on a phone. */
const pick = (st) => (PHONE() && st.m ? { ...st, ...st.m } : st);
const sel = (st) => (typeof st.at === 'function' ? st.at() : st.at);   // what a step captured when it opened, so "you did it" means "since then"

const clickTool = (id) => { const b = document.querySelector(`[data-tool="${id}"]`); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); };
const toolOn = (id) => { const b = document.querySelector(`[data-tool="${id}"]`); return !!b && b.getAttribute('aria-pressed') === 'true'; };
/** Open a right-hand panel if it is folded, so a step never points at a closed box. */
const openPanel = (key) => { const h = document.querySelector(`[data-panel="${key}"].collapsed .he-panel__head`); if (h) h.click(); };
const lastBunker = () => JSON.stringify((spec() || {}).bunkers ? spec().bunkers[spec().bunkers.length - 1] : null);

// `topic` marks where a Help-menu entry jumps in (main.js lists them).
export const TOPICS = [
  ['name', 'Naming the course and picking a terrain'],
  ['add', 'Adding things to a hole'],
  ['move', 'Changing, moving and deleting things'],
  ['trees', 'Trees'],
  ['route', 'Bending the hole and changing its length'],
  ['green', 'The green and the pins'],
  ['holes', 'Moving between holes'],
  ['check', 'Checking and playing a hole'],
  ['save', 'Saving, and changing the name or terrain later'],
];

const STEPS = [
  { topic: 'name', at: '#he-setup-name', say: 'Welcome! This is a quick practice run on a pretend course, so try anything. First, type a name for your course.',
    done: () => { const e = document.querySelector('#he-setup-name'); return e && e.value.trim().length > 0; }, wait: 900 },
  { at: '#he-setup-looks', say: 'Now pick a terrain. It sets the colours, the water and the trees for the whole course.',
    start: () => { base.picked = false; const l = document.querySelector('#he-setup-looks'); if (l) l.addEventListener('click', () => { base.picked = true; }, { once: true }); },
    done: () => base.picked },
  { at: '#he-setup-go', say: 'Click Start designing.', done: () => !document.getElementById('he-setup') },
  { topic: 'add', at: '#he-palette', side: 'right', say: 'These are the things you can add to a hole. Click a heading (with the arrow) to hide that group, and click it again to show it.',
    m: { at: '#he-pbar', side: 'above', say: 'These buttons along the bottom add things to a hole: trees, sand, water, the green, and the fairway\'s shape. More has everything else.', start: () => { sheet(null); phone('closePhone'); } } },
  { topic: 'move', at: '.he-tile[data-item="bunker-fairway"]', side: 'right', say: 'Click the Fairway bunker to pick it.',
    open: 'Sand', done: () => !!document.querySelector('.he-tile.is-on[data-item="bunker-fairway"]'),
    m: { at: viaTray('sand', '#he-tray [data-item="bunker-fairway"]'), side: 'above', say: 'Tap Sand, then the Fairway bunker.', start: () => sheet(null) } },
  { at: '#he-canvas', side: 'left', say: 'Click anywhere on the hole to add the bunker there.',
    start: () => { base.bunkers = count('bunkers'); }, done: () => count('bunkers') > base.bunkers,
    m: { say: 'Tap anywhere on the hole to add the bunker there.', start: () => { sheet(null); phone('closePhone'); base.bunkers = count('bunkers'); } } },
  { at: '#he-context', side: 'left', say: 'Its settings are here. Try the size sliders.', start: () => openPanel('context'),
    m: { say: 'Its settings are here. Try the size sliders, then tap the × to close them.', start: () => { sheet('edit'); openPanel('context'); phone('openPanelKey', 'context'); } } },
  { at: '#he-canvas', side: 'left', say: 'Now drag the bunker to move it. (Delete removes it, D makes a copy.)',
    start: () => { clickTool('select'); base.b = lastBunker(); }, done: () => lastBunker() !== base.b,
    m: { say: 'Now drag the bunker with one finger to move it. Drag empty grass to move the map, and pinch to zoom.', start: () => { sheet(null); clickTool('select'); base.b = lastBunker(); } } },
  { topic: 'trees', at: '.he-tile[data-item^="tree-"]', side: 'right', say: 'Trees work the same way: pick one here, then click the hole.',
    open: 'Trees & rocks/Trees', start: () => { base.trees = count('trees'); }, done: () => count('trees') > base.trees,
    m: { at: viaTray('trees', '#he-tray [data-item^="tree-"]'), side: 'above', say: 'Trees work the same way: tap Trees, pick one, then tap the hole.', start: () => { sheet(null); base.trees = count('trees'); } } },
  { at: '#he-context', side: 'left', say: 'A tree has settings too: its size, and its height. A tall tree is hard to hit over.', start: () => openPanel('context'),
    m: { start: () => { sheet('edit'); openPanel('context'); phone('openPanelKey', 'context'); } } },
  { topic: 'route', at: '[data-tool="route"]', side: 'below', say: 'Click Route to shape the hole.', done: () => toolOn('route'),
    m: { at: viaTray('fairway', '#he-tray [data-tool-pick="route"]'), side: 'above', say: 'Tap Fairway, then Route, to shape the hole.', start: () => sheet(null) } },
  { at: '#he-canvas', side: 'left', say: 'Drag a white dot to bend the hole. Double-click the middle line to add another dot. Drag the flag end to make the hole longer or shorter.',
    m: { say: 'Drag a white dot to bend the hole. Press and hold on the middle line to add another dot. Drag the flag end to make the hole longer or shorter.', start: () => sheet(null) } },
  { at: '#he-context', side: 'left', say: 'Or use these buttons: a dogleg left or right, an S-bend, or Straighten.', start: () => openPanel('context'),
    m: { start: () => { sheet('edit'); openPanel('context'); phone('openPanelKey', 'context'); } } },
  { topic: 'green', at: '[data-tool="green"]', side: 'below', say: 'Click Green.', done: () => toolOn('green'),
    m: { at: viaTray('green', '#he-tray [data-tool-pick="green"]'), side: 'above', say: 'Tap Green, then Shape, fringe & pins.', start: () => sheet(null) } },
  { at: '#he-context', side: 'left', say: 'Pick the green\'s shape, size and angle, and the fringe round it. Add pins: with several, the game picks one each round.', start: () => openPanel('context'),
    m: { start: () => { sheet('edit'); openPanel('context'); phone('openPanelKey', 'context'); } } },
  { at: '[data-tool="select"]', side: 'below', say: 'Select: click anything on the hole to change it. Drag an empty spot to move around the hole, and scroll to zoom.', start: () => clickTool('select'),
    m: { at: '[data-ptab="move"]', side: 'above', say: 'Move: tap anything on the hole to change it. Drag with one finger to move around, and pinch to zoom.', start: () => { sheet(null); phone('closePhone'); clickTool('select'); } } },
  { topic: 'holes', at: '#he-strip-toggle', side: 'above', say: 'Every hole of your course is along the bottom. Click one to work on it. This button hides the bar for more room.',
    m: { at: '.he-ptop-hole', side: 'below', say: 'Tap the hole name to pick a hole, or use the arrows beside it.', start: () => sheet(null) } },
  { topic: 'check', at: '#he-validate', side: 'below', say: 'Validate checks the hole for problems, like a shape that crosses itself, something off the map, or a pin off the green. Click a problem to jump to it.',
    m: { at: '[data-ptab="more"]', side: 'above', say: 'Check hole (in More) looks for problems, like a shape that crosses itself, something off the map, or a pin off the green. Tap a problem to jump to it.' } },
  { at: '#he-play', side: 'below', say: 'Play opens your course in the real game so you can try it.',
    m: { at: '#he-p-play', side: 'below', say: 'Play opens your course in the real game so you can try it.' } },
  { topic: 'save', at: '#he-course', side: 'left', say: 'Your course saves by itself as you work, on this computer and online under your player code. Open the same link any time and it is all there. Download backup gives you a copy as a file. (The practice course here in Help is the one thing that is not saved.)',
    start: () => { openPanel('course'); const c = document.getElementById('he-course'); if (c) c.scrollIntoView({ block: 'start' }); },
    m: { say: 'Your course saves by itself as you work, on this phone and online under your player code. Open the same link any time and it is all there. (The practice course here in Help is the one thing that is not saved.)',
      start: () => { sheet('edit'); openPanel('course'); phone('openPanelKey', 'course'); const c = document.getElementById('he-course'); if (c) c.scrollIntoView({ block: 'start' }); } } },
  { at: '#he-course-btn', side: 'below', m: { at: '[data-ptab="more"]', side: 'above', start: () => sheet(null), say: 'Name & terrain (in More) renames the course or changes its terrain. Careful: the terrain changes EVERY hole at once. Things you placed yourself stay put, and picking the old terrain again puts it all back.' }, say: 'Click here any time to rename the course or change its terrain. Careful with the terrain: it changes EVERY hole at once, the colours and the woods down each side. Things you placed yourself stay put, and picking the old terrain again puts it all back.' },
  { at: '#he-bug', side: 'below', say: 'Something broken or confusing? Report bug sends it straight to Matt. Add a screenshot if you can.',
    m: { at: '[data-ptab="more"]', side: 'above', say: 'Something broken or confusing? Report bug, in More, sends it straight to Matt. Add a screenshot if you can.' } },
  { at: null, say: 'That is everything! Close this Help tab to go back and start creating your own course. Help, at the top right, brings you back here any time.', sayFirst: 'That is everything! Now start your own course. Help, at the top right, brings this back any time.', last: true,
    m: { say: 'That is everything! Close this Help tab to go back and start creating your own course. Help, in More, brings you back here any time.', sayFirst: 'That is everything! Now start your own course. Help, in More, brings this back any time.' } },
];

let i = 0; let els = null; let timer = 0; let doneAt = 0;

function build() {
  const css = document.createElement('style');
  css.textContent = `
    .tr-ring { position: fixed; z-index: 2000; border: 3px solid #ffce3a; border-radius: 10px; pointer-events: none;
      box-shadow: 0 0 0 4px rgba(255,206,58,.25), 0 0 22px rgba(255,206,58,.55); animation: tr-pulse 1.4s ease-in-out infinite; }
    @keyframes tr-pulse { 50% { box-shadow: 0 0 0 8px rgba(255,206,58,.12), 0 0 30px rgba(255,206,58,.7); } }
    @media (prefers-reduced-motion: reduce) { .tr-ring { animation: none; } }
    .tr-tip { position: fixed; z-index: 2001; width: 300px; background: #ffce3a; color: #1b1d14; border-radius: 12px;
      padding: 14px 16px 12px; font: 600 16px/1.35 system-ui, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.5); }
    .tr-tip::after { content: ''; position: absolute; width: 0; height: 0; border: 11px solid transparent; }
    .tr-tip[data-side="right"]::after { left: -21px; top: var(--ay, 24px); border-right-color: #ffce3a; }
    .tr-tip[data-side="left"]::after { right: -21px; top: var(--ay, 24px); border-left-color: #ffce3a; }
    .tr-tip[data-side="below"]::after { top: -21px; left: var(--ax, 24px); border-bottom-color: #ffce3a; }
    .tr-tip[data-side="above"]::after { bottom: -21px; left: var(--ax, 24px); border-top-color: #ffce3a; }
    .tr-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; font-weight: 500; font-size: 13px; }
    .tr-tip--last { width: 380px; text-align: center; }
    .tr-tip--last .tr-row { justify-content: center; }
    .tr-tip--last .tr-n { display: none; }
    .tr-row .tr-n { margin-right: auto; opacity: .7; white-space: nowrap; }
    .tr-btn { all: unset; cursor: pointer; background: #1b1d14; color: #ffce3a; border-radius: 999px; padding: 6px 16px; font-weight: 700; font-size: 14px; white-space: nowrap; text-decoration: none; }
    .tr-btn--ghost { background: transparent; color: #1b1d14; text-decoration: underline; padding: 5px 6px; }
    .tr-ok { font-weight: 700; color: #1d5e2a; }`;
  document.head.appendChild(css);
  const ring = document.createElement('div'); ring.className = 'tr-ring';
  const tip = document.createElement('div'); tip.className = 'tr-tip'; tip.setAttribute('role', 'dialog');
  document.body.append(ring, tip);
  return { ring, tip };
}

function openFold(key) {
  const h = key && document.querySelector(`[data-fold="${key}"].is-shut`);
  if (h) h.click();
  // A section can be shut above a sub-head too.
  const top = key && key.includes('/') && document.querySelector(`[data-fold="${key.split('/')[0]}"].is-shut`);
  if (top) top.click();
}

function show(n) {
  i = Math.max(0, Math.min(STEPS.length - 1, n));
  const st = pick(STEPS[i]);
  doneAt = 0;
  if (st.open) openFold(st.open);
  if (st.start) st.start();
  const t = sel(st) && document.querySelector(sel(st));
  if (t) t.scrollIntoView({ block: 'nearest' });
  els.tip.classList.toggle('tr-tip--last', !!st.last);
  if (st.last) { try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch { /* per-browser */ } }
  els.tip.innerHTML = `
    <div>${(() => { const w = FIRST && st.sayFirst ? st.sayFirst : st.say; return PHONE() ? tapWords(w) : w; })()}</div>
    <div class="tr-row">
      <span class="tr-n">${i + 1} of ${STEPS.length}</span>
      ${i > 0 ? '<button class="tr-btn tr-btn--ghost" data-go="back">Back</button>' : ''}
      ${st.last
    ? (FIRST ? '<button class="tr-btn" data-go="start">Start my course</button>' : '<button class="tr-btn" data-go="close">Close Help</button>')
    : st.done ? '<span class="tr-ok" data-ok hidden>Nice!</span><button class="tr-btn tr-btn--ghost" data-go="next">Skip</button>'
      : '<button class="tr-btn" data-go="next">Next</button>'}
      <button class="tr-btn tr-btn--ghost" data-go="exit" title="${FIRST ? 'Skip the tour and start my course' : 'End the tour'}">&times;</button>
    </div>`;
  els.tip.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const g = b.dataset.go;
    if (g === 'next') show(i + 1); else if (g === 'back') show(i - 1);
    else if (g === 'start' || (g === 'exit' && FIRST)) location.href = './?course=new';
    else if (g === 'close') {
      // Help opened in its own tab. A browser only lets a page close a tab it opened itself, so
      // if the tab is still here a moment later, go to the real Course Creator instead.
      window.close();
      setTimeout(() => { location.href = './?course=new'; }, 250);
    } else stop();
  }));
  place();
}

function place() {
  const st = pick(STEPS[i]);
  const at = sel(st);
  const t = at && document.querySelector(at);
  const { ring, tip } = els;
  if (PHONE()) tip.style.width = `${Math.min(st.last ? 380 : 300, innerWidth - 24)}px`;
  if (!t || !visible(at)) {
    ring.style.display = 'none';
    tip.dataset.side = '';
    tip.style.left = `${(innerWidth - (tip.offsetWidth || 300)) / 2}px`; tip.style.top = `${innerHeight / 2 - 60}px`;
    return;
  }
  // A tall panel runs past the bottom of its scrolling column: ring only the part you can see.
  const raw = t.getBoundingClientRect();
  const box = (t.closest('.he-right, .he-left, .he-canvas-wrap') || document.documentElement).getBoundingClientRect();
  const top = Math.max(raw.top, box.top); const bottom = Math.min(raw.bottom, box.bottom, innerHeight);
  const r = { left: raw.left, right: raw.right, width: raw.width, top, bottom: Math.max(top + 20, bottom), height: Math.max(20, bottom - top) };
  ring.style.display = '';
  Object.assign(ring.style, { left: `${r.left - 5}px`, top: `${r.top - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
  const tw = tip.offsetWidth || 300; const th = tip.offsetHeight || 110; const gap = 20;
  let side = st.side || (r.right + gap + tw < innerWidth ? 'right' : r.bottom + gap + th < innerHeight ? 'below' : 'left');
  if (side === 'right' && r.right + gap + tw > innerWidth) side = 'left';
  if (side === 'below' && r.bottom + gap + th > innerHeight) side = 'above';
  let x; let y;
  if (side === 'right' || side === 'left') {
    x = side === 'right' ? r.right + gap : r.left - gap - tw;
    // A tall target (the map, a panel): point at a spot near its top third, not its middle.
    const aimY = r.height > 300 ? r.top + Math.min(160, r.height / 3) : r.top + r.height / 2;
    y = Math.max(10, Math.min(innerHeight - th - 10, aimY - 34));
    tip.style.setProperty('--ay', `${Math.max(12, Math.min(th - 34, aimY - y - 11))}px`);
  } else {
    y = side === 'below' ? r.bottom + gap : r.top - gap - th;
    const aimX = r.left + r.width / 2;
    x = Math.max(10, Math.min(innerWidth - tw - 10, aimX - 40));
    tip.style.setProperty('--ax', `${Math.max(12, Math.min(tw - 34, aimX - x - 11))}px`);
  }
  if (side === 'left' && r.width > 400) { x = r.left + r.width - tw - 16; side = 'inside'; }
  // A PHONE has no room beside anything: the pop-up goes above or below its target, or across the
  // top of a target taller than half the screen (the map, a sheet).
  if (PHONE()) {
    x = Math.max(12, Math.min(innerWidth - tw - 12, r.left + r.width / 2 - tw / 2));
    if (r.height > innerHeight * 0.45) { side = 'inside'; y = Math.max(64, r.top + 12); }
    else if ((st.side === 'above' || r.top > innerHeight / 2) && r.top - gap - th > 8) { side = 'above'; y = r.top - gap - th; }
    else { side = 'below'; y = Math.min(innerHeight - th - 8, r.bottom + gap); }
    tip.style.setProperty('--ax', `${Math.max(12, Math.min(tw - 34, r.left + r.width / 2 - x - 11))}px`);
  }
  tip.dataset.side = side === 'inside' ? '' : side;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}

function tick() {
  if (!els) return;
  const st = pick(STEPS[i]);
  if (st.done && st.done()) {
    if (!doneAt) {
      doneAt = performance.now();
      const ok = els.tip.querySelector('[data-ok]'); if (ok) ok.hidden = false;
    } else if (performance.now() - doneAt > (st.wait || 600)) { show(i + 1); return; }
  }
  place();
}

function stop() {
  clearInterval(timer);
  if (els) { els.ring.remove(); els.tip.remove(); }
  els = null;
}

/** Set once the last step is reached; main.js then turns Help into a topic menu. */
export const TOUR_DONE_KEY = 'golf.holeEditor.tourDone.v1';

/** `topic` (from `?topic=` in the URL) jumps straight to that part. Every topic past the setup
 *  screen needs the setup done, so the tour does it for them with a stand-in name. */
export function startTour(topic) {
  if (els) return;
  els = build();
  let at = 0;
  const ti = topic ? STEPS.findIndex((st) => st.topic === topic) : -1;
  if (ti > 0) {
    at = ti;
    const name = document.querySelector('#he-setup-name');
    if (name) {
      name.value = 'Practice';
      const go = document.querySelector('#he-setup-go'); if (go) go.click();
    }
  }
  // The setup screen opens on its own on a fresh practice course; give it a moment to paint.
  setTimeout(() => { show(at); timer = setInterval(tick, 200); }, 350);
}
