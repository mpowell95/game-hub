// cup-pong/js/match.js - THE RULES OF A MATCH. Pure: no DOM, no engine, no clock, no storage.
//
// Matt's rules, in his words where he gave them (cup-pong/CLAUDE.md carries the dated record):
//   - 10 cups a side, 4-3-2-1, point toward the shooter. A made cup is gone at once.
//   - A turn is TWO BALLS. Make both and you get both back ("balls back"); that repeats.
//   - HEATING UP / ON FIRE ARE PER BALL (2026-09-28): "it has to be the first ball that gets 2 in a
//     row for heating up and 3 in a row for on fire. and on fire means you get that ball back and
//     shoot until you miss." Each ball keeps its own streak across turns; every throw of that ball
//     counts, balls-back throws included (Matt, same day). The 3rd make in a row lights it, and from
//     then that ball comes straight back after every make until it misses.
//   - THE LAST CUP (2026-09-28): make it with a ball and you still throw the ball(s) you have left.
//     Put another in THE SAME CUP and you win outright, no rebuttal. Otherwise the cup goes and the
//     other side gets a rebuttal. BALLS BACK COUNT AS BALLS LEFT (Matt, 2026-09-29: "I just beat
//     king of games by hitting the last two cups. But I didn't get the balls back to shoot again and
//     end the game"): sink the last cup with the pair's second ball after the first also went in,
//     and the balls come back with that cup still standing - hit it and win, miss both and it goes
//     and the rebuttal follows. `lastCupBack` switches it; old challenges replay without it.
//   - THE REBUTTAL (2026-09-28): "rebuttals is 2 shots as well - each person gets to shoot. And if
//     the first ball hits a cup, they get that ball back". Both balls, each shooting until it misses.
//     Clear everything and it goes to OVERTIME (3 cups each, 2-1); otherwise the side that cleared
//     wins.
//   - GENTLEMAN'S, RERACK and ISLAND are the SHOOTER'S OPTIONS, not automatic (2026-09-28): each is a
//     button that appears when it is available. "there should be NO reracks or gentlemans allowed
//     in OT."
//       Gentleman's: when the rack being shot at is down to 2 cups not already in a line - free,
//                    before the turn's first throw. Setting On/Off decides if it exists at all.
//       Rerack:      a preset for the cups left (rack.js RERACKS), before the turn's first throw,
//                    using one of the shooter's reracks (the Reracks setting, per player per game).
//       Island:      "if a cup is not touching any other cups, you can call island (once per game).
//                    and if you hit that cup, you get 2 cups. The opposing player can choose the
//                    second cup. If there are multiple available islands, you must call the specific
//                    one." Calling spends it, hit or miss (Matt, 2026-09-28). EACH BALL IS ITS OWN
//                    PLAYER (Matt, 2026-09-29): "each 'player' gets to call island once per game -
//                    and it does NOT have to be at the same time as the other 'player'." So a side
//                    has two calls, one per ball, and a call is for the ball about to be thrown.
//   - BOUNCE SHOTS ARE OFF (Matt, 2026-09-28, the same day they shipped): "in real life you can
//     hit a bounced ball away from the table... We won't be able to do that in turn based
//     multiplayer. so maybe we shouldn't include it." A bounced make is one cup. The rule stays
//     behind `bounce` (default false): 2 cups, the defender picks the second, island + bounce = 3,
//     not in a rebuttal, never the last cup. Only a challenge stored with `rules.bo` turns it on,
//     so the few made while it was live still replay.
//
// Sides are 'a' (this phone, red cups) and 'b' (the opponent, blue). Each rack is stored in the
// SHOOTER'S frame. Everything that happens comes back as EVENTS, in order.
//
// A CHALLENGE (`async: true`, 2026-09-28) plays the same rules with one difference: the defender
// is not there when an island goes in, so the second cup is OWED (Matt chose this): `owed[side]`
// counts it, and that side removes it at the start of its own next turn (`pickOwed`) before any
// throw or option. If the owed cups are all the cups left, the rack is cleared on the spot. A match
// is saved and restored whole (`toJSON` / `Match.fromJSON`), and `swapSides` turns a saved match
// round so the phone playing it is always side 'a'.

