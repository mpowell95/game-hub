// functions/evidence.js - EVIDENCE THAT IS MISSING IS ITSELF EVIDENCE (2026-11-25, Matt: "Fix all", after a review
// that tried to get round the trip wires). Every trip wire judges data the phone sends; a cheater could simply send a
// result WITHOUT that data (every rule then returns "nothing to check"), or put a score straight into his players/
// record with no play behind it at all. This file catches both, from the server's side. ALERTS ONLY, never a void.
//
//   playTally/<CODE>/<game>   = { lw: results logged, sw: plays synced (players/ played went up by), hi: { <best path>:
//                                 highest score logged }, al: the gap at the last alert, at }      (server only)
//   playPending/<CODE>~<id>   = { code, id, g, at, open }   a whole-run game's result whose touch log has not arrived
//   bestPending/<CODE>~<g>~<path> = { code, g, path, v, at, open }   a synced best higher than any logged play
//
// Rules (alerts, in integrityAlerts like every other trip wire, so Admin > Now shows them with Void / Dismiss):
//   evidence-missing     a result from a current build (it carries `u`) in a game that always logs its play, without it
//   touch-log-missing    a whole-run game's result (Snake, Ball Run, Tower Stack, Brick Breaker, Hill Climb) whose touch
//                        log never arrived (15 minutes)
//   best-without-play    a synced best score that no logged play reached (15 minutes after the sync)
//   plays-without-log    a person's synced plays in a game ran more than 5 ahead of the plays the log ever received
// Reads are a few hundred bytes each; the 15-minute sweep reads only the open markers and playTally (a few KB).
// THE LAW: nothing here changes a player's record, a score or a board. Markers are closed (open: false), never deleted.
import { bestFieldsOf } from './shared/js/play-voids.js';
import { TOUCH_WHOLE } from './shared/js/trip-wires/index.js';

export const EVIDENCE_GAMES = new Set([...TOUCH_WHOLE, 'skeeball', 'gridlock', 'wayout', 'sudoku', 'murdoku', 'minesweeper', 'nutsbolts', 'wordweaver', 'wordladder']);
export const NOT_A_PLAY = /Hand$|Bank$|Hint$|Buy$|FreeHint$|FreeLost$|Genius$|HeadToHead$/;   // recorders that add no play
const NO_DETAILS = /^quitLoss$|\(queued\)/;                    // plays that carry no play log by design (a quit, a queued replay)
// The top-level best of each whole-run game (js/play-voids.js bestFieldsOf writes these and more; these are the boards').
export const TOP_BESTS = { snake: ['sn.bestLen'], ballrun: ['br.bestObstacles', 'brOrbital.bestObstacles'], hillclimb: ['hc.bestDistance'], tower: ['tw.best'], brickblitz: ['bz.bestScore'] };
export const PENDING_MS = 15 * 60 * 1000;
export const GAP_LIMIT = 5;
export const EVIDENCE_TEXT = {
  'evidence-missing': 'a result sent without the play behind it',
  'touch-log-missing': 'a result whose touches never arrived',
  'best-without-play': 'a best score no logged play reached',
  'plays-without-log': 'plays counted with no play logged',
};

