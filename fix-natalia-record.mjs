// fix-natalia-record.mjs - ONE-OFF, auditable data correction (2026-07-22/23).
//
// WHY THIS EXISTS
// Ana and Natalia shared one physical device (player code 89N3N, "Anita Bonita",
// players/1f75ff86-...) for about a week before Natalia got her own phone. game-stats.js stores only
// running per-device totals, so every play either of them made landed in the same counters and there
// is no per-play log to split them by. Separately, usernames/natalia was stale - it pointed at Ana's
// code 89N3N - which is why Natalia's brand-new phone told her the name was taken when she first
// tried to claim it.
//
// WHAT IT DOES (see HANDOFF-LEADERBOARD-CORRECTION.md, the "TONIGHT" section, which supersedes the
// earlier subtract-from-Ana plan):
//   1. Creates ONE new players/<uuid> record for Natalia, with a fresh player code, holding the 8
//      plays reconstructed as hers.
//   2. Repoints usernames/natalia at that new code.
//   3. Clears players/<test device>/profile/name so the dev/test bucket stays off the leaderboard,
//      archiving the old name to profile/nameArchived rather than destroying it.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not touch Ana. Not 1f75ff86, not 0b0473a8, not the orphaned pre-gate devices. Her records
// and her leaderboard row stay exactly as they are. This is therefore a pure ADDITION: no counter
// anywhere is decremented, so THE LAW rule 2 holds by construction and there is never a moment where
// a play exists nowhere. The known, accepted consequence is that those 8 plays are counted twice
// family-wide (once inside Ana's blended row, once in Natalia's new row) until the profile-code-keyed
// stats rework lands. That was Matt's explicit call, not an oversight.
//
// HOW THE 8 ARE BUILT
// Not by hand-writing JSON. It imports js/game-stats.js - the app's OWN writers - under a localStorage
// shim and calls recordEscoba/recordBoggle/recordDotsBoxes/recordNutsBolts/recordResult, so the stored
// shape is by definition the canonical one and cannot drift from ensureXx().
//
// SAFETY
//   - Refuses to run without a fresh full backup (writes one itself, via backups/rtdb-backup.mjs).
//   - Dry run by default. `--write` is required to touch anything.
//   - Simulates the post-write leaderboard locally FIRST, using the repo's real players-agg.js +
//     leaderboard-rank.js, and aborts if any other player's row would move.
//   - Re-reads everything fresh afterwards and diffs every pre-existing device record byte-for-byte.
//   - Refuses to create a second Natalia if one already exists.
//
// Usage:
//   node fix-natalia-record.mjs            # dry run: shows exactly what would change
//   node fix-natalia-record.mjs --write    # perform the correction, then verify

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firebaseConfig } from './js/firebase-config.js';
import { signInAnonymously, readPath, totalPlays } from './backups/rtdb-backup.mjs';
import { newPlayerCode } from './js/profile-store.js';
import { aggregatePlayers } from './js/players-agg.js';
import { rankPlayers } from './js/leaderboard-rank.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = firebaseConfig.databaseURL;

const NATALIA_NAME = 'Natalia';
const NATALIA_EMOJI = '\u{1F642}';        // the app's own neutral default (profile-store normalize)
const TEST_DEVICE = 'f8ad1b82-76b7-4117-bf9f-9ebc0870878b';

// The reconstructed 8, with the difficulty label each play actually carries on the shared device.
// Every one of these was verified present in players/1f75ff86-.../stats/games before this was written.
const NATALIA_PLAYS = [
  { game: 'escoba', diff: 'easy', won: true, extras: { escobas: 9 } },
  { game: 'boggle', diff: 'intermediate', won: false, extras: { words: 13, score: 16, longestWord: { word: 'WORST', len: 5 } } },
  { game: 'dotsboxes', diff: 'intermediate', won: true, extras: { boxes: 13, bestChain: 10 } },
  { game: 'filler', diff: 'intermediate', won: true },
  { game: 'filler', diff: 'intermediate', won: true },
  { game: 'mancala', diff: 'beginner', won: false },
  { game: 'nutsbolts', level: 1, moves: 19, tier: 'medium' },
  { game: 'parchis', diff: 'intermediate', won: false },
];

