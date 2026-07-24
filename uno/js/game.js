// game.js - pure Uno engine. No DOM, no Math.random, no I/O.
//
// Rules implemented (root CLAUDE.md's HANDOFF-UNO.md, decided 2026-07-24 - do not
// re-litigate here; see uno/CLAUDE.md for the full rationale):
//   - draw-until-you-can-play, then you MUST play the card you drew
//   - +2 stacking ON (any +2 answers a +2); whoever can't/won't answer draws the pile
//     and is skipped; penalty draws are a single lump draw, never draw-until-playable
//   - Wild +4 does NOT stack, is always a legal move on a normal turn, and is not a
//     legal response to a pending +2 stack
//   - jump-in OFF, 7-0 swap OFF
//   - Reverse acts as Skip with exactly 2 players
//   - deck exhaustion mid-draw reshuffles the discard pile (minus its top card)
//
// Every state change is an explicit action (play / draw / chooseColor) applied by one
// method each; the whole state is plain JSON (see snapshot()/fromSnapshot()) so this is
// MP-lockstep-clean from day one even though this batch ships solo only. rng is injected
// (Chinchon's presetDeck pattern) so a future host can transmit deals deterministically.

export const COLORS = ['red', 'yellow', 'green', 'blue'];

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic seeded rng for tests (mulberry32) - not used by the engine itself.
export function seededRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDeck() {
  let id = 0;
  const cards = [];
  for (const color of COLORS) {
    cards.push({ id: id++, color, kind: 'number', value: 0 });
    for (let v = 1; v <= 9; v++) {
      cards.push({ id: id++, color, kind: 'number', value: v });
      cards.push({ id: id++, color, kind: 'number', value: v });
    }
    for (let i = 0; i < 2; i++) cards.push({ id: id++, color, kind: 'skip', value: null });
    for (let i = 0; i < 2; i++) cards.push({ id: id++, color, kind: 'reverse', value: null });
    for (let i = 0; i < 2; i++) cards.push({ id: id++, color, kind: 'draw2', value: null });
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: 'wild', kind: 'wild', value: null });
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: 'wild', kind: 'wild4', value: null });
  return cards; // 108
}

export class UnoGame {
  constructor({ playerCount, rng, presetDeck, onEvent } = {}) {
    if (!(playerCount >= 2 && playerCount <= 4)) throw new Error('playerCount must be 2-4');
    this.rng = rng || Math.random;
    this.onEvent = onEvent || (() => {});
    this.n = playerCount;
    this._initState(presetDeck);
  }

  _emit(type, payload) { try { this.onEvent(type, payload); } catch { /* UI hook errors never break the engine */ } }

  _initState(presetDeck) {
    const deck = presetDeck ? presetDeck.slice() : shuffle(makeDeck(), this.rng);
    this.players = Array.from({ length: this.n }, () => ({ hand: [] }));
    for (let r = 0; r < 7; r++) for (let p = 0; p < this.n; p++) this.players[p].hand.push(deck.pop());
    this.deck = deck;
    this.discard = [];
    this.direction = 1;
    this.pendingDraw = 0;
    this.phase = 'playing'; // 'playing' | 'chooseColor' | 'over'
    this.winner = null;
    this.currentPlayer = 0;
    this.activeColor = null;
    this.pendingWild = null;    // { playerIndex, cardId, isFirstCard? }
    this.mustPlayDrawn = null;  // { playerIndex, cardId }
    this._flipFirstCard();
  }

  _flipFirstCard() {
    let card = this.deck.pop();
    while (card.kind === 'wild4') {
      this.deck.unshift(card);
      this.deck = shuffle(this.deck, this.rng);
      card = this.deck.pop();
    }
    this.discard.push(card);
    this.activeColor = card.color === 'wild' ? null : card.color;
    if (card.kind === 'number') {
      this.currentPlayer = 0;
    } else if (card.kind === 'skip') {
      this.currentPlayer = this.n > 1 ? 1 : 0;
    } else if (card.kind === 'reverse') {
      if (this.n === 2) { this.currentPlayer = 1; }
      else { this.direction = -1; this.currentPlayer = this.n - 1; }
    } else if (card.kind === 'draw2') {
      this._drawCards(0, 2);
      this._emit('penaltyDraw', { playerIndex: 0, amount: 2 });
      this.currentPlayer = this.n > 1 ? 1 : 0;
    } else if (card.kind === 'wild') {
      this.currentPlayer = 0;
      this.phase = 'chooseColor';
      this.pendingWild = { playerIndex: 0, cardId: card.id, isFirstCard: true };
    }
    this._emit('gameStart', { topCard: card, currentPlayer: this.currentPlayer });
  }

  _matches(card, top) {
    if (card.kind === 'wild' || card.kind === 'wild4') return true;
    if (card.color === this.activeColor) return true;
    if (card.kind === 'number') return top.kind === 'number' && top.value === card.value;
    if (card.kind === top.kind) return true; // skip/reverse/draw2 match by kind regardless of color
    return false;
  }

  // { canPlay: Card[], mustDraw: bool, drawIsPenalty: bool, penaltyAmount?: number }
  getLegalMoves(playerIndex) {
    const hand = this.players[playerIndex].hand;
    if (this.pendingDraw > 0) {
      const twos = hand.filter((c) => c.kind === 'draw2');
      return { canPlay: twos, mustDraw: twos.length === 0, drawIsPenalty: true, penaltyAmount: this.pendingDraw };
    }
    const top = this.discard[this.discard.length - 1];
    const canPlay = hand.filter((c) => this._matches(c, top));
    return { canPlay, mustDraw: canPlay.length === 0, drawIsPenalty: false };
  }

