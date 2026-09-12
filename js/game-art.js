// game-art.js — single source for every game's hub-launcher tile art (inline SVG, viewBox
// 0 0 160 90, landscape, full-bleed background rect). Moved out of js/hub.js's GAMES registry
// (2026-07-23, leaderboard redesign) so the Leaderboard overlay's By Game screen can show the
// SAME real tile art as a thumbnail without importing hub.js (a side-effectful module — hub.js
// boots stats sync, first-run gates, etc. on import). hub.js still owns GAMES and consumes this
// as GAME_ART[id]; the launcher must render pixel-identically to before the move.
//
// Keyed by the HUB registry id (GAMES[].id), not the stats id — see js/leaderboard-ui.js for the
// stats-id -> hub-id map used to look these up from aggregated player data.

export const GAME_ART = {
  'connect-four': `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  chinchon: `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  // Repainted 2026-09-12, second pass: the first repaint invented an "action card" (a dark card
  // with a lightning bolt) that matches nothing in the real deck or this game's own art — action
  // cards here have no such look, so it read as a made-up fifth suit. This is a fan of five CASH
  // bills instead, each its own color and denomination (1M-5M) — real Monopoly Deal vocabulary,
  // nothing invented, and it still reads instantly as "a deck of money cards" at tile size.
  'business-deal': `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#6a4cff"/>
            <g transform="rotate(-24 26 50)">
              <rect x="14" y="29" width="24" height="42" rx="3" fill="#e0607a" stroke="#8f1f3c" stroke-width="1.2"/>
              <rect x="17" y="32" width="18" height="12" rx="2" fill="#fdeaf0" opacity="0.9"/>
              <text x="26" y="41.5" font-size="8" font-weight="900" text-anchor="middle" fill="#8f1f3c" font-family="system-ui, -apple-system, sans-serif">1M</text>
            </g>
            <g transform="rotate(-12 55 46)">
              <rect x="43" y="25" width="24" height="42" rx="3" fill="#178a4f" stroke="#0d5c31" stroke-width="1.2"/>
              <rect x="46" y="28" width="18" height="12" rx="2" fill="#e8f7ee" opacity="0.9"/>
              <text x="55" y="37.5" font-size="8" font-weight="900" text-anchor="middle" fill="#0d5c31" font-family="system-ui, -apple-system, sans-serif">2M</text>
            </g>
            <g>
              <rect x="68" y="18" width="24" height="46" rx="3" fill="#178a99" stroke="#0d4d55" stroke-width="1.2"/>
              <rect x="71" y="21" width="18" height="12" rx="2" fill="#e6f6f8" opacity="0.9"/>
              <text x="80" y="30.5" font-size="8" font-weight="900" text-anchor="middle" fill="#0d4d55" font-family="system-ui, -apple-system, sans-serif">3M</text>
            </g>
            <g transform="rotate(12 105 46)">
              <rect x="93" y="25" width="24" height="42" rx="3" fill="#e8b53a" stroke="#8f6210" stroke-width="1.2"/>
              <rect x="96" y="28" width="18" height="12" rx="2" fill="#fdf6e3" opacity="0.9"/>
              <text x="105" y="37.5" font-size="8" font-weight="900" text-anchor="middle" fill="#8f6210" font-family="system-ui, -apple-system, sans-serif">4M</text>
            </g>
            <g transform="rotate(24 134 50)">
              <rect x="122" y="29" width="24" height="42" rx="3" fill="#2f6fce" stroke="#153c6e" stroke-width="1.2"/>
              <rect x="125" y="32" width="18" height="12" rx="2" fill="#e5f0ff" opacity="0.9"/>
              <text x="134" y="41.5" font-size="8" font-weight="900" text-anchor="middle" fill="#153c6e" font-family="system-ui, -apple-system, sans-serif">5M</text>
            </g>
          </svg>`,
  parchis: `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  escoba: `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  // Repainted 2026-09-12: the rainbow grid alone read as "some color game," with nothing showing
  // the actual mechanic (two players' territory FLOODING toward each other from opposite
  // corners). Two blocky staircase claims, one per player's seed corner, now sit over the same
  // color grid — the grid still sells "pick a color," the staircases sell "and it spreads."
  // Corners match the real engine (filler/js/game.js: P1_START is bottom-left, the human;
  // P2_START is top-right, the computer) — an earlier draft of this had them swapped.
  filler: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#202a3c"/>
            <g opacity="0.62">
              <rect x="2" y="1" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="22" y="1" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="42" y="1" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="62" y="1" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="82" y="1" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="102" y="1" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="122" y="1" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="142" y="1" width="16" height="16" rx="3.5" fill="#E0532F"/>
              <rect x="2" y="19" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="22" y="19" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="42" y="19" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="62" y="19" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="82" y="19" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="102" y="19" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="122" y="19" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="142" y="19" width="16" height="16" rx="3.5" fill="#1F5FA8"/>
              <rect x="2" y="37" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="22" y="37" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="42" y="37" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="62" y="37" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="82" y="37" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="102" y="37" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="122" y="37" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="142" y="37" width="16" height="16" rx="3.5" fill="#F2B705"/>
              <rect x="2" y="55" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="22" y="55" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="42" y="55" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="62" y="55" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="82" y="55" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="102" y="55" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="122" y="55" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="142" y="55" width="16" height="16" rx="3.5" fill="#8155BA"/>
              <rect x="2" y="73" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="22" y="73" width="16" height="16" rx="3.5" fill="#D06E9F"/><rect x="42" y="73" width="16" height="16" rx="3.5" fill="#178A7A"/><rect x="62" y="73" width="16" height="16" rx="3.5" fill="#E0532F"/><rect x="82" y="73" width="16" height="16" rx="3.5" fill="#1F5FA8"/><rect x="102" y="73" width="16" height="16" rx="3.5" fill="#F2B705"/><rect x="122" y="73" width="16" height="16" rx="3.5" fill="#8155BA"/><rect x="142" y="73" width="16" height="16" rx="3.5" fill="#178A7A"/>
            </g>
            <path d="M2 89 L82 89 L82 71 L62 71 L62 53 L42 53 L42 35 L22 35 L22 17 L2 17 Z"
                  fill="#178A7A" fill-opacity="0.68" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
            <path d="M158 1 L78 1 L78 19 L98 19 L98 37 L118 37 L118 55 L138 55 L138 73 L158 73 Z"
                  fill="#E0532F" fill-opacity="0.68" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
            <circle cx="10" cy="81" r="5.5" fill="#178A7A" stroke="#ffffff" stroke-width="2.2"/>
            <circle cx="150" cy="9" r="5.5" fill="#E0532F" stroke="#ffffff" stroke-width="2.2"/>
          </svg>`,
  mancala: `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  // Pipes: a run of pipe crossing the frame left to right, half of it already carrying water and
  // half still dry and mis-turned - the game's whole idea in one picture. Landscape and
  // full-bleed per checklist item 5; composed FOR 160x90, never a square cropped to fit.
  'pipes': `<svg viewBox="0 0 160 90" aria-hidden="true">
    <rect width="160" height="90" fill="#12303f"/>
    <g fill="none" stroke="#2f4d5e" stroke-width="9" stroke-linecap="round">
      <path d="M20 66 H44 V26 H70"/>
      <path d="M96 26 H120 V64 H146"/>
      <path d="M112 78 H136"/>
      <path d="M34 14 V34"/>
    </g>
    <g fill="none" stroke="#43b6f5" stroke-width="9" stroke-linecap="round">
      <path d="M20 66 H44 V26 H70"/>
    </g>
    <circle cx="20" cy="66" r="7" fill="#F2B705"/>
    <circle cx="146" cy="64" r="7" fill="#2f4d5e"/>
    <circle cx="70" cy="26" r="5" fill="#43b6f5"/>
  </svg>`,
  // Sudoku: a 9x9 grid drawn landscape, thick lines every 3 cells (the box boundaries), a handful
  // of filled-in digits so it reads as "a puzzle" rather than "a grid", and one cell outlined in
  // the app's standing selection accent (#ffce3a, root CLAUDE.md) the way the game itself marks a
  // selected cell. Composed FOR 160x90, full-bleed, per checklist item 5.
  'sudoku': `<svg viewBox="0 0 160 90" aria-hidden="true">
    <rect width="160" height="90" fill="#2a1440"/>
    <g stroke="#6b3a86" stroke-width="0.75">
      <path d="M44 9 V81 M52 9 V81 M60 9 V81 M76 9 V81 M84 9 V81 M100 9 V81 M108 9 V81"/>
      <path d="M44 17 H116 M44 25 H116 M44 41 H116 M44 49 H116 M44 65 H116 M44 73 H116"/>
    </g>
    <g stroke="#c9a6e0" stroke-width="2">
      <path d="M44 9 V81 M68 9 V81 M92 9 V81 M116 9 V81"/>
      <path d="M44 9 H116 M44 33 H116 M44 57 H116 M44 81 H116"/>
    </g>
    <g fill="#efe3f5" font-family="system-ui, sans-serif" font-size="11" font-weight="700" text-anchor="middle">
      <text x="48" y="30">5</text>
      <text x="80" y="22">2</text>
      <text x="104" y="46">9</text>
      <text x="56" y="62">7</text>
      <text x="112" y="78">4</text>
    </g>
    <rect x="68.5" y="33.5" width="15" height="15" fill="none" stroke="#ffce3a" stroke-width="2.5"/>
  </svg>`,
  'nuts-bolts': `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  'tic-tac-toe': `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  'ball-run': `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  'dots-boxes': `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  boggle: `<svg viewBox="0 0 160 90" aria-hidden="true">
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
  snake: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#c9dd9a"/>
            <rect x="4" y="4" width="152" height="82" rx="6" fill="none" stroke="#28340f" stroke-width="4"/>
            <g fill="#28340f">
              <rect x="18" y="60" width="11" height="11" rx="1.5"/><rect x="31" y="60" width="11" height="11" rx="1.5"/>
              <rect x="44" y="60" width="11" height="11" rx="1.5"/><rect x="44" y="47" width="11" height="11" rx="1.5"/>
              <rect x="44" y="34" width="11" height="11" rx="1.5"/><rect x="57" y="34" width="11" height="11" rx="1.5"/>
              <rect x="70" y="34" width="11" height="11" rx="1.5"/><rect x="83" y="34" width="11" height="11" rx="1.5"/>
              <rect x="83" y="21" width="11" height="11" rx="1.5"/><rect x="96" y="21" width="11" height="11" rx="1.5"/>
              <rect x="109" y="21" width="11" height="11" rx="1.5"/>
            </g>
            <rect x="112" y="24" width="5" height="5" fill="#c9dd9a"/>
            <circle cx="136" cy="27" r="7" fill="none" stroke="#28340f" stroke-width="3.5"/>
          </svg>`,


  uno: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#2b2b33"/>
            <g transform="translate(80 52)">
              <g transform="rotate(-22)">
                <rect x="-19" y="-30" width="38" height="54" rx="6" fill="#E0532F" stroke="#1c1c22" stroke-width="1.5"/>
                <rect x="-15.5" y="-25.5" width="9" height="9" rx="1.5" fill="#fff"/>
              </g>
              <g transform="rotate(-7)">
                <rect x="-19" y="-30" width="38" height="54" rx="6" fill="#F2B705" stroke="#1c1c22" stroke-width="1.5"/>
                <circle cx="-11" cy="-21" r="4.6" fill="#fff"/>
              </g>
              <g transform="rotate(8)">
                <rect x="-19" y="-30" width="38" height="54" rx="6" fill="#178A7A" stroke="#1c1c22" stroke-width="1.5"/>
                <rect x="-15" y="-25" width="8" height="8" fill="#fff" transform="rotate(45 -11 -21)"/>
              </g>
              <g transform="rotate(23)">
                <rect x="-19" y="-30" width="38" height="54" rx="6" fill="#1F5FA8" stroke="#1c1c22" stroke-width="1.5"/>
                <path d="M-11,-27 L-6,-18 L-16,-18 Z" fill="#fff"/>
              </g>
            </g>
          </svg>`,
  // Repainted 2026-08-10 to match the game it opens. It used to be a pale blue table in a dark red
  // frame with numbered yellow/blue balls -- the old palette, which the game no longer has
  // anywhere. Same colours as pool/js/ui.js's TABLE_ART and BALL_ART, off reference/pool/SPEC.md:
  // salmon surround, brown wood, bright green cushion, deep green cloth, coral and cyan balls.
  pool: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#F2A183"/>
            <rect x="4" y="6" width="152" height="78" rx="9" fill="#0B0B0B"/>
            <rect x="6" y="8" width="148" height="74" rx="8" fill="#8C5A3F"/>
            <rect x="13" y="15" width="134" height="60" rx="6" fill="#3FBE63"/>
            <rect x="19" y="21" width="122" height="48" rx="4" fill="#0F8A3C"/>
            <g fill="#000">
              <circle cx="21" cy="23" r="8"/><circle cx="139" cy="23" r="8"/>
              <circle cx="21" cy="67" r="8"/><circle cx="139" cy="67" r="8"/>
              <circle cx="80" cy="21" r="7"/><circle cx="80" cy="69" r="7"/>
            </g>
            <g stroke="rgba(0,0,0,.3)" stroke-width="1">
              <circle cx="58" cy="52" r="7" fill="#F2604C"/>
              <circle cx="74" cy="38" r="7" fill="#33C6F4"/>
              <circle cx="92" cy="55" r="7" fill="#F2604C"/>
              <circle cx="108" cy="36" r="7" fill="#33C6F4"/>
              <circle cx="80" cy="47" r="7" fill="#101010"/>
              <circle cx="40" cy="36" r="7" fill="#F7EFCB"/>
            </g>
            <g fill="rgba(255,255,255,.55)">
              <circle cx="55.5" cy="49.5" r="2.1"/><circle cx="71.5" cy="35.5" r="2.1"/>
              <circle cx="89.5" cy="52.5" r="2.1"/><circle cx="105.5" cy="33.5" r="2.1"/>
              <circle cx="37.5" cy="33.5" r="2.1"/>
            </g>
            <text x="80" y="47" font-size="7" font-weight="bold" fill="#fff"
                  text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif">8</text>
          </svg>`,
  yahtzee: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#0878CE"/>
            <g transform="translate(38 52) rotate(-10)">
              <rect x="-19" y="-19" width="38" height="38" rx="8" fill="#fff" stroke="#B9B2A4" stroke-width="1.5"/>
              <circle cx="-9" cy="-9" r="3.2" fill="#15181C"/>
              <circle cx="9" cy="-9" r="3.2" fill="#15181C"/>
              <circle cx="0" cy="0" r="3.2" fill="#15181C"/>
              <circle cx="-9" cy="9" r="3.2" fill="#15181C"/>
              <circle cx="9" cy="9" r="3.2" fill="#15181C"/>
            </g>
            <g transform="translate(100 34) rotate(12)">
              <rect x="-16" y="-16" width="32" height="32" rx="7" fill="#fff" stroke="#B9B2A4" stroke-width="1.5"/>
              <circle cx="-7.5" cy="-7.5" r="2.9" fill="#15181C"/>
              <circle cx="0" cy="0" r="2.9" fill="#15181C"/>
              <circle cx="7.5" cy="7.5" r="2.9" fill="#15181C"/>
            </g>
            <g transform="translate(128 63) rotate(-6)">
              <rect x="-15" y="-15" width="30" height="30" rx="7" fill="url(#yzTileIcon)" stroke="#9E1515" stroke-width="1.5"/>
              <circle cx="0" cy="0" r="3.4" fill="#fff"/>
            </g>
            <defs>
              <linearGradient id="yzTileIcon" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#FE4B4B"/>
                <stop offset="1" stop-color="#CB2222"/>
              </linearGradient>
            </defs>
          </svg>`,
  // Composed for the 16:9 frame, nothing cropped: a real chain reads as a WIDE run, so the
  // landscape tile finally shows the shape the game actually makes. A crosswise double-six
  // spinner sits in the middle with the run passing through it and one branch growing off it,
  // which is the one bit of dominoes geometry a still image can teach. The branch grows UPWARD
  // on purpose - hung below, it sat under the tile's own bottom-left title label.
  dominoes: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#E88A6B"/>
            <ellipse cx="80" cy="44" rx="78" ry="44" fill="#F5A183"/>
            <g fill="#F7EDD3" stroke="#141414" stroke-width="3" stroke-linejoin="round">
              <g transform="translate(8 42)"><rect width="34" height="18" rx="4"/><line x1="17" y1="0" x2="17" y2="18"/></g>
              <g transform="translate(44 42)"><rect width="34" height="18" rx="4"/><line x1="17" y1="0" x2="17" y2="18"/></g>
              <g transform="translate(80 33)"><rect width="18" height="36" rx="4"/><line x1="0" y1="18" x2="18" y2="18"/></g>
              <g transform="translate(100 42)"><rect width="34" height="18" rx="4"/><line x1="17" y1="0" x2="17" y2="18"/></g>
              <g transform="translate(80 5)"><rect width="18" height="26" rx="4"/><line x1="0" y1="13" x2="18" y2="13"/></g>
            </g>
            <g fill="#141414">
              <circle cx="17" cy="51" r="2.6"/>
              <circle cx="30" cy="46.5" r="2.4"/><circle cx="36" cy="55.5" r="2.4"/>
              <circle cx="53" cy="46.5" r="2.4"/><circle cx="53" cy="55.5" r="2.4"/><circle cx="59" cy="51" r="2.4"/>
              <circle cx="66" cy="46" r="2.2"/><circle cx="72" cy="46" r="2.2"/><circle cx="66" cy="51" r="2.2"/>
              <circle cx="72" cy="51" r="2.2"/><circle cx="66" cy="56" r="2.2"/><circle cx="72" cy="56" r="2.2"/>
              <circle cx="85" cy="37" r="2.2"/><circle cx="93" cy="37" r="2.2"/><circle cx="85" cy="42" r="2.2"/>
              <circle cx="93" cy="42" r="2.2"/><circle cx="85" cy="47" r="2.2"/><circle cx="93" cy="47" r="2.2"/>
              <circle cx="85" cy="55" r="2.2"/><circle cx="93" cy="55" r="2.2"/><circle cx="85" cy="60" r="2.2"/>
              <circle cx="93" cy="60" r="2.2"/><circle cx="85" cy="65" r="2.2"/><circle cx="93" cy="65" r="2.2"/>
              <circle cx="109" cy="46.5" r="2.4"/><circle cx="109" cy="55.5" r="2.4"/>
              <circle cx="115" cy="51" r="2.4"/>
              <circle cx="123" cy="46.5" r="2.4"/><circle cx="129" cy="55.5" r="2.4"/>
              <circle cx="85" cy="11" r="2.2"/><circle cx="93" cy="11" r="2.2"/><circle cx="89" cy="15" r="2.2"/>
              <circle cx="89" cy="24" r="2.4"/>
            </g>
          </svg>`,

  // Hill Climb: the game's own scene, composed for the 16:9 frame (never a square crop). Flat
  // sky, a dirt cross-section with its bright grass cap, and the red jeep sitting ON the ramp
  // rather than near it - the car's transform is derived from the ramp segment it stands on
  // (46,70)->(110,38), i.e. rotate(-26.6) about a point one wheel-radius up the surface normal -
  // so the wheels touch the grass exactly. Same flat-cartoon ink (#231f1c) the live game draws
  // with, so the tile and the gameplay read as one thing.
  // Pinball: the one composition a 16:9 frame suits better than the real table does. A pinball
  // playfield is tall and narrow, so rather than squash it, this is a CLOSE-UP of the part that
  // reads instantly at tile size: the arch, the bumper nest, the ramp, and the two flippers with a
  // chrome ball between them. Neon on black, matching the game's own palette exactly.
  pinball: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#0c0630"/>
            <ellipse cx="80" cy="26" rx="74" ry="40" fill="#3d1a95" opacity="0.55"/>
            <ellipse cx="80" cy="86" rx="60" ry="26" fill="#ff4fd8" opacity="0.12"/>
            <g fill="#ffffff">
              <circle cx="14" cy="12" r="0.9" opacity="0.8"/><circle cx="38" cy="7" r="0.7" opacity="0.6"/>
              <circle cx="66" cy="14" r="0.6" opacity="0.5"/><circle cx="104" cy="9" r="0.9" opacity="0.75"/>
              <circle cx="132" cy="18" r="0.7" opacity="0.6"/><circle cx="150" cy="8" r="0.6" opacity="0.5"/>
              <circle cx="24" cy="36" r="0.6" opacity="0.45"/><circle cx="144" cy="44" r="0.6" opacity="0.45"/>
            </g>
            <path d="M6 58 A76 46 0 0 1 154 58" fill="none" stroke="#3ee8ff" stroke-width="1.6" opacity="0.35"/>
            <path d="M2 62 A82 52 0 0 1 158 62" fill="none" stroke="#98a6c6" stroke-width="2.6"/>
            <g stroke="#0a0718" stroke-width="1.6">
              <circle cx="42" cy="34" r="8" fill="#1d6fa8"/><circle cx="42" cy="34" r="4" fill="#f3f7ff"/>
              <circle cx="80" cy="24" r="8" fill="#1d6fa8"/><circle cx="80" cy="24" r="4" fill="#f3f7ff"/>
              <circle cx="118" cy="34" r="8" fill="#1d6fa8"/><circle cx="118" cy="34" r="4" fill="#f3f7ff"/>
            </g>
            <g fill="#ff4fd8"><circle cx="42" cy="34" r="1.7"/><circle cx="80" cy="24" r="1.7"/><circle cx="118" cy="34" r="1.7"/></g>
            <g transform="rotate(37 22 52)" stroke="#0a0718" stroke-width="1.4">
              <rect x="10" y="48" width="13" height="4.6" rx="2" fill="#F2B705"/>
              <rect x="10" y="55" width="13" height="4.6" rx="2" fill="#F2B705"/>
              <rect x="10" y="62" width="13" height="4.6" rx="2" fill="#6b7590"/>
            </g>
            <path d="M96 72 C126 68 138 52 132 36" fill="none" stroke="#0a0718" stroke-width="7" stroke-linecap="round"/>
            <path d="M96 72 C126 68 138 52 132 36" fill="none" stroke="#ff4fd8" stroke-width="3" stroke-linecap="round"/>
            <g stroke-linecap="round">
              <path d="M58 74 L76 84" stroke="#0a0718" stroke-width="10"/>
              <path d="M58 74 L76 84" stroke="#3ee8ff" stroke-width="6.4"/>
              <path d="M110 74 L92 84" stroke="#0a0718" stroke-width="10"/>
              <path d="M110 74 L92 84" stroke="#3ee8ff" stroke-width="6.4"/>
            </g>
            <circle cx="84" cy="60" r="6.4" fill="#0a0718"/>
            <circle cx="84" cy="60" r="5.4" fill="#dfe7f5"/>
            <circle cx="82" cy="58" r="1.9" fill="#ffffff"/>
            <path d="M79.5 63.5 A5.4 5.4 0 0 0 88 61" fill="none" stroke="#3ee8ff" stroke-width="1.2"/>
          </svg>`,

  'hill-climb': `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#8fd3f0"/>
            <path d="M0 58 L34 44 L66 54 L104 34 L136 44 L160 36 L160 90 L0 90 Z" fill="#6fa8c9" opacity="0.55"/>
            <path d="M0 90 L0 70 L46 70 L110 38 L160 44 L160 90 Z" fill="#8d5a34"/>
            <g fill="#754828" opacity="0.5">
              <ellipse cx="16" cy="80" rx="6.5" ry="4.2"/><ellipse cx="44" cy="84" rx="5.5" ry="3.6"/>
              <ellipse cx="74" cy="76" rx="6" ry="4"/><ellipse cx="104" cy="66" rx="6.5" ry="4.2"/>
              <ellipse cx="134" cy="76" rx="6" ry="4"/>
            </g>
            <path d="M0 70 L46 70 L110 38 L160 44" fill="none" stroke="#4caf3d"
                  stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
            <g fill="#e0a007" stroke="#231f1c" stroke-width="1.8">
              <circle cx="118" cy="17" r="5.6"/><circle cx="133" cy="12" r="5.6"/><circle cx="148" cy="16" r="5.6"/>
            </g>
            <g transform="translate(73 44) rotate(-26.6)">
              <path d="M-18 4 L-19 -4 L-7 -4 L-6 -12 L5 -12 L7 -4 L18 -5 L19 3 Z"
                    fill="#d8382b" stroke="#231f1c" stroke-width="2.6" stroke-linejoin="round"/>
              <path d="M8 -4 L18 -5 L18.6 0 L8.6 0 Z" fill="#9a1f16" stroke="#231f1c" stroke-width="1.6"/>
              <rect x="-10" y="-15" width="3.4" height="11" fill="#7b1a12" stroke="#231f1c" stroke-width="1.6"/>
              <rect x="-6.5" y="-18" width="7" height="10" rx="2.4" fill="#E0532F" stroke="#231f1c" stroke-width="1.8"/>
              <circle cx="-3" cy="-21" r="4.2" fill="#f0c08a" stroke="#231f1c" stroke-width="1.8"/>
              <path d="M-7.4 -23 Q-3 -29 1.4 -23 Z" fill="#c1301f" stroke="#231f1c" stroke-width="1.6"/>
              <path d="M-16 -4 Q-21 -14 -19 -24" fill="none" stroke="#231f1c" stroke-width="1.6" stroke-linecap="round"/>
              <circle cx="-19" cy="-25" r="2.2" fill="#E0532F"/>
              <circle cx="-12" cy="4" r="7.2" fill="#2b2b30" stroke="#231f1c" stroke-width="2.6"/>
              <circle cx="-12" cy="4" r="3" fill="#e8e2d6"/>
              <circle cx="12" cy="4" r="7.2" fill="#2b2b30" stroke="#231f1c" stroke-width="2.6"/>
              <circle cx="12" cy="4" r="3" fill="#e8e2d6"/>
            </g>
          </svg>`,

  // Battleship: composed for the 16:9 frame (never a square crop). A peg grid (the hunting board)
  // fills the left third with one vermilion hit peg and a splash ring reinforcing it; a ship
  // silhouette in profile, bow to the right, sits on the right two-thirds riding a steel-navy sea
  // band that matches the hub tile's own accent (#34506E).
  battleship: `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#0E2438"/>
            <rect x="0" y="58" width="160" height="32" fill="#1B3B57"/>
            <g stroke="#3E5E7A" stroke-width="1.4" opacity="0.7">
              <line x1="8" y1="10" x2="8" y2="70"/><line x1="24" y1="10" x2="24" y2="70"/>
              <line x1="40" y1="10" x2="40" y2="70"/><line x1="56" y1="10" x2="56" y2="70"/>
              <line x1="0" y1="18" x2="64" y2="18"/><line x1="0" y1="34" x2="64" y2="34"/>
              <line x1="0" y1="50" x2="64" y2="50"/><line x1="0" y1="66" x2="64" y2="66"/>
            </g>
            <circle cx="40" cy="34" r="10" fill="none" stroke="#E0532F" stroke-width="2.4" opacity="0.55"/>
            <circle cx="40" cy="34" r="5.2" fill="#E0532F"/>
            <g fill="#B9C6D3" stroke="#0E2438" stroke-width="1.6">
              <circle cx="8" cy="18" r="2.6"/><circle cx="24" cy="50" r="2.6"/><circle cx="56" cy="34" r="2.6"/>
              <circle cx="8" cy="66" r="2.6"/><circle cx="40" cy="66" r="2.6"/>
            </g>
            <g transform="translate(84 30)">
              <path d="M0 30 L4 42 L92 42 L96 30 L80 30 L72 14 L20 14 L12 30 Z" fill="#5C7185" stroke="#1c2733" stroke-width="2"/>
              <rect x="34" y="0" width="20" height="16" rx="2" fill="#3E5266" stroke="#1c2733" stroke-width="2"/>
              <rect x="40" y="-8" width="4" height="10" fill="#2b3a48"/>
              <rect x="12" y="20" width="10" height="10" fill="#3E5266" stroke="#1c2733" stroke-width="1.6"/>
              <rect x="66" y="20" width="10" height="10" fill="#3E5266" stroke="#1c2733" stroke-width="1.6"/>
            </g>
            <path d="M84 60 Q120 54 158 60" fill="none" stroke="#7C93A8" stroke-width="2" opacity="0.5"/>
          </svg>`,
  // Skeeball: the player's-eye view - the lane converging up to the tilted ring face, the twin
  // 100 pockets in the corners, a lit marquee, a ball mid-lane. Composed for the 160x90 frame
  // with a full-bleed background, nothing cropped.
  skeeball: `<svg viewBox="0 0 160 90" aria-hidden="true">
             <defs>
               <clipPath id="skb-face"><path d="M59 22 L101 22 L108 56 L52 56 Z"/></clipPath>
               <clipPath id="skb-l"><path d="M-5 23 L30 23 L37 54 L-12 54 Z"/></clipPath>
               <clipPath id="skb-r"><path d="M130 23 L165 23 L172 54 L123 54 Z"/></clipPath>
             </defs>
             <rect width="160" height="90" fill="#140d0a"/>
             <g opacity="0.32">
               <rect x="-8" y="7" width="41" height="6" rx="2" fill="#3a2416"/>
               <rect x="-6" y="13" width="37" height="10" fill="#241610"/>
               <path d="M-5 23 L30 23 L37 54 L-12 54 Z" fill="#7a4520"/>
               <g clip-path="url(#skb-l)" opacity="0.75">
                 <path d="M-10.02 40.35 A 22.52 11.79 0 0 0 35.02 40.35" fill="none" stroke="#f7f2e8" stroke-width="3.26"/>
                 <path d="M-10.02 38.72 A 22.52 11.79 0 0 0 35.02 38.72" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="12.5" cy="39.19" rx="15.32" ry="8.12" fill="none" stroke="#f7f2e8" stroke-width="3.26"/>
                 <ellipse cx="12.5" cy="37.56" rx="15.32" ry="8.12" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="-1.92" cy="25.35" rx="3.06" ry="1.9" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="26.92" cy="25.35" rx="3.06" ry="1.9" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="12.5" cy="28.03" rx="4.18" ry="2.51" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="12.5" cy="33.59" rx="4.82" ry="2.72" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="12.5" cy="39.77" rx="5.93" ry="3.13" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
               </g>
               <path d="M-12 54 L37 54 L47 90 L-24 90 Z" fill="#5e3d1f"/>
               <rect x="127" y="7" width="41" height="6" rx="2" fill="#3a2416"/>
               <rect x="129" y="13" width="37" height="10" fill="#241610"/>
               <path d="M130 23 L165 23 L172 54 L123 54 Z" fill="#7a4520"/>
               <g clip-path="url(#skb-r)" opacity="0.75">
                 <path d="M124.98 40.35 A 22.52 11.79 0 0 0 170.02 40.35" fill="none" stroke="#f7f2e8" stroke-width="3.26"/>
                 <path d="M124.98 38.72 A 22.52 11.79 0 0 0 170.02 38.72" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="147.5" cy="39.19" rx="15.32" ry="8.12" fill="none" stroke="#f7f2e8" stroke-width="3.26"/>
                 <ellipse cx="147.5" cy="37.56" rx="15.32" ry="8.12" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="133.08" cy="25.35" rx="3.06" ry="1.9" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="161.92" cy="25.35" rx="3.06" ry="1.9" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="147.5" cy="28.03" rx="4.18" ry="2.51" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="147.5" cy="33.59" rx="4.82" ry="2.72" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
                 <ellipse cx="147.5" cy="39.77" rx="5.93" ry="3.13" fill="none" stroke="#f7f2e8" stroke-width="2.61"/>
               </g>
               <path d="M123 54 L172 54 L184 90 L113 90 Z" fill="#5e3d1f"/>
             </g>
             <rect x="54" y="3" width="52" height="8" rx="2" fill="#28150b" stroke="#6b4526" stroke-width="1"/>
             <g fill="#ffd977">
               <circle cx="61" cy="7" r="1"/><circle cx="70" cy="7" r="1"/><circle cx="80" cy="7" r="1"/>
               <circle cx="90" cy="7" r="1"/><circle cx="99" cy="7" r="1"/>
             </g>
             <rect x="56" y="11" width="48" height="11" fill="#2a1c14" stroke="#54301a" stroke-width="0.8"/>
             <g opacity="0.55">
               <path d="M80 13 L80 21 M58 17 L102 17" stroke="#54301a" stroke-width="0.6"/>
               <g fill="#ffd977">
                 <rect x="66" y="14.4" width="5" height="1.2"/><rect x="89" y="14.4" width="5" height="1.2"/>
                 <rect x="66" y="18.6" width="5" height="1.2"/><rect x="89" y="18.6" width="5" height="1.2"/>
               </g>
             </g>
             <path d="M59 22 L101 22 L108 56 L52 56 Z" fill="#c96f2e" stroke="#8f4c1d" stroke-width="1"/>
             <g clip-path="url(#skb-face)">
                 <path d="M53.8 41.02 A 26.2 12.93 0 0 0 106.2 41.02" fill="none" stroke="#f7f2e8" stroke-width="3.58"/>
                 <path d="M53.8 39.23 A 26.2 12.93 0 0 0 106.2 39.23" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="80" cy="39.76" rx="17.85" ry="8.91" fill="none" stroke="#f7f2e8" stroke-width="3.58"/>
                 <ellipse cx="80" cy="37.97" rx="17.85" ry="8.91" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="62.78" cy="27.86" rx="3.65" ry="2.09" fill="#ded7ca"/>
                 <rect x="59.13" y="24.57" width="7.3" height="3.29" fill="#efe9dd"/>
                 <ellipse cx="62.78" cy="24.57" rx="3.65" ry="2.09" fill="#f7f2e8" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="62.78" cy="24.57" rx="2.12" ry="1.21" fill="#1a120c"/>
                 <ellipse cx="97.22" cy="27.86" rx="3.65" ry="2.09" fill="#ded7ca"/>
                 <rect x="93.57" y="24.57" width="7.3" height="3.29" fill="#efe9dd"/>
                 <ellipse cx="97.22" cy="24.57" rx="3.65" ry="2.09" fill="#f7f2e8" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="97.22" cy="24.57" rx="2.12" ry="1.21" fill="#1a120c"/>
                 <ellipse cx="80" cy="30.8" rx="4.96" ry="2.76" fill="#ded7ca"/>
                 <rect x="75.04" y="27.51" width="9.92" height="3.29" fill="#efe9dd"/>
                 <ellipse cx="80" cy="27.51" rx="4.96" ry="2.76" fill="#f7f2e8" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="80" cy="27.51" rx="2.88" ry="1.6" fill="#1a120c"/>
                 <ellipse cx="80" cy="36.91" rx="5.67" ry="2.98" fill="#ded7ca"/>
                 <rect x="74.33" y="33.62" width="11.34" height="3.29" fill="#efe9dd"/>
                 <ellipse cx="80" cy="33.62" rx="5.67" ry="2.98" fill="#f7f2e8" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="80" cy="33.62" rx="3.29" ry="1.73" fill="#1a120c"/>
                 <ellipse cx="80" cy="43.69" rx="6.91" ry="3.43" fill="#ded7ca"/>
                 <rect x="73.09" y="40.4" width="13.82" height="3.29" fill="#efe9dd"/>
                 <ellipse cx="80" cy="40.4" rx="6.91" ry="3.43" fill="#f7f2e8" stroke="#2b5ea7" stroke-width="0.6"/>
                 <ellipse cx="80" cy="40.4" rx="4.01" ry="1.99" fill="#1a120c"/>
             </g>
             <path d="M52 56 L108 56 L114 90 L46 90 Z" fill="#a86f38"/>
             <path d="M52 56 L46 90 L39 90 L47 56 Z" fill="#54301a"/>
             <path d="M108 56 L114 90 L121 90 L113 56 Z" fill="#54301a"/>
             <path d="M54 57 L106 57 L107 60 L53 60 Z" fill="#c98a49"/>
             <circle cx="80" cy="76" r="5.2" fill="#f6ecda"/>
             <circle cx="78.3" cy="74.3" r="1.7" fill="#fffdf5"/>
           </svg>`,
  // The hub tile (2026-09-12). Matt's brief, in order: on the ORIGINAL tile "the tee box is
  // covered by the name of the game" and "the green barely fits and is covered by the heart" -
  // a tile has two permanent occupants and art has to be composed around them (measured in
  // viewBox units at the real 174px phone tile: the "Golf" label owns x 8-53 / y 66-86, the
  // favorite heart x 118-158 / y 2-42). Then, on three of my own flat sketches: "see how much
  // better this looks?" against a reference illustration he supplied. This is that reference,
  // rebuilt as vector: layered sky and clouds, a tree line with a taller stand at each edge,
  // distant hills, a cart path curving in from the left, the green with pin, hole and two
  // bunkers, a pond with an earth bank, lily pads and cattails, tall grass in the corners, and
  // a ball on a tee. ~38 KB, sharp at any size. The lesson, for whoever draws the next tile:
  // the other tiles in this file are ~7 flat shapes, and that is NOT the standard to aim at.
  golf: `<svg viewBox="0 0 160 90" aria-hidden="true">
         <defs><linearGradient id="golfTileSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C3DCF2"/><stop offset="1" stop-color="#D6E9F8"/></linearGradient></defs>
         <rect width="160" height="90" fill="url(#golfTileSky)"/>
         <g fill="#FFFFFF"><ellipse cx="16.94" cy="12.15" rx="5.06" ry="1.426"/><ellipse cx="19.93" cy="10.54" rx="4.025" ry="2.3"/><ellipse cx="23.15" cy="9.85" rx="3.45" ry="2.875"/><ellipse cx="26.6" cy="11.23" rx="3.45" ry="1.955"/><ellipse cx="29.59" cy="12.15" rx="3.45" ry="1.15"/><rect x="14.18" y="11.69" width="17.02" height="2.07" rx="1.035"/></g>
         <g fill="#FFFFFF"><ellipse cx="71.7" cy="13.75" rx="3.3" ry="0.93"/><ellipse cx="73.65" cy="12.7" rx="2.625" ry="1.5"/><ellipse cx="75.75" cy="12.25" rx="2.25" ry="1.875"/><ellipse cx="78" cy="13.15" rx="2.25" ry="1.275"/><ellipse cx="79.95" cy="13.75" rx="2.25" ry="0.75"/><rect x="69.9" y="13.45" width="11.1" height="1.35" rx="0.675"/></g>
         <g fill="#FFFFFF"><ellipse cx="103.6" cy="11" rx="4.4" ry="1.24"/><ellipse cx="106.2" cy="9.6" rx="3.5" ry="2"/><ellipse cx="109" cy="9" rx="3" ry="2.5"/><ellipse cx="112" cy="10.2" rx="3" ry="1.7"/><ellipse cx="114.6" cy="11" rx="3" ry="1"/><rect x="101.2" y="10.6" width="14.8" height="1.8" rx="0.9"/></g>
         <g fill="#FFFFFF"><ellipse cx="136.26" cy="12.85" rx="3.74" ry="1.054"/><ellipse cx="138.47" cy="11.66" rx="2.975" ry="1.7"/><ellipse cx="140.85" cy="11.15" rx="2.55" ry="2.125"/><ellipse cx="143.4" cy="12.17" rx="2.55" ry="1.445"/><ellipse cx="145.61" cy="12.85" rx="2.55" ry="0.85"/><rect x="134.22" y="12.51" width="12.58" height="1.53" rx="0.765"/></g>
         <g fill="#DCEAF6"><ellipse cx="58.7" cy="24.75" rx="3.3" ry="0.93"/><ellipse cx="60.65" cy="23.7" rx="2.625" ry="1.5"/><ellipse cx="62.75" cy="23.25" rx="2.25" ry="1.875"/><ellipse cx="65" cy="24.15" rx="2.25" ry="1.275"/><ellipse cx="66.95" cy="24.75" rx="2.25" ry="0.75"/><rect x="56.9" y="24.45" width="11.1" height="1.35" rx="0.675"/></g>
         <g fill="#DCEAF6"><ellipse cx="113.82" cy="25.95" rx="4.18" ry="1.178"/><ellipse cx="116.29" cy="24.62" rx="3.325" ry="1.9"/><ellipse cx="118.95" cy="24.05" rx="2.85" ry="2.375"/><ellipse cx="121.8" cy="25.19" rx="2.85" ry="1.615"/><ellipse cx="124.27" cy="25.95" rx="2.85" ry="0.95"/><rect x="111.54" y="25.57" width="14.06" height="1.71" rx="0.855"/></g>
         <g fill="#DCEAF6"><ellipse cx="27.36" cy="26.6" rx="2.64" ry="0.744"/><ellipse cx="28.92" cy="25.76" rx="2.1" ry="1.2"/><ellipse cx="30.6" cy="25.4" rx="1.8" ry="1.5"/><ellipse cx="32.4" cy="26.12" rx="1.8" ry="1.02"/><ellipse cx="33.96" cy="26.6" rx="1.8" ry="0.6"/><rect x="25.92" y="26.36" width="8.88" height="1.08" rx="0.54"/></g>
         <path d="M84 34 C 94 27, 104 30, 112 33 C 120 28, 132 30, 140 34 L140 40 L84 40 Z" fill="#93A96F"/>
         <path d="M96 36 C 104 30.5, 116 32, 124 35.5 C 130 32, 138 33.5, 144 36.5 L144 41 L96 41 Z" fill="#7E9A63"/>
         <rect y="34" width="160" height="8" fill="#4A7A52"/>
         <g fill="#3C6A45"><circle cx="-2" cy="35.1195" r="5.03326"/><circle cx="-6.27827" cy="37.1329" r="3.77495"/><circle cx="2.52994" cy="36.8812" r="3.52328"/><circle cx="-1.49667" cy="32.3512" r="3.01996"/></g>
         <g fill="#3C6A45"><circle cx="3.89695" cy="35.1748" r="3.40625"/><circle cx="1.00164" cy="36.5373" r="2.55469"/><circle cx="6.96258" cy="36.367" r="2.38438"/><circle cx="4.23758" cy="33.3013" r="2.04375"/></g>
         <g fill="#3C6A45"><circle cx="9.93268" cy="35.586" r="3.20707"/><circle cx="7.20667" cy="36.8688" r="2.4053"/><circle cx="12.819" cy="36.7084" r="2.24495"/><circle cx="10.2534" cy="33.8221" r="1.92424"/></g>
         <path d="M15.3429 30.6949 L12.1494 38 L18.5363 38 Z" fill="#3C6A45"/><path d="M15.3429 26.7614 L12.9797 34.0665 L17.706 34.0665 Z" fill="#3C6A45"/><path d="M15.3429 22.8279 L13.81 30.133 L16.8757 30.133 Z" fill="#3C6A45"/>
         <g fill="#4A7A52"><circle cx="19.9685" cy="35.9295" r="4.43863"/><circle cx="16.1957" cy="37.705" r="3.32897"/><circle cx="23.9633" cy="37.483" r="3.10704"/><circle cx="20.4124" cy="33.4883" r="2.66318"/></g>
         <path d="M26.3152 32.761 L23.2868 38 L29.3436 38 Z" fill="#3C6A45"/><path d="M26.3152 29.94 L24.0742 35.179 L28.5562 35.179 Z" fill="#3C6A45"/><path d="M26.3152 27.119 L24.8616 32.358 L27.7688 32.358 Z" fill="#3C6A45"/>
         <path d="M30.9939 32.1709 L28.4638 38 L33.5239 38 Z" fill="#3C6A45"/><path d="M30.9939 29.0322 L29.1216 34.8613 L32.8661 34.8613 Z" fill="#3C6A45"/><path d="M30.9939 25.8935 L29.7794 31.7226 L32.2083 31.7226 Z" fill="#3C6A45"/>
         <g fill="#3C6A45"><circle cx="36.8857" cy="35.6849" r="4.14207"/><circle cx="33.3649" cy="37.3417" r="3.10655"/><circle cx="40.6135" cy="37.1346" r="2.89945"/><circle cx="37.2999" cy="33.4067" r="2.48524"/></g>
         <g fill="#3C6A45"><circle cx="43.3065" cy="35.3249" r="4.00613"/><circle cx="39.9013" cy="36.9273" r="3.00459"/><circle cx="46.9121" cy="36.727" r="2.80429"/><circle cx="43.7072" cy="33.1215" r="2.40368"/></g>
         <g fill="#4A7A52"><circle cx="48.641" cy="35.9914" r="4.84847"/><circle cx="44.5198" cy="37.9308" r="3.63636"/><circle cx="53.0047" cy="37.6883" r="3.39393"/><circle cx="49.1259" cy="33.3247" r="2.90908"/></g>
         <g fill="#3C6A45"><circle cx="55.2645" cy="34.4593" r="3.63589"/><circle cx="52.174" cy="35.9137" r="2.72692"/><circle cx="58.5368" cy="35.7319" r="2.54512"/><circle cx="55.628" cy="32.4596" r="2.18153"/></g>
         <g fill="#4A7A52"><circle cx="59.9751" cy="34.8008" r="4.86248"/><circle cx="55.842" cy="36.7458" r="3.64686"/><circle cx="64.3514" cy="36.5027" r="3.40374"/><circle cx="60.4614" cy="32.1264" r="2.91749"/></g>
         <g fill="#4A7A52"><circle cx="65.6347" cy="35.6946" r="3.0012"/><circle cx="63.0837" cy="36.8951" r="2.2509"/><circle cx="68.3357" cy="36.745" r="2.10084"/><circle cx="65.9348" cy="34.044" r="1.80072"/></g>
         <g fill="#4A7A52"><circle cx="70.7638" cy="34.94" r="5.15679"/><circle cx="66.3806" cy="37.0027" r="3.86759"/><circle cx="75.4049" cy="36.7449" r="3.60975"/><circle cx="71.2795" cy="32.1037" r="3.09407"/></g>
         <path d="M76.4561 31.1634 L73.1776 38 L79.7346 38 Z" fill="#3C6A45"/><path d="M76.4561 27.4822 L74.03 34.3188 L78.8822 34.3188 Z" fill="#3C6A45"/><path d="M76.4561 23.8009 L74.8824 30.6375 L78.0298 30.6375 Z" fill="#3C6A45"/>
         <path d="M81.7654 31.9353 L78.3013 38 L85.2295 38 Z" fill="#3C6A45"/><path d="M81.7654 28.6697 L79.202 34.7344 L84.3288 34.7344 Z" fill="#3C6A45"/><path d="M81.7654 25.404 L80.1027 31.4688 L83.4282 31.4688 Z" fill="#3C6A45"/>
         <path d="M88.5395 32.1594 L85.9385 38 L91.1406 38 Z" fill="#3C6A45"/><path d="M88.5395 29.0144 L86.6148 34.8551 L90.4643 34.8551 Z" fill="#3C6A45"/><path d="M88.5395 25.8695 L87.291 31.7101 L89.788 31.7101 Z" fill="#3C6A45"/>
         <g fill="#4A7A52"><circle cx="93.2192" cy="34.3554" r="4.23045"/><circle cx="89.6233" cy="36.0475" r="3.17284"/><circle cx="97.0266" cy="35.836" r="2.96131"/><circle cx="93.6423" cy="32.0286" r="2.53827"/></g>
         <path d="M99.0615 30.8971 L96.4305 38 L101.692 38 Z" fill="#3C6A45"/><path d="M99.0615 27.0724 L97.1146 34.1753 L101.008 34.1753 Z" fill="#3C6A45"/><path d="M99.0615 23.2478 L97.7986 30.3507 L100.324 30.3507 Z" fill="#3C6A45"/>
         <path d="M105.493 31.706 L102.78 38 L108.206 38 Z" fill="#3C6A45"/><path d="M105.493 28.317 L103.485 34.6109 L107.5 34.6109 Z" fill="#3C6A45"/><path d="M105.493 24.9279 L104.19 31.2219 L106.795 31.2219 Z" fill="#3C6A45"/>
         <g fill="#4A7A52"><circle cx="110.802" cy="35.6068" r="3.66912"/><circle cx="107.683" cy="37.0745" r="2.75184"/><circle cx="114.104" cy="36.891" r="2.56838"/><circle cx="111.169" cy="33.5888" r="2.20147"/></g>
         <path d="M117.957 31.7749 L114.602 38 L121.311 38 Z" fill="#3C6A45"/><path d="M117.957 28.4229 L115.474 34.648 L120.439 34.648 Z" fill="#3C6A45"/><path d="M117.957 25.0709 L116.347 31.296 L119.567 31.296 Z" fill="#3C6A45"/>
         <path d="M124.382 30.2278 L121.669 38 L127.095 38 Z" fill="#3C6A45"/><path d="M124.382 26.0428 L122.374 33.815 L126.39 33.815 Z" fill="#3C6A45"/><path d="M124.382 21.8578 L123.08 29.63 L125.684 29.63 Z" fill="#3C6A45"/>
         <g fill="#4A7A52"><circle cx="129.657" cy="34.6579" r="3.65191"/><circle cx="126.553" cy="36.1187" r="2.73894"/><circle cx="132.944" cy="35.9361" r="2.55634"/><circle cx="130.022" cy="32.6494" r="2.19115"/></g>
         <path d="M134.377 31.2849 L131.634 38 L137.12 38 Z" fill="#3C6A45"/><path d="M134.377 27.6691 L132.347 34.3842 L136.407 34.3842 Z" fill="#3C6A45"/><path d="M134.377 24.0532 L133.061 30.7683 L135.694 30.7683 Z" fill="#3C6A45"/>
         <g fill="#3C6A45"><circle cx="140.681" cy="34.9064" r="5.1101"/><circle cx="136.337" cy="36.9505" r="3.83257"/><circle cx="145.28" cy="36.6949" r="3.57707"/><circle cx="141.192" cy="32.0959" r="3.06606"/></g>
         <g fill="#3C6A45"><circle cx="146.632" cy="35.7331" r="3.40222"/><circle cx="143.74" cy="37.0939" r="2.55167"/><circle cx="149.694" cy="36.9238" r="2.38155"/><circle cx="146.972" cy="33.8618" r="2.04133"/></g>
         <g fill="#4A7A52"><circle cx="151.595" cy="35.6356" r="3.5489"/><circle cx="148.578" cy="37.0552" r="2.66167"/><circle cx="154.789" cy="36.8777" r="2.48423"/><circle cx="151.949" cy="33.6837" r="2.12934"/></g>
         <g fill="#4A7A52"><circle cx="156.664" cy="35.8808" r="3.4325"/><circle cx="153.746" cy="37.2538" r="2.57437"/><circle cx="159.753" cy="37.0822" r="2.40275"/><circle cx="157.007" cy="33.9929" r="2.0595"/></g>
         <rect x="12.4" y="28" width="1.6" height="11" fill="#4A3A28"/>
         <path d="M4 29.16 L0.5 38 L7.5 38 Z" fill="#2F5A38"/><path d="M4 24.4 L1.41 33.24 L6.59 33.24 Z" fill="#2F5A38"/><path d="M4 19.64 L2.32 28.48 L5.68 28.48 Z" fill="#2F5A38"/>
         <g fill="#2F5A38"><circle cx="12.8" cy="26" r="5.8"/><circle cx="7.87" cy="28.32" r="4.35"/><circle cx="18.02" cy="28.03" r="4.06"/><circle cx="13.38" cy="22.81" r="3.48"/></g>
         <g fill="#3C6A45"><circle cx="21" cy="29" r="4.6"/><circle cx="17.09" cy="30.84" r="3.45"/><circle cx="25.14" cy="30.61" r="3.22"/><circle cx="21.46" cy="26.47" r="2.76"/></g>
         <rect x="149.4" y="28" width="1.6" height="11" fill="#4A3A28"/>
         <g fill="#2F5A38"><circle cx="150" cy="26" r="6.2"/><circle cx="144.73" cy="28.48" r="4.65"/><circle cx="155.58" cy="28.17" r="4.34"/><circle cx="150.62" cy="22.59" r="3.72"/></g>
         <g fill="#3C6A45"><circle cx="141" cy="30" r="4.4"/><circle cx="137.26" cy="31.76" r="3.3"/><circle cx="144.96" cy="31.54" r="3.08"/><circle cx="141.44" cy="27.58" r="2.64"/></g>
         <path d="M157 30.2 L154 38 L160 38 Z" fill="#2F5A38"/><path d="M157 26 L154.78 33.8 L159.22 33.8 Z" fill="#2F5A38"/><path d="M157 21.8 L155.56 29.6 L158.44 29.6 Z" fill="#2F5A38"/>
         <path d="M0 44 C 24 41, 46 39, 80 38.5 C 112 38, 136 41, 160 43 L160 90 L0 90 Z" fill="#87AC5D"/>
         <path d="M0 52 C 30 47, 58 46, 84 47 C 112 48, 136 51, 160 50 L160 58 C 134 57, 110 54, 84 53.5 C 56 53, 28 55, 0 60 Z" fill="#93B968" opacity="0.5"/>
         <path d="M42 45 C 54 40.5, 68 39.5, 82 39.5 C 98 39.5, 112 41, 122 44.5 C 112 48, 96 49.5, 80 49.5 C 62 49.5, 50 48, 42 45 Z" fill="#93B968" opacity="0.45"/>
         <path d="M-2 66 C 10 60, 16 54, 26 49 C 34 45, 42 43.5, 52 43" stroke="#C9A87A" stroke-width="3.4" fill="none" stroke-linecap="round"/>
         <path d="M-2 66 C 10 60, 16 54, 26 49 C 34 45, 42 43.5, 52 43" stroke="#DBC199" stroke-width="2.2" fill="none" stroke-linecap="round"/>
         <ellipse cx="80" cy="42.5" rx="27" ry="8.6" fill="#6E9A48"/>
         <ellipse cx="80" cy="42.2" rx="25" ry="7.6" fill="#9CC46C"/>
         <path d="M53 45.6 C 55 41.8, 62 41, 66.5 42.4 C 70 43.5, 69 46.4, 64.5 47.4 C 59 48.6, 52 48.2, 53 45.6 Z" fill="#C3B084"/>
         <path d="M53.4 45.2 C 55.4 41.9, 62 41.3, 66 42.6 C 69.2 43.6, 68.3 46.1, 64.2 47 C 59 48.1, 52.6 47.6, 53.4 45.2 Z" fill="#DCCBA2"/>
         <path d="M95 45.4 C 97 41.8, 104 41, 108.5 42.4 C 112 43.5, 111 46.3, 106.5 47.3 C 101 48.5, 94 48, 95 45.4 Z" fill="#C3B084"/>
         <path d="M95.4 45 C 97.4 41.9, 104 41.3, 108 42.6 C 111.2 43.6, 110.3 46, 106.2 46.9 C 101 48, 95 47.4, 95.4 45 Z" fill="#DCCBA2"/>
         <ellipse cx="80" cy="41.6" rx="2.3" ry="1.0" fill="#1A1A1A"/>
         <rect x="79.3" y="20.5" width="1.5" height="21.2" fill="#8A6A45"/>
         <path d="M80.8 21.5 L91.5 25.4 L80.8 29.2 Z" fill="#F2C33C"/>
         <path d="M97.6 60.4 C 105.6 55.6, 124 53.9, 142 54.8 C 153 55.3, 160 56.8, 160 58.2 L160 73.6 C 142 74.4, 118.6 72.2, 105 68 C 97.6 65.6, 95.2 62.6, 97.6 60.4 Z" fill="#A6C8E2"/>
         <path d="M104 64 C 114 61.4, 132 60.4, 160 61 L160 72 C 140 71.6, 118 69.6, 106 66.4 Z" fill="#84AED2" opacity="0.5"/>
         <path d="M97.6 60.4 C 105.6 55.6, 124 53.9, 142 54.8 C 153 55.3, 160 56.8, 160 58.2 L160 56.6 C 152 53.6, 140 52.4, 124 51.7 C 110 51.2, 100.6 53.8, 97.6 60.4 Z" fill="#7A5A3C"/>
         <ellipse cx="117" cy="66.4" rx="2.4" ry="1.2" fill="#6E9B52"/>
         <ellipse cx="128" cy="69" rx="2" ry="1" fill="#6E9B52"/>
         <ellipse cx="140" cy="65" rx="2.2" ry="1.1" fill="#6E9B52"/>
         <ellipse cx="150" cy="68.6" rx="1.9" ry="0.95" fill="#6E9B52"/>
         <ellipse cx="133" cy="63.4" rx="1.7" ry="0.85" fill="#6E9B52"/>
         <path d="M100 62.5 C 99.36 58.45, 98.72 55.75, 98.4 53.5" stroke="#4F7A3E" stroke-width="0.75" fill="none" stroke-linecap="round"/>
         <rect x="97.7" y="52.1" width="1.4" height="3" rx="0.7" fill="#8A6A45"/>
         <path d="M102.5 64.5 C 102.9 61.35, 103.3 59.25, 103.5 57.5" stroke="#4F7A3E" stroke-width="0.75" fill="none" stroke-linecap="round"/>
         <rect x="102.8" y="56.1" width="1.4" height="3" rx="0.7" fill="#8A6A45"/>
         <path d="M152 57.5 C 152.56 53.45, 153.12 50.75, 153.4 48.5" stroke="#4F7A3E" stroke-width="0.75" fill="none" stroke-linecap="round"/>
         <rect x="152.7" y="47.1" width="1.4" height="3" rx="0.7" fill="#8A6A45"/>
         <path d="M148 58.2 C 147.6 54.825, 147.2 52.575, 147 50.7" stroke="#4F7A3E" stroke-width="0.75" fill="none" stroke-linecap="round"/>
         <rect x="146.3" y="49.3" width="1.4" height="3" rx="0.7" fill="#8A6A45"/>
         <path d="M156 58.6 C 156.24 54.775, 156.48 52.225, 156.6 50.1" stroke="#4F7A3E" stroke-width="0.75" fill="none" stroke-linecap="round"/>
         <rect x="155.9" y="48.7" width="1.4" height="3" rx="0.7" fill="#8A6A45"/>
         <path d="M0 70 C 26 66, 56 65, 88 66.6 C 118 68, 142 71, 160 74 L160 90 L0 90 Z" fill="#6E9350"/>
         <g><path d="M-4.025 92 C -5.36894 86.4488, -7.25046 82.1313, -9.40076 79.6641" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M-3.26875 92 C -4.41885 86.3921, -6.02899 82.0304, -7.86914 79.538" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M-2.5125 92 C -3.0612 86.3941, -3.82937 82.0339, -4.70728 79.5424" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M-1.75625 92 C -2.03863 85.3011, -2.43395 80.0908, -2.88575 77.1135" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M-1 92 C -0.902885 84.5531, -0.766923 78.7611, -0.611539 75.4514" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M-0.24375 92 C 0.0380306 84.5202, 0.432523 78.7026, 0.883372 75.3782" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M0.5125 92 C 1.26611 86.1272, 2.32115 81.5595, 3.52692 78.9493" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M1.26875 92 C 2.21852 86.9997, 3.5482 83.1107, 5.06783 80.8883" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M2.025 92 C 3.50572 86.9312, 5.57873 82.9887, 7.94788 80.7359" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M-2.07125 92 C -3.30593 85.9401, -5.03449 81.2268, -7.00999 78.5335" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M-1.33661 92 C -2.26023 84.2529, -3.55331 78.2275, -5.03112 74.7843" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M-0.601964 92 C -1.1721 85.2363, -1.97029 79.9757, -2.8825 76.9696" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M0.132679 92 C -0.166149 83.2086, -0.584508 76.3708, -1.06263 72.4635" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M0.867321 92 C 0.994921 83.931, 1.17356 77.6551, 1.37772 74.0689" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M1.60196 92 C 1.99233 83.9177, 2.53884 77.6315, 3.16343 74.0394" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M2.33661 92 C 3.28871 85.3997, 4.62166 80.2662, 6.14502 77.3328" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M3.07125 92 C 4.28708 85.2964, 5.98924 80.0826, 7.93457 77.1032" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M4.25 92 C 3.02533 87.7372, 1.3108 84.4216, -0.648672 82.5271" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M5.03571 92 C 4.00338 87.7736, 2.55812 84.4864, 0.906382 82.6081" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M5.82143 92 C 5.40878 87.3438, 4.83107 83.7223, 4.17083 81.6529" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M6.60714 92 C 6.5674 85.4797, 6.51177 80.4084, 6.44818 77.5105" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M7.39286 92 C 7.61228 86.7337, 7.91948 82.6377, 8.27056 80.2971" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M8.17857 92 C 8.78344 86.5855, 9.63024 82.3742, 10.598 79.9678" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M8.96429 92 C 10.007 87.5198, 11.4667 84.0353, 13.1349 82.0441" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M9.75 92 C 11.0138 88.4822, 12.7832 85.7461, 14.8053 84.1826" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M6.1625 92 C 5.22006 86.9198, 3.90064 82.9685, 2.39274 80.7106" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M6.94167 92 C 6.29444 85.8817, 5.38832 81.1231, 4.35276 78.4038" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M7.72083 92 C 7.49117 84.7312, 7.16964 79.0777, 6.80217 75.8471" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M8.5 92 C 8.55554 84.69, 8.63331 79.0045, 8.72218 75.7556" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M9.27917 92 C 9.74466 84.5156, 10.3964 78.6944, 11.1412 75.368" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M10.0583 92 C 10.8538 86.43, 11.9675 82.0977, 13.2403 79.6221" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M10.8375 92 C 11.9218 86.7398, 13.4399 82.6486, 15.1749 80.3107" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M12.525 92 C 11.3647 88.8015, 9.74028 86.3137, 7.8838 84.8922" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M13.35 92 C 12.6327 88.1951, 11.6284 85.2357, 10.4806 83.5447" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M14.175 92 C 13.8418 88.2043, 13.3754 85.252, 12.8423 83.565" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M15 92 C 15.1139 86.2916, 15.2735 81.8517, 15.4558 79.3146" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M15.825 92 C 16.1665 87.36, 16.6447 83.7512, 17.1911 81.689" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M16.65 92 C 17.4243 88.0254, 18.5083 84.9341, 19.7471 83.1676" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M17.475 92 C 18.7015 88.9721, 20.4186 86.617, 22.381 85.2712" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M14.3963 92 C 13.5151 88.8259, 12.2814 86.3571, 10.8715 84.9464" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M15.2378 92 C 14.6944 88.1209, 13.9337 85.1038, 13.0643 83.3797" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M16.0793 92 C 15.8071 86.6255, 15.426 82.4453, 14.9905 80.0566" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M16.9207 92 C 17.1112 86.273, 17.3778 81.8186, 17.6825 79.2733" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M17.7623 92 C 18.4621 87.3287, 19.442 83.6954, 20.5618 81.6193" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M18.6038 92 C 19.4134 88.6387, 20.5469 86.0243, 21.8423 84.5304" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M21.8 92 C 20.8534 89.7701, 19.5283 88.0357, 18.0138 87.0446" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M22.68 92 C 21.9809 89.3106, 21.0021 87.2188, 19.8835 86.0235" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M23.56 92 C 23.408 88.0355, 23.1952 84.952, 22.952 83.19" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M24.44 92 C 24.7575 88.5273, 25.202 85.8263, 25.7101 84.2828" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M25.32 92 C 25.9698 89.2004, 26.8794 87.0229, 27.9191 85.7786" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M26.2 92 C 27.1793 89.843, 28.5502 88.1653, 30.1171 87.2067" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M23.63 92 C 22.9043 88.9539, 21.8882 86.5847, 20.7271 85.2309" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M24.565 92 C 24.1053 87.9392, 23.4618 84.7808, 22.7263 82.9759" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M25.5 92 C 25.4449 87.3878, 25.3679 83.8005, 25.2798 81.7507" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M26.435 92 C 26.8589 88.7528, 27.4525 86.2273, 28.1308 84.7841" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M27.37 92 C 28.3246 88.9279, 29.6611 86.5384, 31.1885 85.173" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M31.02 92 C 30.255 89.9826, 29.184 88.4135, 27.96 87.5169" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M32.01 92 C 31.4607 89.6874, 30.6918 87.8887, 29.813 86.8608" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M33 92 C 32.9325 88.9853, 32.8381 86.6405, 32.7302 85.3007" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M33.99 92 C 34.4142 89.734, 35.0081 87.9716, 35.6868 86.9645" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M34.98 92 C 35.8782 90.0312, 37.1356 88.5, 38.5727 87.625" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M32.817 92 C 32.1537 89.8916, 31.2252 88.2518, 30.1639 87.3147" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M33.939 92 C 33.6697 88.4013, 33.2928 85.6024, 32.862 84.003" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M35.061 92 C 35.1754 89.2572, 35.3357 87.1238, 35.5188 85.9048" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M36.183 92 C 36.8104 89.5184, 37.6889 87.5882, 38.6928 86.4852" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M157.975 92 C 156.621 86.7081, 154.726 82.5923, 152.56 80.2403" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M158.731 92 C 157.787 86.5858, 156.466 82.3748, 154.956 79.9684" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M159.488 92 C 158.691 86.4323, 157.575 82.1019, 156.301 79.6274" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M160.244 92 C 159.757 84.8291, 159.077 79.2517, 158.298 76.0646" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M161 92 C 160.921 83.1731, 160.811 76.3077, 160.685 72.3846" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M161.756 92 C 161.964 85.5138, 162.255 80.4689, 162.588 77.5862" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M162.512 92 C 163.184 85.2415, 164.124 79.9849, 165.198 76.9812" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M163.269 92 C 164.347 86.0328, 165.855 81.3917, 167.58 78.7396" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M164.025 92 C 165.538 86.5606, 167.655 82.33, 170.075 79.9125" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M156.929 92 C 155.67 85.8167, 153.907 81.0075, 151.893 78.2594" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M157.663 92 C 156.732 85.1663, 155.428 79.8513, 153.939 76.8141" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M158.398 92 C 157.889 85.2501, 157.176 80.0002, 156.361 77.0002" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M159.133 92 C 158.869 82.4888, 158.501 75.0912, 158.08 70.864" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M159.867 92 C 159.988 83.6733, 160.157 77.197, 160.35 73.4963" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M160.602 92 C 161.109 83.6207, 161.819 77.1035, 162.63 73.3794" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M161.337 92 C 162.248 84.8786, 163.525 79.3397, 164.983 76.1747" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M162.071 92 C 163.328 86.3282, 165.086 81.9167, 167.097 79.3959" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M150.25 92 C 148.876 87.2111, 146.953 83.4863, 144.755 81.3579" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M151.036 92 C 150.21 86.3328, 149.053 81.9249, 147.731 79.4062" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M151.821 92 C 151.272 86.8762, 150.502 82.891, 149.623 80.6138" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M152.607 92 C 152.552 85.2435, 152.474 79.9885, 152.385 76.9856" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M153.393 92 C 153.592 85.7294, 153.871 80.8523, 154.19 78.0653" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M154.179 92 C 154.803 85.5804, 155.678 80.5873, 156.678 77.7342" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M154.964 92 C 155.846 86.3152, 157.081 81.8938, 158.492 79.3672" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M155.75 92 C 156.911 87.5375, 158.538 84.0667, 160.396 82.0834" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M149.162 92 C 148.196 86.6436, 146.842 82.4776, 145.295 80.097" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M149.942 92 C 149.299 85.6951, 148.398 80.7912, 147.37 77.989" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M150.721 92 C 150.487 85.5344, 150.159 80.5057, 149.784 77.6321" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M151.5 92 C 151.643 82.7324, 151.844 75.5243, 152.073 71.4053" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M152.279 92 C 152.721 84.8476, 153.339 79.2846, 154.045 76.1057" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M153.058 92 C 153.89 86.2779, 155.054 81.8273, 156.384 79.2842" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M153.838 92 C 154.855 86.442, 156.278 82.1191, 157.906 79.6488" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M142.525 92 C 141.382 89.0955, 139.782 86.8364, 137.954 85.5455" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M143.35 92 C 142.68 87.9413, 141.743 84.7845, 140.672 82.9806" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M144.175 92 C 143.659 87.3409, 142.935 83.7172, 142.109 81.6465" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M145 92 C 144.869 86.1484, 144.686 81.5971, 144.477 78.9964" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M145.825 92 C 146.102 86.9026, 146.489 82.9379, 146.932 80.6724" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M146.65 92 C 147.486 88.1995, 148.657 85.2436, 149.995 83.5545" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M147.475 92 C 148.495 89.038, 149.922 86.7342, 151.553 85.4177" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M141.396 92 C 140.507 88.0746, 139.262 85.0216, 137.84 83.277" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M142.238 92 C 141.721 86.6403, 140.997 82.4717, 140.17 80.0897" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M143.079 92 C 142.886 85.4004, 142.615 80.2673, 142.305 77.3341" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M143.921 92 C 143.988 85.3944, 144.082 80.2567, 144.189 77.3209" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M144.762 92 C 145.344 87.5429, 146.158 84.0762, 147.089 82.0953" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M145.604 92 C 146.629 88.3399, 148.064 85.4931, 149.703 83.8664" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M133.8 92 C 132.807 89.2827, 131.416 87.1692, 129.827 85.9615" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M134.68 92 C 134.098 88.417, 133.283 85.6302, 132.352 84.0377" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M135.56 92 C 135.324 88.3319, 134.994 85.4789, 134.617 83.8486" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M136.44 92 C 136.76 87.7096, 137.208 84.3726, 137.721 82.4657" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M137.32 92 C 138.025 89.0361, 139.013 86.7309, 140.141 85.4136" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M138.2 92 C 139.207 89.0248, 140.617 86.7107, 142.229 85.3883" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M132.63 92 C 131.69 88.8638, 130.375 86.4245, 128.871 85.0307" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M133.565 92 C 133.141 87.9473, 132.547 84.7952, 131.869 82.994" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M134.5 92 C 134.358 86.8937, 134.16 82.9222, 133.933 80.6527" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M135.435 92 C 135.865 87.4259, 136.467 83.8682, 137.154 81.8353" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M136.37 92 C 137.31 89.0225, 138.627 86.7067, 140.131 85.3834" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M125.02 92 C 124.117 89.8254, 122.854 88.134, 121.409 87.1675" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M126.01 92 C 125.43 89.0518, 124.617 86.7588, 123.689 85.4485" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M127 92 C 126.974 88.5175, 126.938 85.8089, 126.897 84.2611" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M127.99 92 C 128.567 88.8294, 129.375 86.3634, 130.298 84.9542" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M128.98 92 C 129.872 90.0134, 131.121 88.4683, 132.548 87.5854" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M123.817 92 C 123.032 89.77, 121.933 88.0356, 120.677 87.0445" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M124.939 92 C 124.804 88.128, 124.615 85.1164, 124.4 83.3955" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M126.061 92 C 126.261 88.4879, 126.541 85.7563, 126.862 84.1953" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M127.183 92 C 127.983 89.7214, 129.104 87.9492, 130.384 86.9365" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M117.35 92 C 116.489 90.1282, 115.283 88.6723, 113.905 87.8404" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M118.45 92 C 118.057 89.4657, 117.506 87.4946, 116.877 86.3683" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M119.55 92 C 119.718 89.8762, 119.954 88.2244, 120.223 87.2805" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/><path d="M120.65 92 C 121.347 90.2468, 122.322 88.8832, 123.436 88.104" stroke="#5E8B45" stroke-width="0.85" fill="none" stroke-linecap="round"/></g>
         <g><path d="M116.097 92 C 115.496 90.1318, 114.654 88.6787, 113.691 87.8483" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M117.5 92 C 117.569 89.2234, 117.666 87.0638, 117.777 85.8297" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/><path d="M118.903 92 C 119.543 90.268, 120.44 88.9209, 121.465 88.1511" stroke="#4F7A3E" stroke-width="0.95" fill="none" stroke-linecap="round"/></g>
         <g><path d="M46.68 88.7517 C 46.0891 87.3563, 45.2619 86.271, 44.3164 85.6509" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M47.56 88.7517 C 47.3227 86.6312, 46.9905 84.9819, 46.6109 84.0394" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M48.44 88.7517 C 48.6488 86.6463, 48.9411 85.0088, 49.2752 84.0731" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M49.32 88.7517 C 49.8313 87.3738, 50.5471 86.3021, 51.3651 85.6898" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/></g>
         <g><path d="M58.68 89.8939 C 58.0889 88.0051, 57.2613 86.536, 56.3155 85.6965" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M59.56 89.8939 C 59.3935 87.0703, 59.1604 84.8741, 58.8941 83.6191" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M60.44 89.8939 C 60.5598 87.066, 60.7275 84.8666, 60.9192 83.6097" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M61.32 89.8939 C 62.0132 87.9495, 62.9836 86.4371, 64.0926 85.5729" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/></g>
         <g><path d="M70.68 90.708 C 70.0245 89.3901, 69.1068 88.365, 68.058 87.7793" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M71.56 90.708 C 71.2754 88.4938, 70.8771 86.7716, 70.4218 85.7875" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M72.44 90.708 C 72.7563 88.4493, 73.199 86.6924, 73.7051 85.6885" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M73.32 90.708 C 73.8418 89.4662, 74.5723 88.5004, 75.4072 87.9485" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/></g>
         <g><path d="M82.68 90.1797 C 81.9591 88.6265, 80.9499 87.4185, 79.7964 86.7281" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M83.56 90.1797 C 83.3365 87.5868, 83.0236 85.57, 82.666 84.4176" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M84.44 90.1797 C 84.5278 87.6166, 84.6507 85.6231, 84.7912 84.484" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M85.32 90.1797 C 85.9756 88.5546, 86.8934 87.2905, 87.9423 86.5682" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/></g>
         <g><path d="M94.68 88.0533 C 94.1347 86.6565, 93.3713 85.57, 92.4989 84.9492" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M95.56 88.0533 C 95.5005 85.625, 95.4172 83.7364, 95.3221 82.6572" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M96.44 88.0533 C 96.6417 86.1412, 96.9241 84.654, 97.2468 83.8041" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M97.32 88.0533 C 97.9208 86.3999, 98.762 85.114, 99.7233 84.3792" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/></g>
         <g><path d="M106.68 90.057 C 105.951 88.7922, 104.931 87.8084, 103.765 87.2463" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M107.56 90.057 C 107.221 88.3242, 106.747 86.9764, 106.205 86.2063" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M108.44 90.057 C 108.644 88.0616, 108.931 86.5096, 109.258 85.6227" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M109.32 90.057 C 109.814 88.6333, 110.506 87.5259, 111.296 86.8931" stroke="#4F7A3E" stroke-width="0.6" fill="none" stroke-linecap="round"/></g>
         <path d="M117.2 84.4 L118.8 84.4 L118.35 80.4 L117.65 80.4 Z" fill="#E8DCC2"/>
         <ellipse cx="118" cy="84.6" rx="2.1" ry="0.6" fill="#E8DCC2"/>
         <circle cx="118" cy="78.6" r="3.7" fill="#FFFFFF"/>
         <circle cx="116.6" cy="77.2" r="1.2" fill="#F4F6F2"/>
         </svg>`,

  // Phase 0 (BB-0-phase-0-handoff.md): a devOnly placeholder tile. Full-bleed dirt infield with a
  // white diamond and a ball, plain like Golf's own tile.
  baseball: `<svg viewBox="0 0 160 90" aria-hidden="true">
           <rect width="160" height="90" fill="#4a8f3c"/>
           <path d="M50 90 L120 90 L150 46 A100 100 0 0 0 20 46 Z" fill="#b5793f"/>
           <path d="M85 24 L110 46 L85 68 L60 46 Z" fill="#e7d9b8"/>
           <circle cx="85" cy="46" r="4.5" fill="#ffffff"/>
           <circle cx="85" cy="24" r="4.5" fill="#ffffff"/>
           <circle cx="110" cy="46" r="4.5" fill="#ffffff"/>
           <circle cx="60" cy="46" r="4.5" fill="#ffffff"/>
           <circle cx="22" cy="20" r="7" fill="#ffffff"/>
           <path d="M17 15 A7 7 0 0 1 27 25" stroke="#e0532f" stroke-width="1" fill="none"/>
         </svg>`,
};

export default GAME_ART;
