// functions/play-voids.js - VOIDED PLAYS, the server half (2026-11-24, js/play-voids.js says what a void takes away).
// rebuildPlayVoids(db, code) gathers every voided play of one player code (a PROVEN trip-wire alert, Option A, unless
// Matt undid it; or Matt's own Void), reads those play-log entries, every play of that person in the same games, and
// their records, and writes ONE overlay for phones and the board: adminConfig/v1/corrections/playVoids/<CODE>.
// Writing there also rebuilds the leaderboard (boardsOnConfig). THE LAW: nothing stored is changed or deleted; Undo
// (Matt sets void:false) rebuilds the overlay without that play.
//
// Reads: adminConfig/v1/integrity/plays/<CODE>, integrityAlerts (a few KB), each voided entry, the person's plays in
// that game (playLog indexed on g) and records (players indexed on profile/playerId). Only on a void, an undo, or a
// new play that could raise a capped best: never on a timer.
import './shared-env.js';
import { buildGameVoids, isPlayVoided, playEffect } from './shared/js/play-voids.js';
import { SOLO } from './shared/js/players-agg.js';

const val = async (db, path) => (await db.ref(path).get()).val();
const CODE_RE = /^[A-Z0-9]{3,12}$/;

/** { <entry id>: { g, proven } } for one code from integrityAlerts keys `<g>~<CODE>~<id>`. */
export function provenFor(alerts, code) {
  const out = {};
  for (const [key, byRule] of Object.entries(alerts || {})) {
    const parts = String(key).split('~');
    if (parts.length !== 3 || parts[1] !== code) continue;
    const proven = Object.values(byRule || {}).some((a) => a && a.proven === true);
    out[parts[2]] = { g: parts[0], proven };
  }
  return out;
}

export async function rebuildPlayVoids(db, codeIn) {
  const code = String(codeIn || '').toUpperCase();
  if (!CODE_RE.test(code)) return null;
  const [decisions, alerts] = await Promise.all([val(db, `adminConfig/v1/integrity/plays/${code}`), val(db, 'integrityAlerts')]);
  const auto = provenFor(alerts, code);
  const ids = new Set([...Object.keys(decisions || {}), ...Object.keys(auto)]);
  const voidIds = [...ids].filter((id) => isPlayVoided((decisions || {})[id], (auto[id] || {}).proven));
  const entries = (await Promise.all(voidIds.map(async (id) => ({ id, e: await val(db, `playLog/${code}/${id}`) })))).filter((x) => x.e);
  const byGame = {};
  for (const v of entries) (byGame[v.e.g] || (byGame[v.e.g] = [])).push(v);
  const out = {};
  if (Object.keys(byGame).length) {
    const recs = (await db.ref('players').orderByChild('profile/playerId').equalTo(code).get()).val() || {};
    for (const [g, voided] of Object.entries(byGame)) {
      const rows = (await db.ref(`playLog/${code}`).orderByChild('g').equalTo(g).get()).val() || {};
      const plays = Object.entries(rows).map(([id, e]) => ({ id, e }));
      const records = Object.values(recs).map((r) => (((r || {}).stats || {}).games || {})[g]).filter(Boolean);
      const built = buildGameVoids(g, voided, plays, records, SOLO.has(g));
      if (built) out[g] = Object.assign(built, { at: Date.now(), ids: voided.map((v) => v.id).join(',').slice(0, 1500) });
    }
  }
  const path = `adminConfig/v1/corrections/playVoids/${code}`;
  const before = await val(db, path);
  const next = Object.keys(out).length ? out : null;
  if (JSON.stringify(before || null) === JSON.stringify(next)) return next;
  await db.ref(path).set(next);
  const check = await val(db, path);   // rule 6: verified by re-read
  if (JSON.stringify(check || null) !== JSON.stringify(next)) console.error('[play-voids] overlay did not read back', code);
  return next;
}

/** A new play in a game with voids: rebuild only when it could change a capped best (higher than its `next`). */
export async function maybeRefreshPlayVoids(db, code, entry) {
  const ef = playEffect(entry, SOLO.has(String((entry || {}).g)));
  if (!ef) return false;
  const pv = await val(db, `adminConfig/v1/corrections/playVoids/${String(code).toUpperCase()}/${ef.g}`);
  if (!pv || !pv.caps) return false;
  const raises = ef.fields.some((f) => pv.caps[f.path] && f.score > (Number(pv.caps[f.path].next) || 0) && f.score <= (Number(pv.caps[f.path].v) || 0));
  if (raises) await rebuildPlayVoids(db, code);
  return raises;
}
