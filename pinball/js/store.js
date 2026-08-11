// pinball/js/store.js - this game's own localStorage.
//
// IT HOLDS ONE PREFERENCE: which table you last played. That is deliberate and it is THE LAW
// answer for this game (root CLAUDE.md). (It used to hold a sound flag too; the game has no audio
// layer at all now, so the flag went with it. A stale `sound` value left in an existing store is
// simply ignored, never read and never rewritten.) A pinball game's one
// piece of real history is the high score, and the temptation is to keep a local top-ten table
// here - which would make this file a second, unsynced, silently-truncating home for earned data.
// Instead the ONLY record of a score is `recordPinball()` in js/game-stats.js: it is per player,
// Math.max, mirrored to Firebase by stats-net.js, aggregated across a person's devices by
// players-agg.js and displayed by My Stats. `bestScore()` below READS that store; it never writes
// one of its own. Nothing in this file can lose anything a player earned, because nothing a player
// earned is in it.
//
// Key: `gamehub.pinball.v1`, the current settings-key convention (root CLAUDE.md item 4).

import { loadStats } from '../../js/game-stats.js';

const KEY = 'gamehub.pinball.v1';

const DEFAULTS = { difficulty: 'medium' };

/** Read settings. Any malformed or missing value falls back to a default rather than throwing:
 *  a settings read must never be able to stop the game mounting. */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw) || {};
    return {
      difficulty: ['easy', 'medium', 'hard'].includes(v.difficulty) ? v.difficulty : DEFAULTS.difficulty,
    };
  } catch (err) {
    console.warn('[pinball] settings unreadable, using defaults', err);
    return { ...DEFAULTS };
  }
}

/** Write settings. Logs loudly on failure (THE LAW rule 6) even though this is only a preference:
 *  a swallowed catch around any storage write is how a silent bug starts. Spreads over the CURRENT
 *  stored object, so any field this version no longer knows about is preserved rather than dropped. */
export function saveSettings(patch) {
  const next = { ...loadSettings(), ...(patch || {}) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.error('[pinball] could not save settings', err);
  }
  return next;
}

/** This player's best pinball score, read straight from the SHARED stats store so the number on
 *  the setup screen and the number on My Stats can never disagree. Returns 0 if never played. */
export function bestScore() {
  try {
    const st = loadStats();
    const pb = st && st.games && st.games.pinball && st.games.pinball.pb;
    return pb && Number.isFinite(pb.bestScore) ? pb.bestScore : 0;
  } catch (err) {
    console.warn('[pinball] could not read the best score', err);
    return 0;
  }
}

export default { loadSettings, saveSettings, bestScore, KEY };
