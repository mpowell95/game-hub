// lb-rules.js - how each game's leaderboard ranks, and which modes count at a different level, ONE table
// (Matt's 12, item 3, 2026-11-02: a per-game (i) on Leaderboard v2's board: "Ranked by" + a "Counts as" table
// only where a mode counts at a different level). PURE: no DOM, no storage, no network.
//
// `by` names the board's own order (js/leaderboard-ui.js gameMetricAt / boardMetricCmp / boardTierOf), as a
// short line in js/leaderboard2-strings.js (`lb2_rb_<by>`). `short` / `table` are the RECORD-time rules
// (docs/INTEGRITY-CHECKS-SPEC.md, "E2"): a shortened match records one step down the game's own ladder
// (js/game-stats.js oneTierDown), a table of several computers records at the easiest one (easiestDiff).
// The rows shown are COMPUTED here with the same oneTierDown on the game's own ladder, and
// tools/test-lb-rules.mjs calls each game's own statsDiff / soloDiff to prove the table matches the code
// (the leaderboard does not import the games' screens: that would download every game to open the board).
// Every board game (leaderboard-ui.js GAME_META) needs an entry; the test fails otherwise.
import { oneTierDown } from './game-stats.js';
import { tierOf } from './difficulty-tiers.js';

const L3 = ['easy', 'medium', 'hard'];
export const LB_RULES = {
  airhockey: { by: 'wins' },
  archery: { by: 'wins' },
  ballrun: { by: 'best' },
  baseball: { by: 'wins' },
  battlearena: { by: 'wins' },
  battleship: { by: 'wins' },
  boggle: { by: 'wins', short: { when: 'boggle', ladder: ['beginner', 'intermediate', 'pro'] } },
  brickblitz: { by: 'best' },
  business: { by: 'wins' },
  chinchon: { by: 'wins', short: { when: 'chinchon', ladder: ['easy', 'normal', 'hard'] }, table: true },
  connect4: { by: 'wins' },
  contexto: { by: 'contexto' },
  cupbaseball: { by: 'wins' },
  cuppong: { by: 'cuppong', short: { when: 'cuppong', ladder: L3 } },
  darts: { by: 'wins', short: { when: 'darts', ladder: L3 } },
  dominoes: { by: 'wins', short: { when: 'dominoes', ladder: L3 } },
  dotsboxes: { by: 'wins' },
  eightball: { by: 'wins', short: { when: 'eightball', ladder: L3 } },
  escoba: { by: 'wins', table: true },
  filler: { by: 'wins' },
  flicksoccer: { by: 'wins', short: { when: 'flicksoccer', ladder: L3 } },
  golf: { by: 'golf' },
  gridlock: { by: 'points' },
  hillclimb: { by: 'best' },
  holdem: { by: 'holdem' },
  hoops4: { by: 'wins' },
  mancala: { by: 'wins' },
  minesweeper: { by: 'minesweeper' },
  murdoku: { by: 'nohint' },
  nutsbolts: { by: 'solves' },
  parchis: { by: 'wins', table: true },
  skeeball: { by: 'skeeball' },
  snake: { by: 'best' },
  spellingbee: { by: 'spellingbee' },
  sudoku: { by: 'nohint' },
  tictactoe: { by: 'wins' },
  tower: { by: 'best' },
  uno: { by: 'wins' },
  wayout: { by: 'points' },
  wordweaver: { by: 'points' },
  yahtzee: { by: 'wins' },
};

/** A game's rule: { by, counts: [{ when, rows: [{ from, to }] }] } (tiers 1-4; `when` = the strings key's tail,
 *  `table` rows have no tiers). `counts` is empty for a game whose every mode counts at its own level. */
export function rulesFor(id) {
  const r = LB_RULES[id];
  if (!r) return null;
  const counts = [];
  if (r.short) {
    const rows = r.short.ladder.map((d) => ({ from: tierOf(d), to: tierOf(oneTierDown(d, r.short.ladder)) })).filter((x) => x.from !== x.to).reverse();
    if (rows.length) counts.push({ when: r.short.when, rows });
  }
  if (r.table) counts.push({ when: 'table', rows: [] });
  return { by: r.by, counts };
}

export default { LB_RULES, rulesFor };
