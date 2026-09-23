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

let base = {};   // counts captured when a step opens, so "you added one" means one more than then

const STEPS = [
  { at: '#he-setup-name', say: 'Welcome! This is a practice course, so try anything. First, type a name for your course.',
    done: () => { const e = document.querySelector('#he-setup-name'); return e && e.value.trim().length > 0; }, wait: 900 },
  { at: '#he-setup-looks', say: 'Pick a terrain. It sets the colours, the water and the trees.' },
  { at: '#he-setup-go', say: 'Click Start designing.', done: () => !document.getElementById('he-setup') },
  { at: '#he-palette', side: 'right', say: 'These are the things you can add. Click the arrows on a heading to fold a group away.' },
  { at: '.he-tile[data-item="bunker-fairway"]', side: 'right', say: 'Click the Fairway bunker to pick it.',
    open: 'Sand', done: () => !!document.querySelector('.he-tile.is-on[data-item="bunker-fairway"]') },
  { at: '#he-canvas', side: 'left', say: 'Now click on the hole, where you want the bunker.',
    open: null, start: () => { base.bunkers = count('bunkers'); }, done: () => count('bunkers') > base.bunkers },
  { at: '#he-context', side: 'left', say: 'Its settings show up here. Try the size sliders.' },
  { at: '#he-canvas', side: 'left', say: 'Drag the bunker to move it. Press Delete to remove it, or D to make a copy.' },
  { at: '.he-tile[data-item^="tree-"]', side: 'right', say: 'Trees work the same way: pick one here, then click the hole.',
    open: 'Trees & rocks/Trees', start: () => { base.trees = count('trees'); }, done: () => count('trees') > base.trees },
  { at: '[data-tool="route"]', side: 'below', say: 'Route: drag the white dots to bend the hole. Drag the flag end to make it longer or shorter.' },
  { at: '[data-tool="green"]', side: 'below', say: 'Green: its shape, its size and where the pins go.' },
  { at: '[data-tool="select"]', side: 'below', say: 'Select: click anything on the hole to change it.' },
  { at: '#he-strip-toggle', side: 'above', say: 'Every hole of your course is along the bottom. Click one to work on it, or hide the bar for more room.' },
  { at: '#he-validate', side: 'below', say: 'Validate checks the hole for problems.' },
  { at: '#he-play', side: 'below', say: 'Play opens your course in the real game so you can try it.' },
  { at: '#he-course-btn', side: 'below', say: 'Change the name or terrain here any time.' },
  { at: null, say: 'That is everything. Your real course saves by itself as you go. Ready to build one?', last: true },
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
    .tr-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-weight: 500; font-size: 13px; }
    .tr-row .tr-n { margin-right: auto; opacity: .7; }
    .tr-btn { all: unset; cursor: pointer; background: #1b1d14; color: #ffce3a; border-radius: 999px; padding: 5px 14px; font-weight: 700; font-size: 14px; }
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
  const st = STEPS[i];
  doneAt = 0;
  if (st.open) openFold(st.open);
  if (st.start) st.start();
  const t = st.at && document.querySelector(st.at);
  if (t) t.scrollIntoView({ block: 'nearest' });
  els.tip.innerHTML = `
    <div>${st.say}</div>
    <div class="tr-row">
      <span class="tr-n">${i + 1} of ${STEPS.length}</span>
      ${i > 0 ? '<button class="tr-btn tr-btn--ghost" data-go="back">Back</button>' : ''}
      ${st.last
    ? '<a class="tr-btn" href="./?course=new">Start my course</a>'
    : st.done ? '<span class="tr-ok" data-ok hidden>Nice!</span><button class="tr-btn tr-btn--ghost" data-go="next">Skip</button>'
      : '<button class="tr-btn" data-go="next">Next</button>'}
      <button class="tr-btn tr-btn--ghost" data-go="exit" title="End the tour">&times;</button>
    </div>`;
  els.tip.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const g = b.dataset.go;
    if (g === 'next') show(i + 1); else if (g === 'back') show(i - 1); else stop();
  }));
  place();
}

function place() {
  const st = STEPS[i];
  const t = st.at && document.querySelector(st.at);
  const { ring, tip } = els;
  if (!t || !visible(st.at)) {
    ring.style.display = 'none';
    tip.dataset.side = '';
    tip.style.left = `${(innerWidth - 300) / 2}px`; tip.style.top = `${innerHeight / 2 - 60}px`;
    return;
  }
  const r = t.getBoundingClientRect();
  ring.style.display = '';
  Object.assign(ring.style, { left: `${r.left - 5}px`, top: `${r.top - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
  const tw = 300; const th = tip.offsetHeight || 110; const gap = 20;
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
  tip.dataset.side = side === 'inside' ? '' : side;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}

function tick() {
  if (!els) return;
  const st = STEPS[i];
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

export function startTour() {
  if (els) return;
  els = build();
  // The setup screen opens on its own on a fresh practice course; give it a moment to paint.
  setTimeout(() => { show(0); timer = setInterval(tick, 200); }, 350);
}
