// players-agg.js - PURE, Node-safe aggregation of the synced players/ records into ONE row per person.
//
// Display-only: it never writes or merges the stored per-device records, so nothing is lost and
// per-device counts never double-count (a game is only ever recorded on the device it was played on,
// so summing across a person's devices is exact). Imports ONLY the GAMES constant from game-stats.js
// (no DOM, no localStorage at import time), so it unit-tests headless with `node`.
//
// Identity precedence: a player code (profile.playerId) groups devices across renames; falling back to
// the (lowercased) profile name, then to the device id. Legacy records with no code group by name,
// exactly like today, so nothing regresses.

import { GAMES } from './game-stats.js';
import { mergeBoards, mergeUnlocked } from './arcade-scores.js';
import { correctStats } from './stats-corrections.js';

export const SOLO = new Set(['nutsbolts', 'ballrun', 'snake', 'hillclimb', 'pinball', 'skeeball', 'golf']);  // solo: win-only (no loss axis) or score-based

/** 'You' is profile-store's default when a name is left blank, so it is a placeholder, not a name. */
export const isPlaceholderName = (n) => { const s = (typeof n === 'string' ? n : '').trim().toLowerCase(); return !s || s === 'you'; };
export const COMPETITIVE = GAMES.filter((g) => !SOLO.has(g));

const DIFFS = ['easy', 'medium', 'hard', 'expert'];
const emptyGrid = () => {
  const side = () => ({ easy: { w: 0, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 }, expert: { w: 0, l: 0 } });
  return { player: side(), computer: side() };
};

// Alternate profile names known to be the same person (hand-maintained for this family hub).
// Keys and values are LOWERCASED names; the value is the identity everything folds into.
//
// `lill` -> `lili` (2026-07-31): Lili has two devices whose local profiles spell her name
// differently, so she rendered as two rows. This was "fixed" once before by editing the record in
// Firebase, and it came back - because a server-side rename does not stick. `stats-net.js`'s
// syncMyStats() mirrors each device's OWN localStorage profile up on every hub load, so the phone
// still holding `name: "Lill"` simply rewrote the record back the next time it opened the app.
// Aliasing here is immune to that: it is applied at READ time, on every render, no matter what the
// devices push. (The durable alternative is renaming the profile ON the device itself, or linking
// both devices to one player code - either would also work, and this alias stays harmless if so.)
const NAME_ALIAS = { matt: 'mattyice', lill: 'lili' };
const canonName = (n) => NAME_ALIAS[n] || n;

// Preferred DISPLAY spelling for a folded identity, keyed by the canonical (lowercased) name.
// Grouping alone is not enough: `grp.name` below takes the most recently active device's raw name,
// so a merged Lili would still have flickered between "Lili" and "Lill" depending on which phone
// synced last. An entry here pins the row's label. Names with no entry are displayed exactly as the
// device wrote them (which is why `mattyice` has none - its display behaviour is unchanged).
const DISPLAY_NAME = { lili: 'Lili' };
const displayName = (raw) => {
  const s = (typeof raw === 'string' ? raw : '').trim();
  return DISPLAY_NAME[canonName(s.toLowerCase())] || s;
};

const codeOf = (p) => (typeof (p || {}).playerId === 'string' ? p.playerId : '').trim().toUpperCase();
const nameOf = (p) => canonName((typeof (p || {}).name === 'string' ? p.name : '').trim().toLowerCase());

/**
 * Identity as a GRAPH rather than a precedence list: two devices are the same person when they share
 * a player code OR a (canonical) profile name, and that relation is transitive. So a person whose
 * devices are partly coded and partly not - or who has two codes under one name - still resolves to a
 * SINGLE player, which is exactly how history was getting stranded on separate rows. Devices with
 * neither a code nor a name stay on their own until they get one.
 * Returns { keyFor(profileLike, deviceId) -> stable group key }.
 */
