// hub.js — Game Hub shell: a launcher grid that mounts self-contained game
// modules into a single content area (no full page reload), using each
// module's standard contract:
//   init(container)  — mount the game
//   destroy()        — tear it down when the user goes back to the hub
//
// Adding a game = drop its folder under the hub and add an entry to GAMES.

import { loadProfile, saveProfile, newPlayerCode, canonicalizeCode } from './profile-store.js';
import { isChallengeActive, isAdmin, isDevProfile } from './challenge/hooks.js';
import { syncMyStats, usernameStatus, claimUsername, lookupCodeOwner } from './stats-net.js';
import { statsOwner } from './game-stats.js';
import { getLang, setLang, makeT } from './i18n.js';
import { loadFavorites, toggleFavorite } from './favorites.js';
import { GAME_ART } from './game-art.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
/** Resolve a hub card blurb: {en,es} objects (in-scope games) or a plain string
 *  (Monopoly Deal, Parchís — deliberately untranslated, see HANDOFF-I18N-EXTRACTION.md). */
const blurbText = (b) => (b && typeof b === 'object') ? (b[getLang()] || b.en) : b;
/** Resolve a game title the same way (Matt, 2026-07-23: titles DO translate — Spain Spanish —
 *  reversing the i18n handoff's original titles-stay decision). Proper/brand names stay plain
 *  strings. The same six Spanish names live in js/strings.js's game_title_* keys (leaderboard +
 *  stats tabs) and in each game's own strings.js title — keep all three in step. */
const titleText = (g) => (g.title && typeof g.title === 'object') ? (g.title[getLang()] || g.title.en) : g.title;

