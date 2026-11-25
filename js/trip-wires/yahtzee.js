// js/trip-wires/yahtzee.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). The older Yahtzee rules (a held die that
// changed, a fourth roll) live in js/integrity.js checkPlayInput and are not repeated here.
// Data: the private log `x` (yahtzee/js/ui.js plData): ev = ['r', seat, dice, held mask, ms] rolls and ['c', seat, category,
// points, ms] commits, me, t0 (epoch ms the log began, 2026-11-25), res (resumed), cards0 (the cards at the resume), cards,
// bonus, yb, totals, end. The recorder's arguments `a` = [difficulty, won, { yahtzees, score }].

// --- the scoring, copied from yahtzee/js/ui.js (categoryScore / previewScore / availableCategories / totalScore) ---------
const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const CATS = [...UPPER, 'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];
const sum = (v) => v.reduce((s, k) => s + k, 0);
const countsOf = (v) => { const c = {}; for (const k of v) c[k] = (c[k] || 0) + 1; return c; };
const isYz = (v) => Object.values(countsOf(v)).some((n) => n === 5);
function categoryScore(cat, vals) {
  const c = countsOf(vals), u = UPPER.indexOf(cat);
  if (u >= 0) return vals.filter((v) => v === u + 1).length * (u + 1);
  switch (cat) {
    case 'threeKind': return Object.values(c).some((n) => n >= 3) ? sum(vals) : 0;
    case 'fourKind': return Object.values(c).some((n) => n >= 4) ? sum(vals) : 0;
    case 'fullHouse': { const cs = Object.values(c).sort((p, q) => p - q); return cs.length === 2 && cs[0] === 2 && cs[1] === 3 ? 25 : 0; }
    case 'smallStraight': { const s = new Set(vals); return [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]].some((r) => r.every((v) => s.has(v))) ? 30 : 0; }
    case 'largeStraight': { const k = [...new Set(vals)].sort((p, q) => p - q).join(','); return k === '1,2,3,4,5' || k === '2,3,4,5,6' ? 40 : 0; }
    case 'yahtzee': return isYz(vals) ? 50 : 0;
    case 'chance': return sum(vals);
    default: return 0;
  }
}
function previewScore(scores, cat, vals) {
  if (isYz(vals) && scores.yahtzee === 50 && cat !== 'yahtzee') {
    const face = vals[0], up = UPPER[face - 1];
    if (cat === up) return face * 5;
    if (cat === 'fullHouse') return 25;
    if (cat === 'smallStraight') return 30;
    if (cat === 'largeStraight') return 40;
    if (cat === 'threeKind' || cat === 'fourKind' || cat === 'chance') return sum(vals);
    if (UPPER.includes(cat)) return 0;
  }
  return categoryScore(cat, vals);
}
function allowed(scores, cat, vals) {
  if (!CATS.includes(cat) || scores[cat] != null) return false;
  if (isYz(vals) && scores.yahtzee === 50) { const up = UPPER[vals[0] - 1]; if (scores[up] == null) return cat === up; }
  return true;
}
const cardTotal = (card, bonus) => CATS.reduce((s, c) => s + (Number(card[c]) || 0), 0)
  + (UPPER.reduce((s, c) => s + (Number(card[c]) || 0), 0) >= 63 ? 35 : 0) + (Number(bonus) || 0);

// --- shared shape of this group's board-game files (copied, not imported: one file per game) ----------------------------
/** Real presses (touch/mouse downs and keys) in the touch log; null when it might not hold them all
 *  (js/play-log-queue.js _tok drops a press only once no move token is left to drop, so any move left = none dropped). */
function presses(n) {
  if (!n || !Array.isArray(n.ev)) return null;
  if (n.cut && !n.moves) return null;
  return n.ev.filter((q) => !q.fake && (q.kind === 'd' || q.kind === 'k')).length;
}
/** The gaps before each own action (actions = [[own, ms]] in order): count, median, spread of the middle 80%. */
function pace(actions) {
  const g = [];
  for (let k = 1; k < actions.length; k++) if (actions[k][0]) g.push(actions[k][1] - actions[k - 1][1]);
  if (!g.length) return { n: 0, med: 0, spread: 0 };
  g.sort((p, q) => p - q);
  const at = (f) => g[Math.floor(f * (g.length - 1))];
  return { n: g.length, med: at(0.5), spread: at(0.9) - at(0.1) };
}

const evOf = (x) => (x && Array.isArray(x.ev) ? x.ev.filter((q) => Array.isArray(q)) : null);

