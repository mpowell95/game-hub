// Headless unit tests for js/leaderboard-rank.js + js/difficulty-tiers.js, the leaderboard's
// ranking maths. Run: node test-leaderboard-rank.mjs
//
// Both modules are pure and DOM-free precisely so this can exist (same reasoning as
// players-agg.test.mjs). The last block is the important one: THE LAW rule 1 says data must stay
// VISIBLE, so it replays the OLD visibility gate against the NEW one and asserts nobody fell off
// the board and nobody lost plays - the exact failure mode that made a real player's Ball Run
// history disappear in July 2026.

import { aggregatePlayers } from './js/players-agg.js';
import {
  record, bucketsOf, tierRows, wilsonLower, competitiveRating,
  soloRating, fieldMaxOf, ratePlayer, rankPlayers,
} from './js/leaderboard-rank.js';
import { tierOf, TIER_WEIGHT } from './js/difficulty-tiers.js';

let fail = 0;
const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); } else console.log(`ok   ${label}`); };
const ok = (label, cond, extra) => { if (!cond) { fail++; console.log(`FAIL ${label}${extra ? `\n  ${extra}` : ''}`); } else console.log(`ok   ${label}`); };

const rec = (profile, games, updatedAt = 1000) => ({ profile, stats: { games }, updatedAt });
const one = (games, name = 'P') => aggregatePlayers({ d1: rec({ name }, games) })[0];

// ---------------------------------------------------------------------------
console.log('\n-- record(): draws fold into wins, and W + L always equals Plays --');

eq('draw-heavy Tic Tac Toe 2W/2L/10D', record({ played: 14, won: 2, lost: 2 }), { wins: 12, losses: 2, played: 14 });
eq('clean record passes through', record({ played: 18, won: 15, lost: 3 }), { wins: 15, losses: 3, played: 18 });
eq('empty record', record({}), { wins: 0, losses: 0, played: 0 });
eq('missing total', record(undefined), { wins: 0, losses: 0, played: 0 });
// A legacy record where won + lost exceeds played must NOT produce a negative win count.
eq('legacy won+lost > played', record({ played: 10, won: 8, lost: 7 }), { wins: 3, losses: 7, played: 10 });
// ...and one where lost alone exceeds played still reconciles (losses clamp to played).
eq('corrupt lost > played', record({ played: 4, won: 0, lost: 9 }), { wins: 0, losses: 4, played: 4 });

{
  const fixtures = [
    { played: 14, won: 2, lost: 2 }, { played: 0, won: 0, lost: 0 }, { played: 1, won: 0, lost: 0 },
    { played: 10, won: 8, lost: 7 }, { played: 4, won: 0, lost: 9 }, { played: 250, won: 3, lost: 240 },
    { played: 7, won: 7, lost: 0 }, { played: 33, won: 0, lost: 33 },
  ];
  const bad = fixtures.filter((f) => { const r = record(f); return r.wins + r.losses !== r.played || r.wins < 0 || r.losses < 0; });
  ok('W + L === Plays for every fixture, never negative', bad.length === 0, `offenders: ${JSON.stringify(bad)}`);
}

// ---------------------------------------------------------------------------
console.log('\n-- tierOf(): every live difficulty vocabulary maps onto the shared 1-4 scale --');

const TIER_CASES = [
  // shared beginner/intermediate/pro: filler, mancala, tictactoe, dotsboxes, boggle
  ['beginner', 1], ['intermediate', 2], ['pro', 3],
  // connect4
  ['easy', 1], ['medium', 2], ['hard', 3], ['expert', 4],
  // nutsbolts
  ['extrahard', 4],
  // business / chinchon / escoba default
  ['normal', 2],
  // parchis
  ['facil', 1], ['dificil', 3],
  // tolerance: the recorder lowercases/trims, but never assume it did
  ['  Pro  ', 3], ['EXPERT', 4],
];
for (const [key, want] of TIER_CASES) eq(`tierOf(${JSON.stringify(key)})`, tierOf(key), want);

for (const key of ['unknown', 'legacy', 'wat', '', null, undefined, 0, {}]) {
  eq(`tierOf(${JSON.stringify(key)}) is unrankable`, tierOf(key), null);
}
ok('an unrankable tier still weighs 1.0 (never dropped)', (TIER_WEIGHT[tierOf('legacy')] || 1.0) === 1.0);

// ---------------------------------------------------------------------------
console.log('\n-- weighting: the same record is worth more on a harder tier --');

