// Headless engine test (node-only, not deployed): `node holdem/js/test.js`.
// Hand ranking, pots and side pots, betting-order rules, and whole tournaments played out by the
// computer players with the chip count checked after every single action.

import E, { evaluate, categoryOf, CAT, newGame, startHand, act, legal, leave, buildPots, publicView, payout } from './engine.js';
import { decide } from './ai.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('FAIL', name, extra === undefined ? '' : extra); }
};

// ---- cards: 'As' -> int -------------------------------------------------------------------
const C = (s) => '23456789TJQKA'.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);
const H = (str) => str.split(' ').map(C);
const cat = (str) => categoryOf(evaluate(H(str)));

ok('high card', cat('As Kd 9h 7c 4s 3d 2h') === CAT.HIGH);
ok('pair', cat('As Ad 9h 7c 4s 3d 2h') === CAT.PAIR);
ok('two pair', cat('As Ad 9h 9c 4s 3d 2h') === CAT.TWO_PAIR);
ok('trips', cat('As Ad Ah 9c 4s 3d 2h') === CAT.TRIPS);
ok('straight', cat('9s 8d 7h 6c 5s Kd 2h') === CAT.STRAIGHT);
ok('wheel', cat('As 2d 3h 4c 5s Kd 9h') === CAT.STRAIGHT);
ok('flush', cat('As Ks 9s 7s 2s 3d 4h') === CAT.FLUSH);
ok('full house', cat('As Ad Ah 9c 9s 3d 2h') === CAT.FULL);
ok('full from two trips', cat('As Ad Ah 9c 9s 9d 2h') === CAT.FULL);
ok('quads', cat('As Ad Ah Ac 9s 3d 2h') === CAT.QUADS);
ok('straight flush', cat('9s 8s 7s 6s 5s Kd 2h') === CAT.STRAIGHT_FLUSH);
ok('steel wheel', cat('As 2s 3s 4s 5s Kd 9h') === CAT.STRAIGHT_FLUSH);
const cmp = (a, b) => Math.sign(evaluate(H(a)) - evaluate(H(b)));
ok('six-high straight beats wheel', cmp('6s 5d 4h 3c 2s', 'As 5d 4h 3c 2s') === 1);
ok('pair kicker decides', cmp('As Ad Kh 7c 4s', 'Ah Ac Qh 7d 4d') === 1);
ok('two pair: third card kicker', cmp('As Ad 9h 9c Ks', 'Ah Ac 9s 9d Qd') === 1);
ok('two pair: best two of three pairs', cmp('As Ad 9h 9c 4s 4d Kh', 'Ah Ac 9s 9d 2s 2d Qc') === 1);
ok('flush compares all five', cmp('As Ks 9s 7s 3s', 'Ad Kd 9d 7d 2d') === 1);
ok('split: board plays', cmp('2s 3d Ah Kh Qh Jh Th', '4c 5c Ah Kh Qh Jh Th') === 0);
ok('full house: trips first', cmp('3s 3d 3h 2c 2s', '2h 2d 2c As Ad') === 1);
ok('quads kicker', cmp('9s 9d 9h 9c As', '9s 9d 9h 9c Ks') === 1);

// ---- pots ----------------------------------------------------------------------------------
{
  const h = { total: [100, 300, 900, 50], folded: [false, true, false, false] };
  const pots = buildPots(h);
  const sum = pots.reduce((a, p) => a + p.amount, 0);
  ok('side pots add up to every chip committed', sum === 1350, pots);
  ok('main pot: everyone who put in 50', pots[0].amount === 200 && pots[0].eligible.join() === '0,2,3', pots[0]);
  ok('first side pot excludes the short all-in', pots[1].eligible.join() === '0,2', pots[1]);
  ok('the folded player\'s extra chips go to whoever is still in', pots[pots.length - 1].eligible.join() === '2', pots);
}

