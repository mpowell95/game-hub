// Headless unit tests for js/players-agg.js. Run: node players-agg.test.mjs
import { aggregatePlayers, identityKey, aggregateForViewer, COMPETITIVE, SOLO } from './js/players-agg.js';

let fail = 0;
const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); } else console.log(`ok   ${label}`); };
const ok = (label, cond) => { if (!cond) { fail++; console.log(`FAIL ${label}`); } else console.log(`ok   ${label}`); };

// helpers to build synthetic players/ records
const comp = (played, won, lost) => ({ total: { played, won, lost } });
const rec = (profile, games, updatedAt = 1000) => ({ profile, stats: { games }, updatedAt });
const byKey = (list, needle) => list.find((g) => g.key.includes(needle));

// ---- identityKey precedence ----
eq('identity: code wins', identityKey({ playerId: 'ab7kq', name: 'x' }, 'dev1').key, 'code:AB7KQ');
eq('identity: name fallback', identityKey({ name: 'Bego' }, 'dev1').key, 'name:bego');
eq('identity: device fallback', identityKey({}, 'dev1').key, 'device:dev1');

// ---- code grouping: same code, different names, two devices -> ONE group ----
{
  const all = {
    d1: rec({ playerId: 'M8QK2', name: 'Matt', emoji: '🙂' }, { business: comp(5, 5, 0) }, 100),
    d2: rec({ playerId: 'm8qk2', name: 'MattyIce', emoji: '😎' }, { chinchon: comp(2, 2, 0) }, 200),
  };
  const list = aggregatePlayers(all);
  eq('code grouping -> 1 group', list.length, 1);
  eq('code grouping devices=2', list[0].devices, 2);
  eq('code grouping newest name adopted', list[0].name, 'MattyIce');
  eq('code grouping business summed', list[0].games.business.total.played, 5);
  eq('code grouping chinchon summed', list[0].games.chinchon.total.played, 2);
  eq('code grouping comp total', list[0].comp, { played: 7, won: 7, lost: 0 });
}

// ---- name fallback (Anita's two same-named devices, no code) still merges ----
{
  const all = {
    a1: rec({ name: 'Anita Bonita' }, { business: comp(2, 1, 1) }, 100),
    a2: rec({ name: 'anita bonita' }, { chinchon: comp(1, 1, 0) }, 200),
  };
  const list = aggregatePlayers(all);
  eq('name fallback -> 1 group', list.length, 1);
  eq('name fallback devices=2', list[0].devices, 2);
}

// ---- device fallback: two unnamed, no code -> stay separate ----
{
  const all = { u1: rec({}, {}, 100), u2: rec({}, {}, 200) };
  eq('device fallback -> 2 groups', aggregatePlayers(all).length, 2);
}

// ---- mid-migration: a partly-linked device (shares the name but not yet the code) merges via the
// identity GRAPH, same as once the code syncs too - this is the fix from 3a81990 ("Leaderboard: merge
// split identities"), not a regression: history must not stay stranded on separate rows just because
// one device hasn't picked up the code yet. ----
{
  const split = { d1: rec({ playerId: 'CODE9', name: 'Sam' }, { filler: comp(3, 2, 1) }, 100), d2: rec({ name: 'Sam' }, { filler: comp(1, 1, 0) }, 200) };
  const sl = aggregatePlayers(split);
  eq('mid-migration: name merges into coded group -> 1 group', sl.length, 1);
  eq('mid-migration: filler summed', sl[0].games.filler.total.played, 4);
  const healed = { d1: rec({ playerId: 'CODE9', name: 'Sam' }, { filler: comp(3, 2, 1) }, 100), d2: rec({ playerId: 'code9', name: 'Sam' }, { filler: comp(1, 1, 0) }, 200) };
  const hl = aggregatePlayers(healed);
  eq('fully-coded: still 1 group', hl.length, 1);
  eq('fully-coded: filler summed', hl[0].games.filler.total.played, 4);
}

