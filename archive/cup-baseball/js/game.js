// cup-baseball/js/game.js - THE RULES. Pure: no DOM, no engine, no storage.
//
// Matt's house rules (2026-10-23): four cups in a line on each end of the table, single nearest the
// shooter, then double, triple, home run at the far end. The batting side throws; a ball in a cup is
// that hit. TWO outs and the sides switch. No defensive shot back.
//
// Strikes (Matt, 2026-10-28): a ball that touches the table or a cup and stays out of every cup is a
// STRIKE; the batter's second strike is an out. A ball that misses the table completely is an out.
// Strikes reset after every hit and every out.
//
// Base running is the drinking game's: every runner moves as many bases as the batter (a double
// moves a runner on first to third). A runner who reaches home scores.
//
// End of game is real baseball's: after the last inning the side ahead wins; the side batting
// second does not bat in the last inning if it is already ahead, and wins the moment it goes ahead
// there (walk-off). A tie after the last inning plays extra innings until it is broken.
//
// Public surface: new Game({ innings, first }), g.throwResult(hit, strike) -> events, g.batting,
// g.fielding, plus read-only state for the screen.

export const OUTS = 2;
export const STRIKES = 2;                 // the second strike is an out
export const HITS = [1, 2, 3, 4];          // single, double, triple, home run
export const INNINGS = [3, 5, 9];

export class Game {
  /** `first` is the side that bats first ('a' or 'b'); the other bats second (the home side). */
  constructor({ innings = 5, first = 'a' } = {}) {
    this.innings = INNINGS.includes(innings) ? innings : 5;
    this.first = first === 'b' ? 'b' : 'a';
    this.second = this.first === 'a' ? 'b' : 'a';
    this.inning = 1;
    this.half = 0;                         // 0 = top (first side bats), 1 = bottom
    this.outs = 0;
    this.strikes = 0;
    this.bases = [false, false, false];    // first, second, third
    this.runs = { a: 0, b: 0 };
    this.line = { [this.first]: [0], [this.second]: [] };   // runs per inning, as a scoreboard shows them
    this.hits = { a: 0, b: 0 };
    this.throws = 0;
    this.over = false;
    this.winner = null;
  }

  get batting() { return this.half === 0 ? this.first : this.second; }
  get fielding() { return this.half === 0 ? this.second : this.first; }

  /** One throw. `hit` is 1-4 (the cup it went in) or 0 / null for no cup; `strike` is true when that
   *  ball touched the table or a cup (false = it missed the table: an out). Returns the events. */
  throwResult(hit, strike = false) {
    if (this.over) return [];
    const ev = [];
    const side = this.batting;
    this.throws++;
    const n = HITS.includes(hit) ? hit : 0;
    if (!n && strike) {
      this.strikes++;
      ev.push({ type: 'strike', side, strikes: this.strikes });
      if (this.strikes < STRIKES) return ev;
    }
    this.strikes = 0;
    if (!n) {
      this.outs++;
      ev.push({ type: 'out', side, outs: this.outs });
      if (this.outs >= OUTS) this._endHalf(ev);
      return ev;
    }
    this.hits[side]++;
    // Every runner moves n bases, the batter included (the batter starts at "base 0").
    let scored = 0;
    const next = [false, false, false];
    for (let b = 2; b >= 0; b--) {
      if (!this.bases[b]) continue;
      const to = b + 1 + n;                // base index 0..2, 3+ is home
      if (to >= 4) scored++; else next[to - 1] = true;
    }
    if (n >= 4) scored++; else next[n - 1] = true;
    this.bases = next;
    this._score(side, scored);
    ev.push({ type: 'hit', side, n, runs: scored });
    // WALK-OFF: the side batting second goes ahead in the last inning (or later) and it is over.
    if (this.half === 1 && this.inning >= this.innings && this.runs[this.second] > this.runs[this.first]) {
      this._win(this.second, ev);
    }
    return ev;
  }

  _score(side, n) {
    if (!n) return;
    this.runs[side] += n;
    const L = this.line[side];
    L[L.length - 1] += n;
  }

  _endHalf(ev) {
    const last = this.inning >= this.innings;
    if (this.half === 0) {
      // The side batting second is already ahead after the top of the last inning: no need to bat.
      if (last && this.runs[this.second] > this.runs[this.first]) { this._win(this.second, ev); return; }
      this.half = 1;
      this.line[this.second].push(0);
    } else {
      if (last && this.runs.a !== this.runs.b) {
        this._win(this.runs.a > this.runs.b ? 'a' : 'b', ev);
        return;
      }
      this.inning++;
      this.half = 0;
      this.line[this.first].push(0);
      if (this.inning > this.innings) ev.push({ type: 'extra', inning: this.inning });
    }
    this.outs = 0;
    this.bases = [false, false, false];
    ev.push({ type: 'side', batting: this.batting, inning: this.inning, half: this.half });
  }

  _win(side, ev) {
    this.over = true;
    this.winner = side;
    ev.push({ type: 'win', side });
  }

  /** The game as plain data (ui.js saves it, 2026-11-06). */
  toJSON() {
    return {
      innings: this.innings, first: this.first, inning: this.inning, half: this.half, outs: this.outs,
      strikes: this.strikes, bases: this.bases.slice(), runs: { ...this.runs },
      line: { a: (this.line.a || []).slice(), b: (this.line.b || []).slice() }, hits: { ...this.hits },
      throws: this.throws, over: this.over, winner: this.winner,
    };
  }

  /** A game from toJSON()'s data, exactly as it stood; throws on anything malformed. */
  static fromJSON(o) {
    const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    const runsOk = (r) => r && int(r.a, 0, 1e6) && int(r.b, 0, 1e6);
    const lineOk = (L) => Array.isArray(L) && L.length <= 1000 && L.every((v) => int(v, 0, 1e6));
    if (!o || !INNINGS.includes(o.innings) || !(o.first === 'a' || o.first === 'b')
      || !int(o.inning, 1, 1000) || !int(o.half, 0, 1) || !int(o.outs, 0, OUTS - 1) || !int(o.strikes, 0, STRIKES - 1)
      || !Array.isArray(o.bases) || o.bases.length !== 3 || !runsOk(o.runs) || !runsOk(o.hits)
      || !o.line || !lineOk(o.line.a) || !lineOk(o.line.b) || !int(o.throws, 0, 1e6)) throw new Error('bad saved game');
    const g = new Game({ innings: o.innings, first: o.first });
    g.inning = o.inning; g.half = o.half; g.outs = o.outs; g.strikes = o.strikes;
    g.bases = o.bases.map((b) => !!b);
    g.runs = { a: o.runs.a, b: o.runs.b };
    g.line = { a: o.line.a.slice(), b: o.line.b.slice() };
    g.hits = { a: o.hits.a, b: o.hits.b };
    g.throws = o.throws;
    g.over = !!o.over;
    g.winner = o.winner === 'a' || o.winner === 'b' ? o.winner : null;
    return g;
  }
}

export default { Game, OUTS, STRIKES, HITS, INNINGS };
