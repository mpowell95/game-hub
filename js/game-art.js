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
  'business-deal': `<svg viewBox="0 0 160 90" aria-hidden="true">
            <rect width="160" height="90" fill="#6a4cff"/>
            <g transform="rotate(-24 30 48)"><rect x="18" y="27" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="18" y="27" width="24" height="10" rx="3" fill="#e0532f"/></g>
            <g transform="rotate(-12 55 44)"><rect x="43" y="23" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="43" y="23" width="24" height="10" rx="3" fill="#178a7a"/></g>
            <g transform="rotate(12 105 44)"><rect x="93" y="23" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="93" y="23" width="24" height="10" rx="3" fill="#f2b705"/></g>
            <g transform="rotate(24 130 48)"><rect x="118" y="27" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="118" y="27" width="24" height="10" rx="3" fill="#8155ba"/></g>
            <g><rect x="68" y="20" width="24" height="42" rx="3" fill="#fff" stroke="#b9afe8" stroke-width="1.2"/><rect x="68" y="20" width="24" height="10" rx="3" fill="#1f5fa8"/></g>
            <circle cx="134" cy="70" r="12" fill="#f2b705" stroke="#a9791b" stroke-width="1.8"/>
            <text x="134" y="75.5" font-size="15" font-weight="900" text-anchor="middle" fill="#7a5502" font-family="system-ui, -apple-system, sans-serif">$</text>
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
  filler: `<svg viewBox="0 0 160 90" aria-hidden="true">
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
};

export default GAME_ART;