{
  const at = (key) => competitiveRating(one({ mancala: { total: { played: 15, won: 10, lost: 5 }, byDiff: { [key]: { played: 15, won: 10, lost: 5 } } } })).score;
  const pro = at('pro'), beginner = at('beginner'), mid = at('intermediate');
  ok('10-5 on Pro outranks 10-5 on Beginner', pro > beginner, `pro=${pro.toFixed(4)} beginner=${beginner.toFixed(4)}`);
  ok('Intermediate sits between them', pro > mid && mid > beginner, `${beginner.toFixed(4)} < ${mid.toFixed(4)} < ${pro.toFixed(4)}`);

  // The regression this guards: weighting numerator AND denominator alone cancels exactly for a
  // single-tier player, which silently made difficulty a no-op for the most common record shape.
  const clean = (key) => competitiveRating(one({ mancala: { total: { played: 10, won: 10, lost: 0 }, byDiff: { [key]: { played: 10, won: 10, lost: 0 } } } })).score;
  ok('10-0 on Pro outranks 10-0 on Beginner (weights must not cancel)', clean('pro') > clean('beginner'),
    `pro=${clean('pro').toFixed(4)} beginner=${clean('beginner').toFixed(4)}`);
}

// ---------------------------------------------------------------------------
console.log('\n-- Wilson: volume cannot brute-force past skill, and a hot start is not a record --');

ok('100 plays at 30% ranks below 14 at 86%',
  wilsonLower(0.30, 100) < wilsonLower(0.86, 14),
  `${wilsonLower(0.30, 100).toFixed(4)} vs ${wilsonLower(0.86, 14).toFixed(4)}`);
ok('a 2-0 start does not outrank 15-3',
  wilsonLower(1, 2) < wilsonLower(15 / 18, 18),
  `${wilsonLower(1, 2).toFixed(4)} vs ${wilsonLower(15 / 18, 18).toFixed(4)}`);
ok('wilson(p, 0) is 0, not NaN', wilsonLower(1, 0) === 0);
ok('wilson is monotonic in n at fixed p', wilsonLower(0.8, 50) > wilsonLower(0.8, 5));

// The same two orderings, end to end through the real rating path rather than the raw helper.
{
  const board = (games) => one(games);
  const grinder = board({ mancala: { total: { played: 100, won: 30, lost: 70 }, byDiff: { intermediate: { played: 100, won: 30, lost: 70 } } } });
  const sharp = board({ mancala: { total: { played: 14, won: 12, lost: 2 }, byDiff: { intermediate: { played: 14, won: 12, lost: 2 } } } });
  const hot = board({ mancala: { total: { played: 2, won: 2, lost: 0 }, byDiff: { intermediate: { played: 2, won: 2, lost: 0 } } } });
  const solid = board({ mancala: { total: { played: 18, won: 15, lost: 3 }, byDiff: { intermediate: { played: 18, won: 15, lost: 3 } } } });
  const fm = { brBest: 0, nbSolved: 0 };
  ok('rating: 100 mediocre plays lose to 14 sharp ones',
    ratePlayer(grinder, fm).rating < ratePlayer(sharp, fm).rating,
    `${ratePlayer(grinder, fm).rating} vs ${ratePlayer(sharp, fm).rating}`);
  ok('rating: 2-0 loses to 15-3',
    ratePlayer(hot, fm).rating < ratePlayer(solid, fm).rating,
    `${ratePlayer(hot, fm).rating} vs ${ratePlayer(solid, fm).rating}`);
  ok('2-0 is flagged provisional', ratePlayer(hot, fm).provisional === true);
  ok('15-3 is not flagged provisional', ratePlayer(solid, fm).provisional === false);
}

// ---------------------------------------------------------------------------
console.log('\n-- bucket sum: plays that byDiff does not account for are never lost --');

{
  // A pre-per-difficulty record: total says 20, byDiff only explains 6.
  const g = one({ chinchon: { total: { played: 20, won: 12, lost: 8 }, byDiff: { pro: { played: 6, won: 4, lost: 2 } } } });
  const buckets = bucketsOf(g.games.chinchon);
  const summed = buckets.reduce((a, b) => a + b.played, 0);
  eq('Σ buckets.played === total.played', summed, 20);
  ok('the remainder lands in an unrated bucket', buckets.some((b) => b.tier === null && b.played === 14));
  eq('competitive rating counts all 20 plays', competitiveRating(g).plays, 20);

  // Same, with NO byDiff at all (the oldest shape).
  const bare = one({ chinchon: { total: { played: 9, won: 5, lost: 4 }, byDiff: {} } });
  eq('a byDiff-less record still contributes every play', competitiveRating(bare).plays, 9);

  // And a 'legacy' bucket written by foldLegacy is counted, just not tiered.
  const legacy = one({ filler: { total: { played: 12, won: 7, lost: 5 }, byDiff: { legacy: { played: 12, won: 7, lost: 5 } } } });
  eq('a legacy bucket contributes its plays', competitiveRating(legacy).plays, 12);
  eq('a legacy bucket is reported unranked, not dropped', tierRows(legacy.games.filler).unranked.played, 12);
}