// ---- 8-game summing + dim merges (grid add, cc add, es add, nb add/max) + solo exclusion ----
{
  const all = {
    d1: rec({ playerId: 'ALL88', name: 'Poly' }, {
      connect4: { total: { played: 3, won: 2, lost: 1 }, grid: { player: { easy: { w: 1, l: 0 }, medium: { w: 1, l: 1 }, hard: { w: 0, l: 0 }, expert: { w: 0, l: 0 } }, computer: { easy: { w: 0, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 }, expert: { w: 0, l: 0 } } } },
      chinchon: { total: { played: 2, won: 1, lost: 1 }, cc: { closed: 4, minusTen: 1, chinchons: 0 } },
      business: comp(4, 2, 2), parchis: comp(1, 0, 1), filler: comp(2, 1, 1), mancala: comp(3, 3, 0),
      escoba: { total: { played: 2, won: 1, lost: 1 }, es: { escobas: 3 } },
      nutsbolts: { total: { played: 10, won: 10, lost: 0 }, nb: { solved: 10, moves: 120, bestLevel: 12 } },
    }, 100),
    d2: rec({ playerId: 'all88', name: 'Poly2' }, {
      connect4: { total: { played: 1, won: 1, lost: 0 }, grid: { player: { easy: { w: 1, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 }, expert: { w: 0, l: 0 } }, computer: { easy: { w: 0, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 }, expert: { w: 0, l: 0 } } } },
      chinchon: { total: { played: 1, won: 0, lost: 1 }, cc: { closed: 1, minusTen: 0, chinchons: 1 } },
      escoba: { total: { played: 1, won: 0, lost: 1 }, es: { escobas: 2 } },
      nutsbolts: { total: { played: 5, won: 5, lost: 0 }, nb: { solved: 5, moves: 60, bestLevel: 20 } },
    }, 200),
  };
  const g = aggregatePlayers(all)[0];
  eq('8-game: connect4 summed', g.games.connect4.total.played, 4);
  eq('8-game: grid player.easy.w added', g.games.connect4.grid.player.easy.w, 2);
  eq('8-game: cc added', g.games.chinchon.cc, { closed: 5, minusTen: 1, chinchons: 1 });
  eq('8-game: es added', g.games.escoba.es.escobas, 5);
  eq('8-game: nb solved+moves added', [g.games.nutsbolts.nb.solved, g.games.nutsbolts.nb.moves], [15, 180]);
  eq('8-game: nb bestLevel = max', g.games.nutsbolts.nb.bestLevel, 20);
  // comp excludes nutsbolts: played = 3+1 +2+1 +4 +1 +2 +3 (c4,chin,bus,par,fil,man,esc)
  eq('comp excludes solo (played)', g.comp.played, 3 + 1 + 2 + 1 + 4 + 1 + 2 + 3 + 3);
  eq('solo solved', g.solo.solved, 15);
  eq('solo bestLevel', g.solo.bestLevel, 20);
  eq('totalPlays = comp + solved', g.totalPlays, g.comp.played + 15);
}

// ---- no-data-loss invariant across a mixed set ----
{
  const all = {
    d1: rec({ playerId: 'X1', name: 'A' }, { business: comp(3, 2, 1), nutsbolts: { total: { played: 4, won: 4, lost: 0 }, nb: { solved: 4, moves: 40, bestLevel: 5 } } }, 1),
    d2: rec({ playerId: 'x1', name: 'A2' }, { business: comp(2, 0, 2) }, 2),
    d3: rec({ name: 'Bego' }, { mancala: comp(6, 3, 3) }, 3),
    d4: rec({}, {}, 4),
  };
  const list = aggregatePlayers(all);
  // sum of comp.played + solo.solved across groups == sum of every record's played
  let inPlayed = 0;
  for (const id in all) { const gs = all[id].stats.games; for (const k in gs) inPlayed += (gs[k].total.played | 0); }
  let outPlayed = 0; for (const grp of list) outPlayed += grp.comp.played + grp.solo.solved;
  eq('no data loss: Σ played preserved', outPlayed, inPlayed);
}