export function buildIdentity(all) {
  const parent = new Map();
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); return x; };
  const find = (x) => { add(x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const id of Object.keys(all || {})) {
    const p = (all[id] || {}).profile || {};
    const dev = add('device:' + id), code = codeOf(p), name = nameOf(p);
    if (code) union(dev, 'code:' + code);
    if (name) union(dev, 'name:' + name);
  }
  return {
    keyFor(profileLike, fallbackId) {
      const code = codeOf(profileLike), name = nameOf(profileLike);
      if (code) return find('code:' + code);
      if (name) return find('name:' + name);
      return find('device:' + fallbackId);
    },
  };
}

/** Single-record identity (no cross-record graph). Kept for callers that only have one profile. */
export function identityKey(profileLike, fallbackId) {
  const code = codeOf(profileLike), name = nameOf(profileLike);
  if (code) return { key: 'code:' + code, playerId: code };
  if (name) return { key: 'name:' + name, playerId: null };
  return { key: 'device:' + fallbackId, playerId: null };
}

/** Aggregate the players/ map (deviceId -> record) into an UNSORTED list of one-per-person groups.
 *  Each group's `games[g]` is in the CANONICAL stats shape ({ total, byDiff, +grid/cc/es/nb }) so the
 *  same object doubles as a valid `st.games` for the Stats screens. Group also carries roll-ups:
 *  { key, playerId, name, emoji, message, messageAt, devices, updatedAt, games, comp:{played,won,lost},
 *  solo:{solved,bestLevel,moves}, totalPlays }. */