// ---- betting order -------------------------------------------------------------------------
const SMALL = { chips: 1000, scale: 1 };
const seat = (n, bot = 0) => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, bot }));
{
  const s = newGame(seat(2), SMALL);
  startHand(s, () => 0.5);
  ok('heads-up: button posts the small blind', s.hand.sbIdx === s.button);
  ok('heads-up: button acts first before the flop', s.hand.toAct === s.button);
  act(s, s.button, { a: 'call' });
  ok('big blind gets the option', s.hand.toAct === s.hand.bbIdx && legal(s).canCheck);
  act(s, s.hand.bbIdx, { a: 'check' });
  ok('flop dealt', s.hand.street === 'flop' && s.hand.board.length === 3);
  ok('heads-up: big blind acts first after the flop', s.hand.toAct === s.hand.bbIdx);
}
{
  const s = newGame(seat(4), SMALL);
  startHand(s, () => 0.3);
  const { sbIdx, bbIdx } = s.hand;
  const utg = (bbIdx + 1) % 4;
  ok('4 players: blinds left of the button', sbIdx === (s.button + 1) % 4 && bbIdx === (s.button + 2) % 4);
  ok('4 players: first to act is left of the big blind', s.hand.toAct === utg);
  const L = legal(s);
  ok('min raise is to two big blinds', L.minTo === 40, L);
  ok('a raise below the minimum is refused', act(s, utg, { a: 'raise', to: 30 }).error === 'too-small');
  ok('a legal raise', act(s, utg, { a: 'raise', to: 60 }).ok);
  ok('next min raise is by the size of the last raise', legal(s).minTo === 100, legal(s));
  ok('acting out of turn is refused', act(s, utg, { a: 'fold' }).error === 'not-your-turn');
  act(s, s.hand.toAct, { a: 'fold' });
  act(s, s.hand.toAct, { a: 'fold' });
  act(s, s.hand.toAct, { a: 'fold' });
  ok('everyone folds: raiser wins without a showdown', s.hand.result && s.hand.result.noShow && s.hand.result.pots[0].winners[0] === utg);
  ok('its cards stay hidden', Object.keys(s.hand.result.reveal).length === 0);
  ok('chips conserved', s.players.reduce((a, p) => a + p.chips, 0) === 4000);
}
{
  // Short all-in for less than a full raise does not reopen betting to the original raiser.
  const s = newGame(seat(3), SMALL);
  startHand(s, () => 0.7);
  const a = s.hand.toAct;                      // button, first to act 3-handed
  act(s, a, { a: 'raise', to: 100 });
  const b = s.hand.toAct;
  s.players[b].chips = 130 - s.hand.bets[b];   // leaves b able to go all-in to 130 only
  act(s, b, { a: 'allin' });
  const c = s.hand.toAct;
  act(s, c, { a: 'fold' });
  ok('the original raiser must respond', s.hand.toAct === a);
  ok('but may only call or fold (incomplete raise)', legal(s).canRaise === false, legal(s));
}
{
  // publicView leaks nothing.
  const s = newGame(seat(3), SMALL);
  startHand(s);
  const pub = JSON.parse(JSON.stringify(publicView(s)));
  ok('public view has no deck', !('deck' in pub.hand));
  ok('public view has no hole cards', !('holes' in pub.hand));
}
{
  // A player leaving on their turn folds and the hand moves on.
  const s = newGame(seat(3), SMALL);
  startHand(s);
  const who = s.hand.toAct;
  leave(s, who);
  ok('leaver is out', s.players[who].out && s.players[who].left);
  ok('turn moved on', s.hand.toAct !== who);
}

// ---- whole tournaments, bots only, chips checked after every action -------------------------
let games = 0, hands = 0, errors = 0;
for (let g = 0; g < 60; g++) {
  const n = 2 + (g % 7);
  const s = newGame(seat(n, 1 + (g % 3)), { ...SMALL, speed: 'fast' });
  const total = n * 1000;
  let guard = 0;
  while (!s.over && guard++ < 3000) {
    startHand(s);
    hands++;
    let steps = 0;
    while (s.hand && !s.hand.result && s.hand.toAct >= 0 && steps++ < 500) {
      const i = s.hand.toAct;
      const mv = decide(s, s.players[i].bot);
      const r = act(s, i, mv);
      if (r.error) {
        errors++;
        if (errors < 5) console.log('bot move refused', r.error, mv, legal(s));
        act(s, i, { a: legal(s).canCheck ? 'check' : 'fold' });
      }
      const inPlay = s.players.reduce((a, p) => a + p.chips, 0) + s.hand.total.reduce((a, b) => a + b, 0);
      if (!s.hand.result && inPlay !== total) { ok('chips conserved mid-hand', false, { inPlay, total }); break; }
    }
    ok('hand always reaches a result', !!(s.hand && s.hand.result), s.hand && { street: s.hand.street, toAct: s.hand.toAct });
    const stacks = s.players.reduce((a, p) => a + p.chips, 0);
    if (stacks !== total) { ok('chips conserved after the hand', false, { stacks, total, g, hand: s.handNo }); break; }
    if (s.players.some((p) => p.chips < 0)) { ok('no negative stack', false); break; }
  }
  ok('tournament finishes', s.over, { g, hands: s.handNo });
  const places = s.players.map((p) => p.place).sort((a, b) => a - b).join();
  ok('every place 1..n handed out once', places === Array.from({ length: n }, (_, i) => i + 1).join(), places);
  ok('winner holds every chip', s.players[s.winner] && s.players[s.winner].chips === total);
  games++;
}
ok('bots never make an illegal move', errors === 0, errors);

console.log(`holdem engine: ${pass} passed, ${fail} failed (${games} tournaments, ${hands} hands)`);
if (fail) process.exit(1);
{
  // The shipped default: $10,000 stacks, $100/$200 blinds.
  const s = newGame(seat(3));
  startHand(s);
  ok('default game: 10,000 chips and 100/200 blinds', s.cfg.chips === 10000 && s.hand.sb === 100 && s.hand.bb === 200, s.hand);
  const old = newGame(seat(3), SMALL);
  delete old.cfg.scale;                      // a game saved before the scale existed
  startHand(old);
  ok('an old save without a scale keeps 10/20 blinds', old.hand.sb === 10 && old.hand.bb === 20);
}
// ---- bankroll prizes -------------------------------------------------------------------------
ok('6 players at $1,000: 1st takes 65% of $6,000', payout(1, 6, 1000) === 3900);
ok('6 players at $1,000: 2nd takes the rest', payout(2, 6, 1000) === 2100);
ok('3rd and below get nothing', payout(3, 6, 1000) === 0 && payout(6, 6, 1000) === 0);
ok('heads-up: winner takes the whole pot', payout(1, 2, 5000) === 10000 && payout(2, 2, 5000) === 0);
ok('no buy-in, no prize (old saves, free games)', payout(1, 6, 0) === 0);
for (const [n, b] of [[3, 500], [5, 1000], [7, 5000], [8, 10000000]]) ok(`prizes add up to the pot exactly (${n} x $${b})`, payout(1, n, b) + payout(2, n, b) === n * b);
ok('newGame keeps the buy-in on the public config', newGame(seat(3), { buyin: 5000, tier: 'regional' }).cfg.buyin === 5000);
void E;
