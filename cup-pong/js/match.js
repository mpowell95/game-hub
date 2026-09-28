// cup-pong/js/match.js - THE RULES OF A MATCH. Pure: no DOM, no engine, no clock, no storage.
//
// The GamePigeon rules Matt confirmed line by line on 2026-09-27 (cup-pong/CLAUDE.md), plus his
// changes from docs/CUP-PONG-BRIEF.md:
//   - 10 cups a side, 4-3-2-1, point toward the shooter. A made cup is gone at once.
//   - A turn is 2 throws. Make BOTH and you get both balls back; that repeats.
//   - Cups made on 2 turns in a row = HEATING UP. Make one on the 3rd = ON FIRE: from that make you
//     shoot until you miss. The miss ends the turn and cools you off (the streak starts again).
//   - Win by clearing the other side's cups - but they get a REBUTTAL first: they shoot until they
//     miss. Clear everything in the rebuttal and it goes to OVERTIME: 3 cups each in a 2-1
//     triangle, normal rules, no reracks, Gentleman's still on. Otherwise the shooter wins.
//   - GENTLEMAN'S (setting, default on): when a side is down to exactly 2 cups, they are stood in a
//     straight line pointing at the shooter at the START of the shooter's next turn. Free: it is not
//     a rerack. Built as the rack preset `line2` applied automatically, so turning it into a button
//     later is one line.
//
// Sides are 'a' (the player on this phone, red cups) and 'b' (the opponent, blue). Each side's rack
// is stored in the SHOOTER'S frame - exactly as it looks to whoever throws at it - so the engine
// and the renderer never need to know whose rack is whose to place a cup.
//
// Everything that happens comes back as an EVENT from throwResult()/startTurn(), in order, so the
// screen can announce it and a replay (stage 5) can reproduce it.

import { makeRack, PRESETS, isSpot } from './rack.js';

export const THROWS_PER_TURN = 2;
const other = (s) => (s === 'a' ? 'b' : 'a');

/** Overtime's 2-1 triangle, at the back of the rack area, point toward the shooter. */
export const OVERTIME_CELLS = [{ c: -1, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 1 }];

const lineCells = () => PRESETS.line2;
const sameSpot = (k, s) => isSpot(k) && Math.abs(k.u - s.u) < 1e-9 && Math.abs(k.v - s.v) < 1e-9;

export class Match {
  /**
   * @param {object} o
   * @param {'a'|'b'} [o.first='a']     who shoots first
   * @param {boolean} [o.gentlemans=true]
   */
  constructor({ first = 'a', gentlemans = true } = {}) {
    this.gentlemans = !!gentlemans;
    this.racks = { a: makeRack('tri10'), b: makeRack('tri10') };
    this.shooter = first === 'b' ? 'b' : 'a';
    this.phase = 'normal';          // 'normal' | 'rebuttal' | 'overtime'
    this.clearedBy = null;          // who cleared the rack that started the current rebuttal
    this.streak = { a: 0, b: 0 };   // consecutive FINISHED turns with at least one make
    this.onFire = false;            // the current shooter is on fire (shoots until a miss)
    this.throwsLeft = THROWS_PER_TURN;
    this.pairMade = 0;              // makes in the current pair of throws (balls back needs 2)
    this.turnMade = 0;              // makes in the whole current turn
    this.turnNo = 0;
    this.throwsTaken = 0;
    this.over = false;
    this.winner = null;
    this.started = false;
  }

  /** The side being shot at. */
  get defender() { return other(this.shooter); }
  /** The rack being shot at, in the shooter's frame. */
  target() { return this.racks[this.defender]; }

  /** Is `side` heating up right now (the next make puts them on fire)? */
  heating(side) { return this.streak[side] >= 2; }

  /**
   * Begin the shooter's turn. Call once before each turn's first throw (including the very first).
   * Returns events: `gentlemans` when the target rack was stood in a line.
   */
  startTurn() {
    const ev = [];
    if (this.over) return ev;
    this.started = true;
    this.turnNo++;
    this.throwsLeft = this.phase === 'rebuttal' ? Infinity : THROWS_PER_TURN;
    this.pairMade = 0;
    this.turnMade = 0;
    this.onFire = false;
    const rack = this.target();
    if (this.gentlemans && rack.length === 2) {
      const line = lineCells();
      const inLine = rack.every((k) => line.some((s) => sameSpot(k, s)));
      if (!inLine) {
        const from = rack.map((k) => ({ ...k }));
        this.racks[this.defender] = rack.map((k, i) => ({ id: k.id, u: line[i].u, v: line[i].v }));
        ev.push({ type: 'gentlemans', side: this.defender, from, to: this.racks[this.defender] });
      }
    }
    if (this.phase === 'rebuttal') ev.push({ type: 'rebuttal', side: this.shooter });
    return ev;
  }

