// build-emoji-data.mjs - GENERATOR for js/emoji-data.js and js/emoji-search-<lang>.js.
// Dev tooling, not deployed. Run by hand: `node build-emoji-data.mjs`.
//
// The profile page's emoji picker used to offer a hardcoded list of 32 emoji. Matt (2026-08-25):
// players "should be able to open their keyboard and choose any emoji they want". There is no web
// API that opens the OS emoji keyboard - `inputmode` has no emoji value and no browser exposes one -
// so the app ships the whole set itself: a searchable, category-tabbed grid that works offline and
// renders the same list on every device.
//
// Sources, all fetched live so a re-run picks up a newer Unicode release:
//   - unicode.org emoji-test.txt   -> the emoji themselves, their group, their E-version
//   - CLDR annotations + annotationsDerived (en, es) -> display name (`tts`) and keywords
//     (`default`). Derived carries the flags and the ZWJ families that plain annotations omit.
//
// Deliberate filters, each one a size or a rendering decision:
//   - fully-qualified only. Minimally-qualified/unqualified forms are the same picture with the
//     VS16 dropped; offering both would fill the grid with visual duplicates.
//   - no skin-tone variants. A tone modifier multiplies an entry by five and the picker has no
//     tone selector; the base emoji is what a profile avatar wants.
//   - E-version <= MAX_VERSION. A brand-new emoji renders as a tofu box on a phone a couple of
//     years old, and an avatar that shows as an empty rectangle is worse than one the player did
//     not pick. Raise it when the family's devices have caught up.
//
// WHY THREE FILES. The emoji themselves are ~25 KB; the search keywords are ~65 KB PER LANGUAGE.
// Splitting them means opening the picker costs the small file, typing in the search box lazily
// pulls one language, and a Spanish device never downloads the English index. It also keeps the
// keyword blobs out of the service worker's atomic SHELL tier (see isShellAsset in sw.js), which
// is re-downloaded in full on every CACHE bump - i.e. on every deploy.

import { writeFileSync } from 'node:fs';

const EMOJI_TEST = 'https://unicode.org/Public/emoji/15.1/emoji-test.txt';
const CLDR = (lang) =>
  `https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-full/annotations/${lang}/annotations.json`;
const CLDR_DERIVED = (lang) =>
  `https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-derived-full/annotationsDerived/${lang}/annotations.json`;

// Emoji 15.0 shipped in 2022 and is on every device that has taken an OS update since; 15.1's
// additions (head-shake gestures, directional people, the lime) were still patchy in 2026.
const MAX_VERSION = 15.0;
const LANGS = ['en', 'es'];

// Unicode's nine groups, in the order the picker shows them, with the tab label's i18n key. The
// label text itself lives in js/strings.js like every other user-visible string.
const GROUPS = [
  ['Smileys & Emotion', 'smileys', 'pf_emoji_cat_smileys'],
  ['People & Body', 'people', 'pf_emoji_cat_people'],
  ['Animals & Nature', 'nature', 'pf_emoji_cat_nature'],
  ['Food & Drink', 'food', 'pf_emoji_cat_food'],
  ['Travel & Places', 'travel', 'pf_emoji_cat_travel'],
  ['Activities', 'activities', 'pf_emoji_cat_activities'],
  ['Objects', 'objects', 'pf_emoji_cat_objects'],
  ['Symbols', 'symbols', 'pf_emoji_cat_symbols'],
  ['Flags', 'flags', 'pf_emoji_cat_flags'],
];

const TONE = /[\u{1F3FB}-\u{1F3FF}]/u;

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** Parse emoji-test.txt into [{ emoji, group }] in file order (the order every picker uses). */
function parseTest(src) {
  const out = [];
  let group = '';
  for (const line of src.split('\n')) {
    const g = /^#\s*group:\s*(.+?)\s*$/.exec(line);
    if (g) { group = g[1]; continue; }
    if (!line || line.startsWith('#')) continue;
    // 1F600 ; fully-qualified # <emoji> E1.0 grinning face
    const m = /^[0-9A-F ]+;\s*(\S+)\s*#\s*(\S+)\s+E(\d+\.\d+)\s/.exec(line);
    if (!m) continue;
    const [, status, emoji, ver] = m;
    if (status !== 'fully-qualified') continue;
    if (TONE.test(emoji)) continue;
    if (parseFloat(ver) > MAX_VERSION) continue;
    out.push({ emoji, group });
  }
  return out;
}

/** Fold to the form the picker's search box also folds its query to: lowercase, no accents, words. */
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ');

/** CLDR annotations (+ derived) -> { emoji: "name keyword keyword ..." }, deduped. */
function searchIndex(plain, derived) {
  const out = Object.create(null);
  const add = (obj) => {
    for (const [emoji, a] of Object.entries(obj)) {
      const words = fold([...(a.tts || []), ...(a.default || [])].join(' '));
      out[emoji] = [...new Set(words.split(/\s+/).filter(Boolean))].join(' ');
    }
  };
  add(JSON.parse(plain).annotations.annotations);
  add(JSON.parse(derived).annotationsDerived.annotations);
  return out;
}