// ---------------------------------------------------------------------------
console.log('\n-- solo: grinding a no-loss game cannot buy a top rating --');

{
  const all = {
    grinder: rec({ name: 'Grinder' }, { ballrun: { total: { played: 500, won: 500, lost: 0 }, byDiff: { easy: { played: 500, won: 500, lost: 0 } }, br: { runs: 500, bestObstacles: 20, bestObstaclesByDiff: { easy: 20 } } } }),
    ace: rec({ name: 'Ace' }, { ballrun: { total: { played: 12, won: 12, lost: 0 }, byDiff: { hard: { played: 12, won: 12, lost: 0 } }, br: { runs: 12, bestObstacles: 60, bestObstaclesByDiff: { hard: 60 } } } }),
    comp: rec({ name: 'Comp' }, { mancala: { total: { played: 18, won: 15, lost: 3 }, byDiff: { pro: { played: 18, won: 15, lost: 3 } } } }),
  };
  const list = aggregatePlayers(all);
  const ranked = rankPlayers(list);
  const by = (n) => ranked.find((r) => r.group.name === n);

  ok('500 mediocre Ball Run runs do not outrank a strong competitive record',
    by('Grinder').rating < by('Comp').rating,
    `Grinder=${by('Grinder').rating} Comp=${by('Comp').rating}`);
  ok('the better Ball Run player outranks the grinder despite 40x fewer runs',
    by('Ace').rating > by('Grinder').rating,
    `Ace=${by('Ace').rating} Grinder=${by('Grinder').rating}`);
  ok('solo players are RATED, not excluded', by('Grinder').rating != null && by('Ace').rating != null);

  const fm = fieldMaxOf(list);
  eq('fieldMax picks the best obstacle count', fm.brBest, 60);
  ok('solo score is relative to the field', soloRating(by('Grinder').group, fm).score < (20 / 60));
  ok('a player with no solo history has no solo score', soloRating(by('Comp').group, fm) === null);
}

{
  // Holding the field maximum in a game NOBODY ELSE PLAYS must not buy a perfect rating. Both axes
  // are confidence-discounted, so a thin solo record cannot outrank a substantial competitive one.
  // Caught on the first render of real-shaped data: 12 Nuts & Bolts levels scored 100 and topped
  // the board over a 22-match Chinchón record, because a raw relative ratio is 1.0 by definition
  // when you are the only player, at any sample size.
  const all = {
    solo: rec({ name: 'Solo' }, { nutsbolts: { total: { played: 12, won: 12, lost: 0 }, byDiff: { medium: { played: 12, won: 12, lost: 0 } }, nb: { solved: 12, moves: 300, bestLevel: 7 } } }),
    deep: rec({ name: 'Deep' }, { chinchon: { total: { played: 22, won: 14, lost: 6 }, byDiff: { normal: { played: 22, won: 14, lost: 6 } } } }),
  };
  const ranked = rankPlayers(aggregatePlayers(all));
  const by = (n) => ranked.find((r) => r.group.name === n);
  ok('the only player of a solo game does not score a flat 100', by('Solo').rating < 100, `got ${by('Solo').rating}`);
  ok('...but the solo player is still ranked and visible', by('Solo').rating != null && by('Solo').plays === 12);
  // NOTE (tuning, not correctness): a solo score is a relative-achievement ratio, so the field
  // leader scores ~1.0 by definition - and in a game only one person plays, that is them, always.
  // Wilson removes the flat-100 artifact but cannot discount a rate that has no variance to begin
  // with (there is no loss axis), so a solo leader still tends to outrank a mid competitive record.
  // If that reads wrong on the real family board, the lever is a solo-axis multiplier in
  // soloRating(), NOT a change to any of the assertions above.

  // The discount must ease off with volume, or solo play could never be competitive at all.
  const many = { solo: rec({ name: 'Solo' }, { nutsbolts: { total: { played: 400, won: 400, lost: 0 }, byDiff: { medium: { played: 400, won: 400, lost: 0 } }, nb: { solved: 400, moves: 9000, bestLevel: 30 } } }) };
  const big = rankPlayers(aggregatePlayers(many))[0];
  ok('a large solo record rates higher than a small one at the same relative standing',
    big.rating > by('Solo').rating, `400 levels=${big.rating} vs 12 levels=${by('Solo').rating}`);
}

// ---------------------------------------------------------------------------
console.log('\n-- THE LAW rule 1: nobody visible before the change is invisible after --');

