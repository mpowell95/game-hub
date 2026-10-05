// engine.js - No-Limit Texas Hold'em, pure and DOM-free (runs headless under node).
//
// One object, `state`, holds a whole sit-and-go: every player's stack, the blind level, and the
// hand in progress (deck, hole cards, board, bets). It is plain JSON on purpose - the host device
// keeps it in localStorage between loads and a JSON string of its PUBLIC half is what the other
// seats read (see net-table.js). Every rule lives in here and nothing else decides one: the UI
// and the network layer only ever call `act()` and read the result.
//
// Cards are ints 0..51: rank = c >> 2 (0 = deuce .. 12 = ace), suit = c & 3 (s h d c).
//
// Format: a tournament. Everyone starts with the same stack, the blinds rise every N hands, a
// player with no chips is out, and the last player holding chips wins. That shape is what makes
// a result worth recording (a cash game has no finish line).

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const SUIT_GLYPH = ['♠', '♥', '♦', '♣'];

// Blind ladder (small blind; the big blind is double), in units of `cfg.scale`. The table opens at
// 50 big blinds, deep enough to play poker, and the ladder climbs about 1.5x a level so a full
// table of eight finishes in an evening rather than a week.
//
// 2026-09-27: new games are $10,000 stacks with $100/$200 blinds (scale 10), matching the app the
// look was cloned from. A game saved before that has no `cfg.scale` and keeps playing at scale 1
// with its 1,000-chip stacks, so a resumed game never changes size under a player.
export const BLINDS = [10, 15, 25, 40, 60, 100, 150, 250, 400, 600, 1000, 1500, 2500, 4000, 6000, 10000];
export const SPEEDS = { slow: 15, normal: 10, fast: 6 };
export const START_CHIPS = 10000;
export const START_SCALE = 10;
export const MAX_PLAYERS = 8;

export const cardRank = (c) => c >> 2;
export const cardSuit = (c) => c & 3;
export const cardText = (c) => RANKS[c >> 2] + SUIT_GLYPH[c & 3];

/** A fresh shuffled deck. `rand()` returns [0,1); crypto-backed by default so a hand can never be
 *  predicted from Math.random's seed. */
