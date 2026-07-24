// i18n.js — the hub-wide language layer. English/Spanish, English default.
//
// The t() design is LIFTED FROM PARCHÍS, which shipped a complete, family-proven EN/ES system in
// its round 2 (window.ParchisI18n in parchis/index.html): per-language string tables, {name}-style
// placeholder substitution, and a fallback chain of chosen language -> English -> the key itself.
// That chain is what makes partial translation safe: a missing Spanish string shows English, an
// unknown key shows itself, and nothing ever throws. This module is that same design as a shared
// ES module, so every in-hub game can use it.
//
// How a game consumes it (the reference implementation is snake/):
//   1. Create `<game>/js/strings.js` exporting `{ en: {...}, es: {...} }`. English is the source
//      of truth: every key exists in `en`; `es` may lag behind (fallback covers it).
//   2. In ui.js: `import { makeT, getLang, onLangChange } from '../../js/i18n.js';`
//      `import STRINGS from './strings.js';  const t = makeT(STRINGS);`
//   3. Wrap every user-visible string (including aria-labels) in t('key') at RENDER time, never
//      at module scope — so a language change is picked up by the next render.
//   4. Add strings.js to sw.js ASSETS (it rides the module graph, so it precaches like any other
//      file — that is the whole offline story, no fetches, no JSON).
//   5. Language changes apply to newly rendered UI. onLangChange(cb) is available for screens
//      that want to re-render live (the hub launcher does); games are NOT required to.
//
// The preference lives in its own key (gamehub.lang.v1), NOT on gamehub.profile: the profile
// shape has hand-synced read-only copies inlined in Monopoly Deal and Parchís (see js/CLAUDE.md,
// "Monopoly Deal's must-stay-synced duplicates"), so extending it drags in files this feature
// deliberately doesn't touch — and a profile reset shouldn't change the device's language.

const KEY = 'gamehub.lang.v1';
export const LANGS = ['en', 'es'];
const EVENT = 'gamehub:lang';

/** The active language: 'en' | 'es'. Unset or unrecognized reads as 'en'. */
export function getLang() {
  try { const v = localStorage.getItem(KEY); return LANGS.includes(v) ? v : 'en'; }
  catch { return 'en'; }
}

/** Persist the language and notify listeners. Returns the language actually set. */
export function setLang(lang) {
  const v = LANGS.includes(lang) ? lang : 'en';
  try { localStorage.setItem(KEY, v); } catch { /* still usable for this session via the event */ }
  try { document.documentElement.lang = v; } catch { /* not in a DOM */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { lang: v } })); } catch { /* headless */ }
  return v;
}

/** Subscribe to language changes. Returns an unsubscribe function (call it in destroy()). */
export function onLangChange(cb) {
  const h = (e) => { try { cb((e.detail && e.detail.lang) || getLang()); } catch { /* listener's problem */ } };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Build a t() over a `{ en: {...}, es: {...} }` dictionary. Parchís's exact semantics:
 *  chosen language -> English -> the key itself, then `{name}` placeholder substitution.
 *  Reads getLang() on every call, so render-time t() picks up a switch automatically. */
export function makeT(dict) {
  return function t(key, params) {
    const lang = getLang();
    let s = (dict[lang] && dict[lang][key] != null) ? dict[lang][key]
      : (dict.en && dict.en[key] != null) ? dict.en[key]
        : key;
    if (typeof s === 'function') { try { s = s(params || {}); } catch { s = key; } }
    if (params) for (const k of Object.keys(params)) s = String(s).split('{' + k + '}').join(params[k]);
    return String(s);
  };
}

// Stamp the declared page language at load, not just on a toggle tap -- a hardcoded
// `lang="en"` in the HTML while a stored preference is 'es' misdeclares the page and
// invites browser auto-translate (which rewrites text nodes, including Boggle's
// single-letter tiles into whole words). try/catch: node tests import this module
// headlessly with no `document`, same guard as setLang's.
try { document.documentElement.lang = getLang(); } catch { /* not in a DOM */ }

export default { getLang, setLang, onLangChange, makeT, LANGS };
