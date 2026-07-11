// secrets.js - the ONE obfuscated-constants file for the hidden challenge.
//
// Nothing here is plaintext. Values are either one-way hashes (hash(norm(x)) via
// crypt.js) for things we only compare, or reversible obf(x) blobs for the codes we
// must display. No comment in this file spells out a real answer, PIN, code, or name,
// so the public repo stays un-greppable. The real flight data and any real photo are
// NOT here at all; they live in Firebase behind rules (see CHALLENGE-PLAN.md).
//
// ============================ REAL VALUES (filled C4) ============================
// The values below are the REAL, obfuscated credentials (filled 2026-07-10, Phase C4).
// Nothing is plaintext: *_HASH are one-way (compare-only), CODES are reversible obf()
// (matched case-insensitively/trimmed on entry, deobf()'d only to display). To
// regenerate any value, run crypt.js:
//   node -e "import('./crypt.js').then(c=>console.log(c.hash(c.norm('YOUR TEXT'))))"   // a *_HASH
//   node -e "import('./crypt.js').then(c=>console.log(c.obf('YOUR-CODE')))"            // a CODE
// The plaintext behind these is recorded ONLY in the private Game-Hub planning folder
// (CHALLENGE-HANDOFF docs), NEVER in this public repo. Do not paste plaintext here.
// ================================================================================

// Who unlocks the challenge (hashes of the profile names, case-insensitive/trimmed).
// The first is the real recipient; the rest are testers who can walk the whole challenge
// under their OWN isolated progress record (each active name gets key 'gh-' + its hash),
// so testing never touches the recipient's data.
export const TRIGGER_HASH = '1cabdac0';                     // primary recipient
export const TRIGGER_HASHES = ['1cabdac0', '39b28c49'];     // all names that unlock (incl. test1)

// Who sees Mission Control (Matt's own profile name, case-insensitive/trimmed).
export const MATT_HASH = '9439b002';

// Gate into the Challenge Area: one personal question. The QUESTION text is not a
// secret (it is shown on screen); only the answer is hashed.
export const QUESTION = 'What is the sexiest starchy vegetable?';
export const ANSWER_HASH = 'e97bd63d';

// Admin PIN for Mission Control.
export const PIN_HASH = '9079f248';

// The five task codes, reversibly obfuscated (deobf() to display). Slots are fixed
// keys; which slot maps to which PIECE is decided by redemption ORDER, not identity.
export const CODES = {
  connect4: 'Kx1OE0tCUVFGElxHCkgfAkNZFEA=',
  chinchon: 'KglZDBINXgISDlYISEEXHUhbCA==',
  business: 'IRpMFghCFwZTCRkXGkIaB0haEEYTWg==',
  parchis:  'LkhaGQVDVlFeE08CSEQWS2xaFEATWgZISxcZSEEUQFs=',
  selfie:   'DwVAFQYNZARRGVwUGww=',
};

// Piece reveal order: fragment ids in the order they light up as codes are redeemed
// (1st redemption -> PIECE_ORDER[0], and so on). These are placeholders; the real
// visual content for each piece is defined and dropped in later (see challenge-ui
// galleryHTML, which falls back to a numbered tile for any id without art).
export const PIECE_ORDER = ['reward-pt-1', 'reward-pt-2', 'reward-pt-3', 'reward-pt-4', 'reward-pt-5'];

// Connect Four hazing: first N completed games are forced unwinnable, then Easy.
export const N = 3;

// Firebase progress-record key. Stable and re-derivable from the trigger name for
// recovery (it equals 'gh-' + TRIGGER_HASH), so no plaintext name is ever stored.
export const PROGRESS_KEY = 'gh-1cabdac0';

export default { TRIGGER_HASH, TRIGGER_HASHES, MATT_HASH, QUESTION, ANSWER_HASH, PIN_HASH, CODES, PIECE_ORDER, N, PROGRESS_KEY };
