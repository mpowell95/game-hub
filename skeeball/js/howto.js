// skeeball/js/howto.js - Skeeball's HOW TO PLAY carousel.
//
// THIS FILE EXISTS BECAUSE THE FIRST ONE WAS WRONG. Skeeball originally shipped a static sheet of
// bullet points with a line-art SVG. Matt, 2026-08-11: "You ignored the How To Play instructions
// again. Yours is dogshit." He was right twice over - the repo has an established pattern for this
// screen and that build did not follow it, while a comment in it claimed it did.
//
// The pattern is `yahtzee/js/howto.js` (itself cloned from Matt's own recordings), documented in
// `tic-tac-toe/CLAUDE.md`. Read one of those before changing this. The shape, top to bottom:
//
//   dark rounded modal
//     HOW TO PLAY               white, bold, wide-tracked caps
//     white card
//       tinted panel            the animated illustration
//       caption                 1-3 lines
//     dots                      one per page, current one filled
//     [|<-]  [ OK ]  [->|]      the end arrows grey out at each end
//
// WHAT THE ILLUSTRATION IS. Not a diagram of a skeeball table: the REAL machine, painted by
// render.js at a small scale, with a real ball animated along the path `game.js` would actually
// resolve. Every page's throw is run through `resolveThrow`, so the tutorial cannot teach a shot
// the engine would score differently - the same reason the in-game aim guide shares the engine's
// fold maths rather than copying it.
//
// Reduced motion: every page still SHOWS its final, informative pose - the ball in the cup, the
// diagonal landed in the 100, the badge on its target. Nothing is hidden and nothing loops. That
// is the repo's standing rule: a reduced-motion branch is an instant state change, never a
// removal.

import { makeT } from '../../js/i18n.js';
import { STRINGS } from './strings.js';
import { resolveThrow, idealThrow, BALLS_PER_RACK } from './game.js';
import { boardById, nextBoard, DEFAULT_BOARD } from './boards.js';
import * as R from './render.js';

const t = makeT(STRINGS);

const REDUCE = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The pages, in teaching order: how to throw, then what the throw controls, then the extras. */
const PAGES = ['flick', 'power', 'aim', 'badge', 'rack'];

/** How much of the design box each page frames. The throwing pages need the lane; the ones about
 *  the board itself are better off close in on the cups. */
// 'rack' needs the WHOLE cabinet: its illustration is the ball rack beside the lane, which
// lives at the bottom of the design box and is simply not in a 0.62 crop.
const FRAME = { flick: 1.0, power: 1.0, aim: 1.0, badge: 0.62, rack: 1.0 };

export function howToHtml() {
  return `
    <div class="sk-ht-scrim" hidden>
      <div class="sk-ht" role="dialog" aria-modal="true" aria-label="${t('ht_title')}">
        <h2 class="sk-ht-title">${t('ht_title')}</h2>
        <div class="sk-ht-card">
          <div class="sk-ht-panel">
            <canvas class="sk-ht-canvas" data-role="art"></canvas>
            <svg class="sk-ht-hand" data-role="hand" viewBox="0 0 40 52" aria-hidden="true">
              <path d="M14 50 C6 42 4 34 5 27 c1-4 6-4 7 0 l1 4 V8 c0-5 7-5 7 0 v12 V6 c0-5 7-5 7 0
                       v14 V11 c0-5 7-5 7 0 v22 c0 9-4 17-9 17 z"
                    fill="#fff" stroke="#2b2b2b" stroke-width="2.4" stroke-linejoin="round"/>
            </svg>
          </div>
          <p class="sk-ht-caption" data-role="caption"></p>
        </div>
        <div class="sk-ht-dots" data-role="dots">
          ${PAGES.map((p, i) => `<span class="sk-ht-dot${i === 0 ? ' is-on' : ''}"></span>`).join('')}
        </div>
        <div class="sk-ht-foot">
          <button type="button" class="sk-ht-btn sk-ht-end" data-role="first" aria-label="${t('ht_first')}">|◀</button>
          <button type="button" class="sk-ht-btn sk-ht-ok" data-role="close">${t('ht_ok')}</button>
          <button type="button" class="sk-ht-btn sk-ht-end" data-role="next" aria-label="${t('ht_next')}">▶|</button>
        </div>
      </div>
    </div>`;
}

/**
 * Wire up the sheet inside `host` (which must already contain howToHtml()).
 * Returns the same small control surface Yahtzee's does, so a caller can treat them alike.
 */
