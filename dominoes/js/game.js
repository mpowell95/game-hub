// dominoes/js/game.js — the All Fives rules engine. PURE: no DOM, no timers, no storage, so it
// unit-tests headless with `node dominoes/js/test.js`.
//
// A tile is an ID (0..27) into TILES, the canonical double-six set in a fixed order, so hands,
// the boneyard and the chain all travel as plain integer arrays and a snapshot is JSON already.
//
// The chain is stored as THREE ordered arrays plus two ids, never as a grid — the grid is
// board.js's job, recomputed from these on every render (see dominoes/CLAUDE.md, "Two models"):
//   line[]  the main run, index 0 = the left-facing end, last = the right-facing end.
//           Each entry is { id, a, b }: `a` faces left, `b` faces right, so
//           line[i].b === line[i+1].a always holds.
//   up[]/down[]  the two spinner branches, ordered from the spinner OUTWARD.
//           Each entry is { id, a, b }: `a` is the inner half (the one that matched), `b` outer.
//   spinnerId  the FIRST double played, or null. originId  the first tile of the round.

export const TILES = (() => {
  const t = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]);
  return t;                                    // 28 tiles, [0,0] .. [6,6]
})();

export const pipsOf = (id) => TILES[id];
export const isDouble = (id) => TILES[id][0] === TILES[id][1];
export const tileSum = (id) => TILES[id][0] + TILES[id][1];
export const handSum = (ids) => ids.reduce((s, id) => s + tileSum(id), 0);

/** Seeded PRNG so a test (or a replayed round) can be deterministic. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(list, rnd) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const SIDES = ['left', 'right', 'up', 'down'];

/** The four arm arrays of a chain, as plain data, so placement can be simulated on a copy
 *  without touching the live game (the AI's one-ply lookahead depends on this). */
const cloneChain = (c) => ({
  line: c.line.map((e) => ({ ...e })),
  up: c.up.map((e) => ({ ...e })),
  down: c.down.map((e) => ({ ...e })),
  spinnerId: c.spinnerId,
  originId: c.originId,
});

/** Index of the spinner within `line`, or -1. */
export function spinnerIndex(c) {
  return c.spinnerId == null ? -1 : c.line.findIndex((e) => e.id === c.spinnerId);
}

/** The spinner's two perpendicular sides only open once the main line has a tile on BOTH of its
 *  in-line sides — the standard All Fives rule. Before that the spinner is just a double at an
 *  end and its full value is already counted there (see countEnds). */
export function branchesOpen(c) {
  const i = spinnerIndex(c);
  return i > 0 && i < c.line.length - 1;
}

/** Every side a tile could legally be added to. Each entry carries BOTH numbers, and the
 *  distinction is the whole reason this bug existed:
 *    `value`   the pip you must MATCH to play there
 *    `contrib` what that end adds to the All Fives count
 *  They differ for a double at the end of a run, which lies crosswise and so exposes both of its
 *  halves (a 6-6 at an end contributes 12, but you still play a 6 on it). `countEnds` is now
 *  literally the sum of `contrib`, so what the board shows and what it scores cannot drift apart.
 *  An empty chain returns a single opening pseudo-end. */
export function openEnds(c) {
  if (!c.line.length) return [{ side: 'right', value: null, contrib: 0 }];
  const last = c.line[c.line.length - 1];
  const first = c.line[0];
  // The round's opening tile alone is BOTH ends at once, so its halves are one each and a 5-5
  // opener counts 10, not 20. Every other double at a run end doubles.
  const lone = c.line.length === 1 && !c.up.length && !c.down.length;
  const dbl = (e) => e.a === e.b;
  const ends = [
    { side: 'left', value: first.a, contrib: (!lone && dbl(first)) ? first.a * 2 : first.a },
    { side: 'right', value: last.b, contrib: (!lone && dbl(last)) ? last.b * 2 : last.b },
  ];
  for (const side of ['up', 'down']) {
    const arm = c[side];
    if (arm.length) {
      const T = arm[arm.length - 1];
      ends.push({ side, value: T.b, contrib: dbl(T) ? T.b * 2 : T.b });
    } else if (branchesOpen(c)) {
      // An OPEN but unplayed branch side. It exposes one half of the spinner, so the two of them
      // together contribute the spinner's full value - which is the main spec's "while the
      // spinner has no arms yet, it counts as a single end of its full value", arrived at from
      // the other direction. Leaving these out of the count (while still drawing a badge for
      // each and accepting plays on them) is the scoring bug this replaced.
      const v = TILES[c.spinnerId][0];
      ends.push({ side, value: v, contrib: v });
    }
  }
  return ends;
}

