// ui.js - Texas Hold'em: setup, online lobby, the table, and the host/guest sync.
//
// Three ways to sit at a table, one renderer:
//   solo   this device runs the dealer (table.js) against computer players
//   host   this device runs the dealer AND publishes the table to rooms/<CODE>/pk (net-table.js)
//   guest  this device renders what the host publishes and sends its own moves back
// The renderer only ever reads a PUBLIC view (engine.publicView) plus this device's own two cards,
// so solo, host and guest draw from exactly the same shape.
//
// isInProgress(): solo autosaves after every change and resumes on return, so leaving is lossless
// and it answers false. Online it answers true while a game is running and this player is still
// in it: navigating away leaves the table waiting on you (a host's absence stalls it for everyone).

import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { loadProfile } from '../../js/profile-store.js';
import { deviceId, recordResult, recordHoldemBank, recordHoldemHand, holdemLedger, holdemBalance, holdemSuspect, HOLDEM_START_BANK, loadStats, statsId } from '../../js/game-stats.js';
import { corrections } from '../../js/admin-config.js';
import { correctHoldemLedger } from '../../js/stats-corrections.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import * as net from '../../js/net.js';
import { enableCodeCopy } from '../../js/mp-code-copy.js';
import { createReactions } from '../../js/mp-reactions-ui.js';
import STRINGS from './strings.js';
import {
  newGame, publicView, legal, blindsOf, SPEEDS, START_CHIPS, MAX_PLAYERS,
  evaluate, bestFive, categoryOf, scoreRanks, RANKS, SUIT_GLYPH, potTotal, payout,
} from './engine.js';
import { Table, PACES, RESULT_MS } from './table.js';
import NT from './net-table.js';

const t = makeT(STRINGS);

const SETTINGS_KEY = 'gamehub.holdem.v1';
const SAVE_KEY = 'gamehub.holdem.save.v1';
const MP_KEY = 'gamehub.holdem.mp.v1';
// Which hands this device has already counted in the per-hand stats (recordHoldemHand), so a
// reload during a result screen cannot count the same hand twice. A short list, newest last.
const HANDS_KEY = 'gamehub.holdem.hands.v1';
const CODE_LEN = 4;
const CLOCK_MS = 45000;          // online turn clock
const MOVE_MS = 1800;            // an opponent's move is highlighted this long (then stays plain until the round ends)
const AWAY_MS = 35000;           // no heartbeat change for this long = away (heartbeat is every 10s)
const MP_SAVE_TTL = 12 * 3600 * 1000;
const SKILL_ID = { 1: 'easy', 2: 'medium', 3: 'hard' };

// The tables you can buy into with your bankroll (2026-09-27), cheapest first - the tournament
// tiles on the reference app's menu. A table is locked until the bankroll covers its buy-in. The
// chips AT the table are always $10,000 tournament chips; the buy-in is what the seat costs.
const TIERS = [
  { id: 'buddy', buyin: 500, bg: 'linear-gradient(135deg, #c0582f, #6e2412)' },
  { id: 'vegas', buyin: 1000, bg: 'linear-gradient(135deg, #7b3fb8, #34105e)' },
  { id: 'regional', buyin: 5000, bg: 'linear-gradient(135deg, #2f9a3e, #0f4d1a)' },
  { id: 'world', buyin: 10000, bg: 'linear-gradient(135deg, #c42f7d, #5e0f3a)' },
  { id: 'solar', buyin: 100000, bg: 'linear-gradient(135deg, #e0892a, #7a3c05)' },
  { id: 'galaxy', buyin: 1000000, bg: 'linear-gradient(135deg, #2f6fd0, #0f2a66)' },
  { id: 'universe', buyin: 10000000, bg: 'linear-gradient(135deg, #8a2fd0, #2a0a5a)' },
];
const tierById = (id) => TIERS.find((x) => x.id === id) || null;
const bigMoney = (n) => '$' + Math.max(0, Math.floor(+n || 0)).toLocaleString();
const BANK_TIMEOUT_MS = 8000;

const BOT_NAMES = [
  ['Lucky', '\u{1F340}'], ['Rosa', '\u{1F339}'], ['Tex', '\u{1F920}'], ['Chip', '\u{1F43F}️'],
  ['Maverick', '\u{1F985}'], ['Lola', '\u{1F98A}'], ['Duke', '\u{1F3A9}'], ['Olive', '\u{1F989}'],
];

const readJSON = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('[holdem] save failed', k, e); return false; } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* nothing to drop */ } };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n | 0).toLocaleString();
/** Money the way the reference app prints it: $9200 below ten thousand, then $10.0k, $11.8k. */
const money = (n) => {
  n = Math.max(0, Math.floor(+n || 0));
  if (n < 10000) return '$' + n;
  if (n < 1000000) return '$' + (n / 1000).toFixed(n < 100000 ? 1 : 0) + 'k';
  return '$' + (n / 1000000).toFixed(1) + 'M';
};
const rid = () => Math.random().toString(36).slice(2, 10);
const rankText = (r) => (RANKS[r] === 'T' ? '10' : RANKS[r]);
/** "Rosa", "Rosa and Tex", "Rosa, Tex and Lucky". */
const joinNames = (list) => (list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' ' + t('and') + ' ' + list[list.length - 1]);
const placeText = (n) => (n === 1 ? t('place_1') : n === 2 ? t('place_2') : n === 3 ? t('place_3') : t('place_n', { n }));

function loadSettings() {
  const s = readJSON(SETTINGS_KEY) || {};
  const prof = loadProfile();
  const profSkill = prof && prof.opponents && prof.opponents[0] ? prof.opponents[0].skill : 2;
  return {
    tab: s.tab === 'online' ? 'online' : 'solo',
    bots: Math.max(1, Math.min(7, s.bots | 0 || 3)),
    skill: [1, 2, 3].includes(s.skill) ? s.skill : profSkill,
    speed: SPEEDS[s.speed] ? s.speed : 'normal',
    pace: PACES[s.pace] ? s.pace : 'normal',
    netBots: Math.max(0, Math.min(7, s.netBots | 0)),
    netSkill: [1, 2, 3].includes(s.netSkill) ? s.netSkill : 2,
    netTier: typeof s.netTier === 'string' ? s.netTier : null,
  };
}

function me() {
  const p = loadProfile();
  return { name: (p && p.name) || t('you'), avatar: (p && p.emoji) || '\u{1F642}', deviceId: deviceId() };
}

