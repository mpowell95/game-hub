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

/** Every side a tile could legally be added to, as { side, value }. An empty chain returns a
 *  single { side: 'left', value: null } meaning "anything opens". */
export function openEnds(c) {
  // An empty board offers ONE pseudo-end so an opening lead is a single move per tile, not two
  // identical ones; placeOn ignores the side while the chain is empty.
  if (!c.line.length) return [{ side: 'right', value: null }];
  const last = c.line[c.line.length - 1];
  const ends = [
    { side: 'left', value: c.line[0].a },
    { side: 'right', value: last.b },
  ];
  for (const side of ['up', 'down']) {
    const arm = c[side];
    if (arm.length) ends.push({ side, value: arm[arm.length - 1].b });
    else if (branchesOpen(c)) ends.push({ side, value: TILES[c.spinnerId][0] });
  }
  return ends;
}

/** The All Fives count: the sum of the open ends. A double at an end contributes BOTH halves.
 *  Two rules that trip people up, both from the spec:
 *   - a lone first tile counts once (a 5-5 opener is 10, not 20 — it is one end, not two);
 *   - the spinner's unplayed perpendicular sides are NOT ends yet, so an interior spinner
 *     contributes nothing of its own. */
export function countEnds(c) {
  if (!c.line.length) return 0;
  if (c.line.length === 1 && !c.up.length && !c.down.length) {
    const e = c.line[0];
    return e.a === e.b ? e.a * 2 : e.a + e.b;
  }
  const L = c.line[0], R = c.line[c.line.length - 1];
  let sum = (L.a === L.b ? L.a * 2 : L.a) + (R.a === R.b ? R.b * 2 : R.b);
  for (const side of ['up', 'down']) {
    const arm = c[side];
    if (!arm.length) continue;
    const T = arm[arm.length - 1];
    sum += T.a === T.b ? T.b * 2 : T.b;
  }
  return sum;
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
    this.leader = null;             // seat that opens the next round (null = decide by highest double)
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
    this.matchWinner = null;
    // Values a seat is KNOWN to be missing, inferred from every draw and pass it makes. Read by
    // the Hard bot only; kept on the engine so it survives a save/restore like everything else.
    this.voids = [[], []];
  }

  // --- chain view (the four functions above, bound to this game) ---------------------------
  get chain() { return { line: this.line, up: this.up, down: this.down, spinnerId: this.spinnerId, originId: this.originId }; }
  openEnds() { return openEnds(this.chain); }
  countEnds() { return countEnds(this.chain); }
  legalMoves(seat) { return legalMoves(this.chain, this.hands[seat]); }
  canPlay(seat) { return this.legalMoves(seat).length > 0; }
  branchesOpen() { return branchesOpen(this.chain); }

  // --- match / round lifecycle --------------------------------------------------------------

  startMatch() {
    this.scores = [0, 0];
    this.round = 0;
    this.leader = null;
    this.matchWinner = null;
    this.startRound();
  }

  /** Deal a fresh round. Round 1's opener is whoever holds the highest double (the highest tile
   *  if neither does); later rounds are opened by the previous round's winner. The opener may
   *  lead ANY tile — the traditional "and must lead it" clause is deliberately not enforced, so
   *  every round starts with a real choice (see dominoes/CLAUDE.md). */
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
    this.turn = this.leader == null ? this._openingSeat() : this.leader;
    this.phase = 'playing';
    return this;
  }

  /** Highest double wins the lead; with no double dealt to either hand, the heaviest tile does.
   *  Ties (impossible for doubles, possible for weight) fall to seat 0. */
  _openingSeat() {
    let best = -1, seat = HUMAN;
    for (const s of [HUMAN, BOT]) {
      for (const id of this.hands[s]) {
        if (!isDouble(id)) continue;
        if (TILES[id][0] > best) { best = TILES[id][0]; seat = s; }
      }
    }
    if (best >= 0) return seat;
    best = -1;
    for (const s of [HUMAN, BOT]) {
      for (const id of this.hands[s]) {
        const w = tileSum(id) * 10 + Math.max(...TILES[id]);
        if (w > best) { best = w; seat = s; }
      }
    }
    return seat;
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
      // Going out: the raw pip total left in the opponent's hand, never rounded to a five —
      // which is why a round total like 31 is legitimate while an in-play score never is.
      const bonus = handSum(this.hands[1 - seat]);
      if (bonus) this._award(seat, bonus);
      res.wentOut = true;
      res.bonus = bonus;
      this._endRound(seat, 'out');
    } else if (this._deadlocked()) {
      this._endBlocked();
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
    if (this.passes >= 2) { this._endBlocked(); return { ok: true, roundOver: true, matchOver: this.phase === 'matchOver' }; }
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

  /** Blocked round: the lower pip total takes the DIFFERENCE. Equal totals score nothing and
   *  leave the lead where it was, rather than inventing a winner. */
  _endBlocked() {
    const mine = handSum(this.hands[0]), theirs = handSum(this.hands[1]);
    if (mine === theirs) { this._endRound(null, 'blocked'); return; }
    const winner = mine < theirs ? 0 : 1;
    this._award(winner, Math.abs(theirs - mine));
    this._endRound(winner, 'blocked');
  }

  _endRound(winner, reason) {
    this.roundWinner = winner;
    this.roundEndReason = reason;
    this.leader = winner == null ? this.leader : winner;
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
      scores: this.scores.slice(), round: this.round, leader: this.leader,
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
      scores: snap.scores.slice(), round: snap.round, leader: snap.leader, phase: snap.phase,
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