/** The All Fives count: the sum of what every open end contributes. One line, because openEnds
 *  above already carries the per-end contribution - the two used to compute the ends separately
 *  and disagreed with each other (see its comment). */
export function countEnds(c) {
  return openEnds(c).reduce((sum, e) => sum + e.contrib, 0);
}

/** Place `tileId` on `side` of a chain, MUTATING it. Assumes the move is legal. */
export function placeOn(c, tileId, side) {
  const [p, q] = TILES[tileId];
  if (!c.line.length) {
    c.line.push({ id: tileId, a: p, b: q });
    c.originId = tileId;
    if (p === q) c.spinnerId = tileId;
    return;
  }
  const ends = openEnds(c);
  const match = ends.find((e) => e.side === side).value;
  const inner = match, outer = (p === match) ? q : p;
  if (side === 'left') c.line.unshift({ id: tileId, a: outer, b: inner });
  else if (side === 'right') c.line.push({ id: tileId, a: inner, b: outer });
  else c[side].push({ id: tileId, a: inner, b: outer });
  if (c.spinnerId == null && p === q) c.spinnerId = tileId;
}

/** Every legal { tileId, side } for a hand against a chain. A tile that fits two ends yields two
 *  moves; the UI turns that into "tap the tile, then tap an end badge". */
export function legalMoves(c, hand) {
  const out = [];
  const ends = openEnds(c);
  for (const id of hand) {
    const [p, q] = TILES[id];
    for (const e of ends) {
      if (e.value == null || p === e.value || q === e.value) out.push({ tileId: id, side: e.side });
    }
  }
  return out;
}

/** The count the board would show AFTER `move`, without touching the live chain. */
export function countAfter(c, move) {
  const sim = cloneChain(c);
  placeOn(sim, move.tileId, move.side);
  return countEnds(sim);
}

/** All Fives scores the count only when it is a non-zero multiple of five. */
export const scoreOf = (count) => (count > 0 && count % 5 === 0 ? count : 0);

export const HUMAN = 0;
export const BOT = 1;

export class DominoesGame {
  /** @param {{ target?: number, handSize?: number, rng?: () => number }} opts */
  constructor(opts = {}) {
    this.target = opts.target || 300;
    this.handSize = opts.handSize || 7;
    this.rng = opts.rng || Math.random;
    this.scores = [0, 0];
    this.round = 0;
    this.phase = 'idle';            // idle | playing | roundOver | matchOver
    this.hands = [[], []];
    this.boneyard = [];
    this.line = []; this.up = []; this.down = [];
    this.spinnerId = null; this.originId = null;
    this.turn = 0;
    this.passes = 0;
    this.roundScore = [0, 0];
    this.roundWinner = null;
    this.roundEndReason = null;     // 'out' | 'blocked'
    this.openerTileId = null;       // the forced opening lead of the current round
    this.matchWinner = null;
    // Values a seat is KNOWN to be missing, inferred from every draw and pass it makes. Read by
    // the Hard bot only; kept on the engine so it survives a save/restore like everything else.
    this.voids = [[], []];
  }

  // --- chain view (the four functions above, bound to this game) ---------------------------
  get chain() { return { line: this.line, up: this.up, down: this.down, spinnerId: this.spinnerId, originId: this.originId }; }
  openEnds() { return openEnds(this.chain); }
  countEnds() { return countEnds(this.chain); }
  /** Legal moves for a seat. On an EMPTY board only one move exists for the whole table: the
   *  round's forced opening lead (addendum A3), so the opener has no choice and the first tile
   *  is always the highest double in play. */
  legalMoves(seat) {
    if (!this.line.length) {
      return this.hands[seat].indexOf(this.openerTileId) >= 0
        ? [{ tileId: this.openerTileId, side: 'right' }]
        : [];
    }
    return legalMoves(this.chain, this.hands[seat]);
  }
  canPlay(seat) { return this.legalMoves(seat).length > 0; }
  branchesOpen() { return branchesOpen(this.chain); }

  // --- match / round lifecycle --------------------------------------------------------------

  startMatch() {
    this.scores = [0, 0];
    this.round = 0;
    this.matchWinner = null;
    this.startRound();
  }

