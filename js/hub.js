// hub.js — Game Hub shell: a launcher grid that mounts self-contained game
// modules into a single content area (no full page reload), using each
// module's standard contract:
//   init(container)  — mount the game
//   destroy()        — tear it down when the user goes back to the hub
//
// Adding a game = drop its folder under the hub and add an entry to GAMES.

import { loadProfile } from './profile-store.js';
import { isChallengeActive, isAdmin, isDevProfile } from './challenge/hooks.js';
import { syncMyStats } from './stats-net.js';
// The first-run "choose a name" gate lives in name-gate.js now (2026-07-31) so the hub and every
// standalone game page run the same one; the profile/code/username plumbing it used to do inline
// here moved with it.
import { requireName, hasName } from './name-gate.js';
import { getLang, setLang, makeT } from './i18n.js';
import { getTheme, setTheme, resolvedTheme, onThemeChange } from './theme.js';
import { loadFavorites, toggleFavorite, moveFavorite } from './favorites.js';
import { GAME_ART } from './game-art.js';
import { isNewGame } from './new-badge.js';
import { installErrorLog } from './error-log.js';
import { pendingAnnouncement } from './announce.js';
import { isGameLive, refreshAdminConfig, onAdminConfig } from './admin-config.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);

// Record uncaught errors from load, not from the Hub constructor: the most interesting throws
// happen while a game module is loading or mounting. Idempotent; see js/error-log.js.
installErrorLog();
/** Resolve a hub card blurb: {en,es} objects (in-scope games) or a plain string
 *  (Monopoly Deal, Parchís — deliberately untranslated, see HANDOFF-I18N-EXTRACTION.md). */
const blurbText = (b) => (b && typeof b === 'object') ? (b[getLang()] || b.en) : b;
/** Resolve a game title the same way (Matt, 2026-07-23: titles DO translate — Spain Spanish —
 *  reversing the i18n handoff's original titles-stay decision). Proper/brand names stay plain
 *  strings. The same six Spanish names live in js/strings.js's game_title_* keys (leaderboard +
 *  stats tabs) and in each game's own strings.js title — keep all three in step. */
const titleText = (g) => (g.title && typeof g.title === 'object') ? (g.title[getLang()] || g.title.en) : g.title;