const GAMES = [
  {
    id: 'connect-four',
    title: { en: 'Connect Four', es: 'Conecta 4' },
    blurb: { en: 'Drop discs, connect four. Four AI levels incl. a perfect endgame solver.',
      es: 'Encesta fichas y conecta cuatro. Cuatro niveles de IA, incluido un solucionador perfecto de finales.' },
    // Relative to this module (js/hub.js): up to root, then into the game folder.
    module: '../connect-four/js/ui.js',
    accent: '#1769d4',
    // Landscape (16:9) lets the REAL 7x6 board fit edge to edge for the first time;
    // the square frame could only ever show a 4x4 crop of it. Red's winning diagonal
    // runs c0r5 -> c3r2, and every filled cell is gravity-valid (nothing floats).
    art: GAME_ART["connect-four"],
  },
  {
    id: 'chinchon',
    title: 'Chinchón',
    blurb: { en: 'Spanish rummy vs. smart AI. Melds, cuts & chinchón. 2–4 players.',
      es: 'Rummy español contra una IA inteligente. Ligadas, cortes y chinchón. 2-4 jugadores.' },
    module: '../chinchon/js/ui.js',
    accent: '#d4a017',
    // A held FAN of five cards is naturally wide, so it suits 16:9 far better than the
    // two-card stack the square frame forced. Centers arc up toward the middle card.
    art: GAME_ART["chinchon"],
  },
  {
    id: 'business-deal',
    title: 'Monopoly Deal',
    blurb: 'Cards, cash & schemes. Collect property sets to win vs. smart AI. 2–5 players.',
    // Monopoly Deal lives in this repo now (business-deal/) and launches out like
    // Parchís, rather than mounting as an in-hub module. It keeps its own global-JS
    // stack and service worker (nested under business-deal/); it is not an ES module.
    href: 'business-deal/',
    accent: '#6a4cff',
    // Five property cards fanned wide (one per set colour) with the cash coin in front:
    // the same "hand of cards" idea as before, but spread to fill 16:9 instead of stacked.
    art: GAME_ART["business-deal"],
  },
  {
    id: 'parchis',
    title: 'Parchís',
    blurb: 'Spanish Parchís vs. smart AI. One die, seguros, barreras & bonos. 2–4 players.',
    // Self-contained single-file game living in this repo; launches out like Monopoly Deal.
    href: 'parchis/',
    accent: '#c0632b',
    // SQUARE BOARD, deliberately not stretched or cropped: the cross is shown at full
    // height, and the flanks carry real game content (all four players' pieces on the
    // left, the die on the right) per option 1 of the handoff's square-board guidance.
    art: GAME_ART["parchis"],
  },
  {
    id: 'escoba',
    title: 'Escoba',
    blurb: { en: 'Spanish fishing card game. Capture cards that add up to 15. 2-3 players.',
      es: 'Juego de cartas español de pesca. Captura cartas que sumen 15. 2-3 jugadores.' },
    module: '../escoba/js/ui.js',
    // Escoba's own screens (setup + game mat) already show its title and back
    // affordance; the hub's own header row is pure wasted vertical space for
    // this one. Opt-in only, so every other game's chrome is untouched.
    immersive: true,
    accent: '#1c7a4f',
    // Landscape lets the three elements sit side by side instead of stacked: the fanned
    // capture, the 15 coin, and the broom (escoba). The broom moved to the RIGHT so it
    // no longer sits under the bottom-left title label.
    art: GAME_ART["escoba"],
  },
  {
    id: 'filler',
    title: 'Filler',
    blurb: { en: 'Flood-fill duel vs. smart AI. Pick colors, grow your corner, capture the majority.',
      es: 'Duelo de relleno por inundación contra una IA inteligente. Elige colores, expande tu esquina y captura la mayoría.' },
    module: '../filler/js/ui.js',
    accent: '#c2557f',
    // 8x5 instead of 5x5: the flood-fill board is arbitrary-sized, so widening it is the
    // honest landscape reading rather than a stretch. Player corner markers moved to
    // top-left / bottom-right so neither sits under the title label.
    art: GAME_ART["filler"],
  },
  {
    id: 'mancala',
    title: 'Mancala',
    blurb: { en: 'Sow stones, chain extra turns, capture the most. Vs. AI or a friend.',
      es: 'Siembra piedras, encadena turnos extra y captura las más posibles. Contra la IA o un amigo.' },
    module: '../mancala/js/ui.js',
    // The board wants every vertical pixel it can get on a phone, and the game
    // shows its own title/avatars, so the hub's header row is wasted space here.
    immersive: true,
    accent: '#e08a3c',
    // The single biggest win from landscape: a real Mancala board IS a long tray, so
    // 16:9 finally shows the true layout (two rows of six pits, a store at each end)
    // instead of the 2x2 abstraction the square frame forced.
    art: GAME_ART["mancala"],
  },
  {
    id: 'nuts-bolts',
    title: { en: 'Nuts & Bolts', es: 'Tuercas y Tornillos' },
    blurb: { en: 'Colour-sort puzzle. Stack matching nuts onto bolts.',
      es: 'Puzle de clasificar por colores. Apila tuercas iguales en los tornillos.' },
    module: '../nuts-bolts/js/ui.js',
    accent: '#607d8b',
    // Five bolts in a WIDE row rather than three stacked tall: the puzzle's real shape is
    // a workbench of bolts side by side, which is what 16:9 wants. Uneven stack heights
    // read as a puzzle mid-solve. The bench bar sits above the title label, not under it.
    art: GAME_ART["nuts-bolts"],
  },
  {
    id: 'tic-tac-toe',
    title: { en: 'Tic Tac Toe', es: 'Tres en Raya' },
    blurb: { en: 'Classic 3x3, or Ultimate: nine boards in one, where your move picks your opponent\'s board.',
      es: 'Clásico 3x3, o Definitivo: nueve tableros en uno, donde tu jugada elige el tablero de tu rival.' },
    module: '../tic-tac-toe/js/ui.js',
    accent: '#0e7c86',
    // SQUARE BOARD, deliberately not stretched: the 3x3 is shown at full height, and the
    // width is earned by the winning strike line running out past the board on both sides
    // (option 1 of the handoff's square-board guidance) rather than by distorting the grid.
    // The strike is white, so the win reads by LINE not by hue (colorblind-safe).
    art: GAME_ART["tic-tac-toe"],
  },
  {
    id: 'ball-run',
    title: { en: 'Ball Run', es: 'Carrera de Bolas' },
    blurb: { en: 'Steer a rolling ball down an endless neon runway. Dodge obstacles, chase speedpoints.',
      es: 'Guía una bola rodante por una pista de neón sin fin. Esquiva obstáculos y persigue puntos de velocidad.' },
    module: '../ball-run/js/ui.js',
    // Real-time full-bleed 3D canvas: the hub's own header row and the
    // hub-main side padding would both eat into the play area and show as
    // dead space / gutters around the game. Ball Run's own screens show
    // their own title and back affordance, same reasoning as escoba/mancala.
    immersive: true,
    accent: '#c22e8f',
    // A runway receding to a horizon is the one composition that WANTS 16:9, so this
    // gains the most from the wider frame: the track now runs off both bottom corners
    // and the perspective rungs compress toward the vanishing point.
    art: GAME_ART["ball-run"],
  },
  {
    id: 'dots-boxes',
    title: { en: 'Dots and Boxes', es: 'Puntos y Cajas' },
    blurb: { en: 'Draw lines, close boxes, chain your captures. Simple rules, deep endgame.',
      es: 'Dibuja líneas, cierra cajas y encadena tus capturas. Reglas simples, final de partida profundo.' },
    module: '../dots-boxes/js/ui.js',
    // Neutral dark backdrop on purpose, NOT a third saturated hue: with
    // --db-human/--db-ai already bright red/blue, a colorful accent behind
    // them (the old #7048a8 purple) fights the two-color art for attention.
    // #16243a is dots-boxes.css's own --db-ink, so this isn't an invented
    // color either, just the game's existing neutral pulled onto the tile.
    accent: '#16243a',
    // A 6x4 dot lattice (5x3 boxes) - wider than tall, which is what landscape wants and
    // what the real board looks like at Medium/Large. Red owns a chained PAIR of boxes,
    // the game's signature move; blue owns one. Lattice sits above the title label.
    art: GAME_ART["dots-boxes"],
  },
  {
    id: 'boggle',
    title: 'Boggle',
    blurb: {
      en: 'Shake the grid, race the clock. Link touching letters into as many words as you can.',
      es: 'Agita la cuadrícula, corre contra el reloj. Une letras contiguas en tantas palabras como puedas.',
    },
    module: '../boggle/js/ui.js',
    accent: '#1f3864',
    // A 4x4 letter grid is inherently square, so rather than stretch it (which
    // would misrepresent the board), the grid sits at FULL tile height on the
    // left and the traced word spills out of it to the right as loose,
    // slightly-rotated tiles -- the horizontal space carries the word leaving
    // the board, which is the one thing this game is actually about. Grid is
    // 16px tiles on a 3px gap (73x73, vertically centred); the gold path is
    // the same --bg-gold the game itself uses, and it takes a DIAGONAL step
    // (B->O) before running right, since diagonal adjacency is Boggle's
    // non-obvious rule. Reads B-O-G-G-L-E across the frame.
    art: GAME_ART["boggle"],
  },
  {
    id: 'snake',
    title: { en: 'Snake', es: 'Serpiente' },
    blurb: { en: 'The old phone classic. Eat, grow, and don’t hit the walls.',
      es: 'El clásico del teléfono de antes. Come, crece y no choques con las paredes.' },
    module: '../snake/js/ui.js',
    accent: '#3f7d2c',
    // The LCD look the game itself renders: pale green screen, a dark pixel snake winding across
    // the full landscape frame toward a hollow-circle food (shape, not hue, tells them apart —
    // same colorblind rule as the live board). Composed for 160x90, nothing cropped.
    art: GAME_ART["snake"],
  },
];