// ---- Dots and Boxes' db sub-counter survives the cross-device combine (THE LAW rule 1) ----
// Regression guard for the same defect as the tt/bg cases: `db` carries ties, cumulative
// boxes claimed and the best single-turn chain, all of which the Stats screen reads and
// all of which blanked out on a second synced device before players-agg carried db forward.
{
  const all = {
    d1: rec({ playerId: 'DB111', name: 'Box' }, {
      dotsboxes: {
        total: { played: 4, won: 3, lost: 0 },
        db: { played: 4, won: 3, lost: 0, tied: 1, boxes: 40, bestChain: 7 },
      },
    }, 100),
    d2: rec({ playerId: 'db111', name: 'Box' }, {
      dotsboxes: {
        total: { played: 2, won: 0, lost: 2 },
        db: { played: 2, won: 0, lost: 2, tied: 0, boxes: 11, bestChain: 3 },
      },
    }, 200),
  };
  const db = aggregatePlayers(all)[0].games.dotsboxes.db;
  eq('dotsboxes: W/L/T counters summed across devices', [db.played, db.won, db.lost, db.tied], [6, 3, 2, 1]);
  eq('dotsboxes: boxes claimed summed', db.boxes, 51);
  eq('dotsboxes: bestChain is the max, not the sum', db.bestChain, 7);
}

// ---- Boggle's bg sub-counter survives the cross-device combine (THE LAW rule 1) ----
// `total` aggregating correctly is NOT enough: the Boggle Stats screen reads `bg` for
// ties, best score, words found and the longest word. Before players-agg carried `bg`
// forward, all four blanked out the moment a second device synced -- present in every
// device's own store, invisible on the combined screen. Same hazard the tt branch
// documents. Counters add, bests take the max, and the longest word keeps its TEXT
// paired with its own length (never a max on `len` next to a different device's word).
{
  const all = {
    d1: rec({ playerId: 'BG111', name: 'Word' }, {
      boggle: {
        total: { played: 3, won: 2, lost: 0 },
        bg: { played: 3, won: 2, lost: 0, tied: 1, words: 12, bestScore: 30, longestWord: { word: 'STARTER', len: 7 } },
      },
    }, 100),
    d2: rec({ playerId: 'bg111', name: 'Word' }, {
      boggle: {
        total: { played: 2, won: 0, lost: 2 },
        bg: { played: 2, won: 0, lost: 2, tied: 0, words: 5, bestScore: 44, longestWord: { word: 'QUITTERS', len: 8 } },
      },
    }, 200),
  };
  const bg = aggregatePlayers(all)[0].games.boggle.bg;
  eq('boggle: W/L/T counters summed across devices', [bg.played, bg.won, bg.lost, bg.tied], [5, 2, 2, 1]);
  eq('boggle: words found summed', bg.words, 17);
  eq('boggle: bestScore is the max, not the sum or the last one', bg.bestScore, 44);
  eq('boggle: longest word keeps its own text and length together', bg.longestWord, { word: 'QUITTERS', len: 8 });
}

// ---- Yahtzee's yz sub-counter survives the cross-device combine (THE LAW rule 1) ----
// `total` aggregating correctly is NOT enough: the Yahtzee Stats screen reads `yz` for
// ties, Yahtzee count and best score. Without the yz branch, all three blank out the
// moment a second device syncs. Counters add; bestScore takes the max, same shape as
// boggle's bg branch above.
{
  const all = {
    d1: rec({ playerId: 'YZ111', name: 'Dice' }, {
      yahtzee: {
        total: { played: 3, won: 2, lost: 0 },
        yz: { played: 3, won: 2, lost: 0, tied: 1, yahtzees: 2, bestScore: 288 },
      },
    }, 100),
    d2: rec({ playerId: 'yz111', name: 'Dice' }, {
      yahtzee: {
        total: { played: 2, won: 0, lost: 2 },
        yz: { played: 2, won: 0, lost: 2, tied: 0, yahtzees: 1, bestScore: 312 },
      },
    }, 200),
  };
  const yz = aggregatePlayers(all)[0].games.yahtzee.yz;
  eq('yahtzee: W/L/T counters summed across devices', [yz.played, yz.won, yz.lost, yz.tied], [5, 2, 2, 1]);
  eq('yahtzee: yahtzees summed', yz.yahtzees, 3);
  eq('yahtzee: bestScore is the max, not the sum or the last one', yz.bestScore, 312);
}

