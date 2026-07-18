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

export const SOLO = new Set(['nutsbolts']);                 // solo puzzle: win-only, no loss axis
export const COMPETITIVE = GAMES.filter((g) => !SOLO.has(g));

const DIFFS = ['easy', 'medium', 'hard', 'expert'];
const emptyGrid = () => {
  const side = () => ({ easy: { w: 0, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 }, expert: { w: 0, l: 0 } });
  return { player: side(), computer: side() };
};

/** nameLower -> CODE, from records that carry a code (a coded player owns their name). When two codes
 *  claim one name, the most recently active wins. */
export function nameCodeMap(all) {
  const m = new Map(), seen = new Map();
  for (const id of Object.keys(all || {})) {
    const rec = all[id] || {}, p = rec.profile || {};
    const code = (typeof p.playerId === 'string' ? p.playerId : '').trim().toUpperCase();
    const name = (typeof p.name === 'string' ? p.name : '').trim().toLowerCase();
    if (!code || !name) continue;
    const upd = +rec.updatedAt || 0;
    if (!m.has(name) || upd >= (seen.get(name) || 0)) { m.set(name, code); seen.set(name, upd); }
  }
  return m;
}

/** Grouping key for a profile-like object, precedence code -> name -> device. Returns {key, playerId}.
 *  An UNCODED device whose name is owned by a coded player joins that player: this is how a device
 *  that never entered the code (or one that only just set its name) reunites with its own history. */
export function identityKey(profileLike, fallbackId, nameToCode) {
  const p = profileLike || {};
  const code = (typeof p.playerId === 'string' ? p.playerId : '').trim().toUpperCase();
  if (code) return { key: 'code:' + code, playerId: code };
  const name = (typeof p.name === 'string' ? p.name : '').trim();
  if (name) {
    const owned = nameToCode && nameToCode.get(name.toLowerCase());
    if (owned) return { key: 'code:' + owned, playerId: owned };
    return { key: 'name:' + name.toLowerCase(), playerId: null };
  }
  return { key: 'device:' + fallbackId, playerId: null };
}

/** Aggregate the players/ map (deviceId -> record) into an UNSORTED list of one-per-person groups.
 *  Each group's `games[g]` is in the CANONICAL stats shape ({ total, byDiff, +grid/cc/es/nb }) so the
 *  same object doubles as a valid `st.games` for the Stats screens. Group also carries roll-ups:
 *  { key, playerId, name, emoji, devices, updatedAt, games, comp:{played,won,lost},
 *  solo:{solved,bestLevel,moves}, totalPlays }. */
export function aggregatePlayers(all) {
  const groups = new Map();
  const nameToCode = nameCodeMap(all);
  for (const id of Object.keys(all || {})) {
    const rec = all[id] || {};
    const prof = rec.profile || {};
    const { key, playerId } = identityKey(prof, id, nameToCode);
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
    if (upd >= grp.updatedAt) { grp.updatedAt = upd; if (rawName) grp.name = rawName; if (prof.emoji) grp.emoji = prof.emoji; }
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
  const myKey = identityKey(myProf, myDeviceId, nameCodeMap(merged)).key;
  return aggregatePlayers(merged).find((g) => g.key === myKey) || null;
}

export default { aggregatePlayers, identityKey, aggregateForViewer, COMPETITIVE, SOLO };
