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
// NO CARD IS EVER ON SCREEN WHILE THE NEEDLE IS MOVING (2026-09-09).
//
// Matt, on the first version: *"You say hit 'swing' then it starts moving immediately, but more
// words appear. you don't have time to read what to do next before the time has passed."*
//
// He is describing a design error, not a slow reader. The first version had three cards across one
// swing - `swing1` ended on `tap-begin`, `swing2` on `tap-power`, `swing3` on `fire` - so each tap
// REVEALED the instruction for the next one. The backswing is 1585 ms per power unit and the
// downswing quicker, so the player had roughly a second to find, read and act on a sentence that
// had not existed a moment earlier. It cannot be done, and no amount of shortening the sentence
// fixes it: the words arrive after the moment they describe.
//
// So the three taps are taught ONCE, BEFORE the first of them, and then the lesson goes quiet. The
// swing button already names the next tap (`swing` / `set power` / `set aim`, painted from the
// render loop) and the charge ring already shows the putter's dead zone - during a swing those are
// the whole interface, and a card would only cover the meter it is talking about.
//
// THE MECHANISM IS A STEP WITH NO CARD. A step whose `key` is null renders nothing at all and just
// waits for its event. That is what lets the lesson span three shots of a par 4 without ever
// putting words over a swing: card, silence until the ball is on the green, card, silence until it
// drops, card.
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
import { SWING_MAX, BAR_HALF } from './swing.js';

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
  // THE LESSON MAKES YOU USE THE CONTROL, IT DOES NOT DESCRIBE IT (2026-09-09). Matt: "make them
  // click buttons to aim. make them click buttons to change clubs." These advance on the player's
  // own tap, so the rings sit on the control until it has actually been worked.
  //
  // TWO RINGS, NOT ONE, AND ONLY ON THE BUTTONS. Matt: "you can't tap on the 'aim' rectangle. So
  // don't include that in the highlighted thing. Only outline the buttons." The readouts between
  // and beside the arrows are not controls and are not ringed.
  { id: 'aim', rings: ['aim-l', 'aim-r'], key: 'tut_aim', advance: 'aim' },

  // THE TWO SWING POPUPS COME BEFORE THE FIRST SWING, NEVER DURING ONE. The backswing is 1585 ms
  // per power unit, so anything that APPEARS while the needle moves cannot be found, read and acted
  // on - which is how the first version failed. Both are dismissed before a tap is ever asked for.
  { id: 'good', popup: 'good', key: 'tut_good', advance: 'button' },
  { id: 'bad', popup: 'bad', key: 'tut_bad', advance: 'button' },
  { id: 'swing', rings: ['swing'], marks: 'swing', key: 'tut_swing', advance: 'tap-begin' },

  // SILENT while the drive is in the air. It is what makes the club card land on the SECOND shot
  // rather than the tee, and it has to exist: `club` following `swing` directly would put a card
  // on screen the instant the first tap landed, on top of a moving needle.
  { id: 'after-drive', key: null, advance: 'settled' },

  // THE CLUB LESSON IS ON THE SECOND SHOT, NOT THE TEE (2026-09-09). Matt: "As it is now, they'll
  // change clubs on the tee shot then have to change back. You actually have to change clubs for
  // the second shot." He is right, and it made the one lesson in the set that teaches a control by
  // USING it teach a change the player has to undo before they can play: the driver is already the
  // club you want on a 372 yd par 4, so every tap on those arrows was wrong. After the drive the
  // bag has genuinely moved on, so working the control is the thing you would do anyway.
  { id: 'club', rings: ['club-up', 'club-dn'], key: 'tut_club', advance: 'club' },

  // SILENT until the ball is on the putting surface. `on-green` rather than `settled` because this
  // is a par 4: the approach may take one shot or three, and a card that appeared after the first
  // one would be telling a player standing in the fairway to putt.
  { id: 'to-green', key: null, advance: 'on-green' },
  { id: 'dial', popup: 'dial', key: 'tut_dial', advance: 'button' },
  { id: 'putt', rings: ['swing'], marks: 'swing', key: 'tut_swing2', advance: 'tap-begin' },
  { id: 'sink', key: null, advance: 'holed' },
  // THE RESULT PANEL SAYS THE LESSON IS OVER, not a rail card - `ui.js`'s `_showHoleResult` prints
  // "Tutorial complete" and the unlock. This step waits for the player to close it.
  { id: 'card', key: null, advance: 'result-closed' },
  { id: 'bug', popup: 'bug', key: 'tut_bug', advance: 'button' },
];

