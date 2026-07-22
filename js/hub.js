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

const GAMES = [
  {
    id: 'connect-four',
    title: 'Connect Four',
    blurb: 'Drop discs, connect four. Four AI levels incl. a perfect endgame solver.',
    // Relative to this module (js/hub.js): up to root, then into the game folder.
    module: '../connect-four/js/ui.js',
    accent: '#1769d4',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#1769d4"/>
            <circle cx="21" cy="24" r="11" fill="#dbe8f8"/><circle cx="47" cy="24" r="11" fill="#dbe8f8"/>
            <circle cx="73" cy="24" r="11" fill="#dbe8f8"/><circle cx="99" cy="24" r="11" fill="#dbe8f8"/>
            <circle cx="21" cy="50" r="11" fill="#dbe8f8"/><circle cx="47" cy="50" r="11" fill="#dbe8f8"/>
            <circle cx="73" cy="50" r="11" fill="#ffce3a"/><circle cx="99" cy="50" r="11" fill="#dbe8f8"/>
            <circle cx="21" cy="76" r="11" fill="#dbe8f8"/><circle cx="47" cy="76" r="11" fill="#ffce3a"/>
            <circle cx="73" cy="76" r="11" fill="#e8463f"/><circle cx="99" cy="76" r="11" fill="#dbe8f8"/>
            <circle cx="21" cy="102" r="11" fill="#e8463f"/><circle cx="47" cy="102" r="11" fill="#ffce3a"/>
            <circle cx="73" cy="102" r="11" fill="#e8463f"/><circle cx="99" cy="102" r="11" fill="#ffce3a"/>
          </svg>`,
  },
  {
    id: 'chinchon',
    title: 'Chinchón',
    blurb: 'Spanish rummy vs. smart AI. Melds, cuts & chinchón. 2–4 players.',
    module: '../chinchon/js/ui.js',
    accent: '#d4a017',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#1f7a52"/>
            <g transform="rotate(-16 60 66)">
              <rect x="30" y="30" width="42" height="60" rx="6" fill="#f7edd4" stroke="#c9b485" stroke-width="1.5"/>
              <polygon points="46,54 58,54 55,63 49,63" fill="#c0392b"/>
              <rect x="52.5" y="63" width="3" height="6" fill="#c0392b"/>
              <rect x="48" y="69" width="12" height="3" rx="1.5" fill="#c0392b"/>
            </g>
            <g transform="rotate(13 60 66)">
              <rect x="50" y="28" width="42" height="60" rx="6" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.5"/>
              <circle cx="71" cy="58" r="13" fill="#e8b53a" stroke="#a9791b" stroke-width="2"/>
              <circle cx="71" cy="58" r="8.5" fill="none" stroke="#a9791b" stroke-width="1.3"/>
              <circle cx="71" cy="58" r="2.6" fill="#a9791b"/>
            </g>
          </svg>`,
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
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#6a4cff"/>
            <g transform="rotate(-15 60 66)"><rect x="25" y="34" width="32" height="48" rx="4" fill="#fff"/><rect x="25" y="34" width="32" height="12" rx="4" fill="#e0532f"/></g>
            <g transform="rotate(0 60 66)"><rect x="44" y="29" width="32" height="50" rx="4" fill="#fff"/><rect x="44" y="29" width="32" height="12" rx="4" fill="#178a7a"/></g>
            <g transform="rotate(15 60 66)"><rect x="63" y="34" width="32" height="48" rx="4" fill="#fff"/><rect x="63" y="34" width="32" height="12" rx="4" fill="#1f5fa8"/></g>
            <circle cx="84" cy="82" r="15" fill="#f2b705" stroke="#a9791b" stroke-width="2"/>
            <text x="84" y="88.5" font-size="19" font-weight="900" text-anchor="middle" fill="#7a5502" font-family="system-ui, -apple-system, sans-serif">$</text>
          </svg>`,
  },
  {
    id: 'parchis',
    title: 'Parchís',
    blurb: 'Spanish Parchís vs. smart AI. One die, seguros, barreras & bonos. 2–4 players.',
    // Self-contained single-file game living in this repo; launches out like Monopoly Deal.
    href: 'parchis/',
    accent: '#c0632b',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#7a5a34"/>
            <rect x="5" y="5" width="110" height="110" rx="6" fill="#f5ecd6"/>
            <rect x="47" y="5" width="26" height="110" fill="#ffffff"/>
            <rect x="5" y="47" width="110" height="26" fill="#ffffff"/>
            <rect x="11" y="11" width="33" height="33" rx="5" fill="#f2b705"/>
            <rect x="76" y="11" width="33" height="33" rx="5" fill="#1f5fa8"/>
            <rect x="11" y="76" width="33" height="33" rx="5" fill="#178a7a"/>
            <rect x="76" y="76" width="33" height="33" rx="5" fill="#e0532f"/>
            <g fill="#ffffff" stroke="rgba(0,0,0,0.22)">
              <circle cx="21" cy="21" r="4"/><circle cx="34" cy="21" r="4"/><circle cx="21" cy="34" r="4"/><circle cx="34" cy="34" r="4"/>
              <circle cx="86" cy="21" r="4"/><circle cx="99" cy="21" r="4"/><circle cx="86" cy="34" r="4"/><circle cx="99" cy="34" r="4"/>
              <circle cx="21" cy="86" r="4"/><circle cx="34" cy="86" r="4"/><circle cx="21" cy="99" r="4"/><circle cx="34" cy="99" r="4"/>
              <circle cx="86" cy="86" r="4"/><circle cx="99" cy="86" r="4"/><circle cx="86" cy="99" r="4"/><circle cx="99" cy="99" r="4"/>
            </g>
            <rect x="55" y="6" width="10" height="41" fill="#f2b705"/>
            <rect x="73" y="55" width="41" height="10" fill="#1f5fa8"/>
            <rect x="55" y="73" width="10" height="41" fill="#e0532f"/>
            <rect x="6" y="55" width="41" height="10" fill="#178a7a"/>
            <polygon points="49,49 71,49 60,60" fill="#f2b705"/>
            <polygon points="71,49 71,71 60,60" fill="#1f5fa8"/>
            <polygon points="71,71 49,71 60,60" fill="#e0532f"/>
            <polygon points="49,71 49,49 60,60" fill="#178a7a"/>
          </svg>`,
  },
  {
    id: 'escoba',
    title: 'Escoba',
    blurb: 'Spanish fishing card game. Capture cards that add up to 15. 2-3 players.',
    module: '../escoba/js/ui.js',
    // Escoba's own screens (setup + game mat) already show its title and back
    // affordance; the hub's own header row is pure wasted vertical space for
    // this one. Opt-in only, so every other game's chrome is untouched.
    immersive: true,
    accent: '#1c7a4f',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#175c3b"/>
            <g transform="rotate(-16 42 62)">
              <rect x="22" y="34" width="36" height="55" rx="5" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.5"/>
              <circle cx="40" cy="61" r="9" fill="#e8b53a" stroke="#a9791b" stroke-width="1.8"/>
              <circle cx="40" cy="61" r="5.5" fill="none" stroke="#a9791b" stroke-width="1.1"/>
            </g>
            <g transform="rotate(2 60 60)">
              <rect x="43" y="26" width="36" height="55" rx="5" fill="#ffffff" stroke="#c9b485" stroke-width="1.5"/>
              <circle cx="54" cy="43" r="6.5" fill="#e8b53a" stroke="#a9791b" stroke-width="1.5"/>
              <circle cx="68" cy="64" r="6.5" fill="#e8b53a" stroke="#a9791b" stroke-width="1.5"/>
            </g>
            <g transform="rotate(19 80 60)">
              <rect x="66" y="32" width="36" height="55" rx="5" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.5"/>
              <polygon points="79,49 89,49 86.5,57 81.5,57" fill="#c0392b"/>
              <rect x="82.7" y="57" width="2.6" height="5" fill="#c0392b"/>
              <rect x="79" y="62" width="10" height="2.6" rx="1.3" fill="#c0392b"/>
            </g>
            <circle cx="88" cy="92" r="17" fill="#f2b705" stroke="#a9791b" stroke-width="2"/>
            <text x="88" y="99" font-size="19" font-weight="900" text-anchor="middle" fill="#7a5502" font-family="system-ui, -apple-system, sans-serif">15</text>
            <g transform="rotate(-38 30 96)">
              <rect x="27" y="70" width="5" height="34" rx="2.5" fill="#a9791b"/>
              <path d="M22 104 L37 104 L41 118 L18 118 Z" fill="#e8b53a" stroke="#a9791b" stroke-width="1.5"/>
              <line x1="24" y1="107" x2="23" y2="116" stroke="#a9791b" stroke-width="1.4"/>
              <line x1="29.5" y1="107" x2="29.5" y2="116" stroke="#a9791b" stroke-width="1.4"/>
              <line x1="35" y1="107" x2="36" y2="116" stroke="#a9791b" stroke-width="1.4"/>
            </g>
          </svg>`,
  },
  {
    id: 'filler',
    title: 'Filler',
    blurb: 'Flood-fill duel vs. smart AI. Pick colors, grow your corner, capture the majority.',
    module: '../filler/js/ui.js',
    accent: '#c2557f',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#202a3c"/>
            <g>
              <rect x="7" y="7" width="18" height="18" rx="4" fill="#F2B705"/>
              <rect x="29" y="7" width="18" height="18" rx="4" fill="#E0532F"/>
              <rect x="51" y="7" width="18" height="18" rx="4" fill="#8155BA"/>
              <rect x="73" y="7" width="18" height="18" rx="4" fill="#1F5FA8"/>
              <rect x="95" y="7" width="18" height="18" rx="4" fill="#178A7A"/>
              <rect x="7" y="29" width="18" height="18" rx="4" fill="#178A7A"/>
              <rect x="29" y="29" width="18" height="18" rx="4" fill="#D06E9F"/>
              <rect x="51" y="29" width="18" height="18" rx="4" fill="#F2B705"/>
              <rect x="73" y="29" width="18" height="18" rx="4" fill="#E0532F"/>
              <rect x="95" y="29" width="18" height="18" rx="4" fill="#1F5FA8"/>
              <rect x="7" y="51" width="18" height="18" rx="4" fill="#1F5FA8"/>
              <rect x="29" y="51" width="18" height="18" rx="4" fill="#F2B705"/>
              <rect x="51" y="51" width="18" height="18" rx="4" fill="#178A7A"/>
              <rect x="73" y="51" width="18" height="18" rx="4" fill="#D06E9F"/>
              <rect x="95" y="51" width="18" height="18" rx="4" fill="#8155BA"/>
              <rect x="7" y="73" width="18" height="18" rx="4" fill="#8155BA"/>
              <rect x="29" y="73" width="18" height="18" rx="4" fill="#E0532F"/>
              <rect x="51" y="73" width="18" height="18" rx="4" fill="#1F5FA8"/>
              <rect x="73" y="73" width="18" height="18" rx="4" fill="#F2B705"/>
              <rect x="95" y="73" width="18" height="18" rx="4" fill="#D06E9F"/>
              <rect x="7" y="95" width="18" height="18" rx="4" fill="#F2B705"/>
              <rect x="29" y="95" width="18" height="18" rx="4" fill="#D06E9F"/>
              <rect x="51" y="95" width="18" height="18" rx="4" fill="#178A7A"/>
              <rect x="73" y="95" width="18" height="18" rx="4" fill="#E0532F"/>
              <rect x="95" y="95" width="18" height="18" rx="4" fill="#1F5FA8"/>
            </g>
            <circle cx="16" cy="104" r="5" fill="none" stroke="#ffffff" stroke-width="2.5"/>
            <circle cx="104" cy="16" r="5" fill="none" stroke="#ffffff" stroke-width="2.5"/>
          </svg>`,
  },
  {
    id: 'mancala',
    title: 'Mancala',
    blurb: 'Sow stones, chain extra turns, capture the most. Vs. AI or a friend.',
    module: '../mancala/js/ui.js',
    // The board wants every vertical pixel it can get on a phone, and the game
    // shows its own title/avatars, so the hub's header row is wasted space here.
    immersive: true,
    accent: '#e08a3c',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#b96f35"/>
            <rect x="14" y="6" width="92" height="108" rx="22" fill="#f5b963" stroke="#241609" stroke-width="4"/>
            <rect x="26" y="14" width="68" height="16" rx="8" fill="#ef5544" stroke="#241609" stroke-width="3"/>
            <rect x="26" y="90" width="68" height="16" rx="8" fill="#29a8dd" stroke="#241609" stroke-width="3"/>
            <g stroke="#241609" stroke-width="3">
              <circle cx="43" cy="45" r="10.5" fill="#29a8dd"/><circle cx="77" cy="45" r="10.5" fill="#ef5544"/>
              <circle cx="43" cy="70" r="10.5" fill="#29a8dd"/><circle cx="77" cy="70" r="10.5" fill="#ef5544"/>
            </g>
            <g fill="#faf0d8" stroke="rgba(74,53,24,0.55)" stroke-width="1">
              <circle cx="39.5" cy="42" r="3"/><circle cx="46.5" cy="44" r="3"/><circle cx="42" cy="49" r="3"/>
              <circle cx="74" cy="42.5" r="3"/><circle cx="80" cy="46" r="3"/>
              <circle cx="40" cy="67" r="3"/><circle cx="46" cy="71" r="3"/>
              <circle cx="73.5" cy="67" r="3"/><circle cx="80" cy="69.5" r="3"/><circle cx="76.5" cy="73.5" r="3"/>
              <circle cx="38" cy="96" r="3"/><circle cx="47" cy="99" r="3"/><circle cx="56" cy="96.5" r="3"/>
              <circle cx="65" cy="99.5" r="3"/><circle cx="74" cy="96" r="3"/><circle cx="83" cy="99" r="3"/>
            </g>
          </svg>`,
  },
  {
    id: 'nuts-bolts',
    title: 'Nuts & Bolts',
    blurb: 'Colour-sort puzzle. Stack matching nuts onto bolts.',
    module: '../nuts-bolts/js/ui.js',
    accent: '#607d8b',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#3f4652"/>
            <g fill="#9aa7bd">
              <rect x="26" y="30" width="6" height="70" rx="3"/>
              <rect x="57" y="30" width="6" height="70" rx="3"/>
              <rect x="88" y="30" width="6" height="70" rx="3"/>
            </g>
            <g stroke="rgba(0,0,0,0.25)" stroke-width="1.5">
              <polygon points="16,90 22.5,83.5 35.5,83.5 42,90 35.5,96.5 22.5,96.5" fill="#f2b705"/>
              <polygon points="16,75 22.5,68.5 35.5,68.5 42,75 35.5,81.5 22.5,81.5" fill="#f2b705"/>
              <polygon points="16,60 22.5,53.5 35.5,53.5 42,60 35.5,66.5 22.5,66.5" fill="#1f5fa8"/>
              <polygon points="47,90 53.5,83.5 66.5,83.5 73,90 66.5,96.5 53.5,96.5" fill="#1f5fa8"/>
              <polygon points="47,75 53.5,68.5 66.5,68.5 73,75 66.5,81.5 53.5,81.5" fill="#178a7a"/>
              <polygon points="78,90 84.5,83.5 97.5,83.5 104,90 97.5,96.5 84.5,96.5" fill="#c24420"/>
              <polygon points="78,75 84.5,68.5 97.5,68.5 104,75 97.5,81.5 84.5,81.5" fill="#c24420"/>
              <polygon points="78,60 84.5,53.5 97.5,53.5 104,60 97.5,66.5 84.5,66.5" fill="#c24420"/>
            </g>
            <rect x="12" y="100" width="96" height="8" rx="4" fill="#6b7688"/>
          </svg>`,
  },
  {
    id: 'tic-tac-toe',
    title: 'Tic Tac Toe',
    blurb: 'Classic 3x3, or Ultimate: nine boards in one, where your move picks your opponent\'s board.',
    module: '../tic-tac-toe/js/ui.js',
    accent: '#0e7c86',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#0e7c86"/>
            <g stroke="#d7ece9" stroke-width="5" stroke-linecap="round">
              <line x1="42" y1="14" x2="42" y2="106"/>
              <line x1="78" y1="14" x2="78" y2="106"/>
              <line x1="14" y1="42" x2="106" y2="42"/>
              <line x1="14" y1="78" x2="106" y2="78"/>
            </g>
            <g stroke="#e0532f" stroke-width="7" stroke-linecap="round">
              <line x1="22" y1="22" x2="34" y2="34"/><line x1="34" y1="22" x2="22" y2="34"/>
              <line x1="86" y1="22" x2="98" y2="34"/><line x1="98" y1="22" x2="86" y2="34"/>
              <line x1="54" y1="54" x2="66" y2="66"/><line x1="66" y1="54" x2="54" y2="66"/>
            </g>
            <g fill="none" stroke="#ffce3a" stroke-width="7">
              <circle cx="28" cy="92" r="9"/>
              <circle cx="92" cy="60" r="9"/>
              <circle cx="92" cy="92" r="9"/>
            </g>
          </svg>`,
  },
  {
    id: 'ball-run',
    title: 'Ball Run',
    blurb: 'Steer a rolling ball down an endless neon runway. Dodge obstacles, chase speedpoints.',
    module: '../ball-run/js/ui.js',
    // Real-time full-bleed 3D canvas: the hub's own header row and the
    // hub-main side padding would both eat into the play area and show as
    // dead space / gutters around the game. Ball Run's own screens show
    // their own title and back affordance, same reasoning as escoba/mancala.
    immersive: true,
    accent: '#c22e8f',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#0a0a12"/>
            <path d="M10 105 L60 45 L110 105 Z" fill="none" stroke="#8f9aef" stroke-width="2.5"/>
            <path d="M35 78 L85 78" stroke="#8f9aef" stroke-width="1.5"/>
            <circle cx="60" cy="55" r="17" fill="#e91ec4"/>
            <ellipse cx="54" cy="49" rx="5" ry="3.5" fill="#ff9fe6" opacity="0.7"/>
          </svg>`,
  },
  {
    id: 'dots-boxes',
    title: 'Dots and Boxes',
    blurb: 'Draw lines, close boxes, chain your captures. Simple rules, deep endgame.',
    module: '../dots-boxes/js/ui.js',
    accent: '#7048a8',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#7048a8"/>
            <rect x="30" y="30" width="30" height="30" fill="rgba(255,255,255,0.16)"/>
            <g stroke="rgba(255,255,255,0.32)" stroke-width="2" stroke-linecap="round">
              <line x1="60" y1="60" x2="90" y2="60"/>
              <line x1="90" y1="30" x2="90" y2="60"/>
            </g>
            <g stroke="#ffce4a" stroke-width="6" stroke-linecap="round">
              <line x1="30" y1="30" x2="60" y2="30"/>
              <line x1="30" y1="30" x2="30" y2="60"/>
              <line x1="30" y1="60" x2="60" y2="60"/>
              <line x1="60" y1="30" x2="60" y2="60"/>
            </g>
            <g fill="#e7defb">
              <circle cx="30" cy="30" r="5"/><circle cx="60" cy="30" r="5"/><circle cx="90" cy="30" r="5"/>
              <circle cx="30" cy="60" r="5"/><circle cx="60" cy="60" r="5"/><circle cx="90" cy="60" r="5"/>
              <circle cx="30" cy="90" r="5"/><circle cx="60" cy="90" r="5"/><circle cx="90" cy="90" r="5"/>
            </g>
          </svg>`,
  },
];

class Hub {
  constructor(root) {
    this.root = root;
    this.current = null;     // { module, id } of the mounted game
    this._onBack = () => this.requestLeave();
    this.render();
    // Family-wide stats sync: best-effort, guarded, no-op offline. On load, on tab-hide, and on
    // returning to the launcher (a game may have just updated the stats).
    this._onVis = () => { if (document.visibilityState === 'hidden') this._syncStats(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._syncStats();
  }

  /** Best-effort family-wide stats sync (guarded; no-op offline or if Firebase is unconfigured). */
  _syncStats() { try { syncMyStats(); } catch { /* never block the hub */ } }

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
    // Games are always listed ALPHABETICALLY by display title (project rule). Sorting at
    // render time keeps it self-maintaining: a new GAMES entry lands in the right place no
    // matter where it is added to the array. localeCompare so accents (Chinchón, Parchís)
    // sort correctly.
    const visible = GAMES.filter((g) => !g.devOnly || dev)
      .sort((a, b) => a.title.localeCompare(b.title));
    this.games = visible;
    this.root.innerHTML = `
      <div class="hub">
        <header class="hub-top">
          <div class="hub-top-info">
            <button type="button" class="hub-back" data-role="back" hidden aria-label="Back to hub">‹ Hub</button>
            <h1 class="hub-top-title" data-role="title">Matt's Game Hub</h1>
            <button type="button" class="hub-version" data-role="version" hidden></button>
          </div>
          <div class="hub-top-right">
            <button type="button" class="hub-statsbtn" data-role="stats" aria-label="My game stats">My Stats</button>
            <button type="button" class="hub-statsbtn" data-role="leaderboard" aria-label="Leaderboards">Leaderboards</button>
            <a class="hub-profile" data-role="profile" href="profile/">My Profile</a>
          </div>
        </header>
        <main class="hub-main">
          <section class="hub-grid" data-role="grid" aria-label="Games">
            ${visible.map((g) => this.cardHTML(g)).join('')}
          </section>
          ${showKeepsake ? `<section class="hub-extra"><button type="button" class="hub-statsbtn hub-keepsake-btn" data-role="keepsake">🎁 Challenge</button></section>` : ''}
          <section class="hub-game" data-role="game" hidden></section>
        </main>
        <div class="hub-confirm" data-role="confirm" hidden>
          <div class="hub-confirm-scrim" data-role="confirm-cancel"></div>
          <div class="hub-confirm-card" role="dialog" aria-modal="true" aria-label="Leave game">
            <p class="hub-confirm-msg">Leave this game? Your current progress will be lost.</p>
            <div class="hub-confirm-actions">
              <button type="button" class="hub-cbtn hub-cbtn-ghost" data-role="confirm-cancel">Keep playing</button>
              <button type="button" class="hub-cbtn hub-cbtn-danger" data-role="confirm-leave">Leave game</button>
            </div>
          </div>
        </div>
        <div class="hub-fr" data-role="firstrun" hidden>
          <div class="hub-fr-scrim"></div>
          <div class="hub-fr-card" role="dialog" aria-modal="true" aria-label="Choose a name">
            <h2 class="hub-fr-h">Choose a name</h2>
            <div class="hub-fr-row">
              <input class="hub-fr-input" data-role="fr-name" type="text" maxlength="20" placeholder="Your name" autocomplete="off">
              <button type="button" class="hub-cbtn hub-cbtn-danger" data-role="fr-save">Save</button>
            </div>
            <div class="hub-fr-or">or</div>
            <div class="hub-fr-row">
              <input class="hub-fr-input" data-role="fr-code" type="text" maxlength="5" placeholder="Enter a code"
                     autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:.16em">
              <button type="button" class="hub-cbtn hub-cbtn-ghost" data-role="fr-link">Link</button>
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
      version: this.root.querySelector('[data-role="version"]'),
      topRight: this.root.querySelector('.hub-top-right'),
      keepsake: this.root.querySelector('[data-role="keepsake"]'),
    };

    // The profile pill reads "My Profile" (consistent with My Stats / Leaderboards); the accent
    // highlight still nudges setup when no profile exists yet.
    this.el.profile.textContent = 'My Profile';
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
        el.setAttribute('aria-label', `Update available: ${latest}. Tap to update.`);
      } else {
        el.textContent = cur;
        el.setAttribute('aria-label', `Version ${cur}. Tap to check for updates.`);
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

    box.querySelector('[data-role="fr-save"]').addEventListener('click', async () => {
      const name = (nameIn.value || '').trim();
      if (!name) { say('Enter a name.'); return; }
      const cur = loadProfile() || {};
      const code = cur.playerId || newPlayerCode();
      say('Checking...');
      let status = 'offline';
      try { status = await usernameStatus(name, code); } catch { status = 'offline'; }
      if (status === 'taken') { say('Taken. Use that code instead.'); return; }
      saveProfile(Object.assign({}, cur, { name, playerId: code }));
      try { claimUsername(name, code, ''); } catch { /* best-effort */ }
      finish();
    });

    box.querySelector('[data-role="fr-link"]').addEventListener('click', async () => {
      const code = canonicalizeCode(codeIn.value);
      if (!code) { say('Invalid code.'); return; }
      say('Linking...');
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

  cardHTML(g) {
    // Square tile: full-bleed art with the title in a caption. The blurb moves to
    // the accessible label (it is no longer shown on the compact tile face).
    const inner = `
        <span class="hub-card-art">${g.art}</span>
        <span class="hub-card-label">${g.title}</span>
        ${g.comingSoon ? '<span class="hub-soon-tag">Soon</span>'
          : g.devOnly ? '<span class="hub-soon-tag">Test</span>' : ''}`;
    const aria = g.blurb ? `${g.title}. ${g.blurb}` : g.title;
    // Launch-out games are real links (new-tab / middle-click / a11y); in-hub
    // modules are buttons that mount into the content area.
    if (g.href) {
      return `<a class="hub-card" href="${g.href}" style="--card-accent:${g.accent}" aria-label="${aria}">${inner}</a>`;
    }
    return `<button type="button" class="hub-card${g.comingSoon ? ' is-soon' : ''}"
              data-id="${g.id}" data-coming-soon="${!!g.comingSoon}"
              style="--card-accent:${g.accent}" aria-label="${aria}" ${g.comingSoon ? 'aria-disabled="true"' : ''}>${inner}</button>`;
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
      this.el.title.textContent = game.title;
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
      this.el.game.innerHTML = `<p class="hub-error">Couldn't load ${game.title}. Please try again.</p>`;
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