// ---- Snake's sn sub-counter survives the cross-device combine (THE LAW rule 1) ----
// The per-game regression case "Adding a game" item 7 requires: without the sn branch the
// Snake Stats screen and leaderboard read zero runs/bests as soon as a second device syncs.
// Counters add; length bests take the max (never a sum), overall and per difficulty. A device
// with NO snake key at all (synced before Snake existed) must combine cleanly too.
{
  const all = {
    d1: rec({ playerId: 'SN111', name: 'Slither' }, {
      snake: {
        total: { played: 4, won: 4, lost: 0 },
        byDiff: { medium: { played: 4, won: 4, lost: 0 } },
        sn: { runs: 4, bestLen: 21, bestLenByDiff: { easy: 0, medium: 21, hard: 0 } },
      },
    }, 100),
    d2: rec({ playerId: 'sn111', name: 'Slither' }, {
      snake: {
        total: { played: 2, won: 2, lost: 0 },
        byDiff: { hard: { played: 2, won: 2, lost: 0 } },
        sn: { runs: 2, bestLen: 14, bestLenByDiff: { easy: 0, medium: 0, hard: 14 } },
      },
    }, 200),
    d3: rec({ playerId: 'SN111', name: 'Slither' }, {}, 300),   // pre-Snake device: no snake key
  };
  const grp = aggregatePlayers(all)[0];
  const sn = grp.games.snake.sn;
  eq('snake: one person, three devices, one row', aggregatePlayers(all).length, 1);
  eq('snake: runs summed across devices', sn.runs, 6);
  eq('snake: bestLen is the max, not the sum or the last one', sn.bestLen, 21);
  eq('snake: per-difficulty bests take the max per tier', [sn.bestLenByDiff.medium, sn.bestLenByDiff.hard], [21, 14]);
  eq('snake: totals still aggregate alongside', grp.games.snake.total.played, 6);
}

// ---- Snake's walls-mode split (2026-07-28 leaderboard split) survives the combine, and a
// pre-split device (no bestLenByWalls/bestLenByDiffWalls/runsByWalls at all) contributes its
// legacy combined bests/runs to the OFF bucket instead of silently contributing zero -- the real
// bug found in production: every device reads 0-0 on the leaderboard split until IT ITSELF
// reloads and runs the local seed, which could be days after this ships, so aggregation must
// apply the same "pre-split history is Walls off" policy per-source-device, not wait for it. ----
{
  const all = {
    d1: rec({ playerId: 'SN222', name: 'Wriggler' }, {
      snake: {
        total: { played: 3, won: 3, lost: 0 },
        byDiff: { medium: { played: 3, won: 3, lost: 0 } },
        sn: {
          runs: 3, bestLen: 30, bestLenByDiff: { easy: 0, medium: 30, hard: 0 },
          bestLenByWalls: { on: 12, off: 30 },
          bestLenByDiffWalls: { on: { easy: 0, medium: 12, hard: 0 }, off: { easy: 0, medium: 30, hard: 0 } },
          runsByWalls: { on: 1, off: 2 },
        },
      },
    }, 100),
    d2: rec({ playerId: 'sn222', name: 'Wriggler' }, {
      snake: {
        total: { played: 1, won: 1, lost: 0 },
        byDiff: { medium: { played: 1, won: 1, lost: 0 } },
        sn: { runs: 1, bestLen: 18, bestLenByDiff: { easy: 0, medium: 18, hard: 0 } },   // pre-split device
      },
    }, 200),
  };
  const grp = aggregatePlayers(all)[0];
  const sn = grp.games.snake.sn;
  eq('snake walls: on/off bests take the max, not the sum', [sn.bestLenByWalls.on, sn.bestLenByWalls.off], [12, 30]);
  eq('snake walls: per-diff on/off bests take the max per tier', sn.bestLenByDiffWalls.off.medium, 30);
  eq('snake walls: a pre-split source device\'s runs land in OFF, not 0', [sn.runsByWalls.on, sn.runsByWalls.off], [1, 3]);
  eq('snake walls: combined bestLen still aggregates regardless of the split', sn.bestLen, 30);
}

