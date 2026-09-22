// test-baseball-career.mjs - headless tests for Baseball's career loop, R15-A
// (docs/BASEBALL-3D-BUILD.md section 9, "R15: the career", part A item 6).
//
// Two halves, and the header says which is which:
//
//   RULES (baseball/js/engine/career.js) - a whole career is played with SCRIPTED results, no
//   engine, no browser, no clock: the ladder, the playoff cut, the trophies, the points table at
//   every league, the caps, immutability, the frozen history row, and the per-game stats collector
//   fed a hand-written event stream. One block drives the REAL engine through `startGame` /
//   `Game.fromSnapshot` to prove a resumed mid-at-bat game restores the count, because that is the
//   one thing reading the state cannot prove.
//
//   PERSISTENCE (baseball/js/career-io.js) - a round trip against the SAME fake `{db, api}` seam
//   `test-career-sync.mjs` installs through `globalThis.__CAREER_TEST_BOOT__`, with the same
//   localStorage shim. It drives the real career-io, career-store and game-stats, not a mirror.
//
// WHAT IS NOT COVERED, stated up front: a real Firebase boot, and any screen (R15-B owns those and
// carries its own device probes). The engine's own play is `baseball/js/test.js`'s job; this suite
// only ever asks the engine to resume.

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass += 1; } else { fail += 1; console.error('  FAIL ' + what); } };
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('test-baseball-career.mjs');

// The localStorage shim goes in BEFORE any import that might reach for it (career-io pulls in
// js/game-stats.js, which reads the store at module scope through its own helpers).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const CODE = 'BB7KM';
store.set('gamehub.profile', JSON.stringify({ version: 1, name: 'Bud', playerId: CODE }));

const C = await import('./baseball/js/engine/career.js');
const { LEAGUES, POINTS, CAPS, START_CAP, SEASON, SKILL_IDS, PRESETS, RULES_V } =
  await import('./baseball/js/engine/settings.js');

// -----------------------------------------------------------------------------------------------
// Helpers: play a whole season with a scripted win/loss list, never an engine.
// -----------------------------------------------------------------------------------------------

const START_BUILD = { ...PRESETS.twoWayStar };   // 5/5/5 and 5/5/5, the doc's own 15-per-side start

function fresh(now = 1000) {
  return C.newCareer({ hand: 'R', presetId: 'twoWayStar', skills: START_BUILD, now, careerId: `${CODE}-${now}-AAAA` });
}

/** Play one game with a scripted outcome. `stats` is an optional per-game extras object. */
function playOne(state, won, stats) {
  const meta = C.nextGame(state);
  const you = won ? 5 : 1;
  const cpu = won ? 1 : 5;
  return C.finishGame(state, { won, you, cpu, gameStats: stats || {}, meta });
}

/**
 * Drive a whole season: `wins` regular-season wins first, then the rest losses, then the playoff
 * games with the given results (`playoff` is a list like ['win','loss']).
 * @returns {{ state, records: Array, trophy }}
 */