/** Computer players: the profile's own opponents first (name + emoji), then the house list. */
function botRoster(n, skill) {
  const prof = loadProfile();
  const out = [];
  const used = new Set();
  (prof && prof.opponents ? prof.opponents : []).forEach((o) => {
    if (out.length < n && !used.has(o.name)) { out.push({ name: o.name, emoji: o.emoji, bot: skill }); used.add(o.name); }
  });
  for (const [name, emoji] of BOT_NAMES) {
    if (out.length >= n) break;
    if (!used.has(name)) { out.push({ name, emoji, bot: skill }); used.add(name); }
  }
  return out;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** "Two Pair, Aces and Fives" - the full name the reference app announces a winner with. */
function handName(score) {
  const cat = categoryOf(score);
  const r = scoreRanks(score);
  if (cat === 8 && r[0] === 12) return t('hd_9');
  const one = (k) => t('rn_' + k);
  const many = (k) => t('rp_' + k);
  return t('hd_' + cat, { r: one(r[0]), p: many(r[0]), q: many(r[1]) });
}

// ---------------------------------------------------------------------------------------------

const FACE = { 9: 'J', 10: 'Q', 11: 'K' };

/** A playing card: rank-and-suit index in the top-left corner (and upside down bottom-right), a
 *  framed centre with one big suit, or the letter on a court card. Suits differ by SHAPE, so red
 *  versus black is never the only cue. */
function cardHTML(c, cls = '') {
  const r = rankText(c >> 2);
  const s = c & 3;
  const red = s === 1 || s === 2;
  const g = SUIT_GLYPH[s];
  const face = FACE[c >> 2];
  const centre = face ? `<span class="pk-cc is-face"><b>${face}</b><i>${g}</i></span>` : `<span class="pk-cc"><i>${g}</i></span>`;
  return `<div class="pk-card${red ? ' is-red' : ''} ${cls}" data-c="${c}" role="img" aria-label="${esc(t('aria_card', { rank: r, suit: t('s_' + s) }))}">`
    + `<span class="pk-ci${r === '10' ? ' is-ten' : ''}"><b>${r}</b><i>${g}</i></span>${centre}<span class="pk-ci is-rot${r === '10' ? ' is-ten' : ''}"><b>${r}</b><i>${g}</i></span></div>`;
}

const HELP_HANDS = [
  // examples, strongest first (rank index, suit): suits 0 s, 1 h, 2 d, 3 c
  [[8, 0], [9, 0], [10, 0], [11, 0], [12, 0]],
  [[3, 1], [4, 1], [5, 1], [6, 1], [7, 1]],
  [[7, 0], [7, 1], [7, 2], [7, 3], [2, 0]],
  [[10, 0], [10, 1], [10, 3], [2, 2], [2, 0]],
  [[12, 2], [9, 2], [6, 2], [4, 2], [1, 2]],
  [[3, 0], [4, 2], [5, 1], [6, 3], [7, 0]],
  [[5, 0], [5, 1], [5, 3], [11, 2], [0, 0]],
  [[11, 0], [11, 2], [7, 1], [7, 3], [1, 0]],
  [[11, 1], [11, 3], [9, 0], [4, 2], [2, 1]],
  [[12, 0], [11, 2], [7, 1], [5, 3], [2, 0]],
];

// ---------------------------------------------------------------------------------------------

class Game {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.kind = null;           // 'solo' | 'host' | 'guest'
    this.screen = 'setup';      // 'setup' | 'lobby' | 'table'
    this.table = null;          // Table (solo / host)
    this.pub = null;            // the public view being drawn
    this.hole = null;           // this device's two cards for pub.handNo
    this.myIdx = -1;
    this.clockEnd = 0;
    this.raise = null;          // { to } while the raise panel is open
    this.overlay = null;        // 'help' | 'over' | 'confirm'
    this.overDismissed = null;
    this.mp = null;
    this.error = '';
    this.busy = false;
    this.joinCode = '';
    this.seen = new Set();
    this.seenHand = -1;
    this.oppX = {};              // opponent column centres, filled by _layout (empty until measured)
    this.moveSeen = null;        // {hand, n}: how much of the hand's public log has been shown
    this.moves = {};             // seat -> {a, until, popped}: an opponent's move, held on screen
    this.bankRemote = null;      // the bankroll ledger of this player's OTHER devices, once read
    this.dead = false;
    this.timers = new Set();

    root.innerHTML = '';
    this.el = document.createElement('div');
    this.el.className = 'pk-root';
    root.appendChild(this.el);

    this.onClick = (e) => this._click(e);
    this.onInput = (e) => this._input(e);
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('input', this.onInput);
    this.onKey = (e) => {
      if (e.key === 'Enter' && e.target && e.target.matches('[data-role="join-code"]')) this._join();
    };
    this.el.addEventListener('keydown', this.onKey);
    // One-motion raise: press RAISE and slide up (the reference app's control). Bound to the game's
    // own root, never document; the root holds the pointer capture so a repaint that replaces the
    // button mid-drag cannot drop the gesture.
    // A new press means a new tap: never swallow ITS click (see _dragEnd's noClickUntil).
    this.onPDown = (e) => { this.noClickUntil = 0; this._dragStart(e); };
    this.onPMove = (e) => this._dragMove(e);
    this.onPUp = (e) => this._dragEnd(e, false);
    this.onPCancel = (e) => this._dragEnd(e, true);
    this.el.addEventListener('pointerdown', this.onPDown);
    this.el.addEventListener('pointermove', this.onPMove);
    this.el.addEventListener('pointerup', this.onPUp);
    this.el.addEventListener('pointercancel', this.onPCancel);
    this.offCopy = enableCodeCopy(this.el);
    this.offView = onViewportResize(() => this._layout());
    // The table area also changes size without the viewport doing so (the hub's chrome settling,
    // a banner appearing), so watch the element itself too.
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._layout()) : null;
    this.offLang = onLangChange(() => this.render(true));
    this.rx = createReactions({
      send: (p) => { if (this.mp && this.mp.code != null) net.sendReaction(this.mp.code, String(this.mp.seat), p); },
      mySeatKey: () => (this.mp ? String(this.mp.seat) : null),
    });
    this.tick = setInterval(() => this._tick(), 1000);

    this._refreshBank();
    // A solo game in progress picks up exactly where it stopped.
    const save = readJSON(SAVE_KEY);
    if (save && save.state && !save.state.over && save.state.players) this._startSolo(save.state);
    else this.render(true);
  }

  // ----------------------------------------------------------------------- screens ---

  render(full) {
    if (this.dead) return;
    if (this.screen === 'setup') this._renderSetup();
    else if (this.screen === 'tiers') this._renderTiers();
    else if (this.screen === 'bank') this._renderBank();
    else if (this.screen === 'lobby') this._renderLobby();
    else this._renderTable(full);
    this._renderOverlay();
    this.rx.setActive(!!(this.mp && (this.screen === 'lobby' || this.screen === 'table')));
    this.el.classList.toggle('is-online', !!this.mp);
  }

  _renderSetup() {
    const s = this.settings;
    const mpSave = this._mpSave();
    const soloSave = this._soloSave();
    const seg = (name, items, cur) => `<div class="pk-seg" role="radiogroup">${items.map(([v, label]) =>
      `<button type="button" role="radio" aria-checked="${String(v) === String(cur)}" class="pk-segbtn${String(v) === String(cur) ? ' is-on' : ''}" data-act="set" data-k="${name}" data-v="${v}">${label}</button>`).join('')}</div>`;
    const speedHint = t('speed_hint', { n: SPEEDS[s.speed] });
    const solo = `
      <div class="pk-field"><div class="pk-label">${esc(t('opponents'))}</div>
        <div class="pk-stepper">
          <button type="button" class="pk-stepbtn" data-act="bots" data-d="-1" aria-label="-" ${s.bots <= 1 ? 'disabled' : ''}>&minus;</button>
          <span class="pk-stepval">${s.bots}</span>
          <button type="button" class="pk-stepbtn" data-act="bots" data-d="1" aria-label="+" ${s.bots >= 7 ? 'disabled' : ''}>+</button>
        </div></div>
      <div class="pk-field"><div class="pk-label">${esc(t('skill'))}</div>
        ${seg('skill', [1, 2, 3].map((k) => [k, `<span class="pk-shape">${diffShapeSVG(k)}</span>${esc(t(SKILL_ID[k]))}`]), s.skill)}</div>
      <div class="pk-field"><div class="pk-label">${esc(t('blinds_speed'))} <span class="pk-hint">${esc(speedHint)}</span></div>
        ${seg('speed', ['slow', 'normal', 'fast'].map((k) => [k, esc(t('speed_' + k))]), s.speed)}</div>
      <div class="pk-field"><div class="pk-label">${esc(t('pace'))}</div>
        ${seg('pace', ['slow', 'normal', 'fast'].map((k) => [k, esc(t('pace_' + k))]), s.pace)}</div>
      ${soloSave ? `<button type="button" class="pk-btn pk-btn-primary pk-btn-big" data-act="resume">${esc(t('resume_game'))}<small class="pk-resume-sub">${esc(this._saveLine(soloSave.state))}</small></button>
      <button type="button" class="pk-link" data-act="giveup-saved">${esc(t('give_up_saved'))}</button>`
        : `<button type="button" class="pk-btn pk-btn-primary pk-btn-big" data-act="choose">${esc(t('choose_table'))}</button>`}`;
    const online = `
      ${mpSave ? `<button type="button" class="pk-btn pk-btn-primary" data-act="rejoin">${esc(t('back_to_table', { code: mpSave.code }))}</button>` : ''}
      <button type="button" class="pk-btn ${mpSave ? '' : 'pk-btn-primary'} pk-btn-big" data-act="create" ${this.busy ? 'disabled' : ''}>${esc(t('create_table'))}</button>
      <p class="pk-hint pk-center-text">${esc(t('create_hint'))}</p>
      <div class="pk-field"><div class="pk-label">${esc(t('join_title'))}</div>
        <div class="pk-joinrow">
          <input class="pk-input" data-role="join-code" maxlength="${CODE_LEN}" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="${esc(t('join_ph'))}" value="${esc(this.joinCode)}" aria-label="${esc(t('join_title'))}">
          <button type="button" class="pk-btn pk-btn-primary" data-act="join" ${this.joinCode.length === CODE_LEN && !this.busy ? '' : 'disabled'}>${esc(t('join'))}</button>
        </div></div>
      ${this.busy ? `<p class="pk-hint pk-center-text">${esc(t('connecting'))}</p>` : ''}`;
    this.el.innerHTML = `
      <div class="pk-setup">
        <div class="pk-brand">
          <div class="pk-brand-cards">${cardHTML(48)}${cardHTML(45)}</div>
          <h1 class="pk-title">${esc(t('title'))}</h1>
          <button type="button" class="pk-bankchip" data-act="bank"><span class="pk-bankicon" aria-hidden="true">$</span>${esc(t('bankroll'))} <b>${esc(bigMoney(this.bank()))}</b><span class="pk-bankgo">${esc(t('bank_see'))} &#x203A;</span></button>
        </div>
        <div class="pk-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${s.tab === 'solo'}" class="pk-tab${s.tab === 'solo' ? ' is-on' : ''}" data-act="set" data-k="tab" data-v="solo">${esc(t('tab_solo'))}</button>
          <button type="button" role="tab" aria-selected="${s.tab === 'online'}" class="pk-tab${s.tab === 'online' ? ' is-on' : ''}" data-act="set" data-k="tab" data-v="online">${esc(t('tab_online'))}</button>
        </div>
        <div class="pk-panel">${s.tab === 'solo' ? solo : online}</div>
        ${this.error ? `<p class="pk-error" role="alert">${esc(this.error)}</p>` : ''}
        <button type="button" class="pk-link" data-act="help">${esc(t('help'))}</button>
      </div>`;
  }

  /** Pick a table to buy into (the reference app's tournament tiles). */
  _renderTiers() {
    const bal = this.bank();
    const n = this.settings.bots + 1;
    const broke = bal < TIERS[0].buyin;
    this.el.innerHTML = `
      <div class="pk-tiers">
        <div class="pk-tierhead">
          <button type="button" class="pk-btn pk-btn-sm" data-act="to-setup-tab">&#x2039; ${esc(t('back'))}</button>
          <button type="button" class="pk-bankbar" data-act="bank"><span class="pk-bankicon" aria-hidden="true">$</span>${esc(t('bankroll'))}: <b>${esc(bigMoney(bal))}</b> &#x203A;</button>
        </div>
        ${broke ? `<button type="button" class="pk-btn pk-btn-primary" data-act="topup">${esc(t('topup', { n: bigMoney(HOLDEM_START_BANK - bal) }))}</button>` : ''}
        <div class="pk-tiergrid">
          ${TIERS.map((x) => {
            const locked = bal < x.buyin;
            return `<button type="button" class="pk-tier${locked ? ' is-locked' : ''}" data-act="deal" data-tier="${x.id}" style="background:${x.bg}" ${locked ? 'disabled' : ''}>
              <span class="pk-tiername">${esc(t('tier_' + x.id))}</span>
              <span class="pk-tierbuy">${esc(t('buy_in', { n: bigMoney(x.buyin) }))}</span>
              <span class="pk-tierwin">${locked ? '&#x1F512; ' + esc(t('locked')) : esc(t('first_wins', { n: bigMoney(payout(1, n, x.buyin)) }))}</span>
            </button>`;
          }).join('')}
        </div>
        <p class="pk-hint pk-center-text">${esc(t('prize_rule', { n }))}</p>
      </div>`;
  }

  /** This device's ledger plus (once read) the player's other devices', as one balance. */
  bank() {
    const l = this._myLedger();
    const r = this.bankRemote || {};
    const n = (v) => (Number.isFinite(+v) ? Math.floor(+v) : 0);
    return holdemBalance({ buyins: n(l.buyins) + n(r.buyins), winnings: n(l.winnings) + n(r.winnings), grants: n(l.grants) + n(r.grants) });
  }

  /** This device's ledger as the leaderboard sees it: an admin void (js/stats-corrections.js) is
   *  applied here too, or the game would keep spending money every other screen says is gone. */
  _myLedger() {
    const l = holdemLedger();
    let corr = null;
    try { corr = ((corrections() || {}).holdem || {})[statsId()] || null; } catch { corr = null; }
    return corr ? correctHoldemLedger(l, corr) : l;
  }

  /** Read the player's other devices' ledgers (the same cross-device read My Stats uses). The
   *  remote part is kept as combined-minus-local, so later local writes are never counted twice. */
  async _refreshBank() {
    try {
      const [net, agg] = await Promise.all([import('../../js/stats-net.js'), import('../../js/players-agg.js')]);
      const all = await Promise.race([net.readPlayersOnce(), new Promise((res) => setTimeout(() => res(null), BANK_TIMEOUT_MS))]);
      if (!all || this.dead) return;
      const mine = agg.aggregateForViewer(all, loadProfile() || {}, statsId(), loadStats(), corrections());
      const hb = mine && mine.games && mine.games.holdem && mine.games.holdem.hb;
      if (!hb) return;
      const l = this._myLedger();
      const n = (v) => (Number.isFinite(+v) ? Math.floor(+v) : 0);
      this.bankRemote = {
        buyins: Math.max(0, n(hb.buyins) - n(l.buyins)),
        winnings: Math.max(0, n(hb.winnings) - n(l.winnings)),
        grants: Math.max(0, n(hb.grants) - n(l.grants)),
        cashes: Math.max(0, n(hb.cashes) - n(l.cashes)),
        entries: Math.max(0, n(hb.entries) - n(l.entries)),
        best: n(hb.best),
      };
      if (this.screen === 'setup' || this.screen === 'tiers' || this.screen === 'bank') this.render();
    } catch { /* offline: this device's own ledger is still exact for this device */ }
  }

  /** This device's ledger plus the other devices' part, every field (the Bankrolls page). */
  _myBankFull() {
    const l = this._myLedger();
    const r = this.bankRemote || {};
    const n = (v) => (Number.isFinite(+v) ? Math.floor(+v) : 0);
    const out = {};
    for (const k of ['buyins', 'winnings', 'grants', 'cashes', 'entries']) out[k] = n(l[k]) + n(r[k]);
    out.best = Math.max(n(l.best), n(r.best));
    return out;
  }

  /** The Bankrolls page (2026-10-06, Matt: "a leaderboard or chip count ... so you can see current
   *  bank roll and lifetime earnings"). Your own numbers on top - always there, offline too - and
   *  everyone who has played for money below, ranked by bankroll or by lifetime winnings. Read-only:
   *  it reads the same ledgers the hub leaderboard does and writes nothing. */
  _renderBank() {
    const mine = this._myBankFull();
    const profit = mine.winnings - mine.buyins;
    const sort = this.bankSort === 'won' ? 'won' : 'bank';
    const signed = (v) => (v < 0 ? '-' : '+') + bigMoney(Math.abs(v));
    const L = this.bankList;
    let list = '';
    if (L === 'loading' || L == null) list = `<p class="pk-hint pk-center-text">${esc(t('bank_loading'))}</p>`;
    else if (L === 'offline') list = `<p class="pk-hint pk-center-text">${esc(t('bank_offline'))}</p><button type="button" class="pk-btn pk-btn-sm" data-act="bank-retry">${esc(t('bank_retry'))}</button>`;
    else {
      const rows = L.slice().sort((a, b) => {
        if (a.review !== b.review) return a.review ? 1 : -1;
        return sort === 'won' ? (b.won - a.won) || (b.bank - a.bank) : (b.bank - a.bank) || (b.won - a.won);
      });
      list = `<ol class="pk-bklist">${rows.map((r, i) => `
          <li class="pk-bkrow${r.me ? ' is-me' : ''}" data-me="${r.me ? 1 : 0}">
            <span class="pk-bkrank">${r.review ? '-' : i + 1}</span>
            <span class="pk-lav">${esc(r.emoji || '\u{1F642}')}</span>
            <span class="pk-bkname">${esc(r.me ? t('you') : r.name)}</span>
            ${r.review ? `<span class="pk-bkval is-review">${esc(t('bank_review'))}</span>` : `<span class="pk-bkval"><b>${esc(bigMoney(sort === 'won' ? r.won : r.bank))}</b><small>${esc(sort === 'won' ? t('bankroll') + ' ' + bigMoney(r.bank) : t('bank_won_short') + ' ' + bigMoney(r.won))}</small></span>`}
          </li>`).join('')}</ol>`;
    }
    this.el.innerHTML = `
      <div class="pk-tiers pk-bankpage">
        <div class="pk-tierhead">
          <button type="button" class="pk-btn pk-btn-sm" data-act="bank-back">&#x2039; ${esc(t('back'))}</button>
          <h2 class="pk-bktitle">${esc(t('bank_title'))}</h2>
        </div>
        <div class="pk-bkme">
          <div class="pk-bkbig"><span class="pk-bankicon" aria-hidden="true">$</span><span>${esc(t('bankroll'))}</span><b>${esc(bigMoney(holdemBalance(mine)))}</b></div>
          <div class="pk-bkgrid">
            <div><small>${esc(t('bank_lifetime'))}</small><b>${esc(bigMoney(mine.winnings))}</b></div>
            <div><small>${esc(t('bank_profit'))}</small><b class="${profit < 0 ? 'is-neg' : 'is-pos'}">${esc(signed(profit))}</b></div>
            <div><small>${esc(t('bank_best'))}</small><b>${esc(bigMoney(mine.best))}</b></div>
            <div><small>${esc(t('bank_prizes'))}</small><b>${esc(t('bank_prizes_n', { a: mine.cashes, b: mine.entries }))}</b></div>
          </div>
        </div>
        <div class="pk-seg pk-bksort" role="radiogroup">
          <button type="button" role="radio" aria-checked="${sort === 'bank'}" class="pk-segbtn${sort === 'bank' ? ' is-on' : ''}" data-act="bank-sort" data-v="bank">${esc(t('bankroll'))}</button>
          <button type="button" role="radio" aria-checked="${sort === 'won'}" class="pk-segbtn${sort === 'won' ? ' is-on' : ''}" data-act="bank-sort" data-v="won">${esc(t('bank_lifetime'))}</button>
        </div>
        <div class="pk-bkwrap">${list}</div>
      </div>`;
    this._fitBank();
  }

  /** The page never scrolls (UX floor): drop rows from the bottom until the list fits, but never
   *  your own row - you always see where you stand. */
  _fitBank() {
    const wrap = this.el.querySelector('.pk-bkwrap');
    if (!wrap) return;
    const rows = [...wrap.querySelectorAll('.pk-bkrow')];
    for (let i = rows.length - 1; i >= 0 && wrap.scrollHeight > wrap.clientHeight + 1; i--) {
      if (rows[i].dataset.me !== '1') rows[i].remove();
    }
  }

  /** Read everyone's ledgers once (the hub leaderboard's own read and filters). */
  async _loadBankList() {
    this.bankList = 'loading';
    if (this.screen === 'bank') this.render();
    try {
      const [netMod, agg, hidden] = await Promise.all([import('../../js/stats-net.js'), import('../../js/players-agg.js'), import('../../js/hidden-players.js')]);
      const raw = await Promise.race([netMod.readPlayersOnce(), new Promise((res) => setTimeout(() => res(null), BANK_TIMEOUT_MS))]);
      if (this.dead) return;
      if (!raw || !Object.keys(raw).length) throw new Error('offline');   // readPlayersOnce answers {} when it cannot reach Firebase
      const all = {};
      for (const id of Object.keys(raw)) if (!hidden.HIDDEN_DEVICE_PREFIX.some((p) => id.startsWith(p))) all[id] = raw[id];
      const corr = corrections();
      let meKey = null;
      try { meKey = agg.buildIdentity(all).keyFor(loadProfile() || {}, statsId()); } catch { meKey = null; }
      const rows = [];
      let meSeen = false;
      for (const g of agg.aggregatePlayers(all, corr)) {
        if (hidden.isHiddenName(g.name)) continue;
        const hb = ((g.games && g.games.holdem) || {}).hb;
        const me = g.key === meKey;
        if (!me && !(hb && ((hb.entries | 0) || (hb.grants | 0)))) continue;   // never played for money
        if (me) meSeen = true;
        const src = me ? this._myBankFull() : hb;
        rows.push({ name: g.name, emoji: g.emoji, me, review: !me && !!holdemSuspect(hb), bank: Math.max(0, holdemBalance(src)), won: Math.max(0, Math.floor(+src.winnings || 0)) });
      }
      if (!meSeen) {
        const p = loadProfile() || {};
        const src = this._myBankFull();
        rows.push({ name: p.name || '', emoji: p.emoji || '', me: true, review: false, bank: Math.max(0, holdemBalance(src)), won: src.winnings });
      }
      this.bankList = rows;
    } catch {
      this.bankList = 'offline';
    }
    if (this.screen === 'bank' && !this.dead) this.render();
  }

  _renderLobby() {
    const mp = this.mp;
    const room = mp.room || {};
    const humans = this._roster(room);
    const bots = mp.host ? mp.bots : ((NT.parse(room.pk && room.pk.lobby) || {}).bots || []);
    const speed = mp.host ? this.settings.speed : ((NT.parse(room.pk && room.pk.lobby) || {}).speed || 'normal');
    const count = humans.length + bots.length;
    const lobbyCfg = mp.host ? null : (NT.parse(room.pk && room.pk.lobby) || {});
    const tier = tierById(mp.host ? this._netTier().id : lobbyCfg.tier);
    const tierLine = tier ? `${t('tier_' + tier.id)} · ${t('buy_in', { n: bigMoney(tier.buyin) })}` : t('no_buyin');
    const rows = humans.map((h) => `
        <li class="pk-lrow"><span class="pk-lav">${esc(h.avatar || '\u{1F642}')}</span><span class="pk-lname">${esc(h.name)}</span>
          ${h.seat === 0 ? `<span class="pk-badge">${esc(t('host'))}</span>` : ''}${h.seat === mp.seat ? `<span class="pk-badge is-you">${esc(t('you'))}</span>` : ''}</li>`).join('')
      + bots.map((b, i) => `
        <li class="pk-lrow"><span class="pk-lav">${esc(b.emoji)}</span><span class="pk-lname">${esc(b.name)}</span>
          <span class="pk-shape" title="${esc(t(SKILL_ID[b.bot]))}">${diffShapeSVG(b.bot)}</span>
          ${mp.host ? `<button type="button" class="pk-btn pk-btn-sm" data-act="rmbot" data-i="${i}">${esc(t('remove'))}</button>` : ''}</li>`).join('');
    const seg = (name, items, cur) => `<div class="pk-seg">${items.map(([v, label]) =>
      `<button type="button" aria-pressed="${String(v) === String(cur)}" class="pk-segbtn${String(v) === String(cur) ? ' is-on' : ''}" data-act="set" data-k="${name}" data-v="${v}">${label}</button>`).join('')}</div>`;
    const hostControls = mp.host ? `
        <div class="pk-lobby-tools">
          <button type="button" class="pk-btn" data-act="addbot" ${count >= MAX_PLAYERS ? 'disabled' : ''}>+ ${esc(t('add_bot'))}</button>
          ${seg('netSkill', [1, 2, 3].map((k) => [k, `<span class="pk-shape">${diffShapeSVG(k)}</span><span class="pk-sr">${esc(t(SKILL_ID[k]))}</span>`]), this.settings.netSkill)}
        </div>
        <div class="pk-field"><div class="pk-label">${esc(t('table_label'))}</div>
          <div class="pk-tierstep">
            <button type="button" class="pk-stepbtn" data-act="nettier" data-d="-1" aria-label="-">&#x2039;</button>
            <span class="pk-tierstepval" style="background:${tier ? tier.bg : '#222'}">${esc(tierLine)}</span>
            <button type="button" class="pk-stepbtn" data-act="nettier" data-d="1" aria-label="+">&#x203A;</button>
          </div></div>
        <div class="pk-field"><div class="pk-label">${esc(t('blinds_speed'))} <span class="pk-hint">${esc(t('speed_hint', { n: SPEEDS[speed] }))}</span></div>
          ${seg('speed', ['slow', 'normal', 'fast'].map((k) => [k, esc(t('speed_' + k))]), speed)}</div>
        ${mp.bots.length ? `<div class="pk-field"><div class="pk-label">${esc(t('pace'))}</div>
          ${seg('pace', ['slow', 'normal', 'fast'].map((k) => [k, esc(t('pace_' + k))]), this.settings.pace)}</div>` : ''}
        <button type="button" class="pk-btn pk-btn-primary pk-btn-big" data-act="startnet" ${count >= 2 ? '' : 'disabled'}>${esc(count >= 2 ? t('start_game') : t('need_two'))}</button>`
      : `<p class="pk-tierline" style="background:${tier ? tier.bg : '#222'}">${esc(tierLine)}</p>
         ${tier && this.bank() < tier.buyin ? `<p class="pk-hint pk-center-text">${esc(t('cant_cover'))}</p>` : ''}
         <p class="pk-waiting">${esc(t('waiting_host'))}</p>`;
    this.el.innerHTML = `
      <div class="pk-lobby">
        <div class="pk-codebox">
          <div class="pk-label">${esc(t('code_label'))}</div>
          <div class="pk-bigcode" data-role="mp-code">${esc(mp.code)}</div>
          <div class="pk-hint">${esc(t('code_hint'))}</div>
        </div>
        <div class="pk-label">${esc(t('players_n', { n: count }))}</div>
        <ul class="pk-llist">${rows}</ul>
        ${hostControls}
        ${this.error ? `<p class="pk-error" role="alert">${esc(this.error)}</p>` : ''}
        <button type="button" class="pk-link" data-act="leave">${esc(t('leave'))}</button>
      </div>`;
  }

  /** The table skeleton is built once per game; everything inside it updates in place.
   *  Layout cloned from the reference recording (2026-09-27): a league-style banner, the opponents
   *  in one curved row along the top, a flat blue felt with five sunken card slots and a sunken pot
   *  box, and at the bottom the player's two big cards beside one big glossy action button. */
  _renderTable(full) {
    if (full || !this.el.querySelector('.pk-table')) {
      this.el.innerHTML = `
        <div class="pk-table">
          <div class="pk-top">
            <div class="pk-ban">
              <div class="pk-ban-red"><span class="pk-ban-title">${esc(t('title'))}</span><span class="pk-ban-blinds"></span></div>
              <div class="pk-ban-cell"><small>${esc(t('ban_hand'))}</small><b class="pk-ban-hand"></b></div>
              <div class="pk-ban-cell is-rank"><small>${esc(t('ban_rank'))}</small><b class="pk-ban-rank"></b><small class="pk-ban-of"></small></div>
              <div class="pk-ban-cell"><small>${esc(t('ban_up'))}</small><b class="pk-ban-up"></b></div>
              <button type="button" class="pk-ban-info" data-act="help" aria-label="${esc(t('help'))}">i</button>
            </div>
          </div>
          <div class="pk-strip">
            <span class="pk-topcode" data-role="mp-code" hidden></span>
            <button type="button" class="pk-redx" data-act="leave" aria-label="${esc(t('leave_table'))}">&#x2715;</button>
            <div class="pk-opps"></div>
          </div>
          <div class="pk-felt" data-act="felt">
            <div class="pk-bets"></div>
            <div class="pk-msg" aria-live="polite"></div>
            <div class="pk-board"></div>
            <div class="pk-potrow">
              <button type="button" class="pk-lastbtn" data-act="last" hidden aria-label="${esc(t('last_hand'))}"><span aria-hidden="true">&#x21BA;</span><small>${esc(t('last_hand'))}</small></button>
              <div class="pk-potbox"></div>
              <div class="pk-mybet"></div>
            </div>
            <div class="pk-raisebar" hidden></div>
            <div class="pk-banner" hidden></div>
          </div>
          <div class="pk-bottom">
            <div class="pk-left">
              <div class="pk-acttabs"></div>
              <div class="pk-mycards"></div>
            </div>
            <div class="pk-right">
              <button type="button" class="pk-bigbtn" data-act="big" disabled></button>
              <div class="pk-stackline"></div>
            </div>
          </div>
        </div>`;
      this.seatSig = '';
      this.actSig = '';
      if (this.ro) { this.ro.disconnect(); this.ro.observe(this.el.querySelector('.pk-table')); }
    }
    this._paintTable();
  }

  /** Opponents in table order, starting from the seat on this player's left. */
  _opps() {
    const n = this.pub.players.length;
    const my = this.myIdx;
    const out = [];
    for (let r = my >= 0 ? 1 : 0; r < n; r++) out.push((Math.max(0, my) + r) % n);
    return out;
  }

  _paintTable() {
    const pub = this.pub;
    const q = (s) => this.el.querySelector(s);
    if (!pub || !q('.pk-table')) return;
    const h = pub.hand;
    const res = h && h.result;
    const meP = this.myIdx >= 0 ? pub.players[this.myIdx] : null;
    if (pub.handNo !== this.seenHand) { this.seen = new Set(); this.seenHand = pub.handNo; }

    // --- banner
    if (h && h.sb) q('.pk-ban-blinds').textContent = `${money(h.sb)}/${money(h.bb)}`;
    const tierNow = tierById(pub.cfg && pub.cfg.tier);
    q('.pk-ban-title').textContent = tierNow ? t('tier_' + tierNow.id) : t('title');
    q('.pk-ban-hand').textContent = String(pub.handNo || 0);
    const alive = pub.players.filter((p) => !p.out);
    if (meP && !meP.out) {
      q('.pk-ban-rank').textContent = placeText(1 + alive.filter((p) => p.chips > meP.chips).length);
      q('.pk-ban-of').textContent = t('ban_of', { n: alive.length });
    } else {
      q('.pk-ban-rank').textContent = meP ? placeText(meP.place) : '-';
      q('.pk-ban-of').textContent = '';
    }
    const per = SPEEDS[(pub.cfg && pub.cfg.speed) || 'normal'] || 10;
    const left = per - ((Math.max(1, pub.handNo) - 1) % per);
    q('.pk-ban-up').textContent = t('ban_up_in', { n: left });
    const codeEl = q('.pk-topcode');
    if (this.mp) { codeEl.hidden = false; codeEl.textContent = this.mp.code; } else codeEl.hidden = true;

    // --- the winner(s) and, at a showdown, the five cards that won
    // A pot that is only someone's own uncalled bet coming back (`back`) is not a win (2026-10-05,
    // Matt: Rosa showed WIN +$9,500 on a hand Tex won; $2,050 of it was her own chips). A player who
    // only shared pots gets SPLIT, not WIN.
    const winners = new Set();
    const soloWin = new Set();
    const won = {};
    if (res) res.pots.forEach((p) => {
      if (p.back) return;
      p.winners.forEach((w) => {
        winners.add(w);
        if (p.winners.length === 1) soloWin.add(w);
        won[w] = (won[w] || 0) + Math.floor(p.amount / p.winners.length);
      });
    });
    const mainWinner = res && res.pots.length ? res.pots[0].winners[0] : -1;
    let best = null;
    if (res && !res.noShow && res.reveal && res.reveal[mainWinner]) best = bestFive([...res.reveal[mainWinner], ...h.board]);
    const bestSet = new Set(best ? best.cards : []);
    const everyone = this.revealAll === pub.handNo && this.table ? this.table.state.hand && this.table.state.hand.holes : null;

    // --- every opponent's move, read from the hand's public log (2026-10-02, Matt: "add 'check'
    // somewhere when the computer checks ... it's not obvious that they did anything"). h.last
    // alone could not show it: the move that ENDS a betting round is cleared by nextStreet in the
    // same call that made it, so a closing check or call was never on screen at all. Each new
    // log entry is held for MOVE_MS whatever the engine does next; a first paint (a resume)
    // replays nothing.
    const now = Date.now();
    if (h && this.moveSeen && this.moveSeen.hand !== pub.handNo) { this.moves = {}; this.moveSeen = { hand: pub.handNo, n: 0 }; }
    const log = (h && h.log) || [];
    if (!this.moveSeen) this.moveSeen = { hand: pub.handNo, n: log.length };
    if (log.length > this.moveSeen.n) {
      for (let x = this.moveSeen.n; x < log.length; x++) {
        const e = log[x];
        if (e && e.i !== this.myIdx && e.a !== 'left') this.moves[e.i] = { a: e.a, until: now + MOVE_MS, popped: false };
      }
      this._later(() => this._paintTable(), MOVE_MS + 30);
    }
    this.moveSeen.n = log.length;

    // --- opponents strip
    const opps = this._opps();
    const sig = `${pub.players.length}:${this.myIdx}`;
    const oppsEl = q('.pk-opps');
    if (sig !== this.seatSig) {
      this.seatSig = sig;
      oppsEl.innerHTML = opps.map((j) => `<div class="pk-opp" data-j="${j}"></div>`).join('');
      this._layout();
    }
    const left2 = this.clockEnd - Date.now();
    opps.forEach((j) => {
      const p = pub.players[j];
      const el = oppsEl.querySelector(`[data-j="${j}"]`);
      if (!el) return;
      const inHand = h && h.inHand && h.inHand[j];
      const folded = h && h.folded && h.folded[j] && !p.out;
      const isTurn = h && !res && h.toAct === j;
      const isWin = res && winners.has(j);
      let stamp = '', stampCls = '';
      const mv = this.moves[j];
      if (isWin) stamp = t(soloWin.has(j) ? 'st_win' : 'st_split');
      else if (p.out) stamp = p.left ? t('st_left') : t('st_out');
      else if (p.away || p.sitOut) stamp = t('st_away');
      else if (mv && mv.until > now) {
        stamp = t('st_' + mv.a);
        stampCls = mv.popped ? ' is-fresh' : ' is-fresh is-pop';   // the pop plays once, not every repaint
        mv.popped = true;
      } else if (h && h.last && h.last[j]) stamp = t('st_' + h.last[j].a);
      const shown = (res && res.reveal && res.reveal[j]) || (everyone && everyone[j]);
      let cards = '';
      if (shown) cards = `<span class="pk-ocards is-up">${shown.map((c) => cardHTML(c, 'is-mini' + (bestSet.has(c) ? ' is-best' : ''))).join('')}</span>`;
      else if (inHand) cards = '<span class="pk-ocards"><i></i><i></i></span>';
      const clock = isTurn && left2 > 0 ? `<span class="pk-clock"><i style="--f:${Math.min(1, left2 / CLOCK_MS).toFixed(3)};animation-duration:${left2}ms"></i></span>` : '';
      el.className = `pk-opp${folded || p.out ? ' is-dim' : ''}${isTurn ? ' is-turn' : ''}${isWin ? ' is-winner' : ''}${shown ? ' has-cards' : ''}`;
      el.innerHTML = `
        <span class="pk-oname">${esc(p.name)}</span>
        <span class="pk-oav"><span class="pk-oemoji">${esc(p.emoji)}</span>${cards}${stamp ? `<span class="pk-stamp${stampCls}">${esc(stamp)}</span>` : ''}</span>
        <span class="pk-ostack">${isWin ? '+' + money(won[j]) : money(p.chips)}</span>${clock}`;
    });

    // --- bets on the felt under each opponent, and the dealer button
    const betsEl = q('.pk-bets');
    let bh = '';
    if (h && !res) {
      opps.forEach((j) => {
        if (h.bets[j] > 0) bh += `<span class="pk-betchip" style="left:${(this.oppX && this.oppX[j]) || 0}px"><i class="pk-chip" aria-hidden="true"></i><span>${money(h.bets[j])}</span></span>`;
      });
    }
    if (pub.button >= 0 && pub.button !== this.myIdx && this.oppX && this.oppX[pub.button] != null) {
      bh += `<span class="pk-dbtn" style="left:${this.oppX[pub.button] - 30}px" title="${esc(t('dealer'))}">D</span>`;
    }
    betsEl.innerHTML = bh;
    const myBet = h && !res && this.myIdx >= 0 && h.bets[this.myIdx] > 0 ? h.bets[this.myIdx] : 0;
    q('.pk-mybet').innerHTML = (myBet ? `<span class="pk-betchip is-mine"><i class="pk-chip" aria-hidden="true"></i><span>${money(myBet)}</span></span>` : '')
      + (pub.button === this.myIdx && this.myIdx >= 0 ? `<span class="pk-dbtn is-mine" title="${esc(t('dealer'))}">D</span>` : '');

    // --- message, board, pot
    // Folded (or out) against the computers: the rest of the hand can be skipped with one tap.
    const canSkip = this.kind === 'solo' && this.table && meP && h && !res && !pub.over
      && (meP.out || (h.folded && h.folded[this.myIdx])) && !this.table._fast();
    const msg = this._message();
    const msgEl = q('.pk-msg');
    msgEl.innerHTML = msg.map((m) => `<span class="pk-ml${m.mine ? ' is-mine' : ''}">${esc(m.text)}</span>`).join('');
    msgEl.hidden = !msg.length;
    msgEl.classList.toggle('is-multi', msg.length > 1);
    // 2026-10-05, Matt: "The only way you can tell I won this hand is the tiny 'you win' in
    // regular text". A hand this player won gets a gold message, a YOU WIN stamp on their own
    // cards and the chips won beside their stack - the same three cues an opponent's win has.
    const iWon = !!(res && meP && winners.has(this.myIdx));
    betsEl.hidden = msg.length > 0 && !!res;
    const board = (h && h.board) || [];
    let bd = '';
    for (let k = 0; k < 5; k++) bd += k < board.length ? this._card(board[k], bestSet.size ? (bestSet.has(board[k]) ? 'is-best' : 'is-dim') : '', k) : '<div class="pk-slot"></div>';
    q('.pk-board').innerHTML = bd;
    const pot = h ? potTotal(h) : 0;
    let potHTML = '';
    if (res) potHTML = `<span class="pk-tapnext">${esc(pub.over ? t('tap_results') : this.kind === 'solo' ? t('tap_next') : t('next_soon'))}</span>`;
    else if (pot > 0) potHTML = `<span class="pk-potchips" aria-hidden="true"><i class="pk-chip"></i><i class="pk-chip"></i><i class="pk-chip"></i></span><span class="pk-potamt">${money(pot)}</span>`;
    if (canSkip) potHTML += `<span class="pk-skiphint">${esc(t('tap_skip'))}</span>`;
    q('.pk-potbox').innerHTML = potHTML;
    q('.pk-felt').classList.toggle('is-tappable', !!((res && (pub.over || this.kind === 'solo')) || canSkip));
    const lastBtn = q('.pk-lastbtn');
    if (lastBtn) lastBtn.hidden = !this.lastHand;

    // --- my cards
    const mine = q('.pk-mycards');
    const shownMine = res && res.reveal && res.reveal[this.myIdx];
    if (meP && this.hole && h && (shownMine || (!meP.out && (h.inHand[this.myIdx] || h.folded[this.myIdx])))) {
      const dim = !shownMine && h.folded[this.myIdx];
      let winStamp = '';
      if (iWon) {
        const pop = this.winPopped !== `${pub.gid || ''}:${pub.handNo}`;
        this.winPopped = `${pub.gid || ''}:${pub.handNo}`;
        winStamp = `<span class="pk-mywin${pop ? ' is-pop' : ''}">${esc(t(soloWin.has(this.myIdx) ? 'st_you_win' : 'st_split'))}</span>`;
      }
      mine.innerHTML = this.hole.map((c) => this._card(c, 'is-big' + (dim ? ' is-dim' : (bestSet.size ? (bestSet.has(c) ? ' is-best' : ' is-dim') : '')))).join('') + winStamp;
    } else if (!meP) {
      mine.innerHTML = `<p class="pk-note">${esc(t('next_game_wait'))}</p>`;
    } else if (meP.out) {
      mine.innerHTML = `<p class="pk-note">${esc(t('you_are_out', { place: placeText(meP.place) }))}</p>`;
    } else mine.innerHTML = '';
    q('.pk-stackline').innerHTML = meP ? (iWon ? `<b class="pk-mygain">+${esc(money(won[this.myIdx] || 0))}</b>` : '') + esc(t('stack_n', { n: money(meP.chips) })) : '';

    this._paintBanner();
    this._paintActions();
  }

  _card(c, cls, k) {
    const key = `${this.seenHand}:${c}`;
    let anim = '';
    if (!this.seen.has(key)) { this.seen.add(key); anim = ' is-new'; }
    const delay = k != null && anim ? ` style="animation-delay:${(k % 3) * 90}ms"` : '';
    return cardHTML(c, (cls || '') + anim).replace('<div class="pk-card', `<div${delay} class="pk-card`);
  }

  /** The result, one line per pot that was actually won (2026-10-05, Matt: only the main pot was
   *  ever named, so a side pot you split with Rosa showed nowhere). Uncalled chips coming back are
   *  not a pot anybody won and get no line. Each line: { text, mine }. */
  _message() {
    const pub = this.pub, h = pub && pub.hand;
    if (!h || !h.result) return [];
    const res = h.result;
    const name = (j) => (pub.players[j] ? pub.players[j].name : '');
    const pots = res.pots.filter((p) => !p.back);
    const lines = pots.map((p, k) => {
      const mine = p.winners.includes(this.myIdx);
      const w = p.winners[0];
      let text;
      if (res.noShow) text = w === this.myIdx ? t('msg_you_take', { n: fmt(p.amount) }) : t('msg_takes', { name: name(w), n: fmt(p.amount) });
      else if (p.winners.length > 1) {
        const names = (mine ? [t('msg_you')] : []).concat(p.winners.filter((j) => j !== this.myIdx).map(name));
        text = t('msg_split_names', { names: joinNames(names), n: fmt(p.amount) });
      } else if (res.scores[w] == null) text = w === this.myIdx ? t('msg_you_take', { n: fmt(p.amount) }) : t('msg_takes', { name: name(w), n: fmt(p.amount) });
      else if (k > 0) text = w === this.myIdx ? t('msg_you_win_n', { n: fmt(p.amount) }) : t('msg_wins_n', { name: name(w), n: fmt(p.amount) });
      else {
        const hand = handName(res.scores[w]);
        text = w === this.myIdx ? t('msg_you_win', { n: fmt(p.amount), hand }) : t('msg_wins', { name: name(w), n: fmt(p.amount), hand });
      }
      if (k > 0) text = t('side_pot') + ': ' + text;
      return { text, mine };
    });
    // Room on the felt for three lines; the rest are in the Last hand sheet. A pot this player won
    // is never the one folded away.
    if (lines.length <= 3) return lines;
    const keep = [lines[0], ...lines.slice(1).filter((l) => l.mine)].slice(0, 2);
    if (keep.length < 2) keep.push(lines[1]);
    keep.push({ text: t('msg_more_pots', { n: lines.length - 2 }), mine: false });
    return keep;
  }

  _paintBanner() {
    const el = this.el.querySelector('.pk-banner');
    if (!el) return;
    let msg = '';
    if (this.mp && this.mp.hostAway) msg = t('host_away');
    else if (this.error) msg = this.error;
    else if (this.flash) msg = this.flash;
    el.hidden = !msg;
    el.textContent = msg;
  }

  /** The FOLD / SET RAISE tabs, the raise bar, and the one big action button. */
  _paintActions() {
    const tabs = this.el.querySelector('.pk-acttabs');
    const big = this.el.querySelector('.pk-bigbtn');
    const bar = this.el.querySelector('.pk-raisebar');
    if (!tabs || !big) return;
    const pub = this.pub, h = pub && pub.hand;
    const meP = this.myIdx >= 0 ? pub.players[this.myIdx] : null;
    const myTurn = !!(meP && h && !h.result && h.toAct === this.myIdx && !this.sending && !meP.sitOut && !meP.away);
    const L = myTurn ? legal(pub) : null;
    if (!L) this.raise = null;
    const r = this.raise;
    const handKey = `${pub.gid || ''}:${pub.handNo}`;
    const canPre = !!(meP && h && !h.result && !myTurn && h.inHand && h.inHand[this.myIdx] && !(h.allIn && h.allIn[this.myIdx]) && !meP.sitOut && !meP.away);
    const preOn = this.precf === handKey;
    let mode = 'idle';
    if (meP && (meP.sitOut || meP.away) && !meP.out) mode = 'back';
    else if (L) mode = r ? 'raise' : (L.canCheck ? 'check' : 'call');
    else if (canPre) mode = 'precf';
    else if (h && h.result && this.kind === 'solo' && this.revealAll !== pub.handNo && !pub.over) mode = 'reveal';
    // "Check / Fold" ticked and the turn has come round: check if nothing is owed, otherwise fold.
    // It stays on for the rest of the hand, so it keeps checking until somebody bets.
    if (L && preOn && !r && this.autoK !== pub.k) {
      this.autoK = pub.k;
      const k = pub.k;
      this._later(() => {
        const L2 = this.pub && this.pub.k === k ? legal(this.pub) : null;
        if (L2 && L2.i === this.myIdx && this.precf === handKey) this._move({ a: L2.canCheck ? 'check' : 'fold' });
      }, 350);
    }
    const sig = `${mode}:${pub.k}:${r ? 1 : 0}:${this.revealAll === pub.handNo}:${preOn}:${this.drag ? 1 : 0}`;
    if (sig !== this.actSig) {
      this.actSig = sig;
      const inHand = meP && h && !h.result && h.inHand && h.inHand[this.myIdx];
      tabs.innerHTML = inHand || L ? `
        <button type="button" class="pk-tab2" data-act="fold" ${L && !L.canCheck ? '' : 'disabled'}>${esc(t('fold'))}</button>
        ${L && L.canRaise ? `<button type="button" class="pk-tab2 pk-raisehandle${r ? ' is-on' : ''}" data-act="raise-toggle" data-drag="raise" aria-label="${esc(t('raise_aria'))}">${esc(r && !this.drag ? t('cancel') : t('raise_drag'))}</button>` : ''}` : '';
      if (r && L && !this.drag) {
        bar.hidden = false;
        bar.innerHTML = `
          <div class="pk-barpot"><i class="pk-chip" aria-hidden="true"></i>${esc(t('pot', { n: money(L.pot) }))}</div>
          <div class="pk-presets">
            <button type="button" class="pk-pre" data-act="preset" data-p="min">${esc(t('min'))}</button>
            <button type="button" class="pk-pre" data-act="preset" data-p="half">${esc(t('half_pot'))}</button>
            <button type="button" class="pk-pre" data-act="preset" data-p="pot">${esc(t('pot_btn'))}</button>
            <button type="button" class="pk-pre" data-act="preset" data-p="max">${esc(t('allin'))}</button>
          </div>
          <input type="range" class="pk-slider" data-role="raise" min="${L.minTo}" max="${L.maxTo}" step="${Math.max(1, h.sb)}" value="${r.to}" aria-label="${esc(L.isBet ? t('bet') : t('raise'))}">`;
      } else { bar.hidden = true; bar.innerHTML = ''; }
    }
    // The big button's label changes with the slider, so it is refreshed on every paint.
    big.className = 'pk-bigbtn' + (mode === 'idle' ? '' : ' is-live') + (mode === 'check' ? ' is-check' : '');
    big.disabled = mode === 'idle';
    big.dataset.mode = mode;
    const chips = '<span class="pk-bigchips" aria-hidden="true"><i class="pk-chip"></i><i class="pk-chip is-pink"></i><i class="pk-chip"></i></span>';
    let label = '';
    if (mode === 'check') label = `<span class="pk-biglbl">${esc(t('big_check'))}</span><svg class="pk-tick" viewBox="0 0 48 40" aria-hidden="true"><path d="M4 22 L17 34 L44 5" fill="none" stroke="#1f7a12" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 22 L17 34 L44 5" fill="none" stroke="#7ddf2a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    else if (mode === 'call') label = `<span class="pk-biglbl">${esc(L.callAmt >= meP.chips ? t('big_allin', { n: money(L.callAmt) }) : t('big_call', { n: money(L.callAmt) }))}</span>${chips}`;
    else if (mode === 'raise') {
      const to = Math.max(L.minTo, Math.min(L.maxTo, r.to));
      const key = to >= L.maxTo ? 'big_allin' : (L.isBet ? 'big_bet' : 'big_raise');
      label = `<span class="pk-biglbl">${esc(t(key, { n: money(to) }))}</span>${chips}`;
    } else if (mode === 'reveal') label = `<span class="pk-biglbl is-small">${esc(t('see_cards'))}</span><svg class="pk-gem" viewBox="0 0 40 32" aria-hidden="true"><path d="M8 2 H32 L39 11 L20 31 L1 11 Z" fill="#2fd07a" stroke="#0f7a3e" stroke-width="2"/><path d="M1 11 H39 M14 2 L10 11 L20 31 L30 11 L26 2" fill="none" stroke="#0f7a3e" stroke-width="1.5"/></svg>`;
    else if (mode === 'back') label = `<span class="pk-biglbl">${esc(t('im_back'))}</span>`;
    else if (mode === 'precf') label = `<span class="pk-cfbox${preOn ? ' is-on' : ''}" aria-hidden="true">${preOn ? '&#x2714;' : ''}</span><span class="pk-biglbl">${esc(t('check_fold'))}</span>`;
    big.classList.toggle('is-pre', mode === 'precf');
    big.setAttribute('aria-pressed', mode === 'precf' ? String(preOn) : 'false');
    big.innerHTML = label;
  }

  _renderOverlay() {
    let ov = this.el.querySelector('.pk-overlay');
    const want = this.overlay;
    if (!want) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'pk-overlay';
      this.el.appendChild(ov);
    }
    const sig = want + ':' + (want === 'last' ? (this.lastHand && this.lastHand.key) : (this.pub ? this.pub.k : '')) + ':' + (this.confirm || '');
    if (ov.dataset.sig === sig) return;
    ov.dataset.sig = sig;
    if (want === 'help') {
      ov.innerHTML = `<div class="pk-modal" role="dialog" aria-modal="true" aria-label="${esc(t('help'))}">
          <button type="button" class="pk-x" data-act="close" aria-label="${esc(t('done'))}">&#x2715;</button>
          <p class="pk-help-goal"><b>${esc(t('help_goal'))}</b></p>
          <div class="pk-label">${esc(t('help_rank'))}</div>
          <ol class="pk-ranks">${HELP_HANDS.map((cards, k) => `<li><span class="pk-rname">${esc(t('hn_' + (9 - k)))}</span><span class="pk-rcards">${cards.map(([r, s]) => cardHTML(r * 4 + s, 'is-tiny')).join('')}</span></li>`).join('')}</ol>
          <p class="pk-hint">${esc(t('help_blinds', { chips: money(START_CHIPS) }))}</p>
        </div>`;
    } else if (want === 'last') {
      ov.innerHTML = this._lastHandHTML();
    } else if (want === 'confirm') {
      // Step away (2026-09-28, Matt: "join a tournament, leave, then resume the same tourney").
      // The first choice keeps the game: solo it stays saved and "Resume tournament" brings it
      // back; online the seat stays yours and "Back to table" returns to it. Giving up is the
      // second, smaller choice, and it says it counts as a loss.
      const host = this.kind === 'host';
      const solo = this.kind === 'solo';
      ov.innerHTML = `<div class="pk-modal pk-modal-sm" role="dialog" aria-modal="true">
          <p class="pk-confirm">${esc(t(solo ? 'leave_solo_q' : host ? 'leave_host_q' : 'leave_guest_q'))}</p>
          <div class="pk-leavecol">
            <button type="button" class="pk-btn pk-btn-primary" data-act="stepaway">${esc(t(solo ? 'save_leave' : 'step_away'))}</button>
            <p class="pk-hint pk-center-text">${esc(t(solo ? 'save_leave_hint' : host ? 'step_away_host_hint' : 'step_away_hint'))}</p>
            <button type="button" class="pk-btn pk-btn-fold" data-act="leave-go">${esc(t(host ? 'close_table' : 'give_up'))}</button>
            <button type="button" class="pk-btn" data-act="close">${esc(t('cancel'))}</button>
          </div></div>`;
    } else if (want === 'giveup') {
      ov.innerHTML = `<div class="pk-modal pk-modal-sm" role="dialog" aria-modal="true">
          <p class="pk-confirm">${esc(t('give_up_confirm'))}</p>
          <div class="pk-actrow">
            <button type="button" class="pk-btn" data-act="close">${esc(t('cancel'))}</button>
            <button type="button" class="pk-btn pk-btn-fold" data-act="giveup-go">${esc(t('give_up'))}</button>
          </div></div>`;
    } else if (want === 'over') {
      const pub = this.pub;
      const ranked = pub.players.slice().sort((a, b) => (a.place || 99) - (b.place || 99));
      const meP = this.myIdx >= 0 ? pub.players[this.myIdx] : null;
      const title = meP ? (pub.winner === this.myIdx ? t('you_win') : t('you_place', { place: placeText(meP.place) })) : t('winner_is', { name: pub.players[pub.winner] ? pub.players[pub.winner].name : '' });
      let btns;
      if (this.kind === 'solo') btns = `<button type="button" class="pk-btn" data-act="to-setup">${esc(t('setup'))}</button><button type="button" class="pk-btn pk-btn-primary" data-act="again">${esc(t('play_again'))}</button>`;
      else if (this.kind === 'host') btns = `<button type="button" class="pk-btn" data-act="to-lobby">${esc(t('change_players'))}</button><button type="button" class="pk-btn pk-btn-primary" data-act="again-net">${esc(t('new_game'))}</button>`;
      else btns = `<p class="pk-waiting">${esc(t('waiting_host'))}</p>`;
      ov.innerHTML = `<div class="pk-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <button type="button" class="pk-x" data-act="close" aria-label="${esc(t('done'))}">&#x2715;</button>
          <h2 class="pk-over-title">${esc(title)}</h2>
          ${this._myPrize() ? `<p class="pk-prize">${esc(t('prize_won', { n: bigMoney(this._myPrize()) }))}</p>` : ''}
          ${pub.cfg && pub.cfg.buyin > 0 ? `<p class="pk-hint">${esc(t('bankroll'))}: ${esc(bigMoney(this.bank()))}</p>` : ''}
          <ol class="pk-final">${ranked.map((p) => `<li class="${p.id === pub.winner ? 'is-first' : ''}"><span class="pk-fplace">${esc(placeText(p.place || 0))}</span><span class="pk-lav">${esc(p.emoji)}</span><span class="pk-lname">${esc(p.id === this.myIdx ? t('you') : p.name)}</span></li>`).join('')}</ol>
          <div class="pk-actrow">${btns}</div>
        </div>`;
    }
  }

  /** Measured, not a vh formula: the hub's chrome and a phone's toolbars both change what is left.
   *  Opponents sit on a shallow arc (edges lower, names and stacks tilted with it) like the
   *  reference; the board cards size to whatever height the felt actually has. */
  _layout() {
    if (this.screen === 'bank') { this.render(); return; }   // re-fit the list to the new height
    const strip = this.el.querySelector('.pk-strip');
    const felt = this.el.querySelector('.pk-felt');
    const bottom = this.el.querySelector('.pk-bottom');
    if (!strip || !felt || !this.pub) return;
    const W = strip.clientWidth, FH = felt.clientHeight;
    if (!W || !FH) { requestAnimationFrame(() => this._layout()); return; }
    const opps = this._opps();
    const m = Math.max(1, opps.length);
    const av = Math.round(Math.max(36, Math.min(62, (W - 12) / m - 12)));
    strip.style.setProperty('--pk-av', av + 'px');
    this.oppX = {};
    strip.querySelectorAll('.pk-opp').forEach((el, k) => {
      // 16px kept clear at each end so the outermost seats never sit under the red close button.
      const x = 16 + (W - 32) * (k + 0.5) / m;
      const tt = m > 1 ? (k + 0.5) / m * 2 - 1 : 0;
      el.style.left = Math.round(x) + 'px';
      el.style.top = Math.round(tt * tt * av * 0.6) + 'px';
      el.style.setProperty('--pk-tilt', (tt * 13).toFixed(1) + 'deg');
      this.oppX[+el.dataset.j] = Math.round(x);
    });
    const cw = Math.round(Math.max(32, Math.min((W - 24 - 4 * 6) / 5, (FH - 118) / 1.4, 96)));
    felt.style.setProperty('--pk-cw', cw + 'px');
    if (bottom) {
      const bh = bottom.clientHeight;
      const hw = Math.round(Math.max(60, Math.min(W * 0.3, (bh - 58) / 1.4, 150)));
      bottom.style.setProperty('--pk-hw', hw + 'px');
    }
    {
      // The quick-chat button floats bottom-right by default, which is exactly where the big action
      // button lives here; lift it to the felt's lower-left corner instead.
      const fab = document.querySelector('.mpr-layer .mpr-fab');
      if (fab && bottom) { fab.style.bottom = (bottom.getBoundingClientRect().height + 10) + 'px'; fab.style.right = 'auto'; fab.style.left = '10px'; }
    }
    this._paintTable();
  }

  // ----------------------------------------------------------------------- input ---

  _click(e) {
    if (!e.fromDrag && this.noClickUntil && Date.now() < this.noClickUntil) { this.noClickUntil = 0; return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || (!e.fromDrag && !this.el.contains(b))) return;
    const a = b.dataset.act;
    switch (a) {
      case 'set': return this._set(b.dataset.k, b.dataset.v);
      case 'bots': this.settings.bots = Math.max(1, Math.min(7, this.settings.bots + (+b.dataset.d))); this._saveSettings(); return this.render();
      case 'choose': this.screen = 'tiers'; this._refreshBank(); return this.render(true);
      case 'bank':
        this.bankFrom = this.screen;
        this.screen = 'bank';
        this._refreshBank();
        this._loadBankList();
        return this.render(true);
      case 'bank-back': this.screen = this.bankFrom === 'tiers' ? 'tiers' : 'setup'; return this.render(true);
      case 'bank-sort': this.bankSort = b.dataset.v === 'won' ? 'won' : 'bank'; return this.render();
      case 'bank-retry': this._loadBankList(); return undefined;
      case 'deal': return this._newSolo(b.dataset.tier);
      case 'to-setup-tab': this.screen = 'setup'; return this.render(true);
      case 'topup': {
        // Never more than the starting stake in one top-up (the stats layer refuses anything bigger).
        const need = Math.min(HOLDEM_START_BANK, HOLDEM_START_BANK - this.bank());
        if (need > 0 && this.bank() < TIERS[0].buyin) recordHoldemBank({ grant: need });
        return this.render(true);
      }
      case 'nettier': {
        // The host can only choose a table they can afford themselves; none = just for fun.
        const bal = this.bank();
        const opts = [null, ...TIERS.filter((x) => x.buyin <= bal)];
        let i = opts.findIndex((x) => (x ? x.id : null) === (this.settings.netTier || null));
        if (i < 0) i = 0;
        i = (i + (+b.dataset.d) + opts.length) % opts.length;
        this.settings.netTier = opts[i] ? opts[i].id : null;
        this._saveSettings();
        this._pushLobby();
        return this.render();
      }
      case 'help': this.overlay = 'help'; return this._renderOverlay();
      case 'last': if (this.lastHand) { this.overlay = 'last'; this._renderOverlay(); } return undefined;
      case 'close':
        if (this.overlay === 'over') this.overDismissed = this.pub && this.pub.k;
        this.overlay = null; return this._renderOverlay();
      case 'create': return this._create();
      case 'join': return this._join();
      case 'rejoin': return this._rejoin();
      case 'addbot': return this._addBot();
      case 'rmbot': this.mp.bots.splice(+b.dataset.i, 1); this._pushLobby(); return this.render();
      case 'startnet': return this._startNet();
      case 'leave': return this._leaveAsk();
      case 'leave-go': this.overlay = null; return this._leave();
      case 'stepaway': this.overlay = null; return this._stepAway();
      case 'resume': { const sv = this._soloSave(); if (sv) this._startSolo(sv.state); else this.render(true); return undefined; }
      case 'giveup-saved': this.overlay = 'giveup'; return this._renderOverlay();
      case 'giveup-go': this.overlay = null; this._forfeitSave(); return this.render(true);
      case 'fold': return this._move({ a: 'fold' });
      case 'raise-toggle': {
        if (this.raise) { this.raise = null; return this._paintActions(); }
        const L = legal(this.pub);
        if (!L) return;
        const pot = L.pot;
        const def = L.isBet ? Math.round(pot * 0.5) : this.pub.hand.currentBet * 2 + (pot - this.pub.hand.currentBet);
        this.raise = { to: Math.max(L.minTo, Math.min(L.maxTo, this._snap(def))) };
        return this._paintActions();
      }
      case 'preset': return this._preset(b.dataset.p);
      case 'big': {
        const mode = b.dataset.mode;
        if (mode === 'check') return this._move({ a: 'check' });
        if (mode === 'call') return this._move({ a: 'call' });
        if (mode === 'raise') {
          const L = legal(this.pub);
          const to = this.raise ? this.raise.to : 0;
          this.raise = null;
          return this._move(L && to >= L.maxTo ? { a: 'allin' } : { a: 'raise', to });
        }
        if (mode === 'reveal') { this.revealAll = this.pub.handNo; this.actSig = ''; return this._paintTable(); }
        if (mode === 'back') return this._back();
        if (mode === 'precf') {
          const key = `${this.pub.gid || ''}:${this.pub.handNo}`;
          this.precf = this.precf === key ? null : key;
          this.actSig = '';
          return this._paintActions();
        }
        return undefined;
      }
      case 'felt':
        // "Tap the table to start the next hand" (solo). Online the host deals on a timer.
        if (this.pub && this.pub.over) {
          // the last hand is on show (or the results were closed): bring the results up now
          if (this.overHold) this.overHold.until = 0;
          this.overDismissed = null;
          this._checkOver();
          return undefined;
        }
        if (this.kind !== 'solo' || !this.table || !this.pub || !this.pub.hand || this.pub.over) return undefined;
        if (this.pub.hand.result) { this.table.next(); return undefined; }
        {
          const meP = this.myIdx >= 0 ? this.pub.players[this.myIdx] : null;
          if (meP && meP.out) this.table.fastForward('game');
          else if (meP && this.pub.hand.folded && this.pub.hand.folded[this.myIdx]) this.table.fastForward('hand');
        }
        return undefined;
      case 'back': return this._back();
      case 'again': return this._newSolo((this.table && this.table.state.cfg.tier) || null);
      case 'to-setup': this._endSolo(); return;
      case 'again-net': return this._startNet();
      case 'to-lobby': return this._toLobby();
      default:
    }
  }

  /** Raise amount for a drag fraction 0..1. Squared, so the first half of the slide gives fine
   *  control over small raises and the top of it races to the whole stack. */
  _dragAmount(f, L) {
    if (f >= 0.96) return L.maxTo;
    const raw = L.minTo + (L.maxTo - L.minTo) * f * f;
    return Math.max(L.minTo, Math.min(L.maxTo, this._snap(raw)));
  }

  _dragStart(e) {
    const handle = e.target.closest && e.target.closest('[data-drag="raise"]');
    if (!handle || this.drag || e.button > 0) return;
    const L = legal(this.pub);
    if (!L || !L.canRaise) return;
    const table = this.el.querySelector('.pk-table');
    const felt = this.el.querySelector('.pk-felt');
    if (!table || !felt) return;
    const tb = table.getBoundingClientRect(), hb = handle.getBoundingClientRect(), fb = felt.getBoundingClientRect();
    const travel = Math.max(140, Math.min(420, hb.top - fb.top - 16));
    const meter = document.createElement('div');
    meter.className = 'pk-dragmeter';
    meter.setAttribute('aria-hidden', 'true');
    meter.style.left = Math.round(hb.left - tb.left + hb.width / 2) + 'px';
    meter.style.bottom = Math.round(tb.bottom - hb.top + 6) + 'px';
    meter.style.height = Math.round(travel) + 'px';
    meter.innerHTML = `<span class="pk-dm-top">${esc(t('allin'))}</span><span class="pk-dm-track"><i></i></span><span class="pk-dm-bubble"></span>`;
    table.appendChild(meter);
    this.drag = { id: e.pointerId, y0: e.clientY, travel, moved: false, meter, prev: this.raise };
    try { this.el.setPointerCapture(e.pointerId); } catch { /* the gesture still works without capture */ }
    this._dragMove(e);
  }

  _dragMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const L = legal(this.pub);
    if (!L) return this._dragEnd(e, true);
    const dy = d.y0 - e.clientY;
    if (Math.abs(dy) > 10) d.moved = true;
    const f = Math.max(0, Math.min(1, dy / d.travel));
    const to = this._dragAmount(f, L);
    d.to = to;
    d.cancel = d.moved && dy < 14;
    if (d.moved) {
      if (!this.raise || this.raise.to !== to) { this.raise = { to }; this._paintActions(); }
      e.preventDefault();
    }
    const fill = d.meter.querySelector('.pk-dm-track i');
    const bubble = d.meter.querySelector('.pk-dm-bubble');
    fill.style.transform = `scaleY(${f.toFixed(3)})`;
    bubble.style.transform = `translate(-50%, ${(-f * d.travel).toFixed(1)}px)`;
    bubble.textContent = d.cancel ? t('cancel') : (to >= L.maxTo ? t('allin') : money(to));
    d.meter.classList.toggle('is-allin', to >= L.maxTo && !d.cancel);
  }

  _dragEnd(e, cancelled) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.meter.remove();
    try { this.el.releasePointerCapture(d.id); } catch { /* already released */ }
    // Pointer capture on the root re-targets the click, so a plain tap is handled HERE (open the
    // slider panel) and the click that follows is swallowed - same result by mouse or by touch.
    // Only THAT click: the next pointerdown clears this (2026-10-02, Matt: "if I raise, it makes
    // me click the raise button twice"). A 500ms window alone also ate a quick tap on RAISE TO
    // right after the RAISE tab, and every tap after a slide (no click follows one) for 500ms.
    this.noClickUntil = Date.now() + 500;
    if (!d.moved) {
      if (cancelled) return undefined;
      this.actSig = '';
      return this._click({ target: { closest: () => ({ dataset: { act: 'raise-toggle' }, disabled: false }) }, fromDrag: true });
    }
    const L = legal(this.pub);
    if (cancelled || d.cancel || !L) { this.raise = d.prev || null; this.actSig = ''; return this._paintActions(); }
    // Letting go only SETS the amount (2026-09-28, Matt: "it auto places the bet when I let go ...
    // make the main button into a raise $x so I can confirm it"). The big button now reads
    // RAISE TO / BET / ALL IN $X and the bet goes in only when that is tapped; the slider panel
    // opens too, so the amount can still be nudged or the raise cancelled.
    this.raise = { to: d.to };
    this.actSig = '';
    return this._paintActions();
  }

  _input(e) {
    const el = e.target;
    if (el.matches('[data-role="join-code"]')) {
      const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
      if (v !== el.value) el.value = v;
      this.joinCode = v;
      const btn = this.el.querySelector('[data-act="join"]');
      if (btn) btn.disabled = v.length !== CODE_LEN || this.busy;
    } else if (el.matches('[data-role="raise"]') && this.raise) {
      this.raise.to = +el.value;
      this._raiseLabel();
    }
  }

  _snap(v) {
    const h = this.pub && this.pub.hand;
    const u = Math.max(1, h ? h.sb : 1);
    return Math.round(v / u) * u;
  }

  _preset(p) {
    const L = legal(this.pub);
    if (!L || !this.raise) return;
    const h = this.pub.hand;
    const call = L.callAmt;
    let to;
    if (p === 'min') to = L.minTo;
    else if (p === 'max') to = L.maxTo;
    else {
      const frac = p === 'half' ? 0.5 : 1;
      to = h.currentBet + this._snap((L.pot + call) * frac);
    }
    this.raise.to = Math.max(L.minTo, Math.min(L.maxTo, to));
    const s = this.el.querySelector('[data-role="raise"]');
    if (s) s.value = this.raise.to;
    this._raiseLabel();
  }

  _raiseLabel() { this._paintActions(); }

  _set(k, v) {
    const s = this.settings;
    if (k === 'tab') s.tab = v === 'online' ? 'online' : 'solo';
    else if (k === 'skill' || k === 'netSkill') s[k] = +v;
    else if (k === 'speed' && SPEEDS[v]) s.speed = v;
    else if (k === 'pace' && PACES[v]) { s.pace = v; if (this.table) this.table.setPace(v); }
    this.error = '';
    this._saveSettings();
    if (this.screen === 'lobby' && this.mp && this.mp.host) this._pushLobby();
    this.render();
  }

  _saveSettings() { writeJSON(SETTINGS_KEY, this.settings); }

  // ----------------------------------------------------------------------- solo ---

  _newSolo(tierId) {
    const s = this.settings;
    const tier = tierById(tierId);
    if (tierId && (!tier || this.bank() < tier.buyin)) { this.screen = 'tiers'; return this.render(true); }
    const prof = loadProfile();
    const human = { name: (prof && prof.name) || t('you'), emoji: (prof && prof.emoji) || '\u{1F642}', bot: 0, dev: deviceId() };
    const players = [human, ...botRoster(s.bots, s.skill)];
    const state = newGame(players, { speed: s.speed, buyin: tier ? tier.buyin : 0, tier: tier ? tier.id : null });
    state.gid = rid();
    state.skill = s.skill;
    // The seat is paid for the moment the cards are dealt, before anything else can happen.
    if (tier) recordHoldemBank({ buyin: tier.buyin });
    this._saveSettings();
    this._startSolo(state);
  }

  _startSolo(state) {
    this._stopTable();
    this.kind = 'solo';
    this.mp = null;
    this.error = '';
    this.screen = 'table';
    this.overlay = null;
    this.overDismissed = null;
    this.table = new Table(state, { tapToDeal: true, pace: this.settings.pace, onChange: () => this._onLocalChange() });
    this.myIdx = state.players.findIndex((p) => !p.bot);
    this.render(true);
    this.table.start();
  }

  _endSolo() {
    this._stopTable();
    drop(SAVE_KEY);
    this.kind = null;
    this.screen = 'setup';
    this.overlay = null;
    this.pub = null;
    this.render(true);
  }

  /** The solo tournament saved on this device, if one is still being played. */
  _soloSave() {
    const sv = readJSON(SAVE_KEY);
    return sv && sv.state && !sv.state.over && Array.isArray(sv.state.players) ? sv : null;
  }

  /** "Buddy's House · hand 12 · $9,400" for the Resume button. */
  _saveLine(state) {
    const tier = tierById(state.cfg && state.cfg.tier);
    const me = state.players.find((p) => !p.bot) || {};
    const parts = [tier ? t('tier_' + tier.id) : t('title'), t('hand_n', { n: state.handNo || 1 })];
    if (me.out) parts.push(t('st_out')); else parts.push(t('stack_n', { n: money(me.chips) }));
    return parts.join(' \u00b7 ');
  }

  /** Leave the table WITHOUT giving the game up (Matt, 2026-09-28). Solo: the save stays exactly
   *  as it is (it is written after every change), so "Resume tournament" picks it up at the same
   *  hand. Online: the seat stays yours - the same as closing the app, which the host already
   *  treats as "away" (auto check/fold) - and "Back to table" rejoins. A host stepping away pauses
   *  the table for everyone until they come back, and the confirm says so. Nothing is recorded. */
  _stepAway() {
    if (this.kind === 'solo') {
      if (this.table) writeJSON(SAVE_KEY, { state: this.table.state, at: Date.now() });
      this._stopTable();
      this.settings.tab = 'solo';
    } else if (this.mp) {
      if (this.mp.host) this._saveMp();
      this._stopTable();
      clearTimeout(this.pubTimer); this.pubTimer = null;
      net.disconnect();
      this.mp = null;
      this.settings.tab = 'online';
    }
    this.kind = null;
    this.pub = null;
    this.screen = 'setup';
    this.overlay = null;
    this.raise = null;
    this.render(true);
  }

  /** Give up the tournament saved on this device from the setup screen: one loss, no prize (the
   *  same as walking away mid-game), then the save is cleared. Guarded by the save's own `rec`
   *  flag, so a game already recorded is never counted twice. */
  _forfeitSave() {
    const sv = this._soloSave();
    if (!sv) return;
    const st = sv.state;
    if (!st.rec) {
      st.rec = true;
      writeJSON(SAVE_KEY, { state: st, at: Date.now() });
      try { recordResult('holdem', SKILL_ID[st.skill] || 'medium', false); } catch (e) { console.warn('[holdem] stats write failed', e); }
    }
    drop(SAVE_KEY);
  }

  /** Solo and host: the dealer changed something. Save, draw, and (host) publish. */
  _onLocalChange() {
    const tb = this.table;
    if (!tb || this.dead) return;
    const s = tb.state;
    this.pub = publicView(s);
    // The game id rides the public view the guests get (_publish); the host's own copy needs it
    // too, or its once-per-game keys ("code:gid") are all "code:undefined" - which lost the host's
    // prize and merged every game in a room into one result.
    this.pub.gid = s.gid;
    this.hole = s.hand && s.hand.holes && s.hand.holes[this.myIdx] ? s.hand.holes[this.myIdx] : null;
    this.clockEnd = tb.clockEnd;
    this._maybeRecord();
    this._handEnd();
    if (this.kind === 'solo') writeJSON(SAVE_KEY, { state: s, at: Date.now() });
    else if (this.kind === 'host') { this._saveMp(); this._schedulePublish(); }
    if (this.screen === 'table') {
      this._paintTable();
      this._checkOver();
    }
  }

  _checkOver() {
    const pub = this.pub;
    if (pub && !pub.over) this.overHold = { key: null, until: 0, live: true };
    if (pub && pub.over && this.overDismissed !== pub.k && this.overlay !== 'over') {
      // The hand that ends the game must be SEEN before the results cover it (2026-10-05, Matt:
      // "I went all in. Then this appeared. I didn't see the last card"). The engine ends the game
      // in the same call that settles the hand, so the popup used to land on top of the runout and
      // the showdown. Hold it for the same pause the table gives any other result; a tap on the
      // felt skips the wait. A game first seen already over (a rejoin) shows it at once.
      const h = pub.hand;
      const hold = this.overHold;
      const key = `${pub.gid || ''}:${pub.handNo}`;
      if (hold && hold.live && h && h.result) {
        if (hold.key !== key) {
          hold.key = key;
          hold.until = Date.now() + RESULT_MS + 350 * (h.runout | 0);
          this._later(() => this._checkOver(), hold.until - Date.now() + 30);
        }
        if (Date.now() < hold.until) return;
      }
      this.overlay = 'over';
      this._renderOverlay();
    } else if (this.overlay === 'over' && this.pub && !this.pub.over) {
      this.overlay = null;
      this._renderOverlay();
    }
  }

  _stopTable() {
    if (this.table) { this.table.destroy(); this.table = null; }
    this.raise = null;
    this.sending = false;
  }

  // ----------------------------------------------------------------------- moves ---

  async _move(mv) {
    this.raise = null;
    if (this.kind === 'solo' || this.kind === 'host') {
      const r = this.table.submit(this.myIdx, mv);
      if (!r.ok) console.warn('[holdem] move refused', r.error, mv);
      return;
    }
    // guest: send, and hold the buttons until the host's table moves on
    const pub = this.pub;
    this.sending = true;
    this.actSig = '';
    this._paintActions();
    try {
      await NT.sendAct(this.mp.code, this.mp.seat, { g: pub.gid, h: pub.handNo, k: pub.k, a: mv.a, to: mv.to });
      this.error = '';
    } catch {
      this.sending = false;
      this.error = t('err_send');
      this.actSig = '';
      this._paintTable();
    }
    this._later(() => { if (this.sending && this.pub && this.pub.k === pub.k) { this.sending = false; this.actSig = ''; this._paintActions(); } }, 8000);
  }

  _back() {
    if (this.kind === 'guest') {
      NT.sendAct(this.mp.code, this.mp.seat, { g: this.pub.gid, a: 'back' }).catch(() => {});
      return;
    }
    if (this.table) this.table.back(this.myIdx);
  }

  // ----------------------------------------------------------------------- hands ---

  /** A hand just ended (solo, host and guest all come through here): keep it for the "Last hand"
   *  replay, and count it once in the per-hand stats (Matt, 2026-09-28: hands won, biggest pot,
   *  best hand ever). Everything read here is PUBLIC (engine.publicView) plus this device's own
   *  two cards, so a guest's numbers come from exactly what it was shown. */
  _handEnd() {
    const pub = this.pub, h = pub && pub.hand, res = h && h.result;
    if (!res || this.myIdx < 0) return;
    const key = `${pub.gid || ''}:${pub.handNo}`;
    if (this.lastHand && this.lastHand.key === key) return;
    const my = this.myIdx;
    const hole = this.hole ? this.hole.slice() : null;
    this.lastHand = {
      key, no: pub.handNo, board: (h.board || []).slice(), log: (h.log || []).slice(),
      pots: res.pots || [], reveal: res.reveal || {}, scores: res.scores || {}, noShow: !!res.noShow,
      names: pub.players.map((p) => ({ name: p.name, emoji: p.emoji })), folded: (h.folded || []).slice(),
      my, hole,
    };
    if (this.overlay === 'last') this._renderOverlay();
    // Counted only for a hand this player was actually dealt into (their two cards are known).
    if (!hole) return;
    const done = readJSON(HANDS_KEY);
    const list = Array.isArray(done) ? done : [];
    if (list.includes(key)) return;
    list.push(key);
    if (list.length > 40) list.splice(0, list.length - 40);
    writeJSON(HANDS_KEY, list);
    let amt = 0;
    res.pots.forEach((p) => { if (!p.back && p.winners.includes(my)) amt += Math.floor(p.amount / p.winners.length); });
    let score = 0, cat = -1, cards = [];
    if (!(h.folded && h.folded[my]) && (h.board || []).length === 5) {
      const bf = bestFive([...hole, ...h.board]);
      score = bf.score;
      cat = categoryOf(score);
      if (cat === 8 && scoreRanks(score)[0] === 12) cat = 9;     // a royal flush gets its own name
      cards = bf.cards;
    }
    try { recordHoldemHand({ won: amt > 0, amt, score, cat, cards }); } catch (e) { console.warn('[holdem] hand stats write failed', e); }
  }

  /** The "Last hand" sheet: the board, who won what with which hand, everybody's shown cards (and
   *  this player's own, even folded), then every action street by street. */
  _lastHandHTML() {
    const L = this.lastHand;
    if (!L) return `<div class="pk-modal pk-modal-sm" role="dialog" aria-modal="true"><button type="button" class="pk-x" data-act="close" aria-label="${esc(t('done'))}">&#x2715;</button><p>${esc(t('last_none'))}</p></div>`;
    const nm = (i) => (i === L.my ? t('last_you') : ((L.names[i] || {}).name || '?'));
    const tiny = (cs) => cs.map((c) => cardHTML(c, 'is-tiny')).join('');
    const results = L.pots.map((p, k) => {
      const who = p.winners.map(nm);
      let line;
      if (p.back) line = p.winners[0] === L.my ? t('last_you_back', { n: money(p.amount) }) : t('last_back', { name: who[0], n: money(p.amount) });
      else if (p.winners.length > 1) line = t('last_split', { names: who.join(', '), n: money(p.amount) });
      else if (L.noShow || p.score < 0 || L.scores[p.winners[0]] == null) {
        line = p.winners[0] === L.my ? t('last_you_take', { n: money(p.amount) }) : t('last_takes', { name: who[0], n: money(p.amount) });
      } else {
        const hand = handName(L.scores[p.winners[0]]);
        line = p.winners[0] === L.my ? t('last_you_win', { n: money(p.amount), hand }) : t('last_wins', { name: who[0], n: money(p.amount), hand });
      }
      return `<li>${k && !p.back ? `<small>${esc(t('last_side'))}</small> ` : ''}${esc(line)}</li>`;
    }).join('');
    const shownIdx = Object.keys(L.reveal).map(Number);
    if (L.hole && !shownIdx.includes(L.my)) shownIdx.unshift(L.my);
    const shows = shownIdx.map((i) => {
      const cs = L.reveal[i] || (i === L.my ? L.hole : null);
      if (!cs) return '';
      const sc = L.scores[i];
      const note = sc != null ? handName(sc) : (L.folded[i] ? t('last_folded') : '');
      const win = L.pots.some((p) => !p.back && p.winners.includes(i));
      return `<li${win ? ' class="is-first"' : ''}><span class="pk-lav">${esc((L.names[i] || {}).emoji || '')}</span><span class="pk-lname">${esc(nm(i))}</span><span class="pk-lcards">${tiny(cs)}</span><span class="pk-lnote">${esc(note)}</span></li>`;
    }).join('');
    const streets = ['preflop', 'flop', 'turn', 'river'];
    const boardAt = { preflop: [], flop: L.board.slice(0, 3), turn: L.board.slice(3, 4), river: L.board.slice(4, 5) };
    const acts = streets.map((st) => {
      const rows = L.log.filter((e) => e.st === st);
      const cards = boardAt[st];
      if (!rows.length && !cards.length) return '';
      const lines = rows.map((e) => `<li><b>${esc(nm(e.i))}</b> ${esc(t((e.i === L.my ? 'lgy_' : 'lg_') + e.a, { n: money(e.amt) }))}</li>`).join('');
      return `<div class="pk-lstreet"><div class="pk-lsthead"><span>${esc(t('street_' + st))}</span>${cards.length ? `<span class="pk-lcards">${tiny(cards)}</span>` : ''}</div>${lines ? `<ol class="pk-lacts">${lines}</ol>` : ''}</div>`;
    }).join('');
    return `<div class="pk-modal pk-last" role="dialog" aria-modal="true" aria-label="${esc(t('last_hand'))}">
        <button type="button" class="pk-x" data-act="close" aria-label="${esc(t('done'))}">&#x2715;</button>
        <h2 class="pk-over-title">${esc(t('last_title', { n: L.no }))}</h2>
        ${L.board.length ? `<div class="pk-lboard">${tiny(L.board)}</div>` : ''}
        <ul class="pk-lres">${results}</ul>
        ${shows ? `<ul class="pk-lshow">${shows}</ul>` : ''}
        ${acts}
      </div>`;
  }

  // ----------------------------------------------------------------------- stats ---

  /** One result per game per device, decided the moment the engine decides it: busting out
   *  (a loss) or holding every chip (a win). Never behind a modal. */
  _maybeRecord() {
    const pub = this.pub;
    if (!pub || this.myIdx < 0) return;
    const meP = pub.players[this.myIdx];
    if (!meP) return;
    let won = null;
    if (pub.over && pub.winner === this.myIdx) won = true;
    else if (meP.out) won = false;
    if (won === null) return;
    this._record(won);
  }

  _record(won) {
    const pub = this.pub;
    if (!pub) return;
    if (this.kind === 'solo') {
      const s = this.table && this.table.state;
      if (!s || s.rec) return;
      s.rec = true;
      const prize = this._prizeFor(won);
      if (prize) s.prize = prize;
      writeJSON(SAVE_KEY, { state: s, at: Date.now() });
      try { recordResult('holdem', SKILL_ID[s.skill] || 'medium', won); } catch (e) { console.warn('[holdem] stats write failed', e); }
      if (prize) recordHoldemBank({ prize });
      return;
    }
    const key = `${this.mp.code}:${pub.gid}`;
    const rec = this.mp.rec || (this.mp.rec = []);
    if (rec.includes(key)) return;
    rec.push(key);
    const prize = rec.includes(key + ':stake') ? this._prizeFor(won) : 0;
    if (prize) rec.push(key + ':prize:' + prize);
    if (rec.length > 60) rec.splice(0, rec.length - 60);
    this._saveMp();
    try { recordResult('holdem', 'mp', won); } catch (e) { console.warn('[holdem] stats write failed', e); }
    if (prize) recordHoldemBank({ prize });
  }

  /** What this finish pays from the pot (0 for a game with no buy-in, or for walking away). */
  _prizeFor(won) {
    const pub = this.pub;
    const meP = pub && this.myIdx >= 0 ? pub.players[this.myIdx] : null;
    if (!meP || !(pub.cfg && pub.cfg.buyin > 0)) return 0;
    const place = won ? 1 : (meP.place | 0);
    return payout(place, pub.players.length, pub.cfg.buyin);
  }

  /** The prize this device was paid for the game on screen, for the end-of-game card. */
  _myPrize() {
    const pub = this.pub;
    if (!pub) return 0;
    if (this.kind === 'solo') return (this.table && this.table.state.prize) | 0;
    if (!this.mp) return 0;
    const key = `${this.mp.code}:${pub.gid}:prize:`;
    const hit = (this.mp.rec || []).find((k) => k.startsWith(key));
    return hit ? +hit.slice(key.length) : 0;
  }

  // ----------------------------------------------------------------------- online ---

  _mpSave() {
    const s = readJSON(MP_KEY);
    if (!s || !s.code || Date.now() - (s.at || 0) > MP_SAVE_TTL) return null;
    return s;
  }

  _saveMp() {
    const mp = this.mp;
    if (!mp) return;
    const body = { code: mp.code, seat: mp.seat, host: mp.host, at: Date.now(), rec: mp.rec || [], bots: mp.bots || [] };
    if (mp.host && this.table) body.state = this.table.state;
    writeJSON(MP_KEY, body);
  }

  _roster(room) {
    const seats = (room && room.seats) || {};
    const out = [];
    Object.keys(seats).forEach((k) => { if (seats[k]) out.push({ ...seats[k], seat: +k }); });
    return out.sort((a, b) => a.seat - b.seat);
  }

  _errText(code) {
    return code === 'not-found' ? t('err_notfound') : code === 'full' ? t('err_full') : code === 'version' ? t('err_version')
      : code === 'busy' ? t('err_busy') : code === 'wrong' ? t('err_wrong_game') : t('err_offline');
  }

  async _create() {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.render();
    let res;
    try { res = await NT.withTimeout(net.createRoom('holdem', {}, me(), { seats: MAX_PLAYERS })); } catch { res = { error: 'offline' }; }
    this.busy = false;
    if (this.dead) return;
    if (res.error) { this.error = this._errText(res.error); return this.render(); }
    this.mp = { code: res.code, seat: 0, host: true, room: null, bots: [], seen: {}, lastN: {}, rec: [] };
    const nb = this.settings.netBots;
    this.mp.bots = botRoster(nb, this.settings.netSkill);
    this.kind = 'host';
    this.screen = 'lobby';
    this._saveMp();
    this._attach();
    this._pushLobby();
    this.render(true);
  }

  async _join() {
    const code = this.joinCode;
    if (this.busy || code.length !== CODE_LEN) return;
    this.busy = true; this.error = ''; this.render();
    let res;
    try { res = await NT.withTimeout(net.joinSeat(code, me())); } catch { res = { error: 'offline' }; }
    this.busy = false;
    if (this.dead) return;
    if (res && res.room && res.room.game && res.room.game !== 'holdem') {
      if (res.seat != null) net.vacateSeat(code, res.seat);
      res = { error: 'wrong' };
    }
    if (res.error) { this.error = this._errText(res.error); return this.render(); }
    this._enterGuest(code, res.seat, res.room);
  }

  _enterGuest(code, seat, room) {
    const prev = this._mpSave();
    this.mp = { code, seat, host: false, room, bots: [], seen: {}, rec: (prev && prev.code === code ? prev.rec : []) || [] };
    this.kind = 'guest';
    this.pub = null;
    this.screen = room && room.pk && room.pk.pub ? 'table' : 'lobby';
    this._saveMp();
    this._attach();
    this._guestRoom(room);
    this.render(true);
  }

  async _rejoin() {
    const save = this._mpSave();
    if (!save || this.busy) return;
    this.busy = true; this.error = ''; this.render();
    try {
      if (save.host) {
        const room = await NT.readRoom(save.code);
        if (!room || room.status === 'ended' || room.game !== 'holdem') throw Object.assign(new Error('gone'), { code: 'not-found' });
        this.busy = false;
        this.mp = { code: save.code, seat: 0, host: true, room, bots: save.bots || [], seen: {}, lastN: {}, rec: save.rec || [] };
        this.kind = 'host';
        // Moves already sitting in the room were for an older turn; never replay them.
        const acts = (room.pk && room.pk.act) || {};
        Object.keys(acts).forEach((s) => { const a = NT.parse(acts[s]); if (a) this.mp.lastN[s] = a.n; });
        this._attach();
        if (save.state && room.pk && room.pk.pub) {
          this.screen = 'table';
          this.table = new Table(save.state, { clockMs: CLOCK_MS, pace: this.settings.pace, onChange: () => this._onLocalChange() });
          this.myIdx = save.state.players.findIndex((p) => p.seat === 0 && !p.bot);
          this.render(true);
          this.table.start();
        } else {
          this.screen = 'lobby';
          this._pushLobby();
          this.render(true);
        }
        return;
      }
      const res = await NT.withTimeout(net.joinSeat(save.code, me()));
      this.busy = false;
      if (res.error) throw Object.assign(new Error('join'), { code: res.error });
      this._enterGuest(save.code, res.seat, res.room);
    } catch (e) {
      this.busy = false;
      if (e && (e.code === 'not-found')) drop(MP_KEY);
      this.error = this._errText(e && e.code);
      this.render(true);
    }
  }

  _attach() {
    const mp = this.mp;
    net.heartbeat(mp.code, mp.seat);
    net.onRoom(mp.code, (room) => {
      if (this.dead || this.mp !== mp) return;
      mp.room = room;
      this.rx.onRoom(room || {});
      if (mp.host) this._hostRoom(room); else this._guestRoom(room);
    });
  }

  /** The host's chosen table, if they can still afford it (otherwise no buy-in). */
  _netTier() {
    const x = tierById(this.settings.netTier);
    return x && this.bank() >= x.buyin ? x : { id: null, buyin: 0 };
  }

  _addBot() {
    const mp = this.mp;
    const count = this._roster(mp.room).length + mp.bots.length;
    if (count >= MAX_PLAYERS) return;
    const all = botRoster(8, this.settings.netSkill);
    const used = new Set(mp.bots.map((b) => b.name));
    const next = all.find((b) => !used.has(b.name)) || { name: t('computer') + ' ' + (mp.bots.length + 1), emoji: '\u{1F916}', bot: this.settings.netSkill };
    mp.bots.push(next);
    this.settings.netBots = mp.bots.length;
    this._saveSettings();
    this._saveMp();
    this._pushLobby();
    this.render();
  }

  _pushLobby() {
    const mp = this.mp;
    if (!mp || !mp.host) return;
    NT.pkUpdate(mp.code, { lobby: JSON.stringify({ bots: mp.bots, speed: this.settings.speed, tier: this._netTier().id }) }).catch((e) => console.warn('[holdem] lobby publish failed', e));
  }

  /** Host: deal a new game to everyone sitting in the room right now, plus the computers. */
  _startNet() {
    const mp = this.mp;
    const humans = this._roster(mp.room).map((h) => ({ name: h.name, emoji: h.avatar || '\u{1F642}', bot: 0, seat: h.seat, dev: h.deviceId }));
    if (!humans.some((h) => h.seat === 0)) humans.unshift({ ...me(), emoji: me().avatar, bot: 0, seat: 0, dev: deviceId() });
    // People first, computers fill what is left, THEN shuffle the seating: a full room must never
    // lose a person to a computer.
    const players = shuffle([...humans, ...mp.bots.map((b) => ({ ...b }))].slice(0, MAX_PLAYERS));
    if (players.length < 2) return;
    const tier = this._netTier();
    const state = newGame(players, { speed: this.settings.speed, buyin: tier.buyin, tier: tier.id });
    state.gid = rid();
    this._stopTable();
    this.screen = 'table';
    this.overlay = null;
    this.overDismissed = null;
    this.table = new Table(state, { clockMs: CLOCK_MS, pace: this.settings.pace, onChange: () => this._onLocalChange() });
    this.myIdx = state.players.findIndex((p) => p.seat === 0 && !p.bot);
    this.pub = publicView(state);
    this.pub.gid = state.gid;
    this._stake();
    this.render(true);
    this.table.start();
  }

  /** Online: pay this device's own buy-in once per game. A player whose bankroll cannot cover it
   *  plays that game just for fun (no buy-in, no prize) rather than going below zero. */
  _stake() {
    const pub = this.pub, mp = this.mp;
    if (!pub || !mp || this.myIdx < 0 || !(pub.cfg && pub.cfg.buyin > 0)) return;
    const base = `${mp.code}:${pub.gid}`;
    const rec = mp.rec || (mp.rec = []);
    if (rec.includes(base + ':stake') || rec.includes(base + ':free')) return;
    if (this.bank() >= pub.cfg.buyin) { recordHoldemBank({ buyin: pub.cfg.buyin }); rec.push(base + ':stake'); }
    else { rec.push(base + ':free'); this.flash = t('playing_free'); this._later(() => { this.flash = ''; this._paintBanner(); }, 6000); }
    if (rec.length > 60) rec.splice(0, rec.length - 60);
    this._saveMp();
  }

  _toLobby() {
    this._stopTable();
    this.screen = 'lobby';
    this.overlay = null;
    this.pub = null;
    this._saveMp();
    NT.pkUpdate(this.mp.code, { pub: null, clock: null }).catch(() => {});
    this._pushLobby();
    this.render(true);
  }

  _schedulePublish() {
    if (this.pubTimer) return;
    this.pubTimer = setTimeout(() => { this.pubTimer = null; this._publish(); }, 0);
  }

  async _publish() {
    const mp = this.mp, tb = this.table;
    if (!mp || !mp.host || !tb || this.dead) return;
    const s = tb.state;
    const pub = publicView(s);
    pub.gid = s.gid;
    pub.waiting = this._roster(mp.room).filter((h) => !s.players.some((p) => p.dev === h.deviceId && !p.left)).map((h) => ({ name: h.name, emoji: h.avatar }));
    const patch = { pub: JSON.stringify(pub), clock: { k: s.k, ms: Math.max(0, tb.clockEnd - Date.now()) } };
    // Each seat's own two cards, once per hand (and again after a failed write).
    if (mp.holeHand !== `${s.gid}:${s.handNo}` && s.hand && s.hand.holes) {
      s.players.forEach((p, i) => {
        if (!p.bot && p.seat != null && p.seat !== 0 && s.hand.holes[i]) patch[`hole/${p.seat}`] = JSON.stringify({ g: s.gid, h: s.handNo, c: s.hand.holes[i] });
      });
    }
    try {
      await NT.pkUpdate(mp.code, patch);
      mp.holeHand = `${s.gid}:${s.handNo}`;
      mp.dirty = false;
    } catch (e) {
      mp.dirty = true;       // the 1s tick retries until the write lands
      console.warn('[holdem] publish failed, will retry', e);
    }
  }

  /** Host: read moves, presence and departures out of the room. */
  _hostRoom(room) {
    const mp = this.mp;
    if (!room || room.status === 'ended') return;
    if (this.screen === 'lobby') this.render();
    const now = Date.now();
    const seats = room.seats || {};
    Object.keys(seats).forEach((k) => {
      const v = seats[k] && seats[k].lastSeen;
      const o = mp.seen[k];
      if (!o || o.v !== v) mp.seen[k] = { v, t: now };
    });
    const tb = this.table;
    if (!tb) return;
    const s = tb.state;
    // Someone who left the room (seat released) is out of the game.
    s.players.forEach((p, i) => {
      if (p.bot || p.seat == null || p.seat === 0 || p.out) return;
      const occ = seats[p.seat];
      if (!occ || occ.deviceId !== p.dev) tb.remove(i);
    });
    const acts = (room.pk && room.pk.act) || {};
    Object.keys(acts).forEach((seatKey) => {
      const a = NT.parse(acts[seatKey]);
      if (!a || a.n === mp.lastN[seatKey]) return;
      mp.lastN[seatKey] = a.n;
      const i = s.players.findIndex((p) => !p.bot && p.seat === +seatKey && !p.left);
      if (i < 0 || a.g !== s.gid) return;
      if (a.a === 'leave') return tb.remove(i);
      if (a.a === 'back') { mp.seen[seatKey] = { v: 'back', t: Date.now() }; tb.setAway(i, false); return tb.back(i); }
      if (a.h !== s.handNo || a.k !== s.k) return;       // a move for a turn that has passed
      const r = tb.submit(i, { a: a.a, to: a.to });
      if (!r.ok) console.warn('[holdem] remote move refused', r.error, a);
    });
    this._publishIfWaitingChanged();
  }

  _publishIfWaitingChanged() {
    const mp = this.mp;
    const sig = this._roster(mp.room).map((h) => h.deviceId).join();
    if (sig !== mp.rosterSig) { mp.rosterSig = sig; this._schedulePublish(); }
  }

  /** Guest: draw whatever the host published. */
  _guestRoom(room) {
    const mp = this.mp;
    if (!room || room.status === 'ended') {
      this._closed(t('table_closed'));
      return;
    }
    const seats = room.seats || {};
    const mine = seats[mp.seat];
    if (!mine || mine.deviceId !== deviceId()) { this._closed(t('kicked')); return; }
    const h0 = seats[0] && seats[0].lastSeen;
    const o = mp.seen[0];
    if (!o || o.v !== h0) mp.seen[0] = { v: h0, t: Date.now() };
    const pk = room.pk || {};
    const pub = NT.parse(pk.pub);
    if (!pub) {
      if (this.screen !== 'lobby') { this.screen = 'lobby'; this.pub = null; this.overlay = null; }
      this.render(true);
      return;
    }
    const first = this.screen !== 'table';
    const changed = !this.pub || this.pub.k !== pub.k || this.pub.gid !== pub.gid;
    this.pub = pub;
    this.myIdx = pub.players.findIndex((p) => !p.bot && p.seat === mp.seat && p.dev === deviceId() && !p.left);
    const hole = NT.parse(pk.hole && pk.hole[mp.seat]);
    this.hole = hole && hole.g === pub.gid && hole.h === pub.handNo ? hole.c : null;
    if (pk.clock && pk.clock.k === pub.k && changed) this.clockEnd = pk.clock.ms > 0 ? Date.now() + pk.clock.ms : 0;
    if (changed) this.sending = false;
    this._stake();
    this._maybeRecord();
    this._handEnd();
    if (first) { this.screen = 'table'; this.overlay = null; this.render(true); }
    else if (changed || !this.hole !== !this._hadHole) this._paintTable();
    this._hadHole = !!this.hole;
    this._checkOver();
  }

  _closed(msg) {
    net.disconnect();
    drop(MP_KEY);
    this.mp = null;
    this.kind = null;
    this.pub = null;
    this.screen = 'setup';
    this.overlay = null;
    this.error = msg;
    this.settings.tab = 'online';
    this.render(true);
  }

  _leaveAsk() {
    const inGame = this.screen === 'table' && this.pub && !this.pub.over && this.myIdx >= 0 && !this.pub.players[this.myIdx].out;
    if (this.kind === 'host' || inGame) { this.overlay = 'confirm'; return this._renderOverlay(); }
    return this._leave();
  }

  async _leave() {
    const inGame = this.screen === 'table' && this.pub && !this.pub.over && this.myIdx >= 0 && !this.pub.players[this.myIdx].out;
    if (this.kind === 'solo') {
      if (inGame) this._record(false);      // walking away from a game is losing it
      return this._endSolo();
    }
    const mp = this.mp;
    if (!mp) return;
    if (inGame) this._record(false);
    if (mp.host) {
      this._stopTable();
      try { await NT.withTimeout(net.leaveRoom(mp.code, 0), 6000); } catch { net.disconnect(); }
    } else {
      if (inGame) { try { await NT.sendAct(mp.code, mp.seat, { g: this.pub.gid, a: 'leave' }); } catch { /* the seat release below removes them too */ } }
      net.vacateSeat(mp.code, mp.seat);
      net.disconnect();
    }
    drop(MP_KEY);
    this.mp = null;
    this.kind = null;
    this.pub = null;
    this.screen = 'setup';
    this.overlay = null;
    this.render(true);
  }

  /** Once a second: turn clock bar, away detection, publish retries. */
  _tick() {
    if (this.dead) return;
    const mp = this.mp;
    if (mp && mp.host && this.table) {
      const s = this.table.state;
      const now = Date.now();
      s.players.forEach((p, i) => {
        if (p.bot || p.seat == null || p.seat === 0 || p.out) return;
        let o = mp.seen[p.seat];
        // Never seen yet (the host just came back): start their clock now rather than calling
        // them away before the first room snapshot has even arrived.
        if (!o) o = mp.seen[p.seat] = { v: undefined, t: now };
        this.table.setAway(i, now - o.t > AWAY_MS);
      });
      if (mp.dirty) this._publish();
    } else if (mp && !mp.host) {
      const o = mp.seen[0];
      const away = !!(o && Date.now() - o.t > AWAY_MS);
      if (away !== !!mp.hostAway) { mp.hostAway = away; this._paintBanner(); }
    }
  }

  _later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); if (!this.dead) fn(); }, ms);
    this.timers.add(id);
  }

  isInProgress() {
    if (!this.mp || this.screen !== 'table' || !this.pub || this.pub.over) return false;
    const meP = this.myIdx >= 0 ? this.pub.players[this.myIdx] : null;
    return !!(meP && !meP.out);
  }

  destroy() {
    this.dead = true;
    clearInterval(this.tick);
    clearTimeout(this.pubTimer);
    this.timers.forEach((id) => clearTimeout(id));
    if (this.table) this.table.destroy();
    // Leaving the screen is not leaving the table: the seat stays yours and "Back to table" on
    // the setup screen returns you to it. Only the explicit Leave button gives it up.
    net.disconnect();
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('input', this.onInput);
    this.el.removeEventListener('keydown', this.onKey);
    this.el.removeEventListener('pointerdown', this.onPDown);
    this.el.removeEventListener('pointermove', this.onPMove);
    this.el.removeEventListener('pointerup', this.onPUp);
    this.el.removeEventListener('pointercancel', this.onPCancel);
    try { this.offCopy(); } catch { /* already gone */ }
    try { this.offView(); } catch { /* already gone */ }
    try { this.offLang(); } catch { /* already gone */ }
    try { this.rx.destroy(); } catch { /* already gone */ }
    if (this.ro) this.ro.disconnect();
    this.root.innerHTML = '';
  }
}

// ---------------------------------------------------------------------------------------------

let instance = null;

function ensureCss() {
  if (document.querySelector('link[data-pk-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/holdem.css', import.meta.url).href;
  link.setAttribute('data-pk-css', '');
  document.head.appendChild(link);
}

export function init(container) {
  ensureCss();
  if (instance) instance.destroy();
  instance = new Game(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!(instance && instance.isInProgress());
}

export default { init, destroy, isInProgress };

// exposed for the headless tests only
export const _test = { handName, money, botRoster, blindsOf };