export function shuffledDeck(rand = cryptoRand) {
  const d = [];
  for (let i = 0; i < 52; i++) d.push(i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

export function cryptoRand() {
  try {
    const a = new Uint32Array(1);
    (globalThis.crypto || self.crypto).getRandomValues(a);
    return a[0] / 4294967296;
  } catch { return Math.random(); }
}

// ---------------------------------------------------------------------------------------------
// Hand evaluation
// ---------------------------------------------------------------------------------------------

// Categories, low to high. The score of a hand is cat * 13^5 + up to five kickers in base 13,
// so two hands compare with a plain `>`.
export const CAT = { HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL: 6, QUADS: 7, STRAIGHT_FLUSH: 8 };
const B = 13;
const B5 = B * B * B * B * B;

function kick(list) {
  let v = 0;
  for (let i = 0; i < 5; i++) v = v * B + (list[i] == null ? 0 : list[i]);
  return v;
}

/** Highest straight in a 13-bit rank mask, as its top rank (3 = five-high wheel), or -1. */
function straightTop(mask) {
  for (let top = 12; top >= 4; top--) {
    const need = 0x1f << (top - 4);
    if ((mask & need) === need) return top;
  }
  // A-2-3-4-5: ace (bit 12) plus 0..3.
  if ((mask & 0x100f) === 0x100f) return 3;
  return -1;
}

/** Score the best five-card hand in 5..7 cards. Higher is better. */
export function evaluate(cards) {
  const rc = new Array(13).fill(0);
  const sc = [0, 0, 0, 0];
  const sm = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = c >> 2, s = c & 3;
    rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
  }
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightTop(sm[flushSuit]);
    if (sf >= 0) return CAT.STRAIGHT_FLUSH * B5 + kick([sf]);
  }
  const quads = [], trips = [], pairs = [], singles = [];
  for (let r = 12; r >= 0; r--) {
    if (rc[r] === 4) quads.push(r);
    else if (rc[r] === 3) trips.push(r);
    else if (rc[r] === 2) pairs.push(r);
    else if (rc[r] === 1) singles.push(r);
  }
  if (quads.length) {
    const k = [...trips, ...pairs, ...singles].sort((a, b) => b - a)[0];
    return CAT.QUADS * B5 + kick([quads[0], k]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const pr = Math.max(trips[1] == null ? -1 : trips[1], pairs[0] == null ? -1 : pairs[0]);
    return CAT.FULL * B5 + kick([trips[0], pr]);
  }
  if (flushSuit >= 0) {
    const f = [];
    for (let r = 12; r >= 0 && f.length < 5; r--) if (sm[flushSuit] & (1 << r)) f.push(r);
    return CAT.FLUSH * B5 + kick(f);
  }
  const st = straightTop(mask);
  if (st >= 0) return CAT.STRAIGHT * B5 + kick([st]);
  if (trips.length) return CAT.TRIPS * B5 + kick([trips[0], ...singles.slice(0, 2)]);
  if (pairs.length >= 2) {
    const rest = [...pairs.slice(2), ...singles].sort((a, b) => b - a);
    return CAT.TWO_PAIR * B5 + kick([pairs[0], pairs[1], rest[0]]);
  }
  if (pairs.length) return CAT.PAIR * B5 + kick([pairs[0], ...singles.slice(0, 3)]);
  return CAT.HIGH * B5 + kick(singles.slice(0, 5));
}

export const categoryOf = (score) => Math.floor(score / B5);

/** The leading ranks of a score, for naming it ("Pair of Kings"). */
export function scoreRanks(score) {
  let v = score % B5;
  const out = [];
  for (let i = 0; i < 5; i++) { out.unshift(v % B); v = Math.floor(v / B); }
  return out;
}

/** The five cards that make the best hand (for highlighting), and its score. */
export function bestFive(cards) {
  if (cards.length <= 5) return { score: evaluate(cards), cards: cards.slice() };
  let best = -1, pick = null;
  const n = cards.length;
  const combo = (start, chosen) => {
    if (chosen.length === 5) {
      const five = chosen.map((i) => cards[i]);
      const s = evaluate(five);
      if (s > best) { best = s; pick = five; }
      return;
    }
    for (let i = start; i <= n - (5 - chosen.length); i++) combo(i + 1, [...chosen, i]);
  };
  combo(0, []);
  return { score: best, cards: pick };
}

// ---------------------------------------------------------------------------------------------
// Table state
// ---------------------------------------------------------------------------------------------

/** New tournament. `players` = [{ name, emoji, bot (0 human | 1-3 skill), seat (net seat|null) }]. */
export function newGame(players, cfg = {}) {
  const speed = SPEEDS[cfg.speed] ? cfg.speed : 'normal';
  const chips = cfg.chips > 0 ? cfg.chips | 0 : START_CHIPS;
  const scale = cfg.scale > 0 ? cfg.scale | 0 : START_SCALE;
  return {
    v: 1,
    cfg: { speed, chips, scale, buyin: cfg.buyin > 0 ? Math.floor(cfg.buyin) : 0, tier: cfg.tier || null },
    players: players.slice(0, MAX_PLAYERS).map((p, i) => ({
      id: i,
      name: String(p.name || 'Player').slice(0, 20),
      emoji: p.emoji || '\u{1F642}',
      bot: p.bot | 0,
      seat: p.seat == null ? null : p.seat,
      dev: p.dev || null,
      chips,
      out: false,
      left: false,
      away: false,
      place: 0,
    })),
    handNo: 0,
    level: 0,
    button: -1,
    hand: null,
    over: false,
    winner: -1,
    k: 0,        // bumps on every applied action; a stale remote action (wrong k) is refused
  };
}

export const blindsOf = (state) => {
  const sb = BLINDS[Math.min(state.level, BLINDS.length - 1)] * ((state.cfg && state.cfg.scale) || 1);
  return { sb, bb: sb * 2 };
};

const alive = (state) => state.players.filter((p) => !p.out);

function nextIdx(state, from, pred) {
  const n = state.players.length;
  for (let s = 1; s <= n; s++) {
    const i = (from + s + n) % n;
    if (pred(state.players[i], i)) return i;
  }
  return -1;
}

/** Deal the next hand: move the button, post blinds, deal two cards each. */
export function startHand(state, rand = cryptoRand) {
  if (state.over) return state;
  const live = alive(state);
  if (live.length < 2) return finishGame(state);

  state.handNo += 1;
  const per = SPEEDS[state.cfg.speed] || SPEEDS.normal;
  state.level = Math.min(BLINDS.length - 1, Math.floor((state.handNo - 1) / per));
  const { sb, bb } = blindsOf(state);

  const isLive = (p) => !p.out;
  state.button = nextIdx(state, state.button < 0 ? -1 : state.button, isLive);
  const headsUp = live.length === 2;
  // Heads-up the button IS the small blind and acts first before the flop.
  const sbIdx = headsUp ? state.button : nextIdx(state, state.button, isLive);
  const bbIdx = nextIdx(state, sbIdx, isLive);

  const deck = shuffledDeck(rand);
  const n = state.players.length;
  const h = {
    deck,
    holes: {},
    board: [],
    street: 'preflop',
    bets: new Array(n).fill(0),
    total: new Array(n).fill(0),
    folded: state.players.map((p) => p.out),
    allIn: new Array(n).fill(false),
    acted: new Array(n).fill(false),
    canRaise: new Array(n).fill(true),
    currentBet: 0,
    minRaise: bb,
    sbIdx, bbIdx, sb, bb,
    toAct: -1,
    last: new Array(n).fill(null),   // last action label per player, for the seat bubbles
    // Every action in order, for the "Last hand" replay (2026-09-28). Public information only (who
    // did what, and on which street), so it rides publicView to every seat unchanged.
    log: [],
    result: null,
  };
  state.hand = h;

  // Deal one at a time around the table, starting left of the button, like a real dealer.
  for (let round = 0; round < 2; round++) {
    let i = state.button;
    for (let c = 0; c < live.length; c++) {
      i = nextIdx(state, i, isLive);
      (h.holes[i] = h.holes[i] || []).push(deck.pop());
    }
  }

  post(state, sbIdx, sb, 'sb');
  post(state, bbIdx, bb, 'bb');
  h.currentBet = Math.max(...h.bets);
  // First to act preflop: left of the big blind (heads-up that is the button/small blind).
  h.toAct = firstToAct(state, bbIdx);
  state.k += 1;
  autoAdvance(state);
  return state;
}

function post(state, i, amt, label) {
  const p = state.players[i], h = state.hand;
  const pay = Math.min(p.chips, amt);
  p.chips -= pay; h.bets[i] += pay; h.total[i] += pay;
  if (p.chips === 0) h.allIn[i] = true;
  h.last[i] = { a: label, amt: pay };
  if (h.log) h.log.push({ i, a: label, amt: pay, st: 'preflop' });
}

const canAct = (h, i) => !h.folded[i] && !h.allIn[i];

function firstToAct(state, after) {
  const h = state.hand;
  return nextIdx(state, after, (p, i) => canAct(h, i));
}

/** What the player to act may do. `callAmt` 0 means a check is available. */
export function legal(state) {
  const h = state.hand;
  if (!h || h.toAct < 0 || h.result) return null;
  const i = h.toAct, p = state.players[i];
  const owe = h.currentBet - h.bets[i];
  const callAmt = Math.min(owe, p.chips);
  const maxTo = h.bets[i] + p.chips;                 // all-in, as a "raise to" total
  const minTo = Math.min(maxTo, h.currentBet + h.minRaise);
  const others = state.players.some((q, j) => j !== i && canAct(h, j));
  const canRaise = h.canRaise[i] && p.chips > owe && others;
  return {
    i,
    callAmt,
    canCheck: owe <= 0,
    canRaise: canRaise && maxTo > h.currentBet,
    minTo,
    maxTo,
    isBet: h.currentBet === 0,       // nothing to call yet: the button says Bet, not Raise
    pot: potTotal(h),
  };
}

export const potTotal = (h) => h.total.reduce((a, b) => a + b, 0);

/** Apply one action for the player to act. `act` = { a: 'fold'|'check'|'call'|'raise'|'allin', to }.
 *  Returns { ok } or { error }. Illegal actions change nothing. */
export function act(state, i, move) {
  const h = state.hand;
  if (!h || h.result || state.over) return { error: 'no-hand' };
  if (h.toAct !== i) return { error: 'not-your-turn' };
  const L = legal(state);
  const p = state.players[i];
  let a = move && move.a;
  if (a === 'check' && !L.canCheck) return { error: 'cannot-check' };
  if (a === 'call' && L.canCheck) a = 'check';

  if (a === 'fold') {
    h.folded[i] = true;
    h.last[i] = { a: 'fold' };
  } else if (a === 'check') {
    h.last[i] = { a: 'check' };
  } else if (a === 'call') {
    const pay = L.callAmt;
    p.chips -= pay; h.bets[i] += pay; h.total[i] += pay;
    if (p.chips === 0) h.allIn[i] = true;
    h.last[i] = { a: p.chips === 0 ? 'allin' : 'call', amt: h.bets[i] };
  } else if (a === 'raise' || a === 'allin') {
    let to = a === 'allin' ? L.maxTo : Math.floor(Number(move.to));
    if (!Number.isFinite(to)) return { error: 'bad-amount' };
    if (to >= L.maxTo) to = L.maxTo;
    if (to <= h.currentBet) {
      // An "all-in" that cannot even cover the bet is just a call for less.
      if (a === 'allin') return act(state, i, { a: 'call' });
      return { error: 'too-small' };
    }
    if (!L.canRaise && to > h.currentBet) {
      if (a === 'allin') return act(state, i, { a: 'call' });
      return { error: 'cannot-raise' };
    }
    if (to < L.minTo && to < L.maxTo) return { error: 'too-small' };
    const pay = to - h.bets[i];
    p.chips -= pay; h.bets[i] = to; h.total[i] += pay;
    const raiseBy = to - h.currentBet;
    const full = raiseBy >= h.minRaise;
    const wasBet = h.currentBet === 0;
    h.currentBet = to;
    if (full) h.minRaise = raiseBy;
    // A full raise reopens the betting for everyone; an all-in for less than a full raise only
    // makes the others respond - anyone who had already acted may call or fold, not re-raise.
    state.players.forEach((q, j) => {
      if (j === i || !canAct(h, j)) return;
      if (full) { h.acted[j] = false; h.canRaise[j] = true; }
      else if (h.acted[j]) { h.acted[j] = false; h.canRaise[j] = false; }
    });
    if (p.chips === 0) h.allIn[i] = true;
    h.last[i] = { a: p.chips === 0 ? 'allin' : (wasBet ? 'bet' : 'raise'), amt: to };
  } else {
    return { error: 'bad-action' };
  }
  h.acted[i] = true;
  h.canRaise[i] = true;
  if (h.log) h.log.push(h.last[i].amt != null ? { i, a: h.last[i].a, amt: h.last[i].amt, st: h.street } : { i, a: h.last[i].a, st: h.street });
  state.k += 1;
  advance(state, i);
  return { ok: true };
}

/** Move on after player `i` acted: to the next player, the next street, or the showdown. */
function advance(state, i) {
  const h = state.hand;
  const inHand = state.players.map((_, j) => j).filter((j) => !h.folded[j]);
  if (inHand.length === 1) return award(state);
  const pending = state.players.some((_, j) => canAct(h, j) && (!h.acted[j] || h.bets[j] < h.currentBet));
  if (pending) {
    h.toAct = nextIdx(state, i, (_, j) => canAct(h, j) && (!h.acted[j] || h.bets[j] < h.currentBet));
    return;
  }
  nextStreet(state);
}

/** When nobody (or only one player) can still bet, deal the rest out; otherwise nothing. */
function autoAdvance(state) {
  const h = state.hand;
  if (!h || h.result) return;
  const pending = state.players.some((_, j) => canAct(h, j) && (!h.acted[j] || h.bets[j] < h.currentBet));
  if (!pending) nextStreet(state);
}

function nextStreet(state) {
  const h = state.hand;
  h.bets = h.bets.map(() => 0);
  h.currentBet = 0;
  h.minRaise = h.bb;
  h.acted = h.acted.map(() => false);
  h.canRaise = h.canRaise.map(() => true);
  h.last = h.last.map((l, j) => (h.folded[j] ? l : (h.allIn[j] ? { a: 'allin' } : null)));
  if (h.street === 'river') return showdown(state);
  if (h.street === 'preflop') { h.deck.pop(); h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop()); h.street = 'flop'; }
  else if (h.street === 'flop') { h.deck.pop(); h.board.push(h.deck.pop()); h.street = 'turn'; }
  else if (h.street === 'turn') { h.deck.pop(); h.board.push(h.deck.pop()); h.street = 'river'; }
  const bettors = state.players.filter((_, j) => canAct(h, j)).length;
  if (bettors < 2) {
    // Everyone left is all-in (or one player is covering all-ins): no more betting, run it out.
    h.toAct = -1;
    h.runout = (h.runout | 0) + 1;
    return nextStreet(state);
  }
  // After the flop the first live player left of the button acts.
  h.toAct = firstToAct(state, state.button);
}