const [testSrc, ...langSrc] = await Promise.all([
  text(EMOJI_TEST),
  ...LANGS.flatMap((l) => [text(CLDR(l)), text(CLDR_DERIVED(l))]),
]);
const index = {};
LANGS.forEach((l, i) => { index[l] = searchIndex(langSrc[i * 2], langSrc[i * 2 + 1]); });

const rows = parseTest(testSrc);

// CLDR keys some sequences without the VS16 that emoji-test.txt carries, so a lookup that misses
// gets a second try with the variation selectors stripped before it gives up.
const look = (idx, e) => idx[e] || idx[e.replace(/️/g, '')] || '';

const groups = GROUPS.map(([name, id, labelKey]) => ({
  id, labelKey, items: rows.filter((r) => r.group === name).map((r) => r.emoji),
}));
const flat = groups.flatMap((g) => g.items);
const total = flat.length;

// --- js/emoji-data.js: the emoji themselves ----------------------------------------------------
const dataBody = groups.map((g) =>
  `  { id: ${JSON.stringify(g.id)}, labelKey: ${JSON.stringify(g.labelKey)},\n` +
  `    emoji: split(${JSON.stringify(g.items.join(''))}) },`).join('\n');

const dataFile = `// emoji-data.js - GENERATED by build-emoji-data.mjs. Do not edit by hand; re-run the generator.
//
// The full emoji set behind the profile picker: ${total} entries across ${groups.length} categories, in Unicode's own
// order, with skin-tone variants and anything newer than E${MAX_VERSION.toFixed(1)} left out (see the generator for why).
//
// Each group's emoji ship as ONE concatenated string, split back apart at load. That is not a
// micro-optimisation: a per-entry array would spend two quotes and a comma on each of ${total}
// items for nothing, and this file is precached, so the bytes are paid on every device.
//
// The SEARCH keywords are deliberately NOT here - they are ~65 KB per language and live in
// js/emoji-search-en.js / js/emoji-search-es.js, imported only when the player actually types.

// One grapheme cluster per emoji: the base plus any variation selectors, ZWJ joins and keycap
// parts that belong to it. \\p{RGI_Emoji} needs the v flag (Safari 17+, Chrome 112+); on an older
// engine the fallback splits on ZWJ-and-modifier runs, which is exact for this generated set.
const split = (() => {
  try { const re = new RegExp('\\\\p{RGI_Emoji}', 'gv'); return (s) => s.match(re) || []; }
  catch { return (s) => s.match(/(?:\\p{Extended_Pictographic}|[#*0-9]\\uFE0F?\\u20E3)(?:\\uFE0F|\\u200D\\p{Extended_Pictographic}|[\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}])*/gu) || []; }
})();

export const EMOJI_GROUPS = [
${dataBody}
];

/** Every emoji in the set, category order, as one flat array. */
export const ALL_EMOJI = EMOJI_GROUPS.flatMap((g) => g.emoji);

export default { EMOJI_GROUPS, ALL_EMOJI };
`;
writeFileSync('js/emoji-data.js', dataFile);

// --- js/emoji-search-<lang>.js: keywords, same flat order --------------------------------------
const sizes = {};
for (const lang of LANGS) {
  const words = flat.map((e) => look(index[lang], e));
  const missing = words.filter((w) => !w).length;
  const file = `// emoji-search-${lang}.js - GENERATED by build-emoji-data.mjs. Do not edit by hand.
//
// Search keywords for js/emoji-data.js's ALL_EMOJI, in the SAME flat order - entry i here describes
// emoji i there. Lowercased, accent-folded and space-separated (CLDR \`tts\` name + \`default\`
// keywords), so the picker's search is a plain substring test against one string per emoji, with
// the query folded the same way before it is compared.
//
// Imported only when the player types in the search box, and only in the language they are using:
// this file is ~${Math.round(Buffer.byteLength(words.join('\n')) / 1024)} KB and a device on the other language never downloads it.
${missing ? `//\n// ${missing} of ${total} emoji have no keywords in this language, so search cannot find them; they are\n// still browsable in their category tab.\n` : ''}
export const KEYWORDS = ${JSON.stringify(words.join('\n'))}.split('\\n');

export default { KEYWORDS };
`;
  writeFileSync(`js/emoji-search-${lang}.js`, file);
  sizes[lang] = { kb: (Buffer.byteLength(file) / 1024).toFixed(1), missing };
}

console.log(`js/emoji-data.js: ${total} emoji, ${groups.length} groups, ${(Buffer.byteLength(dataFile) / 1024).toFixed(1)} KB`);
for (const lang of LANGS) console.log(`js/emoji-search-${lang}.js: ${sizes[lang].kb} KB, ${sizes[lang].missing} without keywords`);
console.log(`per group: ${groups.map((g) => `${g.id} ${g.items.length}`).join(', ')}`);