const safe = (s) => String(s || '').replace(/[.#$/[\]~]/g, '_').slice(0, 40);
const pkey = (p) => String(p).replace(/[.#$/[\]]/g, '~');
const jsonOf = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const get = (o, path) => String(path).split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);

/** PURE: what one logged entry means here. { play, g, fields: [{path, score}], missing: bool, needN: bool } or null. */
export function entryFacts(e) {
  if (!e || !/^record/.test(String(e.f || '')) || NOT_A_PLAY.test(String(e.f))) return null;
  const g = safe(e.g);
  const a = jsonOf(e.a);
  const fields = bestFieldsOf(g, Array.isArray(a) ? a : [], '', '');
  const current = typeof e.u === 'string' && !!e.u;   // only builds from 2026-11-25 stamp `u`; older ones are never judged
  const whole = !NO_DETAILS.test(String(e.f));
  return { g, fields, missing: current && whole && EVIDENCE_GAMES.has(g) && !e.x, needN: current && whole && TOUCH_WHOLE.has(g) };
}

/** PURE: a person's record changed from `old` to `nu`. [{ g, dPlayed, bests: [{ path, v }] }] for games that grew. */
export function recordGrowth(old, nu) {
  const og = (old && old.stats && old.stats.games) || {}, ng = (nu && nu.stats && nu.stats.games) || {};
  const out = [];
  for (const [g, gm] of Object.entries(ng)) {
    if (!gm || typeof gm !== 'object') continue;
    const was = og[g] || {};
    const dPlayed = Math.max(0, ((gm.total && gm.total.played) | 0) - ((was.total && was.total.played) | 0));
    const bests = [];
    for (const path of TOP_BESTS[g] || []) {
      const v = Number(get(gm, path)) || 0, w = Number(get(was, path)) || 0;
      if (v > w) bests.push({ path, v });
    }
    if (dPlayed > 0 || bests.length) out.push({ g, dPlayed, bests });
  }
  return out;
}

async function writeAlert(db, code, g, id, rule, v, t, now) {
  const name = String(((await db.ref(`directory/${code}/name`).get()).val()) || code).slice(0, 40);
  const alert = { v: String(v).slice(0, 200), lim: '', side: '', name, code, k: String(id), t: Number(t) || now, g, proven: false, when: now };
  const res = await db.ref(`integrityAlerts/${g}~${code}~${id}/${rule}~x`).transaction((cur) => (cur ? undefined : alert));
  return res && res.committed ? { ...alert, rule, node: g } : null;
}

/** A result entry landed (functions playInputCheck). `hasN` = its touch log is already there. Returns alerts written. */
export async function noteLoggedPlay(db, code, id, e, hasN, now = Date.now()) {
  const f = entryFacts(e);
  if (!f) return [];
  await db.ref(`playTally/${code}/${f.g}`).transaction((cur) => {
    const c = cur && typeof cur === 'object' ? cur : {};
    c.lw = (c.lw | 0) + 1;
    c.hi = c.hi && typeof c.hi === 'object' ? c.hi : {};
    for (const x of f.fields) c.hi[pkey(x.path)] = Math.max(Number(c.hi[pkey(x.path)]) || 0, x.score);
    c.at = now;
    return c;
  });
  const out = [];
  if (f.missing) { const a = await writeAlert(db, code, f.g, id, 'evidence-missing', 'no play details', e.t, now); if (a) out.push(a); }
  if (f.needN && !hasN) await db.ref(`playPending/${code}~${id}`).set({ code, id: String(id), g: f.g, at: now, open: true });
  return out;
}

/** A touch log landed (functions playInputArrived): its result is no longer waiting. */
export async function noteTouchLog(db, code, id) {
  const ref = db.ref(`playPending/${code}~${id}`);
  const cur = (await ref.get()).val();
  if (cur && cur.open) await ref.update({ open: false, got: Date.now() });
}

/** A players/ record grew (the board rebuild's incremental read, functions/cache.js onChange). */
export async function noteSyncedGrowth(db, old, nu, now = Date.now()) {
  const code = String((nu && nu.profile && nu.profile.playerId) || '').toUpperCase();
  if (!/^[A-Z2-9]{5}$/.test(code)) return;
  for (const gr of recordGrowth(old, nu)) {
    const g = safe(gr.g);
    let tally = null;
    await db.ref(`playTally/${code}/${g}`).transaction((cur) => {
      const c = cur && typeof cur === 'object' ? cur : {};
      c.sw = (c.sw | 0) + gr.dPlayed;
      c.at = now;
      tally = c;
      return c;
    });
    for (const b of gr.bests) {
      const hi = tally && tally.hi ? Number(tally.hi[pkey(b.path)]) || 0 : 0;
      if (hi < b.v) await db.ref(`bestPending/${code}~${g}~${pkey(b.path)}`).set({ code, g, path: b.path, v: b.v, at: now, open: true });
    }
  }
}

/** The 15-minute sweep (functions evidenceWatch). Returns alerts written. */
export async function sweepEvidence(db, now = Date.now()) {
  const out = [];
  const [pend, bests, tallies] = await Promise.all([
    db.ref('playPending').orderByChild('open').equalTo(true).get().then((s) => s.val() || {}),
    db.ref('bestPending').orderByChild('open').equalTo(true).get().then((s) => s.val() || {}),
    db.ref('playTally').get().then((s) => s.val() || {}),
  ]);
  for (const [k, p] of Object.entries(pend)) {
    if (!p || now - (Number(p.at) || 0) < PENDING_MS) continue;
    const got = (await db.ref(`playInput/${p.code}/${p.id}/t`).get()).val();
    await db.ref(`playPending/${k}`).update({ open: false, ...(got ? { got: now } : { missed: now }) });
    if (!got) { const a = await writeAlert(db, p.code, p.g, p.id, 'touch-log-missing', 'no touch log', p.at, now); if (a) out.push(a); }
  }
  for (const [k, b] of Object.entries(bests)) {
    if (!b || now - (Number(b.at) || 0) < PENDING_MS) continue;
    const hi = Number(get(tallies, `${b.code}.${b.g}.hi.${pkey(b.path)}`)) || 0;
    await db.ref(`bestPending/${k}`).update({ open: false, ...(hi >= b.v ? { ok: now } : { flagged: now }) });
    if (hi < b.v) { const a = await writeAlert(db, b.code, b.g, `best-${pkey(b.path)}-${b.v}`, 'best-without-play', `${b.v} synced, best logged ${hi}`, b.at, now); if (a) out.push(a); }
  }
  for (const [code, games] of Object.entries(tallies)) {
    for (const [g, c] of Object.entries(games || {})) {
      const gap = ((c && c.sw) | 0) - ((c && c.lw) | 0);
      if (gap <= GAP_LIMIT || gap <= ((c && c.al) | 0) + GAP_LIMIT || now - (Number(c.at) || 0) < PENDING_MS) continue;
      await db.ref(`playTally/${code}/${g}/al`).set(gap);
      const a = await writeAlert(db, code, g, `gap-${gap}`, 'plays-without-log', `${c.sw | 0} plays synced, ${c.lw | 0} logged`, now, now);
      if (a) out.push(a);
    }
  }
  return out;
}

export default { EVIDENCE_GAMES, EVIDENCE_TEXT, entryFacts, recordGrowth, noteLoggedPlay, noteTouchLog, noteSyncedGrowth, sweepEvidence };