// `released: 'YYYY-MM-DD'` is the day the game went live, and the ONLY input to the launcher's
// New pill (js/new-badge.js: the tile wears it for NEW_DAYS days, then stops on its own — no
// follow-up commit, no stored state, nothing to clean up later). **Set it on every new entry**;
// an entry without one never shows the pill, which is the safe default.
//
// Only Dominoes and Hill Climb carry one today, deliberately: every other game was already live
// and being played when the badge shipped (2026-08-02), so backfilling them would announce games
// the family has had for weeks and drown out the two that are actually new. Git's first-commit date
// per folder is NOT a release date — most of this repo's early history lands on one import day
// (2026-07-25) and several games' folders predate their launch. If a pre-existing game ever
// wants the pill (a big relaunch, say), give it a real date by hand.
export const GAMES = [
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
    id: 'dominoes',
    released: '2026-08-01',
    title: { en: 'Dominoes', es: 'Dominó' },
    blurb: { en: 'All Fives vs. a bot. Score whenever the open ends add up to a five, race to 300.',
      es: 'All Fives contra un bot. Anota cuando los extremos abiertos sumen un múltiplo de cinco, carrera a 300.' },
    module: '../dominoes/js/ui.js',
    accent: '#0E5C77',
    art: GAME_ART["dominoes"],
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
    id: 'pipes',
    title: { en: 'Pipes', es: 'Tuberias' },
    blurb: { en: 'Turn the pipes. Get the water from the inlet to the outlet without a leak.',
      es: 'Gira las tuberias. Lleva el agua de la entrada a la salida sin fugas.' },
    module: '../pipes/js/ui.js',
    accent: '#1f8fd6',
    released: '2026-08-29',
    art: GAME_ART['pipes'],
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
  {
    // ADMIN ONLY AGAIN (Matt's ask, 2026-08-23), exactly like Pinball below. It was released
    // 2026-08-22 and pulled back the next day: work done for POPONGO and HOT SHOT had been
    // landing in the shared engine and changing how THE CLASSIC plays (see skeeball/CLAUDE.md,
    // "work on one machine, change one machine"). `devOnly` keeps the card off the launcher for
    // everyone but Matt and the tester while that settles.
    //
    // Re-releasing is the same four edits, in reverse: drop `devOnly`, add a FRESH `released`
    // date (the only input to the New pill - the old 2026-08-22 date is deliberately gone so the
    // pill announces the real day), put the GAME_META row back in js/leaderboard-ui.js, and take
    // `skeeball` back out of players-agg.test.mjs's OFF_THE_BOARD. Miss the row and every
    // Skeeball win counts as ZERO while My Stats still shows it - that is how Yahtzee shipped.
    // Rebuilt from scratch 2026-08-13 (see skeeball/CLAUDE.md); the stats id and its history
    // predate the rebuild and are untouched.
    id: 'skeeball',
    title: 'Skeeball',
    blurb: { en: 'Roll it up the lane and lob it into the rings. Nine balls, five rings, two corner pockets worth 100.',
      es: 'Lanza la bola por la pista y encéstala en los anillos. Nueve bolas, cinco anillos y dos huecos de 100 en las esquinas.' },
    module: '../skeeball/js/ui.js',
    // Owns the whole viewport (fixed edge-to-edge canvas under a marquee HUD), so the hub's
    // header collapses to the floating back button - same call as Pinball and Hill Climb.
    immersive: true,
    accent: '#54301a',
    art: GAME_ART["skeeball"],
    // Re-released 2026-08-24 (Matt): Classic playable, the other two machines goal-unlocked. A
    // FRESH released date so the launcher's New pill announces the real day; the 2026-08-22 date
    // it briefly carried is gone on purpose.
    released: '2026-08-24',
  },
  {
    id: 'uno',
    title: 'Uno',
    blurb: { en: 'Match color or number, empty your hand first. 2-4 players vs AI.',
      es: 'Combina color o número, sé el primero en quedarte sin cartas. 2-4 jugadores contra la IA.' },
    module: '../uno/js/ui.js',
    accent: '#E0532F',
    art: GAME_ART["uno"],
  },
  {
    id: 'hill-climb',
    released: '2026-08-02',
    title: 'Hill Climb',
    blurb: { en: 'Gas and brake, no steering. Balance over the hills, grab fuel, and see how far you get.',
      es: 'Gas y freno, sin volante. Mantén el equilibrio en las colinas, coge combustible y llega lo más lejos posible.' },
    module: '../hill-climb/js/ui.js',
    // Its own full-bleed chrome (a fixed, edge-to-edge canvas plus a pedal HUD), so the hub's
    // header collapses to the floating back button — same as Ball Run and Pool.
    immersive: true,
    accent: '#d8382b',
    art: GAME_ART["hill-climb"],
  },
  {
    id: 'battleship',
    released: '2026-08-04',
    title: { en: 'Battleship', es: 'Hundir la Flota' },
    blurb: { en: 'Place your fleet, then hunt the enemy\'s. Three AI tiers, or play a friend.',
      es: 'Coloca tu flota y luego caza la del rival. Tres niveles de IA, o juega con un amigo.' },
    module: '../battleship/js/ui.js',
    // Its own full-bleed chrome (two boards plus the fleet roster and back affordance), same call
    // as Escoba, Mancala, Ball Run, Yahtzee, Pool and Hill Climb.
    immersive: true,
    accent: '#34506E',
    art: GAME_ART["battleship"],
  },
  {
    id: 'yahtzee',
    title: 'Yahtzee',
    blurb: { en: 'Roll, hold, and fill the card. 13 categories, upper bonus, and the joker rule.',
      es: 'Tira, retén y llena la tarjeta. 13 categorías, bono superior, y la regla del comodín.' },
    module: '../yahtzee/js/ui.js',
    immersive: true,
    accent: '#D53922',
    art: GAME_ART["yahtzee"],
  },
  {
    // The from-scratch rebuild, promoted over the original 2026-08-08 and given its name. The
    // retired build is gone; this one lives in pool/ and records under the 'pool' stats id.
    // RELEASED to everyone 2026-08-10 (Matt: "Make it visible for everyone so others can play"),
    // after the wordless play screen and the reference-palette pass. devOnly is gone, not
    // commented out - a game is either shipped or it is not.
    id: 'pool',
    title: { en: 'Pool', es: 'Billar' },
    blurb: { en: 'Real cue-ball physics: draw, follow, english. 8-ball vs. the computer, a friend, or practice alone.',
      es: 'Física real de la bola blanca: efecto, retroceso, seguimiento. Bola 8 contra la computadora, un amigo, o práctica libre.' },
    module: '../pool/js/ui.js',
    immersive: true,
    // The wood of the rail the tile art now draws. It was #1a5f78, a teal-blue picked for the old
    // pale-blue table; --card-accent is the tile's own backing colour, so it has to move with the
    // art (js/game-art.js's `pool`, repainted the same day).
    accent: '#8C5A3F',
    art: GAME_ART["pool"],
    released: '2026-08-10',
  },
  {
    // ADMIN ONLY for now (Matt's ask): `devOnly` keeps the card off the launcher for everyone but
    // Matt and the tester, exactly like Skeeball above. The matching My Stats tab is gated the same
    // way (js/game-stats-ui.js's TABS), so an unreleased game does not leave a stray empty tab
    // sitting in everyone else's stats. Dropping `devOnly` is the whole of "release it".
    id: 'pinball',
    released: '2026-08-11',
    title: 'Pinball',
    blurb: { en: 'Real flipper physics on a neon space table. Ramps, orbits, timed missions and multiball.',
      es: 'Física real de flippers en una mesa espacial de neón. Rampas, órbitas, misiones con tiempo y multibola.' },
    module: '../pinball/js/ui.js',
    // Its own full-bleed chrome (a fixed edge-to-edge canvas, a dot-matrix display and the flipper
    // touch zones), so the hub's header collapses to the floating back button - same call as Ball
    // Run, Pool and Hill Climb.
    immersive: true,
    accent: '#2a1163',
    art: GAME_ART["pinball"],
    devOnly: true,
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
    // Theme toggle's icon reflects the RESOLVED theme, so it must repaint on a live OS
    // preference change while the stored mode is 'auto' (not only on an explicit tap) -
    // subscribed once here (not per render(), which rebinds the button itself).
    this._themeUnsub = onThemeChange(() => this._paintThemeToggle());
    this._syncStats();
    // A report filed with no signal is kept on the device (js/bug-report.js's outbox) and retried
    // here, on the same three moments stats sync uses: load, reconnect, return to the launcher. A
    // report that only exists on the phone that was having trouble is no report.
    this._drainBugReports();
    this._paintReplyBadge();
    this._onOnlineBugs = () => { this._drainBugReports(); this._paintReplyBadge(); };
    window.addEventListener('online', this._onOnlineBugs);
    this._maybeAnnounce();
    // The app-wide admin config (which games are live, which Skeeball machines are open). The
    // launcher has ALREADY painted from the cached copy - this refresh only re-renders when the
    // fetched value actually differs, so the common case costs one background read and no repaint.
    this._adminUnsub = onAdminConfig(() => { if (!this.current) this.render(); });
    refreshAdminConfig();
  }

  /** Send anything in this device's bug-report outbox. Lazy import: only worth loading at all on
   *  a device that has something queued. */
  async _drainBugReports() {
    try {
      const m = await import('./bug-report.js');
      if (m.pendingCount() > 0) await m.drainPendingReports();
    } catch (err) { console.warn('[hub] could not retry queued bug reports', err); }
  }

  /** The one-time launcher announcement, if this device still owes one. Once per page load, never
   *  over the name gate (a nameless device is mid-setup), never over a mounted game. */
  async _maybeAnnounce() {
    if (this._announced || this.current || !hasName()) return;
    const a = pendingAnnouncement();
    if (!a) return;
    // `adminOnly` entries are Matt-only previews. Returning BEFORE showAnnouncement matters: it is
    // showAnnouncement that marks an entry seen, so a gated announcement leaves every other device
    // untouched and lands fresh for everyone the day the flag comes off.
    if (a.adminOnly) {
      const prof = loadProfile();
      if (!(prof && isAdmin(prof.name))) return;
    }
    this._announced = true;
    // Warm the report modules while the popup is being read. Someone shown "Please report bugs!"
    // is about to tap Try it, and that button pulls a whole import chain (bug-report-ui ->
    // bug-report -> device-report -> stats-net/firebase-boot) which on a weak connection is
    // seconds of nothing happening. Fire-and-forget: it either arrives before the tap or the tap
    // waits exactly as long as it used to.
    import('./bug-report-ui.js').catch(() => { /* the button still works, just cold */ });
    try {
      const { showAnnouncement } = await import('./announce-ui.js');
      await showAnnouncement(a, {
        onAction: (action) => { if (action === 'bug-report') this.openBugReport(); },
      });
    } catch (err) { console.warn('[hub] announcement could not be shown', err); }
  }

  /** The player's bug-report form, preloaded with whichever game they were last in. */
  async openBugReport() {
    try {
      const m = await import('./bug-report-ui.js');
      const game = this.games && this.games.find((g) => g.id === this._lastGameId);
      await m.openBugReport({ gameId: this._lastGameId || null, gameTitle: game ? titleText(game) : null });
    } catch (err) { console.error('[hub] bug report form failed to load', err); }
  }

  /** Matt's inbox, plus the unread count on its own button. Rendered for nobody else. */
  async openBugInbox() {
    try {
      const m = await import('./bug-report-ui.js');
      await m.openBugInbox();
      this._paintInboxCount();
    } catch (err) { console.error('[hub] bug inbox failed to load', err); }
  }

  /** The admin control page (js/admin-ui.js). Rendered for nobody else, and imported lazily so no
   *  other device ever downloads it. */
  async openAdmin() {
    try {
      const m = await import('./admin-ui.js');
      await m.openAdmin();
    } catch (err) { console.error('[hub] admin controls failed to load', err); }
  }

  async _paintInboxCount() {
    const el = this.el && this.el.bugInbox;
    if (!el) return;
    try {
      const m = await import('./bug-report-ui.js');
      const n = await m.adminUnreadCount();
      el.textContent = n > 0 ? t('bug_inbox_btn_new', { n }) : t('bug_inbox_btn');
      el.classList.toggle('has-new', n > 0);
    } catch { /* offline: the plain label is already correct */ }
  }

  /** A badge on the profile pill when Matt has answered one of this player's bug reports. The pill
   *  is the only route to them, so it has to advertise itself - a reply nobody notices is the same
   *  as never having replied. Silent on failure: no badge is the honest state when we cannot look. */
  async _paintReplyBadge() {
    const el = this.el && this.el.profile;
    if (!el) return;
    try {
      const m = await import('./bug-report-ui.js');
      const n = await m.myUnreadReplies();
      el.classList.toggle('hub-profile-mail', n > 0);
      if (n > 0) el.dataset.mail = String(n); else delete el.dataset.mail;
    } catch { /* offline, or Firebase unconfigured: leave the pill plain */ }
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
    // Games are listed FAVORITES FIRST, in the player's own CUSTOM ORDER (batch 4,
    // 2026-07-23 - the stored `ids` array IS the display order now), then the "All games"
    // group ALPHABETICALLY by display title (project rule, now scoped to non-favorites only).
    // Sorting the rest at render time keeps it self-maintaining: a new GAMES entry lands in
    // the right place no matter where it is added to the array. localeCompare so accents
    // (Chinchón, Parchís) sort correctly. An id in storage that doesn't match a visible game
    // (retired/not-yet-unlocked) is simply never matched here - it stays in storage untouched
    // and starts showing again the moment the game reappears.
    // A game is live when the REMOTE ADMIN CONFIG says so, falling back to the registry's own
    // `devOnly` when Matt has set no override (js/admin-config.js). That is what lets "make this
    // admin-only for testing" and "make it live" happen from inside the app instead of from a
    // commit; the registry stays the default, and a device that has never reached the config (new,
    // offline) behaves exactly as it did before this existed. Dev profiles still see everything.
    const visible = GAMES.filter((g) => isGameLive(g.id, !g.devOnly) || dev);
    const storedFavIds = loadFavorites();
    const favIdSet = new Set(storedFavIds);
    const byTitle = (a, b) => titleText(a).localeCompare(titleText(b));
    const favGames = storedFavIds.map((id) => visible.find((g) => g.id === id)).filter(Boolean);
    const restGames = visible.filter((g) => !favIdSet.has(g.id)).sort(byTitle);
    this.games = [...favGames, ...restGames];
    this._favIds = favIdSet;
    this._favOrder = favGames.map((g) => g.id);
    // The reorder ghost button needs 2+ favorites to mean anything; if a reorder/removal
    // drops it below 2, fall out of edit mode gracefully rather than leaving a dangling toggle.
    if (favGames.length < 2) this._favEdit = false;
    // The divider only earns its place between two non-empty groups; with zero favorites
    // (the common first-run case) or with every visible game favorited, the grid is a plain
    // single list (custom-ordered) and no divider renders.
    const showDivider = favGames.length > 0 && restGames.length > 0;
    const showReorder = favGames.length >= 2;
    const favHeaderHTML = showReorder
      ? `<div class="hub-fav-header"><button type="button" class="hub-fav-reorder" data-role="fav-reorder">${t(this._favEdit ? 'hub_fav_done' : 'hub_fav_reorder')}</button></div>`
      : '';
    const gridHTML = favHeaderHTML
      + favGames.map((g) => this.cardHTML(g, true)).join('')
      + (showDivider ? `<div class="hub-divider">${t('hub_all_games')}</div>` : '')
      + restGames.map((g) => this.cardHTML(g, false)).join('');
    this.root.innerHTML = `
      <div class="hub">
        <header class="hub-top">
          <div class="hub-top-info">
            <button type="button" class="hub-back" data-role="back" hidden aria-label="${t('hub_back_aria')}">‹ Hub</button>
            <h1 class="hub-top-title" data-role="title">Matt's Game Hub</h1>
            <button type="button" class="hub-langtoggle" data-role="lang"></button>
            <button type="button" class="hub-themetoggle" data-role="theme"></button>
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
          <section class="hub-extra">
            <button type="button" class="hub-statsbtn hub-bug-btn" data-role="bug" aria-label="${t('bug_btn_aria')}">${t('bug_btn')}</button>
            ${admin ? `<button type="button" class="hub-statsbtn hub-bug-inbox" data-role="buginbox">${t('bug_inbox_btn')}</button>` : ''}
            ${admin ? `<button type="button" class="hub-statsbtn hub-admin-btn" data-role="admin">${t('adm_btn')}</button>` : ''}
            ${showKeepsake ? `<button type="button" class="hub-statsbtn hub-keepsake-btn" data-role="keepsake">${t('hub_challenge_btn')}</button>` : ''}
          </section>
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
      theme: this.root.querySelector('[data-role="theme"]'),
      version: this.root.querySelector('[data-role="version"]'),
      topRight: this.root.querySelector('.hub-top-right'),
      keepsake: this.root.querySelector('[data-role="keepsake"]'),
      bug: this.root.querySelector('[data-role="bug"]'),
      bugInbox: this.root.querySelector('[data-role="buginbox"]'),
      admin: this.root.querySelector('[data-role="admin"]'),
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
      const reorderBtn = e.target.closest('[data-role="fav-reorder"]');
      if (reorderBtn) {
        this._favEdit = !this._favEdit;
        this.render();
        return;
      }
      const move = e.target.closest('.hub-fav-move');
      if (move) {
        moveFavorite(move.dataset.favId, move.dataset.dir === 'up' ? -1 : 1);
        this.render();
        return;
      }
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
      // Edit mode replaces the favorite heart with move arrows and must not let a mis-tap
      // launch (or navigate away to) the game underneath - card.dataset.favGroup marks every
      // tile in the favorites group, button or <a> alike.
      if (this._favEdit && card.dataset.favGroup === 'true') {
        if (card.tagName === 'A') e.preventDefault();
        return;
      }
      if (card.tagName === 'A') return;            // launch-out: real link, native nav
      if (card.dataset.comingSoon === 'true') return;
      this.launch(card.dataset.id);                // in-hub module: mount in place
    });

    if (this.el.keepsake) this.el.keepsake.addEventListener('click', () => this.openKeepsake());
    if (this.el.bug) this.el.bug.addEventListener('click', () => this.openBugReport());
    if (this.el.admin) this.el.admin.addEventListener('click', () => this.openAdmin());
    if (this.el.bugInbox) {
      this.el.bugInbox.addEventListener('click', () => this.openBugInbox());
      this._paintInboxCount();
    }

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

    // Theme toggle, next to the language knob: cycles light -> dark -> auto -> light.
    // Icon shows the RESOLVED theme (sun/moon); a small "A" badge marks auto specifically,
    // since auto's icon alone can't distinguish "auto, currently resolving light" from
    // a plain manual "light". Hidden in-game/immersive like the lang toggle and version pill.
    if (this.el.theme) {
      this._paintThemeToggle();
      this.el.theme.addEventListener('click', () => {
        const cur = getTheme();
        setTheme(cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light');
        this._paintThemeToggle();
      });
    }

    this.initFirstRun();
    this._initVersionPill();
  }

  /** The theme toggle's face: sun/moon for the RESOLVED theme, plus an "A" badge when the
   *  stored mode is 'auto' (the icon alone can't tell auto-resolved-light from manual light). */
  _paintThemeToggle() {
    if (!this.el.theme) return;
    const mode = getTheme();
    const dark = resolvedTheme(mode) === 'dark';
    const modeLabel = mode === 'auto' ? t('hub_theme_auto') : dark ? t('hub_theme_dark') : t('hub_theme_light');
    this.el.theme.innerHTML = `<span class="hub-theme-icon" aria-hidden="true">${dark ? '🌙' : '☀️'}</span>`
      + (mode === 'auto' ? `<span class="hub-theme-badge" aria-hidden="true">A</span>` : '');
    this.el.theme.setAttribute('aria-label', t('hub_theme_toggle_aria', { mode: modeLabel }));
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

  /** Tap = check for an update, with feedback on the pill itself. A reload (the only thing that
   *  "re-renders the whole hub root", which QA caught resurfacing the first-run gate for
   *  profile-less devices) only happens when a newer build is actually found - checking while
   *  already current just flashes "Up to date" and reverts, no navigation at all. */
  async _forceUpdate() {
    const el = this.el.version;
    if (!el || el.disabled) return;
    const prevText = el.textContent;
    const prevAria = el.getAttribute('aria-label') || '';
    const prevStale = el.classList.contains('is-stale');
    el.disabled = true;
    el.textContent = t('hub_version_checking');
    el.setAttribute('aria-label', t('hub_version_checking'));
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();   // fetches the new sw.js; skipWaiting activates it
    } catch { /* fall through to a fresh version check regardless */ }
    const [running, latest] = await Promise.all([this._runningVersion(), this._latestVersion()]);
    const cur = running || latest;
    if (!cur) {   // offline / no service worker: nothing truthful learned, restore prior state
      el.textContent = prevText;
      el.setAttribute('aria-label', prevAria);
      el.classList.toggle('is-stale', prevStale);
      el.disabled = false;
      return;
    }
    if (running && latest && latest !== running) {
      el.textContent = `${running} → ${latest}`;
      el.classList.add('is-stale');
      el.setAttribute('aria-label', t('hub_version_update_aria', { latest }));
      location.reload();   // a real update was found - this is the actual update action
      return;
    }
    el.classList.remove('is-stale');
    el.textContent = t('hub_version_up_to_date');
    el.setAttribute('aria-label', t('hub_version_up_to_date'));
    setTimeout(() => {
      el.textContent = cur;
      el.setAttribute('aria-label', t('hub_version_current_aria', { cur }));
      el.disabled = false;
    }, 2000);
  }

  /** A device with no profile name cannot record plays under an identity, so gate it: pick a name,
   *  or link an existing player code. Nothing is lost either way - games already recorded on this
   *  device join that player the moment the name or code lands.
   *
   *  The gate itself moved to js/name-gate.js (2026-07-31) so the standalone game pages, which had
   *  no gate at all and are exactly where the leaderboard's "Unnamed player" rows came from, run the
   *  SAME one. This method is now just the hub's call site; `requireName()` is a no-op when a name
   *  already exists, and idempotent, so calling it from every render() is safe. */
  initFirstRun() {
    if (hasName()) return;
    requireName().then(() => { this.render(); this._syncStats(); this._maybeAnnounce(); });
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

  cardHTML(g, favGroup) {
    // Landscape tile: full-bleed art with the title outlined directly over it (no scrim).
    // The blurb moves to the accessible label (it is no longer shown on the tile face).
    // Tags sit top-left in one flex row (.hub-tags) so a devOnly game that is ALSO inside its
    // New window shows both pills side by side instead of one landing on top of the other.
    const isNew = isNewGame(g);
    const tags = [];
    if (g.comingSoon) tags.push(`<span class="hub-soon-tag">${t('hub_soon_tag')}</span>`);
    // The Test pill follows the RESOLVED state, not the registry line: a game Matt has pulled back
    // from the admin page is in testing whatever js/hub.js says, and one he has released is not.
    else if (!isGameLive(g.id, !g.devOnly)) tags.push(`<span class="hub-soon-tag">${t('hub_test_tag')}</span>`);
    if (isNew) tags.push(`<span class="hub-new-tag">${t('hub_new_tag')}</span>`);
    const inner = `
        <span class="hub-card-art">${g.art}</span>
        <span class="hub-card-label">${titleText(g)}</span>
        ${tags.length ? `<span class="hub-tags" aria-hidden="true">${tags.join('')}</span>` : ''}`;
    const blurb = blurbText(g.blurb);
    // aria-label replaces the tile's contents for a screen reader, so the New pill has to be
    // said HERE or it isn't said at all - hence aria-hidden on the visual pill above.
    const aria = [isNew ? t('hub_new_aria') : '', titleText(g), blurb].filter(Boolean).join('. ');
    // Launch-out games are real links (new-tab / middle-click / a11y); in-hub
    // modules are buttons that mount into the content area. data-fav-group marks every tile
    // in the favorites group so the click delegate can suppress navigation during edit mode.
    const card = g.href
      ? `<a class="hub-card" href="${g.href}" data-fav-group="${!!favGroup}" style="--card-accent:${g.accent}" aria-label="${aria}">${inner}</a>`
      : `<button type="button" class="hub-card${g.comingSoon ? ' is-soon' : ''}"
              data-id="${g.id}" data-coming-soon="${!!g.comingSoon}" data-fav-group="${!!favGroup}"
              style="--card-accent:${g.accent}" aria-label="${aria}" ${g.comingSoon ? 'aria-disabled="true"' : ''}>${inner}</button>`;
    // A <button> can't nest inside a <button> or <a>, so the heart (or, in favorites edit
    // mode, the move arrows) is a SIBLING inside a positioned .hub-cell wrapper, not a child
    // of .hub-card - see .hub-cell/.hub-fav in hub.css.
    const favored = this._favIds.has(g.id);
    let overlay;
    if (favGroup && this._favEdit) {
      const idx = this._favOrder.indexOf(g.id);
      const upLabel = t('hub_fav_move_up', { title: titleText(g) });
      const downLabel = t('hub_fav_move_down', { title: titleText(g) });
      overlay = `
        <button type="button" class="hub-fav-move hub-fav-up" data-fav-id="${g.id}" data-dir="up"
                  ${idx <= 0 ? 'disabled' : ''} aria-label="${upLabel}">↑</button>
        <button type="button" class="hub-fav-move hub-fav-down" data-fav-id="${g.id}" data-dir="down"
                  ${idx >= this._favOrder.length - 1 ? 'disabled' : ''} aria-label="${downLabel}">↓</button>`;
    } else {
      const favLabel = t(favored ? 'hub_fav_remove' : 'hub_fav_add', { title: titleText(g) });
      overlay = `<button type="button" class="hub-fav${favored ? ' is-fav' : ''}" data-fav-id="${g.id}"
              aria-pressed="${favored}" aria-label="${favLabel}">${favored ? '♥' : '♡'}</button>`;
    }
    return `<div class="hub-cell">${card}${overlay}</div>`;
  }

  async launch(id) {
    const game = this.games.find((g) => g.id === id);
    if (!game || game.comingSoon) return;
    // Remembered for the report form's "Where did it happen?" picker, opened from the launcher
    // AFTER the player comes back out of the game they had trouble with. Set before the import so
    // a game that fails to LOAD is still the one preselected.
    this._lastGameId = id;

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
    this._drainBugReports();   // and the connection may have come back while they played
  }

  destroy() {
    this.unmount();
    this.el.back.removeEventListener('click', this._onBack);
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    if (this._onOnline) window.removeEventListener('online', this._onOnline);
    if (this._onOnlineBugs) window.removeEventListener('online', this._onOnlineBugs);
    if (this._themeUnsub) this._themeUnsub();
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