export function createHowTo(host, boardId) {
  const scrim = host.querySelector('.sk-ht-scrim');
  const cv = host.querySelector('[data-role="art"]');
  const hand = host.querySelector('[data-role="hand"]');
  const caption = host.querySelector('[data-role="caption"]');
  const dots = [...host.querySelectorAll('.sk-ht-dot')];
  const btnFirst = host.querySelector('[data-role="first"]');
  const btnNext = host.querySelector('[data-role="next"]');

  const board = boardById(boardId || DEFAULT_BOARD);
  let page = 0;
  let isOpen = false;
  let raf = 0;
  let t0 = 0;

  /** Size the canvas to its panel at real pixel density. A canvas sized only in CSS goes soft,
   *  and this one is showing fine cabinet detail at a quarter scale. */
  function fit() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }

  /** Put the design-space box for this page onto the canvas, and return the transform so the hand
   *  overlay can be positioned in the same coordinates. */
  function frame(c) {
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const showH = R.DH * FRAME[PAGES[page]];
    const scale = Math.min(w / R.DW, h / showH);
    const ox = (w - R.DW * scale) / 2;
    const oy = (h - showH * scale) / 2;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.save();
    c.beginPath(); c.rect(0, 0, w, h); c.clip();
    c.translate(ox, oy);
    c.scale(scale, scale);
    return { scale, ox, oy };
  }

  /** Design-space point -> panel CSS pixels, for placing the hand. */
  const toPanel = (tf, x, y) => ({ x: tf.ox + x * tf.scale, y: tf.oy + y * tf.scale });

  function showHand(tf, at, pressed) {
    if (!at) { hand.style.opacity = '0'; return; }
    const p = toPanel(tf, at.x, at.y);
    hand.style.opacity = '1';
    hand.style.transform = `translate(${p.x - 9}px, ${p.y - 4}px) scale(${pressed ? 0.86 : 1})`;
  }

  /**
   * One page's frame. `u` is 0..1 through the page's own loop.
   *
   * Every throw here is resolved by the ENGINE and then drawn from the result, so a page can
   * never demonstrate a shot the game would score differently.
   */
  function paint(u) {
    const c = cv.getContext('2d');
    const tf = frame(c);
    R.drawMachine(c, board);
    R.drawMarquee(c, board, [
      { label: t('ball'), value: String(BALLS_PER_RACK) },
      { label: t('score'), value: '0' },
    ]);

    const key = PAGES[page];
    const still = REDUCE();
    let handAt = null, pressed = false;

    // A throw travelling up the lane and settling on the board, drawn from a resolved result.
    const throwAt = (power, aim, k) => {
      const out = resolveThrow(power, aim, board);
      const kk = Math.max(0, Math.min(1, k));
      if (kk < 0.72) {
        const v = kk / 0.72;
        let off = out.offset * v;
        const q = R.lanePoint(v, off);
        R.drawBall(c, q.x, q.y, q.r);
      } else {
        const land = R.boardPoint(out.x, Math.min(0.97, out.y));
        const from = R.lanePoint(1, out.offset);
        const v = (kk - 0.72) / 0.28;
        R.drawBall(c, from.x + (land.x - from.x) * v, from.y + (land.y - from.y) * v,
          R.lanePoint(1, 0).r * (1 - v * 0.25));
      }
      return out;
    };

    if (key === 'flick') {
      // Hand at the foul line, flicks up, ball rolls into a cup.
      const { power, aim } = idealThrow('30', board);
      const start = R.lanePoint(0.06, 0);
      if (still) {
        throwAt(power, aim, 1);
        handAt = null;
      } else if (u < 0.16) {
        handAt = start; pressed = true;
      } else if (u < 0.34) {
        const k = (u - 0.16) / 0.18;
        handAt = { x: start.x, y: start.y - (0.30 * R.DH) * k }; pressed = true;
        R.drawAimGuide(c, 0);
      } else {
        throwAt(power, aim, (u - 0.34) / 0.5);
      }
    } else if (key === 'power') {
      // The same straight throw at three strengths: the 20, the 40, and over the back.
      const seq = [idealThrow('20', board).power, idealThrow('40', board).power, 1];
      const slot = Math.min(2, Math.floor(u * 3));
      const inner = still ? 1 : (u * 3) % 1;
      const out = throwAt(seq[still ? 1 : slot], 0, still ? 1 : inner);
      if (inner > 0.92 || still) {
        const at = out.kind === 'over'
          ? R.boardPoint(0, 1)
          : R.boardPoint(out.x, Math.min(0.97, out.y));
        R.drawPopup(c, at, out.kind === 'over' ? t('too_hard') : `+${out.points}`, 0.4);
      }
    } else if (key === 'aim') {
      // A deliberate diagonal into a 100.
      const { power, aim } = idealThrow('100R', board);
      if (still) {
        const out = throwAt(power, aim, 1);
        R.drawPopup(c, R.boardPoint(out.x, Math.min(0.97, out.y)), `+${out.points}`, 0.4);
      } else if (u < 0.30) {
        const k = u / 0.30;
        const s = R.lanePoint(0.06, 0);
        handAt = { x: s.x + aim * 0.20 * R.DW * k, y: s.y - 0.22 * R.DH * k }; pressed = true;
        R.drawAimGuide(c, aim);
      } else {
        const out = throwAt(power, aim, (u - 0.30) / 0.55);
        if (u > 0.86) R.drawPopup(c, R.boardPoint(out.x, Math.min(0.97, out.y)), `+${out.points}`, 0.4);
      }
    } else if (key === 'badge') {
      // The roaming x3, and what it pays.
      const ids = board.targets.filter((x) => x.kind !== 'ring').map((x) => x.id);
      const id = still ? '40' : ids[Math.floor(u * ids.length) % ids.length];
      const tgt = board.targets.find((x) => x.id === id);
      // Popup FIRST, badge over it. The other order buries the badge under the burst it is
      // supposed to be explaining, on the one page whose whole subject is the badge.
      if (still || u % (1 / ids.length) > (1 / ids.length) * 0.62) {
        R.drawPopup(c, R.boardPoint(tgt.x, tgt.y - 0.16), `+${tgt.points * 3}`, 0.4);
      }
      R.drawMultiplier(c, board, id, 0.5 + 0.5 * Math.sin(u * Math.PI * 6));
    } else if (key === 'rack') {
      const left = still ? BALLS_PER_RACK : Math.max(1, BALLS_PER_RACK - Math.floor(u * BALLS_PER_RACK));
      R.drawQueue(c, left);
      const nxt = nextBoard(board.id);
      if (nxt) {
        c.save();
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `800 ${Math.round(0.052 * R.DW)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
        const msg = t('unlock_progress', { n: nxt.unlockScore, board: t(nxt.nameKey) });
        const my = 0.885 * R.DH;
        // On a plate: it sits over the lane and, at the left edge, over the ball rack.
        const mw = c.measureText(msg).width + 0.06 * R.DW;
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.beginPath(); c.roundRect(R.DW / 2 - mw / 2, my - 0.026 * R.DH, mw, 0.052 * R.DH, 0.026 * R.DH);
        c.fill();
        c.fillStyle = '#FFE45C';
        c.fillText(msg, R.DW / 2, my);
        c.restore();
      }
    }

    c.restore();
    showHand(tf, handAt, pressed);
  }

  const LOOP_MS = { flick: 3600, power: 5400, aim: 4200, badge: 4800, rack: 3600 };

  function tick(now) {
    if (!isOpen) return;
    if (!t0) t0 = now;
    const span = LOOP_MS[PAGES[page]];
    paint(REDUCE() ? 1 : ((now - t0) % span) / span);
    raf = requestAnimationFrame(tick);
  }

  function render() {
    caption.innerHTML = t('ht_' + PAGES[page]).replace(/\n/g, '<br>');
    dots.forEach((d, i) => d.classList.toggle('is-on', i === page));
    btnFirst.disabled = page === 0;
    btnFirst.classList.toggle('is-off', page === 0);
    btnNext.disabled = page === PAGES.length - 1;
    btnNext.classList.toggle('is-off', page === PAGES.length - 1);
    t0 = 0;
    if (REDUCE()) { fit(); paint(1); return; }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  // Swipe between pages as well as the arrows: this is a carousel, and a carousel you can only
  // step with buttons is a slideshow.
  let sx = null;
  scrim.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  scrim.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) < 40) return;
    const n = page + (dx < 0 ? 1 : -1);
    if (n >= 0 && n < PAGES.length) { page = n; render(); }
  }, { passive: true });

  return {
    open(startAt) {
      page = Math.min(Math.max(startAt || 0, 0), PAGES.length - 1);
      isOpen = true;
      scrim.hidden = false;
      // One frame first, so the panel has a real width before fit() measures against it.
      requestAnimationFrame(() => { fit(); render(); });
    },
    close() { isOpen = false; cancelAnimationFrame(raf); scrim.hidden = true; },
    next() { if (page < PAGES.length - 1) { page++; render(); } },
    first() { if (page > 0) { page = 0; render(); } },
    isOpen() { return isOpen; },
    /** Called from the game's own onViewportResize subscription - never a raw resize listener
     *  here (js/viewport.js owns that; root CLAUDE.md's "USE WHAT EXISTS" table). */
    refit() { if (isOpen) { fit(); render(); } },
    destroy() { isOpen = false; cancelAnimationFrame(raf); },
  };
}

export default { howToHtml, createHowTo, PAGES };