/** Split the committed chips into a main pot and side pots. Each pot lists who may win it.
 *  A pot only ONE player put chips into is their own uncalled bet coming back (`back: true`,
 *  2026-10-05): it is paid like any pot, but it is not a win and is never shown as one. */
export function buildPots(h) {
  const n = h.total.length;
  const rem = h.total.slice();
  const pots = [];
  let guard = 0;
  while (rem.some((x) => x > 0) && guard++ < 20) {
    const liveCaps = [];
    for (let j = 0; j < n; j++) if (!h.folded[j] && rem[j] > 0) liveCaps.push(rem[j]);
    let level = liveCaps.length ? Math.min(...liveCaps) : Math.max(...rem);
    // One player left with chips over everyone else's: stop first at the most any FOLDED player
    // put in, so what that player won and what is just their own bet coming back stay apart.
    if (liveCaps.length === 1) {
      const foldedRem = rem.filter((x, j) => h.folded[j] && x > 0);
      if (foldedRem.length) level = Math.min(level, Math.max(...foldedRem));
    }
    let amount = 0, givers = 0;
    const eligible = [];
    for (let j = 0; j < n; j++) {
      const take = Math.min(rem[j], level);
      amount += take; rem[j] -= take;
      if (take > 0) givers++;
      if (take === level && !h.folded[j] && level > 0) eligible.push(j);
    }
    if (amount <= 0) break;
    const back = givers === 1 && eligible.length === 1;
    const prev = pots[pots.length - 1];
    if (prev && prev.eligible.join() === eligible.join() && !!prev.back === back) prev.amount += amount;
    else pots.push(back ? { amount, eligible, back } : { amount, eligible });
  }
  return pots;
}

