// js/admin-now.js - WHAT ADMIN > NOW HAS FOR MATT TO LOOK AT, as a count (2026-11-26, Matt: "When there's something
// for me to look at in my admin settings, put a notification badge on my profile thing ... then on Admin").
// PURE and SHARED with the server (functions/admin-now.js copies it in through tools/sync-functions-shared.mjs):
// the server counts it every few minutes and on every admin write, and publishes ONE small number at
// adminNow/v1 (admins + reader only), so the launcher never downloads players/ to know. The same gates as
// js/admin-ui.js nowRows, item for item: waiting sign-ins, Spelling Bee flags that stand, integrity flags with
// a rule (not a hand void), every online alert (cleared pairs aside), each not yet Dismissed, and every code seen
// that Matt has neither allowed nor refused online play.
import { resolveReviewed, resolveOnlineAllowed, onlineOverride } from './admin-config.js';
import { flagStands } from './bee-fairplay.js';
import { isClearedPair, HAND_VOIDS } from './integrity-view.js';
import { waitingList } from './signin-rules.js';

const obj = (v) => (v && typeof v === 'object' ? v : {});

/** { signin, bee, iv, ma, online, n } for one look at the nodes. `players` = players/ (records), `signIns`,
 *  `beeFlags`, `integrityFlags`, `integrityAlerts` = those nodes, `cfg` = adminConfig/v1, `now` = server ms. */
export function adminNowCount({ cfg, players, signIns, beeFlags, integrityFlags, integrityAlerts, now }) {
  const c = obj(cfg);
  let signin = 0, bee = 0, iv = 0, ma = 0, online = 0;
  for (const code of Object.keys(obj(signIns))) signin += waitingList(obj(signIns)[code], now).length;
  for (const [bk, byCode] of Object.entries(obj(beeFlags))) {
    for (const [code, f] of Object.entries(obj(byCode))) if (flagStands(f) && !resolveReviewed(c, 'bee', bk, code)) bee++;
  }
  for (const [id, games] of Object.entries(obj(integrityFlags))) {
    for (const [gid, rules] of Object.entries(obj(games))) {
      if (obj(HAND_VOIDS[id])[gid] || !Object.keys(obj(rules)).length || resolveReviewed(c, 'iv', id, gid)) continue;
      iv++;
    }
  }
  for (const [key, byRule] of Object.entries(obj(integrityAlerts))) {
    if (isClearedPair(key)) continue;
    // `ok` = the server found the alert explained (functions/evidence.js COUNT_FROM, 2026-11-26): kept, not shown in Now.
    for (const [rk, a] of Object.entries(obj(byRule))) if (!obj(a).ok && !resolveReviewed(c, 'ma', key, rk)) ma++;
  }
  const codes = new Set();
  for (const rec of Object.values(obj(players))) {
    const code = String(obj(obj(rec).profile).playerId || '').trim().toUpperCase();
    if (code) codes.add(code);
  }
  for (const code of codes) if (!resolveOnlineAllowed(c, code) && onlineOverride(c, code) === null) online++;
  return { signin, bee, iv, ma, online, n: signin + bee + iv + ma + online };
}

export default { adminNowCount };
