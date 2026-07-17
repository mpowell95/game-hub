/* =============================================================================
 * ui.js — DOM rendering, human interaction, and game loop for "Business Deal"
 * -----------------------------------------------------------------------------
 * Recreates the look of the reference "Business" app: bright blue table, AI
 * opponents across the top, authentic Monopoly-Deal card faces, tap-to-enlarge
 * card detail with Flip / Bank / Play / Pass, target selection for multi-player
 * actions, speech bubbles, and toast banners.
 *
 * Supports 2–5 players (you + 1–4 AI). The human plays through HumanAgent, whose
 * async decisions are resolved by taps; the AI uses AIAgent. Both satisfy the
 * same engine agent interface.
 *
 * Loaded after deck.js + game.js + ai.js. Exposes window.UI.
 * ===========================================================================*/
(function (root, factory) {
  root.UI = factory(root.Deck, root.Game, root.AI);
})(typeof self !== 'undefined' ? self : this, function (Deck, GameModule, AI) {
  'use strict';

  const Game = GameModule.Game || GameModule;
  const T = Deck.CARD_TYPES;
  const A = Deck.ACTIONS;
  const REQ = Deck.SET_REQUIREMENTS;
  const RENT = Deck.RENT_VALUES;
  const CM = Deck.COLOR_META;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const elNew = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // Bump alongside the sw.js cache name on every release so the visible stamp
  // and the cached build always match.
  const APP_VERSION = 'v26';

  const LIGHT_BANDS = ['lightblue', 'yellow', 'utility']; // need dark text on band

  // Railroad & Utility are the two "sets" not identified by a vivid color block,
  // so they get an icon; every other set reads from its color. colorLabel()
  // prepends the icon where a color name is shown on a card/chip.
  const COLOR_EMOJI = { railroad: '🚂', utility: '💡' };
  const colorLabel = (color) => (COLOR_EMOJI[color] ? COLOR_EMOJI[color] + ' ' : '') + CM[color].label;

  // AI opponent flavor (names + avatar emoji + header tint).
  const AI_NAMES = ['NobleRep', 'Parker', 'JustVendor', 'Mogul Mae', 'Tycoon Tim', 'Baron Bo'];
  const AI_AVATARS = ['🧑‍💼', '👩‍💼', '🧔', '👨‍🦰', '👩‍🦱', '🧑'];
  const OPP_TINTS = ['#1f8a4c', '#1f5fc8', '#c0392b', '#7d3cc0', '#0e8f8f'];

  // --- Shared hub profile (read-only) ----------------------------------------
  // Business Deal is a separate app that cannot import the hub's ES module, so the
  // read path of js/profile-store.js is inlined here. It reads the profile the hub
  // writes to localStorage["gamehub.profile"] (shared because both deploy under the
  // same origin) and returns { name, emoji, opponents:[{name,emoji,skill:1-3}] }, or
  // null when absent/malformed. Names are stripped of < > so they are safe wherever
  // the UI shows them. Keep in sync with the hub contract.
  const SKILL_TO_DIFF = { 1: 'easy', 2: 'normal', 3: 'hard' };
  function readHubProfile() {
    try {
      const raw = localStorage.getItem('gamehub.profile');
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return null;
      const clean = (s, fb) => (((typeof s === 'string' ? s : '').replace(/[<>]/g, '').trim().slice(0, 20)) || fb);
      const glyph = (s) => ((typeof s === 'string' && s.trim()) ? s.trim() : null);
      const opps = Array.isArray(p.opponents) ? p.opponents.slice(0, 4) : [];
      return {
        name: clean(p.name, 'You'),
        emoji: glyph(p.emoji) || '🧑',
        opponents: opps.map((o, i) => ({
          name: clean(o && o.name, 'Computer ' + (i + 1)),
          emoji: glyph(o && o.emoji),
          skill: [1, 2, 3].includes(Math.round(Number(o && o.skill))) ? Math.round(Number(o.skill)) : 2,
        })),
      };
    } catch { return null; }
  }

  const ACTION_ICON = {
    deal_breaker: '💥', just_say_no: '🚫', pass_go: '➡️', forced_deal: '↔️',
    sly_deal: '🥷', debt_collector: '🧾', birthday: '🎂', double_rent: '×2',
    house: '🏠', hotel: '🏨',
  };
  // Emblem name rendered as [small pre-word(s)] + [BIG hero word] so the
  // crucial word is legible at a glance (e.g. GO on Pass Go). Single-word
  // actions just use `hero`.
  const ACTION_NAME = {
    deal_breaker: { pre: 'DEAL', hero: 'BREAKER' }, just_say_no: { pre: 'JUST SAY', hero: 'NO!' },
    pass_go: { pre: 'PASS', hero: 'GO' }, forced_deal: { pre: 'FORCED', hero: 'DEAL' },
    sly_deal: { pre: 'SLY', hero: 'DEAL' }, debt_collector: { pre: 'DEBT', hero: 'COLLECTOR' },
    birthday: { pre: "IT'S MY", hero: 'BIRTHDAY' }, double_rent: { pre: 'DOUBLE', hero: 'RENT' },
    house: { hero: 'HOUSE' }, hotel: { hero: 'HOTEL' },
  };
  const ACTION_LABEL = {
    deal_breaker: 'DEAL BREAKER', just_say_no: 'JUST SAY NO!', pass_go: 'PASS GO',
    forced_deal: 'FORCED DEAL', sly_deal: 'SLY DEAL', debt_collector: 'DEBT COLLECTOR',
    birthday: "IT'S MY BIRTHDAY", double_rent: 'DOUBLE RENT', house: 'HOUSE', hotel: 'HOTEL',
  };
  const ACTION_DESC = {
    deal_breaker: 'Steal a complete set', just_say_no: 'Cancel an action played against you',
    pass_go: 'Draw 2 extra cards', forced_deal: 'Swap a property with another player',
    sly_deal: 'Steal a property<small>not from a full set</small>', debt_collector: 'Make a player pay you 5M',
    birthday: 'All players give you 2M', double_rent: 'Play with a rent card to double it',
    house: 'Add to a full set: +3M rent', hotel: 'Add to a full set: +4M rent',
  };

  /* ==========================================================================
   * Card-face rendering (authentic Monopoly-Deal layout, em-scaled)
   * ========================================================================*/
  // Reference-style rent ladder: a "RENT" header (added by the caller) then one
  // row per set size — [count] … [rent], with the last row labelled FULL SET.
  function rentLadder(color) {
    const t = RENT[color];
    return t.map((v, i) => {
      const n = i === t.length - 1 ? 'FULL SET' : String(i + 1);
      return `<div class="pl-row"><span class="pl-n">${n}</span><span class="pl-v">${v}M</span></div>`;
    }).join('');
  }
  // Compact one-line rents for a single color (used on the split 2-color card).
  function rentLadderShort(color) { return RENT[color].map(v => `${v}M`).join(' · '); }

  // The universal value badge: a small white rounded pill, TOP-LEFT on every
  // card. Big number with a smaller, lowered "M" for clear separation.
  function valPillHTML(value) {
    return `<div class="v-pill"><span class="v-num">${value}</span><span class="v-m">M</span></div>`;
  }

  function rentWheelBg(colors) {
    if (colors.length >= 5) {
      return 'conic-gradient(#e23b9a 0 20%, #f08a1d 20% 40%, #f6cf2e 40% 60%, #2faa5d 60% 80%, #1f3a93 80% 100%)';
    }
    const a = `var(--c-${colors[0]})`, b = `var(--c-${colors[1] || colors[0]})`;
    return `conic-gradient(${a} 0 50%, ${b} 50% 100%)`;
  }

  /** Build a card-face element. opts.chosenColor highlights a wild's target. */
  function renderCardFace(card, opts) {
    opts = opts || {};
    const face = elNew('div', 'cardface');
    const PILL = valPillHTML(card.value);

    if (card.type === T.MONEY) {
      face.classList.add('money', 'm' + card.value);
      // Reference look: value pill top-left + a big centered coin showing "NM".
      face.innerHTML = PILL +
        `<div class="m-center"><div class="m-coin"><span class="m-num">${card.value}<small>M</small></span></div></div>`;
      return face;
    }

    if (card.type === T.PROPERTY) {
      face.classList.add('property');
      const dark = LIGHT_BANDS.indexOf(card.color) === -1;
      const nameStyle = dark ? '' : 'color:#1a1a1a;text-shadow:none';
      // Value pill sits on the white header area; the colored band below holds
      // a large, dominant color name; rents at the bottom.
      face.innerHTML = PILL +
        `<div class="p-band" style="background:var(--c-${card.color})">` +
          `<div class="p-name" style="${nameStyle}">${esc(colorLabel(card.color))}</div></div>` +
        `<div class="p-body"><div class="p-rent-hd">RENT</div>` +
          `<div class="p-ladder">${rentLadder(card.color)}</div></div>`;
      return face;
    }

    if (card.type === T.PROPERTY_WILD) {
      face.classList.add('wild');
      if (card.isMulti) {
        // Multi-color "any" wild: rainbow field with a clear ANY label. No value
        // pill — it has no cash value, and a "0" reads like a junk card.
        face.innerHTML =
          `<div class="wm-band"></div>` +
          `<div class="wm-body"><div class="wm-title">PROPERTY WILD</div>` +
          `<div class="wm-any">ANY<br>COLOR</div>` +
          `<div class="wm-note">no cash value</div></div>`;
        return face;
      }
      // Two-color wild: split into the two colors, each half labeled with its
      // name + rents. Rebuilt from scratch (was an unreadable stacked mess).
      const [c1, c2] = card.colors;
      const chosen = opts.chosenColor;
      const half = (color, pos) => {
        const dark = LIGHT_BANDS.indexOf(color) === -1;
        const st = dark ? '' : 'color:#1a1a1a;text-shadow:none';
        const on = chosen === color ? ' on' : (chosen ? ' off' : '');
        return `<div class="w-half ${pos}${on}" style="background:var(--c-${color})">` +
          `<div class="wh-name" style="${st}">${esc(colorLabel(color))}</div>` +
          `<div class="wh-rent" style="${st}">${rentLadderShort(color)}</div></div>`;
      };
      face.innerHTML = PILL +
        `<div class="w-split">${half(c1, 'top')}${half(c2, 'bot')}</div>` +
        `<div class="w-tag">WILD</div>`;
      return face;
    }

    if (card.type === T.RENT) {
      face.classList.add('rent');
      // Header is a flex ROW: [value pill][RENT] — the pill can never overlap the
      // label. The functional info (color pair + who it hits) is the big content.
      const scope = card.isWild ? 'ONE' : 'ALL';
      const body = card.isWild
        ? `<div class="rent-any">ANY<br>COLOR</div>`
        : card.colors.map(c => {
            const dk = LIGHT_BANDS.indexOf(c) === -1;
            return `<div class="rent-bar" style="background:var(--c-${c})${dk ? '' : ';color:#1a1a1a;text-shadow:none'}">${esc(colorLabel(c))}</div>`;
          }).join('');
      face.innerHTML =
        `<div class="c-head">${PILL}<div class="c-head-label rent-word">RENT</div></div>` +
        `<div class="rent-scope scope-${scope.toLowerCase()}">Charge ${scope}</div>` +
        `<div class="rent-colors${card.isWild ? ' any' : ''}">${body}</div>`;
      return face;
    }

    // ACTION — header ROW [value pill][ACTION CARD] so the pill never covers the
    // label; icon in a circle; the NAME as a full-width band (hero word large).
    face.classList.add('action', 'act-' + card.action);
    const nm = ACTION_NAME[card.action] || { hero: esc(card.name) };
    const nameHTML = (nm.pre ? `<span class="pre">${esc(nm.pre)}</span>` : '') + `<span class="hero">${esc(nm.hero)}</span>`;
    face.innerHTML =
      `<div class="c-head">${PILL}<div class="c-head-label">ACTION CARD</div></div>` +
      `<div class="a-emblem"><div class="emblem-circle"><div class="icon">${ACTION_ICON[card.action] || '⭐'}</div></div></div>` +
      `<div class="a-name">${nameHTML}</div>` +
      `<div class="a-desc">${ACTION_DESC[card.action] || ''}</div>`;
    return face;
  }

  // Compact "mini" property card for the zones — a solid color block so the
  // set color is readable at a glance (Pink vs Red were indistinguishable as
  // thin top stripes). Wildcards keep the rainbow fill.
  function renderMini(card, color) {
    const m = elNew('div', 'mini' + (card.type === T.PROPERTY_WILD ? ' wild' : ''));
    const bar = elNew('div', 'mini-bar');
    if (card.type !== T.PROPERTY_WILD) bar.style.background = `var(--c-${color})`;
    m.append(bar);
    return m;
  }

  /* ==========================================================================
   * HumanAgent — delegates each decision to the UI.
   * ========================================================================*/
  class HumanAgent {
    constructor(ui) { this.ui = ui; this.name = 'You'; }
    chooseMove(view, legal) { return this.ui.promptMove(view, legal); }
    respondToAction(view, ctx) { return this.ui.promptJSN(view, ctx); }
    choosePayment(view, ctx) { return this.ui.promptPayment(view, ctx); }
    chooseDiscards(view, count) { return this.ui.promptDiscards(view, count); }
    assignWildColor(view, card, valid) { return this.ui.promptWildColor(view, card, valid); }
  }

  /* ==========================================================================
   * BusinessDealUI
   * ========================================================================*/
  class BusinessDealUI {
    constructor() {
      // Pace between AI moves — bumped so the AI's turn is readable, not a blur
      // (players asked to "slow it down a bit").
      this.aiDelay = 1400;
      this._pendingMove = null;
      this._bubbles = {};
      this.$ = (id) => document.getElementById(id);
      this.$('pass-btn').addEventListener('click', () => this._passClicked());
      this.$('quit-btn').addEventListener('click', () => this._quitDialog());
      this.$('settings-btn').addEventListener('click', () => this._openSettings());
    }

    /** Return to the Game Hub launcher (root-relative — mirrors how the hub links
     *  out to /business-deal/). Available on setup + win screens (#11/#12). */
    _toHub() { window.location.href = '/game-hub/'; }

    _menuItem(id, icon, title, sub) {
      return `<button class="menu-item" id="${id}" type="button">` +
        `<span class="mi-ic">${icon}</span>` +
        `<span class="mi-tx"><span class="mi-t">${esc(title)}</span>` +
        (sub ? `<span class="mi-s">${esc(sub)}</span>` : '') + '</span></button>';
    }

    _openSettings() {
      const sheet = this._sheet(
        '<h3>Settings</h3>' +
        '<div class="menu-list">' +
          this._menuItem('set-new', '🔄', 'New Game', 'Restart with the same opponents') +
          this._menuItem('set-stats', '📊', 'Stats', 'All-time wins, losses and win rate') +
          this._menuItem('set-setup', '↩️', 'Quit to New Game screen', 'Change opponents or difficulty') +
          this._menuItem('set-hub', '🏠', 'Quit to Game Hub', 'Leave Monopoly Deal') +
          this._menuItem('set-credits', '🎉', 'Credits', '') +
        '</div>' +
        '<button class="cta ghost-cta" id="set-close">Close</button>');
      sheet.querySelector('#set-new').addEventListener('click', () => this._restartGame());
      sheet.querySelector('#set-stats').addEventListener('click', () => this.showStats('settings'));
      sheet.querySelector('#set-setup').addEventListener('click', () => this.showSetup());
      sheet.querySelector('#set-hub').addEventListener('click', () => this._toHub());
      sheet.querySelector('#set-credits').addEventListener('click', () => this._showCredits());
      sheet.querySelector('#set-close').addEventListener('click', () => this._closeOverlay());
      this._scrimCloses();
    }

    _quitDialog() {
      const sheet = this._sheet(
        '<h3>Where do you wanna go?</h3><p>Your current game will be lost</p>' +
        '<div class="menu-list">' +
          this._menuItem('q-setup', '↩️', 'New Game screen', 'Pick opponents and difficulty') +
          this._menuItem('q-hub', '🏠', 'Game Hub', 'Leave Monopoly Deal') +
        '</div>' +
        '<button class="cta ghost-cta" id="q-cancel">Keep playing</button>');
      sheet.querySelector('#q-setup').addEventListener('click', () => this.showSetup());
      sheet.querySelector('#q-hub').addEventListener('click', () => this._toHub());
      sheet.querySelector('#q-cancel').addEventListener('click', () => this._closeOverlay());
      this._scrimCloses();
    }

    _restartGame() { this.newGame(this._lastNumAI || 3, this._lastDiff || 'normal'); }

    _showCredits() {
      const root = this.$('overlay');
      root.innerHTML = '<div class="scrim"></div>';
      const screen = elNew('div', 'credits-screen');
      const COLORS = ['#ffd23f', '#ff5a52', '#36c06a', '#4aa3ff', '#e23b9a', '#f08a1d'];
      let bursts = '';
      for (let i = 0; i < 9; i++) {
        let sparks = '';
        for (let d = 0; d < 12; d++) sparks += `<i style="--a:${d * 30}deg;--c:${COLORS[(i + d) % COLORS.length]}"></i>`;
        bursts += `<div class="fw" style="--x:${6 + (i * 23) % 88}%;--y:${10 + (i * 31) % 70}%;--d:${(i * 0.28).toFixed(2)}s">${sparks}</div>`;
      }
      screen.innerHTML =
        `<div class="fw-layer">${bursts}</div>` +
        '<div class="credits-emoji">🎉 🎊 🥳 🎆 ✨</div>' +
        '<div class="credits-title">Matt is Awesome!</div>' +
        '<div class="credits-sub">…and he built this whole game</div>' +
        '<button class="cta" id="cr-close" type="button">Close</button>';
      root.append(screen);
      screen.querySelector('#cr-close').addEventListener('click', () => this._openSettings());
      root.querySelector('.scrim').addEventListener('click', () => this._openSettings());
      root.classList.add('show');
    }

    _scrimCloses() {
      const s = this.$('overlay').querySelector('.scrim');
      if (s) s.addEventListener('click', () => this._closeOverlay());
    }

    /* ---- setup chooser -------------------------------------------------- */
    showSetup() {
      // Dismiss the win overlay first — it shares the setup's z-index and sits
      // later in the DOM, so if left up it covers the sheet and swallows taps
      // (the "Play Again is a dead-end" bug).
      const win = this.$('winner'); win.classList.remove('show'); win.innerHTML = '';
      document.getElementById('app').classList.remove('game-over');
      this._closeDetail(); this._closeOverlay();

      // Prefill from the hub profile when there's no in-session last-used choice
      // (precedence: last-used > profile > built-in). Difficulty is one global
      // setting here, so it comes from the first opponent's tier.
      const prof = readHubProfile();
      let chosen = this._lastNumAI || (prof && prof.opponents.length ? Math.min(prof.opponents.length, 4) : 3);
      let diff = this._lastDiff || (prof && prof.opponents[0] ? SKILL_TO_DIFF[prof.opponents[0].skill] : 'normal');
      const root = this.$('setup');
      // Hidden challenge: while unwon, force the qualifying config (2+ opponents at
      // Normal/Hard), gray out the choices, and show a "Begin challenge" bar. Once won,
      // normal play with a "completed, play anyways?" note.
      const bd = window.__bdChallenge;
      const live = !!(bd && bd.live && bd.live());
      const done = !!(bd && bd.active && bd.active() && bd.done && bd.done());
      const render = () => {
        if (live) { if (chosen < 2) chosen = 3; if (diff === 'easy') diff = 'normal'; }
        const lock = live ? ' bd-locked' : '';
        root.innerHTML =
          '<div class="scrim"></div><div class="sheet">' +
          (done ? '<p class="bd-challenge-note">Monopoly Deal challenge completed. Play anyways?</p>' : '') +
          "<h3>Monopoly Deal</h3><p>How many AI opponents?</p>" +
          '<div class="count-row' + lock + '">' +
          [1, 2, 3, 4].map(n => `<button class="count-btn${n === chosen ? ' sel' : ''}" data-n="${n}">${n}</button>`).join('') +
          '</div><p style="margin-top:14px">Difficulty</p><div class="count-row' + lock + '">' +
          ['easy', 'normal', 'hard'].map(d => `<button class="count-btn diff${d === diff ? ' sel' : ''}" data-d="${d}" style="width:auto;padding:0 16px;font-size:15px">${d[0].toUpperCase() + d.slice(1)}</button>`).join('') +
          '</div><button class="cta' + (live ? ' bd-cta-challenge' : '') + '" id="start-btn">' + (live ? 'Begin challenge' : 'Start Game') + '</button>' +
          '<button class="cta ghost-cta" id="setup-stats">Stats</button>' +
          '<button class="cta ghost-cta" id="setup-hub">← Game Hub</button>' +
          `<div class="setup-version">${APP_VERSION}</div></div>`;
        if (!live) {
          root.querySelectorAll('.count-btn[data-n]').forEach(b =>
            b.addEventListener('click', () => { chosen = +b.dataset.n; render(); }));
          root.querySelectorAll('.count-btn[data-d]').forEach(b =>
            b.addEventListener('click', () => { diff = b.dataset.d; render(); }));
        }
        this.$('start-btn').addEventListener('click', () => { root.classList.remove('show'); this.newGame(chosen, diff); });
        this.$('setup-stats').addEventListener('click', () => this.showStats('setup'));
        this.$('setup-hub').addEventListener('click', () => this._toHub());
        root.querySelector('.scrim').addEventListener('click', () => { if (this.game) root.classList.remove('show'); });
      };
      render();
      root.classList.add('show');
    }

    /* ---- lifecycle ----------------------------------------------------- */
    newGame(numAI, difficulty) {
      this._closeDetail(); this._closeOverlay();
      this.$('setup').classList.remove('show');
      this.$('winner').classList.remove('show');
      this._pendingMove = null; this._bubbles = {};
      this._resultRecorded = false;   // record this game's win/loss once
      this.difficulty = difficulty || 'normal';
      this._lastNumAI = numAI; this._lastDiff = this.difficulty;   // for Play Again

      // Opponent identity comes from the hub profile (roster order), falling back
      // to Business Deal's built-in flavor. The human keeps the id-based "You" that
      // the UI uses throughout; only the human's avatar is profile-driven.
      const prof = readHubProfile();
      const aiName = (i) => (prof && prof.opponents[i] && prof.opponents[i].name) || AI_NAMES[i % AI_NAMES.length];
      const aiAvatar = (i) => (prof && prof.opponents[i] && prof.opponents[i].emoji) || AI_AVATARS[i % AI_AVATARS.length];
      const players = [{ name: 'You', agent: new HumanAgent(this) }];
      for (let i = 0; i < numAI; i++) {
        players.push({
          name: aiName(i),
          agent: new AI.AIAgent({ name: aiName(i), difficulty: this.difficulty }),
        });
      }
      this.game = new Game({ verbose: false, players });
      this.meta = players.map((p, i) => ({
        avatar: i === 0 ? ((prof && prof.emoji) || '🧑') : aiAvatar(i - 1),
        tint: i === 0 ? '#0f59c8' : OPP_TINTS[(i - 1) % OPP_TINTS.length],
      }));

      this.game.onTurnStart = async (pl) => {
        this._bubbles = {}; this._seenLogs = this.game.logs.length; this.render();
        if (pl.id === 0) {
          const m = this._lastLog().match(/draws (\d+)/);
          this.toast(m ? `Your turn — you drew ${m[1]}` : 'Your turn — tap a card');
        } else {
          // A clear "AI's turn" beat so attacks don't land on you with no warning,
          // and a moment to review your board after your own turn ends.
          this.toast(`${pl.name}'s turn…`);
          await delay(1100);
        }
      };
      this.game.onAfterPlay = async (pl, mv) => {
        const fresh = this.game.logs.slice(this._seenLogs); this._seenLogs = this.game.logs.length;
        if (pl.id !== 0) {
          this._bubbles[pl.id] = this._narrate(mv); this.render();
          await this._announceAIMove(pl, mv, fresh);   // clear beat for attacks; toast otherwise
        } else {
          // Hold meaningful feedback (collected rent, a steal, "nobody could
          // pay") on screen for a beat so it isn't instantly wiped by the next
          // turn's banner when it was your 3rd/last play.
          const msg = this._humanFeedback(mv, fresh);
          this.render();
          // Your own steals get a blocking "beat" showing WHAT you took + the card
          // (mirrors the "You were attacked!" modal) — Deal Breaker used to flash
          // by with no confirmation (#5).
          const act = mv.type === 'action' ? this._actionOfMove(mv) : null;
          const aggressive = act === A.DEAL_BREAKER || act === A.SLY_DEAL || act === A.FORCED_DEAL;
          if (msg && aggressive) {
            await this._beat(ACTION_LABEL[act] || 'Your move', msg, this._cardOfMove(mv));
          } else if (msg) {
            this.toast(msg); await delay(1100);
          }
        }
      };
      // Narrate every Just Say No so the player understands why their JSN did
      // (or didn't) stick — e.g. the AI silently countering with its own JSN.
      this.game.onJsnPlayed = async (info) => {
        const who = info.responder.id === 0 ? 'You' : info.responder.name;
        this.toast(`${who} played Just Say No — ${info.actionCard.name} ${info.proceeds ? 'proceeds' : 'is cancelled'}!`);
        this.render();
        await delay(1500);
      };
      this.game.onTurnEnd = () => this.render();

      this.game.setup();
      this._seenLogs = this.game.logs.length;
      const app = document.getElementById('app');
      app.classList.add('playing'); app.classList.remove('game-over'); // reveal the board
      this.render();
      this.runLoop();
    }

    async runLoop() {
      const g = this.game;
      while (!g.winner) { await g.playTurn(); this.render(); }
      // Let the winning move's feedback (e.g. "Took the Pink set") land before
      // the victory screen takes over.
      await delay(1300);
      this.showWinner();
    }

    /* ======================================================================
     * Rendering
     * ====================================================================*/
    render() {
      const g = this.game; if (!g) return;
      const me = g.players[0];
      const myTurn = g.currentPlayerIndex === 0 && !g.winner;

      this._renderOpponents();
      this._renderTable();

      // me area
      this.$('me-area').classList.toggle('active', myTurn);
      this.$('me-avatar').textContent = this.meta[0].avatar;
      this.$('me-stats').innerHTML =
        `<span><span class="coin">M</span> ${this._bank(me)}M</span>` +
        `<span>🂠${me.hand.length}</span>`;
      this._renderZoneBank(this.$('me-bank'), me);
      this._renderZoneProps(this.$('me-props'), me);

      this._renderHand(me, myTurn);

      // pass button + play dots + explicit "plays left" label. Dots deplete
      // LEFT-TO-RIGHT: a used play dims the leftmost dot first (we read L→R).
      this.$('pass-btn').disabled = !this._pendingMove;
      const dots = this.$('play-dots'); dots.innerHTML = '';
      const left = myTurn ? g.playsRemaining : 0;
      const used = 3 - left;
      for (let i = 0; i < 3; i++) dots.append(elNew('div', 'dot' + (i >= used ? ' left' : '')));
      // At 0 plays the turn does NOT auto-end (#2) — prompt the explicit Pass.
      const outOfPlays = myTurn && left === 0 && !!this._pendingMove;
      this.$('plays-label').textContent = myTurn ? (left ? `Plays left: ${left}` : 'No plays left — tap Pass') : '';
      this.$('pass-btn').classList.toggle('hot', outOfPlays);
    }

    _bank(p) { return p.bank.reduce((s, c) => s + c.value, 0); }
    _lastLog() { const L = this.game.logs; return L.length ? L[L.length - 1] : ''; }

    _renderOpponents() {
      const g = this.game;
      const box = this.$('opponents'); box.innerHTML = '';
      for (let i = 1; i < g.players.length; i++) {
        const p = g.players[i];
        const active = g.currentPlayerIndex === i && !g.winner;
        const opp = elNew('div', 'opp' + (active ? ' active' : ''));
        const head = elNew('div', 'opp-head');
        head.style.background = this.meta[i].tint;
        // Name gets the full header width (bank moved to the meta row below) so
        // longer AI names don't truncate in the narrow 4-opponent layout.
        head.innerHTML =
          `<div class="opp-avatar">${this.meta[i].avatar}</div>` +
          `<div class="opp-name">${esc(p.name)}</div>`;
        opp.append(head);
        opp.append(elNew('div', 'opp-meta',
          `<span class="opp-bank"><span class="coin">M</span>${this._bank(p)}M</span>` +
          `<span>🂠×${p.hand.length}</span>`));
        const body = elNew('div', 'opp-body');
        this._appendSets(body, p, { detail: true });   // show their cards' values + wildcards
        if (!Object.keys(p.properties).length) body.append(elNew('div', 'opp-empty', 'no property yet'));
        opp.append(body);
        if (this._bubbles[i]) opp.append(elNew('div', 'bubble', esc(this._bubbles[i])));
        box.append(opp);
      }
    }

    // Each owned set rendered as the reference does: a small stack of mini
    // cards (colored stripe + value), with a count / "✓" label. An over-full
    // color is shown as SEPARATE sets — you can't pile a 4th onto a complete
    // 3-set; the extras form the next set (#13). Wildcards show a split/rainbow
    // stripe so you can spot (and value) a dual-color wild to steal.
    _appendSets(container, player, opts) {
      Deck.allPropertyColors().forEach(color => {
        const grp = player.properties[color]; if (!grp) return;
        const req = REQ[color];
        const chunks = [];
        for (let i = 0; i < grp.cards.length; i += req) chunks.push(grp.cards.slice(i, i + req));
        const own = opts && opts.own;
        chunks.forEach((cards, ci) => {
          const complete = cards.length >= req;
          const pset = elNew('div', 'pset' + (complete ? ' done' : '') + (own ? ' tappable' : ''));
          const stack = elNew('div', 'pstack');
          cards.forEach(c => stack.append(this._miniCard(c, color)));
          pset.append(stack);
          // Counters removed (#6): the mini-card stack already shows progress, so
          // only a COMPLETE set gets a label — buildings first, then the ✓ (order
          // swapped per #4). Incomplete sets show nothing.
          const bldg = ci === 0 ? (grp.house ? '🏠' : '') + (grp.hotel ? '🏨' : '') : '';
          const lbl = complete ? bldg + '✓' : bldg;
          if (lbl) pset.append(elNew('div', 'pset-lbl', lbl));
          // Your own sets are tappable to review the rent ladder (#7).
          if (own) pset.addEventListener('click', () => this._showSetRent(color));
          container.append(pset);
        });
      });
    }

    /** Tap one of your own property sets to review its rent ladder (#7) — the
     *  per-card-count rents, building bonuses, and what you're charging now. */
    _showSetRent(color) {
      const me = this.game.players[0];
      const g = me.properties[color] || { cards: [] };
      const owned = g.cards.length;
      const t = RENT[color];
      const nowIdx = owned ? Math.min(owned, t.length) - 1 : -1;
      const rows = t.map((v, i) => {
        const n = i === t.length - 1 ? 'Full set' : `${i + 1} card${i ? 's' : ''}`;
        return `<div class="rl-row${i === nowIdx ? ' now' : ''}"><span>${n}</span><span>${v}M</span></div>`;
      }).join('');
      const noBuild = Deck.NO_BUILDING_COLORS.indexOf(color) !== -1;
      const buildRows = noBuild ? '' :
        `<div class="rl-row"><span>+ House</span><span>+${Deck.HOUSE_RENT_BONUS}M</span></div>` +
        `<div class="rl-row"><span>+ Hotel</span><span>+${Deck.HOTEL_RENT_BONUS}M</span></div>`;
      const cur = setRentUI(me.properties, color);
      const sheet = this._sheet(
        `<h3>${esc(colorLabel(color))} — rent</h3>` +
        `<p>You own ${owned}/${REQ[color]}${owned ? ` · charging ${cur}M now` : ''}</p>` +
        `<div class="rent-levels">${rows}${buildRows}</div>` +
        '<button class="cta" id="rl-close">Close</button>');
      sheet.querySelector('#rl-close').addEventListener('click', () => this._closeOverlay());
      const scrim = this.$('overlay').querySelector('.scrim');
      if (scrim) scrim.addEventListener('click', () => this._closeOverlay());
    }

    /** Tap the "Properties" header to view your sets ENLARGED (like the hand) —
     *  each set is a row of full card faces with a color/count header (#3). */
    _showPropertiesLarge() {
      const me = this.game.players[0];
      const root = this.$('overlay');
      root.innerHTML = '<div class="scrim"></div>';
      const sheet = elNew('div', 'sheet props-large');
      sheet.append(elNew('h3', null, 'Your properties'));
      const body = elNew('div', 'plarge-body');
      let any = false;
      Deck.allPropertyColors().forEach(color => {
        const grp = me.properties[color]; if (!grp) return;
        any = true;
        const req = REQ[color];
        for (let i = 0; i < grp.cards.length; i += req) {
          const cards = grp.cards.slice(i, i + req);
          const complete = cards.length >= req;
          const setDiv = elNew('div', 'plarge-set' + (complete ? ' done' : ''));
          setDiv.append(elNew('div', 'plarge-head', `${esc(colorLabel(color))} · ${cards.length}/${req}${complete ? ' ✓' : ''}`));
          const rowEl = elNew('div', 'plarge-row');
          cards.forEach(c => {
            const f = renderCardFace(c);
            f.style.setProperty('--fs', '13px'); f.style.cursor = 'default';
            rowEl.append(f);
          });
          setDiv.append(rowEl);
          body.append(setDiv);
        }
      });
      if (!any) body.append(elNew('div', 'plarge-empty', 'No properties yet — play property cards to build sets'));
      sheet.append(body);
      const close = elNew('button', 'cta', 'Close');
      close.addEventListener('click', () => this._closeOverlay());
      sheet.append(close);
      root.append(sheet);
      root.querySelector('.scrim').addEventListener('click', () => this._closeOverlay());
      root.classList.add('show');
    }

    /** One small property card for the tableau: filled with its property color
     *  (split for a two-color wild, rainbow for a multi-wild) + a value chip. */
    _miniCard(c, color) {
      const isWild = c.type === T.PROPERTY_WILD;
      const m = elNew('div', 'mcard' + (isWild ? ' wild' : ''));
      // Fill the WHOLE card with its property color so a set reads at a glance
      // (two greens now obviously look like two green cards); value is a small
      // chip. A two-color wild splits; a multi-wild is a rainbow with a "W".
      if (isWild && c.isMulti) m.classList.add('rainbow');
      else if (isWild) m.style.background = `linear-gradient(160deg,var(--c-${c.colors[0]}) 0 50%,var(--c-${c.colors[1]}) 50% 100%)`;
      else m.style.background = `var(--c-${color})`;
      if (isWild) m.append(elNew('div', 'mc-w', c.isMulti ? '✦' : 'W'));
      m.append(elNew('div', 'mc-v', String(c.value)));
      return m;
    }
    _appendBank(container, player) {
      player.bank.slice().sort((a, b) => b.value - a.value).forEach(c => {
        container.append(elNew('div', 'bank-chip', `${c.value}M`));
      });
    }

    _renderZoneBank(zone, player) {
      zone.innerHTML = '<div class="zlabel">Bank</div>';
      if (!player.bank.length) return;
      this._appendBank(zone, player);
    }
    _renderZoneProps(zone, player) {
      zone.innerHTML = '';
      // Tap the "Properties" header to view your sets enlarged (like the hand).
      const lbl = elNew('div', 'zlabel zlabel-tap', 'Properties 🔍');
      lbl.addEventListener('click', () => this._showPropertiesLarge());
      zone.append(lbl);
      this._appendSets(zone, player, { detail: true, own: true });
      // Free wildcard reassignment (#9): on your turn you may move a placed
      // wildcard to another of its colors without spending a play.
      if (this._pendingMove) {
        const wilds = this._myWilds(player);
        if (wilds.length) {
          const btn = elNew('button', 'reassign-btn', '↻ Move wildcard');
          btn.addEventListener('click', () => this._reassignFlow(wilds));
          zone.append(btn);
        }
      }
    }

    /** Placed wildcards the human can still re-color (have >1 possible color). */
    _myWilds(player) {
      const out = [];
      Object.keys(player.properties).forEach(color => {
        player.properties[color].cards.forEach(c => {
          if (c.type === T.PROPERTY_WILD && Deck.placeableColors(c).length > 1) out.push({ card: c, color });
        });
      });
      return out;
    }
    _wildName(card) { return card.isMulti ? 'multi-color wild' : card.colors.map(c => CM[c].label).join('/') + ' wild'; }

    _reassignFlow(wilds) {
      if (wilds.length === 1) return this._reassignPickColor(wilds[0]);
      const options = wilds.map(w => ({
        label: `${this._wildName(w.card)} — now in ${colorLabel(w.color)}`,
        color: w.color,
        onPick: () => this._reassignPickColor(w),
      }));
      this._pickList('Move which wildcard?', options);
    }
    _reassignPickColor(w) {
      const valid = Deck.placeableColors(w.card).filter(c => c !== w.color);
      const moves = valid.map(color => ({ type: 'reassign', cardId: w.card.id, color }));
      // Pass the source color so the WIN/completes badge accounts for the wild
      // LEAVING w.color (its current set) — not just joining the new one.
      this._showColorPicker(moves, `Move ${this._wildName(w.card)} to…`, { sourceColor: w.color });
    }

    _renderTable() {
      const g = this.game;
      this.$('draw-pile').innerHTML =
        `<div class="cardback"><span>MATT'S</span><span>MONOPOLY</span></div><div class="count">×${g.deck.length}</div>`;
      const disc = this.$('discard-pile');
      const top = g.discard[g.discard.length - 1];
      disc.innerHTML = '';
      if (top) {
        const f = renderCardFace(top); f.style.setProperty('--fs', '7.6px'); f.style.cursor = 'default';
        disc.append(f);
        disc.append(elNew('div', 'count', `×${g.discard.length}`));
      } else {
        disc.append(elNew('div', 'empty'));
      }
    }

    _renderHand(me, interactive) {
      const handEl = this.$('hand'); handEl.innerHTML = '';
      const n = me.hand.length;
      const cards = [];
      me.hand.forEach(card => {
        const f = renderCardFace(card);
        if (interactive && this._pendingMove) f.addEventListener('click', () => this._openDetail(card.id));
        else f.style.cursor = 'default';
        handEl.append(f);
        cards.push(f);
      });
      if (!n) return;
      // Keep cards a READABLE size and overlap them into a fan to fit the width
      // (like the real app) — never shrink the text to illegibility, never
      // scroll sideways. Each card's left edge (its value pill) stays visible
      // and tappable; the rightmost card is fully shown.
      const W = (handEl.clientWidth || Math.min(window.innerWidth, 560)) - 16;
      const gap = 4, cardEm = 9.2;
      const fit = (W - (n - 1) * gap) / (n * cardEm);     // size that fits with NO overlap
      let fs = Math.max(6.6, Math.min(7.4, fit));         // floor 6.6 → overlap instead of shrinking
      let cardW = cardEm * fs;
      let total = n * cardW + (n - 1) * gap;
      let overlap = total > W ? (total - W) / (n - 1) : 0;
      // Visible left strip per overlapped card = (W - cardW)/(n-1). If a huge
      // hand makes that too thin to read/tap, ease the size down (to a hard floor).
      if (n > 1 && overlap > 0 && (W - cardW) / (n - 1) < 22) {
        cardW = Math.max(cardEm * 5.2, W - 22 * (n - 1));
        fs = Math.min(7.4, cardW / cardEm);
        cardW = cardEm * fs;
        total = n * cardW + (n - 1) * gap;
        overlap = total > W ? (total - W) / (n - 1) : 0;
      }
      cards.forEach((f, i) => {
        f.style.setProperty('--fs', fs + 'px');
        f.style.marginLeft = i === 0 ? '0' : (-overlap) + 'px';
        f.style.zIndex = String(i); // later cards on top so left strips stay tappable
      });
      handEl.style.justifyContent = overlap > 0 ? 'flex-start' : 'center';
    }

    _narrate(move) {
      if (move.type === 'bank') return 'Banked';
      if (move.type === 'property') return 'New property';
      if (move.type === 'rent') return 'Rent! Pay up';
      if (move.type === 'action') {
        return ({
          [A.DEAL_BREAKER]: 'Deal Breaker!', [A.SLY_DEAL]: 'Sly Deal!', [A.FORCED_DEAL]: 'Forced Deal!',
          [A.DEBT_COLLECTOR]: 'Pay 5M!', [A.BIRTHDAY]: "It's my birthday!", [A.PASS_GO]: 'Pass Go',
          [A.HOUSE]: 'House', [A.HOTEL]: 'Hotel',
        }[this._actionOfMove(move)] || 'Plays a card');
      }
      return '';
    }
    _actionOfMove(move) {
      // find the card in any hand/discard to know its action (best effort)
      for (const p of this.game.players) {
        const c = p.hand.find(x => x.id === move.cardId); if (c) return c.action;
      }
      const d = this.game.discard.find(x => x.id === move.cardId);
      return d ? d.action : null;
    }

    /** A short, friendly summary of the human's own resolved move, built from
     *  the deterministic engine logs produced during it. '' = no toast. */
    _humanFeedback(move, logs) {
      logs = logs || [];
      // Total money paid TO you across all targets this move.
      const collected = logs.reduce((s, l) => {
        const m = l.match(/pays You (\d+)M/); return s + (m ? +m[1] : 0);
      }, 0);
      const someoneOwed = logs.some(l => /(plays|charges|asking|demanding)/.test(l)) ||
                          /rent|action/.test(move.type);
      const nobodyPaid = collected === 0 && logs.some(l => /nothing to pay/.test(l));

      if (move.type === 'rent') {
        return collected > 0 ? `Collected ${collected}M in rent` : 'Rent — nobody could pay';
      }
      if (move.type === 'action') {
        switch (this._actionOfMove(move)) {
          case A.SLY_DEAL: {
            const m = logs.map(l => l.match(/steals (.+?) from/)).find(Boolean);
            return m ? `Stole ${m[1]}` : 'Stole a property';
          }
          case A.FORCED_DEAL: return 'Swapped a property';
          case A.DEAL_BREAKER: return move.targetColor ? `Took the ${CM[move.targetColor].label} set` : 'Stole a set';
          case A.DEBT_COLLECTOR: return collected > 0 ? `Collected ${collected}M` : 'Debt — nobody could pay';
          case A.BIRTHDAY: return collected > 0 ? `Birthday: collected ${collected}M` : 'Birthday — nobody could pay';
          case A.PASS_GO: return 'Pass Go — drew 2 cards';
          case A.HOUSE: return 'Added a House';
          case A.HOTEL: return 'Added a Hotel';
        }
      }
      return ''; // bank / property placements are self-evident on the board
    }

    /** Announce an AI move. Property-stealing actions against the human get a
     *  blocking "beat" (a clear OK modal) so you never lose a property between
     *  frames; everything else is a brief toast + the usual AI pause. */
    async _announceAIMove(pl, mv, fresh) {
      const atk = pl.name;
      let beat = null, m;
      for (const l of fresh) {
        if ((m = l.match(/steals (.+?) from You\b/))) beat = `${atk} played Sly Deal and took your ${m[1]}.`;
        else if ((m = l.match(/DEAL BREAKS You's (.+?) set/))) beat = `${atk} played Deal Breaker and took your ${m[1]} set!`;
        else if ((m = l.match(/swaps with You: takes (.+?), gives (.+?)\./))) beat = `${atk} played Forced Deal — took your ${m[1]} and gave you ${m[2]}.`;
      }
      if (beat) { return this._beat('You were attacked!', beat, this._cardOfMove(mv)); }
      // Charged you (rent/debt/birthday)? You already saw the payment screen.
      const paid = fresh.reduce((s, l) => { const x = l.match(/You pays .+? (\d+)M/); return s + (x ? +x[1] : 0); }, 0);
      if (paid > 0) { this.toast(`You paid ${paid}M to ${atk}`); return delay(this.aiDelay); }
      this.toast(this._lastLog());
      return delay(this.aiDelay);
    }

    /** The card an AI move played — now sitting on top of the discard pile. */
    _cardOfMove(move) {
      for (let i = this.game.discard.length - 1; i >= 0; i--) {
        if (this.game.discard[i].id === move.cardId) return this.game.discard[i];
      }
      return null;
    }

    /** A blocking acknowledgement modal — pauses the game until the user taps OK.
     *  Shows the offending card face when one is supplied (per-attack visual). */
    _beat(title, msg, card) {
      return new Promise(resolve => {
        const sheet = this._sheet(
          `<h3>${esc(title)}</h3><div class="beat-card"></div><p>${esc(msg)}</p>` +
          '<button class="cta" id="beat-ok">OK</button>');
        if (card) {
          const f = renderCardFace(card);
          f.style.setProperty('--fs', '12px'); f.style.cursor = 'default';
          sheet.querySelector('.beat-card').append(f);
        }
        sheet.querySelector('#beat-ok').addEventListener('click', () => { this._closeOverlay(); resolve(); });
      });
    }

    /* ======================================================================
     * Human move selection
     * ====================================================================*/
    promptMove(view, legal) {
      this._legal = legal; this._view = view;
      return new Promise(resolve => { this._pendingMove = { resolve }; this.render(); });
    }

    _passClicked() { if (this._pendingMove) this._resolveMove({ type: 'pass' }); }

    _resolveMove(move) {
      const p = this._pendingMove; this._pendingMove = null;
      this._closeDetail(); this._closeOverlay();
      if (p) p.resolve(move);
    }

    _openDetail(cardId) {
      if (!this._pendingMove) return;
      const card = this._view.me.hand.find(c => c.id === cardId);
      if (!card) return;
      const moves = this._legal.filter(m => m.cardId === cardId);
      const bankMove = moves.find(m => m.type === 'bank');
      const playMoves = moves.filter(m => m.type !== 'bank');
      // Flip applies only to two-color wilds (toggle between their two colors).
      // Multi-color "any" wilds aren't flipped — Play opens a color picker.
      const isWild = card.type === T.PROPERTY_WILD && !card.isMulti && card.colors.length > 1;
      const colors = card.type === T.PROPERTY_WILD ? card.colors : (card.color ? [card.color] : []);
      this._detail = { cardId, colorIdx: 0, colors, bankMove, playMoves, isWild, isMulti: card.type === T.PROPERTY_WILD && card.isMulti };
      this._drawDetail();
    }

    _drawDetail() {
      const d = this._detail;
      const card = this._view.me.hand.find(c => c.id === d.cardId);
      const root = this.$('card-detail');
      root.innerHTML = '<div class="scrim"></div>';
      const wrap = elNew('div', 'detail-wrap');
      // No dimmed half — Flip is gone, so show both colors of a wild at full
      // brightness (the dimming made the inactive half hard to read).
      wrap.append(renderCardFace(card));

      const acts = elNew('div', 'actions');
      const mkBtn = (cls, icon, label, enabled, fn) => {
        const b = elNew('button', 'act-btn ' + cls, `<span class="ic">${icon}</span><span class="lbl">${label}</span>`);
        b.disabled = !enabled;
        if (enabled) b.addEventListener('click', fn);
        return b;
      };
      // No Flip button: every wild (two-color AND any-color) picks its color in
      // the color-swatch picker on Play — Flip was redundant with that and
      // implied state it didn't keep.
      acts.append(mkBtn('bank', '🏦', 'Bank', !!d.bankMove, () => this._resolveMove(d.bankMove)));
      acts.append(mkBtn('play', '✔', 'Play', d.playMoves.length > 0, () => this._playFromDetail()));
      // "Close" just dismisses this card (returns to the hand). Ending the turn
      // is the board's big Pass button — two different actions, two names.
      acts.append(mkBtn('close', '✕', 'Close', true, () => this._closeDetail()));
      wrap.append(acts);
      // Explain a greyed-out Play so it doesn't look like a bug (clear banner
      // above the card — not crammed under it).
      if (d.playMoves.length === 0) {
        const reason = this._playDisabledReason(card);
        if (reason) wrap.append(elNew('div', 'detail-note', esc(reason)));
      }
      root.append(wrap);
      root.querySelector('.scrim').addEventListener('click', () => this._closeDetail());
      root.classList.add('show');
    }

    _playDisabledReason(card) {
      if (card.type === T.MONEY) return 'Money is banked, not played';
      if (card.type === T.RENT) return 'You don’t own any of this card’s colors';
      if (card.type !== T.ACTION) return '';
      // Complete sets I own, and whether any can actually take a building.
      const props = this._view.me.properties;
      const complete = Object.keys(props).filter(c => props[c].cards.length >= REQ[c]);
      const buildable = complete.filter(c => Deck.NO_BUILDING_COLORS.indexOf(c) === -1);
      const onlyRailUtil = complete.length > 0 && buildable.length === 0;
      switch (card.action) {
        case A.JUST_SAY_NO: return 'Plays automatically when you’re attacked';
        case A.DOUBLE_RENT: return 'Play it together with a Rent card to double it';
        case A.HOUSE:
          return onlyRailUtil ? 'Houses can’t go on Railroad or Utility sets'
                              : 'Needs a complete set with no house';
        case A.HOTEL:
          return onlyRailUtil ? 'Hotels can’t go on Railroad or Utility sets'
                              : 'Needs a complete set that already has a house';
        case A.DEAL_BREAKER: return 'No opponent has a complete set to steal';
        case A.SLY_DEAL:
        case A.FORCED_DEAL: return 'No opponent has a stealable property';
        default: return 'Can’t be played right now';
      }
    }

    _playFromDetail() {
      const d = this._detail;
      const card = this._view.me.hand.find(c => c.id === d.cardId);
      if (card.type === T.PROPERTY) {
        const mv = d.playMoves.find(m => m.type === 'property' && m.color === card.color) || d.playMoves[0];
        return this._resolveMove(mv);
      }
      // Every wildcard (two-color AND multi-color) is placed via an explicit
      // color picker with completion hints — no silent auto-assignment.
      if (card.type === T.PROPERTY_WILD) {
        if (d.playMoves.length === 1) return this._resolveMove(d.playMoves[0]);
        this._closeDetail();
        return this._showColorPicker(d.playMoves, 'Place wildcard as…');
      }
      // Rent gets its own clear flow (pick color/target, then a plain
      // "Double the Rent?" yes/no) — not a cryptic "Choose a target" list.
      if (card.type === T.RENT) {
        this._closeDetail(); return this._rentFlow(d.playMoves);
      }
      // Swap/steal get guided pickers so the lists stay short and unambiguous.
      if (card.type === T.ACTION && card.action === A.FORCED_DEAL) {
        this._closeDetail(); return this._forcedDealFlow(d.playMoves);
      }
      if (card.type === T.ACTION && card.action === A.SLY_DEAL) {
        this._closeDetail(); return this._slyDealFlow(d.playMoves);
      }
      // Deal Breaker ALWAYS gets an explicit player→set picker (even with one
      // set on the board) so a steal never resolves silently (#5).
      if (card.type === T.ACTION && card.action === A.DEAL_BREAKER) {
        this._closeDetail(); return this._dealBreakerFlow(d.playMoves);
      }
      // Single legal play → do it; otherwise pick a target.
      if (d.playMoves.length === 1) return this._resolveMove(d.playMoves[0]);
      this._closeDetail();
      this._showTargets(d.playMoves);
    }

    /** Rent: pick color + who pays, then an explicit "Double the Rent?" step.
     *  Replaces the confusing "Choose a target → Rent Light Blue" list (#5,#10). */
    _rentFlow(moves) {
      const view = this._view, me = view.me;
      const bases = moves.filter(m => !(m.doubleCardIds && m.doubleCardIds.length));
      const doubleOf = (b) => moves.find(m => m.doubleCardIds && m.doubleCardIds.length &&
        m.color === b.color && m.targetPlayerId === b.targetPlayerId);

      const askDouble = (base, back) => {
        const dbl = doubleOf(base);
        const amt = setRentUI(me.properties, base.color);
        const who = base.targetPlayerId != null ? this._oppName(view, base.targetPlayerId) : 'all players';
        if (!dbl) return this._resolveMove(base);
        this._pickList('Double the Rent?', [
          { label: `Yes — charge ${amt * 2}M (uses your Double the Rent card)`, win: true, color: base.color, onPick: () => this._resolveMove(dbl) },
          { label: `No — charge ${amt}M`, color: base.color, onPick: () => this._resolveMove(base) },
        ], { subtitle: `Rent on ${colorLabel(base.color)} — ${who} would pay ${amt}M` });
      };

      // Wild rent charges ONE player: pick who pays (avatar+name tiles) before
      // the double step (#2/#4 — was an ugly text-row list).
      const pickWho = (color, list, back) => {
        const amt = setRentUI(me.properties, color);
        const entries = list.map(b => ({
          id: b.targetPlayerId, name: this._oppName(view, b.targetPlayerId),
          avatar: this.meta[b.targetPlayerId].avatar, tint: this.meta[b.targetPlayerId].tint,
          sub: `pays ${amt}M`, onPick: () => askDouble(b, back),
        }));
        this._pickPlayerTile(`Charge ${colorLabel(color)} rent — who pays?`, entries,
          { subtitle: 'Wild rent hits one player', onBack: back, backLabel: '← Sets' });
      };

      // Group the base moves by your color set.
      const byColor = new Map();
      bases.forEach(b => { if (!byColor.has(b.color)) byColor.set(b.color, []); byColor.get(b.color).push(b); });
      const colors = [...byColor.keys()];
      if (colors.length === 1 && byColor.get(colors[0]).length === 1) return askDouble(byColor.get(colors[0])[0]);

      const showGrid = () => {
        const items = colors.map(color => {
          const list = byColor.get(color);
          const amt = setRentUI(me.properties, color);
          const targeted = list[0].targetPlayerId != null; // wild rent → pick a player
          return {
            name: colorLabel(color), color, count: countOf(me.properties, color), req: REQ[color],
            sub: targeted ? 'charge one player' : 'charge all players',
            amount: `${amt}M`,
            flag: null,
            onPick: () => (list.length > 1 ? pickWho(color, list, showGrid) : askDouble(list[0], showGrid)),
          };
        });
        this._propTilePicker('Charge rent — pick a set', items, {});
      };
      showGrid();
    }

    /** Vertical, scrollable list picker with a sticky header. Each option is
     *  {label, win?, onPick}. A Cancel row is always appended. */
    _pickList(title, options, opts) {
      opts = opts || {};
      const root = this.$('overlay');
      root.innerHTML = '<div class="scrim"></div>';
      const sheet = elNew('div', 'sheet picker');
      sheet.append(elNew('h3', null, esc(title)));
      if (opts.subtitle) sheet.append(elNew('p', null, esc(opts.subtitle)));
      const list = elNew('div', 'pick-list');
      options.forEach(o => {
        const b = elNew('button', 'pick' + (o.win ? ' win' : ''), esc(o.label));
        // Color-code the row by the property color so the choices read visually,
        // not as an undifferentiated wall of white text.
        if (o.color) { b.classList.add('pick-color'); b.style.setProperty('--pick-c', `var(--c-${o.color})`); }
        b.addEventListener('click', o.onPick);
        list.append(b);
      });
      const cancel = elNew('button', 'pick ghost', 'Cancel');
      cancel.addEventListener('click', () => this._closeOverlay());
      list.append(cancel);
      sheet.append(list);
      root.append(sheet);
      root.querySelector('.scrim').addEventListener('click', () => this._closeOverlay());
      root.classList.add('show');
    }

    _showTargets(moves, title) {
      const seen = {};
      const options = moves.map(m => {
        const lbl = this._describeMove(this._view, m);
        // Distinguish any still-identical labels as a last resort.
        seen[lbl.text] = (seen[lbl.text] || 0) + 1;
        const label = seen[lbl.text] > 1 ? `${lbl.text} (${seen[lbl.text]})` : lbl.text;
        // Surface the useful choices first (winning, then completing a set),
        // so on a 10-color wild you don't scroll past junk to find them.
        const rank = lbl.win ? 0 : (/completes/.test(lbl.text) ? 1 : 2);
        return { label, win: lbl.win, rank, onPick: () => this._resolveMove(m) };
      });
      options.sort((a, b) => a.rank - b.rank);
      this._pickList(title || 'Choose a target', options);
    }

    /** Wildcard color picker — an actual grid of COLOR SWATCHES (not a text
     *  list), completing colors first, with a Cancel that's always reachable. */
    /** Distinct complete-color count for MY board AFTER applying {color:delta}
     *  changes. This is the ONLY correct way to score a win/complete badge —
     *  the old `me.completeSets + 1` lied on reassignment (moving a wild breaks
     *  its source set, so the net set count often doesn't change). Mirrors the
     *  engine's completeSetCount (a set is complete at cards.length >= REQ). */
    _completeColorsAfter(deltas) {
      const me = this._view.me, counts = {};
      Object.keys(me.properties).forEach(c => { counts[c] = me.properties[c].cards.length; });
      Object.keys(deltas || {}).forEach(c => { counts[c] = (counts[c] || 0) + deltas[c]; });
      return Object.keys(counts).filter(c => counts[c] >= REQ[c]).length;
    }

    _showColorPicker(moves, title, opts) {
      const me = this._view.me;
      const src = opts && opts.sourceColor;   // set only when MOVING a placed wild
      const scored = moves.map(m => {
        const before = countOf(me.properties, m.color);
        const completes = before < REQ[m.color] && before + 1 >= REQ[m.color];
        // Simulate the true net effect: on a reassign the source loses a card.
        const deltas = src ? { [src]: -1, [m.color]: 1 } : { [m.color]: 1 };
        const win = this._completeColorsAfter(deltas) >= 3;
        return { m, completes, win, rank: win ? 0 : completes ? 1 : 2 };
      }).sort((a, b) => a.rank - b.rank);

      const root = this.$('overlay');
      root.innerHTML = '<div class="scrim"></div>';
      const sheet = elNew('div', 'sheet swatch-sheet');
      sheet.append(elNew('h3', null, esc(title || 'Place wildcard as…')));
      const grid = elNew('div', 'swatch-grid');
      scored.forEach(({ m, completes, win }) => {
        const dark = LIGHT_BANDS.indexOf(m.color) === -1;
        const b = elNew('button', 'swatch' + (win ? ' win' : completes ? ' completes' : ''));
        b.style.background = `var(--c-${m.color})`;
        if (!dark) b.style.color = '#1a1a1a';
        b.innerHTML = `<span class="sw-name">${esc(colorLabel(m.color))}</span>` +
          (win ? '<span class="sw-tag">🏆 WINS</span>' : completes ? '<span class="sw-tag">✓ completes</span>' : '');
        b.addEventListener('click', () => this._resolveMove(m));
        grid.append(b);
      });
      sheet.append(grid);
      const cancel = elNew('button', 'cta swatch-cancel', 'Cancel');
      cancel.addEventListener('click', () => this._closeOverlay());
      sheet.append(cancel);
      root.append(sheet);
      root.querySelector('.scrim').addEventListener('click', () => this._closeOverlay());
      root.classList.add('show');
    }

    /* ----------------------------------------------------------------------
     * Visual property-tile picker (#7/#8 redesign). Steal/swap/rent choices are
     * shown as tappable mini property-set cards — color band + name + progress +
     * a gold amount + a ✓completes/🏆wins flag — grouped by player where the
     * target is an opponent (player-first, with a BACK button to review each).
     * -------------------------------------------------------------------- */

    /** Colored band element for a tile: solid color, split two-color wild, or
     *  rainbow multi-wild. `spec` = {color, colors, isWild, isMulti}. */
    _tileBand(spec) {
      const band = elNew('div', 'pp-band');
      if (spec.isWild && spec.isMulti) band.classList.add('rainbow');
      else if (spec.isWild && spec.colors && spec.colors.length >= 2)
        band.style.background = `linear-gradient(90deg,var(--c-${spec.colors[0]}) 0 50%,var(--c-${spec.colors[1]}) 50% 100%)`;
      else band.style.background = `var(--c-${spec.color})`;
      return band;
    }

    /** Grid of property tiles. items: {color/colors/isWild/isMulti, name, sub,
     *  amount, flag('win'|'completes'|null), onPick}. opts: {subtitle, onBack,
     *  backLabel}. Always appends Back (if onBack) + Cancel in a footer row. */
    _propTilePicker(title, items, opts) {
      opts = opts || {};
      const root = this.$('overlay');
      root.innerHTML = '<div class="scrim"></div>';
      const sheet = elNew('div', 'sheet picker');
      sheet.append(elNew('h3', null, esc(title)));
      if (opts.subtitle) sheet.append(elNew('p', null, esc(opts.subtitle)));
      const grid = elNew('div', 'ppick-grid');
      items.forEach(it => {
        const b = elNew('button', 'ppick' + (it.flag === 'win' ? ' win' : it.flag === 'completes' ? ' completes' : ''));
        b.append(this._tileBand(it));
        const body = elNew('div', 'pp-body');
        body.innerHTML =
          `<div class="pp-name">${esc(it.name)}</div>` +
          (it.sub ? `<div class="pp-sub">${esc(it.sub)}</div>` : '') +
          (it.amount ? `<div class="pp-amt">${esc(it.amount)}</div>` : '') +
          (it.flag ? `<div class="pp-flag${it.flag === 'win' ? ' win' : ''}">${it.flag === 'win' ? '🏆 WINS' : '✓ completes'}</div>` : '');
        b.append(body);
        b.addEventListener('click', it.onPick);
        grid.append(b);
      });
      sheet.append(grid);
      const foot = elNew('div', 'ppick-foot');
      if (opts.onBack) {
        const back = elNew('button', 'pick ghost', opts.backLabel || '← Back');
        back.addEventListener('click', opts.onBack);
        foot.append(back);
      }
      const cancel = elNew('button', 'pick ghost', 'Cancel');
      cancel.addEventListener('click', () => this._closeOverlay());
      foot.append(cancel);
      sheet.append(foot);
      root.append(sheet);
      root.querySelector('.scrim').addEventListener('click', () => this._closeOverlay());
      root.classList.add('show');
    }

    /** A grid of PLAYER tiles — avatar emoji + name (+ optional sub), tinted per
     *  player. Used for "who pays?" and steal player-select (#2/#4). entries:
     *  {id,name,avatar,tint,sub,onPick}. opts: {subtitle,onBack,backLabel}. */
    _pickPlayerTile(title, entries, opts) {
      opts = opts || {};
      const root = this.$('overlay');
      root.innerHTML = '<div class="scrim"></div>';
      const sheet = elNew('div', 'sheet picker');
      sheet.append(elNew('h3', null, esc(title)));
      if (opts.subtitle) sheet.append(elNew('p', null, esc(opts.subtitle)));
      const grid = elNew('div', 'plr-grid');
      entries.forEach(e => {
        const b = elNew('button', 'plr');
        b.style.setProperty('--plr-tint', e.tint || '#1f5fc8');
        b.innerHTML =
          `<div class="plr-av">${e.avatar || '🧑'}</div>` +
          `<div class="plr-txt"><div class="plr-name">${esc(e.name)}</div>` +
          (e.sub ? `<div class="plr-sub">${esc(e.sub)}</div>` : '') + '</div>';
        b.addEventListener('click', e.onPick);
        grid.append(b);
      });
      sheet.append(grid);
      const foot = elNew('div', 'ppick-foot');
      if (opts.onBack) {
        const back = elNew('button', 'pick ghost', opts.backLabel || '← Back');
        back.addEventListener('click', opts.onBack);
        foot.append(back);
      }
      const cancel = elNew('button', 'pick ghost', 'Cancel');
      cancel.addEventListener('click', () => this._closeOverlay());
      foot.append(cancel);
      sheet.append(foot);
      root.append(sheet);
      root.querySelector('.scrim').addEventListener('click', () => this._closeOverlay());
      root.classList.add('show');
    }

    /** Step 1 of an opponent-targeted action: pick which player (avatar + name
     *  tiles). `render(list, opp, back)` then shows that player's tiles; `back`
     *  returns here. A single opponent skips straight to their cards. */
    _pickStealPlayer(title, moves, render) {
      const view = this._view;
      const byId = new Map();
      moves.forEach(m => { if (!byId.has(m.targetPlayerId)) byId.set(m.targetPlayerId, []); byId.get(m.targetPlayerId).push(m); });
      const ids = [...byId.keys()];
      const oppOf = (id) => view.opponents.find(o => o.id === id);
      if (ids.length === 1) return render(byId.get(ids[0]), oppOf(ids[0]), null);
      const back = () => this._pickStealPlayer(title, moves, render);
      const entries = ids.map(id => {
        const opp = oppOf(id);
        const n = new Set(byId.get(id).map(m => m.targetCardId != null ? m.targetCardId : m.targetColor)).size;
        return {
          id, name: opp.name, avatar: this.meta[id].avatar, tint: this.meta[id].tint,
          sub: `${n} option${n > 1 ? 's' : ''}`,
          onPick: () => render(byId.get(id), opp, back),
        };
      });
      this._pickPlayerTile(title, entries, { subtitle: 'Choose a player, then their card' });
    }

    /** Tile spec from a _propDesc, for a steal/give grid. */
    _tileFromDesc(pd, flag, onPick) {
      if (!pd) return { name: 'Property', color: 'brown', count: 0, req: 0, onPick, flag: null };
      const rentTop = pd.isMulti ? null : (RENT[pd.color] ? RENT[pd.color][RENT[pd.color].length - 1] : null);
      return {
        name: pd.name, color: pd.color, isWild: pd.isWild, isMulti: pd.isMulti, colors: pd.colors,
        sub: `${pd.count}/${pd.req} · ${pd.value}M`,
        amount: rentTop != null ? `full-set rent ${rentTop}M` : null,
        flag, onPick,
      };
    }

    /** Describe a property a player holds: color/name, $value, set progress. */
    _propDesc(playerView, cardId) {
      for (const color of Object.keys(playerView.properties)) {
        const g = playerView.properties[color];
        const c = g.cards.find(x => x.id === cardId);
        if (!c) continue;
        const isWild = c.type === T.PROPERTY_WILD;
        const name = isWild
          ? (c.isMulti ? 'Wild' : c.colors.map(k => CM[k].label).join('/'))
          : colorLabel(color);
        return { color, name, value: c.value, count: g.cards.length, req: REQ[color], isWild,
                 isMulti: !!c.isMulti, colors: isWild ? c.colors.slice() : [color] };
      }
      return null;
    }

    /** Two cards a player can't tell apart (same color, value, real/wild) are
     *  interchangeable for a steal/swap — keep only the first of each so the
     *  list isn't padded with indistinguishable "(2)" duplicates. */
    _dedupeMoves(moves, propOf) {
      const seen = new Set(), out = [];
      for (const m of moves) {
        const pd = propOf(m);
        const sig = pd ? `${pd.color}:${pd.value}:${pd.isWild ? 'w' : 'p'}` : Math.random();
        if (seen.has(sig)) continue;
        seen.add(sig); out.push(m);
      }
      return out;
    }

    /** Sly Deal: pick a player, then a tile from that player's stealable props. */
    _slyDealFlow(moves) {
      this._pickStealPlayer('Sly Deal — steal a property', moves, (list, opp, back) => {
        const me = this._view.me;
        const unique = this._dedupeMoves(list, (m) => this._propDesc(opp, m.targetCardId));
        const items = unique.map(m => {
          const pd = this._propDesc(opp, m.targetCardId);
          return this._tileFromDesc(pd, this._stealFlag(pd), () => this._resolveMove(m));
        });
        this._propTilePicker(`Steal from ${opp.name}`, items, { onBack: back, backLabel: '← Players' });
      });
    }

    /** Deal Breaker: pick a player, then which of their COMPLETE sets to take —
     *  always an explicit choice (even with one set) so it never "just happens". */
    _dealBreakerFlow(moves) {
      this._pickStealPlayer('Deal Breaker — steal a full set', moves, (list, opp, back) => {
        const items = list.map(m => {
          const g = opp.properties[m.targetColor];
          // Only ONE complete set is stolen, so price up just those cards — an
          // over-full color's extras stay with the owner (see _stealCompleteSet).
          const value = g ? g.cards.slice(0, REQ[m.targetColor]).reduce((s, c) => s + (c.value || 0), 0) : 0;
          const rentTop = RENT[m.targetColor] ? RENT[m.targetColor][RENT[m.targetColor].length - 1] : null;
          // Stealing a whole set gives me a complete set of that color — true win
          // only if it's a NEW distinct complete color reaching 3 total.
          const win = this._completeColorsAfter({ [m.targetColor]: REQ[m.targetColor] }) >= 3;
          const bld = g ? (g.house ? '🏠' : '') + (g.hotel ? '🏨' : '') : '';
          return {
            name: colorLabel(m.targetColor) + (bld ? ' ' + bld : ''), color: m.targetColor,
            sub: `full set${value ? ` · worth ${value}M` : ''}`,
            amount: rentTop != null ? `rent ${rentTop}M` : null,
            flag: win ? 'win' : 'completes',
            onPick: () => this._resolveMove(m),
          };
        });
        this._propTilePicker(`Steal ${opp.name}'s set`, items, { onBack: back, backLabel: '← Players' });
      });
    }

    /** Forced Deal: player → take (tile) → give one of yours (tile), Back at each. */
    _forcedDealFlow(moves) {
      this._pickStealPlayer('Forced Deal — take a property', moves, (list, opp, back) => {
        this._forcedDealTake(list, opp, back);
      });
    }
    _forcedDealTake(list, opp, back) {
      const takeMap = new Map();
      list.forEach(m => {
        const pd = this._propDesc(opp, m.targetCardId);
        const sig = pd ? `${pd.color}:${pd.value}:${pd.isWild ? 'w' : 'p'}` : 'x';
        if (!takeMap.has(sig)) takeMap.set(sig, []);
        takeMap.get(sig).push(m);
      });
      const items = [...takeMap.values()].map(group => {
        const pd = this._propDesc(opp, group[0].targetCardId);
        return this._tileFromDesc(pd, this._stealFlag(pd, true), () =>
          this._forcedDealGive(group, () => this._forcedDealTake(list, opp, back)));
      });
      this._propTilePicker(`Take from ${opp.name}`, items, {
        subtitle: 'You give one of yours in exchange', onBack: back, backLabel: '← Players',
      });
    }
    _forcedDealGive(moves, back) {
      const me = this._view.me;
      const unique = this._dedupeMoves(moves, (m) => this._propDesc(me, m.myCardId));
      const items = unique.map(m => this._tileFromDesc(this._propDesc(me, m.myCardId), null, () => this._resolveMove(m)));
      this._propTilePicker('Give which of yours?', items, { onBack: back, backLabel: '← Back' });
    }

    /** Would taking this property complete a set for me / win the game? */
    _stealFlag(pd, noWin) {
      if (!pd) return null;
      const me = this._view.me;
      const before = countOf(me.properties, pd.color);
      const completes = before < REQ[pd.color] && before + 1 >= REQ[pd.color];
      if (!completes) return null;
      return (!noWin && this._completeColorsAfter({ [pd.color]: 1 }) >= 3) ? 'win' : 'completes';
    }

    _closeDetail() { const r = this.$('card-detail'); r.classList.remove('show'); r.innerHTML = ''; }
    _closeOverlay() { const r = this.$('overlay'); r.classList.remove('show'); r.innerHTML = ''; }

    _oppName(view, id) {
      const o = view.opponents.find(x => x.id === id);
      return o ? o.name : 'opponent';
    }
    _findProp(props, cardId) {
      for (const color of Object.keys(props)) if (props[color].cards.some(c => c.id === cardId)) return { color };
      return null;
    }

    _describeMove(view, move) {
      const me = view.me;
      const card = me.hand.find(c => c.id === move.cardId);
      if (move.type === 'property') {
        const before = countOf(me.properties, move.color);
        const completes = before < REQ[move.color] && before + 1 >= REQ[move.color];
        const win = this._completeColorsAfter({ [move.color]: 1 }) >= 3;
        return { text: CM[move.color].label + (win ? ' 🏆 WINS!' : completes ? ' ✓ completes' : ''), win };
      }
      if (move.type === 'rent') {
        const base = setRentUI(me.properties, move.color);
        const mult = Math.pow(2, (move.doubleCardIds || []).length);
        const who = move.targetPlayerId != null ? this._oppName(view, move.targetPlayerId) : 'all';
        return { text: `Rent ${CM[move.color].label}${mult > 1 ? ' ×2' : ''} → ${who} pays ${base * mult}M` };
      }
      if (move.type === 'action') {
        const who = move.targetPlayerId != null ? this._oppName(view, move.targetPlayerId) : null;
        switch (card.action) {
          case A.DEBT_COLLECTOR: return { text: `${who}: pay 5M` };
          case A.HOUSE: return { text: 'House → ' + CM[move.color].label };
          case A.HOTEL: return { text: 'Hotel → ' + CM[move.color].label };
          case A.SLY_DEAL: {
            const opp = view.opponents.find(o => o.id === move.targetPlayerId);
            const f = opp && this._findProp(opp.properties, move.targetCardId);
            return { text: `Steal ${f ? CM[f.color].label : 'property'} from ${who}` };
          }
          case A.FORCED_DEAL: {
            const opp = view.opponents.find(o => o.id === move.targetPlayerId);
            const t = opp && this._findProp(opp.properties, move.targetCardId);
            const m = this._findProp(me.properties, move.myCardId);
            return { text: `Give ${m ? CM[m.color].label : '?'}, take ${t ? CM[t.color].label : '?'} (${who})` };
          }
          case A.DEAL_BREAKER: {
            const win = this._completeColorsAfter({ [move.targetColor]: REQ[move.targetColor] }) >= 3;
            return { text: `Deal Breaker: ${who}'s ${CM[move.targetColor].label}` + (win ? ' 🏆' : ''), win };
          }
        }
      }
      return { text: 'Play' };
    }

    /* ======================================================================
     * Reactive overlays
     * ====================================================================*/
    _sheet(html) {
      const root = this.$('overlay');
      root.innerHTML = '<div class="scrim"></div>';
      const sheet = elNew('div', 'sheet', html);
      root.append(sheet);
      root.classList.add('show');
      return sheet;
    }

    promptJSN(view, ctx) {
      const card = ctx.actionCard;
      const atkName = this._oppName(view, ctx.attackerId);
      return new Promise(resolve => {
        const sheet = this._sheet(
          `<h3>Just Say No?</h3><p>${ctx.responderRole === 'attacker'
            ? esc(atkName) + ' cancelled your ' + esc(card.name) + '. Counter it?'
            : esc(atkName) + ' played ' + esc(card.name) + ' against you. Cancel it?'}</p>` +
          '<div class="row"><button class="opt win" id="jsn-yes">Play Just Say No</button>' +
          '<button class="opt ghost" id="jsn-no">' + (ctx.responderRole === 'attacker' ? 'Let it cancel' : 'Allow it') + '</button></div>');
        sheet.querySelector('#jsn-yes').addEventListener('click', () => { this._closeOverlay(); resolve(true); });
        sheet.querySelector('#jsn-no').addEventListener('click', () => { this._closeOverlay(); resolve(false); });
      });
    }

    promptPayment(view, ctx) {
      const me = view.me;
      const completeColors = new Set(Object.keys(me.properties).filter(c => me.properties[c].cards.length >= REQ[c]));
      // Gather selectable assets, keeping the real card object so we can render
      // an authentic face for each (bank money, then property cards/buildings).
      const bankAssets = me.bank.filter(c => c.canPay !== false).map(c => ({ card: c, value: c.value }));
      const propAssets = [];
      Object.keys(me.properties).forEach(color => {
        const g = me.properties[color];
        const breaks = completeColors.has(color); // paying with this breaks a finished set
        g.cards.forEach(c => { if (c.canPay) propAssets.push({ card: c, value: c.value, breaks }); });
        if (g.house) propAssets.push({ card: g.house, value: g.house.value, breaks });
        if (g.hotel) propAssets.push({ card: g.hotel, value: g.hotel.value, breaks });
      });
      const all = bankAssets.concat(propAssets);
      const total = all.reduce((s, a) => s + a.value, 0);
      const required = Math.min(ctx.amount, total);
      const creditor = this._oppName(view, ctx.creditorId);
      const reasonWord = ctx.reason === 'birthday' ? 'Birthday' : ctx.reason === 'rent' ? 'Rent' : 'Debt';

      return new Promise(resolve => {
        const root = this.$('overlay');
        root.innerHTML = '';

        if (!all.length) {
          const sheet = this._sheet(`<h3>You owe ${ctx.amount}M to ${esc(creditor)}</h3>` +
            '<p>You have nothing on the table — you pay nothing</p><button class="cta" id="ok">OK</button>');
          sheet.querySelector('#ok').addEventListener('click', () => { this._closeOverlay(); resolve([]); });
          return;
        }

        const selected = new Set();
        const screen = elNew('div', 'pay-screen');
        // Minimal copy: who + amount on top, a short "Tap to select" hint below.
        const banner = elNew('div', 'pay-banner',
          `<div class="main">Pay ${ctx.amount}M to ${esc(creditor)}</div>` +
          `<div class="sub" id="pay-sub">${esc(reasonWord)} · tap cards to select</div>`);

        // Scrollable middle: the charging card, then labelled bank + property rows.
        const scroll = elNew('div', 'pay-scroll');
        if (ctx.sourceCard) { const sc = renderCardFace(ctx.sourceCard); sc.classList.add('pay-source'); sc.style.cursor = 'default'; scroll.append(sc); }

        const refresh = () => {
          const s = all.filter(a => selected.has(a.card.id)).reduce((sum, a) => sum + a.value, 0);
          sel.textContent = `Selected ${s}M`;
          payBtn.disabled = s < required;
          // Minimal hint; still flags overpay (no change back).
          banner.querySelector('#pay-sub').textContent =
            s > required ? `Overpaying ${s - required}M · no change given`
          : s === required ? 'Tap Pay'
          : `Tap cards to select · need ${required}M`;
        };
        const mkZone = (label, assets, emptyMsg) => {
          scroll.append(elNew('div', 'pay-zlabel', label));
          const zone = elNew('div', 'pay-zone');
          if (!assets.length) zone.append(elNew('div', 'zempty', emptyMsg));
          assets.forEach(a => {
            const wrap = elNew('div', 'pay-card' + (a.breaks ? ' breaks' : ''));
            wrap.append(renderCardFace(a.card));
            if (a.breaks) wrap.append(elNew('div', 'breaks-tag', '⚠ breaks set'));
            wrap.addEventListener('click', () => {
              if (selected.has(a.card.id)) { selected.delete(a.card.id); wrap.classList.remove('sel'); }
              else { selected.add(a.card.id); wrap.classList.add('sel'); }
              refresh();
            });
            zone.append(wrap);
          });
          scroll.append(zone);
        };
        mkZone('Bank', bankAssets, 'No bank cards');
        mkZone('Properties', propAssets, 'No properties — bank only');

        // Fixed footer so the controls never float over the board.
        const footer = elNew('div', 'pay-footer');
        const sel = elNew('div', 'pay-selected', 'Selected 0M');
        const payBtn = elNew('button', 'pay-go', 'Pay'); payBtn.disabled = true;
        const clearBtn = elNew('button', 'pay-clear', 'Clear');
        const btns = elNew('div', 'pay-actions'); btns.append(payBtn, clearBtn);
        footer.append(sel, btns);

        payBtn.addEventListener('click', () => { this._closeOverlay(); resolve([...selected]); });
        clearBtn.addEventListener('click', () => {
          selected.clear();
          screen.querySelectorAll('.pay-card.sel').forEach(e => e.classList.remove('sel'));
          refresh();
        });

        screen.append(banner, scroll, footer);
        root.append(screen);
        root.classList.add('show');
        refresh();
      });
    }

    promptDiscards(view, count) {
      const hand = view.me.hand.slice();
      return new Promise(resolve => {
        const selected = new Set();
        const sheet = this._sheet(
          `<h3>Discard ${count} card${count === 1 ? '' : 's'}</h3><p>You are over the 7-card limit.</p>` +
          '<div class="row" id="d-row"></div><button class="cta" id="d-go" disabled>Discard</button>');
        const row = sheet.querySelector('#d-row');
        const go = sheet.querySelector('#d-go');
        const refresh = () => { go.disabled = selected.size !== count; };
        hand.forEach(c => {
          const b = elNew('button', 'opt', esc(shortName(c)));
          b.addEventListener('click', () => {
            if (selected.has(c.id)) selected.delete(c.id);
            else { if (selected.size >= count) return; selected.add(c.id); }
            b.classList.toggle('sel', selected.has(c.id)); refresh();
          });
          row.append(b);
        });
        go.addEventListener('click', () => { this._closeOverlay(); resolve([...selected]); });
        refresh();
      });
    }

    promptWildColor(view, card, valid) {
      const me = view.me;
      const what = card.isMulti ? 'multi-color' : (card.colors || []).map(c => CM[c].label).join(' / ');
      return new Promise(resolve => {
        const root = this.$('overlay');
        root.innerHTML = '<div class="scrim"></div>';
        const sheet = elNew('div', 'sheet swatch-sheet');
        // Framed as an INCOMING card (this only fires when you acquire a wild via
        // payment / Sly Deal / Forced Deal) so it never looks like a stray bug.
        sheet.append(elNew('h3', null, 'You received a wildcard'));
        sheet.append(elNew('p', null, `Assign your new ${what} wildcard to a set:`));
        const grid = elNew('div', 'swatch-grid');
        const scored = valid.map(color => {
          const before = countOf(me.properties, color);
          const completes = before < REQ[color] && before + 1 >= REQ[color];
          // An acquired wild is a NEW card entering your board (no source set).
          const win = this._completeColorsAfter({ [color]: 1 }) >= 3;
          return { color, completes, win, rank: win ? 0 : completes ? 1 : 2 };
        }).sort((a, b) => a.rank - b.rank);
        scored.forEach(({ color, completes, win }) => {
          const dark = LIGHT_BANDS.indexOf(color) === -1;
          const b = elNew('button', 'swatch' + (win ? ' win' : completes ? ' completes' : ''));
          b.style.background = `var(--c-${color})`;
          if (!dark) b.style.color = '#1a1a1a';
          b.innerHTML = `<span class="sw-name">${esc(colorLabel(color))}</span>` +
            (win ? '<span class="sw-tag">🏆 WINS</span>' : completes ? '<span class="sw-tag">✓ completes</span>' : '');
          b.addEventListener('click', () => { this._closeOverlay(); resolve(color); });
          grid.append(b);
        });
        sheet.append(grid);
        root.append(sheet);
        root.classList.add('show');
      });
    }

    /* ---- toast + winner ------------------------------------------------ */
    toast(msg) {
      if (!msg) return;
      const t = this.$('toast');
      t.innerHTML = `<div class="msg">${esc(msg)}</div>`;
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove('show'), 2600);
    }

    showWinner() {
      const w = this.game.winner;
      const root = this.$('winner');
      const sets = this.game.completeColors(w).map(c => CM[c].label).join(', ');
      if (!this._resultRecorded) { this._recordResult(w.id === 0); this._resultRecorded = true; }
      const s = this._loadStats();
      root.innerHTML =
        '<div class="scrim"></div><div class="win-card">' +
        `<h1>${w.id === 0 ? 'You Win! 🎉' : esc(w.name) + ' wins'}</h1>` +
        `<p>Winning sets: ${esc(sets)}</p>` +
        `<p class="win-stats">Record: ${s.won}W – ${s.lost}L</p>` +
        '<button class="cta" id="again">' + (window.__bdChallenge && window.__bdChallenge.live() ? 'Retry Challenge' : 'Play Again') + '</button>' +
        '<button class="cta ghost-cta" id="win-stats">View Stats</button>' +
        '<button class="cta ghost-cta" id="win-hub">← Game Hub</button></div>';
      root.querySelector('#again').addEventListener('click', () => this.showSetup());
      root.querySelector('#win-stats').addEventListener('click', () => this.showStats('win'));
      root.querySelector('#win-hub').addEventListener('click', () => this._toHub());
      root.classList.add('show');
      // The board's bottom "New Game" sits under this overlay (dead tap); hide it
      // so "Play Again" is the single, working restart.
      document.getElementById('app').classList.add('game-over');

      // Hidden challenge: on a qualifying human win (2+ AI at Normal or higher), record
      // it and reveal the code. Inert unless the profile name matches the trigger.
      try {
        if (window.__bdChallenge && window.__bdChallenge.live() && w.id === 0
            && (this._lastNumAI | 0) >= 2 && (this.difficulty === 'normal' || this.difficulty === 'hard')) {
          window.__bdChallenge.recordWinAndReveal();
        }
      } catch (e) { /* never break the game */ }
    }

    /* ---- stats (persisted wins/losses) --------------------------------- */
    _loadStats() {
      try { return Object.assign({ played: 0, won: 0, lost: 0 }, JSON.parse(localStorage.getItem('bd-stats') || '{}')); }
      catch (e) { return { played: 0, won: 0, lost: 0 }; }
    }
    _recordResult(humanWon) {
      // Unified Game Stats (per difficulty), recorded BEFORE the bd-stats increment so the
      // one-time bd-stats fold reads the pre-game value. bd-stats is still kept as-is below.
      try { if (window.__ghStats) window.__ghStats.record('business', this.difficulty, humanWon); } catch (e) {}
      const s = this._loadStats();
      s.played++; if (humanWon) s.won++; else s.lost++;
      try { localStorage.setItem('bd-stats', JSON.stringify(s)); } catch (e) {}
    }
    // `origin` is the screen you came from ('win' or 'setup'); Back returns there
    // instead of leaving you to the phone Back button (which exits to the hub) (#10).
    showStats(origin) {
      // Hide the screen we came from so the stats sheet fully replaces it — the
      // win card shares #overlay's z-index and was showing THROUGH the stats
      // sheet (#11/#12). _statsBack re-shows the origin.
      if (origin === 'win') this.$('winner').classList.remove('show');
      else if (origin === 'setup') this.$('setup').classList.remove('show');
      const s = this._loadStats();
      const rate = s.played ? Math.round(100 * s.won / s.played) : 0;
      const cell = (n, l) => `<div class="stat"><div class="stat-n">${n}</div><div class="stat-l">${l}</div></div>`;
      const sheet = this._sheet(
        '<h3>Your Stats</h3><div class="stats-grid">' +
        cell(s.played, 'Played') + cell(s.won, 'Won') + cell(s.lost, 'Lost') + cell(rate + '%', 'Win rate') +
        '</div><button class="cta" id="stats-back">← Back</button>' +
        '<button class="cta ghost-cta" id="stats-reset">Reset stats</button>');
      sheet.querySelector('#stats-back').addEventListener('click', () => this._statsBack(origin));
      sheet.querySelector('#stats-reset').addEventListener('click', () => {
        try { localStorage.removeItem('bd-stats'); } catch (e) {}
        this._closeOverlay(); this.showStats(origin);
      });
    }
    /** Return from Stats to where it was opened from — showStats hid that screen,
     *  so re-show it now (rebuilds cleanly, no stacked overlays). */
    _statsBack(origin) {
      this._closeOverlay();
      if (origin === 'win' && this.game && this.game.winner) this.showWinner();
      else if (origin === 'settings') this._openSettings();
      else this.showSetup();
    }
  }

  /* ---- shared helpers --------------------------------------------------- */
  function countOf(props, color) { return props[color] ? props[color].cards.length : 0; }
  function shortName(card) {
    if (card.type === T.MONEY) return card.value + 'M';
    if (card.type === T.PROPERTY) return colorLabel(card.color);
    if (card.type === T.PROPERTY_WILD) return card.isMulti ? 'Wild (any)' : card.colors.map(c => CM[c].label).join('/');
    // Use the same label the card face shows (e.g. "DOUBLE RENT", not the deck's
    // "Double The Rent") so the discard list matches the card.
    return ACTION_LABEL[card.action] || card.name;
  }
  function setRentUI(props, color) {
    const g = props[color];
    if (!g || !g.cards.length) return 0;
    const t = RENT[color];
    let r = t[Math.min(g.cards.length, t.length) - 1];
    if (g.cards.length >= REQ[color] && Deck.NO_BUILDING_COLORS.indexOf(color) === -1) {
      if (g.house) r += Deck.HOUSE_RENT_BONUS;
      if (g.hotel) r += Deck.HOTEL_RENT_BONUS;
    }
    return r;
  }

  return { BusinessDealUI, HumanAgent, renderCardFace };
});
