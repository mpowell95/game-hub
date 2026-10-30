// js/admin-ui.js - the ADMIN PAGE: the screen half of js/admin-config.js (which is the data half, and
// carries the reasoning behind every switch). Matt-only, opened from the launcher's Admin button;
// js/hub.js renders that button for nobody else and imports this file lazily, so no other device ever
// downloads it.
//
// ITS OWN PAGE, NOT A POPUP (rebuilt 2026-10-29 from Matt's approved mockup, after "it's fucking
// terrible as it is now. It's impossible for me to do anything quickly"). The old page was ten
// accordion sections of full-width rows: 33 screens with everything open, 259 name chips for seven
// hidden games, and closed headings that said nothing. Now: a full-screen page with four tabs and
// one row style everywhere (name left, value right, a tap goes deeper, like iPhone Settings).
//
//   Now      - only what needs Matt: Spelling Bee and integrity flags (Keep / Void / Undo) and new
//              accounts that cannot play online yet (No / Allow). Keep marks a flag checked
//              (adminConfig/v1/reviewed, read by nothing but this page), so the list empties.
//   Games    - every game in one grid, admin-only first. A game's page: who sees it, its testers,
//              its machines (Skeeball), what is flagged or voided in it, its players. A player's
//              page in that game holds that game's voids and the plays logged since Oct 28.
//   People   - everyone with a code. A person's page: online play, the hidden games they test,
//              every game they have a void in, what they play most.
//   Sent     - popups and Game Hub messages, who has seen or read each.
//   The gear - this phone: bug reports, update check, popups again, device id.
//
// THE LAW (root CLAUDE.md): this page writes nothing but `adminConfig/v1` (through admin-config.js,
// every write verified by re-read) and local preference keys. Every void is an overlay applied when
// numbers are DISPLAYED; nothing here deletes, resets or rewrites any player's stats, profile or
// history. (The old page's "Reset golf stats" button, a leftover from Golf's release that erased this
// phone's golf record, was removed with the rebuild at Matt's request.)
//
// Data: the whole of players/ (the admin page is the one screen that still needs the raw records, to
// void per device), beeFlags + beeAlerts, integrityFlags + integrityAlerts, and, only when a player's
// game page asks, the last 400 entries of that player's playLog/<CODE>.

import { GAMES } from './hub.js';
import { BOARDS, DEFAULT_BOARD, boardById } from '../skeeball/js/boards.js';
import { statsId, holdemBalance, GAMES as STATS_GAMES, ARCHIVED_GAMES } from './game-stats.js';
import { hubIdOf } from './game-stats-ui.js';
import { dayKey } from './arcade-scores.js';
import { aggregatePlayers, buildIdentity, SOLO } from './players-agg.js';
import { ANNOUNCEMENTS, textFor } from './announce.js';
import { HUB_MESSAGES, hubText, readStatusFor } from './hub-messages.js';
import { isHiddenName, isHiddenDeviceId } from './hidden-players.js';
import {
  readCachedConfig, refreshAdminConfig, resolveGameLive, resolveBoardMode, setGameLive,
  resolveGameAllowed, gameAllowList, setGameAllowed, setBoardMode, resolveBoardCorrections,
  setSkeeballCorrection, corrections, resolveHoldemCorrection, setHoldemCorrection,
  resolveOnlineAllowed, onlineOverride, setOnlineAllowed, resolveBeeUndone, setBeeUndone,
  setIntegrityVoided, resolveReviewed, setReviewed,
} from './admin-config.js';
import { correctionFor, snapshotOf, holdemSnapshotOf, VOIDED_MATCHES } from './stats-corrections.js';
import { hitText, gameName, isVoided, activeVoids, HAND_VOIDS } from './integrity.js';
import { flagStands } from './bee-fairplay.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
/** t() with an English fallback: js/strings.js is cache-first, so a new key can be missing for one visit. */
const tx = (key, en, p) => {
  const v = t(key, p);
  return v && v !== key ? v : String(en).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? p[k] : m));
};
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const obj = (v) => (v && typeof v === 'object' ? v : {});
const fmt = (n) => (Math.floor(+n || 0)).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US');
const locale = () => (getLang() === 'es' ? 'es-ES' : 'en-US');
const shortDate = (ms) => { try { return ms ? new Date(ms).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) : ''; } catch { return ''; } };
const ymdDate = (ymd) => { const [y, m, d] = String(ymd || '').split('-').map(Number); return y ? shortDate(new Date(y, m - 1, d).getTime()) : ''; };
const when = (ms) => { try { return new Date(ms).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
function seen(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const w = same(d, now) ? tx('adm_today', 'today') : same(d, y) ? tx('adm_yesterday', 'yesterday') : shortDate(ms);
  return tx('adm_seen', 'seen {when}', { when: w });
}

/** A GAMES entry's title in the active language (the registry holds either a string or {en,es}). */
function titleText(g) {
  const v = g.title;
  return typeof v === 'string' ? v : (v && (v[getLang()] || v.en)) || g.id;
}
const hubGame = (hubId) => GAMES.find((g) => g.id === hubId) || null;
/** The stats id behind a hub tile, or null (Course Creator records nothing). */
const statsOf = (hubId) => STATS_GAMES.find((s) => hubIdOf(s) === hubId) || null;
const titleOfStats = (sid) => { const g = hubGame(hubIdOf(sid)); return g ? titleText(g) : gameName(sid); };
const isLiveGame = (cfg, g) => resolveGameLive(cfg, g.id, !g.devOnly);

// --- icons ----------------------------------------------------------------------------------------
const svg = (d, size = 18, w = 2.4) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  back: svg('<path d="M15 18l-6-6 6-6"/>', 24),
  chev: svg('<path d="M9 6l6 6-6 6"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>', 22, 2.8),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 22),
  minus: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>', 22, 2.2),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', 24, 2),
  now: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 26, 2),
  games: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', 26, 2),
  people: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21c0-3-2-5-5-5.5"/>', 26, 2),
  sent: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>', 26, 2),
};

