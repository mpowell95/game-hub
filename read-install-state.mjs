// read-install-state.mjs - Matt-only: who is playing in the INSTALLED app, and who is still in a
// browser tab.
//
// Why it exists (2026-08-11): Matt found out Ana had been playing in a Safari tab for two months.
// She dismissed the add-to-home-screen sheet early on, nothing ever asked again, and nothing
// anywhere recorded that she had. Every game here is built for the installed route, so this is a
// real diagnostic - it just had nowhere to live until js/install-state.js started riding along on
// the ordinary stats mirror (js/stats-net.js writes `players/<id>/device` on every hub load).
//
// So the data only appears for a device AFTER it next opens the hub on a build that has this. A
// phone that has not been opened since shows "(not seen yet)" - that is missing data, NOT a
// browser tab, and the two must never be confused. Nothing here is retroactive: there is no record
// of how anyone played before this shipped.
//
// Same no-dependency pattern as read-bug-reports.mjs / read-device-reports.mjs: anonymous sign-in
// via the Identity Toolkit REST endpoint, then RTDB's REST API, both with the built-in `fetch`.
//
// Usage:
//   node read-install-state.mjs            # one line per person, browser tabs first
//   node read-install-state.mjs --json     # the raw per-device records
//   node read-install-state.mjs --screens  # (2026-10-11) every PERSON, most games played first, with
//                                          # the screen size of each phone they play on (w x h in CSS
//                                          # px, plus the usable page at the last sync). Answers "does
//                                          # anyone who actually plays use a small phone?" Sizes appear
//                                          # only after a phone opens the hub on a build that sends them.

import { firebaseConfig } from './js/firebase-config.js';

async function signInAnonymously(apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anonymous sign-in failed: ${(data.error && data.error.message) || res.status}`);
  return data.idToken;
}

async function fetchRTDB(databaseURL, path, idToken) {
  const res = await fetch(`${databaseURL}/${path}.json?auth=${idToken}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`RTDB read failed (${path}): ${JSON.stringify(data)}`);
  return data;
}

/** Games played on one device record: every game's total, or its own run counter where that is
 *  bigger (the solo games count runs in a sub-counter). An activity measure for ranking people,
 *  nothing more. */
const SUB = { skeeball: ['sk', 'played'], ballrun: ['br', 'runs'], snake: ['sn', 'runs'], hillclimb: ['hc', 'runs'],
  brickblitz: ['bz', 'games'], nutsbolts: ['nb', 'solved'], sudoku: ['sd', 'solved'], golf: ['gf', 'rounds'] };
function playsOf(rec) {
  const games = (rec && rec.stats && rec.stats.games) || {};
  let n = 0;
  for (const [g, r] of Object.entries(games)) {
    if (!r || typeof r !== 'object') continue;
    let t = +((r.total || {}).played) || 0;
    if (SUB[g]) t = Math.max(t, +((r[SUB[g][0]] || {})[SUB[g][1]]) || 0);
    n += t;
  }
  return n;
}
const sizeOf = (s) => (s ? `${s.w}x${s.h}${s.vh && s.vh < s.h - 4 ? ` (page ${s.vw}x${s.vh})` : ''}` : '');

function screensReport(rows) {
  const people = new Map();
  for (const r of rows) {
    const key = r.code !== '-' ? r.code : `name:${r.name}`;
    const p = people.get(key) || { name: r.name, plays: 0, phones: [] };
    p.plays += r.plays;
    p.phones.push(r);
    people.set(key, p);
  }
  const list = [...people.values()].filter((p) => p.plays > 0).sort((a, b) => b.plays - a.plays);
  for (const p of list) {
    const phones = p.phones.filter((r) => r.device || r.screen)
      .map((r) => `${r.device || '?'} ${sizeOf(r.screen) || '(size not sent yet)'}`);
    console.log(`${String(p.plays).padStart(5)}  ${p.name.padEnd(16)} ${[...new Set(phones)].join(' | ') || '(no phone info yet)'}`);
  }
  const known = list.flatMap((p) => p.phones.filter((r) => r.screen && r.plays > 0));
  if (known.length) {
    const narrow = known.reduce((m, r) => (r.screen.w < m.screen.w ? r : m));
    const short = known.reduce((m, r) => (r.screen.h < m.screen.h ? r : m));
    console.log(`\nNarrowest phone that has played: ${narrow.screen.w}px wide (${narrow.name}).`);
    console.log(`Shortest phone that has played:  ${short.screen.h}px tall (${short.name}).`);
  }
  console.log('Sizes are CSS pixels, short side first. "(size not sent yet)" = that phone has not opened the hub since this shipped.');
}

const when = (ms) => (ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16) : '(never synced)');

function main() {
  return (async () => {
    const raw = process.argv.includes('--json');
    if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
      console.error('js/firebase-config.js is not configured - nothing to read.');
      process.exit(1);
    }
    const idToken = await signInAnonymously(firebaseConfig.apiKey);
    const players = await fetchRTDB(firebaseConfig.databaseURL, 'players', idToken) || {};

    const rows = Object.entries(players).map(([id, rec]) => {
      const p = (rec && rec.profile) || {};
      const d = (rec && rec.device) || null;
      return {
        id,
        name: (p.name || '').trim() || '(unnamed)',
        code: p.playerId || '-',
        installed: d ? d.installed : null,
        mode: d ? d.mode : null,
        browser: d ? d.browser : null,
        device: d ? d.device : null,
        build: d ? d.build : null,
        screen: d && d.screen && d.screen.w ? d.screen : null,
        plays: playsOf(rec),
        // The tell for Ana's exact case: asked, and said no.
        dismissedTheSheet: d ? d.a2hsDismissed : null,
        lastSync: (rec && rec.updatedAt) || 0,
      };
    });

    if (raw) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (process.argv.includes('--screens')) { screensReport(rows); return; }

    // Browser tabs first - they are the ones worth a nudge - then unknown, then installed.
    const rank = (r) => (r.installed === false ? 0 : r.installed == null ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    const tabs = rows.filter((r) => r.installed === false);
    const unknown = rows.filter((r) => r.installed == null);
    const app = rows.filter((r) => r.installed === true);

    for (const r of rows) {
      const state = r.installed === true ? 'INSTALLED APP'
        : r.installed === false ? 'browser tab  '
          : '(not seen yet)';
      const extra = [r.build || '(build unknown)', r.device, sizeOf(r.screen), r.browser,
        r.dismissedTheSheet ? 'dismissed the install prompt' : ''].filter(Boolean).join(' · ');
      console.log(`${state}  ${r.name.padEnd(14)} ${r.code.padEnd(6)} ${when(r.lastSync)}  ${extra}`);
    }
    console.log(`\n${app.length} on the installed app, ${tabs.length} in a browser tab, ${unknown.length} not seen since this shipped.`);
    const builds = [...new Set(rows.map((r) => r.build).filter(Boolean))].sort();
    if (builds.length) console.log(`Builds in the wild: ${builds.join(', ')}${builds.length > 1 ? '  <- anyone on an older one is a launch (or a failed install) behind' : ''}`);
    if (unknown.length) {
      console.log('"(not seen yet)" means that device has not opened the hub since this went live -');
      console.log('it is missing data, not a browser tab. Nothing here is retroactive.');
    }
  })();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