/** The cards, in order - the silent waypoints above are not steps the player can see, so numbering
 *  them "step 4 of 9" would count three the player never meets. */
export const CARDS = STEPS.filter((s2) => s2.key);

/** WHERE THE GOLD MARKS GO ON THE DIAL, in the meter's own `pos` units: 100 % power on the band,
 *  dead centre in the accuracy bar. Shared by the popups and by the live dial, so the mark the
 *  lesson points at and the mark the player then aims for are the same number. */
export const GOOD_MARKS = [{ power: 1 }, { bar: 0 }];
/** ...and a BAD swing: the far end of the arc, and the far end of the bar - which is also where the
 *  needle ends up when the third tap never comes. The cyan one is the same no-tap miss at 100 %,
 *  drawn beside it so the two can be compared. Cyan rather than a second warm colour: Matt is
 *  red/green colorblind, and gold against cyan is the pair this repo already uses. */
export const BAD_MARKS = [{ power: SWING_MAX }, { power: 1, colour: '#5ec8f5' }, { bar: -BAR_HALF }];

/** Every event kind the coach understands, exported so `golf/js/test.js` can check that each step
 *  waits on one of them (or on its own button) and the lesson cannot strand the player. */
export const EVENTS = ['aim', 'club', 'tap-begin', 'tap-power', 'fire', 'settled', 'on-green', 'holed', 'result-closed'];

/** THE EVENTS A STEP CAN LEGITIMATELY MISS, and the only ones `event()` will skip forward to.
 *  They are all things the GAME does rather than things the player taps: the swing fires itself if
 *  the needle runs off the bar with no third tap, and a hole in one returns early and never sends
 *  `settled` or `on-green` at all. Everything else is a control the lesson is waiting to see used,
 *  and skipping ahead on one of those would let the player past a gate without working it. */
export const SKIPPABLE = new Set(['fire', 'settled', 'on-green', 'holed', 'result-closed']);

/** The popup's dial canvases are painted by `ui.js`'s own `_drawMeter`, which draws at this size. */
const DIAL_W = 176;
const DIAL_H = 150;

/** THE BAD SWING'S SECOND HALF: what the miss does to the ball. Gold is the over-swing, cyan the
 *  same miss at 100 %, matching the two marks on the dial above it.
 *
 *  RE-MEASURED 2026-09-09, and the old figures were badly wrong. Matt, looking at the card: *"are
 *  those numbers accurate? a 20% increase in power would only result in being 5 additional yards
 *  offline?"* No. It said 34 and 39 - a 5 yd difference for 21 % more power, which is exactly the
 *  smell he picked up on. Measured through the real resolver on the TUTORIAL HOLE (the hole the
 *  card is teaching on, and the only one with no trees, water or sand to interfere), a driver from
 *  the tee with the needle at the END of the bar:
 *
 *      100 % power     24.4 yds offline, 8.0 deg of mishit
 *      max power       45 yds offline (29-46), 10-22 deg
 *
 *  So the real answer is about 21 yds, not 5 - nearly DOUBLE the miss, which is the whole point the
 *  card is making and it was underselling it by four times.
 *
 *  TWO REASONS THE OLD NUMBERS WERE STALE. They were taken on a Pine Valley fairway, where a tree
 *  can stop the ball and shorten the measurement; and they predate 2026-09-08, when the mishit
 *  moved out of `aimRad` into `mishitDeg` so the ball CURVES, and `sprayDepth` began ramping the
 *  over-swing spray from 100 % rather than from the block's edge.
 *
 *  THE MAX-POWER FIGURE IS A TYPICAL VALUE, NOT A FIXED ONE. `blockSpray` takes a random side, so
 *  it lands 29-46 yds off depending on whether the spray agrees with the mishit or partly cancels
 *  it. 45 is the median. `golf/js/test.js` section 20 re-measures both and fails if either label
 *  drifts from the engine again. */