  /**
   * One throw has resolved. `made` is the id of the cup it went in, or null.
   * Returns the events it caused, in order. When a `turnOver` event comes back, call startTurn()
   * for the next shooter.
   */
  throwResult({ made = null, bounced = false } = {}) {
    const ev = [];
    if (this.over) return ev;
    this.throwsTaken++;
    const side = this.shooter;
    const rack = this.target();
    const hit = made ? rack.find((k) => k.id === made) : null;

    if (hit) {
      this.racks[this.defender] = rack.filter((k) => k.id !== made);
      this.turnMade++;
      this.pairMade++;
      ev.push({ type: 'made', side, id: made, bounced, left: this.racks[this.defender].length });

      // ON FIRE: a make on the third turn running.
      if (this.phase !== 'rebuttal' && !this.onFire && this.streak[side] >= 2) {
        this.onFire = true;
        ev.push({ type: 'onFire', side });
      }

      if (this.racks[this.defender].length === 0) return ev.concat(this._cleared());
    } else {
      ev.push({ type: 'miss', side });
      if (this.phase === 'rebuttal') {
        // The rebuttal ends at the first miss, and with it the match.
        return ev.concat(this._finish(this.clearedBy));
      }
      if (this.onFire) {
        // A miss puts the fire out and ends the turn, whatever throws were left.
        this.onFire = false;
        ev.push({ type: 'cooled', side });
        this.streak[side] = 0;
        return ev.concat(this._endTurn(false));
      }
    }

    if (this.phase === 'rebuttal' || this.onFire) return ev;   // shoot until a miss

    this.throwsLeft--;
    if (this.throwsLeft > 0) return ev;
    // End of a pair of throws.
    if (this.pairMade >= THROWS_PER_TURN) {
      this.throwsLeft = THROWS_PER_TURN;
      this.pairMade = 0;
      ev.push({ type: 'ballsBack', side });
      return ev;
    }
    return ev.concat(this._endTurn(true));
  }

  _endTurn(countStreak) {
    const ev = [];
    const side = this.shooter;
    if (countStreak) {
      const before = this.streak[side];
      this.streak[side] = this.turnMade > 0 ? before + 1 : 0;
      if (this.streak[side] === 2) ev.push({ type: 'heatingUp', side });
    }
    this.shooter = other(side);
    this.onFire = false;
    ev.push({ type: 'turnOver', next: this.shooter });
    return ev;
  }

  /** The shooter has just made the last cup. */
  _cleared() {
    const ev = [];
    const side = this.shooter;
    if (this.phase === 'rebuttal') {
      // The rebuttal cleared everything: overtime.
      this.phase = 'overtime';
      this.racks.a = OVERTIME_CELLS.map((c, i) => ({ id: 'o' + i, ...c }));
      this.racks.b = OVERTIME_CELLS.map((c, i) => ({ id: 'o' + i, ...c }));
      this.streak = { a: 0, b: 0 };
      this.onFire = false;
      // The side that cleared first opens overtime.
      this.shooter = this.clearedBy;
      this.clearedBy = null;
      ev.push({ type: 'overtime', next: this.shooter });
      ev.push({ type: 'turnOver', next: this.shooter });
      return ev;
    }
    // Normal play or overtime: the other side gets a rebuttal.
    this.clearedBy = side;
    this.phase = 'rebuttal';
    this.onFire = false;
    this.shooter = other(side);
    ev.push({ type: 'rackCleared', side });
    ev.push({ type: 'turnOver', next: this.shooter });
    return ev;
  }

  _finish(winner) {
    this.over = true;
    this.winner = winner;
    return [{ type: 'win', side: winner }];
  }

  /** A snapshot a replay or a test can compare. */
  snapshot() {
    return {
      racks: { a: this.racks.a.map((k) => ({ ...k })), b: this.racks.b.map((k) => ({ ...k })) },
      shooter: this.shooter, phase: this.phase, streak: { ...this.streak }, onFire: this.onFire,
      throwsLeft: this.throwsLeft, over: this.over, winner: this.winner,
    };
  }
}

export default { Match, THROWS_PER_TURN, OVERTIME_CELLS };