// --- build her stats with the app's own recorders --------------------------------------------------

/** Minimal localStorage shim so js/game-stats.js runs unchanged under Node. */
function installStorageShim() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
  return map;
}

async function buildNataliaStats() {
  installStorageShim();
  const gs = await import('./js/game-stats.js');
  for (const p of NATALIA_PLAYS) {
    if (p.game === 'escoba') gs.recordEscoba(p.diff, p.won, p.extras);
    else if (p.game === 'boggle') gs.recordBoggle(p.diff, p.won, p.extras);
    else if (p.game === 'dotsboxes') gs.recordDotsBoxes(p.diff, p.won, p.extras);
    else if (p.game === 'nutsbolts') gs.recordNutsBolts(p.level, p.moves, p.tier);
    else gs.recordResult(p.game, p.diff, p.won);
  }
  const st = gs.loadStats();
  const played = Object.values(st.games).reduce((n, g) => n + ((g.total || {}).played | 0), 0);
  if (played !== 8) throw new Error(`built stats have ${played} plays, expected 8 - refusing to continue`);
  return st;
}

// --- leaderboard simulation -------------------------------------------------------------------------

/** The leaderboard's own view: named players only (leaderboard-ui.js line ~384), ranked, plays > 0. */
function board(players) {
  const list = aggregatePlayers(players).filter((g) => (g.name || '').trim());
  return rankPlayers(list).filter((r) => r.plays > 0).map((r) => ({
    name: r.group.name,
    code: r.group.playerId || '-',
    devices: r.group.devices,
    plays: r.plays,
    rating: r.rating,
    provisional: r.provisional,
    wl: r.comp ? `${r.comp.plays ? '' : ''}` : '',
    compWL: (() => {
      let p = 0, l = 0;
      for (const g of Object.keys(r.group.games)) {
        if (g === 'nutsbolts' || g === 'ballrun') continue;
        const t = r.group.games[g].total; p += t.played | 0; l += Math.min(t.lost | 0, t.played | 0);
      }
      return p > 0 ? `${p - l}-${l}` : '-';
    })(),
  }));
}

function printBoard(title, rows) {
  console.log(`\n  ${title}`);
  console.log('    #  Player            Code    Dev  W-L      Rating  Plays');
  rows.forEach((r, i) => {
    console.log(`    ${String(i + 1).padEnd(2)} ${String(r.name).padEnd(17)} ${String(r.code).padEnd(7)} ${String(r.devices).padEnd(4)} ${String(r.compWL).padEnd(8)} ${String(r.rating == null ? '-' : r.rating + (r.provisional ? '*' : '')).padEnd(7)} ${r.plays}`);
  });
}

// --- comparison helpers -----------------------------------------------------------------------------

/** RTDB has no concept of an empty object and returns keys in sorted order, so a naive
 *  JSON.stringify round-trip comparison false-alarms on both counts. This models RTDB's own
 *  semantics: drop nulls and empty objects (exactly what a real synced record looks like - see any
 *  existing players/<id> record with a game that has no byDiff key at all), then sort keys. */
