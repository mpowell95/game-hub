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
import { loadFavorites, toggleFavorite } from './favorites.js';

const GAMES = [
  {
    id: 'connect-four',
    title: 'Connect Four',
    blurb: 'Drop discs, connect four. Four AI levels incl. a perfect endgame solver.',
    // Relative to this module (js/hub.js): up to root, then into the game folder.
    module: '../connect-four/js/ui.js',
    accent: '#1769d4',
    // Landscape (16:9) lets the REAL 7x6 board fit edge to edge for the first time;
    // the square frame could only ever show a 4x4 crop of it. Red's winning diagonal
    // runs c0r5 -> c3r2, and every filled cell is gravity-valid (nothing floats).
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#1769d4"/>
            <g fill="#dbe8f8">
              <circle cx="11.4" cy="7.5" r="6.2"/><circle cx="11.4" cy="22.5" r="6.2"/><circle cx="11.4" cy="37.5" r="6.2"/><circle cx="11.4" cy="52.5" r="6.2"/><circle cx="11.4" cy="67.5" r="6.2"/>
              <circle cx="34.3" cy="7.5" r="6.2"/><circle cx="34.3" cy="22.5" r="6.2"/><circle cx="34.3" cy="37.5" r="6.2"/><circle cx="34.3" cy="52.5" r="6.2"/>
              <circle cx="57.1" cy="7.5" r="6.2"/><circle cx="57.1" cy="22.5" r="6.2"/><circle cx="57.1" cy="37.5" r="6.2"/>
              <circle cx="80" cy="7.5" r="6.2"/><circle cx="80" cy="22.5" r="6.2"/>
              <circle cx="102.9" cy="7.5" r="6.2"/><circle cx="102.9" cy="22.5" r="6.2"/><circle cx="102.9" cy="37.5" r="6.2"/><circle cx="102.9" cy="52.5" r="6.2"/>
              <circle cx="125.7" cy="7.5" r="6.2"/><circle cx="125.7" cy="22.5" r="6.2"/><circle cx="125.7" cy="37.5" r="6.2"/><circle cx="125.7" cy="52.5" r="6.2"/><circle cx="125.7" cy="67.5" r="6.2"/>
              <circle cx="148.6" cy="7.5" r="6.2"/><circle cx="148.6" cy="22.5" r="6.2"/><circle cx="148.6" cy="37.5" r="6.2"/><circle cx="148.6" cy="52.5" r="6.2"/><circle cx="148.6" cy="67.5" r="6.2"/><circle cx="148.6" cy="82.5" r="6.2"/>
            </g>
            <g fill="#ffce3a">
              <circle cx="34.3" cy="82.5" r="6.2"/>
              <circle cx="57.1" cy="82.5" r="6.2"/><circle cx="57.1" cy="67.5" r="6.2"/>
              <circle cx="80" cy="67.5" r="6.2"/><circle cx="80" cy="52.5" r="6.2"/>
              <circle cx="102.9" cy="82.5" r="6.2"/>
            </g>
            <g fill="#e8463f">
              <circle cx="11.4" cy="82.5" r="6.2"/>
              <circle cx="34.3" cy="67.5" r="6.2"/>
              <circle cx="57.1" cy="52.5" r="6.2"/>
              <circle cx="80" cy="37.5" r="6.2"/>
              <circle cx="80" cy="82.5" r="6.2"/>
              <circle cx="102.9" cy="67.5" r="6.2"/>
              <circle cx="125.7" cy="82.5" r="6.2"/>
            </g>
          </svg>`,
  },
  {
    id: 'chinchon',
    title: 'Chinchón',
    blurb: 'Spanish rummy vs. smart AI. Melds, cuts & chinchón. 2–4 players.',
    module: '../chinchon/js/ui.js',
    accent: '#d4a017',
    // A held FAN of five cards is naturally wide, so it suits 16:9 far better than the
    // two-card stack the square frame forced. Centers arc up toward the middle card.
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#1f7a52"/>
            <g transform="rotate(-28 34 50)">
              <rect x="19" y="28" width="30" height="44" rx="4" fill="#f7edd4" stroke="#c9b485" stroke-width="1.4"/>
              <circle cx="34" cy="50" r="8" fill="#e8b53a" stroke="#a9791b" stroke-width="1.6"/>
              <circle cx="34" cy="50" r="5" fill="none" stroke="#a9791b" stroke-width="1"/>
            </g>
            <g transform="rotate(-14 57 45)">
              <rect x="42" y="23" width="30" height="44" rx="4" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.4"/>
              <polygon points="52,40 62,40 59.5,48 54.5,48" fill="#c0392b"/>
              <rect x="55.8" y="48" width="2.4" height="5" fill="#c0392b"/>
              <rect x="52.5" y="53" width="9" height="2.4" rx="1.2" fill="#c0392b"/>
            </g>
            <g transform="rotate(14 103 45)">
              <rect x="88" y="23" width="30" height="44" rx="4" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.4"/>
              <circle cx="103" cy="45" r="8" fill="#e8b53a" stroke="#a9791b" stroke-width="1.6"/>
              <circle cx="103" cy="45" r="5" fill="none" stroke="#a9791b" stroke-width="1"/>
            </g>
            <g transform="rotate(28 126 50)">
              <rect x="111" y="28" width="30" height="44" rx="4" fill="#f7edd4" stroke="#c9b485" stroke-width="1.4"/>
              <path d="M119 44 L133 44 L130 53 L122 53 Z" fill="#2d6a9f"/>
              <rect x="124.8" y="53" width="2.4" height="5" fill="#2d6a9f"/>
              <rect x="121.5" y="58" width="9" height="2.4" rx="1.2" fill="#2d6a9f"/>
            </g>
            <g>
              <rect x="65" y="20" width="30" height="44" rx="4" fill="#ffffff" stroke="#c9b485" stroke-width="1.4"/>
              <circle cx="80" cy="42" r="9" fill="#e8b53a" stroke="#a9791b" stroke-width="1.8"/>
              <circle cx="80" cy="42" r="5.6" fill="none" stroke="#a9791b" stroke-width="1.1"/>
              <circle cx="80" cy="42" r="1.8" fill="#a9791b"/>
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
    // Five property cards fanned wide (one per set colour) with the cash coin in front:
    // the same "hand of cards" idea as before, but spread to fill 16:9 instead of stacked.
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#6a4cff"/>
            <g transform="rotate(-24 30 48)"><rect x="18" y="27" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="18" y="27" width="24" height="10" rx="3" fill="#e0532f"/></g>
            <g transform="rotate(-12 55 44)"><rect x="43" y="23" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="43" y="23" width="24" height="10" rx="3" fill="#178a7a"/></g>
            <g transform="rotate(12 105 44)"><rect x="93" y="23" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="93" y="23" width="24" height="10" rx="3" fill="#f2b705"/></g>
            <g transform="rotate(24 130 48)"><rect x="118" y="27" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="118" y="27" width="24" height="10" rx="3" fill="#8155ba"/></g>
            <g><rect x="68" y="20" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="68" y="20" width="24" height="10" rx="3" fill="#1f5fa8"/></g>
            <circle cx="134" cy="70" r="12" fill="#f2b705" stroke="#a9791b" stroke-width="1.8"/>
            <text x="134" y="75.5" font-size="15" font-weight="900" text-anchor="middle" fill="#7a5502" font-family="system-ui, -apple-system, sans-serif">$</text>
          </svg>`,
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
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#7a5a34"/>
            <rect x="40" y="5" width="80" height="80" rx="4.4" fill="#f5ecd6"/>
            <rect x="70.5" y="5" width="18.9" height="80" fill="#ffffff"/>
            <rect x="40" y="35.5" width="80" height="18.9" fill="#ffffff"/>
            <rect x="44.4" y="9.4" width="24" height="24" rx="3.6" fill="#f2b705"/>
            <rect x="91.6" y="9.4" width="24" height="24" rx="3.6" fill="#1f5fa8"/>
            <rect x="44.4" y="56.6" width="24" height="24" rx="3.6" fill="#178a7a"/>
            <rect x="91.6" y="56.6" width="24" height="24" rx="3.6" fill="#e0532f"/>
            <g fill="#ffffff" stroke="rgba(0,0,0,0.22)" stroke-width="0.8">
              <circle cx="50.4" cy="15.4" r="2.9"/><circle cx="62.4" cy="15.4" r="2.9"/><circle cx="50.4" cy="27.4" r="2.9"/><circle cx="62.4" cy="27.4" r="2.9"/>
              <circle cx="97.6" cy="15.4" r="2.9"/><circle cx="109.6" cy="15.4" r="2.9"/><circle cx="97.6" cy="27.4" r="2.9"/><circle cx="109.6" cy="27.4" r="2.9"/>
              <circle cx="50.4" cy="62.6" r="2.9"/><circle cx="62.4" cy="62.6" r="2.9"/><circle cx="50.4" cy="74.6" r="2.9"/><circle cx="62.4" cy="74.6" r="2.9"/>
              <circle cx="97.6" cy="62.6" r="2.9"/><circle cx="109.6" cy="62.6" r="2.9"/><circle cx="97.6" cy="74.6" r="2.9"/><circle cx="109.6" cy="74.6" r="2.9"/>
            </g>
            <rect x="76.4" y="5.7" width="7.3" height="29.8" fill="#f2b705"/>
            <rect x="89.4" y="41.4" width="29.8" height="7.3" fill="#1f5fa8"/>
            <rect x="76.4" y="54.4" width="7.3" height="29.8" fill="#e0532f"/>
            <rect x="40.7" y="41.4" width="29.8" height="7.3" fill="#178a7a"/>
            <polygon points="72,37 88,37 80,45" fill="#f2b705"/>
            <polygon points="88,37 88,53 80,45" fill="#1f5fa8"/>
            <polygon points="88,53 72,53 80,45" fill="#e0532f"/>
            <polygon points="72,53 72,37 80,45" fill="#178a7a"/>
            <g stroke="rgba(0,0,0,0.3)" stroke-width="1">
              <circle cx="12" cy="21" r="4.5" fill="#f2b705"/><path d="M6 33 L9.5 25 L14.5 25 L18 33 Z" fill="#f2b705"/>
              <circle cx="28" cy="21" r="4.5" fill="#1f5fa8"/><path d="M22 33 L25.5 25 L30.5 25 L34 33 Z" fill="#1f5fa8"/>
              <circle cx="12" cy="53" r="4.5" fill="#178a7a"/><path d="M6 65 L9.5 57 L14.5 57 L18 65 Z" fill="#178a7a"/>
              <circle cx="28" cy="53" r="4.5" fill="#e0532f"/><path d="M22 65 L25.5 57 L30.5 57 L34 65 Z" fill="#e0532f"/>
            </g>
            <rect x="124" y="31" width="28" height="28" rx="5" fill="#ffffff" stroke="rgba(0,0,0,0.28)" stroke-width="1.2"/>
            <g fill="#7a5a34">
              <circle cx="131" cy="38" r="2.6"/><circle cx="145" cy="38" r="2.6"/>
              <circle cx="138" cy="45" r="2.6"/>
              <circle cx="131" cy="52" r="2.6"/><circle cx="145" cy="52" r="2.6"/>
            </g>
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
    // Landscape lets the three elements sit side by side instead of stacked: the fanned
    // capture, the 15 coin, and the broom (escoba). The broom moved to the RIGHT so it
    // no longer sits under the bottom-left title label.
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#175c3b"/>
            <g transform="rotate(-18 34 46)">
              <rect x="20" y="26" width="28" height="40" rx="4" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.4"/>
              <circle cx="34" cy="46" r="8" fill="#e8b53a" stroke="#a9791b" stroke-width="1.6"/>
              <circle cx="34" cy="46" r="5" fill="none" stroke="#a9791b" stroke-width="1"/>
            </g>
            <g transform="rotate(18 70 46)">
              <rect x="56" y="26" width="28" height="40" rx="4" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.4"/>
              <polygon points="64,40 76,40 73,49 67,49" fill="#c0392b"/>
              <rect x="68.8" y="49" width="2.4" height="5" fill="#c0392b"/>
              <rect x="65.5" y="54" width="9" height="2.4" rx="1.2" fill="#c0392b"/>
            </g>
            <g>
              <rect x="38" y="20" width="28" height="40" rx="4" fill="#ffffff" stroke="#c9b485" stroke-width="1.4"/>
              <circle cx="47" cy="32" r="5.4" fill="#e8b53a" stroke="#a9791b" stroke-width="1.3"/>
              <circle cx="57" cy="48" r="5.4" fill="#e8b53a" stroke="#a9791b" stroke-width="1.3"/>
            </g>
            <g transform="rotate(-25 132 60)">
              <rect x="130" y="26" width="4.5" height="34" rx="2.2" fill="#a9791b"/>
              <path d="M122 60 L142 60 L146 80 L118 80 Z" fill="#e8b53a" stroke="#a9791b" stroke-width="1.4"/>
              <rect x="121" y="60" width="22" height="4" fill="#a9791b"/>
              <line x1="126" y1="65" x2="124" y2="79" stroke="#a9791b" stroke-width="1.3"/>
              <line x1="132" y1="65" x2="132" y2="79" stroke="#a9791b" stroke-width="1.3"/>
              <line x1="138" y1="65" x2="140" y2="79" stroke="#a9791b" stroke-width="1.3"/>
            </g>
            <circle cx="101" cy="31" r="14" fill="#f2b705" stroke="#a9791b" stroke-width="1.8"/>
            <text x="101" y="37.5" font-size="16" font-weight="900" text-anchor="middle" fill="#7a5502" font-family="system-ui, -apple-system, sans-serif">15</text>
          </svg>`,
  },
  {
    id: 'filler',
    title: 'Filler',
    blurb: 'Flood-fill duel vs. smart AI. Pick colors, grow your corner, capture the majority.',
    module: '../filler/js/ui.js',
    accent: '#c2557f',
    // 8x5 instead of 5x5: the flood-fill board is arbitrary-sized, so widening it is the
    // honest landscape reading rather than a stretch. Player corner markers moved to
    // top-left / bottom-right so neither sits under the title label.
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#202a3c"/>
            <g>
              <rect x="2" y="1" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="22" y="1" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="42" y="1" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="62" y="1" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="82" y="1" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="102" y="1" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="122" y="1" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="142" y="1" width="16" height="16" rx="3.5" fill="#E0532F"/>
              <rect x="2" y="19" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="22" y="19" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="42" y="19" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="62" y="19" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="82" y="19" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="102" y="19" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="122" y="19" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="142" y="19" width="16" height="16" rx="3.5" fill="#1F5FA8"/>
              <rect x="2" y="37" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="22" y="37" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="42" y="37" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="62" y="37" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="82" y="37" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="102" y="37" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="122" y="37" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="142" y="37" width="16" height="16" rx="3.5" fill="#F2B705"/>
              <rect x="2" y="55" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="22" y="55" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="42" y="55" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="62" y="55" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="82" y="55" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="102" y="55" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="122" y="55" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="142" y="55" width="16" height="16" rx="3.5" fill="#8155BA"/>
              <rect x="2" y="73" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="22" y="73" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="42" y="73" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="62" y="73" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="82" y="73" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="102" y="73" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="122" y="73" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="142" y="73" width="16" height="16" rx="3.5" fill="#178A7A"/>
            </g>
            <circle cx="10" cy="9" r="5" fill="none" stroke="#ffffff" stroke-width="2.5"/>
            <circle cx="150" cy="81" r="5" fill="none" stroke="#ffffff" stroke-width="2.5"/>
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
    // The single biggest win from landscape: a real Mancala board IS a long tray, so
    // 16:9 finally shows the true layout (two rows of six pits, a store at each end)
    // instead of the 2x2 abstraction the square frame forced.
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#b96f35"/>
            <rect x="4" y="8" width="152" height="74" rx="18" fill="#f5b963" stroke="#241609" stroke-width="3.5"/>
            <rect x="12" y="18" width="20" height="54" rx="10" fill="#29a8dd" stroke="#241609" stroke-width="2.6"/>
            <rect x="128" y="18" width="20" height="54" rx="10" fill="#ef5544" stroke="#241609" stroke-width="2.6"/>
            <g stroke="#241609" stroke-width="2.6" fill="#ef5544">
              <circle cx="46.8" cy="32" r="6.2"/><circle cx="60.5" cy="32" r="6.2"/><circle cx="74.2" cy="32" r="6.2"/>
              <circle cx="87.8" cy="32" r="6.2"/><circle cx="101.5" cy="32" r="6.2"/><circle cx="115.2" cy="32" r="6.2"/>
            </g>
            <g stroke="#241609" stroke-width="2.6" fill="#29a8dd">
              <circle cx="46.8" cy="58" r="6.2"/><circle cx="60.5" cy="58" r="6.2"/><circle cx="74.2" cy="58" r="6.2"/>
              <circle cx="87.8" cy="58" r="6.2"/><circle cx="101.5" cy="58" r="6.2"/><circle cx="115.2" cy="58" r="6.2"/>
            </g>
            <g fill="#faf0d8" stroke="rgba(74,53,24,0.55)" stroke-width="0.8">
              <circle cx="44.8" cy="30.2" r="1.9"/><circle cx="48.8" cy="31.4" r="1.9"/><circle cx="46.4" cy="34.2" r="1.9"/>
              <circle cx="58.7" cy="30.8" r="1.9"/><circle cx="62.3" cy="33.2" r="1.9"/>
              <circle cx="72.3" cy="30.4" r="1.9"/><circle cx="76.2" cy="31.6" r="1.9"/><circle cx="74" cy="34.4" r="1.9"/>
              <circle cx="86" cy="31.4" r="1.9"/><circle cx="89.6" cy="33" r="1.9"/>
              <circle cx="99.6" cy="30.8" r="1.9"/><circle cx="103.4" cy="32.2" r="1.9"/><circle cx="101.2" cy="34.4" r="1.9"/>
              <circle cx="113.4" cy="31.4" r="1.9"/><circle cx="117" cy="32.8" r="1.9"/>
              <circle cx="44.8" cy="56.2" r="1.9"/><circle cx="48.8" cy="57.4" r="1.9"/><circle cx="46.4" cy="60.2" r="1.9"/>
              <circle cx="58.7" cy="56.8" r="1.9"/><circle cx="62.3" cy="59.2" r="1.9"/>
              <circle cx="72.3" cy="56.4" r="1.9"/><circle cx="76.2" cy="57.6" r="1.9"/><circle cx="74" cy="60.4" r="1.9"/>
              <circle cx="86" cy="57.4" r="1.9"/><circle cx="89.6" cy="59" r="1.9"/>
              <circle cx="99.6" cy="56.8" r="1.9"/><circle cx="103.4" cy="58.2" r="1.9"/><circle cx="101.2" cy="60.4" r="1.9"/>
              <circle cx="113.4" cy="57.4" r="1.9"/><circle cx="117" cy="58.8" r="1.9"/>
              <circle cx="19.5" cy="30" r="1.9"/><circle cx="24" cy="34" r="1.9"/><circle cx="20" cy="39" r="1.9"/>
              <circle cx="24.5" cy="44" r="1.9"/><circle cx="19.5" cy="49" r="1.9"/><circle cx="23.5" cy="54" r="1.9"/><circle cx="21" cy="60" r="1.9"/>
              <circle cx="135.5" cy="32" r="1.9"/><circle cx="140" cy="36" r="1.9"/><circle cx="136" cy="41" r="1.9"/>
              <circle cx="140.5" cy="46" r="1.9"/><circle cx="135.5" cy="51" r="1.9"/><circle cx="139.5" cy="57" r="1.9"/>
            </g>
          </svg>`,
  },
  {
    id: 'nuts-bolts',
    title: 'Nuts & Bolts',
    blurb: 'Colour-sort puzzle. Stack matching nuts onto bolts.',
    module: '../nuts-bolts/js/ui.js',
    accent: '#607d8b',
    // Five bolts in a WIDE row rather than three stacked tall: the puzzle's real shape is
    // a workbench of bolts side by side, which is what 16:9 wants. Uneven stack heights
    // read as a puzzle mid-solve. The bench bar sits above the title label, not under it.
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#3f4652"/>
            <g fill="#9aa7bd">
              <rect x="17" y="12" width="6" height="58" rx="3"/>
              <rect x="47" y="12" width="6" height="58" rx="3"/>
              <rect x="77" y="12" width="6" height="58" rx="3"/>
              <rect x="107" y="12" width="6" height="58" rx="3"/>
              <rect x="137" y="12" width="6" height="58" rx="3"/>
            </g>
            <g stroke="rgba(0,0,0,0.25)" stroke-width="1.3">
              <polygon points="7,64 13.5,58.5 26.5,58.5 33,64 26.5,69.5 13.5,69.5" fill="#f2b705"/>
              <polygon points="7,52 13.5,46.5 26.5,46.5 33,52 26.5,57.5 13.5,57.5" fill="#f2b705"/>
              <polygon points="7,40 13.5,34.5 26.5,34.5 33,40 26.5,45.5 13.5,45.5" fill="#1f5fa8"/>
              <polygon points="37,64 43.5,58.5 56.5,58.5 63,64 56.5,69.5 43.5,69.5" fill="#178a7a"/>
              <polygon points="37,52 43.5,46.5 56.5,46.5 63,52 56.5,57.5 43.5,57.5" fill="#178a7a"/>
              <polygon points="67,64 73.5,58.5 86.5,58.5 93,64 86.5,69.5 73.5,69.5" fill="#c24420"/>
              <polygon points="67,52 73.5,46.5 86.5,46.5 93,52 86.5,57.5 73.5,57.5" fill="#c24420"/>
              <polygon points="67,40 73.5,34.5 86.5,34.5 93,40 86.5,45.5 73.5,45.5" fill="#c24420"/>
              <polygon points="67,28 73.5,22.5 86.5,22.5 93,28 86.5,33.5 73.5,33.5" fill="#f2b705"/>
              <polygon points="97,64 103.5,58.5 116.5,58.5 123,64 116.5,69.5 103.5,69.5" fill="#1f5fa8"/>
              <polygon points="127,64 133.5,58.5 146.5,58.5 153,64 146.5,69.5 133.5,69.5" fill="#1f5fa8"/>
              <polygon points="127,52 133.5,46.5 146.5,46.5 153,52 146.5,57.5 133.5,57.5" fill="#f2b705"/>
              <polygon points="127,40 133.5,34.5 146.5,34.5 153,40 146.5,45.5 133.5,45.5" fill="#c24420"/>
            </g>
            <rect x="6" y="70" width="148" height="7" rx="3.5" fill="#6b7688"/>
          </svg>`,
  },
  {
    id: 'tic-tac-toe',
    title: 'Tic Tac Toe',
    blurb: 'Classic 3x3, or Ultimate: nine boards in one, where your move picks your opponent\'s board.',
    module: '../tic-tac-toe/js/ui.js',
    accent: '#0e7c86',
    // SQUARE BOARD, deliberately not stretched: the 3x3 is shown at full height, and the
    // width is earned by the winning strike line running out past the board on both sides
    // (option 1 of the handoff's square-board guidance) rather than by distorting the grid.
    // The strike is white, so the win reads by LINE not by hue (colorblind-safe).
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#0e7c86"/>
            <g stroke="#d7ece9" stroke-width="3.5" stroke-linecap="round">
              <line x1="67.3" y1="7" x2="67.3" y2="83"/>
              <line x1="92.7" y1="7" x2="92.7" y2="83"/>
              <line x1="42" y1="32.3" x2="118" y2="32.3"/>
              <line x1="42" y1="57.7" x2="118" y2="57.7"/>
            </g>
            <line x1="22" y1="45" x2="138" y2="45" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
            <g fill="none" stroke="#ffce3a" stroke-width="5.5">
              <circle cx="54.7" cy="19.7" r="7.5"/>
              <circle cx="105.3" cy="19.7" r="7.5"/>
            </g>
            <g stroke="#e0532f" stroke-width="5.5" stroke-linecap="round">
              <line x1="47.7" y1="38" x2="61.7" y2="52"/><line x1="61.7" y1="38" x2="47.7" y2="52"/>
              <line x1="73" y1="38" x2="87" y2="52"/><line x1="87" y1="38" x2="73" y2="52"/>
              <line x1="98.3" y1="38" x2="112.3" y2="52"/><line x1="112.3" y1="38" x2="98.3" y2="52"/>
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
    // A runway receding to a horizon is the one composition that WANTS 16:9, so this
    // gains the most from the wider frame: the track now runs off both bottom corners
    // and the perspective rungs compress toward the vanishing point.
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#0a0a12"/>
            <ellipse cx="80" cy="28" rx="46" ry="9" fill="#1b1b3a"/>
            <path d="M5 90 L73 28 L87 28 L155 90 Z" fill="#12122a" stroke="#8f9aef" stroke-width="2.4"/>
            <g stroke="#8f9aef" stroke-linecap="round">
              <line x1="7.2" y1="88" x2="152.8" y2="88" stroke-width="2" opacity="0.9"/>
              <line x1="20.4" y1="76" x2="139.6" y2="76" stroke-width="1.8" opacity="0.75"/>
              <line x1="35.7" y1="62" x2="124.3" y2="62" stroke-width="1.6" opacity="0.6"/>
              <line x1="48.9" y1="50" x2="111.1" y2="50" stroke-width="1.4" opacity="0.45"/>
              <line x1="58.7" y1="41" x2="101.3" y2="41" stroke-width="1.2" opacity="0.3"/>
              <line x1="66.4" y1="34" x2="93.6" y2="34" stroke-width="1" opacity="0.2"/>
            </g>
            <circle cx="80" cy="62" r="17" fill="#e91ec4" opacity="0.18"/>
            <circle cx="80" cy="62" r="12" fill="#e91ec4"/>
            <ellipse cx="75.5" cy="57" rx="3.6" ry="2.5" fill="#ff9fe6" opacity="0.75"/>
          </svg>`,
  },
  {
    id: 'dots-boxes',
    title: 'Dots and Boxes',
    blurb: 'Draw lines, close boxes, chain your captures. Simple rules, deep endgame.',
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
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#16243a"/>
            <rect x="20" y="12" width="48" height="18.7" fill="rgba(255,59,48,0.3)"/>
            <rect x="68" y="30.7" width="24" height="18.6" fill="rgba(0,122,255,0.3)"/>
            <g stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linecap="round">
              <line x1="92" y1="12" x2="116" y2="12"/>
              <line x1="116" y1="12" x2="116" y2="30.7"/>
              <line x1="116" y1="30.7" x2="140" y2="30.7"/>
              <line x1="44" y1="49.3" x2="68" y2="49.3"/>
              <line x1="20" y1="49.3" x2="20" y2="68"/>
              <line x1="92" y1="49.3" x2="92" y2="68"/>
              <line x1="116" y1="49.3" x2="140" y2="49.3"/>
            </g>
            <g stroke="#ff3b30" stroke-width="5" stroke-linecap="round">
              <line x1="20" y1="12" x2="44" y2="12"/><line x1="44" y1="12" x2="68" y2="12"/>
              <line x1="20" y1="12" x2="20" y2="30.7"/>
              <line x1="44" y1="12" x2="44" y2="30.7"/>
              <line x1="68" y1="12" x2="68" y2="30.7"/>
              <line x1="20" y1="30.7" x2="44" y2="30.7"/><line x1="44" y1="30.7" x2="68" y2="30.7"/>
            </g>
            <g stroke="#007aff" stroke-width="5" stroke-linecap="round">
              <line x1="68" y1="30.7" x2="92" y2="30.7"/>
              <line x1="68" y1="30.7" x2="68" y2="49.3"/>
              <line x1="92" y1="30.7" x2="92" y2="49.3"/>
              <line x1="68" y1="49.3" x2="92" y2="49.3"/>
            </g>
            <g fill="#e7defb">
              <circle cx="20" cy="12" r="3.5"/><circle cx="44" cy="12" r="3.5"/><circle cx="68" cy="12" r="3.5"/><circle cx="92" cy="12" r="3.5"/><circle cx="116" cy="12" r="3.5"/><circle cx="140" cy="12" r="3.5"/>
              <circle cx="20" cy="30.7" r="3.5"/><circle cx="44" cy="30.7" r="3.5"/><circle cx="68" cy="30.7" r="3.5"/><circle cx="92" cy="30.7" r="3.5"/><circle cx="116" cy="30.7" r="3.5"/><circle cx="140" cy="30.7" r="3.5"/>
              <circle cx="20" cy="49.3" r="3.5"/><circle cx="44" cy="49.3" r="3.5"/><circle cx="68" cy="49.3" r="3.5"/><circle cx="92" cy="49.3" r="3.5"/><circle cx="116" cy="49.3" r="3.5"/><circle cx="140" cy="49.3" r="3.5"/>
              <circle cx="20" cy="68" r="3.5"/><circle cx="44" cy="68" r="3.5"/><circle cx="68" cy="68" r="3.5"/><circle cx="92" cy="68" r="3.5"/><circle cx="116" cy="68" r="3.5"/><circle cx="140" cy="68" r="3.5"/>
            </g>
          </svg>`,
  },
  {
    id: 'boggle',
    title: 'Boggle',
    blurb: 'Shake the grid, race the clock. Link touching letters into as many words as you can.',
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
    art: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#1f3864"/>
            <g fill="rgba(255,255,255,0.13)">
              <rect x="8" y="8" width="16" height="16" rx="3.5"/><rect x="27" y="8" width="16" height="16" rx="3.5"/>
              <rect x="46" y="8" width="16" height="16" rx="3.5"/><rect x="65" y="8" width="16" height="16" rx="3.5"/>
              <rect x="8" y="27" width="16" height="16" rx="3.5"/><rect x="27" y="27" width="16" height="16" rx="3.5"/>
              <rect x="46" y="27" width="16" height="16" rx="3.5"/><rect x="65" y="27" width="16" height="16" rx="3.5"/>
              <rect x="8" y="46" width="16" height="16" rx="3.5"/><rect x="27" y="46" width="16" height="16" rx="3.5"/>
              <rect x="46" y="46" width="16" height="16" rx="3.5"/><rect x="65" y="46" width="16" height="16" rx="3.5"/>
              <rect x="8" y="65" width="16" height="16" rx="3.5"/><rect x="27" y="65" width="16" height="16" rx="3.5"/>
              <rect x="46" y="65" width="16" height="16" rx="3.5"/><rect x="65" y="65" width="16" height="16" rx="3.5"/>
            </g>
            <path d="M16,35 L35,54 L54,35 L97,42 L120,36 L143,30" stroke="#ffce4a" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <g fill="#ffffff">
              <rect x="8" y="27" width="16" height="16" rx="3.5"/>
              <rect x="27" y="46" width="16" height="16" rx="3.5"/>
              <rect x="46" y="27" width="16" height="16" rx="3.5"/>
            </g>
            <g fill="#1f3864" font-family="system-ui, sans-serif" font-weight="900" font-size="11" text-anchor="middle">
              <text x="16" y="39">B</text>
              <text x="35" y="58">O</text>
              <text x="54" y="39">G</text>
            </g>
            <g transform="rotate(-7 97 42)">
              <rect x="88" y="33" width="18" height="18" rx="4" fill="#ffffff"/>
              <text x="97" y="46.5" fill="#1f3864" font-family="system-ui, sans-serif" font-weight="900" font-size="12" text-anchor="middle">G</text>
            </g>
            <g transform="rotate(6 120 36)">
              <rect x="111" y="27" width="18" height="18" rx="4" fill="#ffffff"/>
              <text x="120" y="40.5" fill="#1f3864" font-family="system-ui, sans-serif" font-weight="900" font-size="12" text-anchor="middle">L</text>
            </g>
            <g transform="rotate(-5 143 30)">
              <rect x="134" y="21" width="18" height="18" rx="4" fill="#ffffff"/>
              <text x="143" y="34.5" fill="#1f3864" font-family="system-ui, sans-serif" font-weight="900" font-size="12" text-anchor="middle">E</text>
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
    const byTitle = (a, b) => a.title.localeCompare(b.title);
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
            ${gridHTML}
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
      say('Checking...');
      let status = 'offline';
      try { status = await usernameStatus(name, code); } catch { status = 'offline'; }
      if (status === 'taken') { say('Taken. Use that code instead.'); return; }
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
    // Landscape tile: full-bleed art with the title outlined directly over it (no scrim).
    // The blurb moves to the accessible label (it is no longer shown on the tile face).
    const inner = `
        <span class="hub-card-art">${g.art}</span>
        <span class="hub-card-label">${g.title}</span>
        ${g.comingSoon ? '<span class="hub-soon-tag">Soon</span>'
          : g.devOnly ? '<span class="hub-soon-tag">Test</span>' : ''}`;
    const aria = g.blurb ? `${g.title}. ${g.blurb}` : g.title;
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
    const favLabel = favored ? `Remove ${g.title} from favorites` : `Add ${g.title} to favorites`;
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
