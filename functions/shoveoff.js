// functions/shoveoff.js - KNOCKOUT'S SEALED ROUNDS, the server's half (2026-11-25).
//
// The review: "Online aims can be read before they are revealed ... The first player's aims sit in the
// database until the other player sends, so the second player could read them with dev tools." Matt: "fix
// the other things from the review too". From 2026-11-25 every new match carries `sv: 1`: a phone writes its
// aims to `shoveoffSealed/<id>/r<round>/<side>` (no player can read the other side's), plus a public marker
// in the match. This reveals a round once BOTH sides are sealed: it appends both entries to
// `shoveoff/games/<id>/log` in the order they were sealed (the `{ by, r, aims, at }` every older match
// holds, so the phones' replay, the private log and shoveOffTurnPush work unchanged), sets `over` when the
// replay decides the match, then writes both index rows (which is what sends the push).
//
// The rules of the match are the phone's own pure code (shove-off/js/match.js + engine.js, copied in by
// tools/sync-functions-shared.mjs). A transaction makes two triggers racing on one round append it once,
// and a match that ended meanwhile (resign, cancel) is never revealed. Nothing is ever deleted. Reads: the
// one match and the one round's sealed entries (a few hundred bytes), never a whole node.
import { validateGame, revealSealed, rowFor, roundKey, ID_RE } from './shared/shove-off/js/match.js';

export const NODE = 'shoveoff';
export const SEALED = 'shoveoffSealed';

/**
 * Reveal match `id`'s current round if both sides have sealed it. `db` = an Admin SDK database (ref(path)
 * with get / transaction / update), `now` = a clock. Returns { ok: true, round, writer, over } when it
 * revealed a round, else { ok: false, why }.
 */
export async function revealRound(db, id, now = () => Date.now()) {
  if (!ID_RE.test(String(id || ''))) return { ok: false, why: 'bad-id' };
  const gref = db.ref(`${NODE}/games/${id}`);
  const raw = (await gref.get()).val();
  const first = validateGame(raw);
  if (!first) return { ok: false, why: 'invalid' };
  if (!first.sv) return { ok: false, why: 'not-sealed' };
  if (first.over) return { ok: false, why: 'over' };
  const r = first.round;
  const sealed = (await db.ref(`${SEALED}/${id}/${roundKey(r)}`).get()).val();
  const pre = revealSealed(raw, sealed, r, now());
  if (pre.skip) return { ok: false, why: pre.skip };      // a side still aiming: nothing to do
  let out = null;
  const res = await gref.transaction((cur) => {
    if (cur == null) return cur;                 // no local copy yet: the server retries with the real one
    const x = revealSealed(cur, sealed, r, now());
    out = x;
    return x.skip ? undefined : x.doc;           // undefined = abort, nothing written
  }, undefined, false);
  if (!res || !res.committed || !out || out.skip) return { ok: false, why: (out && out.skip) || 'not-committed' };
  // The match as it now stands (a fresh read, rule 6), then both people's rows from it.
  const game = validateGame((await gref.get()).val());
  if (!game || game.resolved <= first.resolved) {
    console.error(`[shoveoff] VERIFY FAILED: ${NODE}/games/${id} round ${r} did not land`);
    return { ok: false, why: 'did-not-land' };
  }
  game.id = id;
  const t = now();
  await db.ref(`${NODE}/index/${game.a.code}/${id}`).update(rowFor(game, 'a', out.writer, t));
  await db.ref(`${NODE}/index/${game.b.code}/${id}`).update(rowFor(game, 'b', out.writer, t));
  return { ok: true, round: r, writer: out.writer, over: !!game.over };
}
