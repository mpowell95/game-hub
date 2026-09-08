// golf/js/tutorial.js - THE LESSON. Popups, arrows, and a step machine that watches the real game.
//
// Matt, 2026-09-08: *"It must have popups and arrows and stuff telling the person how to play."*
//
// ============================================================================================
// THE STEPS ARE DATA, THE COACH IS THE ONLY THING THAT TOUCHES THE DOM.
//
// `STEPS` below is a plain array with no DOM in it at all, which is what lets `golf/js/test.js`
// assert the things that actually go wrong with a tutorial without a browser: that every step has
// a string in BOTH languages, that every anchor it points at is a selector the play screen really
// renders, and that every step can be advanced by something (a button or a game event) so the
// lesson can never dead-end on a step nobody can leave.
//
// THE COACH NEVER DRIVES THE GAME. It watches. `ui.js` calls `coach.event(kind)` at the points it
// already had - a tap, a shot fired, a ball settled, a hole holed - and the coach decides whether
// that was the thing the current step was waiting for. It cannot swing, aim, change club, or block
// a control; the worst a bug in here can do is show the wrong card.
//
// WHY NOT DIM THE SCREEN. The obvious spotlight treatment - a dark scrim with a hole cut over the
// control - was tried and is wrong for this game: three of the six steps are about the SWING METER,
// which the player has to read WHILE the needle moves, and a scrim over the course also hides the
// ball and the aim line, which are the other half of what is being taught. So the highlight is a
// ring on the control plus an arrow, and the course stays fully visible throughout.
// ============================================================================================

import { makeT } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);

/** `advance` is what ends a step:
 *    'button'  - the card carries a Got it button (steps that explain rather than ask)
 *    an event  - one of the kinds `ui.js` reports; the step ends when that arrives
 *
 *  `anchor` is a selector INSIDE the play screen. `null` centres the card, which is right for the
 *  opening and closing cards - they are about the hole, not about a control.
 *
 *  `side` is which side of the anchor the card sits on. It is authored rather than computed
 *  because the controls are in fixed corners and a computed side flips about under a keyboard or a
 *  short phone; `_place` still clamps the card inside the screen, so an authored side can never
 *  push it off the edge.
 *
 *  `clear` is the element the card must stay OFF, when that is not the anchor itself. The aim row
 *  and the club row are stacked inside `.gf-bl`, so a card placed above the club row lands squarely
 *  on top of the aim row - measured in a real browser, with the aim buttons showing through the
 *  card. The ring and the arrow still point at `anchor`; only the card is pushed clear. */
export const STEPS = [
  { id: 'welcome', anchor: null, key: 'tut_welcome', advance: 'button' },
  { id: 'aim', anchor: '.gf-aimrow', clear: '.gf-bl', side: 'above', key: 'tut_aim', advance: 'button' },
  { id: 'club', anchor: '.gf-clubrow', clear: '.gf-bl', side: 'above', key: 'tut_club', advance: 'button' },
  { id: 'swing1', anchor: '[data-role="swing"]', clear: '.gf-br', side: 'above', key: 'tut_swing1', advance: 'tap-begin' },
  { id: 'swing2', anchor: '[data-role="meter"]', clear: '.gf-br', side: 'above', key: 'tut_swing2', advance: 'tap-power' },
  { id: 'swing3', anchor: '[data-role="meter"]', clear: '.gf-br', side: 'above', key: 'tut_swing3', advance: 'fire' },
  { id: 'watch', anchor: null, key: 'tut_watch', advance: 'settled' },
  { id: 'putt', anchor: '[data-role="swing"]', clear: '.gf-br', side: 'above', key: 'tut_putt', advance: 'fire' },
  { id: 'holed', anchor: null, key: 'tut_holed', advance: 'holed' },
];

/** Every event kind the coach understands, exported so `golf/js/test.js` can check that each step
 *  waits on one of them (or on its own button) and the lesson cannot strand the player. */
