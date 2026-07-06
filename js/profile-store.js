// profile-store.js — the ONE reader/writer for the shared user profile, stored at
// localStorage["gamehub.profile"]. Only the profile page writes it; games read it.
// ES-module games import { loadProfile }; single-file games inline the read-only
// subset (normalize + helpers + loadProfile). Keep this small so inlining stays cheap.
//
// Contract (see HUB-01-PROFILE-SPEC.md):
//   { version:1, name, emoji, preferredColor:"yellow"|"blue"|"red"|"green"|null,
//     opponents:[{name, emoji, skill:1|2|3}], updatedAt }
// Readers must treat missing or malformed data as "no profile" (returns null).

const KEY = 'gamehub.profile';
const COLORS = ['yellow', 'blue', 'red', 'green'];

const text = (v, fb, max) => ((typeof v === 'string' ? v : '').trim().slice(0, max) || fb);
// Split by code point so multi-codepoint emoji are never sliced apart.
const glyph = (v, fb) => (Array.from(typeof v === 'string' ? v.trim() : '').slice(0, 8).join('') || fb);
const tier = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 3 ? n : 2; };

/** Validate/normalize any value into the profile shape, or null if not an object. */
function normalize(p) {
  if (!p || typeof p !== 'object') return null;
  const opp = Array.isArray(p.opponents) ? p.opponents.slice(0, 3) : [];
  return {
    version: 1,
    name: text(p.name, 'You', 20),
    emoji: glyph(p.emoji, '🙂'),
    preferredColor: COLORS.includes(p.preferredColor) ? p.preferredColor : null,
    opponents: opp.map((o, i) => ({
      name: text(o && o.name, 'Computer ' + (i + 1), 20),
      emoji: glyph(o && o.emoji, '🤖'),
      skill: tier(o && o.skill),
    })),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null,
  };
}

/** Read + validate the stored profile. Returns null when absent or corrupt. */
export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch { return null; }
}

/** Validate + persist a profile. Stamps updatedAt. Returns the normalized profile, or null. */
export function saveProfile(p) {
  try {
    const clean = normalize(p);
    if (!clean) return null;
    clean.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(clean));
    return clean;
  } catch { return null; }
}

/** Delete the profile entirely. */
export function clearProfile() {
  try { localStorage.removeItem(KEY); return true; } catch { return false; }
}

export default { loadProfile, saveProfile, clearProfile };