/** Everyone but one folded: that player takes it all, and their cards stay private. */
function award(state) {
  const h = state.hand;
  const w = h.folded.indexOf(false);
  const amount = potTotal(h);
  state.players[w].chips += amount;
  h.toAct = -1;
  h.result = { pots: [{ amount, winners: [w], score: -1 }], reveal: {}, noShow: true };
  endHand(state);
}

function showdown(state) {
  const h = state.hand;
  h.street = 'showdown';
  h.toAct = -1;
  const scores = {};
  const reveal = {};
  state.players.forEach((_, j) => {
    if (h.folded[j] || !h.holes[j]) return;
    scores[j] = evaluate([...h.holes[j], ...h.board]);
    reveal[j] = h.holes[j].slice();
  });
  const pots = buildPots(h).map((pot) => {
    const contenders = pot.eligible.filter((j) => scores[j] != null);
    if (pot.back) return { amount: pot.amount, winners: pot.eligible.slice(), score: -1, back: true };
    if (!contenders.length) return { amount: pot.amount, winners: pot.eligible.slice(0, 1), score: -1 };
    const best = Math.max(...contenders.map((j) => scores[j]));
    const winners = contenders.filter((j) => scores[j] === best);
    return { amount: pot.amount, winners, score: contenders.length > 1 ? best : -1 };
  });
  // Pay out. An odd chip in a split goes to the first winner left of the button.
  pots.forEach((pot) => {
    const order = pot.winners.slice().sort((a, b) => seatDist(state, a) - seatDist(state, b));
    const share = Math.floor(pot.amount / order.length);
    let odd = pot.amount - share * order.length;
    order.forEach((j) => {
      state.players[j].chips += share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
    });
  });
  h.result = { pots, reveal, scores };
  endHand(state);
}

