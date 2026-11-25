// js/name-history.js - EVERY NAME A PERSON HAS USED, AND EVERY OTHER ACCOUNT ON THEIR DEVICES (2026-11-24,
// Matt: "just because he deleted it doesn't mean it should be deleted from anything i see"). King of Games
// made "El Fantasma" (code CRK7E) in a Safari tab on Nov 17, played Ball Run on it, then tapped Reset profile:
// the record kept only the blank name "You", and the name survived only in usernames/. A rename also DELETES the
// old name from usernames/ (stats-net.js claimUsername), so from 2026-11-24 the server keeps every change
// forever in nameLog/<CODE>/<push> = { from, to, dev, at } (functions/index.js nameLogOnChange).
//
// PURE, read only. The admin page's person page shows both lists (js/admin-ui.js personPage).
//   players   players/ (every device record)          recIds  this person's record ids
//   codes     this person's player codes              usernames  usernames/ (name key -> { code, at })
//   nameLog   nameLog/ (code -> push -> entry), {} until read
// A record id is `<device uuid>` or `<device uuid>-<CODE>` (a second player on the same browser), so the first
// 36 characters name the BROWSER. Another code on the same browser is another account the same hands used.

export const devOf = (id) => String(id || '').slice(0, 36);
const blank = (n) => { const s = String(n || '').trim(); return !s || s.toLowerCase() === 'you'; };
const dec = (k) => { try { return decodeURIComponent(String(k)); } catch { return String(k); } };
const up = (c) => String(c || '').trim().toUpperCase();

function namesOfCodes(codeSet, recs, usernames, nameLog) {
  const out = new Map();          // lower name -> { name, srcs:Set, at }
  const add = (name, src, at) => {
    if (blank(name)) name = '(no name)';
    const k = String(name).trim().toLowerCase();
    const e = out.get(k) || { name: String(name).trim(), srcs: new Set(), at: 0 };
    e.srcs.add(src); if (+at > e.at) e.at = +at; out.set(k, e);
  };
  for (const [, rec] of recs) { const p = (rec && rec.profile) || {}; add(p.name, 'profile', +rec.updatedAt || 0); if (p.nameArchived) add(p.nameArchived, 'archived', 0); }
  for (const [k, v] of Object.entries(usernames || {})) if (v && codeSet.has(up(v.code))) add(dec(k), 'reserved', +v.at || 0);
  for (const c of codeSet) for (const e of Object.values((nameLog || {})[c] || {})) {
    if (!e) continue;
    if (e.from != null) add(e.from, 'changed', +e.at || 0);
    if (e.to != null) add(e.to, 'changed', +e.at || 0);
  }
  return [...out.values()].map((e) => ({ name: e.name, srcs: [...e.srcs].sort(), at: e.at })).sort((a, b) => b.at - a.at);
}

const playsOf = (rec) => { let n = 0; for (const g of Object.values(((rec && rec.stats) || {}).games || {})) n += +((g && g.total) || {}).played || 0; return n; };

/** { names: [{ name, srcs, at }], others: [{ code, names, plays, seen, devs }] } */
export function personNames({ players, recIds, codes, usernames, nameLog }) {
  const all = players || {};
  const codeSet = new Set((codes || []).map(up).filter(Boolean));
  const mine = (recIds || []).filter((id) => all[id]).map((id) => [id, all[id]]);
  const names = namesOfCodes(codeSet, mine, usernames, nameLog);
  const devs = new Set(mine.map(([id]) => devOf(id)));
  // SAME SIGN-IN (2026-11-25, the red-team review): a record id is chosen by the phone, so a cheater can dodge the
  // same-browser link; its `own` (the browser's sign-in, which the rules now hold to the writer) links it too.
  const uids = new Set(mine.map(([, r]) => r && r.own).filter(Boolean));
  const byCode = new Map();
  for (const [id, rec] of Object.entries(all)) {
    if ((!devs.has(devOf(id)) && !(rec && rec.own && uids.has(rec.own))) || (recIds || []).includes(id)) continue;
    const c = up(((rec && rec.profile) || {}).playerId) || '(no code)';
    if (codeSet.has(c)) continue;
    const e = byCode.get(c) || { code: c, recs: [], plays: 0, seen: 0, devs: new Set() };
    e.recs.push([id, rec]); e.plays += playsOf(rec); e.seen = Math.max(e.seen, +rec.updatedAt || 0); e.devs.add(devOf(id));
    byCode.set(c, e);
  }
  const others = [...byCode.values()].map((e) => ({
    code: e.code, plays: e.plays, seen: e.seen, devs: e.devs.size,
    names: namesOfCodes(new Set([e.code]), e.recs, usernames, nameLog),
  })).sort((a, b) => b.seen - a.seen);
  return { names, others };
}

export default { devOf, personNames };