export const EVENTS = ['tap-begin', 'tap-power', 'fire', 'settled', 'holed'];

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Coach {
  /** `root` is the game's own root element - never `document`, so the overlay cannot outlive the
   *  game or leak listeners into the hub. `onFinish` fires once, when the lesson's last card is
   *  dismissed. */
  constructor(root, onFinish) {
    this.root = root;
    this.onFinish = onFinish || (() => {});
    this.i = 0;
    this.el = null;
    this.ringEl = null;
    this.listeners = [];
    this.finished = false;
    this.offViewport = null;
  }

  get step() { return STEPS[this.i] || null; }

  start() { this._render(); }

  /** ONE GAME EVENT.
   *
   *  THE LESSON CAN NEVER BE STRANDED, and getting that wrong is the failure mode that matters
   *  here: a step waiting for an event that has already gone past sits there for ever, and the only
   *  way out is to leave the game. Two real ways that happened, both found by driving the lesson in
   *  a browser rather than by reading it:
   *
   *   1. **The swing can fire itself.** If the needle runs off the bottom of the accuracy bar with
   *      no third tap, `_frame` fires the shot at the worst accuracy the bar can express - a
   *      deliberate rule, older than this file. The `fire` step would never see its tap.
   *   2. **A hole in one skips `settled` entirely.** `_settleShot` returns early when the ball
   *      drops, so the "watch it go" step's event never arrives at all - on the one hole in the
   *      game short enough to ace.
   *
   *  So an event does not have to match the CURRENT step: it matches the FIRST step from here on
   *  that is waiting for it, and the lesson skips to just past that. It only ever moves forward,
   *  and an event nothing ahead is waiting for is ignored, exactly as before. */
  event(kind) {
    if (this.finished) return;
    for (let j = this.i; j < STEPS.length; j++) {
      if (STEPS[j].advance !== kind) continue;
      this.i = j;
      this._next();
      return;
    }
  }

  /** THE STEP ADVANCES EVEN IF ITS ANCHOR HAS GONE. `_enterHole` rebuilds the play screen between
   *  the tee shot and nothing else here, but a re-render mid-lesson would otherwise leave the ring
   *  drawn around an element that is no longer in the document. Called by ui.js after any re-render
   *  of the play screen. */
  refresh() { if (!this.finished) this._render(); }

  _next() {
    this.i += 1;
    if (this.i >= STEPS.length) { this._finish(); return; }
    this._render();
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    this._teardown();
    this.onFinish();
  }

  _teardown() {
    for (const [el, type, fn] of this.listeners) el.removeEventListener(type, fn);
    this.listeners.length = 0;
    if (this.el) { this.el.remove(); this.el = null; }
    if (this.ringEl) { this.ringEl.remove(); this.ringEl = null; }
    if (this.offViewport) { this.offViewport(); this.offViewport = null; }
  }

  destroy() { this.finished = true; this._teardown(); }

  _on(el, type, fn) { el.addEventListener(type, fn); this.listeners.push([el, type, fn]); }

  _render() {
    const s = this.step;
    if (!s) return;
    this._teardown();
    if (!this.root || !this.root.isConnected) return;

    // The ring goes down first so the card, which is appended after it, is always on top of it.
    if (s.anchor) {
      this.ringEl = document.createElement('div');
      this.ringEl.className = 'gf-tut-ring';
      this.ringEl.setAttribute('aria-hidden', 'true');
      this.root.appendChild(this.ringEl);
    }

    const el = document.createElement('div');
    el.className = 'gf-tut';
    el.setAttribute('role', 'status');
    // `aria-live="polite"` rather than `assertive`: the card explains the control the player is
    // about to use, and cutting them off mid-word to say so is worse than saying it a beat later.
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="gf-tut__card gf-panel" data-side="${esc(s.side || 'centre')}">
        <div class="gf-tut__step">${esc(t('tut_step', { n: this.i + 1, of: STEPS.length }))}</div>
        <div class="gf-tut__text">${esc(t(s.key))}</div>
        ${s.advance === 'button'
    ? `<button type="button" class="gf-btn gf-tut__ok" data-role="tut-ok"><span>${esc(t('tut_ok'))}</span></button>`
    : `<div class="gf-tut__wait">${esc(t('tut_your_turn'))}</div>`}
        <button type="button" class="gf-tut__skip" data-role="tut-skip">${esc(t('tut_skip'))}</button>
      </div>
      <div class="gf-tut__arrow" aria-hidden="true"></div>`;
    this.root.appendChild(el);
    this.el = el;

    const ok = el.querySelector('[data-role="tut-ok"]');
    if (ok) this._on(ok, 'click', () => this._next());
    // SKIP IS ALWAYS AVAILABLE, and it finishes the LESSON rather than the HOLE. The player still
    // has to hole out to unlock holes 1-3 (that is `progress.js`'s rule and it reads the hole
    // record, which only holing writes) - this just stops the cards. Somebody replaying the
    // tutorial for a better score should not have to tap through nine of them again.
    this._on(el.querySelector('[data-role="tut-skip"]'), 'click', () => this._finish());

    // `onViewportResize`, NEVER a raw `resize` listener - the repo's rule, and it bites here for
    // its own reason as well as the usual one: a card is positioned from a MEASURED anchor rect,
    // and mobile browsers fire `resize` continuously while the URL bar animates, so a raw listener
    // would re-measure and re-place the card several times per frame during any scroll.
    this.offViewport = onViewportResize(() => this._place());
    this._place();
  }

  /** Put the card beside its anchor and the arrow between them, then clamp the whole thing inside
   *  the screen. Measured every time rather than positioned in CSS, because the controls move with
   *  the safe area and the phone's height. */
  _place() {
    const el = this.el;
    const s = this.step;
    if (!el || !s || !this.root) return;
    const card = el.querySelector('.gf-tut__card');
    const arrow = el.querySelector('.gf-tut__arrow');
    const rootR = this.root.getBoundingClientRect();

    if (!s.anchor) {
      card.style.left = ''; card.style.top = '';
      el.setAttribute('data-centre', '1');
      arrow.style.display = 'none';
      if (this.ringEl) this.ringEl.style.display = 'none';
      return;
    }
    el.setAttribute('data-centre', '0');
    const target = this.root.querySelector(s.anchor);
    if (!target) { arrow.style.display = 'none'; return; }
    const r = target.getBoundingClientRect();
    const x = r.left - rootR.left;
    const y = r.top - rootR.top;

    if (this.ringEl) {
      this.ringEl.style.display = '';
      this.ringEl.style.left = `${x - 4}px`;
      this.ringEl.style.top = `${y - 4}px`;
      this.ringEl.style.width = `${r.width + 8}px`;
      this.ringEl.style.height = `${r.height + 8}px`;
    }

    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const GAP = 16;
    // The card clears `clear` when a step names one (the whole control cluster), and the anchor
    // otherwise. The ARROW and the RING are unaffected: they still point at the anchor, which is
    // what makes "this row, not that one" readable when the card has been pushed further away.
    const clearEl = s.clear ? this.root.querySelector(s.clear) : null;
    const cr = clearEl ? clearEl.getBoundingClientRect() : r;
    const cyTop = cr.top - rootR.top;
    const cyBot = cr.bottom - rootR.top;
    let cx = x + r.width / 2 - cw / 2;
    let cy = s.side === 'below' ? cyBot + GAP : cyTop - ch - GAP;
    // Clamp inside the root with a margin, so a card anchored to a corner control never hangs off
    // the screen. This is why `side` can be authored: the clamp is what makes it safe.
    const M = 8;
    cx = Math.max(M, Math.min(rootR.width - cw - M, cx));
    cy = Math.max(M, Math.min(rootR.height - ch - M, cy));
    card.style.left = `${cx}px`;
    card.style.top = `${cy}px`;

    arrow.style.display = '';
    const ax = Math.max(cx + 12, Math.min(cx + cw - 12, x + r.width / 2));
    const pointsDown = cy + ch <= y + r.height / 2;
    arrow.setAttribute('data-dir', pointsDown ? 'down' : 'up');
    arrow.style.left = `${ax - 9}px`;
    arrow.style.top = pointsDown ? `${cy + ch - 2}px` : `${cy - 16}px`;
  }
}
