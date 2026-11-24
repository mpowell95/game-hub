// js/play-voids.js - VOID ONE PLAY (2026-11-24, Matt: "We MUST be able to identify and void games and rounds where he
// cheated"). Until today a void took out a whole GAME on a device record (js/stats-corrections.js voidIntegrityGame).
// Now one play-log entry can be voided: by Matt (Admin: Void on a play or an alert) or by the server when a PROVEN
// trip wire fires (Option A, Matt: "Option A, of course": js/integrity.js PLAY_INPUT_PROVEN). Nothing stored is
// changed (THE LAW): a void is a read-time overlay, like Matt's adjust numbers.
//
// WHERE IT LIVES
//   adminConfig/v1/integrity/plays/<CODE>/<entry id> = { void: true|false, g, at }   Matt's decision (wins over auto)
//   integrityAlerts/<g>~<CODE>~<entry id>/<rule>~x    = { proven: true, ... }         a proven hit = an automatic void
//   adminConfig/v1/corrections/playVoids/<CODE>/<g>    = what the voids TAKE AWAY, built by the SERVER only
//     (functions/play-voids.js rebuildPlayVoids, from the play log and the person's records) =
//     { n, adj: { '<level>~<mode>'|'<level>': { played, won, lost } }, caps: { '<path>': { v, next } },
//       sums: { '<path>': <added back> } }
//   Phones and the board read only that last node, through resolveCorrections, so every screen agrees.
//
// WHAT A VOID TAKES AWAY
//   - the play itself from the counters (played, and won or lost), at the level and mode it was played (`adj`, applied
//     exactly like Matt's adjust by game type, js/stats-corrections.js adjustModesGame / adjustGame);
//   - a BEST it set: a best field whose value is one of the voided scores (`v` = the highest voided score) falls back to
//     `next` = the best NOT-voided play the server could find (the play log since Oct 28, and every record of the person
//     whose own best is not a voided score). A best HIGHER than every voided score is a real later play and stays;
//   - its score from a mode's running total (`byMode.<mode>.<level>.hs` minus the score, `hn` minus 1), so averages
//     (the leaderboard's tie-break) drop it too.

/** Paths of the best fields a play of game `g` with recorder arguments `a` sets, each with that play's score there. */
export function bestFieldsOf(g, a, modeKey, diff) {
  const arr = Array.isArray(a) ? a : [];
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  const d = String(arr[1] || diff || '');
  const out = [];
  const add = (path, score) => { if (score > 0) out.push({ path, score }); };
  if (g === 'snake') {
    const s = n(arr[0]), w = arr[2] === 'on' ? 'on' : 'off';
    add('sn.bestLen', s); if (d) add(`sn.bestLenByDiff.${d}`, s); add(`sn.bestLenByWalls.${w}`, s); if (d) add(`sn.bestLenByDiffWalls.${w}.${d}`, s);
  } else if (g === 'ballrun') {
    const s = n(arr[0]), b = arr[2] === 'orbital' ? 'brOrbital' : 'br';
    add(`${b}.bestObstacles`, s); if (d) add(`${b}.bestObstaclesByDiff.${d}`, s);
  } else if (g === 'hillclimb') {
    const s = n(arr[0]), st = String(arr[1] || ''), x = arr[2] || {};
    add('hc.bestDistance', s); if (st) add(`hc.bestDistanceByStage.${st}`, s); add('hc.bestCoins', n(x.coins));
  } else if (g === 'tower') {
    const s = n(arr[0]), x = arr[2] || {};
    add('tw.best', s); if (d) add(`tw.bestByDiff.${d}`, s); add('tw.bestStreak', n(x.bestStreak));
  } else if (g === 'brickblitz') {
    const s = n(arr[0]), x = arr[2] || {};
    add('bz.bestScore', s); if (d) add(`bz.bestScoreByDiff.${d}`, s); add('bz.bestCombo', n(x.bestCombo));
  }
  // A mode's best (byMode hi) for every game that logs one.
  return out;
}

/** What one play-log entry adds to the stats: { g, slot, d: {played, won, lost}, fields, hi, mode, diff }. */
export function playEffect(e, solo) {
  if (!e || !/^record/.test(String(e.f || ''))) return null;
  let a = null; try { a = JSON.parse(e.a || 'null'); } catch { a = null; }
  let hi = null; try { const x = JSON.parse(e.x || 'null'); if (x && Number.isFinite(Number(x.hi))) hi = Number(x.hi); } catch { /* none */ }
  const m = String(e.m || '');
  const at = m.lastIndexOf('@');
  const mode = at > 0 ? m.slice(0, at) : '';
  const diff = at > 0 ? m.slice(at + 1) : (Array.isArray(a) && typeof a[0] === 'string' && !/^[0-9]/.test(a[0]) ? a[0] : '');
  const won = Array.isArray(a) ? a.find((v) => typeof v === 'boolean') : undefined;
  const g = String(e.g || '');
  const d = { played: -1, won: 0, lost: 0 };
  if (solo || won === true) d.won = -1; else if (won === false) d.lost = -1;
  const slot = diff ? (mode && mode !== '?' ? `${diff}~${mode}` : diff) : '';
  return { g, slot, d, mode: mode && mode !== '?' ? mode : '', diff, hi, fields: bestFieldsOf(g, a, mode, diff) };
}

const get = (o, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
function setIn(o, path, val) {
  const ks = path.split('.');
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) {
    const nx = cur[ks[i]];
    cur[ks[i]] = (nx && typeof nx === 'object') ? Array.isArray(nx) ? nx.slice() : Object.assign({}, nx) : {};
    cur = cur[ks[i]];
  }
  cur[ks[ks.length - 1]] = val;
}