import { makeRack, PRESETS, isSpot, isCell, validRack, presetsFor, applyPreset, islandsOf } from './rack.js';

export const BALLS = 2;
const other = (s) => (s === 'a' ? 'b' : 'a');

/** Overtime's 2-1 triangle, at the back of the rack area, point toward the shooter. */
export const OVERTIME_CELLS = [{ c: -1, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 1 }];

const sameSpot = (k, s) => isSpot(k) && Math.abs(k.u - s.u) < 1e-9 && Math.abs(k.v - s.v) < 1e-9;

export class Match {
  /**
   * @param {object} o
   * @param {'a'|'b'} [o.first='a']      who shoots first
   * @param {boolean} [o.gentlemans=true] Gentleman's exists in this match
   * @param {number}  [o.reracks=2]       reracks per player per game (Infinity = unlimited)
   */
  constructor({ first = 'a', gentlemans = true, reracks = 2, async = false, bounce = false, backRack = true, lastCupBack = true } = {}) {
    this.async = !!async;
    // Reracks stand against the BACK WALL (Matt, 2026-09-29). Off only for a challenge made before.
    this.backRack = backRack !== false;
    this.lastCupBack = lastCupBack !== false;
    this.bounce = !!bounce;
    this.owed = { a: 0, b: 0 };         // challenge only: cups a side still has to take off its own rack
    this.gentlemans = !!gentlemans;
    this.reracks = reracks;
    this.racks = { a: makeRack('tri10'), b: makeRack('tri10') };
    this.shooter = first === 'b' ? 'b' : 'a';
    this.phase = 'normal';              // 'normal' | 'rebuttal' | 'overtime'
    this.clearedBy = null;              // who cleared the rack that started the current rebuttal
    this.streak = { a: [0, 0], b: [0, 0] };
    this.reracksLeft = { a: reracks, b: reracks };
    this.islandUsed = { a: [false, false], b: [false, false] };   // per side, per BALL
    this.called = null;                 // the island cup called for the next throw
    this.pendingPick = null;            // { picker, n } - the defender owes n more cups (island, bounce)
    this.lastCup = null;                // the last cup, made, still standing for the balls left
    this.queue = [];                    // balls still to throw this pair, in order
    this.pairRes = [null, null];        // each ball's last result in this pair
    this.turnThrows = 0;
    this.turnNo = 0;
    this.throwsTaken = 0;
    this.over = false;
    this.winner = null;
  }

  get defender() { return other(this.shooter); }
  target() { return this.racks[this.defender]; }
  /** The ball about to be thrown (0 or 1), or null between turns. */
  get ball() { return this.queue.length ? this.queue[0] : null; }
  /** The ball waiting behind it this pair, or null. */
  get spare() { return this.queue.length > 1 ? this.queue[1] : null; }
  /** 0 cold, 1 one make, 2 heating up, 3+ on fire. */
  heat(side, ball) { return this.streak[side][ball] || 0; }
  /** Challenge: the shooter owes cups off its OWN rack and must take them before anything else. */
  mustPickOwed() { return !this.over && (this.owed[this.shooter] | 0) > 0; }
  /** The shooter takes one owed cup off its own rack. */
  pickOwed(id) {
    if (!this.mustPickOwed()) return [];
    const mine = this.racks[this.shooter];
    if (!mine.some((k) => k.id === id)) return [];
    this.racks[this.shooter] = mine.filter((k) => k.id !== id);
    this.owed[this.shooter]--;
    return [{ type: 'owedPicked', side: this.shooter, id, left: this.owed[this.shooter] }];
  }