export function aggregatePlayers(all, corrections) {
  const groups = new Map();
  const ident = buildIdentity(all);
  for (const id of Object.keys(all || {})) {
    const rec = all[id] || {};
    const prof = rec.profile || {};
    const key = ident.keyFor(prof, id);
    const playerId = codeOf(prof) || null;
    let grp = groups.get(key);
    if (!grp) {
      grp = {
        key, playerId, name: '', emoji: '', message: '', messageAt: 0, devices: 0, updatedAt: 0, games: {},
      };
      for (const g of GAMES) grp.games[g] = { total: { played: 0, won: 0, lost: 0 }, byDiff: {} };
      groups.set(key, grp);
    }
    grp.devices += 1;
    if (playerId && !grp.playerId) grp.playerId = playerId;
    const upd = +rec.updatedAt || 0;                       // NOT `| 0` (server timestamps overflow 32 bits)
    const rawName = (prof.name || '').trim();
    if (upd >= grp.updatedAt) { grp.updatedAt = upd; if (prof.emoji) grp.emoji = prof.emoji; }
    // Display name: a real name ALWAYS beats the 'You' placeholder (a freshly linked device saves
    // blank -> 'You', and being newest would otherwise rename the whole player); within the same
    // class, the most recently active device wins.
    if (rawName) {
      const curPlace = isPlaceholderName(grp.name), newPlace = isPlaceholderName(rawName);
      if (!grp.name || (curPlace && !newPlace) || (curPlace === newPlace && upd >= (grp._nameAt || 0))) {
        // displayName() pins the label for a folded identity (see DISPLAY_NAME above); every other
        // name passes through untouched.
        grp.name = displayName(rawName); grp._nameAt = upd;
      }
    }
    // Message: newest EDIT wins, keyed off messageAt (the profile's own edit stamp), NOT rec.updatedAt
    // (the record's sync time). A device that merely re-synced without ever setting a message has
    // messageAt 0 and can never overwrite. A CLEARED message with a newer stamp is allowed to win:
    // this is a preference, not history (THE LAW rule 2's carve-out), so clearing must work.
    const msgAt = +prof.messageAt || 0;
    if (msgAt >= grp.messageAt) { grp.messageAt = msgAt; grp.message = (prof.message || '').trim(); }
    // ADMIN CORRECTIONS (2026-08-24) are applied HERE, per source record, before anything merges:
    // they are keyed by statsId (this record's key), and merging first would blend a voided board's
    // numbers into a person's total where no per-device correction could reach them any more.
    // Purely a read-time overlay - `rec` is never mutated, and players/<id> is never written by any
    // path in this file. See js/stats-corrections.js. A missing corrections argument (every caller
    // that predates this, and every test) leaves the record exactly as it was.
    const corrected = corrections ? correctStats(rec.stats, id, corrections) : rec.stats;
    const games = (corrected && corrected.games) || {};
    for (const g of GAMES) {
      const src = games[g] || {};
      const t = src.total || {};
      const dst = grp.games[g];
      dst.total.played += t.played | 0; dst.total.won += t.won | 0; dst.total.lost += t.lost | 0;
      const bd = src.byDiff || {};
      for (const k of Object.keys(bd)) {
        const b = bd[k] || {}; const d = dst.byDiff[k] || (dst.byDiff[k] = { played: 0, won: 0, lost: 0 });
        d.played += b.played | 0; d.won += b.won | 0; d.lost += b.lost | 0;
      }
      if (g === 'connect4' && src.grid) {
        if (!dst.grid) dst.grid = emptyGrid();
        for (const side of ['player', 'computer']) for (const d of DIFFS) {
          const c = (src.grid[side] && src.grid[side][d]) || {};
          dst.grid[side][d].w += c.w | 0; dst.grid[side][d].l += c.l | 0;
        }
      } else if (g === 'chinchon' && src.cc) {
        if (!dst.cc) dst.cc = { closed: 0, minusTen: 0, chinchons: 0 };
        dst.cc.closed += src.cc.closed | 0; dst.cc.minusTen += src.cc.minusTen | 0; dst.cc.chinchons += src.cc.chinchons | 0;
      } else if (g === 'escoba' && src.es) {
        if (!dst.es) dst.es = { escobas: 0 };
        dst.es.escobas += src.es.escobas | 0;
      } else if (g === 'nutsbolts' && src.nb) {
        if (!dst.nb) dst.nb = { solved: 0, moves: 0, bestLevel: 0 };
        dst.nb.solved += src.nb.solved | 0; dst.nb.moves += src.nb.moves | 0;
        dst.nb.bestLevel = Math.max(dst.nb.bestLevel, src.nb.bestLevel | 0);
      } else if (g === 'pipes' && src.pi) {
        // Item 7's third edit, the one that gets forgotten: without this branch every Pipes
        // counter reads ZERO the moment a person's second device syncs, while each device's own
        // store stays intact - THE LAW rule 1, and how Dots and Boxes and Boggle both shipped.
        // Counters add; bests take Math.max, never a sum.
        if (!dst.pi) dst.pi = { solved: 0, moves: 0, bestLevel: 0, bestByTier: {} };
        dst.pi.solved += src.pi.solved | 0;
        dst.pi.moves += src.pi.moves | 0;
        dst.pi.bestLevel = Math.max(dst.pi.bestLevel | 0, src.pi.bestLevel | 0);
        const pbt = src.pi.bestByTier || {};
        for (const k of Object.keys(pbt)) {
          dst.pi.bestByTier[k] = Math.max(dst.pi.bestByTier[k] | 0, pbt[k] | 0);
        }
      } else if (g === 'ballrun' && src.br) {
        // Fourth-playthrough item 2: Ball Run's shared metric is obstacle count (bestObstacles /
        // bestObstaclesByDiff), not meters. Old meter-shaped records (pre-migration, no
        // bestObstacles field) simply contribute 0 here, same as a record with no runs yet - their
        // meter data is preserved locally under brLegacyMeters (game-stats.js) but never aggregated
        // as if it were a comparable count.
        if (!dst.br) dst.br = { runs: 0, bestObstacles: 0, bestObstaclesByDiff: {} };
        dst.br.runs += src.br.runs | 0;
        dst.br.bestObstacles = Math.max(dst.br.bestObstacles | 0, src.br.bestObstacles | 0);
        const sbd = src.br.bestObstaclesByDiff || {};
        for (const k of Object.keys(sbd)) dst.br.bestObstaclesByDiff[k] = Math.max(dst.br.bestObstaclesByDiff[k] | 0, sbd[k] | 0);
        // Orbital (BALLRUNMAP2ORBITALSPEC.md, Phase 1): a second, independent best-score bucket
        // for the second map, same combine shape as `br` above. Root CLAUDE.md's "Adding a game"
        // item 7 is explicit that a sub-counter missing its own branch here is silently dropped
        // the moment a second device syncs, even though `br`/`total` stay correct - so this is
        // added alongside `br`'s branch from Orbital's first day, not bolted on after a report.
        if (src.brOrbital) {
          if (!dst.brOrbital) dst.brOrbital = { runs: 0, bestObstacles: 0, bestObstaclesByDiff: {} };
          dst.brOrbital.runs += src.brOrbital.runs | 0;
          dst.brOrbital.bestObstacles = Math.max(dst.brOrbital.bestObstacles | 0, src.brOrbital.bestObstacles | 0);
          const sbdO = src.brOrbital.bestObstaclesByDiff || {};
          for (const k of Object.keys(sbdO)) dst.brOrbital.bestObstaclesByDiff[k] = Math.max(dst.brOrbital.bestObstaclesByDiff[k] | 0, sbdO[k] | 0);
        }
      } else if (g === 'tictactoe' && src.tt) {
        // Ties are a first-class, explicitly-stored category here (see game-stats.js), so the
        // combined cross-device view must carry them forward too - dropping `tt` here would zero
        // out the per-variant W/L/T breakdown on the Stats screen the moment two devices sync,
        // even though `total` above is still correct (a THE-LAW-rule-1-shaped bug: data present
        // but not shown).
        if (!dst.tt) dst.tt = { classic: { played: 0, won: 0, lost: 0, tied: 0 }, ultimate: { played: 0, won: 0, lost: 0, tied: 0 } };
        for (const v of ['classic', 'ultimate']) {
          const sv = src.tt[v] || {};
          const dv = dst.tt[v];
          dv.played += sv.played | 0; dv.won += sv.won | 0; dv.lost += sv.lost | 0; dv.tied += sv.tied | 0;
        }
      } else if (g === 'dotsboxes' && src.db) {
        // Same hazard again (found while adding Boggle's `bg` below, 2026-07-22): Dots and
        // Boxes' Stats screen reads `db` for ties, cumulative boxes claimed and the best
        // single-turn chain, so without this branch all three blanked out as soon as a second
        // device synced -- stored on every device, invisible on the combined screen.
        // Counters add; bestChain is a best, so it takes the max (never the sum).
        if (!dst.db) dst.db = { played: 0, won: 0, lost: 0, tied: 0, boxes: 0, bestChain: 0 };
        dst.db.played += src.db.played | 0; dst.db.won += src.db.won | 0;
        dst.db.lost += src.db.lost | 0; dst.db.tied += src.db.tied | 0;
        dst.db.boxes += src.db.boxes | 0;
        dst.db.bestChain = Math.max(dst.db.bestChain | 0, src.db.bestChain | 0);
      } else if (g === 'snake' && src.sn) {
        // Same THE-LAW-rule-1 hazard as every sub-counter above (missed twice before this list
        // existed): without this branch Snake's runs and length bests blank out the moment a
        // second device syncs. Counters add; the length bests take the max, never a sum.
        if (!dst.sn) dst.sn = { runs: 0, bestLen: 0, bestLenByDiff: {}, bestLenByWalls: { on: 0, off: 0 }, bestLenByDiffWalls: { on: {}, off: {} }, runsByWalls: { on: 0, off: 0 } };
        dst.sn.runs += src.sn.runs | 0;
        dst.sn.bestLen = Math.max(dst.sn.bestLen | 0, src.sn.bestLen | 0);
        const sbd = src.sn.bestLenByDiff || {};
        for (const k of Object.keys(sbd)) dst.sn.bestLenByDiff[k] = Math.max(dst.sn.bestLenByDiff[k] | 0, sbd[k] | 0);
        // Walls-mode split (2026-07-28). `src.sn.bestLenByWalls`/etc. are absent on a remote
        // record from a device that hasn't reloaded (and so run the local seed) since this
        // shipped -- which, the moment this ships, is EVERY device until it next opens the hub.
        // Without a fallback here, every player reads 0/0 on the leaderboard split until their
        // own device happens to resync, silently contradicting the local seed's policy (all
        // pre-split history is Walls off) for however long that takes. So a source record with no
        // split fields at all contributes its legacy bestLen/bestLenByDiff/runs to the OFF bucket
        // right here, same policy, applied at aggregation time instead of waiting for a reload.
        if (!dst.sn.bestLenByWalls) dst.sn.bestLenByWalls = { on: 0, off: 0 };
        if (!dst.sn.bestLenByDiffWalls) dst.sn.bestLenByDiffWalls = { on: {}, off: {} };
        if (!dst.sn.runsByWalls) dst.sn.runsByWalls = { on: 0, off: 0 };
        const hasSplit = !!src.sn.bestLenByWalls;
        const sbw = hasSplit ? src.sn.bestLenByWalls : { on: 0, off: src.sn.bestLen | 0 };
        const sbdw = hasSplit ? (src.sn.bestLenByDiffWalls || {}) : { on: {}, off: sbd };
        const srw = hasSplit ? (src.sn.runsByWalls || {}) : { on: 0, off: src.sn.runs | 0 };
        for (const w of ['on', 'off']) {
          dst.sn.bestLenByWalls[w] = Math.max(dst.sn.bestLenByWalls[w] | 0, sbw[w] | 0);
          dst.sn.runsByWalls[w] += srw[w] | 0;
          if (!dst.sn.bestLenByDiffWalls[w]) dst.sn.bestLenByDiffWalls[w] = {};
          const swd = sbdw[w] || {};
          for (const k of Object.keys(swd)) dst.sn.bestLenByDiffWalls[w][k] = Math.max(dst.sn.bestLenByDiffWalls[w][k] | 0, swd[k] | 0);
        }
      } else if (g === 'boggle' && src.bg) {
        // Same THE-LAW-rule-1 hazard as tictactoe's tt above: `total` aggregates fine on its
        // own, but Boggle's Stats screen reads `bg` for ties, best score, words found and the
        // longest word, so dropping it here would blank all four the moment a second device
        // syncs -- data present in every device's own store, invisible on the combined screen.
        // Counters add; bests take the max across devices, and the longest word carries its
        // TEXT from whichever device actually holds the longest one (a max on `len` alone
        // would keep a length with the wrong word next to it).
        if (!dst.bg) dst.bg = { played: 0, won: 0, lost: 0, tied: 0, words: 0, bestScore: 0, longestWord: { word: '', len: 0 } };
        dst.bg.played += src.bg.played | 0; dst.bg.won += src.bg.won | 0;
        dst.bg.lost += src.bg.lost | 0; dst.bg.tied += src.bg.tied | 0;
        dst.bg.words += src.bg.words | 0;
        dst.bg.bestScore = Math.max(dst.bg.bestScore | 0, src.bg.bestScore | 0);
        const slw = src.bg.longestWord || {};
        if ((slw.len | 0) > (dst.bg.longestWord.len | 0)) {
          dst.bg.longestWord = { word: typeof slw.word === 'string' ? slw.word : '', len: slw.len | 0 };
        }
      } else if (g === 'yahtzee' && src.yz) {
        // Same THE-LAW-rule-1 hazard as boggle's bg above: `total` aggregates fine on its own,
        // but Yahtzee's Stats screen reads `yz` for ties, Yahtzee count and best score, so
        // dropping it here would blank all three the moment a second device syncs. Counters
        // add; the best score takes the max across devices.
        if (!dst.yz) dst.yz = { played: 0, won: 0, lost: 0, tied: 0, yahtzees: 0, bestScore: 0 };
        dst.yz.played += src.yz.played | 0; dst.yz.won += src.yz.won | 0;
        dst.yz.lost += src.yz.lost | 0; dst.yz.tied += src.yz.tied | 0;
        dst.yz.yahtzees += src.yz.yahtzees | 0;
        dst.yz.bestScore = Math.max(dst.yz.bestScore | 0, src.yz.bestScore | 0);
      } else if (g === 'dominoes' && src.dm) {
        // Same THE-LAW-rule-1 hazard as every sub-counter above: `total` aggregates fine on its
        // own, but Dominoes' Stats screen reads `dm` for rounds played, cumulative points and
        // the best single round, so dropping it here would blank all three the moment a second
        // device syncs. Counters add; the best round takes the max, never a sum.
        if (!dst.dm) dst.dm = { played: 0, won: 0, lost: 0, tied: 0, rounds: 0, bestRound: 0, points: 0 };
        dst.dm.played += src.dm.played | 0; dst.dm.won += src.dm.won | 0; dst.dm.lost += src.dm.lost | 0;
        dst.dm.tied += src.dm.tied | 0;
        dst.dm.rounds += src.dm.rounds | 0;
        dst.dm.points += src.dm.points | 0;
        dst.dm.bestRound = Math.max(dst.dm.bestRound | 0, src.dm.bestRound | 0);
      } else if (g === 'hillclimb' && src.hc) {
        // Root CLAUDE.md "Adding a game" item 7's third edit, present from Hill Climb's first day
        // rather than after a bug report: without this branch the game's own Stats screen reads
        // zeroes the moment a person's second device syncs, even though total/byDiff stay right
        // and every device's local store is intact. Counters (runs, lifetime coins, flips) ADD;
        // every distance best and the best coin haul take Math.max, never a sum.
        if (!dst.hc) dst.hc = { runs: 0, bestDistance: 0, bestDistanceByStage: {}, coins: 0, bestCoins: 0, flips: 0 };
        dst.hc.runs += src.hc.runs | 0;
        dst.hc.coins += src.hc.coins | 0;
        dst.hc.flips += src.hc.flips | 0;
        dst.hc.bestDistance = Math.max(dst.hc.bestDistance | 0, src.hc.bestDistance | 0);
        dst.hc.bestCoins = Math.max(dst.hc.bestCoins | 0, src.hc.bestCoins | 0);
        const sbs = src.hc.bestDistanceByStage || {};
        for (const k of Object.keys(sbs)) dst.hc.bestDistanceByStage[k] = Math.max(dst.hc.bestDistanceByStage[k] | 0, sbs[k] | 0);
      } else if (g === 'pinball' && src.pb) {
        // Root CLAUDE.md "Adding a game" item 7's third edit, present from Pinball's first day
        // rather than after a bug report: without this branch the game's own Stats screen reads
        // zeroes the moment a person's second device syncs, even though total/byDiff stay right
        // and every device's local store is intact. Lifetime counters (games, points, jackpots,
        // multiballs, missions, ramps) ADD; both bests take Math.max, never a sum - a best score
        // is one game's result, so adding two devices' bests would invent a game nobody played.
        if (!dst.pb) dst.pb = { games: 0, bestScore: 0, points: 0, bestBall: 0, jackpots: 0, multiballs: 0, missions: 0, ramps: 0 };
        dst.pb.games += src.pb.games | 0;
        dst.pb.points += src.pb.points | 0;
        dst.pb.jackpots += src.pb.jackpots | 0;
        dst.pb.multiballs += src.pb.multiballs | 0;
        dst.pb.missions += src.pb.missions | 0;
        dst.pb.ramps += src.pb.ramps | 0;
        dst.pb.bestScore = Math.max(dst.pb.bestScore | 0, src.pb.bestScore | 0);
        dst.pb.bestBall = Math.max(dst.pb.bestBall | 0, src.pb.bestBall | 0);
      } else if (g === 'battleship' && src.bs) {
        // Root CLAUDE.md "Adding a game" item 7's third edit. Counters (played/won/lost/shots/
        // hits/sunk) ADD; bestAccuracy takes Math.max. fewestShotsWin is this repo's first
        // DOWNWARD-improving best (js/game-stats.js's ensureBs comment): 0 is an unset sentinel,
        // never a real "won in 0 shots" - a naive Math.min(dst, src) here would latch every
        // player at 0 the instant a device with no wins syncs (js/game-stats.js's own header
        // names this as the exact silent, permanent, LAW-rule-1 wrong number to avoid). The fix
        // is to only consider a source value that is itself non-zero, then take the min of
        // whatever non-zero values exist.
        if (!dst.bs) dst.bs = { played: 0, won: 0, lost: 0, shots: 0, hits: 0, sunk: 0, bestAccuracy: 0, fewestShotsWin: 0 };
        dst.bs.played += src.bs.played | 0; dst.bs.won += src.bs.won | 0; dst.bs.lost += src.bs.lost | 0;
        dst.bs.shots += src.bs.shots | 0; dst.bs.hits += src.bs.hits | 0; dst.bs.sunk += src.bs.sunk | 0;
        dst.bs.bestAccuracy = Math.max(dst.bs.bestAccuracy | 0, src.bs.bestAccuracy | 0);
        const srcFsw = src.bs.fewestShotsWin | 0;
        if (srcFsw > 0) dst.bs.fewestShotsWin = dst.bs.fewestShotsWin ? Math.min(dst.bs.fewestShotsWin, srcFsw) : srcFsw;
      } else if (g === 'golf' && src.gf) {
        // Root CLAUDE.md "Adding a game" item 7's third edit. Counters (rounds/holes/strokes/
        // birdies/eagles/aces) ADD; `points` is a SIGNED Modified Stableford total (can go
        // negative), not a count, and still just adds like any other running total.
        // longestDriveYd takes Math.max. bestRoundByCourse is keyed per course, Math.min per key
        // (fewer strokes is better) - this repo's first per-key Math.min map. Unlike Battleship's
        // fewestShotsWin, no zero-sentinel guard is needed: a course simply ABSENT from
        // bestRoundByCourse means "never played there" (the lowest possible 9-hole score is 9,
        // never 0), so a plain per-key existence check is enough.
        if (!dst.gf) dst.gf = { rounds: 0, holes: 0, strokes: 0, points: 0, birdies: 0, eagles: 0, aces: 0, longestDriveYd: 0, bestRoundByCourse: {} };
        dst.gf.rounds += src.gf.rounds | 0; dst.gf.holes += src.gf.holes | 0; dst.gf.strokes += src.gf.strokes | 0;
        dst.gf.points += src.gf.points | 0;
        dst.gf.birdies += src.gf.birdies | 0; dst.gf.eagles += src.gf.eagles | 0; dst.gf.aces += src.gf.aces | 0;
        dst.gf.longestDriveYd = Math.max(dst.gf.longestDriveYd | 0, src.gf.longestDriveYd | 0);
        const srcBest = src.gf.bestRoundByCourse || {};
        if (!dst.gf.bestRoundByCourse) dst.gf.bestRoundByCourse = {};
        for (const k of Object.keys(srcBest)) {
          const v = srcBest[k] | 0;
          const cur = dst.gf.bestRoundByCourse[k];
          dst.gf.bestRoundByCourse[k] = Number.isFinite(cur) ? Math.min(cur, v) : v;
        }
        // practice (Part 8): kept and carried, same as Skeeball's sk.practice.boards - reachable
        // by nothing above (rule 1: never dropped; rule 2: never counted).
        if (src.gf.practice) {
          if (!dst.gf.practice) dst.gf.practice = {};
          for (const cid of Object.keys(src.gf.practice)) {
            const sp = src.gf.practice[cid] || {};
            const dp = dst.gf.practice[cid] || (dst.gf.practice[cid] = {
              rounds: 0, holes: 0, strokes: 0, points: 0, birdies: 0, eagles: 0, aces: 0, longestDriveYd: 0,
            });
            dp.rounds += sp.rounds | 0; dp.holes += sp.holes | 0; dp.strokes += sp.strokes | 0;
            dp.points += sp.points | 0;
            dp.birdies += sp.birdies | 0; dp.eagles += sp.eagles | 0; dp.aces += sp.aces | 0;
            dp.longestDriveYd = Math.max(dp.longestDriveYd | 0, sp.longestDriveYd | 0);
          }
        }
      } else if (g === 'skeeball' && src.sk) {
        // Root CLAUDE.md "Adding a game" item 7's third edit, present from this game's first day.
        // Counters (played/won/lost/tied, balls thrown, lifetime points, 100s and 50s) ADD; the two
        // bests take Math.max, NEVER a sum - a summed bestGame would invent a score nobody ever
        // threw, which is rule 4 as well as rule 2.
        if (!dst.sk) {
          dst.sk = { played: 0, won: 0, lost: 0, tied: 0, balls: 0, points: 0, bestGame: 0, bestThrow: 0, hundreds: 0, fifties: 0, tens: 0, twenties: 0, thirties: 0, forties: 0, colorSweeps: 0, runaways: 0 };
        }
        // tens..forties added 2026-08-20 (the "every point value" unlock goal); colorSweeps
        // added 2026-08-22 (POPONGO's all-four-colors objective). Counters, so they ADD like
        // the rest; `| 0` covers a device that has not played since they existed.
        for (const k of ['played', 'won', 'lost', 'tied', 'balls', 'points', 'hundreds', 'fifties',
          'tens', 'twenties', 'thirties', 'forties', 'colorSweeps', 'runaways']) {
          dst.sk[k] = (dst.sk[k] | 0) + (src.sk[k] | 0);
        }
        dst.sk.bestGame = Math.max(dst.sk.bestGame | 0, src.sk.bestGame | 0);
        dst.sk.bestThrow = Math.max(dst.sk.bestThrow | 0, src.sk.bestThrow | 0);
        // Per-machine records and unlocks (2026-08-11). js/arcade-scores.js owns both merges so
        // Skeeball and Pinball can never disagree about them: bests take max, each DAY takes the
        // max of that day, and unlocks are a UNION - a second device must never take away a board
        // its owner earned on the first.
        if (!dst.sk.boards) dst.sk.boards = {};
        if (!dst.sk.unlocked) dst.sk.unlocked = {};
        mergeBoards(dst.sk.boards, src.sk.boards);
        mergeUnlocked(dst.sk.unlocked, src.sk.unlocked);
        // Practice racks (2026-08-24: thrown on a machine set to TESTING) merge with the same
        // function and stay in their own branch, so they are carried across devices like every
        // other stored thing (rule 1) while remaining unreachable by any counter above.
        if (src.sk.practice && src.sk.practice.boards) {
          if (!dst.sk.practice) dst.sk.practice = { boards: {} };
          mergeBoards(dst.sk.practice.boards, src.sk.practice.boards);
        }
      }
    }
  }
  const list = [];
  for (const grp of groups.values()) {
    let cp = 0, cw = 0, cl = 0;
    for (const g of COMPETITIVE) { const t = grp.games[g].total; cp += t.played; cw += t.won; cl += t.lost; }
    const nb = grp.games.nutsbolts.nb;
    const solved = (nb && nb.solved) || (grp.games.nutsbolts.total.played | 0);   // fallback for pre-nb records
    grp.comp = { played: cp, won: cw, lost: cl };
    grp.solo = { solved, bestLevel: (nb && nb.bestLevel) | 0, moves: (nb && nb.moves) | 0 };
    grp.totalPlays = cp + solved;
    list.push(grp);
  }
  return list;
}

