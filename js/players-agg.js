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

export const SOLO = new Set(['nutsbolts', 'ballrun']);       // solo: win-only (no loss axis) or score-based

/** 'You' is profile-store's default when a name is left blank, so it is a placeholder, not a name. */
export const isPlaceholderName = (n) => { const s = (typeof n === 'string' ? n : '').trim().toLowerCase(); return !s || s === 'you'; };
export const COMPETITIVE = GAMES.filter((g) => !SOLO.has(g));

const DIFFS = ['easy', 'medium', 'hard', 'expert'];
const emptyGrid = () => {
  const side = () => ({ easy: { w: 0, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 }, expert: { w: 0, l: 0 } });
  return { player: side(), computer: side() };
};

// Alternate profile names known to be the same person (hand-maintained for this family hub).
const NAME_ALIAS = { matt: 'mattyice' };
const canonName = (n) => NAME_ALIAS[n] || n;

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
 *  { key, playerId, name, emoji, devices, updatedAt, games, comp:{played,won,lost},
 *  solo:{solved,bestLevel,moves}, totalPlays }. */
export function aggregatePlayers(all) {
  const groups = new Map();
  const ident = buildIdentity(all);
  for (const id of Object.keys(all || {})) {
    const rec = all[id] || {};
    const prof = rec.profile || {};
    const key = ident.keyFor(prof, id);
    const playerId = codeOf(prof) || null;
    let grp = groups.get(key);
    if (!grp) {
      grp = { key, playerId, name: '', emoji: '', devices: 0, updatedAt: 0, games: {} };
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
        grp.name = rawName; grp._nameAt = upd;
      }
    }
    const games = (rec.stats && rec.stats.games) || {};
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
export function aggregateForViewer(all, profileLike, myDeviceId, localStats) {
  const merged = Object.assign({}, all || {});
  const baseProf = (merged[myDeviceId] && merged[myDeviceId].profile) || {};
  const myProf = Object.assign({}, baseProf, {
    name: (profileLike && profileLike.name) || baseProf.name || '',
    emoji: (profileLike && profileLike.emoji) || baseProf.emoji || '',
    playerId: (profileLike && profileLike.playerId) || baseProf.playerId || '',
  });
  merged[myDeviceId] = { profile: myProf, stats: localStats, updatedAt: Number.MAX_SAFE_INTEGER };
  const myKey = buildIdentity(merged).keyFor(myProf, myDeviceId);
  return aggregatePlayers(merged).find((g) => g.key === myKey) || null;
}

export default { aggregatePlayers, identityKey, buildIdentity, aggregateForViewer, COMPETITIVE, SOLO };
