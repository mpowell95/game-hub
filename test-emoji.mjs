// test-emoji.mjs - the profile emoji picker's two halves, headless.
//
// js/emoji.js decides whether a typed glyph is allowed to become someone's avatar, and
// js/emoji-data.js + js/emoji-search-<lang>.js are the browsable set behind the picker. Both are
// generated or regex-driven, and both fail SILENTLY when they break: a validator that drifts starts
// refusing real emoji at the moment a player is looking at one, and a keyword file one entry out of
// step labels every emoji after it with its neighbour's name. Neither shows up in a screenshot.
//
// Run: node test-emoji.mjs   (also part of run-all-tests.mjs)

import { isEmoji, firstEmoji } from './js/emoji.js';
import { EMOJI_GROUPS, ALL_EMOJI } from './js/emoji-data.js';
import { KEYWORDS as KW_EN } from './js/emoji-search-en.js';
import { KEYWORDS as KW_ES } from './js/emoji-search-es.js';
import STRINGS from './js/strings.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  ' + extra : ''}`); }
};

// --- isEmoji: what the picker will and will not accept -----------------------------------------
console.log('\n--- isEmoji ---');

// One per shape the validator has to handle, not a spot check: a plain emoji, a text-default symbol
// with VS16, a keycap (digit base), a regional-indicator flag, a tag-sequence flag, a skin tone, and
// a ZWJ family. Each of these took a different branch to get right.
const ACCEPT = ['🙂', '🦊', '⚽', '❤️', '☺️', '1️⃣', '🇪🇸', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '👍🏽', '👨‍👩‍👧', '🏳️‍🌈', '🫡'];
for (const e of ACCEPT) ok(`accepts ${e}`, isEmoji(e));

// Matt's rule for the box, 2026-08-25: reject anything that is not an emoji. Initials are the case
// this exists for - "MP" in an avatar slot is a name, not a picture.
const REJECT = ['a', 'MP', 'hello', '1', '', '   ', '.', '漢', '🙂🦊', '😀 x', '👍 ok', '<b>', null, undefined, 42];
for (const s of REJECT) ok(`rejects ${JSON.stringify(s)}`, !isEmoji(s));

console.log('\n--- firstEmoji ---');
ok('pulls the emoji out of a pasted sentence', firstEmoji('look 🦊 here') === '🦊');
ok('trims the trailing space a keyboard adds', firstEmoji('🙂 ') === '🙂');
ok('keeps a ZWJ family whole', firstEmoji('👨‍👩‍👧x') === '👨‍👩‍👧');
ok('returns nothing for plain text', firstEmoji('abc') === '');
ok('returns nothing for an empty string', firstEmoji('') === '');

// --- the shipped set ----------------------------------------------------------------------------
console.log('\n--- emoji-data.js ---');
ok('nine categories', EMOJI_GROUPS.length === 9, `got ${EMOJI_GROUPS.length}`);
ok('every category has entries', EMOJI_GROUPS.every((g) => g.emoji.length > 0));
ok('the set is substantial', ALL_EMOJI.length > 1500, `got ${ALL_EMOJI.length}`);

// The picker validates on click as well as on type, so an entry the validator would refuse is a
// button that silently does nothing. This is the check that catches a generator filter drifting
// away from the validator's regexes.
const unvalidatable = ALL_EMOJI.filter((e) => !isEmoji(e));
ok('every emoji in the set passes isEmoji', unvalidatable.length === 0,
  unvalidatable.slice(0, 8).join(' '));

const dupes = ALL_EMOJI.filter((e, i) => ALL_EMOJI.indexOf(e) !== i);
ok('no duplicates across categories', dupes.length === 0, dupes.slice(0, 8).join(' '));

// Skin-tone variants are excluded on purpose (five copies of every person, and no tone selector in
// the UI). A generator change that lets them back in quintuples the People tab.
const toned = ALL_EMOJI.filter((e) => /[\u{1F3FB}-\u{1F3FF}]/u.test(e));
ok('no skin-tone variants', toned.length === 0, `${toned.length} found`);

// --- the search indexes -------------------------------------------------------------------------
console.log('\n--- emoji-search-<lang>.js ---');
// Position IS the join. Nothing at runtime would notice a one-entry shift; search would just start
// returning the wrong pictures for every word.
for (const [lang, kw] of [['en', KW_EN], ['es', KW_ES]]) {
  ok(`${lang}: one keyword entry per emoji`, kw.length === ALL_EMOJI.length,
    `${kw.length} vs ${ALL_EMOJI.length}`);
  ok(`${lang}: no emoji left without keywords`, kw.every((w) => w && w.length > 0),
    `${kw.filter((w) => !w).length} empty`);
  // The picker folds the query to [a-z0-9 ] before comparing. A keyword carrying an accent or a
  // capital could never be matched by anything the player types.
  const unfolded = kw.filter((w) => /[^a-z0-9 ]/.test(w));
  ok(`${lang}: keywords are already folded to the search alphabet`, unfolded.length === 0,
    unfolded.slice(0, 3).join(' | '));
}

// Anchor a few lookups by meaning rather than by index, so a resort of the set is caught too.
const at = (emoji, kw) => kw[ALL_EMOJI.indexOf(emoji)] || '';
ok('en: the fox is findable as "fox"', at('🦊', KW_EN).split(' ').includes('fox'));
ok('es: the fox is findable as "zorro"', at('🦊', KW_ES).split(' ').includes('zorro'));
ok('en: the Spain flag is findable as "spain"', at('🇪🇸', KW_EN).split(' ').includes('spain'));
ok('es: accents are folded ("corazon", not "corazón")', at('❤️', KW_ES).includes('corazon'));

// --- i18n -----------------------------------------------------------------------------------------
console.log('\n--- category labels ---');
// The tabs are rendered from labelKey, not from [data-i18n] markup, so a missing key renders as the
// raw key string in the UI rather than throwing anywhere a test would see it.
for (const g of EMOJI_GROUPS) {
  ok(`${g.id}: en + es label`, !!(STRINGS.en[g.labelKey] && STRINGS.es[g.labelKey]), g.labelKey);
}
for (const key of ['pf_emoji_search_ph', 'pf_emoji_typed_h', 'pf_emoji_none', 'pf_emoji_cat_recent',
  'pf_emoji_search_clear', 'pf_emoji_cats_aria']) {
  ok(`${key}: en + es`, !!(STRINGS.en[key] && STRINGS.es[key]));
}

console.log(`\nEmoji picker tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
