// table.js - the dealer. Owns the full engine state (deck and every hole card) on ONE device:
// the only device in a solo game, the host's in an online one. It applies moves, runs the
// computer players, runs the turn clock and deals the next hand. Nothing here touches the DOM or
// the network; the caller renders and publishes from `onChange`.
//
// This is how the online Hold'em apps this game is modelled on work (a socket.io/Node server
// holds the deck and every client only ever sends "fold/call/raise" and receives the table).
// The Game Hub has no server, so the host's phone plays the part.

import { startHand, act, legal, leave } from './engine.js';
import { decide } from './ai.js';

export const RESULT_MS = 4800;        // how long a showdown stays on the table before the next deal
export const FOLD_WIN_MS = 2400;      // a hand everyone folded to: shorter, nothing to look at
// How long a computer "thinks" before it acts, per the Computer speed setting (2026-09-28, Matt
// asked for it). Normal is the pace the game shipped with. The rules are the same at every speed.
export const PACES = { slow: [1500, 2800], normal: [800, 1700], fast: [250, 600] };
const AUTO_MS = 700;                  // an away / sitting-out player's automatic check or fold
const FF_MS = 40;                     // fast-forward: a computer's move, no thinking pause
const FF_RESULT_MS = 350;             // fast-forward through a whole game: each result, briefly

export class Table {
  /** `opts.clockMs` > 0 gives every human a turn clock (online only); `opts.onChange(table)` fires
   *  after every change, including deals and bot moves. */
  constructor(state, opts = {}) {
    this.state = state;
    this.clockMs = opts.clockMs | 0;
    // Solo waits for "Tap the table to start the next hand" (the reference app's rule); an online
    // host deals on a timer, because nobody should have to wait on one player's tap.
    this.tapToDeal = !!opts.tapToDeal;
    this.pace = PACES[opts.pace] ? opts.pace : 'normal';
    // Fast-forward (2026-09-27, Matt: "after i fold ... skip the computer players playing it out").
    // A hand number = race through that hand; 'game' = race through every hand to the end (the
    // player is out). The rules are untouched: the same bots make the same kind of decisions, just
    // with no thinking pause between them.
    this.ff = null;
    this.onChange = opts.onChange || (() => {});
    this.timer = null;
    this.clockEnd = 0;
    this.dead = false;
  }

  /** Begin (or resume) play: deal if no hand is running, otherwise pick up where it stopped. */
  start() {
    const s = this.state;
    if (!s.over && (!s.hand || s.hand.result)) {
      if (s.hand && s.hand.result) return this.pump();   // show the last result, then deal
      startHand(s);
    }
    this.pump();
  }

  /** A human's move. Returns the engine's { ok } / { error }. */
  submit(i, move) {
    if (this.dead) return { error: 'closed' };
    const r = act(this.state, i, move);
    if (r.ok) {
      const p = this.state.players[i];
      if (p && p.sitOut) p.sitOut = false;     // acting yourself is the clearest "I'm back"
      this.pump();
    }
    return r;
  }

  /** Remove a player for good (walked away / left the room). */
  remove(i) {
    if (this.dead) return;
    const k = this.state.k;
    leave(this.state, i);
    if (this.state.k !== k) this.pump();
  }

  /** Heartbeat-driven: a device that stopped answering is folded for automatically until it
   *  comes back, so one locked phone never freezes the whole table. */
  setAway(i, away) {
    const p = this.state.players[i];
    if (!p || p.bot || !!p.away === !!away) return;
    p.away = !!away;
    this.pump();
  }

  /** Race the computers through the rest of this hand ('hand'), or every hand to the end of the
   *  game ('game'). Cleared by itself when that hand ends / the game ends. */
  fastForward(scope) {
    if (this.dead || this.state.over) return;
    this.ff = scope === 'game' ? 'game' : this.state.handNo;
    this.pump();
  }

  /** Change the computers' thinking time; takes effect from their next move. */
  setPace(p) {
    if (!PACES[p] || p === this.pace) return;
    this.pace = p;
    const h = this.state.hand;
    if (h && !h.result && h.toAct >= 0 && this.state.players[h.toAct] && this.state.players[h.toAct].bot) this.pump();
  }

  _fast() {
    return this.ff === 'game' || (this.ff != null && this.ff === this.state.handNo);
  }

  /** Deal the next hand now (the tap in solo). No-op while a hand is still being played. */
  next() {
    const s = this.state;
    if (this.dead || s.over || (s.hand && !s.hand.result)) return;
    startHand(s);
    this.pump();
  }

  back(i) {
    const p = this.state.players[i];
    if (!p || !p.sitOut) return;
    p.sitOut = false;
    this.pump();
  }

  /** Schedule whatever happens next. Idempotent: always clears the previous timer first. */
  pump() {
    if (this.dead) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.clockEnd = 0;
    const s = this.state;
    const h = s.hand;
    if (!s.over) {
      if (h && h.result && this.tapToDeal && this.ff !== 'game') {
        // nothing scheduled: next() deals
      } else if (h && h.result && this.ff === 'game') {
        this.timer = setTimeout(() => { this.timer = null; if (this.dead || s.over) return; startHand(s); this.pump(); }, FF_RESULT_MS);
      } else if (!h || h.result) {
        const wait = !h ? 0 : (h.result.noShow ? FOLD_WIN_MS : RESULT_MS + 350 * (h.runout | 0));
        this.timer = setTimeout(() => { this.timer = null; if (this.dead || s.over) return; startHand(s); this.pump(); }, wait);
      } else if (h.toAct >= 0) {
        const i = h.toAct;
        const p = s.players[i];
        const k = s.k;
        if (p.bot) {
          const [lo, hi] = PACES[this.pace] || PACES.normal;
          const delay = this._fast() ? FF_MS : lo + Math.random() * (hi - lo);
          this.timer = setTimeout(() => {
            this.timer = null;
            if (this.dead || s.k !== k) return;
            let mv;
            try { mv = decide(s, p.bot); } catch { mv = null; }
            const r = mv ? act(s, i, mv) : { error: 'no-move' };
            if (!r.ok) act(s, i, { a: (legal(s) || {}).canCheck ? 'check' : 'fold' });
            this.pump();
          }, delay);
        } else if (p.away || p.sitOut || p.left) {
          this.timer = setTimeout(() => { this.timer = null; if (!this.dead && s.k === k) this._auto(i); }, this._fast() ? FF_MS : AUTO_MS);
        } else if (this.clockMs > 0) {
          this.clockEnd = Date.now() + this.clockMs;
          this.timer = setTimeout(() => {
            this.timer = null;
            if (this.dead || s.k !== k) return;
            p.sitOut = true;                   // ran out of time: sit out until they act again
            this._auto(i);
          }, this.clockMs);
        }
      }
    }
    this.onChange(this);
  }

  _auto(i) {
    const L = legal(this.state);
    if (!L || L.i !== i) return this.pump();
    act(this.state, i, { a: L.canCheck ? 'check' : 'fold' });
    this.pump();
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

export default Table;