function playSeason(state0, wins, playoff = []) {
  let state = C.startSeason(state0);
  const records = [];
  let trophy = null;
  for (let i = 0; i < SEASON.gamesPerSeason; i++) {
    const r = playOne(state, i < wins);
    state = r.state; records.push(r.record);
    if (r.resolved) trophy = r.trophy;
  }
  for (const want of playoff) {
    if (!C.nextGame(state)) break;
    const r = playOne(state, want === 'win');
    state = r.state; records.push(r.record);
    if (r.resolved) trophy = r.trophy;
  }
  return { state, records, trophy };
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: a new career ---');
// -----------------------------------------------------------------------------------------------
{
  const s = fresh();
  eq(s.league, 'little', 'a new career starts at Little League');
  eq(s.unspent, 0, 'a new career has no unspent points');
  eq(s.cap, START_CAP, 'a new career carries the start cap of 10');
  eq(s.seasonsPlayed, 0, 'no seasons played yet');
  eq(s.season, null, 'no season started yet');
  eq(s.game, null, 'no game in progress');
  eq(SKILL_IDS.reduce((a, id) => a + s.player.skills[id], 0), 30, 'the start build is 15 per side, 30 in all');
  eq(C.validateState(s), [], 'a new career validates');
  eq(C.capRoom(s), 30, 'cap room at the start is 6 x 10 minus 30 = 30 (the doc section 7 table)');
  eq(s.rulesV, RULES_V, 'the career records the settings RULES_V it was built under');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: immutability ---');
// -----------------------------------------------------------------------------------------------
{
  const s = fresh();
  const before = JSON.stringify(s);
  const started = C.startSeason(s);
  eq(JSON.stringify(s), before, 'startSeason does not mutate its argument');
  ok(started !== s, 'startSeason returns a new object');

  const beforeStarted = JSON.stringify(started);
  const after = C.finishGame(started, { won: true, you: 4, cpu: 0, gameStats: { hits: 2 } });
  eq(JSON.stringify(started), beforeStarted, 'finishGame does not mutate its argument');
  ok(after.state !== started, 'finishGame returns a new state');
  ok(after.state.season !== started.season, 'finishGame replaces the season object rather than editing it');
  ok(after.state.stats !== started.stats, 'finishGame replaces the stats object rather than editing it');

  const earned = C.earn(started, 5);
  eq(JSON.stringify(started), beforeStarted, 'earn does not mutate its argument');
  const spent = C.spend(earned, 'hitPow');
  eq(JSON.stringify(earned.player.skills), JSON.stringify({ ...START_BUILD }), 'spend does not mutate the argument\'s skills');
  eq(spent.player.skills.hitPow, START_BUILD.hitPow + 1, 'spend adds the point to the new state');

  const ck = C.checkpoint(after.state, { fake: 1 });
  eq(JSON.stringify(after.state), JSON.stringify(after.state), 'checkpoint leaves its argument alone');
  eq(ck.game, null, 'a checkpoint with no game in progress is a no-op');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: validateState rejects a malformed state WHOLE ---');
// -----------------------------------------------------------------------------------------------
{
  const good = C.startSeason(fresh());
  eq(C.validateState(good), [], 'a started season validates');
  const bad = [
    ['v', 99], ['careerId', ''], ['startedAt', -1], ['unspent', -1], ['cap', 0],
    ['league', 'triple-a'], ['bestLeague', -1], ['seasonsPlayed', 1.5], ['rulesV', 0],
  ];
  for (const [field, value] of bad) {
    const broken = { ...good, [field]: value };
    ok(C.validateState(broken).length > 0, `a state with a bad '${field}' is rejected`);
  }
  ok(C.validateState({ ...good, player: { ...good.player, hand: 'X' } }).length > 0, 'a hand outside L/R is rejected');
  ok(C.validateState({ ...good, player: { ...good.player, skills: { ...good.player.skills, hitPow: -1 } } }).length > 0,
    'a negative skill is rejected');
  ok(C.validateState({ ...good, stats: { ...good.stats, hits: 'lots' } }).length > 0, 'a non-integer counter is rejected');
  ok(C.validateState({ ...good, season: { ...good.season, phase: 'overtime' } }).length > 0, 'an unknown phase is rejected');
  ok(C.validateState({ ...good, season: { ...good.season, schedule: [] } }).length > 0, 'a short schedule is rejected');
  ok(C.validateState(null).length > 0, 'null is rejected');
  ok(C.validateState('nope').length > 0, 'a non-object is rejected');
  eq(C.validateState(good), [], 'and none of those rejections touched the good state');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: the season snapshot ---');
// -----------------------------------------------------------------------------------------------
{
  const s = C.startSeason(fresh());
  eq(s.season.n, 1, 'the first season is number 1');
  eq(s.season.league, 'little', 'the season records the league it is played on');
  eq(s.season.schedule.length, SEASON.gamesPerSeason, 'the schedule is snapshotted at 12 games');
  eq(s.season.points, { ...POINTS.little }, 'the point table is snapshotted at season start');
  eq(s.season.cap, START_CAP, 'the cap is snapshotted at season start');
  eq(s.season.schedule[SEASON.gamesPerSeason - 1].opponentIndex, 7,
    'game 12 is always against the strongest team (doc section 8, every SCHEDULE_SHAPE)');

  // A tuning deploy must not rewrite a season in progress: the season pays from its own snapshot.
  const tampered = { ...s, season: { ...s.season, points: { win: 99, loss: 0, bronze: 0, silver: 0, gold: 0 } } };
  const r = C.finishGame(tampered, { won: true, you: 3, cpu: 2 });
  eq(r.state.unspent, 30, 'a season pays from ITS OWN snapshotted point table (99 clamped to the 30 of room)');
  eq(r.state.pointsEarned, 99, '...and the gross is recorded even when the cap eats it');
  eq(r.state.pointsLost, 69, '...with the excess counted as lost, never banked');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: nextGame walks the season and stops ---');
// -----------------------------------------------------------------------------------------------
{
  let state = C.startSeason(fresh());
  const kinds = [];
  for (let i = 0; i < SEASON.gamesPerSeason; i++) {
    const m = C.nextGame(state);
    kinds.push(m.kind);
    eq(m.idx, i, `game ${i + 1} reports idx ${i}`);
    state = playOne(state, true).state;
  }
  eq(new Set(kinds).size, 1, 'all 12 regular-season games report kind "regular"');
  eq(C.nextGame(state).kind, 'semifinal', 'a 12-0 record goes to the semifinal');
  state = playOne(state, true).state;
  eq(C.nextGame(state).kind, 'championship', 'winning the semifinal goes to the championship');
  state = playOne(state, true).state;
  eq(C.nextGame(state), null, 'a resolved season has no next game');
  eq(state.season.phase, 'done', '...and its phase is done');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: the playoff cut, the trophies, and what replays ---');
// -----------------------------------------------------------------------------------------------
{
  // scriptedStandings ('rawWins7') gives the eight CPU teams 0..7 wins and breaks every tie
  // AGAINST the player (strengthRank -1), so the top-4 cut sits at "more than 4 wins".
  for (const [wins, expected] of [[3, false], [4, false], [5, true], [9, true], [12, true]]) {
    const { state } = playSeason(fresh(), wins, []);
    const made = state.season.phase !== 'done' || state.season.trophy !== 0;
    eq(made, expected, `a ${wins}-${SEASON.gamesPerSeason - wins} record ${expected ? 'makes' : 'misses'} the top 4`);
  }
  {
    const { state, trophy } = playSeason(fresh(), 4, []);
    eq(trophy, 0, 'missing the playoffs is trophy 0');
    eq(state.league, 'little', '...and replays the same league (doc section 4)');
    eq(state.seasonsPlayed, 1, '...and still counts as a season played');
  }
  {
    const { state, trophy } = playSeason(fresh(), 9, ['loss']);
    eq(trophy, 1, 'losing the semifinal is Bronze');
    eq(state.league, 'little', 'Bronze replays the league');
  }
  {
    const { state, trophy } = playSeason(fresh(), 9, ['win', 'loss']);
    eq(trophy, 2, 'losing the championship is Silver');
    eq(state.league, 'little', 'Silver replays the league');
  }
  {
    const { state, trophy } = playSeason(fresh(), 9, ['win', 'win']);
    eq(trophy, 3, 'winning the championship is Gold');
    eq(state.league, 'highschool', 'only Gold advances the league');
    eq(state.cap, CAPS.highschool, '...and the cap rises with it');
    eq(state.bestLeague, 2, '...and bestLeague follows');
    eq(state.bestTrophyByLeague.little, 3, '...and the league keeps its best trophy');
  }
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: the points table at every league (doc section 7) ---');
// -----------------------------------------------------------------------------------------------
//
// Measured, not asserted from the doc's prose: a 9-3 season with each trophy, at each league, with
// the cap held out of the way so the raw yield is visible. `pointsEarned` is the GROSS the results
// paid; `unspent` is what survived the cap.
{
  const table = [];
  for (const league of LEAGUES) {
    const row = { league };
    for (const [label, playoff] of [['miss', null], ['bronze', ['loss']], ['silver', ['win', 'loss']], ['gold', ['win', 'win']]]) {
      // A career parked on this league with an ENORMOUS cap, so nothing is clamped.
      const base = { ...fresh(), league, cap: 1000 };
      const { state } = playSeason(base, label === 'miss' ? 4 : 9, playoff || []);
      row[label] = state.pointsEarned;
    }
    table.push(row);
  }
  console.log('    league      9-3+miss  9-3+bronze  9-3+silver  9-3+gold   (4-8 for miss)');
  for (const r of table) {
    console.log(`    ${r.league.padEnd(11)} ${String(r.miss).padStart(6)} ${String(r.bronze).padStart(11)} ${String(r.silver).padStart(11)} ${String(r.gold).padStart(9)}`);
  }
  for (const league of LEAGUES) {
    const P = POINTS[league];
    const r = table.find((x) => x.league === league);
    eq(r.miss, 4 * P.win + 8 * P.loss, `${league}: a 4-8 missed-playoff season pays 4 wins and 8 losses exactly`);
    eq(r.bronze, 9 * P.win + 3 * P.loss + P.bronze, `${league}: 9-3 plus a semifinal LOSS pays the regular season plus Bronze (the playoff loss pays nothing)`);
    eq(r.silver, 9 * P.win + 3 * P.loss + P.silver, `${league}: 9-3 plus a championship loss pays the regular season plus Silver (the semifinal WIN pays nothing)`);
    eq(r.gold, 9 * P.win + 3 * P.loss + P.gold, `${league}: 9-3 plus a championship win pays the regular season plus Gold`);
  }
  // The doc's own worked example, section 7: "At 12 games a season with a 9-3 record and Gold...
  // Little League: cap room 30, yield 38."
  const gold = playSeason(fresh(), 9, ['win', 'win']);
  eq(gold.state.pointsEarned, 38, 'doc section 7: a 9-3 Gold season at Little League yields 38 gross');
  eq(gold.state.unspent, 30, '...of which 30 fit in the cap room');
  eq(gold.state.pointsLost, 8, '...and 8 were lost to the cap, exactly as the doc says');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: caps, cap room and spending ---');
// -----------------------------------------------------------------------------------------------
{
  eq(C.capForLeague('little'), START_CAP, 'the Little League cap is the start cap');
  for (const lg of LEAGUES.slice(1)) eq(C.capForLeague(lg), CAPS[lg], `the ${lg} cap is CAPS.${lg}`);

  // Unspent is clamped to room, and the excess is LOST - it is not held for the next league.
  let s = { ...fresh(), cap: 10 };
  s = C.earn(s, 1000);
  eq(s.unspent, 30, 'unspent never exceeds cap room');
  eq(s.pointsLost, 970, '...and the overflow is counted as lost, not banked');
  eq(C.capRoom(s), 0, 'with the room full, cap room reads 0');
  s = C.earn(s, 5);
  eq(s.unspent, 30, 'earning against a full room adds nothing');

  // Spending frees nothing (the point moves from unspent onto the skill, room is unchanged).
  const spent = C.spend(s, 'hitPow');
  eq(spent.unspent, 29, 'spend takes one from unspent');
  eq(spent.player.skills.hitPow, 6, '...and puts it on the skill');
  eq(C.capRoom(spent), 0, '...and the cap room is unchanged, because the point is still under the cap');

  // A skill already at the cap refuses.
  let maxed = { ...fresh(), cap: 10, unspent: 20 };
  for (let i = 0; i < 5; i++) maxed = C.spend(maxed, 'hitPow');
  eq(maxed.player.skills.hitPow, 10, 'five spends take a 5 to the cap of 10');
  const refused = C.spend(maxed, 'hitPow');
  eq(refused.player.skills.hitPow, 10, 'a spend at the cap is refused');
  eq(refused.unspent, maxed.unspent, '...and costs nothing');
  eq(C.spend(maxed, 'notASkill').unspent, maxed.unspent, 'a spend on an unknown skill is refused');
  eq(C.spend({ ...maxed, unspent: 0 }, 'hitAcc').player.skills.hitAcc, maxed.player.skills.hitAcc,
    'a spend with nothing unspent is refused');

  // The cap RISES on an advance and HOLDS on a replay.
  const replay = playSeason(fresh(), 9, ['loss']);
  eq(replay.state.cap, START_CAP, 'a replayed league keeps its cap');
  const advance = playSeason(fresh(), 9, ['win', 'win']);
  eq(advance.state.cap, CAPS.highschool, 'advancing raises the cap');
  const second = playSeason(advance.state, 9, ['win', 'win']);
  eq(second.state.cap, CAPS.college, '...and again on the next advance');
  ok(second.state.cap > advance.state.cap, 'the cap only ever rises');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: a full career climbs to the Majors ---');
// -----------------------------------------------------------------------------------------------
{
  let state = fresh();
  const climbed = [state.league];
  for (let i = 0; i < 4; i++) {
    state = playSeason(state, 9, ['win', 'win']).state;
    climbed.push(state.league);
  }
  eq(climbed, ['little', 'highschool', 'college', 'minors', 'majors'], 'four Golds walk the whole ladder');
  eq(state.seasonsPlayed, 4, 'four seasons resolved');
  eq(state.bestLeague, 5, 'bestLeague reaches the Majors');
  eq(state.stats.golds, 4, 'four Golds counted');
  eq(state.wsTitles, 0, 'none of them was a World Series (they were promotions)');

  // Majors Gold counts a World Series title and STAYS in the Majors (doc section 4).
  const ws = playSeason(state, 9, ['win', 'win']);
  eq(ws.state.league, 'majors', 'a Majors Gold stays in the Majors');
  eq(ws.state.wsTitles, 1, '...and counts a World Series title');
  eq(ws.state.perfectSeasons, 0, '...but a 9-3 season is not a perfect one');
  eq(ws.state.bestTrophyByLeague.majors, 3, '...and records Gold in the Majors');
  const wsRecord = ws.records[ws.records.length - 1];
  eq(wsRecord.extras.wsTitles, 1, 'the title rides on the final game\'s recorder call');
  eq(wsRecord.extras.seasons, 1, '...as does the season');
  eq(wsRecord.extras.trophy, 3, '...as does the trophy');

  // Perfect season: every regular AND playoff game won, in the Majors (doc section 5, [Locked]).
  const perfect = playSeason(ws.state, SEASON.gamesPerSeason, ['win', 'win']);
  eq(perfect.state.perfectSeasons, 1, 'a 12-0 Majors season with both playoff wins is a Perfect Season');
  eq(perfect.state.wsTitles, 2, '...and is also a World Series title');
  eq(perfect.state.season.perfect, true, '...and the season says so');
  eq(perfect.records[perfect.records.length - 1].extras.perfectSeasons, 1, '...and it rides on the final game\'s call');

  // A 12-0 season one rung DOWN is not a perfect season.
  let lower = fresh();
  lower = playSeason(lower, SEASON.gamesPerSeason, ['win', 'win']).state;
  eq(lower.perfectSeasons, 0, 'a 12-0 Gold below the Majors is not a Perfect Season');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: one recorder call per game, the season riding on the last one ---');
// -----------------------------------------------------------------------------------------------
{
  const { records } = playSeason(fresh(), 9, ['win', 'win']);
  eq(records.length, SEASON.gamesPerSeason + 2, 'one recorder call per game, 12 regular plus 2 playoff');
  eq(records.filter((r) => r.extras.seasons).length, 1, 'exactly ONE of them carries seasons: 1');
  eq(records.filter((r) => r.extras.trophy != null).length, 1, 'exactly ONE of them carries the trophy');
  eq(records[records.length - 1].extras.trophy, 3, 'and it is the last game of the season');
  eq(records.every((r) => r.league === 'little'), true, 'every call names the league the season was played on');
  eq(records.filter((r) => r.won).length, 11, '9 regular wins plus 2 playoff wins');

  // A missed-playoff season resolves on the LAST REGULAR GAME, not on a game that never happens.
  const missed = playSeason(fresh(), 4, []);
  eq(missed.records.length, SEASON.gamesPerSeason, 'a missed-playoff season makes exactly 12 calls');
  eq(missed.records[SEASON.gamesPerSeason - 1].extras.seasons, 1, 'the season rides on game 12');
  eq(missed.records[SEASON.gamesPerSeason - 1].extras.trophy, 0, '...with trophy 0');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: a forfeit is a loss ---');
// -----------------------------------------------------------------------------------------------
{
  const s = C.startSeason(fresh());
  const r = C.finishGame(s, { won: false, you: 0, cpu: 1, forfeit: true });
  eq(r.record.won, false, 'a forfeit records as a loss');
  eq(r.record.extras.forfeits, 1, '...and is broken out as a forfeit');
  eq(r.state.stats.lost, 1, '...and counts in the career\'s losses');
  eq(r.state.stats.forfeits, 1, '...and in its forfeits');
  eq(r.state.season.results[0].forfeit, true, '...and the season remembers which game it was');
  eq(r.state.unspent, POINTS.little.loss, '...and it pays the league\'s loss points, like any other loss');
  eq(r.state.stats.streak, 0, '...and breaks the win streak');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: streaks and bests ---');
// -----------------------------------------------------------------------------------------------
{
  let state = C.startSeason(fresh());
  for (const won of [true, true, true, false, true, true]) state = playOne(state, won).state;
  eq(state.stats.streak, 2, 'the live streak is the current run');
  eq(state.stats.bestWinStreak, 3, 'the best streak is the longest run, and only ever rises');
  const r = C.finishGame(state, { won: true, you: 11, cpu: 2, gameStats: { strikeoutsPitched: 7 } });
  eq(r.state.stats.bestRunsGame, 11, 'bestRunsGame takes the max');
  eq(r.state.stats.bestStrikeoutsPitchedGame, 7, 'bestStrikeoutsPitchedGame takes the max');
  const r2 = C.finishGame(r.state, { won: true, you: 2, cpu: 1, gameStats: { strikeoutsPitched: 1 } });
  eq(r2.state.stats.bestRunsGame, 11, 'a worse game never lowers a best (THE LAW rule 2)');
  eq(r2.state.stats.bestStrikeoutsPitchedGame, 7, '...for either best');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: the frozen history row ---');
// -----------------------------------------------------------------------------------------------
{
  let state = fresh(1000);
  state = playSeason(state, 9, ['win', 'win']).state;      // little Gold -> highschool
  state = playSeason(state, 9, ['loss']).state;            // highschool Bronze
  const row = C.historyRow(state, 55000);
  eq(Object.keys(row).sort(), [
    'bestLeague', 'bestTrophyByLeague', 'careerId', 'endedAt', 'finalLeague', 'forfeits', 'hand',
    'lost', 'perfectSeasons', 'played', 'rulesV', 'seasons', 'startedAt', 'v', 'won', 'wsTitles',
  ], 'the history row carries exactly the frozen field list (baseball/CLAUDE.md)');
  eq(row.v, 1, 'row version 1');
  eq(row.careerId, `${CODE}-1000-AAAA`, 'the careerId is carried through');
  eq(row.startedAt, 1000, 'startedAt is the career\'s own');
  eq(row.endedAt, 55000, 'endedAt is what the caller passed');
  eq(row.hand, 'R', 'the hand is carried');
  eq(row.finalLeague, 2, 'finalLeague is the 1..5 rung, not the id');
  eq(row.bestLeague, 2, 'bestLeague is the 1..5 rung');
  eq(row.bestTrophyByLeague.little, 3, 'the per-league trophy bests are carried');
  eq(row.bestTrophyByLeague.highschool, 1, '...for every league that earned one');
  eq(row.seasons, 2, 'two seasons resolved');
  eq(row.played, (SEASON.gamesPerSeason + 2) + (SEASON.gamesPerSeason + 1), 'played counts every game of both seasons');
  eq(row.won + row.lost, row.played, 'won plus lost is played');
  eq(row.forfeits, 0, 'no forfeits');
  eq(row.rulesV, RULES_V, 'the row carries the rules version');
  ok(Object.values(row).every((v) => typeof v !== 'number' || Number.isInteger(v)), 'every numeric field is an integer');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: gameStatsFromEvents ---');
// -----------------------------------------------------------------------------------------------
{
  const ev = (type, payload) => ({ type, payload });
  // The player is home; the CPU bats in the top of each inning.
  const events = [
    ev('gameStart', {}),
    ev('halfInningStart', { inning: 1, half: 'top' }),
    ev('atBatStart', { side: 'away' }),
    ev('atBatEnd', { side: 'away', outcome: 'strikeout', bases: 0, runsScored: 0, runnersOut: [] }),
    ev('atBatStart', { side: 'away' }),
    ev('atBatEnd', { side: 'away', outcome: 'ground-single', bases: 1, runsScored: 0, runnersOut: [] }),
    ev('atBatStart', { side: 'away' }),
    ev('pickoff', { runnerId: 'x', from: 0, out: true }),
    ev('atBatEnd', { side: 'away', outcome: 'walk', bases: 1, runsScored: 0, runnersOut: [] }),
    ev('atBatStart', { side: 'away' }),
    ev('atBatEnd', { side: 'away', outcome: 'groundout', bases: 0, runsScored: 0, runnersOut: ['y'] }),
    ev('halfInningStart', { inning: 1, half: 'bottom' }),
    ev('atBatStart', { side: 'home' }),
    ev('atBatEnd', { side: 'home', outcome: 'line-hit', bases: 2, runsScored: 0, runnersOut: [] }),
    ev('atBatStart', { side: 'home' }),
    ev('steal', { runnerId: 'p1', from: 1, to: 2, safe: true }),
    ev('atBatEnd', { side: 'home', outcome: 'walk', bases: 1, runsScored: 0, runnersOut: [] }),
    ev('atBatStart', { side: 'home' }),
    ev('atBatEnd', { side: 'home', outcome: 'flyout', bases: 0, runsScored: 1, runnersOut: [] }),
    ev('atBatStart', { side: 'home' }),
    ev('atBatEnd', { side: 'home', outcome: 'sacrifice', bases: 0, runsScored: 1, runnersOut: [] }),
    ev('atBatStart', { side: 'home' }),
    ev('steal', { runnerId: 'p2', from: 0, to: 1, safe: false }),
    ev('atBatEnd', { side: 'home', outcome: 'strikeout', bases: 0, runsScored: 0, runnersOut: [] }),
    ev('atBatStart', { side: 'home' }),
    ev('atBatEnd', { side: 'home', outcome: 'homer', bases: 4, runsScored: 4, runnersOut: [] }),
    ev('gameEnd', { score: { home: 6, away: 0 }, winner: 'home', reason: 'walkoff' }),
  ];
  const g = C.gameStatsFromEvents(events, { playerSide: 'home' });
  eq(g.hits, 2, 'hits: a double and a homer');
  eq(g.doubles, 1, 'one double');
  eq(g.triples, 0, 'no triples');
  eq(g.homers, 1, 'one homer');
  eq(g.grandSlams, 1, 'a homer that scored four is a grand slam');
  eq(g.rbi, 6, 'rbi is every run that scored on the player\'s own plate appearances');
  eq(g.walksDrawn, 1, 'one walk drawn');
  eq(g.strikeoutsBatting, 1, 'one strikeout at the plate');
  eq(g.sacFlies, 1, 'a flyout that scored a run is a sac fly');
  eq(g.sacBunts, 1, 'a "sacrifice" outcome is a sac bunt');
  eq(g.atBats, 6 - 1 - 1 - 1, 'atBats is plate appearances minus walks, sac flies and sac bunts (doc section 15)');
  eq(g.stolenBases, 1, 'one steal');
  eq(g.caughtStealing, 1, 'one caught stealing');
  eq(g.runsScored, 6, 'runsScored is the player\'s team');
  eq(g.runsAllowed, 0, 'runsAllowed is the opponent\'s');
  eq(g.hitsAllowed, 1, 'one hit allowed');
  eq(g.walksIssued, 1, 'one walk issued');
  eq(g.strikeoutsPitched, 1, 'one strikeout pitched');
  eq(g.homersAllowed, 0, 'no homers allowed');
  eq(g.pickoffs, 1, 'one pickoff, and only while the opponent was batting');
  eq(g.inningsPitchedOuts, 4, 'outs: a strikeout, the pickoff, and a double play (2)');
  eq(g.shutouts, 1, 'the opponent scored nothing, so it is a shutout');
  eq(g.noHitters, 0, 'one hit allowed, so it is not a no-hitter');
  eq(g.perfectGames, 0, '...and certainly not a perfect game');
  eq(g.walkoffWins, 1, 'a walkoff win');
  eq(g.extraInningGames, 0, 'no extra innings');
  eq(g.you, 6, 'the final score is reported for the caller');
  eq(g.cpu, 0, '...on both sides');
  eq(g.won, true, '...and who won');
  eq(g.complete, true, '...and that the game finished');

  // A no-hitter and a perfect game, from the pitching side only.
  const quiet = [
    ev('halfInningStart', { inning: 1, half: 'top' }),
    ev('atBatStart', { side: 'away' }),
    ev('atBatEnd', { side: 'away', outcome: 'strikeout', bases: 0, runsScored: 0, runnersOut: [] }),
    ev('gameEnd', { score: { home: 1, away: 0 }, winner: 'home', reason: 'scheduled' }),
  ];
  const perfect = C.gameStatsFromEvents(quiet, { playerSide: 'home' });
  eq(perfect.noHitters, 1, 'no hits allowed is a no-hitter');
  eq(perfect.perfectGames, 1, 'no hits, no walks and no runs is a perfect game');
  const walked = C.gameStatsFromEvents([
    ...quiet.slice(0, 3),
    ev('atBatStart', { side: 'away' }),
    ev('atBatEnd', { side: 'away', outcome: 'walk', bases: 1, runsScored: 0, runnersOut: [] }),
    quiet[3],
  ], { playerSide: 'home' });
  eq(walked.noHitters, 1, 'a walk still leaves a no-hitter');
  eq(walked.perfectGames, 0, '...but never a perfect game');

  const extra = C.gameStatsFromEvents([
    ev('halfInningStart', { inning: 1, half: 'top' }),
    ev('halfInningStart', { inning: 4, half: 'top' }),
    ev('gameEnd', { score: { home: 2, away: 1 }, winner: 'home', reason: 'scheduled' }),
  ], { playerSide: 'home' });
  eq(extra.extraInningGames, 1, 'an inning past SEASON.inningsPerGame is an extra-inning game');
  eq(extra.perfectGames, 0, 'an extra-inning game is never a perfect game (the ghost runner reaches second)');

  // An unfinished stream (a forfeit, or an abort) reports honestly rather than inventing a result.
  const partial = C.gameStatsFromEvents(events.slice(0, 5), { playerSide: 'home' });
  eq(partial.complete, false, 'a stream with no gameEnd is not complete');
  eq(partial.shutouts, 0, '...and claims no shutout');
  eq(partial.noHitters, 0, '...and no no-hitter');

  // Swapping sides swaps every column, and nothing else.
  const away = C.gameStatsFromEvents(events, { playerSide: 'away' });
  eq(away.hits, 1, 'read from the other side, the opponent had one hit');
  eq(away.hitsAllowed, 2, '...and allowed two');
  eq(away.runsScored, 0, '...and scored nothing');
  eq(away.walkoffWins, 0, '...and did not win a walkoff');
  eq(away.pickoffs, 0, 'the pickoff belongs to whoever was fielding, not to whoever was on base');

  eq(C.gameStatsFromEvents([], { playerSide: 'home' }).atBats, 0, 'an empty stream counts nothing and throws nothing');
  eq(C.gameStatsFromEvents(null, { playerSide: 'home' }).hits, 0, 'a null stream counts nothing and throws nothing');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- RULES: a mid-at-bat resume through the REAL engine ---');
// -----------------------------------------------------------------------------------------------
{
  const { Game } = await import('./baseball/js/engine/game.js');
  const state0 = C.startSeason(fresh());
  const opened = C.startGame(state0);
  ok(opened.state.game !== null, 'startGame writes a game into the state');
  eq(opened.state.game.meta.kind, 'regular', '...with the meta of the next game');
  ok(opened.state.game.snap && opened.state.game.snap.v, '...and a fresh engine snapshot');
  eq(opened.state.game.snap.rulesV, RULES_V, '...stamped with the engine rules version');

  // Take the game to a real mid-at-bat count, then checkpoint and resume from that exact state.
  const g = opened.game;
  g.balls = 2; g.strikes = 1; g.outs = 1; g.inning = 2; g.half = 'bottom';
  g._atBatOpen = true; g._halfInningOpen = true;
  const mid = C.checkpoint(opened.state, g.snapshot());
  eq(mid.game.snap.balls, 2, 'the checkpoint carries the balls');
  eq(mid.game.snap.strikes, 1, '...and the strikes');
  const resumed = C.resumeGame(mid, { home: null, away: null });
  ok(resumed instanceof Game, 'resumeGame rebuilds a real Game');
  eq([resumed.balls, resumed.strikes, resumed.outs, resumed.inning, resumed.half], [2, 1, 1, 2, 'bottom'],
    'a resumed mid-at-bat game restores the count, the outs, the inning and the half');
  eq(resumed.rngState, g.rngState, '...and the exact rng position, so it draws the number the uninterrupted game would have');

  // The player team plays with the career's own build, on the career's own league.
  const team = C.playerTeamFor(state0);
  eq(team.players.length, 9, 'the player is all nine (doc section 6)');
  eq(team.players[0].skills, { ...START_BUILD }, '...and every slot carries the career build');
  eq(team.league, 'little', '...on the season\'s league');
  eq(C.playerSideFor({ home: true }), 'home', 'a home game puts the player on the home side');
  eq(C.playerSideFor({ home: false }), 'away', '...and an away game on the away side');

  // A malformed snapshot is rejected whole, never resumed.
  let threw = false;
  try { C.resumeGame({ ...mid, game: { ...mid.game, snap: { v: 99 } } }, {}); } catch { threw = true; }
  ok(threw, 'a malformed snapshot throws rather than resuming into a half-real game');
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- PERSISTENCE: career-io round trip ---');
// -----------------------------------------------------------------------------------------------
//
// Same fake { db, api } seam test-career-sync.mjs uses, so this drives the REAL career-io,
// career-store and game-stats rather than a mirror of any of them.
{
  function makeFakeApi(initial) {
    const data = Object.assign({}, initial);
    const calls = [];
    const api = {
      ref: (db, path) => ({ path: path || '' }),
      get: async (ref) => { const v = data[ref.path]; return { exists: () => v !== undefined, val: () => v }; },
      set: async (ref, val) => { calls.push(['set', ref.path]); data[ref.path] = val; },
      update: async (rootRef, updates) => {
        calls.push(['update', Object.keys(updates)]);
        for (const [p, v] of Object.entries(updates)) { if (v === null) delete data[p]; else data[p] = v; }
      },
    };
    return { api, db: {}, uid: 'uid-1', data, calls };
  }

  const fake = makeFakeApi({});
  globalThis.__CAREER_TEST_BOOT__ = fake;
  store.delete('gamehub.baseball.v1');
  store.delete('gamehub.stats');

  const IO = await import('./baseball/js/career-io.js');
  const GS = await import('./js/game-stats.js');
  const CS = await import('./js/career-store.js');

  const started = await IO.startCareer({ hand: 'L', presetId: 'slugger', skills: PRESETS.slugger, now: 2000 });
  ok(started !== null, 'startCareer returns a career');
  ok(/^BB7KM-2000-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(started.state.careerId),
    'the careerId matches the frozen <CODE>-<startedAtMs>-<RAND> shape');
  eq(started.doc.v, CS.CAREER_SCHEMA_V, 'the document carries the store\'s schema version');
  eq(started.doc.code, CODE, '...this device\'s player code');
  eq(started.doc.rulesV, RULES_V, '...the engine rules version');
  eq(started.doc.seq, 1, '...and seq 1 after the first local save');
  eq(started.doc.baseSeq, 0, '...against baseSeq 0, so it reads as locally ahead');
  ok(CS.validateCareer(started.doc) !== null, 'the new document passes the store\'s own validator');
  eq(C.validateState(started.doc.state), [], '...and its state passes the career validator');

  const statsAfterStart = JSON.parse(store.get('gamehub.stats'));
  eq(statsAfterStart.games.baseball.bb.careersStarted, 1, 'starting a career bumps careersStarted');
  eq(statsAfterStart.games.baseball.bb.hand.v, 'L', '...and puts the hand on record');
  // doc section 6, [Locked]: the hand is picked once per PLAYER, not per career.
  const second = GS.setBaseballHand('R');
  eq(second.v, 'L', 'a second career cannot change the recorded hand');

  ok(!!fake.data[`careers/${CODE}/baseball/live`], 'the new career was pushed to the live node');

  // Play one game and record it.
  let state = C.startSeason(started.state);
  IO.saveCheckpoint(state);
  const loadedMid = CS.loadLocalCareer();
  eq(loadedMid.state.season.n, 1, 'a checkpoint saves the season into the local document');
  ok(loadedMid.seq > started.doc.seq, '...and advances seq');

  const finished = C.finishGame(state, {
    won: true, you: 7, cpu: 2,
    gameStats: { hits: 3, homers: 1, rbi: 4, runsScored: 7, runsAllowed: 2, strikeoutsPitched: 5, atBats: 4 },
  });
  IO.saveAtBat(finished.state);
  const saved = await IO.saveGameEnd(finished.state);
  ok(saved.saved !== null, 'saveGameEnd saved locally');
  eq(saved.pushed, true, '...and the push landed against the fake store');
  eq(saved.health.state, 'ok', '...and sync health says ok');
  eq(fake.data[`careers/${CODE}/baseball/live`].state.season.results.length, 1,
    'the pushed document carries the game that was just played');

  IO.recordGameResult(finished.record);
  const bb = JSON.parse(store.get('gamehub.stats')).games.baseball;
  eq(bb.total.played, 1, 'the game counts as played');
  eq(bb.total.won, 1, '...and as a win');
  eq(bb.byDiff.little.won, 1, '...under the league it was played in');
  eq(bb.byDiff.little.played, 1, '...and its played count');
  eq(bb.bb.hits, 3, 'the game\'s own counters landed');
  eq(bb.bb.homers, 1, '...every one of them');
  eq(bb.bb.rbi, 4, '...including the rbi');
  eq(bb.bb.bestRunsGame, 7, 'bestRunsGame took the max');
  eq(bb.bb.bestStrikeoutsPitchedGame, 5, '...as did bestStrikeoutsPitchedGame');
  eq(bb.bb.bestLeague, 1, 'bestLeague reads Little League');
  eq(bb.bb.seasons, 0, 'the season has not resolved yet, so seasons is still 0');

  // loadCareer reads it back.
  const reloaded = await IO.loadCareer();
  ok(reloaded !== null, 'loadCareer finds the career');
  eq(reloaded.state.careerId, started.state.careerId, '...the same one');
  eq(reloaded.state.season.results.length, 1, '...with the game that was played');

  // Retire writes the frozen row and clears live, in that order.
  const retired = await IO.retire(finished.state, 9000);
  eq(retired.ok, true, 'retire reports success');
  eq(retired.row.careerId, started.state.careerId, 'the history row names the career');
  ok(!!fake.data[`careers/${CODE}/baseball/history/${started.state.careerId}`], 'the history document landed');
  ok(fake.data[`careers/${CODE}/baseball/live`] === undefined, 'the live document was cleared');
  eq(CS.loadLocalCareer(), null, 'the local career is cleared only after the write verified');
  const afterRetire = JSON.parse(store.get('gamehub.stats')).games.baseball.bb;
  eq(afterRetire.careersFinished, 1, 'careersFinished was bumped');
  eq(afterRetire.history[started.state.careerId].v, 1, 'the frozen row is in bb.history');

  // A denied push keeps the career playable and says so loudly (THE LAW rule 6).
  {
    const denied = makeFakeApi({});
    denied.api.set = async () => { throw new Error('PERMISSION_DENIED: Permission denied'); };
    globalThis.__CAREER_TEST_BOOT__ = denied;
    const s2 = await IO.startCareer({ hand: 'L', presetId: 'painter', skills: PRESETS.painter, now: 3000 });
    ok(s2 !== null, 'a career still starts when every push is denied');
    eq(CS.careerSyncHealth().state, 'denied', '...and sync health records the denial');
    ok(CS.loadLocalCareer() !== null, '...and the career is on this device regardless');
  }

  // A stored state today\'s code cannot parse is rejected WHOLE and nothing is deleted.
  {
    globalThis.__CAREER_TEST_BOOT__ = makeFakeApi({});
    const doc = CS.loadLocalCareer();
    const raw = JSON.parse(store.get('gamehub.baseball.v1'));
    raw.career = { ...doc, state: { ...doc.state, league: 'triple-a' } };
    store.set('gamehub.baseball.v1', JSON.stringify(raw));
    const bad = await IO.loadCareer();
    eq(bad, null, 'a state that fails validateState is not loaded');
    ok(JSON.parse(store.get('gamehub.baseball.v1')).career !== undefined,
      '...and the stored document is left exactly where it is (THE LAW rules 1 and 5)');
  }

  delete globalThis.__CAREER_TEST_BOOT__;
}

// -----------------------------------------------------------------------------------------------
console.log('\n--- STRUCTURAL: career-io is the only door to the stores ---');
// -----------------------------------------------------------------------------------------------
{
  const io = readFileSync('./baseball/js/career-io.js', 'utf8');
  const engine = readFileSync('./baseball/js/engine/career.js', 'utf8');
  ok(/from '\.\.\/\.\.\/js\/career-store\.js'/.test(io), 'career-io imports the career store');
  ok(/from '\.\.\/\.\.\/js\/game-stats\.js'/.test(io), 'career-io imports the stats recorder');
  ok(!/^\s*import[^;]*(?:career-store|game-stats)\.js/m.test(engine), 'the engine\'s career.js IMPORTS neither store');
  ok(!/Math\.random|localStorage|document\.|window\./.test(engine.replace(/\/\/.*$/gm, '')),
    'the engine\'s career.js has no randomness, no storage and no DOM');
  ok(/addEventListener\('pagehide'/.test(io) && /removeEventListener\('pagehide'/.test(io),
    'career-io installs and removes its pagehide listener');
  ok(/visibilitychange/.test(io), 'career-io pushes on a hidden visibilitychange');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