/** The single aggregated group for a VIEWER, using their fresh LOCAL stats for their own device and
 *  remote records for their other devices (two-way sync as read-time aggregation; no copy, no
 *  double-count). Pure: caller passes profile, own deviceId, and loadStats() output. Null if no data. */
export function aggregateForViewer(all, profileLike, myDeviceId, localStats, corrections) {
  const merged = Object.assign({}, all || {});
  const baseProf = (merged[myDeviceId] && merged[myDeviceId].profile) || {};
  const myProf = Object.assign({}, baseProf, {
    name: (profileLike && profileLike.name) || baseProf.name || '',
    emoji: (profileLike && profileLike.emoji) || baseProf.emoji || '',
    playerId: (profileLike && profileLike.playerId) || baseProf.playerId || '',
    message: (profileLike && profileLike.message) || baseProf.message || '',
    messageAt: (profileLike && +profileLike.messageAt) || +baseProf.messageAt || 0,
  });
  merged[myDeviceId] = { profile: myProf, stats: localStats, updatedAt: Number.MAX_SAFE_INTEGER };
  const myKey = buildIdentity(merged).keyFor(myProf, myDeviceId);
  return aggregatePlayers(merged, corrections).find((g) => g.key === myKey) || null;
}

export default { aggregatePlayers, identityKey, buildIdentity, aggregateForViewer, COMPETITIVE, SOLO };