  startTurn() {
    const ev = [];
    if (this.over) return ev;
    this.turnNo++;
    this.queue = [0, 1];
    this.pairRes = [null, null];
    this.turnThrows = 0;
    this.rerackedThisTurn = false;       // one rerack a turn
    this.called = null;
    this.lastCup = null;
    if (this.phase === 'rebuttal') ev.push({ type: 'rebuttal', side: this.shooter });
    return ev;
  }

  // --- the shooter's options ----------------------------------------------------------------
  canGentlemans() {
    if (!this.gentlemans || this.phase !== 'normal' || this.turnThrows > 0 || this.over || this.mustPickOwed()) return false;
    const rack = this.target();
    if (rack.length !== 2) return false;
    return !rack.every((k) => PRESETS.line2.some((s) => sameSpot(k, s)));
  }
  applyGentlemans() {
    if (!this.canGentlemans()) return [];
    const to = applyPreset(this.target(), PRESETS.line2);
    this.racks[this.defender] = to;
    return [{ type: 'gentlemans', side: this.defender, to }];
  }

  canRerack() {
    if (this.phase !== 'normal' || this.turnThrows > 0 || this.over || this.rerackedThisTurn || this.mustPickOwed()) return false;
    if (!(this.reracksLeft[this.shooter] > 0)) return false;
    const n = this.target().length;
    return n >= 1 && n < 10 && presetsFor(n, this.backRack).length > 0;
  }
  rerack(key) {
    if (!this.canRerack()) return [];
    const p = presetsFor(this.target().length, this.backRack).find((x) => x.key === key);
    if (!p) return [];
    const to = applyPreset(this.target(), p.spots);
    this.racks[this.defender] = to;
    if (Number.isFinite(this.reracksLeft[this.shooter])) this.reracksLeft[this.shooter]--;
    this.rerackedThisTurn = true;
    return [{ type: 'rerack', side: this.defender, key, to, left: this.reracksLeft[this.shooter] }];
  }

  /**
   * MAKE YOUR OWN (brief 4c, Matt's "custom next", 2026-09-28): the same rerack, to cells the
   * shooter chose. `cells[i]` is where the i-th standing cup goes; they must be real hex cells,
   * inside the rack area, one cup per cell. Cups do not have to touch (the brief: Matt did not ask
   * for that limit). Costs one rerack, exactly like a preset.
   */
  rerackCustom(cells) {
    if (!this.canRerack()) return [];
    const rack = this.target();
    if (!Array.isArray(cells) || cells.length !== rack.length) return [];
    const to = rack.map((k, i) => ({ id: k.id, c: cells[i] && cells[i].c, r: cells[i] && cells[i].r }));
    if (!to.every(isCell) || !validRack(to)) return [];
    // Against the back wall: at least one cup on the back row, so the rack cannot be pulled closer.
    if (this.backRack && !to.some((k) => k.r === 0)) return [];
    this.racks[this.defender] = to;
    if (Number.isFinite(this.reracksLeft[this.shooter])) this.reracksLeft[this.shooter]--;
    this.rerackedThisTurn = true;
    return [{ type: 'rerack', side: this.defender, key: 'custom', to, left: this.reracksLeft[this.shooter] }];
  }

  islands() { return islandsOf(this.target()); }
  canIsland() {
    return !this.over && !this.mustPickOwed() && this.phase !== 'rebuttal' && this.ball !== null && !this.islandUsed[this.shooter][this.ball] && !this.called
      && !this.lastCup && this.queue.length > 0 && this.islands().length > 0;
  }
  callIsland(id) {
    if (!this.canIsland() || !this.islands().includes(id)) return [];
    this.islandUsed[this.shooter][this.ball] = true;
    this.called = id;
    return [{ type: 'islandCalled', side: this.shooter, id }];
  }

  /** The defender's second cup after an island hit. */
  pickCup(id) {
    if (!this.pendingPick) return [];
    const rack = this.target();
    if (!rack.some((k) => k.id === id)) return [];
    const n = (this.pendingPick.n | 0) || 1;
    this.racks[this.defender] = rack.filter((k) => k.id !== id);
    const ev = [{ type: 'picked', side: this.defender, id, left: n - 1 }];
    if (this.racks[this.defender].length === 0) { this.pendingPick = null; return ev.concat(this._cleared()); }
    if (n > 1) { this.pendingPick = { ...this.pendingPick, n: n - 1 }; return ev; }   // another to pick
    this.pendingPick = null;
    return ev.concat(this._afterThrow());
  }