const seatDist = (state, j) => {
  const n = state.players.length;
  return (j - state.button + n - 1) % n;
};

/** After the chips move: knock out empty stacks (bigger starting stack places higher when two
 *  bust in the same hand) and decide whether the tournament is over. */
function endHand(state) {
  const h = state.hand;
  const busted = state.players.filter((p) => !p.out && p.chips <= 0);
  busted.sort((a, b) => (h.total[a.id] || 0) - (h.total[b.id] || 0));
  busted.forEach((p) => {
    const remaining = alive(state).length;
    p.out = true;
    p.place = remaining;
  });
  h.busted = busted.map((p) => p.id);
  if (alive(state).length <= 1) finishGame(state);
}

function finishGame(state) {
  const live = alive(state);
  state.over = true;
  if (live.length === 1) { state.winner = live[0].id; live[0].place = 1; }
  else if (live.length === 0) {
    // Cannot happen with real chips (someone always wins the pot), but never leave it undecided.
    const best = state.players.reduce((a, b) => (b.place && (!a || b.place < a.place) ? b : a), null);
    state.winner = best ? best.id : -1;
  }
  if (state.hand) state.hand.toAct = -1;
  state.k += 1;
  return state;
}

/** A player walks away (or is removed): folds now if in the hand, forfeits the stack, and is out.
 *  Their chips are NOT redistributed to anyone - what they had already bet stays in the pot. */