function rtdbCanon(v) {
  if (Array.isArray(v)) return v.map(rtdbCanon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const c = rtdbCanon(v[k]);
      if (c === null || c === undefined) continue;
      if (typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  return v;
}
const same = (a, b) => JSON.stringify(rtdbCanon(a)) === JSON.stringify(rtdbCanon(b));

// --- REST helpers -----------------------------------------------------------------------------------

async function put(path, body, idToken) {
  const res = await fetch(`${DB}/${path}.json?auth=${idToken}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`PUT ${path} failed: ${JSON.stringify(data)}`);
  return data;
}
async function patch(path, body, idToken) {
  const res = await fetch(`${DB}/${path}.json?auth=${idToken}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

// --- main -------------------------------------------------------------------------------------------

async function main() {
  const doWrite = process.argv.includes('--write');
  console.log(doWrite ? '=== LIVE WRITE ===' : '=== DRY RUN (pass --write to apply) ===');

  const idToken = await signInAnonymously(firebaseConfig.apiKey);

  // 1. Snapshot BEFORE anything, always - even on a dry run.
  const before = await readPath(DB, '', idToken);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapPath = join(HERE, 'backups', `rtdb-pre-natalia-fix-${stamp}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, JSON.stringify(before, null, 2), 'utf8');
  const playersBefore = before.players || {};
  const playsBefore = totalPlays(playersBefore);
  console.log(`\nPre-state snapshot -> ${snapPath}`);
  console.log(`  ${Object.keys(playersBefore).length} device records, ${playsBefore} total recorded plays`);

  // 2. Refuse to create a duplicate Natalia.
  const existing = Object.entries(playersBefore).filter(([, r]) => ((r.profile || {}).name || '').trim().toLowerCase() === 'natalia');
  if (existing.length) {
    console.error(`\nABORT: a Natalia record already exists (${existing.map(([id]) => id).join(', ')}). Nothing written.`);
    process.exit(1);
  }

  // 3. Mint a code that is not in use anywhere.
  const inUse = new Set();
  for (const r of Object.values(playersBefore)) { const c = ((r.profile || {}).playerId || '').trim().toUpperCase(); if (c) inUse.add(c); }
  for (const v of Object.values(before.usernames || {})) { const c = String((v || {}).code || '').trim().toUpperCase(); if (c) inUse.add(c); }
  let code = null;
  for (let i = 0; i < 200 && !code; i++) { const c = newPlayerCode(); if (!inUse.has(c)) code = c; }
  if (!code) throw new Error('could not mint an unused player code');
  const deviceKey = crypto.randomUUID();

  const stats = await buildNataliaStats();
  const record = { profile: { name: NATALIA_NAME, emoji: NATALIA_EMOJI, playerId: code }, stats };

  console.log(`\nWill create players/${deviceKey}`);
  console.log(`  profile: name="${NATALIA_NAME}" emoji=${NATALIA_EMOJI} playerId=${code}`);
  for (const [g, v] of Object.entries(stats.games)) {
    const t = v.total || {};
    if ((t.played | 0) > 0) console.log(`  ${g.padEnd(10)} ${t.played} played (${t.won | 0}-${t.lost | 0})  byDiff=${JSON.stringify(v.byDiff)}`);
  }
  console.log(`Will set usernames/natalia -> { code: "${code}" }  (was "${((before.usernames || {}).natalia || {}).code}")`);
  const testName = ((playersBefore[TEST_DEVICE] || {}).profile || {}).name || '';
  console.log(`Will clear players/${TEST_DEVICE}/profile/name (currently "${testName}"), archiving it to profile/nameArchived`);

  // 4. Simulate the post-write board and gate on it.
  const after = JSON.parse(JSON.stringify(playersBefore));
  after[deviceKey] = record;
  if (after[TEST_DEVICE]) { after[TEST_DEVICE].profile = Object.assign({}, after[TEST_DEVICE].profile, { name: '', nameArchived: testName }); }

  const b0 = board(playersBefore), b1 = board(after);
  printBoard('BEFORE', b0);
  printBoard('AFTER (simulated)', b1);

  const problems = [];
  const nat = b1.find((r) => r.name === NATALIA_NAME);
  if (!nat) problems.push('Natalia does not appear on the simulated board');
  else if (nat.plays !== 8) problems.push(`Natalia shows ${nat.plays} plays, expected 8`);
  if (b1.some((r) => /^test/i.test(r.name))) problems.push('a Test row still appears on the simulated board');
  for (const name of ['MattyIce', 'King of Games', 'Bego', 'Anita Bonita']) {
    const a = b0.find((r) => r.name === name), c = b1.find((r) => r.name === name);
    if (!a) { problems.push(`${name} was not on the BEFORE board`); continue; }
    if (!c) { problems.push(`${name} fell off the board`); continue; }
    if (a.plays !== c.plays || a.rating !== c.rating || a.compWL !== c.compWL || a.devices !== c.devices) {
      problems.push(`${name} changed: ${a.compWL}/${a.rating}/${a.plays} -> ${c.compWL}/${c.rating}/${c.plays}`);
    }
  }
  if (problems.length) {
    console.error('\nABORT - the simulated board is not what was specified:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('\nSimulation OK: Natalia 8 plays; MattyIce / King of Games / Bego / Anita Bonita all unchanged; no Test row.');

  if (!doWrite) { console.log('\nDry run complete. Nothing was written. Re-run with --write to apply.'); return; }

  // 5. Write. Natalia FIRST (nothing is removed from anywhere, so there is no window of loss).
  console.log('\nWriting...');
  await put(`players/${deviceKey}`, Object.assign({}, record, { updatedAt: { '.sv': 'timestamp' } }), idToken);
  console.log(`  players/${deviceKey} written`);
  await put(`usernames/natalia`, { code, at: { '.sv': 'timestamp' } }, idToken);
  console.log('  usernames/natalia written');
  await patch(`players/${TEST_DEVICE}/profile`, { name: '', nameArchived: testName }, idToken);
  console.log(`  players/${TEST_DEVICE}/profile name cleared`);

  // 6. Verify by FRESH re-read (THE LAW rule 6: a resolved promise is not proof the data landed).
  console.log('\nVerifying by fresh re-read...');
  const post = await readPath(DB, '', idToken);
  const playersPost = post.players || {};
  const fails = [];

  const nrec = playersPost[deviceKey];
  if (!nrec) fails.push(`players/${deviceKey} is not there`);
  else {
    if ((nrec.profile || {}).name !== NATALIA_NAME) fails.push('Natalia profile.name did not land');
    if ((nrec.profile || {}).playerId !== code) fails.push('Natalia profile.playerId did not land');
    const got = Object.values(nrec.stats.games).reduce((n, g) => n + ((g.total || {}).played | 0), 0);
    if (got !== 8) fails.push(`Natalia landed with ${got} plays, expected 8`);
    if (!same(nrec.stats.games, stats.games)) fails.push('Natalia stats.games differ from what was sent');
  }
  if (((post.usernames || {}).natalia || {}).code !== code) fails.push('usernames/natalia did not land');
  const tprof = (playersPost[TEST_DEVICE] || {}).profile || {};
  if ((tprof.name || '') !== '') fails.push('test device name was not cleared');
  if (tprof.nameArchived !== testName) fails.push('test device nameArchived did not land');

  // Nothing else may have moved. Compare every pre-existing record byte-for-byte, ignoring the two
  // fields we intentionally changed on the test device.
  for (const [id, rec] of Object.entries(playersBefore)) {
    const a = JSON.parse(JSON.stringify(rec));
    const b = JSON.parse(JSON.stringify(playersPost[id] || null));
    if (!b) { fails.push(`device ${id} disappeared`); continue; }
    if (id === TEST_DEVICE) { delete a.profile.name; delete b.profile.name; delete b.profile.nameArchived; }
    if (!same(a, b)) fails.push(`device ${id} changed unexpectedly`);
  }
  const playsPost = totalPlays(playersPost);
  if (playsPost !== playsBefore + 8) fails.push(`total plays went ${playsBefore} -> ${playsPost}, expected ${playsBefore + 8}`);

  const postPath = join(HERE, 'backups', `rtdb-post-natalia-fix-${stamp}.json`);
  writeFileSync(postPath, JSON.stringify(post, null, 2), 'utf8');
  console.log(`  post-state snapshot -> ${postPath}`);

  if (fails.length) {
    console.error('\nVERIFY FAILED:');
    for (const f of fails) console.error('  - ' + f);
    console.error(`\nThe pre-state snapshot is at ${snapPath}. Nothing was deleted; investigate before retrying.`);
    process.exit(1);
  }

  console.log(`  every one of the ${Object.keys(playersBefore).length} pre-existing device records is unchanged`);
  console.log(`  total recorded plays ${playsBefore} -> ${playsPost} (+8, Natalia's own record; nothing decremented)`);
  printBoard('LIVE BOARD (from the fresh re-read)', board(playersPost));
  console.log(`\nDone. Natalia's player code is ${code} - Matt links her phone with this.`);
}

main().catch((e) => { console.error('\n' + (e.stack || e.message || e)); process.exit(1); });