  // --- a throw ---------------------------------------------------------------------------------
  /** One throw has resolved. `made` is the id of the cup it went in, or null. */
  throwResult({ made = null, bounced = false } = {}) {
    const ev = [];
    if (this.over || this.pendingPick || !this.queue.length || this.mustPickOwed()) return ev;
    this.throwsTaken++;
    this.turnThrows++;
    const side = this.shooter;
    const ball = this.queue.shift();
    const called = this.called;
    this.called = null;
    const rack = this.target();

    // THE LAST CUP, STILL STANDING: another ball in it wins outright.
    if (this.lastCup) {
      if (made === this.lastCup) {
        ev.push({ type: 'made', side, ball, id: made, bounced, sameCup: true, left: 0 });
        this.racks[this.defender] = [];
        this.lastCup = null;
        return ev.concat(this._finish(side, 'sameCup'));
      }
      ev.push({ type: 'miss', side, ball });
      if (this.queue.length) return ev;               // another ball still to come at it
      this.racks[this.defender] = rack.filter((k) => k.id !== this.lastCup);
      ev.push({ type: 'removed', side: this.defender, id: this.lastCup });
      this.lastCup = null;
      return ev.concat(this._cleared());
    }

    const hit = made ? rack.find((k) => k.id === made) : null;
    if (this.phase === 'rebuttal') {
      if (hit) {
        this.racks[this.defender] = rack.filter((k) => k.id !== made);
        ev.push({ type: 'made', side, ball, id: made, bounced, left: this.racks[this.defender].length });
        if (!this.racks[this.defender].length) return ev.concat(this._cleared());
        this.queue.unshift(ball);                        // that ball comes back
        return ev;
      }
      ev.push({ type: 'miss', side, ball });
      if (this.queue.length) return ev;                  // the other ball's go
      return ev.concat(this._finish(this.clearedBy, 'rebuttal'));
    }

    if (hit) {
      const s = ++this.streak[side][ball];
      this.pairRes[ball] = true;
      if (s === 2) ev.push({ type: 'heatingUp', side, ball });
      if (s >= 3) {
        if (s === 3) ev.push({ type: 'onFire', side, ball });
        this.queue.unshift(ball);                        // on fire: that ball comes back
      }
      const leftAfter = rack.length - 1;
      // ISLAND: the called cup went in. BOUNCE: it touched the table first. Each is one more cup,
      // picked by the defender (a challenge: owed, taken at the defender's next turn).
      const island = !!(called && made === called && leftAfter >= 1);
      const bounce = !!(this.bounce && bounced && leftAfter >= 1);
      const extra = (island ? 1 : 0) + (bounce ? 1 : 0);
      const flags = { ...(island ? { island: true } : {}), ...(bounce ? { bounce: true } : {}) };
      // THE LAST CUP with a ball still to throw - in hand, or coming back as balls back: it stands.
      const ballsBack = this.lastCupBack && !this.queue.length && this.pairRes[0] === true && this.pairRes[1] === true;
      if (leftAfter === 0 && (this.queue.length || ballsBack)) {
        this.lastCup = made;
        ev.push({ type: 'made', side, ball, id: made, bounced, lastCup: true, left: 1 });
        return ballsBack ? ev.concat(this._afterThrow()) : ev;
      }
      this.racks[this.defender] = rack.filter((k) => k.id !== made);
      ev.push({ type: 'made', side, ball, id: made, bounced, left: leftAfter, ...flags });
      if (leftAfter === 0) return ev.concat(this._cleared());
      if (extra && !this.async) {
        // Every cup left is owed: they all go now, no one needs to pick.
        if (extra >= leftAfter) {
          const ids = this.racks[this.defender].map((k) => k.id);
          this.racks[this.defender] = [];
          ev.push({ type: 'extraCleared', side: this.defender, ids });
          return ev.concat(this._cleared());
        }
        this.pendingPick = { picker: this.defender, n: extra, ...flags };
        ev.push({ type: 'islandPick', picker: this.defender, n: extra, ...flags });
        return ev;
      }
      // A CHALLENGE: the extra cups are owed, taken by the defender at its next turn.
      if (extra) {
        this.owed[this.defender] += extra;
        ev.push({ type: 'islandOwed', side: this.defender, n: this.owed[this.defender], add: extra, ...flags });
      }
      // Owed cups that are every cup left: the rack is cleared now.
      if (this.owed[this.defender] > 0 && this.racks[this.defender].length <= this.owed[this.defender]) {
        const ids = this.racks[this.defender].map((k) => k.id);
        this.racks[this.defender] = [];
        this.owed[this.defender] = 0;
        ev.push({ type: 'owedCleared', side: this.defender, ids });
        return ev.concat(this._cleared());
      }
      return ev.concat(this._afterThrow());
    }

    ev.push({ type: 'miss', side, ball });
    if (this.streak[side][ball] >= 3) ev.push({ type: 'cooled', side, ball });
    this.streak[side][ball] = 0;
    this.pairRes[ball] = false;
    return ev.concat(this._afterThrow());
  }