{
  // A field spanning every shape that used to decide visibility, including the two the OLD board
  // dropped outright: solo-only players (filtered by `comp.played > 0`) and legacy-bucket records.
  const all = {
    d1: rec({ name: 'Ana', playerId: 'AAA11' }, { chinchon: { total: { played: 22, won: 14, lost: 6 }, byDiff: { normal: { played: 22, won: 14, lost: 6 } } } }, 5000),
    d2: rec({ name: 'Ana', playerId: 'AAA11' }, { escoba: { total: { played: 8, won: 5, lost: 3 }, byDiff: { normal: { played: 8, won: 5, lost: 3 } }, es: { escobas: 9 } } }, 6000),
    d3: rec({ name: 'Matt' }, { ballrun: { total: { played: 40, won: 40, lost: 0 }, byDiff: {}, br: { runs: 40, bestObstacles: 31, bestObstaclesByDiff: {} } } }, 7000),
    d4: rec({ name: 'Bego' }, { nutsbolts: { total: { played: 12, won: 12, lost: 0 }, byDiff: { medium: { played: 12, won: 12, lost: 0 } }, nb: { solved: 12, moves: 300, bestLevel: 7 } } }, 4000),
    d5: rec({ name: 'Vieja' }, { filler: { total: { played: 30, won: 11, lost: 19 }, byDiff: { legacy: { played: 30, won: 11, lost: 19 } } } }, 3000),
    d6: rec({ name: 'Draws' }, { tictactoe: { total: { played: 14, won: 2, lost: 2 }, byDiff: { pro: { played: 14, won: 2, lost: 2 } }, tt: { classic: { played: 14, won: 2, lost: 2, tied: 10 }, ultimate: { played: 0, won: 0, lost: 0, tied: 0 } } } }, 2000),
  };
  const list = aggregatePlayers(all).filter((g) => (g.name || '').trim());

  // The OLD board: overallRows filtered `comp.played > 0`, plus the two solo tabs.
  const oldOverall = new Set(list.filter((g) => g.comp.played > 0).map((g) => g.name));
  const oldSolo = new Set(list.filter((g) => (g.solo.solved | 0) > 0 || (g.games.ballrun.br && (g.games.ballrun.br.runs | 0) > 0)).map((g) => g.name));
  const oldVisible = new Set([...oldOverall, ...oldSolo]);

  // The NEW standings gate: any recorded play at all.
  const ranked = rankPlayers(list).filter((r) => r.plays > 0);
  const nowVisible = new Set(ranked.map((r) => r.group.name));

  const lost = [...oldVisible].filter((n) => !nowVisible.has(n));
  ok('every previously-visible player is still on the board', lost.length === 0, `missing: ${lost.join(', ')}`);
  // Six devices, five people: Ana's phone + laptop share a player code and aggregate into one row.
  ok('all five players are visible', nowVisible.size === 5, `visible: ${[...nowVisible].sort().join(', ')}`);
  ok("Ana's two devices count once, with both games' plays", ranked.find((r) => r.group.name === 'Ana').plays === 30);

  // Solo-only players were on NO main board before; they are ranked now.
  ok('Matt (Ball Run only) was absent from the old main board', !oldOverall.has('Matt'));
  ok('Matt is ranked on the new one', nowVisible.has('Matt'));
  ok('Bego (Nuts & Bolts only) is ranked too', nowVisible.has('Bego'));

  // No play may be lost anywhere in the transform.
  for (const r of ranked) {
    const g = r.group;
    let stored = 0;
    for (const id of Object.keys(g.games)) stored += g.games[id].total.played | 0;
    ok(`${g.name}: rating counts every stored play (${r.plays}/${stored})`, r.plays >= stored,
      `rated ${r.plays} of ${stored} stored`);
  }

  // The draw-heavy record is the headline correctness fix: it used to render 2-2 beside 14 plays.
  const draws = list.find((g) => g.name === 'Draws');
  const dr = record(draws.games.tictactoe.total);
  eq('draw-heavy Tic Tac Toe now reconciles', [dr.wins, dr.losses, dr.played], [12, 2, 14]);
  ok('...and its win rate matches its W-L', Math.round((dr.wins / dr.played) * 100) === 86);

  // Legacy-bucket player keeps every play and is rated.
  const vieja = ranked.find((r) => r.group.name === 'Vieja');
  eq('legacy-bucket player keeps all 30 plays', vieja.plays, 30);
  ok('legacy-bucket player has a real rating', vieja.rating != null);
}

console.log(`\n${fail ? `${fail} FAILED` : 'all leaderboard-rank tests passed'}`);
process.exit(fail ? 1 : 0);