export default [
  {
    // Every commit is scored by previewScore() on the dice of that seat's last roll, into a category availableCategories()
    // allows (yahtzee/js/ui.js applyCommit / selectCategory). The log is that same call's input and output, so a points
    // value or category the dice cannot give means the game's state was changed by something other than the screen.
    id: 'yahtzee-score-not-dice',
    text: 'a box scored more or less than its dice give, or a box that was not open',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, ev = evOf(x);
      if (!ev || !ev.length || x.cut || ev.length >= 200) return null;
      if (x.res && !Array.isArray(x.cards0)) return null;
      const cards = [0, 1].map((s) => ({ ...((x.res && x.cards0 && x.cards0[s]) || {}) }));
      const dice = [null, null];
      for (const q of ev) {
        const seat = q[1] === 1 ? 1 : 0;
        if (q[0] === 'r' && Array.isArray(q[2]) && q[2].length === 5) { dice[seat] = q[2].map(Number); continue; }
        if (q[0] !== 'c') continue;
        const cat = String(q[2]), pts = Number(q[3]), vals = dice[seat];
        dice[seat] = null;
        if (!vals) { cards[seat][cat] = pts; continue; }   // a commit with no roll logged this turn (resumed mid-turn): not judged
        if (!allowed(cards[seat], cat, vals)) return { v: `${cat} on ${vals.join('')}, not open`, lim: 'an open box' };
        const want = previewScore(cards[seat], cat, vals);
        if (pts !== want) return { v: `${cat} ${pts} on ${vals.join('')}`, lim: want };
        cards[seat][cat] = pts;
      }
      return null;
    },
  },
  {
    // The recorder's score and result are totalScore() of the same card the log ends with (yahtzee/js/ui.js commitStatsOnce:
    // score = totalScore(me), won = mine vs theirs). A recorded score or win the finished card does not give is impossible.
    id: 'yahtzee-score-not-card',
    text: 'a recorded score or win the finished scorecard does not give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a;
      if (!x || x.end !== 'over' || !Array.isArray(x.cards) || x.cards.length !== 2 || !Array.isArray(a) || e.f !== 'recordYahtzee') return null;
      const me = x.me === 1 ? 1 : 0, bon = Array.isArray(x.bonus) ? x.bonus : [0, 0];
      const mine = cardTotal(x.cards[me] || {}, bon[me]), theirs = cardTotal(x.cards[1 - me] || {}, bon[1 - me]);
      const ex = a[2] && typeof a[2] === 'object' ? a[2] : null;
      if (ex && Number.isFinite(Number(ex.score)) && Number(ex.score) !== mine) return { v: `recorded ${ex.score}, card ${mine}`, lim: mine };
      const won = mine > theirs ? true : mine < theirs ? false : null;
      if (a[1] !== won) return { v: `recorded ${a[1]}, card ${mine}-${theirs}`, lim: String(won) };
      return null;
    },
  },
  {
    // Every roll is a tap on ROLL and every commit a tap on PLAY (yahtzee/js/ui.js onRootClick -> doRoll / commitSelection),
    // and both are logged at that tap. More of this player's rolls and commits after the touch log's first event than real
    // presses in it means something other than a finger drove them.
    id: 'yahtzee-rolls-without-taps',
    text: 'more rolls and scored boxes than taps',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, ev = evOf(x), p = presses(ctx.n);
      if (!ev || p == null || !(Number(x.t0) > 0)) return null;
      const me = x.me === 1 ? 1 : 0;
      const mine = ev.filter((q) => q[1] === me && (q[0] === 'r' || q[0] === 'c') && Number(x.t0) + Number(q[q.length - 1]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} rolls and boxes, ${p} presses`, lim: p } : null;
    },
  },
  {
    // A person's gap before each roll or box varies by seconds (real plays: middle 80% spread at least 3.8 s, medians
    // over 2 s). Dozens of near-identical gaps, or a median under a quarter second, is a machine's rhythm. Suspicious only.
    id: 'yahtzee-machine-pace',
    text: 'rolls and boxes at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const ev = evOf(ctx.x);
      if (!ev) return null;
      const me = ctx.x.me === 1 ? 1 : 0;
      const pc = pace(ev.map((q) => [q[1] === me, Number(q[q.length - 1]) || 0]));
      if (pc.n < 15) return null;
      if (pc.spread < 150 || pc.med < 250) return { v: `${pc.n} actions, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 150 ms, median 250 ms' };
      return null;
    },
  },
];