// ---- Snake walls split: a solo pre-split device (never resynced since this shipped) must NOT
// read 0-0 on the leaderboard -- this is the exact bug report ("0-0 for everyone"): a fresh
// aggregate over ONLY legacy-shaped records had no bestLenByWalls anywhere to fall back on. ----
{
  const all = {
    d1: rec({ playerId: 'SN333', name: 'Legacy' }, {
      snake: {
        total: { played: 5, won: 5, lost: 0 },
        byDiff: { hard: { played: 5, won: 5, lost: 0 } },
        sn: { runs: 5, bestLen: 40, bestLenByDiff: { easy: 0, medium: 0, hard: 40 } },
      },
    }, 100),
  };
  const sn = aggregatePlayers(all)[0].games.snake.sn;
  eq('snake walls: an all-legacy player is NOT 0-0, their history reads as Walls off', [sn.bestLenByWalls.off, sn.bestLenByWalls.on], [40, 0]);
  eq('snake walls: an all-legacy player\'s per-diff off bucket carries the real best', sn.bestLenByDiffWalls.off.hard, 40);
  eq('snake walls: an all-legacy player\'s runs land in off, not lost', sn.runsByWalls.off, 5);
}

// ---- Player message: newest-messageAt wins, NOT rec.updatedAt (HANDOFF-PROFILE-MESSAGE.md) ----
{
  // 1. two devices of one person, only device A has a message -> the group shows A's message.
  const all1 = {
    d1: rec({ playerId: 'MSG11', name: 'TP', message: "Who's the King of Games now?", messageAt: 500 }, {}, 100),
    d2: rec({ playerId: 'msg11', name: 'TP' }, {}, 200),   // no message field at all
  };
  const g1 = aggregatePlayers(all1)[0];
  eq('message: only-device-A message wins', g1.message, "Who's the King of Games now?");
  eq('message: no crash / defaults to empty when a device has no message field', g1.messageAt, 500);

  // 2. device B then syncs with a NEWER rec.updatedAt but messageAt:0 -> A's message SURVIVES.
  // This is the regression that motivated the separate stamp: keying off rec.updatedAt would let
  // a device that merely re-synced (never touched the message) blank it out.
  const all2 = {
    d1: rec({ playerId: 'MSG11', name: 'TP', message: "Who's the King of Games now?", messageAt: 500 }, {}, 100),
    d2: rec({ playerId: 'msg11', name: 'TP' }, {}, 99999),   // newer sync time, messageAt 0
  };
  const g2 = aggregatePlayers(all2)[0];
  eq('message: survives a newer-updatedAt device with messageAt 0', g2.message, "Who's the King of Games now?");

  // 3. device A clears it with a newer messageAt -> the group's message is ''.
  const all3 = {
    d1: rec({ playerId: 'MSG11', name: 'TP', message: '', messageAt: 600 }, {}, 100),
    d2: rec({ playerId: 'msg11', name: 'TP', message: "Who's the King of Games now?", messageAt: 500 }, {}, 200),
  };
  const g3 = aggregatePlayers(all3)[0];
  eq('message: a newer-messageAt CLEAR beats an older set message', g3.message, '');

  // 4. a device with no message field at all (every record in production today) -> message: '', no crash.
  const all4 = { d1: rec({ playerId: 'MSG22', name: 'NoMsg' }, {}, 100) };
  const g4 = aggregatePlayers(all4)[0];
  eq('message: legacy record with no message field -> empty, no crash', g4.message, '');
  eq('message: legacy record with no messageAt field -> 0', g4.messageAt, 0);
}