  /** Deal a fresh round. EVERY round is opened by the highest double in play, led by whoever
   *  was dealt it, and the lead is FORCED (addendum A3: "the very first tile is always a double
   *  and always the spinner"). There is deliberately no "previous round's winner leads" rule and
   *  no free choice of opening tile; see dominoes/CLAUDE.md for why A3 supersedes the main
   *  spec's §7.2 on both counts. The heaviest-tile fallback below only fires when all seven
   *  doubles sat in the boneyard, which is the one case where the round opens without a
   *  spinner — the engine handles that unchanged, the first double played later becomes it. */
  startRound() {
    const deck = shuffled(TILES.map((_, i) => i), this.rng);
    this.hands = [deck.slice(0, this.handSize), deck.slice(this.handSize, this.handSize * 2)];
    this.boneyard = deck.slice(this.handSize * 2);
    this.line = []; this.up = []; this.down = [];
    this.spinnerId = null; this.originId = null;
    this.passes = 0;
    this.roundScore = [0, 0];
    this.roundWinner = null;
    this.roundEndReason = null;
    this.voids = [[], []];
    this.round += 1;
    const opener = this._openingLead();
    this.openerTileId = opener.tileId;
    this.turn = opener.seat;
    this.phase = 'playing';
    return this;
  }

  /** The forced opening lead: the highest double dealt to either hand, or (only when all seven
   *  doubles are in the boneyard) the heaviest tile. Weight ties fall to seat 0. */
  _openingLead() {
    let best = -1, seat = HUMAN, tileId = null;
    for (const s of [HUMAN, BOT]) {
      for (const id of this.hands[s]) {
        if (!isDouble(id)) continue;
        if (TILES[id][0] > best) { best = TILES[id][0]; seat = s; tileId = id; }
      }
    }
    if (tileId != null) return { seat, tileId };
    best = -1;
    for (const s of [HUMAN, BOT]) {
      for (const id of this.hands[s]) {
        const w = tileSum(id) * 10 + Math.max(...TILES[id]);
        if (w > best) { best = w; seat = s; tileId = id; }
      }
    }
    return { seat, tileId };
  }

  // --- turns ---------------------------------------------------------------------------------

  /** What `seat` is required to do right now: 'play' | 'draw' | 'pass'. */
  requiredAction(seat) {
    if (this.canPlay(seat)) return 'play';
    return this.boneyard.length ? 'draw' : 'pass';
  }

  /** Play one tile. Returns a result the UI animates from:
   *  { ok, tileId, side, count, scored, roundOver, matchOver, wentOut, bonus }. */
  play(seat, tileId, side) {
    if (this.phase !== 'playing' || this.turn !== seat) return { ok: false };
    const hand = this.hands[seat];
    if (hand.indexOf(tileId) < 0) return { ok: false };
    const legal = this.legalMoves(seat).some((m) => m.tileId === tileId && m.side === side);
    if (!legal) return { ok: false };

    placeOn(this, tileId, side);                 // `this` satisfies the chain shape
    hand.splice(hand.indexOf(tileId), 1);
    this.passes = 0;

    const count = this.countEnds();
    const scored = scoreOf(count);
    if (scored) this._award(seat, scored);

    const res = { ok: true, seat, tileId, side, count, scored, roundOver: false, matchOver: false, wentOut: false, bonus: 0 };

    if (!hand.length) {
      res.wentOut = true;
      res.bonus = handSum(this.hands[1 - seat]);
      this._settleRound(seat, 'out');
    } else if (this._deadlocked()) {
      this._settleBlocked();
    } else {
      this.turn = 1 - seat;
    }
    res.roundOver = this.phase !== 'playing';
    res.matchOver = this.phase === 'matchOver';
    return res;
  }

  /** Draw one tile. Only legal when the seat genuinely cannot play and the boneyard is not
   *  empty — "draw until you can play" is the rule, not "draw whenever you feel like it". */
  draw(seat) {
    if (this.phase !== 'playing' || this.turn !== seat) return { ok: false };
    if (this.canPlay(seat) || !this.boneyard.length) return { ok: false };
    this._noteVoids(seat);
    const idx = Math.floor(this.rng() * this.boneyard.length);
    const [tileId] = this.boneyard.splice(idx, 1);
    this.hands[seat].push(tileId);
    return { ok: true, tileId, canPlay: this.canPlay(seat), boneyard: this.boneyard.length };
  }

  /** Draw a SPECIFIC tile from the boneyard by id — the human's drawer lets them pick which
   *  face-down tile to take, and picking must not be secretly re-randomised. */
  drawTile(seat, tileId) {
    if (this.phase !== 'playing' || this.turn !== seat) return { ok: false };
    if (this.canPlay(seat)) return { ok: false };
    const idx = this.boneyard.indexOf(tileId);
    if (idx < 0) return { ok: false };
    this._noteVoids(seat);
    this.boneyard.splice(idx, 1);
    this.hands[seat].push(tileId);
    return { ok: true, tileId, canPlay: this.canPlay(seat), boneyard: this.boneyard.length };
  }

