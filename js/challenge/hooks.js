// hooks.js - the shared challenge logic imported by the hub shell and the in-hub
// module games (Connect Four, Chinchon). Single-file games (Business Deal, Parchis)
// inline the tiny read-only subset of this in Phase C2.
//
// EVERYTHING here is inert unless the active profile name matches the trigger. The
// callers pass the profile name; nothing runs for any other name.

import { norm, hash, deobf } from './crypt.js';
import * as S from './secrets.js';
import { loadChallenge, recordWin, redeemSlot } from './challenge-store.js';

/** True when this profile name unlocks the challenge (case-insensitive/trimmed). */
export function isChallengeActive(name) {
  const list = S.TRIGGER_HASHES || [S.TRIGGER_HASH];
  return list.includes(hash(norm(name)));
}

/** The Firebase progress-record key for an active name: 'gh-' + its hash. Each unlock
 *  name (recipient or tester) gets its own isolated record. */
export function progressKeyFor(name) {
  return 'gh-' + hash(norm(name));
}

/** True when this profile name is Matt (Mission Control gate; still needs the PIN). */
export function isAdmin(name) {
  return hash(norm(name)) === S.MATT_HASH;
}

export function checkAnswer(input) { return hash(norm(input)) === S.ANSWER_HASH; }
export function checkPin(input) { return hash(norm(input)) === S.PIN_HASH; }

/** Plaintext code for a slot (for the celebration overlay + the earned-codes vault). */
export function codeFor(slot) { return deobf(S.CODES[slot] || ''); }

/** Which task slot an entered code belongs to, or null. Case-insensitive/trimmed. */
export function slotForCode(input) {
  const n = norm(input);
  if (!n) return null;
  for (const slot in S.CODES) if (norm(deobf(S.CODES[slot])) === n) return slot;
  return null;
}

// Escalating taunt lines Matt wrote, fixed order. Shown on each Connect Four rigged
// loss (loss 1 -> [0], loss 2 -> [1], ...) AND reused for the selfie rejections.
export const TAUNTS = [
  'Better luck next time!',
  '\u{1F62C} oh no....',
  'uhh.... should I have built a how-to-play section..?',
  'Come on! You got this!!',
];
/** The taunt for the Nth loss/rejection (0-based), clamped to the last line. */
export function taunt(n) { return TAUNTS[Math.min(Math.max(0, n | 0), TAUNTS.length - 1)]; }

// --- Connect Four hazing --------------------------------------------------------
/** Forced AI difficulty for the hazing: Expert for the first N completed games, then Easy. */
export function cfForcedDifficulty(completed) {
  return completed < S.N ? 'expert' : 'easy';
}
/** True once the hazing is over and a genuine Easy win should qualify. */
export function cfInEasyPhase(completed) {
  return completed >= S.N;
}

// --- Per-game qualify predicates (config read by each game at win time) ----------
const MIDDLE_UP = { normal: true, hard: true };                 // Chinchon / Business Deal
const PARCHIS_MIDDLE_UP = { intermediate: true, pro: true, expert: true };

export function qualifyChinchon({ humanWon, opponentCount, aiDifficulty }) {
  return !!humanWon && opponentCount === 1 && !!MIDDLE_UP[aiDifficulty];
}
export function qualifyBusiness({ humanWon, numAI, difficulty }) {
  return !!humanWon && numAI >= 2 && !!MIDDLE_UP[difficulty];
}
export function qualifyParchis({ humanWon, spanishMode, aiCount, aiSkills }) {
  return !!humanWon && !!spanishMode && aiCount === 3 &&
    Array.isArray(aiSkills) && aiSkills.length === 3 && aiSkills.every((s) => !!PARCHIS_MIDDLE_UP[s]);
}

export { loadChallenge, recordWin, redeemSlot };
export const N = S.N;

export default {
  isChallengeActive, isAdmin, progressKeyFor, checkAnswer, checkPin, codeFor, slotForCode,
  cfForcedDifficulty, cfInEasyPhase, qualifyChinchon, qualifyBusiness, qualifyParchis,
  loadChallenge, recordWin, redeemSlot, N, TAUNTS, taunt,
};