  /** After a throw that did not end anything: next ball, balls back, or the turn passes. */
  _afterThrow() {
    if (this.queue.length) return [];
    if (this.pairRes[0] === true && this.pairRes[1] === true) {
      this.queue = [0, 1];
      this.pairRes = [null, null];
      return [{ type: 'ballsBack', side: this.shooter }];
    }
    this.shooter = other(this.shooter);
    return [{ type: 'turnOver', next: this.shooter }];
  }

  /** The shooter has just emptied the rack. */
  _cleared() {
    const ev = [];
    const side = this.shooter;
    this.queue = [];
    this.owed = { a: 0, b: 0 };
    if (this.phase === 'rebuttal') {
      this.phase = 'overtime';
      this.racks.a = OVERTIME_CELLS.map((c, i) => ({ id: 'o' + i, ...c }));
      this.racks.b = OVERTIME_CELLS.map((c, i) => ({ id: 'o' + i, ...c }));
      this.streak = { a: [0, 0], b: [0, 0] };
      this.shooter = this.clearedBy;                     // the side that cleared first opens overtime
      this.clearedBy = null;
      ev.push({ type: 'overtime', next: this.shooter });
      ev.push({ type: 'turnOver', next: this.shooter });
      return ev;
    }
    this.clearedBy = side;
    this.phase = 'rebuttal';
    this.shooter = other(side);
    ev.push({ type: 'rackCleared', side });
    ev.push({ type: 'turnOver', next: this.shooter });
    return ev;
  }

  _finish(winner, how) {
    this.over = true;
    this.winner = winner;
    this.how = how;
    this.queue = [];
    return [{ type: 'win', side: winner, how }];
  }

  // --- saving a match (challenges) -------------------------------------------------------------
  /** Everything, as plain JSON. Unlimited reracks (Infinity) travel as 'inf'. */
  toJSON() {
    const enc = (n) => (Number.isFinite(n) ? n : 'inf');
    const cups = (r) => r.map((k) => ({ ...k }));
    return {
      v: 1, async: this.async, bounce: this.bounce, backRack: this.backRack, lastCupBack: this.lastCupBack, gentlemans: this.gentlemans, reracks: enc(this.reracks),
      racks: { a: cups(this.racks.a), b: cups(this.racks.b) },
      shooter: this.shooter, phase: this.phase, clearedBy: this.clearedBy,
      streak: { a: this.streak.a.slice(), b: this.streak.b.slice() },
      reracksLeft: { a: enc(this.reracksLeft.a), b: enc(this.reracksLeft.b) },
      islandUsed: { a: this.islandUsed.a.slice(), b: this.islandUsed.b.slice() }, owed: { ...this.owed },
      called: this.called, pendingPick: this.pendingPick ? { ...this.pendingPick } : null,
      lastCup: this.lastCup, queue: this.queue.slice(), pairRes: this.pairRes.slice(),
      turnThrows: this.turnThrows, rerackedThisTurn: !!this.rerackedThisTurn,
      turnNo: this.turnNo, throwsTaken: this.throwsTaken,
      over: this.over, winner: this.winner, how: this.how || null,
    };
  }