  peekNext(steps = 1) {
    let idx = this.currentPlayer;
    for (let i = 0; i < steps; i++) idx = (idx + this.direction + this.n) % this.n;
    return idx;
  }

  _advance(steps) { this.currentPlayer = this.peekNext(steps); }

  _drawCards(playerIndex, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) this._reshuffle();
      if (this.deck.length === 0) break; // exhausted deck AND discard - cannot happen with 108 cards + wilds
      const c = this.deck.pop();
      this.players[playerIndex].hand.push(c);
      drawn.push(c);
    }
    return drawn;
  }

  _reshuffle() {
    if (this.discard.length <= 1) return; // nothing to reshuffle yet
    const top = this.discard.pop();
    const rest = this.discard;
    this.discard = [top];
    this.deck = shuffle(rest, this.rng);
    this._emit('reshuffled', { count: this.deck.length });
  }

  _applyEffect(card) {
    if (card.kind === 'skip') {
      this._advance(2);
    } else if (card.kind === 'reverse') {
      if (this.n === 2) { this._advance(2); }
      else { this.direction *= -1; this._advance(1); }
    } else if (card.kind === 'draw2') {
      this.pendingDraw += 2;
      this._advance(1);
    } else if (card.kind === 'wild4') {
      const victim = this.peekNext(1);
      this._drawCards(victim, 4);
      this._emit('penaltyDraw', { playerIndex: victim, amount: 4 });
      this._advance(2);
    } else {
      this._advance(1); // number, wild
    }
    this._emit('turnAdvanced', { currentPlayer: this.currentPlayer });
  }

  play(playerIndex, cardId, color) {
    if (this.phase !== 'playing') throw new Error('not accepting plays right now');
    if (playerIndex !== this.currentPlayer) throw new Error('not your turn');
    const hand = this.players[playerIndex].hand;
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error('card not in hand');
    const card = hand[idx];

    if (this.mustPlayDrawn && this.mustPlayDrawn.playerIndex === playerIndex) {
      if (cardId !== this.mustPlayDrawn.cardId) throw new Error('must play the card you just drew');
    } else {
      const legal = this.getLegalMoves(playerIndex);
      if (!legal.canPlay.some((c) => c.id === cardId)) throw new Error('illegal move');
    }

    hand.splice(idx, 1);
    this.discard.push(card);
    this.mustPlayDrawn = null;
    this._emit('cardPlayed', { playerIndex, card });

    if (hand.length === 0) {
      this.phase = 'over';
      this.winner = playerIndex;
      this._emit('handWon', { playerIndex });
      return;
    }
    if (hand.length === 1) this._emit('uno', { playerIndex });

    if (card.kind === 'wild' || card.kind === 'wild4') {
      if (color) {
        this._resolveWild(playerIndex, card, color);
      } else {
        this.phase = 'chooseColor';
        this.pendingWild = { playerIndex, cardId: card.id };
      }
    } else {
      this.activeColor = card.color;
      this._applyEffect(card);
    }
  }

  chooseColor(playerIndex, color) {
    if (this.phase !== 'chooseColor' || !this.pendingWild || this.pendingWild.playerIndex !== playerIndex) {
      throw new Error('not awaiting a color choice from this player');
    }
    if (!COLORS.includes(color)) throw new Error('invalid color');
    const card = this.discard[this.discard.length - 1];
    this._resolveWild(playerIndex, card, color);
  }

  _resolveWild(playerIndex, card, color) {
    const wasFirstCard = !!(this.pendingWild && this.pendingWild.isFirstCard);
    this.activeColor = color;
    this.phase = 'playing';
    this.pendingWild = null;
    this._emit('colorChosen', { playerIndex, color });
    if (wasFirstCard) {
      // The first-card wild only sets the color; player 0 still plays their own turn.
      this._emit('turnAdvanced', { currentPlayer: this.currentPlayer });
      return;
    }
    this._applyEffect(card);
  }

  draw(playerIndex) {
    if (this.phase !== 'playing') throw new Error('not accepting draws right now');
    if (playerIndex !== this.currentPlayer) throw new Error('not your turn');

    if (this.pendingDraw > 0) {
      const amount = this.pendingDraw;
      this._drawCards(playerIndex, amount);
      this.pendingDraw = 0;
      this._emit('penaltyDraw', { playerIndex, amount });
      this._advance(1);
      this._emit('turnAdvanced', { currentPlayer: this.currentPlayer });
      return { drew: amount, forcedPlay: null };
    }

    const [card] = this._drawCards(playerIndex, 1);
    this._emit('cardDrawn', { playerIndex, card });
    const top = this.discard[this.discard.length - 1];
    if (card && this._matches(card, top)) {
      this.mustPlayDrawn = { playerIndex, cardId: card.id };
      this._emit('drawnPlayable', { playerIndex, cardId: card.id });
      return { drew: 1, forcedPlay: card.id };
    }
    return { drew: 1, forcedPlay: null };
  }

  totalCardCount() {
    let n = this.deck.length + this.discard.length;
    for (const p of this.players) n += p.hand.length;
    return n;
  }

  snapshot() {
    return JSON.parse(JSON.stringify({
      n: this.n, players: this.players, deck: this.deck, discard: this.discard,
      direction: this.direction, pendingDraw: this.pendingDraw, phase: this.phase,
      winner: this.winner, currentPlayer: this.currentPlayer, activeColor: this.activeColor,
      pendingWild: this.pendingWild, mustPlayDrawn: this.mustPlayDrawn,
    }));
  }

  static fromSnapshot(snap, { rng, onEvent } = {}) {
    const g = Object.create(UnoGame.prototype);
    g.rng = rng || Math.random;
    g.onEvent = onEvent || (() => {});
    const s = JSON.parse(JSON.stringify(snap));
    Object.assign(g, s);
    return g;
  }
}