export function leave(state, i) {
  const p = state.players[i];
  if (!p || p.out || state.over) return state;
  const h = state.hand;
  const inHand = h && !h.result && !h.folded[i];
  p.left = true;
  if (inHand) {
    const wasTurn = h.toAct === i;
    h.folded[i] = true;
    h.last[i] = { a: 'fold' };
    if (h.log) h.log.push({ i, a: 'left', st: h.street });
    if (wasTurn) { state.k += 1; advance(state, i); }
    else {
      const inHandNow = state.players.map((_, j) => j).filter((j) => !h.folded[j]);
      if (inHandNow.length === 1) award(state);
    }
  }
  if (!p.out) {
    p.chips = 0;
    p.out = true;
    p.place = alive(state).length + 1;
    if (!state.over && alive(state).length <= 1) finishGame(state);
  }
  state.k += 1;
  return state;
}

/** The half of the state every seat may see: no deck, and no hole cards except those shown
 *  down at the end of the hand. */
export function publicView(state) {
  const h = state.hand;
  const pub = {
    v: state.v, cfg: state.cfg, handNo: state.handNo, level: state.level, button: state.button,
    over: state.over, winner: state.winner, k: state.k,
    players: state.players.map((p) => ({ ...p })),
    hand: null,
  };
  if (h) {
    const { deck, holes, ...rest } = h;
    pub.hand = { ...rest, inHand: state.players.map((_, j) => !!holes[j] && !h.folded[j]) };
  }
  return pub;
}

/** The bankroll prize for finishing in `place` of an `n`-player game that cost `buyin` to enter.
 *  Everyone at the table (computers too) puts the buy-in in the pot; with three or more players 1st
 *  takes 65% and 2nd the rest, heads-up the winner takes it all. Whole dollars; nothing is lost to
 *  rounding (1st + 2nd == the pot exactly). */
export function payout(place, n, buyin) {
  const b = Math.max(0, Math.floor(buyin || 0));
  if (!b || n < 2 || place < 1) return 0;
  const pot = b * n;
  if (n === 2) return place === 1 ? pot : 0;
  const first = Math.round(pot * 0.65);
  if (place === 1) return first;
  if (place === 2) return pot - first;
  return 0;
}

export default {
  newGame, startHand, act, legal, leave, publicView, evaluate, bestFive, buildPots, blindsOf,
  categoryOf, scoreRanks, potTotal, cardText, shuffledDeck,
};