// --- css ----------------------------------------------------------------------------------------
function ensureCss() {
  if (document.getElementById('adm-css')) return;
  const style = document.createElement('style');
  style.id = 'adm-css';
  style.textContent = `
  html.adm-open, html.adm-open body { overflow: hidden; }
  .adm-page { --a-bg:#f2f4f8; --a-card:#fff; --a-ink:#111826; --a-mut:#5b6678; --a-line:rgba(16,36,58,.12);
    --a-blue:#1462c8; --a-red:#b93d14; --a-bar:#fafbfd; --a-chev:#a3adbb; --a-on:#7a5200; --a-field:#e6e9ef; --a-sheet:#f6f7fa;
    position: fixed; inset: 0; z-index: 400; display: flex; flex-direction: column; background: var(--a-bg); color: var(--a-ink);
    font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  html.gh-dark .adm-page { --a-bg:#0d1422; --a-card:#182132; --a-ink:#eef2f8; --a-mut:#8a97ab; --a-line:rgba(190,214,244,.12);
    --a-blue:#5aa2ff; --a-red:#ff8a65; --a-bar:#111a2a; --a-chev:#56637a; --a-on:#ffce3a; --a-field:#1f2a3d; --a-sheet:#121a29; }
  .adm-page button { font: inherit; color: inherit; touch-action: manipulation; cursor: pointer; }
  .adm-nav { flex: none; box-sizing: content-box; height: 44px; padding: env(safe-area-inset-top, 0px) 16px 0; margin-top: 6px; display: flex; align-items: center; justify-content: space-between; }
  .adm-nb { display: inline-flex; align-items: center; gap: 1px; height: 44px; margin-left: -9px; padding: 0 8px 0 0; background: none; border: 0; color: var(--a-blue) !important; font-size: 17px !important; font-weight: 500; max-width: 70%; }
  .adm-nb span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .adm-ni { width: 44px; height: 44px; margin-right: -10px; display: flex; align-items: center; justify-content: center; background: none; border: 0; color: var(--a-blue) !important; }
  .adm-lt { flex: none; margin: 0 16px 2px; font-size: 32px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; }
  .adm-main { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 0 16px 24px; }
  .adm-gh { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 20px 14px 7px; font-size: 13px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; color: var(--a-mut); }
  .adm-gh b { font-weight: 700; color: var(--a-ink); opacity: .8; }
  .adm-gh .adm-ga { margin-left: auto; font-size: 15px; text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--a-blue); background: none; border: 0; padding: 0; min-height: 32px; }
  .adm-grp { background: var(--a-card); border-radius: 12px; overflow: hidden; }
  .adm-grp.first { margin-top: 10px; }
  .adm-r { position: relative; display: flex; align-items: center; gap: 12px; min-height: 52px; width: 100%; box-sizing: border-box; padding: 0 14px; background: none; border: 0; text-align: left; }
  .adm-r + .adm-r::before { content: ""; position: absolute; top: 0; left: 14px; right: 0; border-top: 1px solid var(--a-line); }
  .adm-r.i + .adm-r.i::before { left: 54px; }
  .adm-em { width: 28px; font-size: 22px; line-height: 1; text-align: center; flex: none; }
  .adm-tx { flex: 1; min-width: 0; padding: 10px 0; }
  .adm-t { font-size: 16px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .adm-s { font-size: 13px; line-height: 1.3; color: var(--a-mut); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .adm-s.wrap { white-space: normal; }
  .adm-v { flex: none; max-width: 55%; font-size: 16px; color: var(--a-mut); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .adm-v.x { color: var(--a-red); }
  .adm-cv { flex: none; display: flex; color: var(--a-chev); margin-right: -4px; }
  .adm-ck { flex: none; display: flex; color: var(--a-blue); width: 22px; }
  .adm-a { flex: none; min-height: 44px; min-width: 44px; padding: 0 6px; background: none; border: 0; font-size: 16px !important; font-weight: 600; color: var(--a-blue) !important; }
  .adm-a.x { color: var(--a-red) !important; }
  .adm-link { color: var(--a-blue); }
  .adm-danger { color: var(--a-red); }
  .adm-code { flex: none; font: 500 13px ui-monospace, Menlo, monospace; color: var(--a-mut); letter-spacing: .03em; }
  .adm-pl { flex: none; width: 28px; display: flex; justify-content: center; color: var(--a-blue); }
  .adm-rm { flex: none; width: 28px; display: flex; justify-content: center; color: var(--a-red); background: none; border: 0; min-height: 44px; padding: 0; }
  .adm-sw { flex: none; width: 51px; height: 31px; border-radius: 16px; border: 0; padding: 2px; box-sizing: border-box; background: #8e98a8; display: flex; justify-content: flex-start; }
  html.gh-dark .adm-sw { background: #39465c; }
  .adm-sw::after { content: ""; width: 27px; height: 27px; border-radius: 14px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
  .adm-sw[aria-pressed="true"] { background: #1769d4 !important; justify-content: flex-end; }
  .adm-empty { margin: 10px 14px; font-size: 15px; color: var(--a-mut); }
  .adm-search { display: flex; align-items: center; gap: 8px; min-height: 40px; margin-top: 8px; padding: 0 10px; border-radius: 10px; background: var(--a-field); color: var(--a-mut); }
  .adm-search input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; color: var(--a-ink); font: 400 17px -apple-system, system-ui, sans-serif; user-select: text; -webkit-user-select: text; }
  .adm-search input::placeholder { color: var(--a-mut); }
  .adm-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .adm-tile { position: relative; height: 44px; box-sizing: border-box; border-radius: 10px; background: var(--a-card); border: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 5px; font-size: 12.5px !important; font-weight: 500; line-height: 1.15; }
  .adm-tile.hid { background: transparent; border: 1.5px dashed #c99a00; }
  html.gh-dark .adm-tile.hid { border-color: #ffce3a; }
  .adm-bdg { position: absolute; top: -6px; right: -4px; height: 18px; min-width: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: #ffce3a; color: #14110a; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
  .adm-bdg.f { background: #E0532F; color: #fff; border-radius: 4px; }
  .adm-hero { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 16px 4px; }
  .adm-av { width: 76px; height: 76px; border-radius: 38px; background: var(--a-card); display: flex; align-items: center; justify-content: center; font-size: 42px; line-height: 1; }
  .adm-hn { margin: 4px 0 0; font-size: 24px; font-weight: 800; text-align: center; }
  .adm-hs { font-size: 14px; color: var(--a-mut); }
  .adm-hs code { font: 500 14px ui-monospace, Menlo, monospace; letter-spacing: .03em; }
  .adm-tabbar { flex: none; display: flex; padding-bottom: env(safe-area-inset-bottom, 0px); background: var(--a-bar); border-top: 1px solid var(--a-line); }
  .adm-tab { flex: 1; position: relative; height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 11px !important; font-weight: 600; color: var(--a-mut) !important; background: none; border: 0; padding: 0; }
  .adm-tab[aria-current="page"] { color: var(--a-on) !important; font-weight: 800; }
  .adm-tab[aria-current="page"]::before { content: ""; position: absolute; top: 0; left: 30%; right: 30%; height: 3px; border-radius: 0 0 3px 3px; background: #ffce3a; }
  .adm-tab .adm-bdg { top: 3px; left: calc(50% + 6px); right: auto; background: #E0532F; color: #fff; }
  .adm-toast { position: absolute; left: 16px; right: 16px; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); z-index: 3; padding: 12px 14px; border-radius: 12px;
    background: #1f2a3d; color: #eef2f8; font-size: 15px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,.4); pointer-events: none; opacity: 0; transform: translateY(8px); transition: opacity .15s, transform .15s; }
  .adm-toast.on { opacity: 1; transform: none; }
  .adm-toast.err { background: #7a2410; }
  .adm-dim { position: absolute; inset: 0; z-index: 4; background: rgba(3,7,14,.55); }
  .adm-sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; max-height: calc(100% - env(safe-area-inset-top, 0px) - 20px); display: flex; flex-direction: column;
    background: var(--a-sheet); border-radius: 14px 14px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
  .adm-sheet.tall { top: calc(env(safe-area-inset-top, 0px) + 20px); }
  .adm-sh { flex: none; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
  .adm-sh b { font-size: 17px; }
  .adm-sh button { min-height: 44px; background: none; border: 0; color: var(--a-blue) !important; font-size: 17px !important; font-weight: 700; padding: 0; }
  .adm-sbody { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 16px 20px; }
  .adm-sbody .adm-search { margin: 0 0 10px; }
  .adm-pending { opacity: .5; }
  .adm-busy .adm-main, .adm-busy .adm-sbody { pointer-events: none; }`;
  document.head.appendChild(style);
}

// --- state ----------------------------------------------------------------------------------------

let _host = null;
let _onKey = null;
let _busy = false;
/** Every synced device record. null while the first read is on its way, {} offline. */
let _players = null;
let _offline = false;
let _bee = {};
let _integ = {};
let _agg = null;            // per render: aggregatePlayers with every display correction applied
let _aggRaw = null;         // per render: the same without them (what is on the phones)
let _ident = null;
let _acts = [];             // per render: every tappable thing's closure, by data-a index
const TAB_KEY = 'gamehub.adminTab.v1';
let _tab = 'now';
let _stack = [];            // pushed views inside the current tab
let _sheet = null;          // { k: 'tools' } | { k: 'pick', hub }
let _edit = false;          // testers list in remove mode
let _toastTimer = 0;
let _backRoot = null;      // the root back button's word: 'Profile' when opened from the profile page
let _tapped = null;         // the element of the last tap, dimmed while its write runs
const _filters = new Map(); // search box selector -> what is typed, kept across repaints
const _scroll = new Map();  // view key -> scrollTop
const _plays = new Map();   // player code -> playLog entries (newest first) | 'loading' | 'error'

const loading = () => _players === null;
const act = (fn) => { _acts.push(fn); return `data-a="${_acts.length - 1}"`; };

async function readNodes(paths) {
  try {
    const { getStatsApp } = await import('./firebase-boot.js');
    const boot = await getStatsApp();
    if (!boot) return {};
    const get = async (p) => { try { const s = await boot.api.get(boot.api.ref(boot.db, p)); return s && s.exists() ? s.val() : {}; } catch { return {}; } };
    const vals = await Promise.all(paths.map(get));
    return Object.fromEntries(paths.map((p, i) => [p, vals[i]]));
  } catch { return {}; }
}
/** Spelling Bee's server flags and missing-log alerts (functions/bee.js). {flags, alerts}, {} offline. */
async function readBee() {
  const r = await readNodes(['beeFlags', 'beeAlerts']);
  return { flags: r.beeFlags || {}, alerts: r.beeAlerts || {} };
}
/** Every game's integrity flags and match alerts (functions/integrity.js). {flags, alerts}, {} offline. */
async function readIntegrity() {
  const r = await readNodes(['integrityFlags', 'integrityAlerts']);
  return { flags: r.integrityFlags || {}, alerts: r.integrityAlerts || {} };
}
async function readPlayers() {
  try { return await (await import('./stats-net.js')).readPlayersOnce({ fresh: true }); } catch { return {}; }
}
/** The last 400 play-log entries of one code (admin-read), newest first. Only what a player's game page asks for. */
async function readPlays(code) {
  _plays.set(code, 'loading');
  render();
  try {
    const { getStatsApp } = await import('./firebase-boot.js');
    const boot = await getStatsApp();
    if (!boot) throw new Error('offline');
    const { api, db } = boot;
    const snap = await api.get(api.query(api.ref(db, `playLog/${code}`), api.orderByKey(), api.limitToLast(400)));
    const rows = [];
    if (snap && snap.exists()) snap.forEach((c) => { rows.push(Object.assign({ id: c.key }, c.val())); });
    rows.sort((a, b) => (+b.t || 0) - (+a.t || 0));
    _plays.set(code, rows);
  } catch (err) {
    console.error('[admin] play log read failed', err);
    _plays.set(code, 'error');
  }
  render();
}

// --- people ---------------------------------------------------------------------------------------

