// mp-reactions.js — the quick-chat / reaction MODEL, shared by every MP game and by
// the profile page's customizer. Storage + pure helpers only; the DOM (the palette
// button and the incoming bubbles) lives in mp-reactions-ui.js.
//
// A reaction sent into a room is a tiny payload { t, v }:
//   t:'e' → an emoji, v is the glyph            (e.g. { t:'e', v:'🔥' })
//   t:'p' → a preset phrase, v is its id         (e.g. { t:'p', v:'gg' })
//   t:'c' → a custom free-text line, v is the text
// The room carries only that payload plus a timestamp (net.sendReaction). The RECEIVER
// resolves it to display text in ITS OWN language, so a preset phrase shows Spanish to a
// Spanish viewer even though the sender picked it in English. Emoji and custom text are
// language-neutral and shown verbatim.
//
// The device's palette (which emojis/phrases appear, plus its custom slots) lives in its
// OWN key, gamehub.quickchat.v1 — deliberately NOT gamehub.profile, same reasoning as
// theme/language (js/CLAUDE.md: the profile shape has hand-synced inlined copies in
// Monopoly Deal and Parchís, and a profile reset shouldn't wipe this). It is a
// PREFERENCE — THE LAW rule 2's carve-out — one-tap recreatable, never earned history.

import { getLang } from './i18n.js';

const KEY = 'gamehub.quickchat.v1';

// The full catalog a player can choose their palette FROM. Curated, family-friendly.
export const ALL_EMOJIS = ['👍', '😂', '😮', '😅', '🔥', '🎉', '👏', '🤔', '😢', '😎', '❤️', '🫡'];

// Preset phrases, id → { en, es }. English is the source; a missing es falls back to en.
export const PHRASES = {
  gg:       { en: 'Good game!', es: '¡Buena partida!' },
  nice:     { en: 'Nice!',      es: '¡Bien!' },
  wow:      { en: 'Wow!',       es: '¡Guau!' },
  ohno:     { en: 'Oh no!',     es: '¡Oh no!' },
  close:    { en: 'So close!',  es: '¡Casi!' },
  yourturn: { en: 'Your turn!', es: '¡Te toca!' },
  gl:       { en: 'Good luck!', es: '¡Suerte!' },
  rematch:  { en: 'Rematch?',   es: '¿Revancha?' },
  hurry:    { en: 'Hurry up!',  es: '¡Rápido!' },
  thinking: { en: 'Thinking…',  es: 'Pensando…' },
};

// The palette a device gets before it customizes anything.
export const DEFAULT_PALETTE = {
  emojis: ['👍', '😂', '😮', '😅', '🔥', '🎉', '👏', '🤔'],
  phrases: ['gg', 'nice', 'wow', 'ohno', 'close', 'yourturn', 'gl', 'rematch'],
  custom: [],
};

export const CUSTOM_MAX = 4;      // how many custom free-text lines a player may keep
export const CUSTOM_MAXLEN = 24;  // per-line character cap

/** The device's saved palette, validated. Missing/corrupt → the default (never throws). */
export function loadPalette() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return normalizePalette(raw);
  } catch { return clone(DEFAULT_PALETTE); }
}

/** Persist a palette (normalized first). Returns what was actually stored. A preference,
 *  so a failed write is non-fatal — it just falls back to the default next load. */
export function savePalette(p) {
  const clean = normalizePalette(p);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* preference, non-fatal */ }
  return clean;
}

/** Drop anything not in the catalog; clamp custom lines. Unknown ids can't crash a game. */
export function normalizePalette(p) {
  if (!p || typeof p !== 'object') return clone(DEFAULT_PALETTE);
  const emojis = Array.isArray(p.emojis) ? dedupe(p.emojis.filter((e) => ALL_EMOJIS.includes(e))) : DEFAULT_PALETTE.emojis.slice();
  const phrases = Array.isArray(p.phrases) ? dedupe(p.phrases.filter((id) => PHRASES[id])) : DEFAULT_PALETTE.phrases.slice();
  const custom = Array.isArray(p.custom)
    ? p.custom.map((s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, CUSTOM_MAXLEN)).filter(Boolean).slice(0, CUSTOM_MAX)
    : [];
  return { emojis, phrases, custom };
}

/** Resolve an incoming reaction payload to display text in the viewer's language. */
export function reactionText(payload, lang) {
  if (!payload || typeof payload !== 'object') return '';
  const l = lang || getLang();
  if (payload.t === 'e') return String(payload.v || '');
  if (payload.t === 'c') return String(payload.v || '').slice(0, CUSTOM_MAXLEN);
  if (payload.t === 'p') { const ph = PHRASES[payload.v]; return ph ? (ph[l] || ph.en) : ''; }
  return '';
}

/** Build the ordered list of reactions this device's palette shows, each a
 *  { key, payload, text } ready for the palette UI (text in the given language). */
export function paletteItems(palette, lang) {
  const p = normalizePalette(palette);
  const l = lang || getLang();
  const out = [];
  for (const e of p.emojis) out.push({ key: 'e:' + e, payload: { t: 'e', v: e }, text: e });
  for (const id of p.phrases) out.push({ key: 'p:' + id, payload: { t: 'p', v: id }, text: reactionText({ t: 'p', v: id }, l) });
  for (const c of p.custom) out.push({ key: 'c:' + c, payload: { t: 'c', v: c }, text: c });
  return out;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function dedupe(arr) { const seen = new Set(); return arr.filter((x) => (seen.has(x) ? false : (seen.add(x), true))); }

export default {
  ALL_EMOJIS, PHRASES, DEFAULT_PALETTE, CUSTOM_MAX, CUSTOM_MAXLEN,
  loadPalette, savePalette, normalizePalette, reactionText, paletteItems,
};
