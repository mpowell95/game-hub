// emoji.js - "is this actually an emoji?", and nothing else.
//
// The profile picker (2026-08-25) lets a player type or paste any emoji their keyboard can produce
// instead of choosing from a curated list. Matt's rule for that box: reject anything that is not an
// emoji. A name is a name; the avatar slot is for a picture.
//
// WHERE THIS IS ENFORCED, and where it deliberately is NOT: this module gates INPUT - the picker
// calls it before a typed glyph becomes selectable. It is NOT wired into profile-store.js's
// glyph(), which stays permissive on purpose. glyph() runs on every READ of a stored profile, so
// tightening it would silently rewrite an avatar that a player already has to the 'no profile'
// fallback. Validation belongs at the moment of choosing, never on the way back out of storage.
//
// The heavy half - the browsable set itself - is js/emoji-data.js.

// \p{RGI_Emoji} matches a whole recommended emoji sequence (ZWJ families, flags, keycaps, tone
// modifiers) as one unit, which is exactly the question being asked. It needs the `v` flag:
// Chrome 112+, Safari 17+, Firefox 116+. Built with `new RegExp` so an engine without `v` throws
// here, at load, instead of making the whole module a syntax error.
const RGI = (() => {
  try { return new RegExp('^\\p{RGI_Emoji}$', 'v'); } catch { return null; }
})();

// Two fallbacks, in order of preference, both also used on modern engines as a SECOND chance:
//  - RGI only knows the sequences in the Unicode version the engine shipped with. An emoji newer
//    than that renders fine (the font has it) but fails the RGI test, and refusing a glyph the
//    player is looking at right now would be nonsense.
//  - So a match on Extended_Pictographic (plus its selectors, joins and tags) is accepted too.
// Keycaps are spelled out separately because their base is a plain digit, # or *, which is not
// pictographic - '1' must be rejected while '1<VS16><keycap>' is accepted.
const PICTO = /^(?:\p{Extended_Pictographic}|[#*0-9]️?⃣)(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|[\u{E0020}-\u{E007F}]|[#*0-9]️?⃣)*$/u;

// Regional-indicator pairs (flags) are pictographic in neither sense above.
const FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;

/** Split any string into grapheme clusters, so a family emoji counts as ONE character. */
const SEG = (() => {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return (s) => [...seg.segment(s)].map((g) => g.segment);
  } catch {
    // Intl.Segmenter is on every browser this app supports since 2023; the fallback exists so a
    // very old device degrades to "splits a family emoji apart" rather than to a blank picker.
    return (s) => Array.from(s);
  }
})();

/**
 * Is `s` exactly one emoji, and nothing else?
 * Letters, digits, punctuation, whitespace, an empty string, and two emoji in a row all fail.
 */
export function isEmoji(s) {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!v) return false;
  if (RGI && RGI.test(v)) return true;
  return FLAG.test(v) || PICTO.test(v);
}

/**
 * The first emoji in `s`, or '' if it contains none. This is what the picker's box runs on typed
 * or pasted input: a phone that autocorrects "🦊 " to "🦊 " with a trailing space, a paste of
 * "look 🦊 here", and a plain tap on the keyboard's emoji key all resolve to the same one glyph.
 */
export function firstEmoji(s) {
  const v = typeof s === 'string' ? s : '';
  if (!v) return '';
  for (const g of SEG(v)) if (isEmoji(g)) return g;
  return '';
}

export default { isEmoji, firstEmoji };
