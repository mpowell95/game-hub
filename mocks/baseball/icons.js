/* Small inline glyphs shared by the round-2 mocks. currentColor throughout so
   each glyph inherits whatever ink color its row is painted in. */

export const ICON_SYNC = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
  <path d="M13.5 8a5.5 5.5 0 0 1-9.9 3.3M2.5 8a5.5 5.5 0 0 1 9.9-3.3"/>
  <path d="M12.6 4.4h1.8v1.8M3.4 11.6H1.6v-1.8"/>
</svg>`;

export const ICON_CLOUD_SLASH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5.2 11.8H4a2.6 2.6 0 0 1-.4-5.17A3.6 3.6 0 0 1 10.5 5.1a2.9 2.9 0 0 1 2.9 2.9c0 .2 0 .4-.05.6"/>
  <path d="M2 2l12 12"/>
</svg>`;

export const ICON_BRANCH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="4" cy="3" r="1.5"/>
  <circle cx="4" cy="13" r="1.5"/>
  <circle cx="12" cy="8" r="1.5"/>
  <path d="M4 4.5V13M4 6.5c0 2 1.5 1.5 4 1.5h2.6"/>
</svg>`;

export function trophyCup(bands) {
  // A cup with 1-3 horizontal bands. Never color alone: bands are a SHAPE cue
  // (count) in addition to the cup's own gold fill for a Gold result.
  const rows = [];
  const y0 = 14;
  for (let i = 0; i < bands; i++) rows.push(`<rect x="14" y="${y0 + i * 7}" width="28" height="3" fill="#12181f" opacity="0.55"/>`);
  return `<svg class="bb-trophy" viewBox="0 0 56 64" fill="none">
    <path d="M14 10h28v18a14 14 0 0 1-28 0V10z" fill="#ffce3a" stroke="#12181f" stroke-width="1.5"/>
    <path d="M14 12H6a6 6 0 0 0 6 10" stroke="#12181f" stroke-width="1.5" fill="none"/>
    <path d="M42 12h8a6 6 0 0 1-6 10" stroke="#12181f" stroke-width="1.5" fill="none"/>
    <rect x="24" y="38" width="8" height="10" fill="#12181f"/>
    <rect x="16" y="48" width="24" height="6" rx="1.5" fill="#12181f"/>
    ${rows.join('')}
  </svg>`;
}