class Hub {
  constructor(root) {
    this.root = root;
    this.current = null;     // { module, id } of the mounted game
    this._onBack = () => this.requestLeave();
    this.render();
    // Family-wide stats sync: best-effort, guarded, no-op offline. On load, on tab-hide, on
    // returning to the launcher (a game may have just updated the stats), and on RECONNECT.
    // The reconnect hook matters: a device that played offline used to sit un-mirrored until its
    // next cold start, and because the sync failed silently nobody could tell. syncMyStats mirrors
    // the whole store every time, so this retry simply repairs whatever the offline period missed.
    this._onVis = () => { if (document.visibilityState === 'hidden') this._syncStats(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._onOnline = () => this._syncStats();
    window.addEventListener('online', this._onOnline);
    this._syncStats();
  }

  /** Best-effort family-wide stats sync (guarded; no-op offline or if Firebase is unconfigured).
   *  syncMyStats never throws and reports its own failures loudly (see stats-net.js's syncHealth) -
   *  this guard is only for a synchronous import-time fault, and must not re-swallow the result. */
  _syncStats() { try { syncMyStats(); } catch (err) { console.error('[hub] stats sync could not start', err); } }

  render() {
    // Gate the hidden challenge entry on a hashed name match (inert for everyone else).
    const prof = loadProfile();
    // M3b: the hidden challenge/gift is complete and retired. Task badges, the hidden
    // "Hidden Challenge"/"Challenge Control" hub card, and the first-activation unlock
    // announcement are gone for everyone, including the recipient and Matt. The only
    // surviving entry point is the keepsake button below, gated on the SAME identity
    // checks the challenge already used (recipient or tester name, or Matt).
    const active = !!(prof && isChallengeActive(prof.name));
    const admin = !!(prof && isAdmin(prof.name));
    this._chWins = null;
    const showKeepsake = active || admin;
    // In-development games (devOnly) render only for Matt and the tester. Everyone else,
    // including the challenge recipient, never sees the card at all.
    const dev = !!(prof && isDevProfile(prof.name));
    // Games are listed FAVORITES FIRST, then ALPHABETICALLY by display title within each
    // group (project rule). Sorting at render time keeps it self-maintaining: a new GAMES
    // entry lands in the right place no matter where it is added to the array. localeCompare
    // so accents (Chinchón, Parchís) sort correctly. An id in storage that doesn't match a
    // visible game (retired/not-yet-unlocked) is simply never matched here - it stays in
    // storage untouched and starts showing again the moment the game reappears.
    const visible = GAMES.filter((g) => !g.devOnly || dev);
    const favIds = new Set(loadFavorites());
    const byTitle = (a, b) => titleText(a).localeCompare(titleText(b));
    const favGames = visible.filter((g) => favIds.has(g.id)).sort(byTitle);
    const restGames = visible.filter((g) => !favIds.has(g.id)).sort(byTitle);
    this.games = [...favGames, ...restGames];
    this._favIds = favIds;
    // The divider only earns its place between two non-empty groups; with zero favorites
    // (the common first-run case) or with every visible game favorited, the grid is a plain
    // single alphabetical list and no divider renders.
    const showDivider = favGames.length > 0 && restGames.length > 0;
    const gridHTML = favGames.map((g) => this.cardHTML(g)).join('')
      + (showDivider ? '<div class="hub-divider">All games</div>' : '')
      + restGames.map((g) => this.cardHTML(g)).join('');
    this.root.innerHTML = `
      <div class="hub">
        <header class="hub-top">
          <div class="hub-top-info">
            <button type="button" class="hub-back" data-role="back" hidden aria-label="${t('hub_back_aria')}">‹ Hub</button>
            <h1 class="hub-top-title" data-role="title">Matt's Game Hub</h1>
            <button type="button" class="hub-langtoggle" data-role="lang"></button>
            <button type="button" class="hub-version" data-role="version" hidden></button>
          </div>
          <div class="hub-top-right">
            <button type="button" class="hub-statsbtn" data-role="stats" aria-label="${t('hub_stats_aria')}">${t('hub_stats_btn')}</button>
            <button type="button" class="hub-statsbtn" data-role="leaderboard" aria-label="${t('hub_leaderboard_aria')}">${t('hub_leaderboard_btn')}</button>
            <a class="hub-profile" data-role="profile" href="profile/">${t('hub_profile_btn')}</a>
          </div>
        </header>
        <main class="hub-main">
          <section class="hub-grid" data-role="grid" aria-label="${t('hub_games_aria')}">
            ${gridHTML}
          </section>
          ${showKeepsake ? `<section class="hub-extra"><button type="button" class="hub-statsbtn hub-keepsake-btn" data-role="keepsake">${t('hub_challenge_btn')}</button></section>` : ''}
          <section class="hub-game" data-role="game" hidden></section>
        </main>
        <div class="hub-confirm" data-role="confirm" hidden>
          <div class="hub-confirm-scrim" data-role="confirm-cancel"></div>
          <div class="hub-confirm-card" role="dialog" aria-modal="true" aria-label="${t('hub_confirm_dialog_aria')}">
            <p class="hub-confirm-msg">${t('hub_confirm_msg')}</p>
            <div class="hub-confirm-actions">
              <button type="button" class="hub-cbtn hub-cbtn-ghost" data-role="confirm-cancel">${t('hub_confirm_keep')}</button>
              <button type="button" class="hub-cbtn hub-cbtn-danger" data-role="confirm-leave">${t('hub_confirm_leave')}</button>
            </div>
          </div>
        </div>
        <div class="hub-fr" data-role="firstrun" hidden>
          <div class="hub-fr-scrim"></div>
          <div class="hub-fr-card" role="dialog" aria-modal="true" aria-label="${t('hub_fr_dialog_aria')}">
            <h2 class="hub-fr-h">${t('hub_fr_title')}</h2>
            <div class="hub-fr-row hub-fr-langrow" role="group" aria-label="${t('hub_fr_langrow_aria')}">
              <button type="button" class="hub-cbtn hub-cbtn-ghost" data-role="fr-lang" data-lang="en">English</button>
              <button type="button" class="hub-cbtn hub-cbtn-ghost" data-role="fr-lang" data-lang="es">Español</button>
            </div>
            <div class="hub-fr-row">
              <input class="hub-fr-input" data-role="fr-name" type="text" maxlength="20" placeholder="${t('hub_fr_name_placeholder')}" autocomplete="off">
              <button type="button" class="hub-cbtn hub-cbtn-danger" data-role="fr-save">${t('hub_fr_save')}</button>
            </div>
            <div class="hub-fr-or">${t('hub_fr_or')}</div>
            <div class="hub-fr-row">
              <input class="hub-fr-input" data-role="fr-code" type="text" maxlength="5" placeholder="${t('hub_fr_code_placeholder')}"
                     autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:.16em">
              <button type="button" class="hub-cbtn hub-cbtn-ghost" data-role="fr-link">${t('hub_fr_link')}</button>
            </div>
            <p class="hub-fr-msg" data-role="fr-msg" role="status" aria-live="polite"></p>
          </div>
        </div>
      </div>`;

    this.el = {
      top: this.root.querySelector('.hub-top'),
      main: this.root.querySelector('.hub-main'),
      back: this.root.querySelector('[data-role="back"]'),
      title: this.root.querySelector('[data-role="title"]'),
      grid: this.root.querySelector('[data-role="grid"]'),
      extra: this.root.querySelector('.hub-extra'),
      game: this.root.querySelector('[data-role="game"]'),
      confirm: this.root.querySelector('[data-role="confirm"]'),
      profile: this.root.querySelector('[data-role="profile"]'),
      stats: this.root.querySelector('[data-role="stats"]'),
      leaderboard: this.root.querySelector('[data-role="leaderboard"]'),
      lang: this.root.querySelector('[data-role="lang"]'),
      version: this.root.querySelector('[data-role="version"]'),
      topRight: this.root.querySelector('.hub-top-right'),
      keepsake: this.root.querySelector('[data-role="keepsake"]'),
    };

    // The profile pill reads "My Profile" (consistent with My Stats / Leaderboards); the accent
    // highlight still nudges setup when no profile exists yet.
    this.el.profile.textContent = t('hub_profile_btn');
    this.el.profile.classList.toggle('hub-profile-empty', !(prof && prof.name));

    this.el.back.addEventListener('click', this._onBack);
    this.root.querySelectorAll('[data-role="confirm-cancel"]').forEach((el) =>
      el.addEventListener('click', () => { this.el.confirm.hidden = true; }));
    this.root.querySelector('[data-role="confirm-leave"]').addEventListener('click', () => {
      this.el.confirm.hidden = true;
      this.showLauncher();
    });
    // Delegate from .hub-main so it catches the grid cards.
    this.el.grid.parentElement.addEventListener('click', (e) => {
      // .hub-fav is a SIBLING of .hub-card, not nested inside it (a button can't nest inside
      // a button/link), so this needs no stopPropagation - it just has to run first.
      const fav = e.target.closest('.hub-fav');
      if (fav) {
        toggleFavorite(fav.dataset.favId);
        this.render();   // full re-render: ordering logic stays in exactly one place
        return;
      }
      const card = e.target.closest('.hub-card');
      if (!card) return;
      if (card.tagName === 'A') return;            // launch-out: real link, native nav
      if (card.dataset.comingSoon === 'true') return;
      this.launch(card.dataset.id);                // in-hub module: mount in place
    });

    if (this.el.keepsake) this.el.keepsake.addEventListener('click', () => this.openKeepsake());

    this.el.stats.addEventListener('click', () => {
      import('./game-stats-ui.js').then((m) => m.openStatsOverlay()).catch(() => {});
    });

    this.el.leaderboard.addEventListener('click', () => {
      import('./leaderboard-ui.js').then((m) => m.openLeaderboard()).catch(() => {});
    });

    this.el.version.addEventListener('click', () => this._forceUpdate());

    // Language toggle, between the title and the version pill: shows ONLY the CURRENT language
    // (Matt's design — a flag-knob pill, En/blue/US or Es/yellow/Spain); tapping switches to the
    // other one. Persists in gamehub.lang.v1 and dispatches gamehub:lang (js/i18n.js); the
    // launcher re-renders, and games pick the change up at their next render (the documented
    // convention, see js/CLAUDE.md "Language support").
    if (this.el.lang) {
      this._paintLangToggle();
      this.el.lang.addEventListener('click', () => {
        setLang(getLang() === 'en' ? 'es' : 'en');
        this.render();
      });
    }

    this.initFirstRun(prof);
    this._initVersionPill();
  }

  /** M3b: the sole surviving entry point into the retired challenge — a read-only
   *  keepsake (codes, boarding pass, flight, selfie) for the recipient or Matt. */
  async openKeepsake() {
    try {
      const prof = loadProfile();
      const m = await import('./challenge/keepsake.js');
      m.showKeepsake((prof && prof.name) || '');
    } catch (e) { console.error('Keepsake failed to load', e); }
  }

  // --- version pill: shows the running build; tap = update check + reload ----

  /** 'game-hub-v108' -> 'v108' (null passes through). */
  _shortVersion(cache) {
    const m = /game-hub-(v\d+)/.exec(cache || '');
    return m ? m[1] : null;
  }

  /** Ask the ACTIVE service worker which cache version it runs. Null when unknown. */
  _runningVersion() {
    return new Promise((resolve) => {
      try {
        const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!ctrl) { resolve(null); return; }
        const ch = new MessageChannel();
        const t = setTimeout(() => resolve(null), 1500);
        ch.port1.onmessage = (e) => { clearTimeout(t); resolve(this._shortVersion(e.data && e.data.cache)); };
        ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      } catch { resolve(null); }
    });
  }

  /** Read the deployed sw.js from the network and parse its version. Null offline. */
  async _latestVersion() {
    try {
      const res = await fetch('sw.js', { cache: 'no-store' });
      if (!res.ok) return null;
      return this._shortVersion(await res.text());
    } catch { return null; }
  }

  /** Fill the pill: running version, plus "-> vN" styling when a newer build is deployed. */
  async _initVersionPill() {
    try {
      const el = this.el.version;
      if (!el) return;
      const [running, latest] = await Promise.all([this._runningVersion(), this._latestVersion()]);
      const cur = running || latest;
      if (!cur) return;   // no service worker and offline: nothing truthful to show
      el.hidden = false;
      if (running && latest && latest !== running) {
        el.textContent = `${running} → ${latest}`;
        el.classList.add('is-stale');
        el.setAttribute('aria-label', t('hub_version_update_aria', { latest }));
      } else {
        el.textContent = cur;
        el.setAttribute('aria-label', t('hub_version_current_aria', { cur }));
      }
    } catch { /* never break the hub */ }
  }

  /** Refresh the service worker registration, then hard-reload the page. */
  async _forceUpdate() {
    const el = this.el.version;
    try {
      el.disabled = true;
      el.textContent = '…';
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();   // fetches the new sw.js; skipWaiting activates it
    } catch { /* still reload: network-first serves fresh files regardless */ }
    location.reload();
  }

  /** A device with no profile name is invisible on the leaderboard, so gate it once: pick a name, or
   *  link an existing player code. Nothing is lost either way - games already recorded on this device
   *  join that player the moment the name or code lands. Also catches devices that played unnamed. */
  initFirstRun(prof) {
    const box = this.root.querySelector('[data-role="firstrun"]');
    if (!box) return;
    if (prof && (prof.name || '').trim()) { box.hidden = true; return; }
    const nameIn = box.querySelector('[data-role="fr-name"]');
    const codeIn = box.querySelector('[data-role="fr-code"]');
    const msgEl = box.querySelector('[data-role="fr-msg"]');
    const say = (t) => { msgEl.textContent = t || ''; };
    box.hidden = false;
    setTimeout(() => { try { nameIn.focus(); } catch { /* ignore */ } }, 60);

    const finish = () => { box.hidden = true; this.render(); this._syncStats(); };

    // Language choice, part of first-run per the i18n plan: takes effect IMMEDIATELY (so the
    // rest of first run — and everything after — is already in the chosen language), persists in
    // gamehub.lang.v1, and needs no Save. Each button is self-labeled in its own language, so
    // this row never needs translating.
    const langBtns = Array.from(box.querySelectorAll('[data-role="fr-lang"]'));
    const paintLang = () => langBtns.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
    paintLang();
    langBtns.forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); paintLang(); }));

    box.querySelector('[data-role="fr-save"]').addEventListener('click', async () => {
      const name = (nameIn.value || '').trim();
      if (!name) { say(t('hub_fr_msg_enter_name')); return; }
      const cur = loadProfile() || {};
      // Which code this device should record under (see game-stats.js's "WHOSE stats these are"):
      //   - the profile's own code, if it still has one;
      //   - else the code that already OWNS this device's stats, but ONLY when the name typed
      //     matches that owner's name. That is the same person setting themselves up again after
      //     losing their profile, and minting a fresh code would fork them away from their own
      //     history for no reason;
      //   - else a brand-new code. A different name is a different person, and giving them their
      //     own code is exactly what stops two people on one phone blending into one record.
      const owner = statsOwner();
      const sameAsOwner = !!(owner && (owner.name || '').trim().toLowerCase() === name.toLowerCase());
      const code = cur.playerId || (sameAsOwner ? owner.code : null) || newPlayerCode();
      say(t('hub_fr_msg_checking'));
      let status = 'offline';
      try { status = await usernameStatus(name, code); } catch { status = 'offline'; }
      if (status === 'taken') { say(t('hub_fr_msg_taken')); return; }
      saveProfile(Object.assign({}, cur, { name, playerId: code }));
      // The real previous name, not '' - the hardcoded empty string here is what left "natalia"
      // reserved against Ana's code when the shared device was renamed through this gate, so the
      // registry said the name was taken by someone who no longer used it and Natalia could never
      // claim her own name (CLAUDE.md, "The Ana/Natalia correction"). claimUsername only releases a
      // previous name it can prove this code owned, so passing it is safe even when it is stale.
      try { claimUsername(name, code, cur.name || ''); } catch { /* best-effort */ }
      finish();
    });

    box.querySelector('[data-role="fr-link"]').addEventListener('click', async () => {
      const code = canonicalizeCode(codeIn.value);
      if (!code) { say(t('hub_fr_msg_invalid_code')); return; }
      say(t('hub_fr_msg_linking'));
      const cur = loadProfile() || {};
      // Adopt the player's existing name/emoji so this device joins as THEM. Without this the blank
      // name normalizes to 'You' and, being the newest device, would rename the whole player.
      let owner = null;
      try { owner = await lookupCodeOwner(code); } catch { owner = null; }
      const next = Object.assign({}, cur, { playerId: code });
      if (owner && owner.name) { next.name = owner.name; if (owner.emoji) next.emoji = owner.emoji; }
      saveProfile(next);
      finish();
    });
  }

  /** The language toggle's face: ONE state at a time (the active language), Matt's flag-knob
   *  design (2026-07-23) rendered as inline SVG — no image asset, crisp at any DPI, precached
   *  for free inside hub.js. En = navy pill, US-flag knob left, "En" right; Es = golden pill,
   *  "Es" left, Spain-flag knob right. The aria-label names the ACTION in the language the
   *  switch leads to — the person who needs Spanish must be able to read the control. */
  _paintLangToggle() {
    if (!this.el.lang) return;
    const en = getLang() === 'en';
    this.el.lang.setAttribute('aria-label', en ? 'Cambiar a español' : 'Switch to English');
    this.el.lang.innerHTML = en
      ? `<svg viewBox="0 0 64 30" aria-hidden="true">
          <rect width="64" height="30" rx="15" fill="#23408e"/>
          <clipPath id="hub-lt-us"><circle cx="15" cy="15" r="12"/></clipPath>
          <g clip-path="url(#hub-lt-us)">
            <rect x="3" y="3" width="24" height="24" fill="#ffffff"/>
            <g fill="#bf1f30">
              <rect x="3" y="3" width="24" height="1.85"/><rect x="3" y="6.69" width="24" height="1.85"/>
              <rect x="3" y="10.38" width="24" height="1.85"/><rect x="3" y="14.08" width="24" height="1.85"/>
              <rect x="3" y="17.77" width="24" height="1.85"/><rect x="3" y="21.46" width="24" height="1.85"/>
              <rect x="3" y="25.15" width="24" height="1.85"/>
            </g>
            <rect x="3" y="3" width="10.6" height="9.95" fill="#26418f"/>
            <g fill="#ffffff">
              <circle cx="5.6" cy="5.4" r="0.7"/><circle cx="8.4" cy="5.4" r="0.7"/><circle cx="11.2" cy="5.4" r="0.7"/>
              <circle cx="7" cy="7.9" r="0.7"/><circle cx="9.8" cy="7.9" r="0.7"/>
              <circle cx="5.6" cy="10.4" r="0.7"/><circle cx="8.4" cy="10.4" r="0.7"/><circle cx="11.2" cy="10.4" r="0.7"/>
            </g>
          </g>
          <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
          <text x="43" y="20.5" fill="#e9edf7" font-family="system-ui, sans-serif" font-weight="800" font-size="15" text-anchor="middle">En</text>
        </svg>`
      : `<svg viewBox="0 0 64 30" aria-hidden="true">
          <rect width="64" height="30" rx="15" fill="#f2c500"/>
          <text x="21" y="20.5" fill="#6f5d10" font-family="system-ui, sans-serif" font-weight="800" font-size="15" text-anchor="middle">Es</text>
          <clipPath id="hub-lt-es"><circle cx="49" cy="15" r="12"/></clipPath>
          <g clip-path="url(#hub-lt-es)">
            <rect x="37" y="3" width="24" height="6" fill="#c60b1e"/>
            <rect x="37" y="9" width="24" height="12" fill="#ffc400"/>
            <rect x="37" y="21" width="24" height="6" fill="#c60b1e"/>
            <rect x="42.5" y="11.4" width="3.6" height="7.2" rx="1" fill="#c60b1e"/>
            <rect x="43.6" y="13" width="1.4" height="2.4" fill="#ffc400"/>
          </g>
          <circle cx="49" cy="15" r="12" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
        </svg>`;
  }

  cardHTML(g) {
    // Landscape tile: full-bleed art with the title outlined directly over it (no scrim).
    // The blurb moves to the accessible label (it is no longer shown on the tile face).
    const inner = `
        <span class="hub-card-art">${g.art}</span>
        <span class="hub-card-label">${titleText(g)}</span>
        ${g.comingSoon ? `<span class="hub-soon-tag">${t('hub_soon_tag')}</span>`
          : g.devOnly ? `<span class="hub-soon-tag">${t('hub_test_tag')}</span>` : ''}`;
    const blurb = blurbText(g.blurb);
    const aria = blurb ? `${titleText(g)}. ${blurb}` : titleText(g);
    // Launch-out games are real links (new-tab / middle-click / a11y); in-hub
    // modules are buttons that mount into the content area.
    const card = g.href
      ? `<a class="hub-card" href="${g.href}" style="--card-accent:${g.accent}" aria-label="${aria}">${inner}</a>`
      : `<button type="button" class="hub-card${g.comingSoon ? ' is-soon' : ''}"
              data-id="${g.id}" data-coming-soon="${!!g.comingSoon}"
              style="--card-accent:${g.accent}" aria-label="${aria}" ${g.comingSoon ? 'aria-disabled="true"' : ''}>${inner}</button>`;
    // A <button> can't nest inside a <button> or <a>, so the heart is a SIBLING inside a
    // positioned .hub-cell wrapper, not a child of .hub-card - see .hub-cell/.hub-fav in hub.css.
    const favored = this._favIds.has(g.id);
    const favLabel = t(favored ? 'hub_fav_remove' : 'hub_fav_add', { title: titleText(g) });
    const fav = `<button type="button" class="hub-fav${favored ? ' is-fav' : ''}" data-fav-id="${g.id}"
              aria-pressed="${favored}" aria-label="${favLabel}">${favored ? '♥' : '♡'}</button>`;
    return `<div class="hub-cell">${card}${fav}</div>`;
  }

  async launch(id) {
    const game = this.games.find((g) => g.id === id);
    if (!game || game.comingSoon) return;

    // Tear down any previously mounted game first.
    await this.unmount();

    try {
      const module = await import(game.module);
      module.init(this.el.game);
      this.current = { module, id };
      this.el.title.textContent = titleText(game);
      this.el.back.hidden = false;
      this.el.grid.hidden = true;
      if (this.el.extra) this.el.extra.hidden = true;
      this.el.game.hidden = false;
      this.el.profile.hidden = true;
      if (this.el.topRight) this.el.topRight.hidden = true;
      if (this.el.top) this.el.top.classList.add('hub-top-ingame');
      this._setImmersive(!!game.immersive);
    } catch (e) {
      console.error(`Failed to load game "${id}"`, e);
      this.el.game.innerHTML = `<p class="hub-error">${t('hub_load_error', { title: titleText(game) })}</p>`;
      this.el.game.hidden = false;
      this.el.grid.hidden = true;
      if (this.el.extra) this.el.extra.hidden = true;
      this.el.back.hidden = false;
      this.el.profile.hidden = true;
      if (this.el.topRight) this.el.topRight.hidden = true;
      if (this.el.top) this.el.top.classList.add('hub-top-ingame');
      this._setImmersive(!!game.immersive);
    }
  }

  /** Toggle the floating-back-button chrome for immersive games (see hub.css). */
  _setImmersive(on) {
    if (this.el.top) this.el.top.classList.toggle('hub-top-immersive', on);
    if (this.el.main) this.el.main.classList.toggle('hub-main-immersive', on);
  }

  /** Back-to-hub intent: confirm first if the game reports it's mid-play. */
  requestLeave() {
    const m = this.current && this.current.module;
    let inProgress = false;
    try { inProgress = !!(m && typeof m.isInProgress === 'function' && m.isInProgress()); } catch { /* ignore */ }
    if (inProgress) { this.el.confirm.hidden = false; return; }
    this.showLauncher();
  }

  async unmount() {
    if (this.current && typeof this.current.module.destroy === 'function') {
      try { this.current.module.destroy(); } catch (e) { console.warn('destroy() failed', e); }
    }
    this.current = null;
    this.el.game.innerHTML = '';
  }

  async showLauncher() {
    await this.unmount();
    this.el.game.hidden = true;
    this.el.grid.hidden = false;
    if (this.el.extra) this.el.extra.hidden = false;
    this.el.back.hidden = true;
    this.el.title.textContent = "Matt's Game Hub";
    this._setImmersive(false);
    if (this.el.top) this.el.top.classList.remove('hub-top-ingame');
    this.el.profile.hidden = false;
    if (this.el.topRight) this.el.topRight.hidden = false;
    this._syncStats();   // a game may have just updated the stats
  }

  destroy() {
    this.unmount();
    this.el.back.removeEventListener('click', this._onBack);
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    if (this._onOnline) window.removeEventListener('online', this._onOnline);
    this.root.innerHTML = '';
  }
}

let hubInstance = null;

/** Mount the hub shell into `root`. */
export function initHub(root) {
  if (hubInstance) hubInstance.destroy();
  hubInstance = new Hub(root);
  return hubInstance;
}

export default { initHub };
