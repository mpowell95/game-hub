// test-i18n-strings.mjs — the drift tripwire for every i18n dictionary in the repo.
// Run: node test-i18n-strings.mjs  (no deps)
//
// For each dictionary (js/strings.js + every <game>/js/strings.js — add a new game's here
// as its phase lands), asserts:
//   - every `es` key also exists in `en` (no orphaned Spanish)
//   - for every key present in both, the set of {placeholder} tokens matches
//   - no value is an empty string
// and logs (informational only) the count of `en` keys missing from `es`.

const DICTS = [
  { name: 'js/strings.js', path: './js/strings.js' },
  { name: 'snake/js/strings.js', path: './snake/js/strings.js' },
  { name: 'filler/js/strings.js', path: './filler/js/strings.js' },
  { name: 'mancala/js/strings.js', path: './mancala/js/strings.js' },
  { name: 'tic-tac-toe/js/strings.js', path: './tic-tac-toe/js/strings.js' },
  { name: 'dots-boxes/js/strings.js', path: './dots-boxes/js/strings.js' },
];

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

function placeholders(s) {
  if (typeof s !== 'string') return new Set();
  return new Set([...s.matchAll(PLACEHOLDER_RE)].map((m) => m[1]));
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

let fail = 0, missingTotal = 0;

for (const { name, path } of DICTS) {
  console.log(`\n=== ${name} ===`);
  const mod = await import(path);
  const dict = mod.STRINGS || mod.default;
  const en = dict.en || {};
  const es = dict.es || {};

  // orphaned Spanish keys
  for (const key of Object.keys(es)) {
    if (!(key in en)) {
      fail++;
      console.log(`FAIL orphaned es key not in en: ${key}`);
    }
  }

  // placeholder mismatch + empty values
  for (const key of Object.keys(en)) {
    const enVal = en[key];
    if (typeof enVal === 'string' && enVal === '') {
      fail++;
      console.log(`FAIL empty en value: ${key}`);
    }
    if (key in es) {
      const esVal = es[key];
      if (typeof esVal === 'string' && esVal === '') {
        fail++;
        console.log(`FAIL empty es value: ${key}`);
      }
      const pEn = placeholders(enVal);
      const pEs = placeholders(esVal);
      if (!sameSet(pEn, pEs)) {
        fail++;
        console.log(`FAIL placeholder mismatch for ${key}: en={${[...pEn]}} es={${[...pEs]}}`);
      }
    } else {
      missingTotal++;
    }
  }

  const enCount = Object.keys(en).length;
  const missing = enCount - Object.keys(es).filter((k) => k in en).length;
  console.log(`ok   ${enCount} en keys, ${missing} missing from es (fallback covers these)`);
}

console.log(`\n==================================================`);
console.log(`${fail} failure(s)`);
process.exit(fail ? 1 : 0);