const SLICE_SVG = `<svg class="gf-tut__slice" viewBox="0 0 400 150" aria-hidden="true">
  <line x1="24" y1="128" x2="256" y2="128" stroke="#7f8f6e" stroke-width="3" stroke-dasharray="9 8"/>
  <path d="M24 128 C104 126 168 116 236 86" fill="none" stroke="#5ec8f5" stroke-width="7" stroke-linecap="round"/>
  <path d="M240 84 l-23 1 l10 15 z" fill="#5ec8f5"/>
  <path d="M24 128 C104 124 164 100 240 34" fill="none" stroke="#ffce3a" stroke-width="7" stroke-linecap="round"/>
  <path d="M244 31 l-24 3 l12 15 z" fill="#ffce3a"/>
  <circle cx="24" cy="128" r="8" fill="#fff" stroke="#000" stroke-width="3"/>
  <g font-family="inherit" font-weight="800" font-size="22" stroke="#000" stroke-width="5" paint-order="stroke">
    <text x="256" y="40" fill="#ffce3a">45 yds off</text>
    <text x="252" y="96" fill="#5ec8f5">24 yds off</text>
  </g>
</svg>`;

/** The closing card points at the pause menu, so it shows one. */
const PAUSE_ART = (tt) => `<div class="gf-tut__pause" aria-hidden="true">
  <div class="gf-tut__pauseh">${esc(tt('paused'))}</div>
  <div class="gf-tut__pauserow">${esc(tt('pause_resume'))}</div>
  <div class="gf-tut__pauserow is-lit">${esc(tt('report_bug'))}</div>
  <div class="gf-tut__pauserow">${esc(tt('quit'))}</div>
</div>`;

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
    this.rings = [];
    this.onDial = null;
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
    // A PLAYER ACTION ONLY EVER ENDS THE STEP THAT ASKED FOR IT. The forward search below exists
    // for events the lesson can MISS; it must not apply to the ones the lesson is GATING on, and
    // that distinction was found by driving it: with a plain search, tapping the CLUB arrow while
    // the aim card was up matched the club step two ahead and skipped the aim step entirely - the
    // gate Matt asked for ("make them click buttons to aim") let you past without clicking it.
    if (!SKIPPABLE.has(kind)) {
      if (this.step && this.step.advance === kind) this._next();
      return;
    }
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
    for (const r of this.rings) r.remove();
    this.rings.length = 0;
    if (this.offViewport) { this.offViewport(); this.offViewport = null; }
  }

  destroy() { this.finished = true; this._teardown(); }

  _on(el, type, fn) { el.addEventListener(type, fn); this.listeners.push([el, type, fn]); }

  /** WHAT THE LESSON DRAWS, and it is one of exactly two things.
   *
   *  A RAIL - one line across the screen, sitting ON TOP of the control clusters rather than over
   *  them. Matt picked it off the mockups and named the flaw in the same breath: *"i like the bottom
   *  rail with pips, but it covers the buttons"*. So `ui.js` lifts the bottom HUD by the rail's own
   *  height for as long as the lesson runs (`.gf-root[data-tut="1"]`), and the rail owns the strip
   *  that frees up. Nothing the player is being asked to press is ever underneath it.
   *
   *  A POPUP - a centred card carrying a DRAWING OF THE REAL DIAL, used four times: a good swing, a
   *  bad one, the putting dial, and the closing note. Each is dismissed with one button before the
   *  lesson asks for a tap, so no popup is ever on screen while the needle is moving. */
  _render() {
    const s = this.step;
    if (!s) return;
    this._teardown();
    if (!this.root || !this.root.isConnected) return;
    // A SILENT WAYPOINT SAYS NOTHING, BUT THE RAIL STAYS. No words is the whole point - it is what
    // keeps the lesson off the screen during a swing (see the header) - but drawing NOTHING was a
    // second thing nobody asked for: `data-tut` holds the controls 30 px up for the whole lesson,
    // so an empty rail left a reserved strip of bare course under them, and the progress pips
    // blinked out for the two shots of the approach and came back for the putting card. Pips only,
    // and no rings: the row is continuous and the space it reserved is the space it uses.
    if (!s.key) {
      const bar = document.createElement('div');
      bar.className = 'gf-tut';
      bar.setAttribute('aria-hidden', 'true');   // nothing to announce; the pips are decoration
      bar.innerHTML = `<div class="gf-tut__rail">${this._pipsHTML(s)}</div>`;
      this.root.appendChild(bar);
      this.el = bar;
      return;
    }

    for (const role of (s.rings || [])) {
      const ring = document.createElement('div');
      ring.className = 'gf-tut-ring';
      ring.dataset.for = role;
      ring.setAttribute('aria-hidden', 'true');
      this.root.appendChild(ring);
      this.rings.push(ring);
    }

    const el = document.createElement('div');
    el.className = 'gf-tut';
    el.setAttribute('role', 'status');
    // `aria-live="polite"` rather than `assertive`: the card explains the control the player is
    // about to use, and cutting them off mid-word to say so is worse than saying it a beat later.
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = s.popup ? this._popupHTML(s) : this._railHTML(s);
    this.root.appendChild(el);
    this.el = el;

    for (const c of el.querySelectorAll('canvas[data-dial]')) this._paintDial(c);

    const ok = el.querySelector('[data-role="tut-ok"]');
    if (ok) this._on(ok, 'click', () => this._next());
    // THERE IS NO SKIP, AND THAT IS NOT AN OVERSIGHT (Matt, 2026-09-09: "get rid of the 'skip
    // tutorial' button. that is NOT an option"). The lesson is the gate on holes 1-3 -
    // `progress.js` opens them off `bestHole['tutorial:1']`, which only holing out writes - so a
    // skip button offered an exit that led nowhere: the cards stopped and the game stayed locked.

    // `onViewportResize`, NEVER a raw `resize` listener - the repo's rule, and it bites here for
    // its own reason as well: the rings are positioned from MEASURED control rects, and mobile
    // browsers fire `resize` continuously while the URL bar animates.
    this.offViewport = onViewportResize(() => this._place());
    this._place();
  }

  /** The pips say how much lesson is left, which is the one thing the old card never did and most
   *  of why a tutorial feels long. One per CARD - the silent waypoints are not steps a player
   *  meets, so numbering them would count three that never appear. */
  _pipsHTML(s) {
    // A SILENT STEP IS NOT IN `CARDS`, so `indexOf` is -1 and every pip would come out blank - the
    // row would be there and say nothing. Counting the cards BEHIND it marks those done and lights
    // the one AHEAD as current, which is what a waypoint between two cards means: you are past
    // these, and that is the next thing the lesson will say.
    const i = CARDS.includes(s) ? CARDS.indexOf(s) : CARDS.filter((c) => STEPS.indexOf(c) < STEPS.indexOf(s)).length;
    return `<span class="gf-tut__pips" aria-hidden="true">${CARDS
      .map((_, k) => `<i class="${k < i ? 'is-done' : k === i ? 'is-on' : ''}"></i>`).join('')}</span>`;
  }

  /** `bare` is a popup step: the pips still say how far along the lesson is, but the sentence lives
   *  in the popup and repeating it under one is the clutter Matt cut ("no text needs to be on that
   *  banner here. we have a full popup"). */
  _railHTML(s, bare) {
    return `<div class="gf-tut__rail">${this._pipsHTML(s)}` +
      (bare ? '' : `<span class="gf-tut__text">${esc(t(s.key))}</span>`) + '</div>';
  }

  _popupHTML(s) {
    const dial = (kind, label) => `<figure class="gf-tut__dialbox">` +
      (label ? `<figcaption>${esc(label)}</figcaption>` : '') +
      `<canvas data-dial="${esc(kind)}" width="${DIAL_W}" height="${DIAL_H}" aria-hidden="true"></canvas></figure>`;
    let art = '';
    if (s.popup === 'good') art = dial('good', '');
    else if (s.popup === 'bad') art = dial('bad', '') + SLICE_SVG;
    else if (s.popup === 'dial') {
      art = `<div class="gf-tut__two">${dial('full', t('tut_dial_full'))}${dial('putt', t('tut_dial_putt'))}</div>`;
    } else if (s.popup === 'bug') art = PAUSE_ART(t);
    return `<div class="gf-tut__pop gf-panel">
        <div class="gf-tut__h">${esc(t(`${s.key}_h`))}</div>
        ${art}
        <div class="gf-tut__text">${esc(t(s.key))}</div>
        <button type="button" class="gf-btn gf-tut__ok" data-role="tut-ok"><span>${esc(t('tut_ok'))}</span></button>
      </div>${this._railHTML(s, true)}`;
  }

  /** THE POPUPS PAINT THE REAL METER, through `ui.js`'s own `_drawMeter`. A picture of a dial would
   *  be a second copy of the one thing this popup exists to explain, and it would go stale the day
   *  the meter is retuned. `onDial` is handed in by ui.js. */
  _paintDial(canvas) {
    if (!this.onDial) return;
    const kind = canvas.dataset.dial;
    this.onDial(canvas, {
      putting: kind === 'putt',
      marks: kind === 'good' ? GOOD_MARKS : kind === 'bad' ? BAD_MARKS : null,
    });
  }

  /** WHICH DIAL MARKS THE LIVE METER SHOWS, asked by `_drawMeter` every frame. Only the two steps
   *  that follow the swing popups carry them, so the marks the popup just pointed at are on the
   *  real dial when the player turns to it - and are gone again once the lesson is. */
  dialMarks() { const s = this.step; return (s && s.marks === 'swing') ? GOOD_MARKS : null; }

  /** Put the rings on their controls and the rail above them, measured every time - the controls
   *  move with the safe area, the phone's height and the hub's own chrome. */
  _place() {
    const el = this.el;
    const s = this.step;
    if (!el || !s || !this.root) return;
    const rootR = this.root.getBoundingClientRect();

    // THE RAIL IS WELDED TO THE BOTTOM EDGE and the CONTROLS move, which is the shape Matt picked
    // ("i like the bottom rail with pips, but it covers the buttons"). It is positioned in CSS, not
    // here: an earlier version measured the tallest control cluster and sat above it, which put the
    // rail halfway up the screen because `.gf-br` carries the 150px meter - measured in a browser
    // at y=390 of 664, straight across the popup's own button.

    for (const ring of this.rings) {
      const target = this.root.querySelector(`[data-role="${ring.dataset.for}"]`);
      if (!target) { ring.style.display = 'none'; continue; }
      const r = target.getBoundingClientRect();
      ring.style.display = '';
      ring.style.left = `${r.left - rootR.left - 4}px`;
      ring.style.top = `${r.top - rootR.top - 4}px`;
      ring.style.width = `${r.width + 8}px`;
      ring.style.height = `${r.height + 8}px`;
    }
  }

}