  /** Pass. Only legal with no play and an empty boneyard. Two passes in a row block the round. */
  pass(seat) {
    if (this.phase !== 'playing' || this.turn !== seat) return { ok: false };
    if (this.canPlay(seat) || this.boneyard.length) return { ok: false };
    this._noteVoids(seat);
    this.passes += 1;
    if (this.passes >= 2) { this._settleBlocked(); return { ok: true, roundOver: true, matchOver: this.phase === 'matchOver' }; }
    this.turn = 1 - seat;
    return { ok: true, roundOver: false, matchOver: false };
  }

  /** Neither side can move and the boneyard is empty: the round is over even though nobody has
   *  passed yet. Checked after every placement so a game can never sit in a dead state. */
  _deadlocked() {
    return !this.boneyard.length && !this.canPlay(0) && !this.canPlay(1);
  }

  _noteVoids(seat) {
    const v = this.voids[seat];
    for (const e of this.openEnds()) {
      if (e.value != null && v.indexOf(e.value) < 0) v.push(e.value);
    }
  }

  _award(seat, points) {
    this.scores[seat] += points;
    this.roundScore[seat] += points;
  }

  /** Blocked round: nobody went out, so the "winner" is only who is left holding less (it decides
   *  nothing but the modal's medal). Equal hands leave it null rather than inventing a winner —
   *  both sides still score, because under A1 scoring does not depend on who won. */
  _settleBlocked() {
    const mine = handSum(this.hands[0]), theirs = handSum(this.hands[1]);
    this._settleRound(mine === theirs ? null : (mine < theirs ? 0 : 1), 'blocked');
  }

  /** Settle the round. **BOTH players score the pips left in their OPPONENT's hand** (addendum
   *  A1) — going out is simply the case where one of those two totals is zero, and a blocked
   *  round pays each side the other's leftovers rather than paying one side the difference.
   *  These are raw pip counts, never rounded to a five, which is why a round total like 31 is
   *  legitimate while an in-play score never is.
   *
   *  Because both sides can gain at once, BOTH can cross the target in the same settle, so the
   *  match can genuinely end level — `matchWinner` is null for a draw and every caller has to
   *  cope with that (js/game-stats.js's `dm.tied`, the finished card's medal-less rows). */
  _settleRound(winner, reason) {
    this._award(0, handSum(this.hands[1]));
    this._award(1, handSum(this.hands[0]));
    this.roundWinner = winner;
    this.roundEndReason = reason;
    // "Reach OR PASS the target" (addendum A4): a final total of 304 is a normal win.
    if (Math.max(this.scores[0], this.scores[1]) >= this.target) {
      this.matchWinner = this.scores[0] === this.scores[1] ? null : (this.scores[0] > this.scores[1] ? 0 : 1);
      this.phase = 'matchOver';
    } else {
      this.phase = 'roundOver';
    }
  }

  // --- persistence ---------------------------------------------------------------------------

  snapshot() {
    return {
      target: this.target, handSize: this.handSize,
      scores: this.scores.slice(), round: this.round, openerTileId: this.openerTileId,
      phase: this.phase, hands: this.hands.map((h) => h.slice()), boneyard: this.boneyard.slice(),
      line: this.line.map((e) => ({ ...e })), up: this.up.map((e) => ({ ...e })), down: this.down.map((e) => ({ ...e })),
      spinnerId: this.spinnerId, originId: this.originId,
      turn: this.turn, passes: this.passes, roundScore: this.roundScore.slice(),
      roundWinner: this.roundWinner, roundEndReason: this.roundEndReason, matchWinner: this.matchWinner,
      voids: this.voids.map((v) => v.slice()),
    };
  }

  static fromSnapshot(snap, opts = {}) {
    const g = new DominoesGame({ target: snap.target, handSize: snap.handSize, rng: opts.rng });
    Object.assign(g, {
      scores: snap.scores.slice(), round: snap.round, openerTileId: snap.openerTileId, phase: snap.phase,
      hands: snap.hands.map((h) => h.slice()), boneyard: snap.boneyard.slice(),
      line: snap.line.map((e) => ({ ...e })), up: snap.up.map((e) => ({ ...e })), down: snap.down.map((e) => ({ ...e })),
      spinnerId: snap.spinnerId, originId: snap.originId, turn: snap.turn, passes: snap.passes,
      roundScore: snap.roundScore.slice(), roundWinner: snap.roundWinner,
      roundEndReason: snap.roundEndReason, matchWinner: snap.matchWinner,
      voids: (snap.voids || [[], []]).map((v) => v.slice()),
    });
    return g;
  }
}

export default {
  TILES, pipsOf, isDouble, tileSum, handSum, mulberry32, shuffled,
  openEnds, countEnds, countAfter, legalMoves, placeOn, scoreOf, branchesOpen, spinnerIndex,
  DominoesGame, HUMAN, BOT, SIDES,
};