function allCorrections(cfg) {
  return Object.assign({}, corrections(), { integrity: activeVoids((_integ && _integ.flags) || {}, cfg) });
}
/** Device ids per person key. */
function idsOf(key) {
  const out = [];
  for (const id of Object.keys(_players || {})) if (_ident.keyFor(((_players[id] || {}).profile) || {}, id) === key) out.push(id);
  return out;
}
const personByKey = (key) => (_agg || []).find((g) => g.key === key) || null;
const rawByKey = (key) => (_aggRaw || []).find((g) => g.key === key) || null;
/** One row per PERSON with a player code, A-Z: the leaderboard's people. */
function codedPeople() {
  const out = new Map();
  for (const g of _agg || []) {
    const code = (g.playerId || '').trim().toUpperCase();
    if (!code || isHiddenName(g.name)) continue;
    if (!out.has(code)) out.set(code, g);
  }
  return [...out.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
/** One row per PLAYER CODE, newest record's name (two codes of one person are two accounts). */
function codesSeen() {
  const out = new Map();
  for (const rec of Object.values(_players || {})) {
    const p = (rec && rec.profile) || {};
    const code = String(p.playerId || '').trim().toUpperCase();
    if (!code) continue;
    const at = Number(rec.updatedAt) || 0;
    const games = obj((rec.stats || {}).games);
    let plays = 0; const played = new Set();
    for (const [gid, g] of Object.entries(games)) { const n = +(obj(obj(g).total).played) || 0; if (n) { plays += n; played.add(gid); } }
    const cur = out.get(code);
    if (!cur) out.set(code, { code, name: String(p.name || '').trim() || code, emoji: p.emoji || '', at, plays, games: played });
    else {
      cur.plays += plays; for (const x of played) cur.games.add(x);
      if (at >= cur.at) Object.assign(cur, { name: String(p.name || '').trim() || code, emoji: p.emoji || cur.emoji, at });
    }
  }
  return out;
}
const whoHTML = (emoji, name) => `<span class="adm-em">${esc(emoji || '🙂')}</span>`;
const personOfCode = (code) => (_agg || []).find((g) => (g.playerId || '').toUpperCase() === code) || null;
const playsIn = (g, sid) => +(obj(obj(obj(g && g.games)[sid]).total).played) || 0;
/** The games a person has played, most first. ARCHIVED games (Pinball, old Pool, Pipes) stay stored, untouched, and
 *  out of every list, as on the leaderboard. */
const gamesPlayed = (p) => Object.keys(obj(p && p.games)).filter((sid) => !ARCHIVED_GAMES.includes(sid) && playsIn(p, sid) > 0)
  .sort((a, b) => playsIn(p, b) - playsIn(p, a));

// --- the flags ------------------------------------------------------------------------------------

const langOf = (bk) => (String(bk).startsWith('es-') ? 'ES' : 'EN');
/** Every Spelling Bee flag: {bk, code, f, stands, voided, at}. */
function beeFlags(cfg) {
  const out = [];
  for (const [bk, byCode] of Object.entries(obj(_bee.flags))) {
    for (const [code, f] of Object.entries(obj(byCode))) {
      const stands = flagStands(f);
      out.push({ bk, code, f: obj(f), stands, voided: stands && !resolveBeeUndone(cfg, bk, code), at: Number(obj(f).at) || 0 });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
/** Every integrity flag on a record's game: {id, gid, list, voided, at, hand}. */
function integFlags(cfg) {
  const flags = obj(_integ.flags);
  const keys = new Set();
  for (const [id, games] of Object.entries(flags)) for (const gid of Object.keys(obj(games))) keys.add(`${id}|${gid}`);
  for (const [id, games] of Object.entries(HAND_VOIDS)) for (const gid of Object.keys(games)) keys.add(`${id}|${gid}`);
  for (const [id, games] of Object.entries(obj(obj(cfg.integrity).void))) for (const gid of Object.keys(obj(games))) keys.add(`${id}|${gid}`);
  const out = [];
  for (const key of keys) {
    const [id, gid] = key.split('|');
    const list = Object.entries(obj(obj(flags[id])[gid])).map(([rule, f]) => Object.assign({ rule }, obj(f)));
    const at = Math.max(0, ...list.map((f) => Number(f.when) || 0));
    const hand = !!obj(HAND_VOIDS[id])[gid];
    out.push({ id, gid, list, voided: isVoided(flags, cfg, id, gid), at, hand });
  }
  return out.sort((a, b) => b.at - a.at);
}
const nodeGame = (node) => (node === 'hoops' ? 'hoops4' : node);
/** The online-match alerts: {key, rk, a, gid, at}. */
function matchAlerts() {
  const out = [];
  for (const [key, byRule] of Object.entries(obj(_integ.alerts))) {
    for (const [rk, a] of Object.entries(obj(byRule))) out.push({ key, rk, a: obj(a), gid: nodeGame(String(key).split('~')[0]), at: Number(obj(a).when) || 0 });
  }
  return out.sort((a, b) => b.at - a.at);
}
function recName(id, fallback) {
  const rec = obj(obj((_players || {})[id]).profile);
  return rec.name || fallback || id;
}
function recEmoji(id) { return obj(obj((_players || {})[id]).profile).emoji || ''; }

/** Write, then mark the flag checked: a decision made is a flag dealt with. */
const andReview = (write, kind, a, b) => async () => {
  const r = await write();
  if (!r || !r.ok) return r;
  return setReviewed(kind, a, b, true);
};

/** Everything on the Now tab: [{group, rowHTML}] built from the flags Matt has not checked yet. */
function nowRows(cfg) {
  const rows = { flags: [], online: [] };
  const codes = codesSeen();
  for (const b of beeFlags(cfg)) {
    if (!b.stands || resolveReviewed(cfg, 'bee', b.bk, b.code)) continue;
    const p = codes.get(b.code) || {};
    rows.flags.push(row({
      icon: whoHTML(p.emoji), title: p.name || b.f.name || b.code,
      sub: `${titleOfStats('spellingbee')} · ${shortDate(b.at)} ${langOf(b.bk)} · ${b.voided ? tx('adm_voided', 'Voided') : tx('adm_counts', 'Counts')}`,
      sub2: b.f.summary || '',
      acts: [
        btn(tx('adm_keep', 'Keep'), () => setReviewed('bee', b.bk, b.code, true)),
        b.voided ? btn(tx('adm_undo', 'Undo'), andReview(() => setBeeUndone(b.bk, b.code, true), 'bee', b.bk, b.code))
          : btn(tx('adm_void', 'Void'), andReview(() => setBeeUndone(b.bk, b.code, false), 'bee', b.bk, b.code), 'x'),
      ],
    }));
  }
  for (const f of integFlags(cfg)) {
    if (f.hand || !f.list.length || resolveReviewed(cfg, 'iv', f.id, f.gid)) continue;
    const f0 = f.list[0];
    rows.flags.push(row({
      icon: whoHTML(recEmoji(f.id)), title: recName(f.id, f0.name),
      sub: `${titleOfStats(f.gid)}${f.at ? ` · ${shortDate(f.at)}` : ''} · ${f.voided ? tx('adm_voided', 'Voided') : tx('adm_counts', 'Counts')}`,
      sub2: f.list.map((x) => hitText(x)).join('; '),
      acts: [
        btn(tx('adm_keep', 'Keep'), () => setReviewed('iv', f.id, f.gid, true)),
        f.voided ? btn(tx('adm_undo', 'Undo'), andReview(() => setIntegrityVoided(f.id, f.gid, false), 'iv', f.id, f.gid))
          : btn(tx('adm_void', 'Void'), andReview(() => setIntegrityVoided(f.id, f.gid, true), 'iv', f.id, f.gid), 'x'),
      ],
    }));
  }
  for (const m of matchAlerts()) {
    if (resolveReviewed(cfg, 'ma', m.key, m.rk)) continue;
    rows.flags.push(row({
      icon: whoHTML(''), title: m.a.name || '',
      sub: `${titleOfStats(m.gid)}${m.at ? ` · ${shortDate(m.at)}` : ''}`,
      sub2: hitText({ rule: String(m.rk).split('~')[0], v: m.a.v, lim: m.a.lim }),
      acts: [btn(tx('adm_keep', 'Keep'), () => setReviewed('ma', m.key, m.rk, true))],
    }));
  }
  const newest = [...codes.values()].sort((a, b) => b.at - a.at);
  for (const p of newest) {
    if (resolveOnlineAllowed(cfg, p.code) || onlineOverride(cfg, p.code) !== null) continue;
    rows.online.push(row({
      icon: whoHTML(p.emoji), title: p.name,
      sub: [tx('adm_n_plays', '{n} plays', { n: fmt(p.plays) }), p.games.size === 1 ? tx('adm_1_game', '1 game') : p.games.size ? tx('adm_n_games', '{n} games', { n: p.games.size }) : '', seen(p.at)].filter(Boolean).join(' · '),
      acts: [
        btn(tx('adm_no', 'No'), () => setOnlineAllowed(p.code, false), 'x'),
        btn(tx('adm_allow', 'Allow'), () => setOnlineAllowed(p.code, true)),
      ],
    }));
  }
  return rows;
}
const nowCount = (cfg) => { if (loading()) return 0; const r = nowRows(cfg); return r.flags.length + r.online.length; };

// --- row builders -----------------------------------------------------------------------------------

/** A text button that runs a verified write. */
function btn(label, write, cls = '') {
  return `<button type="button" class="adm-a ${cls}" ${act(() => save(write))}>${esc(label)}</button>`;
}
/** The one row: [icon] title / sub / sub2 [value] [actions] [chevron]. `go` makes the whole row a button. */
function row({ icon = '', title = '', titleHTML = '', sub = '', sub2 = '', value = '', vcls = '', acts = [], go = null, tap = null, check = null, cls = '', q = '', extra = '' }) {
  const fn = go || tap;
  const tag = fn ? 'button' : 'div';
  const a = fn ? act(fn) : '';
  return `<${tag}${tag === 'button' ? ' type="button"' : ''} class="adm-r${icon ? ' i' : ''} ${cls}" ${a}${q ? ` data-q="${esc(q.toLowerCase())}"` : ''}${check !== null ? ` aria-pressed="${!!check}"` : ''}>
    ${extra}${icon}<div class="adm-tx"><div class="adm-t">${titleHTML || esc(title)}</div>${sub ? `<div class="adm-s">${esc(sub)}</div>` : ''}${sub2 ? `<div class="adm-s">${esc(sub2)}</div>` : ''}</div>
    ${value !== '' ? `<span class="adm-v ${vcls}">${esc(value)}</span>` : ''}${acts.join('')}
    ${check !== null ? `<span class="adm-ck">${check ? I.check : ''}</span>` : ''}${go ? `<span class="adm-cv">${I.chev}</span>` : ''}
  </${tag}>`;
}
const gh = (label, right = '', action = '') => `<div class="adm-gh"><span>${esc(label)}${right !== '' ? ` <b>${esc(right)}</b>` : ''}</span>${action}</div>`;
const grp = (rows, first = false) => (rows.length ? `<div class="adm-grp${first ? ' first' : ''}">${rows.join('')}</div>` : '');
const link = (label, tap, acts = []) => row({ titleHTML: `<span class="adm-link">${esc(label)}</span>`, tap, acts });
const more = (label, go) => row({ titleHTML: `<span class="adm-link">${esc(label)}</span>`, go });

// --- navigation --------------------------------------------------------------------------------------

const TABS = [
  { id: 'now', icon: I.now, label: () => tx('adm_tab_now', 'Now') },
  { id: 'games', icon: I.games, label: () => tx('adm_tab_games', 'Games') },
  { id: 'people', icon: I.people, label: () => tx('adm_tab_people', 'People') },
  { id: 'sent', icon: I.sent, label: () => tx('adm_tab_sent', 'Sent') },
];
const viewKey = (v) => JSON.stringify(v || { tab: _tab });
function push(v) { _scroll.set(viewKey(top()), scrollTop()); _stack.push(v); _edit = false; render({ fresh: true }); }
function back() {
  if (_sheet) { _sheet = null; render(); return; }
  if (_stack.length) { _stack.pop(); _edit = false; render(); return; }
  closeAdmin();
}
const top = () => (_stack.length ? _stack[_stack.length - 1] : null);
const scrollTop = () => { const m = _host && _host.querySelector('.adm-main'); return m ? m.scrollTop : 0; };
function setTab(id) {
  if (id === _tab && !_stack.length) return;
  _scroll.set(viewKey(top()), scrollTop());
  _tab = id; _stack = []; _edit = false;
  try { localStorage.setItem(TAB_KEY, id); } catch { /* memory only */ }
  render();
}

function closeAdmin() {
  if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
  if (_host) { _host.remove(); _host = null; }
  document.documentElement.classList.remove('adm-open');
}

/** Open the admin page. js/hub.js gates the button on isAdmin(); this is a screen, not a lock. */
export async function openAdmin(opts = {}) {
  ensureCss();
  _backRoot = opts && typeof opts.backLabel === 'string' && opts.backLabel ? opts.backLabel : null;
  closeAdmin();
  const host = document.createElement('div');
  host.className = 'adm-page';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', tx('adm_title', 'Admin controls'));
  document.body.appendChild(host);
  document.documentElement.classList.add('adm-open');
  _host = host;
  try { const s = localStorage.getItem(TAB_KEY); if (TABS.some((x) => x.id === s)) _tab = s; } catch { /* default */ }
  _stack = []; _sheet = null; _edit = false;
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  _onKey = (e) => { if (e.key === 'Escape' && !_busy) back(); };
  document.addEventListener('keydown', _onKey);
  // Paint at once from the cached config; the people-shaped parts fill in when the reads land.
  _players = null; _offline = false;
  render();
  const [fresh, players, bee, integ] = await Promise.all([refreshAdminConfig(), readPlayers(), readBee(), readIntegrity()]);
  _players = players || {};
  _bee = bee || {};
  _integ = integ || {};
  _offline = !fresh;
  if (!_host || _busy) return;           // a save in flight repaints when it finishes
  render();
  if (_offline) toast(tx('adm_offline', 'Offline: last known settings. Changes need a connection.'), true);
}

function onClick(e) {
  const el = e.target.closest('[data-a]');
  if (!el || !_host || !_host.contains(el)) return;
  if (_busy) return;
  const fn = _acts[+el.dataset.a];
  if (fn) { e.preventDefault(); _tapped = el; fn(el); }
}
function onInput(e) {
  const box = e.target.closest('[data-filter]');
  if (!box) return;
  _filters.set(box.dataset.filter, String(e.target.value || ''));
  applyFilter(box.dataset.filter);
}
function applyFilter(sel) {
  const q = String(_filters.get(sel) || '').trim().toLowerCase();
  const root = _host && _host.querySelector(sel);
  if (!root) return;
  root.querySelectorAll('[data-q]').forEach((r) => { r.style.display = !q || r.dataset.q.includes(q) ? '' : 'none'; });
}

/** Run one verified write: the tapped row dims, the page repaints from the re-read, a toast says how it went. */
async function save(write, el) {
  if (_busy) return;
  _busy = true;
  _host.classList.add('adm-busy');
  const rowEl = _tapped && _tapped.closest ? _tapped.closest('.adm-r') : null;
  if (rowEl) rowEl.classList.add('adm-pending');
  let res;
  try { res = await write(); } catch (err) { res = { ok: false, error: String((err && err.message) || err) }; }
  _busy = false;
  if (!_host) return;
  _host.classList.remove('adm-busy');
  render();
  if (res && res.ok) toast(tx('adm_saved', 'Saved.'));
  else toast(tx('adm_save_failed', "Didn't save: {why}", { why: (res && res.error) || '?' }), true);
}

function toast(text, err = false) {
  const el = _host && _host.querySelector('.adm-toast');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', !!err);
  el.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { if (el) el.classList.remove('on'); }, err ? 6000 : 1800);
}

// --- render -----------------------------------------------------------------------------------------

function render({ fresh = false } = {}) {
  if (!_host) return;
  const cfg = readCachedConfig();
  const v = top();
  const oldKey = _host.dataset.view;
  const keep = !fresh && oldKey === viewKey(v) ? scrollTop() : null;
  _acts = [];
  _ident = _players ? buildIdentity(_players) : null;
  _agg = _players ? aggregatePlayers(_players, allCorrections(cfg)) : [];
  _aggRaw = _players ? aggregatePlayers(_players) : [];
  const view = renderView(cfg, v);
  const backLabel = !_stack.length ? (_backRoot || tx('adm_back_hub', 'Game Hub'))
    : _stack.length === 1 ? (TABS.find((x) => x.id === _tab) || TABS[0]).label() : (_stack[_stack.length - 2].title || '');
  if (v) v.title = view.title;
  const count = nowCount(cfg);
  const toastEl = _host.querySelector('.adm-toast');
  const toastState = toastEl ? { text: toastEl.textContent, cls: toastEl.className } : null;
  _host.innerHTML = `
    <div class="adm-nav">
      <button type="button" class="adm-nb" ${act(() => back())} aria-label="${esc(backLabel)}">${I.back}<span>${esc(backLabel)}</span></button>
      ${!_stack.length ? `<button type="button" class="adm-ni" ${act(() => { _sheet = { k: 'tools' }; render(); })} aria-label="${esc(tx('adm_this_phone', 'This phone'))}">${I.gear}</button>` : ''}
    </div>
    ${view.hero || `<h1 class="adm-lt">${esc(view.title)}</h1>`}
    <div class="adm-main">${view.body}</div>
    <nav class="adm-tabbar">${TABS.map((x) => `<button type="button" class="adm-tab" ${act(() => setTab(x.id))}${x.id === _tab ? ' aria-current="page"' : ''}>${x.icon}${esc(x.label())}${x.id === 'now' && count ? `<span class="adm-bdg">${count}</span>` : ''}</button>`).join('')}</nav>
    <div class="adm-toast" role="status" aria-live="polite"></div>
    ${_sheet ? renderSheet(cfg) : ''}`;
  _host.dataset.view = viewKey(v);
  _host.querySelectorAll('[data-filter]').forEach((box) => {
    const inp = box.querySelector('input');
    if (inp && _filters.has(box.dataset.filter)) { inp.value = _filters.get(box.dataset.filter); applyFilter(box.dataset.filter); }
  });
  if (toastState) { const el = _host.querySelector('.adm-toast'); el.textContent = toastState.text; el.className = toastState.cls; }
  const main = _host.querySelector('.adm-main');
  main.scrollTop = keep != null ? keep : (fresh ? 0 : (_scroll.get(viewKey(v)) || 0));
}

function renderView(cfg, v) {
  if (!v) {
    if (_tab === 'games') return gamesTab(cfg);
    if (_tab === 'people') return peopleTab(cfg);
    if (_tab === 'sent') return sentTab();
    return nowTab(cfg);
  }
  switch (v.k) {
    case 'game': return gamePage(cfg, v.hub);
    case 'who': return whoPage(cfg, v.hub);
    case 'machine': return machinePage(cfg, v.board);
    case 'players': return playersPage(cfg, v.sid);
    case 'gplayer': return gamePlayerPage(cfg, v.sid, v.key);
    case 'person': return personPage(cfg, v.key);
    case 'testerfor': return testerForPage(cfg, v.key);
    case 'allgames': return allGamesPage(cfg, v.key);
    case 'ann': return annPage(v.id);
    case 'hm': return hmPage(v.id);
    default: return nowTab(cfg);
  }
}
const waitBody = () => `<p class="adm-empty">${esc(tx('adm_loading', 'Loading...'))}</p>`;

// --- Now ----------------------------------------------------------------------------------------------

function nowTab(cfg) {
  const title = tx('adm_tab_now', 'Now');
  if (loading()) return { title, body: waitBody() };
  const r = nowRows(cfg);
  if (!r.flags.length && !r.online.length) return { title, body: `<p class="adm-empty">${esc(tx('adm_now_empty', 'Nothing needs you.'))}</p>` };
  return { title, body: (r.flags.length ? gh(tx('adm_flags', 'Flags'), r.flags.length) + grp(r.flags) : '')
    + (r.online.length ? gh(tx('adm_play_online_q', 'Play online?'), r.online.length) + grp(r.online) : '') };
}

// --- Games --------------------------------------------------------------------------------------------

/** Open flags per stats id (what Now lists), for the tiles' badges. */
function openFlagsBySid(cfg) {
  const n = {};
  if (loading()) return n;
  const add = (sid) => { n[sid] = (n[sid] || 0) + 1; };
  for (const b of beeFlags(cfg)) if (b.stands && !resolveReviewed(cfg, 'bee', b.bk, b.code)) add('spellingbee');
  for (const f of integFlags(cfg)) if (!f.hand && f.list.length && !resolveReviewed(cfg, 'iv', f.id, f.gid)) add(f.gid);
  for (const m of matchAlerts()) if (!resolveReviewed(cfg, 'ma', m.key, m.rk)) add(m.gid);
  return n;
}
function gamesTab(cfg) {
  const all = GAMES.slice().sort((a, b) => titleText(a).localeCompare(titleText(b)));
  const flags = openFlagsBySid(cfg);
  const tile = (g, hid) => {
    const sid = statsOf(g.id);
    const testers = hid ? gameAllowList(cfg, g.id).length : 0;
    const f = sid ? flags[sid] || 0 : 0;
    return `<button type="button" class="adm-tile${hid ? ' hid' : ''}" ${act(() => push({ k: 'game', hub: g.id }))}>${esc(titleText(g))}${
      f ? `<span class="adm-bdg f" aria-label="${f} flags">${f}</span>` : testers ? `<span class="adm-bdg" aria-label="${testers} testers">${testers}</span>` : ''}</button>`;
  };
  const hidden = all.filter((g) => !isLiveGame(cfg, g));
  const live = all.filter((g) => isLiveGame(cfg, g));
  return { title: tx('adm_tab_games', 'Games'), body:
    (hidden.length ? gh(tx('adm_testing', 'Admin only'), hidden.length) + `<div class="adm-grid">${hidden.map((g) => tile(g, true)).join('')}</div>` : '')
    + gh(tx('adm_live', 'Live'), live.length) + `<div class="adm-grid">${live.map((g) => tile(g, false)).join('')}</div>` };
}

function whoValue(cfg, g) { return isLiveGame(cfg, g) ? tx('adm_everyone', 'Everyone') : tx('adm_testers_opt', 'Admin and testers'); }

function gamePage(cfg, hubId) {
  const g = hubGame(hubId);
  if (!g) return { title: hubId, body: '' };
  const sid = statsOf(hubId);
  const live = isLiveGame(cfg, g);
  let body = grp([row({ title: (tx('adm_who', 'Who sees it')), value: whoValue(cfg, g), go: () => push({ k: 'who', hub: hubId }) })], true);
  if (!live) body += testersHTML(cfg, g);
  if (hubId === 'skeeball') {
    body += gh(tx('adm_machines', 'Machines'), BOARDS.length) + grp(BOARDS.map((b) => {
      if (b.id === DEFAULT_BOARD) return row({ title: (b.name), value: tx('adm_machine_first', 'Always open') });
      const mode = resolveBoardMode(cfg, b.id, !!b.adminOnly);
      return row({ title: (b.name), value: modeLabel(mode), go: () => push({ k: 'machine', board: b.id }) });
    }));
  }
  if (!sid) return { title: titleText(g), body };
  if (loading()) return { title: titleText(g), body: body + waitBody() };
  const flagged = flaggedRows(cfg, sid);
  if (flagged.length) body += gh(tx('adm_flagged', 'Flagged'), flagged.length) + grp(flagged);
  const alerts = alertRows(cfg, sid);
  if (alerts.length) body += gh(tx('adm_alerts', 'Alerts'), alerts.length) + grp(alerts);
  const players = (_agg || []).filter((p) => playsIn(p, sid) > 0 && !isHiddenName(p.name)).sort((a, b) => playsIn(b, sid) - playsIn(a, sid));
  if (players.length) {
    body += gh(tx('adm_players', 'Players'), players.length)
      + grp(players.slice(0, 6).map((p) => playerInGameRow(cfg, p, sid))
        .concat(players.length > 6 ? [more(tx('adm_all_players', 'All {n} players', { n: players.length }), () => push({ k: 'players', sid }))] : []));
  }
  return { title: titleText(g), body };
}
const modeLabel = (m) => (m === 'open' ? tx('adm_mode_open', 'Open') : m === 'testing' ? tx('adm_mode_testing', 'Testing') : tx('adm_mode_unlockable', 'Unlockable'));

function playerInGameRow(cfg, p, sid) {
  const g = obj(obj(p.games)[sid]);
  const played = playsIn(p, sid), won = +(obj(g.total).won) || 0;
  const sub = SOLO.has(sid) ? tx('adm_played', '{p} played', { p: fmt(played) }) : tx('adm_played_won', '{p} played · {w} won', { p: fmt(played), w: fmt(won) });
  const v = voidsOf(cfg, p.key)[sid];
  return row({ icon: whoHTML(p.emoji), title: (p.name), sub, value: v ? v.label : '', vcls: 'x', go: () => push({ k: 'gplayer', sid, key: p.key }) });
}
function playersPage(cfg, sid) {
  const title = tx('adm_players', 'Players');
  if (loading()) return { title, body: waitBody() };
  const players = (_agg || []).filter((p) => playsIn(p, sid) > 0 && !isHiddenName(p.name)).sort((a, b) => playsIn(b, sid) - playsIn(a, sid));
  return { title: `${titleOfStats(sid)}: ${title}`, body: grp(players.map((p) => playerInGameRow(cfg, p, sid)), true) };
}

/** The Testers group of a hidden game: picked people, Edit to remove, Add testers to pick. */
function testersHTML(cfg, g) {
  const codes = gameAllowList(cfg, g.id);
  const people = codesSeen();
  const rows = codes.map((c) => {
    const p = people.get(c) || { name: c, emoji: '' };
    return row({ icon: whoHTML(p.emoji), title: (p.name), value: '', acts: [`<span class="adm-code">${esc(c)}</span>`],
      extra: _edit ? `<button type="button" class="adm-rm" ${act(() => save(() => setGameAllowed(g.id, c, false)))} aria-label="${esc(tx('adm_remove', 'Remove'))}">${I.minus}</button>` : '' });
  });
  rows.push(row({ icon: `<span class="adm-pl">${I.plus}</span>`, titleHTML: `<span class="adm-link">${esc(tx('adm_add_testers', 'Add testers'))}</span>`, go: () => { _filters.delete('#adm-pick'); _sheet = { k: 'pick', hub: g.id }; render(); } }));
  const edit = codes.length ? `<button type="button" class="adm-ga" ${act(() => { _edit = !_edit; render(); })}>${esc(_edit ? tx('adm_done', 'Done') : tx('adm_edit', 'Edit'))}</button>` : '';
  return gh(tx('adm_testers', 'Testers'), codes.length, edit) + grp(rows);
}

function whoPage(cfg, hubId) {
  const g = hubGame(hubId);
  const live = g ? isLiveGame(cfg, g) : true;
  return { title: tx('adm_who', 'Who sees it'), body: grp([
    row({ title: tx('adm_everyone', 'Everyone'), check: live, tap: () => (live ? back() : save(() => setGameLive(hubId, true))) }),
    row({ title: tx('adm_testers_opt', 'Admin and testers'), check: !live, tap: () => (!live ? back() : save(() => setGameLive(hubId, false))) }),
  ], true) };
}
function machinePage(cfg, boardId) {
  const b = boardById(boardId);
  const mode = resolveBoardMode(cfg, boardId, !!(b && b.adminOnly));
  const opt = (m) => row({ title: modeLabel(m), check: mode === m, tap: () => (mode === m ? back() : save(() => setBoardMode(boardId, m))) });
  return { title: b ? b.name : boardId, body: grp(['open', 'unlockable', 'testing'].map(opt), true) };
}

/** Everything voided or flagged in one game, each with its one action. */
function flaggedRows(cfg, sid) {
  const rows = [];
  const codes = codesSeen();
  if (sid === 'spellingbee') {
    for (const b of beeFlags(cfg)) {
      const p = codes.get(b.code) || {};
      rows.push(row({ icon: whoHTML(p.emoji), title: (p.name || b.f.name || b.code),
        sub: `${shortDate(b.at)} ${langOf(b.bk)} · ${b.voided ? tx('adm_voided', 'Voided') : b.stands ? tx('adm_counts', 'Counts') : tx('adm_retired', 'Counts · rule retired')}`,
        sub2: b.f.summary || '',
        acts: !b.stands ? [] : [b.voided ? btn(tx('adm_undo', 'Undo'), () => setBeeUndone(b.bk, b.code, true)) : btn(tx('adm_void', 'Void'), () => setBeeUndone(b.bk, b.code, false), 'x')] }));
    }
    for (const v of Object.values(VOIDED_MATCHES.spellingbee || {})) {
      const p = codes.get(v.winner) || {};
      rows.push(row({ icon: whoHTML(p.emoji), title: (p.name || v.winner), sub: `${ymdDate(v.day)} · ${tx('adm_voided', 'Voided')} · ${tx('adm_bee_manual', 'by hand')}` }));
    }
  }
  for (const f of integFlags(cfg)) {
    if (f.gid !== sid) continue;
    rows.push(row({ icon: whoHTML(recEmoji(f.id)), title: (recName(f.id, (f.list[0] || {}).name)),
      sub: `${f.at ? `${shortDate(f.at)} · ` : ''}${f.voided ? tx('adm_voided', 'Voided') : tx('adm_counts', 'Counts')}${f.hand ? ` · ${tx('adm_bee_manual', 'by hand')}` : ''}`,
      sub2: f.list.length ? f.list.map((x) => hitText(x)).join('; ') : String(obj(HAND_VOIDS[f.id])[sid] || ''),
      acts: [f.voided ? btn(tx('adm_undo', 'Undo'), () => setIntegrityVoided(f.id, sid, false)) : btn(tx('adm_void', 'Void'), () => setIntegrityVoided(f.id, sid, true), 'x')] }));
  }
  if (sid === 'skeeball') {
    for (const p of _agg || []) {
      const ids = idsOf(p.key);
      for (const b of BOARDS) {
        const voidIds = ids.filter((id) => correctionFor(resolveBoardCorrections(cfg, id) || {}, b.id));
        if (!voidIds.length) continue;
        const raw = obj(obj(obj(obj(obj(rawByKey(p.key)).games).skeeball).sk).boards)[b.id] || {};
        rows.push(row({ icon: whoHTML(p.emoji), title: (p.name), sub: `${b.name} · ${tx('adm_raw', 'raw {plays} plays, {points} pts', { plays: fmt(raw.plays), points: fmt(raw.points) })}`,
          acts: [btn(tx('adm_undo', 'Undo'), skeeVoid(p.key, b.id, true))] }));
      }
    }
  }
  if (sid === 'holdem') {
    for (const p of _agg || []) {
      if (!idsOf(p.key).some((id) => resolveHoldemCorrection(cfg, id))) continue;
      const raw = obj(obj(obj(rawByKey(p.key)).games).holdem).hb;
      rows.push(row({ icon: whoHTML(p.emoji), title: (p.name), sub: `${tx('adm_bankroll', 'Bankroll')} · ${tx('adm_raw_bank', 'raw {bank}', { bank: '$' + fmt(holdemBalance(raw || {})) })}`,
        acts: [btn(tx('adm_undo', 'Undo'), holdemVoid(p.key, true))] }));
    }
  }
  return rows;
}
function alertRows(cfg, sid) {
  const rows = [];
  for (const m of matchAlerts()) {
    if (m.gid !== sid) continue;
    rows.push(row({ icon: whoHTML(''), title: (m.a.name || ''), sub: shortDate(m.at), sub2: hitText({ rule: String(m.rk).split('~')[0], v: m.a.v, lim: m.a.lim }) }));
  }
  if (sid === 'spellingbee') {
    const codes = codesSeen();
    for (const [bk, byCode] of Object.entries(obj(_bee.alerts))) {
      for (const [key, a] of Object.entries(obj(byCode))) {
        // `<CODE>~zone` (2026-10-29): the phone's time zone moved during that puzzle (functions/bee.js checkZone).
        const code = String(key).split('~')[0];
        const p = codes.get(code) || {};
        const note = obj(a).zone
          ? `UTC ${String(obj(a).zone).split(',').map((z) => { const h = -Number(z) / 60; return (h >= 0 ? '+' : '') + h; }).join(' / ')}`
          : `${tx('adm_log_gap', 'log gap')} ${(obj(a).words | 0)} / ${(obj(a).logged | 0)}`;
        rows.push(row({ icon: whoHTML(p.emoji), title: (p.name || obj(a).name || code),
          sub: `${shortDate(obj(a).at)} ${langOf(bk)} · ${note}` }));
      }
    }
  }
  return rows;
}

/** Skeeball: void one machine for a person on EVERY device they play on (a void on one record would be
 *  undone by their other phone's next sync), or undo it. */
const skeeVoid = (key, boardId, undo) => async () => {
  let last = { ok: true };
  for (const id of idsOf(key)) {
    const raw = obj(obj(obj(obj(obj((_players[id] || {}).stats).games).skeeball).sk).boards);
    if (!undo && !raw[boardId]) continue;
    if (undo && !correctionFor(resolveBoardCorrections(readCachedConfig(), id) || {}, boardId)) continue;
    last = await setSkeeballCorrection(id, boardId, undo ? null : snapshotOf(raw[boardId], dayKey(Date.now())), undo ? '' : 'broken board');
    if (!last.ok) return last;
  }
  return last;
};
/** Hold'em: void a person's bankroll on every device that holds a ledger, or undo it. */
const holdemVoid = (key, undo) => async () => {
  let last = { ok: true };
  for (const id of idsOf(key)) {
    const hb = obj(obj(obj((_players[id] || {}).stats).games).holdem).hb;
    if (undo ? !resolveHoldemCorrection(readCachedConfig(), id) : !hb) continue;
    last = await setHoldemCorrection(id, undo ? null : holdemSnapshotOf(hb), undo ? '' : 'admin void');
    if (!last.ok) return last;
  }
  return last;
};
/** Integrity: void one game on every record of a person that has played it, or undo every void on it. */
const gameVoid = (key, sid, voided) => async () => {
  let last = { ok: true };
  const flags = obj(_integ.flags);
  for (const id of idsOf(key)) {
    const g = obj(obj(obj((_players[id] || {}).stats).games)[sid]);
    const has = (+(obj(g.total).played) || 0) > 0;
    const now = isVoided(flags, readCachedConfig(), id, sid);
    if (voided ? (!has || now) : !now) continue;
    last = await setIntegrityVoided(id, sid, voided);
    if (!last.ok) return last;
  }
  return last;
};

/** Every game a person has a void in: { <sid>: { label } }. */
function voidsOf(cfg, key) {
  const out = {};
  const ids = idsOf(key);
  const flags = obj(_integ.flags);
  const machines = BOARDS.filter((b) => ids.some((id) => correctionFor(resolveBoardCorrections(cfg, id) || {}, b.id))).length;
  if (machines) out.skeeball = { label: machines === 1 ? tx('adm_1_machine', '1 machine') : tx('adm_n_machines', '{n} machines', { n: machines }) };
  if (ids.some((id) => resolveHoldemCorrection(cfg, id))) out.holdem = { label: tx('adm_bankroll', 'Bankroll') };
  const p = personByKey(key);
  const code = p && (p.playerId || '').toUpperCase();
  if (code) {
    // one per DAY and language: a day voided by the server AND by hand is still one day
    const days = new Set();
    for (const b of beeFlags(cfg)) if (b.code === code && b.voided) days.add(`${dayKey(b.at)}|${langOf(b.bk)}`);
    for (const v of Object.values(VOIDED_MATCHES.spellingbee || {})) {
      if (v.winner === code) days.add(`${v.day}|${langOf(String(v.puzzle || '').replace(/:/g, '-'))}`);
    }
    if (days.size) out.spellingbee = { label: days.size === 1 ? tx('adm_1_day', '1 day') : tx('adm_n_days', '{n} days', { n: days.size }) };
  }
  for (const id of ids) {
    const games = new Set([...Object.keys(obj(flags[id])), ...Object.keys(obj(HAND_VOIDS[id])), ...Object.keys(obj(obj(obj(cfg.integrity).void)[id]))]);
    for (const gid of games) if (!out[gid] && !ARCHIVED_GAMES.includes(gid) && isVoided(flags, cfg, id, gid)) out[gid] = { label: tx('adm_voided', 'Voided') };
  }
  return out;
}

/** A person's page in one game: their numbers, that game's voids for them, and the plays logged since Oct 28. */
function gamePlayerPage(cfg, sid, key) {
  const p = personByKey(key);
  if (!p) return { title: titleOfStats(sid), body: waitBody() };
  const g = obj(obj(p.games)[sid]);
  const tot = obj(g.total);
  let body = grp([
    row({ title: (tx('adm_played_l', 'Played')), value: fmt(tot.played) }),
    ...(SOLO.has(sid) ? [] : [row({ title: (tx('adm_won_l', 'Won')), value: fmt(tot.won) })]),
    ...(sid === 'skeeball' ? [] : Object.entries(obj(g.byDiff)).filter(([, d]) => (+obj(d).played || 0) > 0)
      .map(([k, d]) => row({ title: diffLabel(k), value: SOLO.has(sid) ? fmt(d.played) : `${fmt(d.won)} / ${fmt(d.played)}` }))),
  ], true);
  if (sid === 'skeeball') {
    const ids = idsOf(key);
    const shown = obj(obj(g.sk).boards);
    const raw = obj(obj(obj(obj(obj(rawByKey(key)).games).skeeball).sk).boards);
    const rows = BOARDS.filter((b) => (raw[b.id] || {}).plays).map((b) => {
      const isVoid = ids.some((id) => correctionFor(resolveBoardCorrections(cfg, id) || {}, b.id));
      const s = shown[b.id] || {}, r = raw[b.id] || {};
      return row({ title: (b.name),
        sub: isVoid ? `${tx('adm_voided', 'Voided')} · ${tx('adm_raw', 'raw {plays} plays, {points} pts', { plays: fmt(r.plays), points: fmt(r.points) })}`
          : tx('adm_sk_line', '{plays} plays · best {best} · {points} pts', { plays: fmt(s.plays), best: fmt(s.best), points: fmt(s.points) }),
        acts: [isVoid ? btn(tx('adm_undo', 'Undo'), skeeVoid(key, b.id, true)) : btn(tx('adm_void', 'Void'), skeeVoid(key, b.id, false), 'x')] });
    });
    if (rows.length) body += gh(tx('adm_machines', 'Machines')) + grp(rows);
  }
  if (sid === 'holdem') {
    const raw = obj(obj(obj(rawByKey(key)).games).holdem).hb;
    if (raw && ((raw.entries | 0) || (raw.grants | 0))) {
      const voided = idsOf(key).some((id) => resolveHoldemCorrection(cfg, id));
      const hb = obj(g.hb);
      body += gh(tx('adm_bankroll', 'Bankroll')) + grp([row({ title: '$' + fmt(holdemBalance(hb)),
        sub: voided ? `${tx('adm_voided', 'Voided')} · ${tx('adm_raw_bank', 'raw {bank}', { bank: '$' + fmt(holdemBalance(raw)) })}` : '',
        acts: [voided ? btn(tx('adm_undo', 'Undo'), holdemVoid(key, true)) : btn(tx('adm_void', 'Void'), holdemVoid(key, false), 'x')] })]);
    }
  }
  if (sid === 'spellingbee') {
    const code = (p.playerId || '').toUpperCase();
    const rows = beeFlags(cfg).filter((b) => b.code === code).map((b) => row({
      title: (`${shortDate(b.at)} ${langOf(b.bk)}`), sub: b.voided ? tx('adm_voided', 'Voided') : b.stands ? tx('adm_counts', 'Counts') : tx('adm_retired', 'Counts · rule retired'), sub2: b.f.summary || '',
      acts: !b.stands ? [] : [b.voided ? btn(tx('adm_undo', 'Undo'), () => setBeeUndone(b.bk, b.code, true)) : btn(tx('adm_void', 'Void'), () => setBeeUndone(b.bk, b.code, false), 'x')] }));
    if (rows.length) body += gh(tx('adm_flagged', 'Flagged'), rows.length) + grp(rows);
  } else if (sid !== 'skeeball' && sid !== 'holdem') {
    const flags = obj(_integ.flags);
    const voided = idsOf(key).some((id) => isVoided(flags, cfg, id, sid));
    body += gh(tx('adm_whole_game', 'Whole game')) + grp([row({
      title: (voided ? tx('adm_voided', 'Voided') : tx('adm_counts', 'Counts')),
      acts: [voided ? btn(tx('adm_undo', 'Undo'), gameVoid(key, sid, false)) : btn(tx('adm_void', 'Void'), gameVoid(key, sid, true), 'x')] })]);
  }
  body += playsHTML(p, sid);
  return { title: p.name, body };
}

/** A difficulty bucket's name: the stored id, readable (ids stay canonical; only the label changes). */
function diffLabel(k) {
  const fixed = { mp: tx('adm_d_mp', 'Online'), ai: tx('adm_d_ai', 'vs computer'), en: 'EN', es: 'ES' };
  return fixed[k] || String(k).replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** One play-log entry's recorder arguments, in a few words: [true, {guesses: 1}] -> "won · guesses 1". */
function argsText(a) {
  let v;
  try { v = JSON.parse(a); } catch { return String(a || ''); }
  const part = (x) => {
    if (x === true) return tx('adm_won_w', 'won');
    if (x === false) return tx('adm_lost_w', 'lost');
    if (x == null) return '';
    if (typeof x === 'object') return Object.entries(x).filter(([, y]) => y != null && y !== '' && typeof y !== 'object').map(([k, y]) => `${k} ${y}`).join(' · ');
    return String(x);
  };
  return (Array.isArray(v) ? v : [v]).map(part).filter(Boolean).join(' · ').slice(0, 120);
}
function playsHTML(p, sid) {
  const code = (p.playerId || '').toUpperCase();
  if (!code) return '';
  const got = _plays.get(code);
  const head = gh(tx('adm_plays', 'Plays'), tx('adm_since_log', 'since Oct 28'));
  if (!got) return head + grp([more(tx('adm_show_plays', 'Show plays'), () => readPlays(code))]);
  if (got === 'loading') return head + waitBody();
  if (got === 'error') return head + grp([more(tx('adm_retry', 'Try again'), () => readPlays(code))]);
  const mine = got.filter((x) => x.g === sid && x.f);
  if (!mine.length) return head + `<p class="adm-empty">${esc(tx('adm_no_plays', 'No plays logged.'))}</p>`;
  return head + grp(mine.slice(0, 60).map((x) => row({ title: (when(+x.t)), sub: argsText(x.a) })));
}

// --- People -------------------------------------------------------------------------------------------

function peopleTab() {
  const title = tx('adm_tab_people', 'People');
  if (loading()) return { title, body: waitBody() };
  const people = codedPeople();
  return { title, body: `<label class="adm-search" data-filter="#adm-people">${I.search}<input type="search" placeholder="${esc(tx('adm_search_people', 'Name or code'))}" aria-label="${esc(tx('adm_search_people', 'Name or code'))}"></label>`
    + gh(tx('adm_everyone', 'Everyone'), people.length)
    + `<div class="adm-grp" id="adm-people">${people.map((p) => row({ icon: whoHTML(p.emoji), title: (p.name), acts: [`<span class="adm-code">${esc(p.playerId)}</span>`],
      q: `${p.name} ${p.playerId}`, go: () => push({ k: 'person', key: p.key }) })).join('')}</div>` };
}

function personPage(cfg, key) {
  const p = personByKey(key);
  if (!p) return { title: '', body: waitBody() };
  const code = (p.playerId || '').toUpperCase();
  const online = code ? resolveOnlineAllowed(cfg, code) : false;
  const hidden = GAMES.filter((g) => !isLiveGame(cfg, g));
  const tests = code ? hidden.filter((g) => resolveGameAllowed(cfg, g.id, code)).map((g) => titleText(g)) : [];
  const hero = `<div class="adm-hero"><div class="adm-av">${esc(p.emoji || '🙂')}</div><h1 class="adm-hn">${esc(p.name)}</h1>
    <div class="adm-hs">${code ? `<code>${esc(code)}</code> · ` : ''}${esc(p.devices === 1 ? tx('adm_1_device', '1 device') : tx('adm_n_devices', '{n} devices', { n: p.devices }))}${p.updatedAt ? ` · ${esc(seen(p.updatedAt))}` : ''}</div></div>`;
  let body = grp([
    ...(code ? [row({ title: (tx('adm_plays_online', 'Plays online')),
      acts: [`<button type="button" class="adm-sw" aria-pressed="${online}" aria-label="${esc(tx('adm_plays_online', 'Plays online'))}" ${act(() => save(() => setOnlineAllowed(code, !online)))}></button>`] })] : []),
    ...(code && hidden.length ? [row({ title: (tx('adm_tester_for', 'Tester for')), value: tests.length ? tests.join(', ') : tx('adm_none', 'None'), go: () => push({ k: 'testerfor', key }) })] : []),
  ], true);
  const voids = voidsOf(cfg, key);
  const vk = Object.keys(voids);
  if (vk.length) {
    body += gh(tx('adm_voided', 'Voided'), vk.length) + grp(vk.map((sid) => row({ title: (titleOfStats(sid)), value: voids[sid].label, vcls: 'x', go: () => push({ k: 'gplayer', sid, key }) })));
  }
  const played = gamesPlayed(p);
  if (played.length) {
    body += gh(tx('adm_most_played', 'Most played'), (played.length === 1 ? tx('adm_1_game', '1 game') : tx('adm_n_games', '{n} games', { n: played.length })))
      + grp(played.slice(0, 5).map((sid) => row({ title: (titleOfStats(sid)), value: fmt(playsIn(p, sid)), go: () => push({ k: 'gplayer', sid, key }) }))
        .concat(played.length > 5 ? [more(tx('adm_all_games', 'All {n} games', { n: played.length }), () => push({ k: 'allgames', key }))] : []));
  }
  return { title: p.name, hero, body };
}
function testerForPage(cfg, key) {
  const p = personByKey(key);
  const code = p ? (p.playerId || '').toUpperCase() : '';
  const hidden = GAMES.filter((g) => !isLiveGame(cfg, g)).sort((a, b) => titleText(a).localeCompare(titleText(b)));
  return { title: tx('adm_tester_for', 'Tester for'), body: grp(hidden.map((g) => {
    const on = resolveGameAllowed(cfg, g.id, code);
    return row({ title: titleText(g), check: on, tap: () => save(() => setGameAllowed(g.id, code, !on)) });
  }), true) };
}
function allGamesPage(cfg, key) {
  const p = personByKey(key);
  if (!p) return { title: '', body: waitBody() };
  const played = gamesPlayed(p);
  return { title: tx('adm_all_games', 'All {n} games', { n: played.length }), body: grp(played.map((sid) => row({ title: (titleOfStats(sid)), value: fmt(playsIn(p, sid)), go: () => push({ k: 'gplayer', sid, key }) })), true) };
}

// --- Sent ---------------------------------------------------------------------------------------------

/** Per announcement, per PERSON: has any of their devices dismissed it. A phone that has not reported
 *  folds into Not yet (it shows up once that phone next opens the app). */
function annPeople() {
  const all = _players || {};
  const people = new Map();
  for (const id of Object.keys(all)) {
    const rec = all[id] || {};
    const prof = rec.profile || {};
    if (isHiddenDeviceId(id) || isHiddenName(prof.name)) continue;
    const key = _ident.keyFor(prof, id);
    if (!people.has(key)) people.set(key, { name: '', emoji: '', seen: new Set() });
    const p = people.get(key);
    if ((prof.name || '').trim() && !p.name) { p.name = prof.name.trim(); p.emoji = prof.emoji || ''; }
    const ann = rec.announce;
    if (ann && Array.isArray(ann.seen)) for (const s of ann.seen) p.seen.add(s);
  }
  return [...people.values()].sort((a, b) => (a.name || '￿').localeCompare(b.name || '￿'));
}
function sentTab() {
  const title = tx('adm_tab_sent', 'Sent');
  if (loading()) return { title, body: waitBody() };
  const people = annPeople();
  const lang = getLang();
  const anns = ANNOUNCEMENTS.map((a) => row({ title: (textFor(a.title, lang) || a.id),
    value: tx('adm_n_of', '{n} of {all}', { n: people.filter((p) => p.seen.has(a.id)).length, all: people.length }), go: () => push({ k: 'ann', id: a.id }) }));
  const msgs = HUB_MESSAGES.slice().sort((a, b) => b.atMs - a.atMs).map((m) => row({ title: (hubText(m, lang)),
    value: tx('adm_n_of', '{n} of {all}', { n: (m.to || []).filter((c) => readStatusFor(_players, m.id, c).read).length, all: (m.to || []).length }),
    go: () => push({ k: 'hm', id: m.id }) }));
  return { title, body: (anns.length ? gh(tx('adm_popups_seen', 'Popups · seen')) + grp(anns) : '')
    + (msgs.length ? gh(tx('adm_hubmsgs_read', 'Game Hub messages · read')) + grp(msgs) : '') };
}
function annPage(id) {
  const a = ANNOUNCEMENTS.find((x) => x.id === id);
  const title = a ? (textFor(a.title, getLang()) || a.id) : id;
  if (loading()) return { title, body: waitBody() };
  const people = annPeople();
  const yes = people.filter((p) => p.seen.has(id)), no = people.filter((p) => !p.seen.has(id));
  const list = (l) => l.map((p) => row({ icon: whoHTML(p.emoji), title: (p.name || tx('adm_sc_unnamed', 'Unnamed player')) }));
  return { title, body: gh(tx('adm_ann_seen', 'Seen it'), yes.length) + (yes.length ? grp(list(yes)) : `<p class="adm-empty">${esc(tx('adm_ann_nobody', 'Nobody yet.'))}</p>`)
    + (no.length ? gh(tx('adm_ann_notyet', 'Not yet'), no.length) + grp(list(no)) : '') };
}
function hmPage(id) {
  const m = HUB_MESSAGES.find((x) => x.id === id);
  if (!m) return { title: id, body: '' };
  const codes = codesSeen();
  return { title: hubText(m, getLang()), body: grp((m.to || []).map((c) => {
    const st = readStatusFor(_players, m.id, c);
    const p = codes.get(String(c).toUpperCase()) || { name: c, emoji: '' };
    return row({ icon: whoHTML(p.emoji), title: (p.name), value: !st.read ? tx('adm_ann_notyet', 'Not yet') : st.at ? tx('adm_hm_read', 'Read {when}', { when: when(st.at) }) : tx('adm_hm_read_any', 'Read') });
  }), true) };
}

// --- sheets: this phone, and the tester picker ---------------------------------------------------------

const ANNOUNCE_KEY = 'gamehub.announce.v1';
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function devWritesOn() { try { return localStorage.getItem(DEV_SYNC_OK) === '1'; } catch { return false; } }
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}

function renderSheet(cfg) {
  const close = act(() => { _sheet = null; render(); });
  if (_sheet.k === 'pick') {
    const g = hubGame(_sheet.hub);
    const people = codedPeople();
    const rows = people.map((p) => {
      const on = resolveGameAllowed(cfg, g.id, p.playerId);
      return row({ icon: whoHTML(p.emoji), title: p.name, check: on, q: `${p.name} ${p.playerId}`, tap: () => save(() => setGameAllowed(g.id, p.playerId, !on)) });
    });
    return `<div class="adm-dim" ${close}></div><div class="adm-sheet tall" role="dialog" aria-label="${esc(tx('adm_add_testers', 'Add testers'))}">
      <div class="adm-sh"><span style="width:44px"></span><b>${esc(tx('adm_add_testers', 'Add testers'))}</b><button type="button" ${close}>${esc(tx('adm_done', 'Done'))}</button></div>
      <div class="adm-sbody"><label class="adm-search" data-filter="#adm-pick">${I.search}<input type="search" placeholder="${esc(tx('adm_search', 'Search'))}" aria-label="${esc(tx('adm_search', 'Search'))}"></label>
      ${loading() ? waitBody() : `<div class="adm-grp" id="adm-pick">${rows.join('')}</div>`}</div></div>`;
  }
  let id = '';
  try { id = statsId() || ''; } catch { id = ''; }
  const rows = [
    row({ title: tx('adm_inbox', 'Bug reports'), go: async () => {
      try { const m = await import('./bug-report-ui.js'); closeAdmin(); await m.openBugInbox(); } catch (err) { toast(String((err && err.message) || err), true); }
    } }),
    link(tx('adm_update', 'Check for update'), async () => {
      toast(tx('adm_updating', 'Checking...'));
      try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.update())); location.reload(); }
      catch (err) { toast(String((err && err.message) || err), true); }
    }),
    link(tx('adm_popups_again', 'Show popups again'), () => {
      try { localStorage.removeItem(ANNOUNCE_KEY); toast(tx('adm_announce_done', 'Announcements will show again on this device.')); } catch (err) { toast(String(err), true); }
    }),
    link(tx('adm_copy_id', 'Copy device id'), async () => {
      try { await navigator.clipboard.writeText(id); toast(tx('adm_copied', 'Copied.')); } catch { toast(id); }
    }, [`<span class="adm-code">${esc(id ? id.slice(0, 8) + '…' : '?')}</span>`]),
  ];
  // READER KEY FOR CLAUDE (2026-10-30, Matt: "set up the read-only list"): a separate sign-in that may
  // READ the admin-only logs (play log, flags, alerts) and change nothing (database.rules.json readers/).
  // The key is copied for Matt to put in the session environment as GAMEHUB_READER (tools/reader-auth.mjs).
  rows.push(link(tx('adm_reader_key', 'Reader key for Claude'), () => makeReaderKey()));
  if (isDevOrigin()) {
    rows.push(link(devWritesOn() ? tx('adm_devwrites_off', 'Block writes from this dev server') : tx('adm_devwrites_on', 'Allow writes from this dev server'), () => {
      try { if (devWritesOn()) localStorage.removeItem(DEV_SYNC_OK); else localStorage.setItem(DEV_SYNC_OK, '1'); render(); } catch (err) { toast(String(err), true); }
    }));
  }
  return `<div class="adm-dim" ${close}></div><div class="adm-sheet" role="dialog" aria-label="${esc(tx('adm_this_phone', 'This phone'))}">
    <div class="adm-sh"><b>${esc(tx('adm_this_phone', 'This phone'))}</b><button type="button" ${close}>${esc(tx('adm_done', 'Done'))}</button></div>
    <div class="adm-sbody">${grp(rows)}</div></div>`;
}

/** Create one reader: a new anonymous account (not this phone's), put on readers/ by this admin phone,
 *  verified by re-read, then its key copied. Nothing else is written; the reader can only read. */
async function makeReaderKey() {
  try {
    const { writesAllowed } = await import('./stats-net.js');
    if (!writesAllowed('reader key')) { toast(tx('adm_reader_blocked', 'Not from this device.'), true); return; }
    const { firebaseConfig } = await import('./firebase-config.js');
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    });
    const acct = await res.json();
    if (!res.ok || !acct.localId || !acct.refreshToken) throw new Error((acct.error && acct.error.message) || 'sign-up failed');
    const { getStatsApp } = await import('./firebase-boot.js');
    const boot = await getStatsApp();
    if (!boot) throw new Error('offline');
    const { db, api } = boot;
    const ref = api.ref(db, `readers/${acct.localId}`);
    await api.set(ref, { on: true, at: api.serverTimestamp(), by: String(statsId() || '') });
    const back = await api.get(ref);
    if (!back || !back.exists()) throw new Error('not saved');
    try { await navigator.clipboard.writeText(acct.refreshToken); toast(tx('adm_reader_copied', 'Key copied. Add it as GAMEHUB_READER.')); }
    catch { window.prompt(tx('adm_reader_copy', 'Copy this key, then add it as GAMEHUB_READER'), acct.refreshToken); }
  } catch (err) { console.error('[admin] reader key', err); toast(String((err && err.message) || err), true); }
}

export default { openAdmin };