/**
 * The server's build (pure): `voided` = the entries to void, `plays` = EVERY play-log entry of the person in that game,
 * `records` = the person's stored game records (players/<id>.stats.games.<g>), `soloSet` = js/players-agg.js SOLO.
 * Returns { n, adj, caps, sums } for adminConfig/v1/corrections/playVoids/<CODE>/<g>, or null with nothing to take.
 */
export function buildGameVoids(g, voided, plays, records, solo) {
  const vIds = new Set(voided.map((v) => v.id));
  const effects = voided.map((v) => playEffect(v.e, solo)).filter((x) => x && x.g === g);
  if (!effects.length) return null;
  const adj = {}, caps = {}, sums = {};
  for (const ef of effects) {
    if (ef.slot) {
      const s = adj[ef.slot] || (adj[ef.slot] = { played: 0, won: 0, lost: 0 });
      for (const k of ['played', 'won', 'lost']) s[k] += ef.d[k];
    }
    for (const f of ef.fields) { const c = caps[f.path] || (caps[f.path] = { v: 0, next: 0 }); c.v = Math.max(c.v, f.score); }
    if (ef.mode && ef.diff && ef.hi != null) {
      const hp = `byMode.${ef.mode}.${ef.diff}`;
      const c = caps[`${hp}.hi`] || (caps[`${hp}.hi`] = { v: 0, next: 0 }); c.v = Math.max(c.v, ef.hi);
      sums[`${hp}.hs`] = (sums[`${hp}.hs`] || 0) - ef.hi;
      sums[`${hp}.hn`] = (sums[`${hp}.hn`] || 0) - 1;
    }
  }
  // `next` for each capped best: the best NOT-voided play in the log, and every record whose own value is not voided.
  const voidedScores = {};
  for (const ef of effects) {
    for (const f of ef.fields) (voidedScores[f.path] || (voidedScores[f.path] = new Set())).add(f.score);
    if (ef.mode && ef.diff && ef.hi != null) (voidedScores[`byMode.${ef.mode}.${ef.diff}.hi`] || (voidedScores[`byMode.${ef.mode}.${ef.diff}.hi`] = new Set())).add(ef.hi);
  }
  for (const p of plays) {
    if (vIds.has(p.id)) continue;
    const ef = playEffect(p.e, solo);
    if (!ef || ef.g !== g) continue;
    for (const f of ef.fields) if (caps[f.path]) caps[f.path].next = Math.max(caps[f.path].next, f.score);
    if (ef.mode && ef.diff && ef.hi != null) { const k = `byMode.${ef.mode}.${ef.diff}.hi`; if (caps[k]) caps[k].next = Math.max(caps[k].next, ef.hi); }
  }
  for (const rec of records || []) {
    for (const path of Object.keys(caps)) {
      const v = Number(get(rec, path));
      if (Number.isFinite(v) && v > 0 && !(voidedScores[path] && voidedScores[path].has(v)) && v < caps[path].v) caps[path].next = Math.max(caps[path].next, v);
    }
  }
  return { n: effects.length, adj, caps, sums };
}

/** One person's game record with their play voids' caps and sums applied (`pv` = the stored { caps, sums }). The
 *  counters go through the adjust path (mergeAdj). Never mutates; `gm` itself when nothing applies. */
export function applyPlayCaps(gm, pv) {
  if (!gm || !pv || typeof pv !== 'object') return gm;
  let out = null;
  const w = () => out || (out = JSON.parse(JSON.stringify(gm)));
  for (const [path, c] of Object.entries(pv.caps || {})) {
    const cur = Number(get(gm, path));
    if (!Number.isFinite(cur) || !c) continue;
    const v = Number(c.v) || 0, next = Math.max(0, Number(c.next) || 0);
    if (cur <= v && cur > next) setIn(w(), path, next);     // a best a voided play set falls back; a higher, later best stays
  }
  for (const [path, add] of Object.entries(pv.sums || {})) {
    const cur = Number(get(out || gm, path));
    if (Number.isFinite(cur) && add) setIn(w(), path, Math.max(0, cur + Number(add)));
  }
  return out || gm;
}

/** `adj` (one person's adjust entry, { <game>: { <slot>: {...} } }) with their play voids' counters added. */
export function mergePlayVoidAdj(adj, pvByGame) {
  if (!pvByGame || typeof pvByGame !== 'object') return adj;
  const out = Object.assign({}, adj && typeof adj === 'object' ? adj : {});
  for (const [g, pv] of Object.entries(pvByGame)) {
    if (!pv || !pv.adj) continue;
    const gg = Object.assign({}, out[g] && typeof out[g] === 'object' ? out[g] : {});
    for (const [slot, f] of Object.entries(pv.adj)) {
      const cur = Object.assign({}, gg[slot] && typeof gg[slot] === 'object' ? gg[slot] : {});
      for (const k of ['played', 'won', 'lost']) cur[k] = (Math.trunc(Number(cur[k])) || 0) + (Math.trunc(Number(f[k])) || 0);
      gg[slot] = cur;
    }
    out[g] = gg;
  }
  return out;
}

/** Is a play voided? Matt's decision wins; else a proven trip wire. `decision` = adminConfig/v1/integrity/plays/<CODE>/<id>. */
export const isPlayVoided = (decision, proven) => (decision && typeof decision.void === 'boolean' ? decision.void : !!proven);

export default { bestFieldsOf, playEffect, buildGameVoids, applyPlayCaps, mergePlayVoidAdj, isPlayVoided };