// ---- aggregateForViewer: fresh device with my code shows my other devices' history ----
{
  const all = { other: rec({ playerId: 'ME777', name: 'Me' }, { business: comp(9, 6, 3) }, 100) };
  const localEmpty = { games: { business: { total: { played: 0, won: 0, lost: 0 } } } };
  const g = aggregateForViewer(all, { playerId: 'me777', name: 'Me', emoji: '🙂' }, 'myFreshDevice', localEmpty);
  ok('viewer: group found', !!g);
  eq('viewer: sees remote history (business 9)', g.games.business.total.played, 9);
  // and my own fresh local plays add on top without double counting my synced record
  const all2 = { myFreshDevice: rec({ playerId: 'ME777', name: 'Me' }, { business: comp(9, 6, 3) }, 50), other: rec({ playerId: 'ME777', name: 'Me' }, { business: comp(1, 1, 0) }, 100) };
  const localAhead = { games: { business: { total: { played: 10, won: 7, lost: 3 } } } };  // my device now has 10 locally
  const g2 = aggregateForViewer(all2, { playerId: 'ME777', name: 'Me' }, 'myFreshDevice', localAhead);
  eq('viewer: own device uses LOCAL not stale remote (10 + other 1 = 11)', g2.games.business.total.played, 11);
}

// ---- NAME_ALIAS: two spellings of one person fold into ONE row, with a pinned label ----
// Regression for Lili (2026-07-31), who kept splitting back into "Lili" + "Lill". A rename done in
// Firebase does not hold: syncMyStats() re-mirrors each device's own local profile on every hub
// load, so the phone still spelling it "Lill" rewrote the record back. The alias is read-time, so
// it survives that. Both orderings of "which device synced last" are checked, because the display
// name is otherwise chosen by recency and would flicker.
{
  for (const [lastSynced, label] of [['lill', 'Lill device synced last'], ['lili', 'Lili device synced last']]) {
    const all = {
      d1: rec({ name: 'Lili' }, { connect4: comp(10, 6, 4) }, lastSynced === 'lili' ? 900 : 100),
      d2: rec({ name: 'Lill' }, { connect4: comp(4, 1, 3) }, lastSynced === 'lill' ? 900 : 100),
    };
    const list = aggregatePlayers(all);
    eq(`alias (${label}): one row, not two`, list.length, 1);
    eq(`alias (${label}): row is labelled "Lili"`, list[0].name, 'Lili');
    eq(`alias (${label}): both devices' plays are combined`, list[0].games.connect4.total.played, 14);
    eq(`alias (${label}): ...and their wins`, list[0].games.connect4.total.won, 7);
    eq(`alias (${label}): counted as two devices`, list[0].devices, 2);
  }
  // Case and surrounding whitespace must not defeat it (profile names are free text).
  const messy = { a: rec({ name: '  LILL ' }, { connect4: comp(2, 1, 1) }), b: rec({ name: 'lili' }, { connect4: comp(3, 2, 1) }, 50) };
  eq('alias: case/whitespace insensitive', aggregatePlayers(messy).length, 1);
  eq('alias: still labelled "Lili"', aggregatePlayers(messy)[0].name, 'Lili');
  // ...without swallowing anyone else. "Lilian" is a different person, not an alias key.
  const other = { a: rec({ name: 'Lili' }, { connect4: comp(2, 1, 1) }), b: rec({ name: 'Lilian' }, { connect4: comp(3, 2, 1) }) };
  eq('alias: exact match only, "Lilian" stays separate', aggregatePlayers(other).length, 2);
  // A name with no DISPLAY_NAME entry is shown exactly as the device wrote it (unchanged behaviour).
  eq('non-aliased names are untouched', aggregatePlayers({ a: rec({ name: 'Bego' }, { connect4: comp(1, 1, 0) }) })[0].name, 'Bego');
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