  static fromJSON(o) {
    const dec = (n) => (n === 'inf' || n === null ? Infinity : Number(n) || 0);
    const m = new Match({ gentlemans: o.gentlemans, reracks: dec(o.reracks), async: o.async, bounce: o.bounce === true, backRack: o.backRack !== false, lastCupBack: o.lastCupBack !== false });
    const cups = (r) => (Array.isArray(r) ? r : Object.values(r || {})).map((k) => ({ ...k }));
    const arr = (a, n, d) => { const x = Array.isArray(a) ? a.slice() : Object.values(a || {}); while (x.length < n) x.push(d); return x; };
    m.racks = { a: cups((o.racks || {}).a), b: cups((o.racks || {}).b) };
    m.shooter = o.shooter === 'b' ? 'b' : 'a';
    m.phase = ['normal', 'rebuttal', 'overtime'].includes(o.phase) ? o.phase : 'normal';
    m.clearedBy = o.clearedBy === 'a' || o.clearedBy === 'b' ? o.clearedBy : null;
    m.streak = { a: arr((o.streak || {}).a, 2, 0).map(Number), b: arr((o.streak || {}).b, 2, 0).map(Number) };
    m.reracksLeft = { a: dec((o.reracksLeft || {}).a), b: dec((o.reracksLeft || {}).b) };
    // Per ball since 2026-09-29; an older save held one flag a side, read as both balls used.
    const used = (v) => (Array.isArray(v) || (v && typeof v === 'object') ? arr(v, 2, false).slice(0, 2).map(Boolean) : [!!v, !!v]);
    m.islandUsed = { a: used((o.islandUsed || {}).a), b: used((o.islandUsed || {}).b) };
    m.owed = { a: ((o.owed || {}).a | 0), b: ((o.owed || {}).b | 0) };
    m.called = o.called || null;
    m.pendingPick = o.pendingPick || null;
    m.lastCup = o.lastCup || null;
    m.queue = arr(o.queue, 0).map(Number);
    m.pairRes = arr(o.pairRes, 2, null).map((v) => (v === true ? true : v === false ? false : null));
    m.turnThrows = o.turnThrows | 0;
    m.rerackedThisTurn = !!o.rerackedThisTurn;
    m.turnNo = o.turnNo | 0;
    m.throwsTaken = o.throwsTaken | 0;
    m.over = !!o.over;
    m.winner = o.winner === 'a' || o.winner === 'b' ? o.winner : null;
    m.how = o.how || null;
    return m;
  }
}

/** A saved match turned round: side 'a' becomes 'b' and back. The phone playing a challenge is
 *  always 'a' (its own red cups, near the camera), whichever side it holds in the stored game. */
export function swapSides(o) {
  const sw = (s) => (s === 'a' ? 'b' : s === 'b' ? 'a' : s);
  const pair = (x) => (x && typeof x === 'object' ? { a: x.b, b: x.a } : x);
  return {
    ...o,
    racks: pair(o.racks), streak: pair(o.streak), reracksLeft: pair(o.reracksLeft),
    islandUsed: pair(o.islandUsed), owed: pair(o.owed),
    shooter: sw(o.shooter), clearedBy: sw(o.clearedBy), winner: sw(o.winner),
    pendingPick: o.pendingPick ? { ...o.pendingPick, picker: sw(o.pendingPick.picker) } : null,
  };
}

export default { Match, BALLS, OVERTIME_CELLS, swapSides };
