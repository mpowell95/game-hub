// way-out/js/ui.js - the DOM shell, the canvas board, input, animation, autosave and the module
// contract. The puzzle (sizes, generator, the "is the way out clear" rule) lives in engine.js;
// nothing here decides anything about it.
//
// ARROW MAZE (folder and ids still `way-out` / `wayout`: it shipped as "Way Out", way-out/CLAUDE.md).
// A clone of "Pointers" (Offline Games), from Matt's two screen recordings of 2026-10-11. Two
// screens: SETUP, in the hub's own card style (difficulty, Play level N, How to play), and PLAY, the
// reference's dark board (level, hearts with the hint beside them, progress bar, the board).
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md).
// isInProgress() RETURNS FALSE, DELIBERATELY: the level is written to `gamehub.wayout.save.v1`
// after every tap that changes it (arrows gone, arrows bumped, lives), so leaving is lossless.
import '../../js/theme.js';   // side effect: stamps .gh-dark so the standalone page themes too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { recordWayOut, recordWayOutReplay, recordWayOutRush, loadStats, statsId } from '../../js/game-stats.js';
import { woMistakeMs, woHintMs, woClock, woLevelPoints, woPoints, woEarnedPoints, woMissed, RUSH_MODES, RUSH_START_MS, RUSH_GAIN_MS, RUSH_RULES, rushMissMs, woRushExtras, woRushTime, woRushBest, woRushBestMap, woWeekKey, woWeekEnd } from '../../js/arrow-maze-time.js';
import { TIERS, SAVE_V, GEN_LATEST, LADDER_GEN, BAND_START, bandEnd, buildLevel, buildLadder, buildMore, isMore, MORE_GEN, buildB8, hasB8, B8_GEN, buildB9, hasB9, B9_GEN, buildRush, occupancy, blockerOf, dirOf, hintArrow, peel } from './engine.js';
import STRINGS from './strings.js';
import { loadProfile } from '../../js/profile-store.js';
import { isAdminDevice } from '../../js/admin-config.js';
import { IMPOSSIBLE_TESTS, IMP_W, IMP_H } from './impossible-tests.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.wayout.v1';
/** Expert's progress bar fills over this many levels, then starts over. */
const EXPERT_LAP = 50;
// ONE save PER TIER (2026-10-11 QA: with one shared slot, playing Easy wiped an unfinished
// Medium level). `gamehub.wayout.saves.v1` = { easy: save|null, ..., migrated: 1 }. The first
// key, `gamehub.wayout.save.v1` (a single save), is read ONCE into its tier's slot and then left
// exactly as it is, never written again and never deleted (THE LAW rule 5).
const OLD_SAVE_KEY = 'gamehub.wayout.save.v1';
const SAVES_KEY = 'gamehub.wayout.saves.v1';
// THE CLOCK (2026-10-13, Matt: "add a timer"), ONE PER TIER, kept apart from the save on purpose:
// the save is cleared by Restart and by Out of lives, and the time must NOT be. A level's clock runs
// from its first open until it is cleared, through every Restart and Try again, so replaying a
// board you have already seen costs the time it took to see it. { <tier>: { level, gen, ms, pen,
// mistakes, hints, partial } }; `partial` = the level was started before the timer existed, so it
// has no honest time and counts as solved only.
const CLOCKS_KEY = 'gamehub.wayout.clocks.v1';
// THE LADDER (2026-10-14, way-out/CLAUDE.md "The ladder and points"): the four difficulties are four
// stretches of ONE numbered ladder (Easy 1-50, Medium 51-100, Hard 101-150, Expert 151 on), and the
// settings key gained `ladder` = the NEXT ladder level per difficulty. Its own save and clock keys:
// the three keys above held TIER levels and are now only ever READ (once, to carry a level that was
// in progress across), never written again (THE LAW rule 5). A ladder save names its board (`src`):
// { k: 'L', n } a ladder board, or { k: 'T', tier, level, gen } a level in progress on the old tiers,
// finished on its own board first so not one tapped arrow is lost.
const LSAVES_KEY = 'gamehub.wayout.ladder.saves.v1';
const LCLOCKS_KEY = 'gamehub.wayout.ladder.clocks.v1';
// THE BANDS MOVED (2026-10-14, the same evening): Hard is 101-200 and Expert 201 on (it was Hard
// 101-150, Expert 151 on), and new boards come from ladder generator 6 (engine.js). So the first
// ladder's numbers (settings `ladder`, the two keys above) are only READ now, once, to carry each
// player's place across; nothing renumbers them in place (THE LAW rule 5). The settings key gained
// `ladder2` = the next level per band in the NEW numbering, and these are its save and clock keys.
// A save names its board: { k: 'L', n, g } is ladder board n of ladder generator g (5 = the first
// ladder, numbered the old way, kept for a level that was in progress on it; 6 = today's), or
// { k: 'T', tier, level, gen } a level still in progress from the old tiers.
const LSAVES2_KEY = 'gamehub.wayout.ladder2.saves.v1';
const LCLOCKS2_KEY = 'gamehub.wayout.ladder2.clocks.v1';
/** Where each band started on the FIRST ladder, to read its numbers. */
const V1_START = { easy: 1, medium: 51, hard: 101, expert: 151 };
/** A first-ladder position, in today's numbering: the same place in the same band. Only Expert
 *  moved (151 -> 201); Hard's 151 was "complete" and is now simply Hard's 51st level. */
const v1ToV2 = (band, n) => (band === 'expert' ? n - V1_START.expert + BAND_START.expert : n);
// MORE LEVELS, REPLAY, their announcement (2026-10-26) and Hard / Expert on generator 8 (2026-10-27)
// were admin only until Matt released them to everyone on 2026-10-27 ("Yes release to everyone").
// false = Matt's devices only (Easy, Medium and Hard ending at 50 / 100 / 200, no Replay, no popup,
// the ladder's Hard and Expert boards for everyone else).
const NEWS_FOR_ALL = true;
const hasNews = () => NEWS_FOR_ALL || isAdminDevice();
const MAX_LEVEL = 1000000;   // a sane ceiling: corrupt settings once showed "Level 1e+21"
const LIVES = 3;
const TIER_NUM = { easy: 1, medium: 2, hard: 3, expert: 4 };

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// --- persistence ---------------------------------------------------------------------------------

function readSettingsRaw() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
/** The ladder position a band starts at for a player who played the OLD tiers: their next old level
 *  becomes the same place in the band (old Medium level 10 -> ladder 60). A band whose levels the
 *  old count already covers is complete. */
function ladderFromLegacy(levels, band) {
  const old = Math.max(1, levels[band] | 0 || 1);
  if (band === 'expert') return Math.min(MAX_LEVEL, BAND_START.expert - 1 + old);
  return BAND_START[band] - 1 + Math.min(old, bandEnd(band) - BAND_START[band] + 2);
}
/** `levels[tier]` is the OLD tiers' next level and `ladder[band]` the first ladder's (both frozen,
 *  kept as stored); `ladder2[band]` is the NEXT level to play in that band, today's numbering, and is
 *  what `ladder` means below. A band with no `ladder2` yet is carried from the first ladder (same
 *  place in the band), else from the old tiers. It only ever goes up (Math.max): a level reached is
 *  progress, and progress is never taken back. */
function loadSettings() {
  const v = readSettingsRaw();
  const levels = {};
  for (const k of TIERS) {
    const n = v.levels && Number(v.levels[k]);
    levels[k] = Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL ? n : 1;
  }
  const obj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const ladder = {}, stored = obj(v.ladder2);
  for (const k of TIERS) {
    const n2 = stored && Number(v.ladder2[k]), n1 = obj(v.ladder) && Number(v.ladder[k]);
    ladder[k] = Number.isInteger(n2) && n2 >= BAND_START[k] && n2 <= MAX_LEVEL ? n2
      : Number.isInteger(n1) && n1 >= V1_START[k] && n1 <= MAX_LEVEL ? Math.min(MAX_LEVEL, v1ToV2(k, n1))
      : ladderFromLegacy(levels, k);
  }
  // Which mode the setup screen shows (Levels or Rush, 2026-10-14) and which Rush version: a
  // remembered choice, not progress.
  const mode = v.mode === 'rush' ? 'rush' : 'levels';
  const rushMode = RUSH_MODES.includes(v.rushMode) ? v.rushMode : 'easy';
  // Thick arrows (2026-10-16, Matt: "make thick arrows an optional setting"): a preference. Never
  // chosen = on for Matt's devices (they had them first), off for everyone else.
  const thick = typeof v.thick === 'boolean' ? v.thick : null;
  return { tier: TIERS.includes(v.tier) ? v.tier : 'easy', levels, ladder, stored, mode, rushMode, thick };
}
function saveSettings(patch) {
  const raw = readSettingsRaw(), cur = loadSettings();
  // Everything already stored is written back as it was (the old `levels` and the first ladder's
  // `ladder` included); only `tier` and `ladder2` change.
  const next = { ...raw, tier: (patch && patch.tier) || cur.tier, ladder2: { ...cur.ladder },
    mode: (patch && patch.mode) || cur.mode, rushMode: (patch && patch.rushMode) || cur.rushMode };
  if (patch && typeof patch.thick === 'boolean') next.thick = patch.thick;
  if (patch && patch.ladder) {
    for (const k of TIERS) {
      const n = Math.floor(Number(patch.ladder[k]) || 0);
      next.ladder2[k] = Math.min(MAX_LEVEL, Math.max(cur.ladder[k], n));
    }
  }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[way-out] settings NOT saved', err); }
  return loadSettings();
}

function loadSaves() {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(SAVES_KEY) || '{}') || {}; } catch { map = {}; }
  if (typeof map !== 'object' || Array.isArray(map)) map = {};
  if (!map.migrated) {
    // Carry the single save of the first build forward into its tier's slot, once.
    try {
      const old = JSON.parse(localStorage.getItem(OLD_SAVE_KEY) || 'null');
      if (old && TIERS.includes(old.tier) && !map[old.tier]) map[old.tier] = old;
    } catch { /* a malformed old save is simply not carried */ }
    map.migrated = 1;
    try { localStorage.setItem(SAVES_KEY, JSON.stringify(map)); } catch (err) { console.error('[way-out] save', err); }
  }
  return map;
}

/** An OLD tier save (read-only since the ladder): trusted only when it is whole and belongs to the
 *  level asked for. */
function readOldSave(tier, level) {
  try {
    const s = loadSaves()[tier];
    if (!s || s.v !== SAVE_V || s.tier !== tier || s.level !== level) return null;
    const ids = (a) => (Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 0) : []);
    const lives = Number.isInteger(s.lives) && s.lives >= 1 && s.lives <= LIVES ? s.lives : LIVES;
    // `gen`: which board generator this level was played on (none = generator 1, before 2026-10-12).
    const gen = Number.isInteger(s.gen) && s.gen >= 1 && s.gen <= GEN_LATEST ? s.gen : 1;
    return { gone: ids(s.gone), red: ids(s.red), lives, gen };
  } catch { return null; }
}
// The Replay / more-levels popup's seen stamp (2026-10-26): a seen-list, a preference (per phone).
const NEWS_KEY = 'gamehub.wayout.news.v1';
const NEWS_ID = 'replay-more-2026-10-26';
function newsSeen() {
  try { const v = JSON.parse(localStorage.getItem(NEWS_KEY) || '[]'); return Array.isArray(v) && v.includes(NEWS_ID); } catch { return false; }
}
function markNewsSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(NEWS_KEY) || '[]');
    const list = Array.isArray(v) ? v : [];
    if (!list.includes(NEWS_ID)) localStorage.setItem(NEWS_KEY, JSON.stringify(list.concat([NEWS_ID])));
  } catch (err) { console.error('[way-out] news seen-stamp NOT saved', err); }
}
// (2026-10-26 to 10-27) Admin-only TEST BOARDS lived here (Matt: "Remove the test levels" once they became
// generator 8). Their results stay as stored in gamehub.wayout.tests.v1 on Matt's phones (rule 5); nothing
// reads or writes that key now.
// IMPOSSIBLE TEST BOARDS (2026-10-28, admin only; Matt: "Add an impossible or 2 or 3 as tests for me to
// play before you publish them for everyone"): js/impossible-tests.js. Every finish kept on this phone
// only, in its OWN key ({ "<n>": [{ t, m, h, d }] }); never the stats store.
const TESTS2_KEY = 'gamehub.wayout.tests2.v1';
function readTests() {
  try { const v = JSON.parse(localStorage.getItem(TESTS2_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function addTest(n, f) {
  const all = readTests(), list = Array.isArray(all[n]) ? all[n] : [];
  all[n] = list.concat([f]);
  try { localStorage.setItem(TESTS2_KEY, JSON.stringify(all)); } catch (err) { console.error('[way-out] test result NOT saved', err); }
  if (!(readTests()[n] || []).length) console.error('[way-out] test result did not read back', n);
}
/** The best finish of test board n: fewest slips, then fastest. */
function bestTest(n) {
  const list = readTests()[n];
  if (!Array.isArray(list) || !list.length) return null;
  return list.slice().sort((a, b) => (a.m + a.h) - (b.m + b.h) || a.t - b.t)[0];
}
const testName = (n) => `${t('tier_impossible')} ${n}`;
function readJSON(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function writeJSON(key, v, what) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (err) { console.error(`[way-out] ${what} NOT saved`, err); }
}
// THE RUSH SAVE (2026-10-22, Thomas via Matt: "let it be saved between rounds not during"). A run on
// the Ready screen between boards survives leaving the game: the next board is not on screen until
// Go!, so nothing can be studied. { easy: run|null, hard: run|null }; run = { seed, i (the board
// just cleared), arrows, boards, mistakes, bank, playMs, d (when saved), live, end }. `live` = 1
// once its next board is on screen: a run still live on the next load was left mid-board without
// the leave being seen, and is recorded as left. A waiting run is recorded (counted, in the week it
// was saved) when New game replaces it or its week ends.
const RUSH_SAVE_KEY = 'gamehub.wayout.rush.save.v1';
function readRushSave(mode) {
  const s = readJSON(RUSH_SAVE_KEY)[mode];
  if (!s || typeof s !== 'object' || !Number.isFinite(+s.seed) || !(+s.d > 0)) return null;
  const n = (v) => Math.max(0, Math.floor(+v) || 0);
  return { seed: +s.seed >>> 0, i: n(s.i), arrows: n(s.arrows), boards: n(s.boards), mistakes: n(s.mistakes),
    bank: n(s.bank), playMs: n(s.playMs), d: +s.d, live: !!s.live, end: s.end === 'time' || s.end === 'left' ? s.end : '',
    a0: n(s.a0), p0: n(s.p0), x: woRushExtras(s) };
}
function writeRushSave(mode, run) {
  const all = readJSON(RUSH_SAVE_KEY);
  all[mode] = run;
  writeJSON(RUSH_SAVE_KEY, all, 'Rush save');
  if (run ? !readRushSave(mode) : readRushSave(mode)) console.error('[way-out] the Rush save did NOT read back', mode, run);
}
/** Which board a save or clock is for, as one comparable string. (A first-ladder board was
 *  `L:<n>:5` then too, so its clock carries across unchanged.) */
function srcKey(src) {
  if (src && src.k === 'X') return `X:${src.band}:${src.n}`;
  if (src && src.k === 'N') return src.g === B9_GEN ? `N9:${src.band}:${src.n}` : `N:${src.band}:${src.n}`;
  return src && src.k === 'T' ? `T:${src.tier}:${src.level}:${src.gen}` : `L:${src && src.n}:${(src && src.g) || LADDER_GEN}`;
}
/** The board level n of `band` is played on when nothing older is in progress: the ladder's, or past
 *  50 / 100 / 200 one of the band's MORE boards (2026-10-26, engine.js "MORE LEVELS"). */
function defaultSrc(band, n) {
  // Hard and Expert by thinking (2026-10-27, engine.js "GENERATOR 8"): every Hard level from 101 and
  // Expert level from 201 not already in progress on an older board. Admin only until released.
  // Expert moved on to generator 9 the same evening (harder: engine.js "GENERATOR 9").
  if (hasNews() && hasB9(band, n)) return { k: 'N', band, n, g: B9_GEN };
  if (hasNews() && hasB8(band, n)) return { k: 'N', band, n, g: B8_GEN };
  return isMore(band, n) ? { k: 'X', band, n, g: MORE_GEN } : { k: 'L', n, g: LADDER_GEN };
}
/** The board a save's `src` names. */
function boardOf(src) {
  if (src.k === 'X') return buildMore(src.band, src.n);
  if (src.k === 'N') return src.g === B9_GEN ? buildB9(src.band, src.n) : buildB8(src.band, src.n);
  return src.k === 'T' ? buildLevel(src.tier, src.level, src.gen) : buildLadder(src.n, src.g);
}
function validSrc(src, band, n) {
  if (!src || typeof src !== 'object') return defaultSrc(band, n);
  if (src.k === 'N' && src.band === band && src.n === n && src.g === B8_GEN && hasB8(band, n)) return { k: 'N', band, n, g: B8_GEN };
  if (src.k === 'N' && src.band === band && src.n === n && src.g === B9_GEN && hasB9(band, n)) return { k: 'N', band, n, g: B9_GEN };
  if (src.k === 'X' && src.band === band && src.n === n && src.g === MORE_GEN && isMore(band, n)) return { k: 'X', band, n, g: MORE_GEN };
  if (src.k === 'T' && src.tier === band && Number.isInteger(src.level) && src.level >= 1
    && Number.isInteger(src.gen) && src.gen >= 1 && src.gen <= GEN_LATEST) return { k: 'T', tier: band, level: src.level, gen: src.gen };
  if (src.k === 'L' && Number.isInteger(src.n) && src.n >= 1 && (src.g === 5 || src.g === LADDER_GEN)) return { k: 'L', n: src.n, g: src.g };
  return defaultSrc(band, n);
}

/** ONCE per device, the first time this version opens: a level that was IN PROGRESS - on the first
 *  ladder, or (for a player who never opened it) on an old tier - with arrows already sent or a heart
 *  lost, becomes that band's current level, ON ITS OWN BOARD, with its own clock, so nothing a player
 *  did is thrown away. The first ladder's keys and the old tiers' keys are only read. */
function migrateToLadder2() {
  const map = readJSON(LSAVES2_KEY);
  if (map.migrated) return;
  const set = loadSettings();
  const clocks = readJSON(LCLOCKS2_KEY);
  const v1 = readJSON(LSAVES_KEY), v1Clocks = readJSON(LCLOCKS_KEY);
  let oldClocks = {};
  try { oldClocks = JSON.parse(localStorage.getItem(CLOCKS_KEY) || '{}') || {}; } catch { oldClocks = {}; }
  const ids = (a) => (Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 0) : []);
  const livesOf = (l) => (Number.isInteger(l) && l >= 1 && l <= LIVES ? l : LIVES);
  for (const band of TIERS) {
    if (map[band]) continue;
    const n = set.ladder[band];
    if (n > bandEnd(band)) continue;
    if (v1.migrated) {
      // Played the first ladder: carry its level in progress, numbered today's way.
      const s1 = v1[band];
      if (!s1 || s1.v !== 2 || s1.band !== band || !Number.isInteger(s1.n) || v1ToV2(band, s1.n) !== n) continue;
      const gone = ids(s1.gone), red = ids(s1.red), lives = livesOf(s1.lives);
      if (!(gone.length || red.length || lives < LIVES)) continue;
      const src = s1.src && s1.src.k === 'T' ? validSrc(s1.src, band, n) : { k: 'L', n: s1.n, g: 5 };
      if (src.k === 'L' && src.g !== 5) continue;   // a malformed first-ladder save: start the level fresh
      map[band] = { v: 3, band, n, src, gone, red, lives };
      const c = v1Clocks[band];
      if (c && typeof c === 'object' && c.n === s1.n && c.key === srcKey(src)) {
        clocks[band] = { n, key: srcKey(src), ms: +c.ms || 0, pen: +c.pen || 0, mistakes: c.mistakes | 0, hints: c.hints | 0, partial: !!c.partial };
      }
    } else {
      // Never opened the first ladder: carry an old-tier level in progress (as the first ladder did).
      const old = readOldSave(band, set.levels[band]);
      if (!old || !(old.gone.length || old.red.length || old.lives < LIVES)) continue;
      const src = { k: 'T', tier: band, level: set.levels[band], gen: old.gen };
      map[band] = { v: 3, band, n, src, gone: old.gone, red: old.red, lives: old.lives };
      const c = oldClocks && oldClocks[band];
      if (c && typeof c === 'object' && c.level === src.level && c.gen === src.gen) {
        clocks[band] = { n, key: srcKey(src), ms: +c.ms || 0, pen: +c.pen || 0, mistakes: c.mistakes | 0, hints: c.hints | 0, partial: !!c.partial };
      }
    }
  }
  map.migrated = 1;
  writeJSON(LCLOCKS2_KEY, clocks, 'clock');
  writeJSON(LSAVES2_KEY, map, 'save');
  // Write the positions down in today's numbering, so they stop being derived.
  if (!set.stored) saveSettings({});
}

/** A ladder save is trusted only when it is whole and belongs to the level asked for; anything else
 *  reads as "no save" and the level starts fresh (never a crash). */
function readSave(band, n, nArrows) {
  try {
    const s = readJSON(LSAVES2_KEY)[band];
    if (!s || s.v !== 3 || s.band !== band || s.n !== n) return null;
    const ids = (a) => (Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 0 && i < nArrows) : []);
    const lives = Number.isInteger(s.lives) && s.lives >= 1 && s.lives <= LIVES ? s.lives : LIVES;
    return { gone: ids(s.gone), red: ids(s.red), lives, src: validSrc(s.src, band, n) };
  } catch { return null; }
}
/** "Continue level N" only when the save holds real progress (QA: an empty or malformed save
 *  used to offer Continue on a fresh board). */
function hasProgress(band, n) {
  const s = readSave(band, n, 1e6);
  return !!s && (s.gone.length > 0 || s.red.length > 0 || s.lives < LIVES);
}
/** A level is PAUSED (Matt, 2026-10-16, after a Hard level opened with its clock already at 3:19):
 *  real progress, or at least a second on its clock. The setup screen then offers New game | Resume,
 *  as Minesweeper does. */
function isPaused(band, n) {
  if (hasProgress(band, n)) return true;
  const s = readSave(band, n, 1e6);
  const c = loadClock(band);
  return !!c && c.n === n && c.key === srcKey(s ? s.src : defaultSrc(band, n)) && c.ms + c.pen >= 1000;
}
function writeSave(o) {
  const map = readJSON(LSAVES2_KEY);
  map[o.band] = { v: 3, ...o };
  writeJSON(LSAVES2_KEY, map, 'save');
}
/** Restart, Out of lives: the same board again with nothing gone. The board itself is kept, so a
 *  level carried over from the old tiers is still that board. */
function resetSave(band, n, src) {
  writeSave({ band, n, src, gone: [], red: [], lives: LIVES });
}
/** A win: the level is done, nothing to keep. */
function clearSave(band) {
  const map = readJSON(LSAVES2_KEY);
  map[band] = null;
  writeJSON(LSAVES2_KEY, map, 'save');
}
function loadClock(band) {
  const c = readJSON(LCLOCKS2_KEY)[band];
  if (!c || typeof c !== 'object') return null;
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
  return { n: c.n, key: c.key, ms: n(c.ms), pen: n(c.pen), mistakes: n(c.mistakes) | 0, hints: n(c.hints) | 0, partial: !!c.partial };
}
function writeClock(band, c) {
  const map = readJSON(LCLOCKS2_KEY);
  map[band] = c;
  writeJSON(LCLOCKS2_KEY, map, 'clock');
}

// --- icons and pictures --------------------------------------------------------------------------

const SVGA = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_MENU = `<svg ${SVGA}><path d="M15 5l-7 7l7 7"/></svg>`;
const ICON_RESTART = `<svg ${SVGA}><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M4 4v4.5h4.5"/></svg>`;
const ICON_BULB = `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 28c-3-2.4-4.6-5.6-4.6-9a11.6 11.6 0 0 1 23.2 0c0 3.4-1.6 6.6-4.6 9v4H17z"/><path d="M19 37h10"/><path d="M24 2.5v3M8 9l2.2 2.2M40 9l-2.2 2.2M3.5 19h3M41.5 19h3"/></g></svg>`;
// Rush's rule icons (2026-10-14): the same marks on the setup card and the Ready popup. A teal arrow
// for "+0.5s", a red arrow for "-3s" (always with the sign and the word, never colour alone), a
// stopwatch for the start.
const RUSH_ARROW = (c) => `<svg viewBox="0 0 28 16" aria-hidden="true"><path d="M3 12V5h15" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 5l-7-4.5v9z" fill="${c}"/></svg>`;
// The hand is its own element so the picture's stopwatch can spin it (`.wo-watch-hand`).
const RUSH_WATCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M9.5 2.5h5M12 2.5v3M18.5 6.5l1.6-1.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path class="wo-watch-hand" d="M12 13.5V8.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="13.5" r="1.4" fill="currentColor"/></svg>';
// Replay (2026-10-26): a circular arrow round a star, the points to win back.
const ICON_REPLAY = `<svg ${SVGA}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5v4.2h4.2"/><path d="M12 8.6l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="currentColor" stroke-width="1"/></svg>`;
const ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor"/></svg>';
const ICON_CUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10v5a5 5 0 0 1-10 0z M7 5.5H4v1.5a3 3 0 0 0 3 3 M17 5.5h3v1.5a3 3 0 0 1-3 3 M12 13.5v3.5 M8 20.5h8 M9.5 17h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// The thick-arrows switch (2026-10-16): a thin or a thick arrow, the way the board will draw them.
const ICON_THIN = '<svg class="wo-thick-ic" viewBox="0 0 40 18" aria-hidden="true"><path d="M3 9H31" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M29 3.5L38 9L29 14.5Z" fill="currentColor"/></svg>';
const ICON_THICK = '<svg class="wo-thick-ic" viewBox="0 0 40 18" aria-hidden="true"><path d="M3 9H27" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M24 1L38 9L24 17Z" fill="currentColor"/></svg>';
const HEART = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21L2.6 11.6A5.6 5.6 0 0 1 12 3.9a5.6 5.6 0 0 1 9.4 7.7z"/></svg>';

/** The setup screen's header picture (2026-10-14, Matt: "Make the top image thing cooler and
 *  better"): a little board that plays itself. A 7x7 grid of dots, arrows locked into each other the
 *  way a real level is (the red one has bumped into the teal one's body, the lavender one at the top
 *  left waits for it too), and the free teal arrow glows, slides off the edge with a
 *  trail and sparks, and comes back. Pure SVG + CSS (`.wo-hero-go` in way-out.css); reduced motion
 *  shows it standing still. Built from grid points so every arrow sits on the dots. */
const HERO_SVG = (() => {
  const P = (i) => 18 + i * 14;                       // grid index -> coordinate
  const pts = (cells) => cells.map(([x, y]) => [P(x), P(y)]);
  const arrow = (cells, color, w = 4.2) => {
    const q = pts(cells);
    const [hx, hy] = q[q.length - 1], [px, py] = q[q.length - 2];
    const dx = Math.sign(hx - px), dy = Math.sign(hy - py);
    const tip = [hx + dx * 7, hy + dy * 7], b = [hx - dx * 1.5, hy - dy * 1.5];
    const head = `M${tip[0]} ${tip[1]}L${b[0] - dy * 5.5} ${b[1] + dx * 5.5}L${b[0] + dy * 5.5} ${b[1] - dx * 5.5}Z`;
    return `<path d="M${q.map((p) => p.join(' ')).join('L')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="${head}" fill="${color}"/>`;
  };
  let dots = '';
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) dots += `<circle cx="${P(x)}" cy="${P(y)}" r="1.6"/>`;
  const lav = '#b3b4e0';
  return `<svg viewBox="0 0 120 120" aria-hidden="true">`
    + `<defs><radialGradient id="woHeroBg" cx="30%" cy="22%" r="95%"><stop offset="0" stop-color="#30324f"/><stop offset=".55" stop-color="#1f2033"/><stop offset="1" stop-color="#131420"/></radialGradient>`
    + `<linearGradient id="woHeroTrail" x1="0" x2="1"><stop offset="0" stop-color="#3fd6bd" stop-opacity="0"/><stop offset="1" stop-color="#3fd6bd" stop-opacity=".55"/></linearGradient>`
    + `<filter id="woHeroGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
    + `<rect width="120" height="120" fill="url(#woHeroBg)"/>`
    + `<g fill="#4a4c70">${dots}</g>`
    + arrow([[0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [1, 1], [2, 1], [2, 2]], lav)
    + arrow([[2, 0], [3, 0], [4, 0], [5, 0], [6, 0]], lav)
    + arrow([[4, 6], [5, 6], [6, 6], [6, 5], [6, 4]], lav)
    + arrow([[3, 2], [4, 2], [4, 1]], lav)
    + arrow([[1, 6], [2, 6], [3, 6], [3, 5], [3, 4]], '#e0484f')
    + `<g class="wo-hero-go" filter="url(#woHeroGlow)">`
    + `<rect class="wo-hero-trail" x="-30" y="${P(3) - 2.5}" width="${P(1) + 30}" height="5" rx="2.5" fill="url(#woHeroTrail)"/>`
    + arrow([[1, 3], [2, 3], [3, 3], [4, 3]], '#3fd6bd', 4.8)
    + `<g class="wo-hero-spark" fill="#c9fff4"><circle cx="${P(4) - 6}" cy="${P(3) - 6}" r="1.4"/><circle cx="${P(3) + 2}" cy="${P(3) + 6}" r="1.1"/><circle cx="${P(2)}" cy="${P(3) - 5}" r=".9"/></g>`
    + `</g>`
    + `<rect x=".75" y=".75" width="118.5" height="118.5" rx="26" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1.5"/>`
    + `</svg>`;
})();

/** A small board for How to play, drawn in SVG from the same geometry as the game. `arrows`:
 *  [{ cells, kind: 'idle' | 'go' | 'red' | 'block' }]. Meaning is carried by shape too (a dashed
 *  way out, a cross on a square for a bump, a ring for a tap), never colour alone. */
function miniBoard(W, H, arrows, extra = '') {
  const P = 30, pad = 15;
  const at = (c) => [pad + (c % W) * P, pad + ((c / W) | 0) * P];
  let dots = '';
  for (let i = 0; i < W * H; i++) { const [x, y] = at(i); dots += `<circle cx="${x}" cy="${y}" r="1.8" class="wo-mini-dot"/>`; }
  let lines = '';
  for (const a of arrows) {
    const pts = a.cells.map(at);
    const [dx, dy] = dirOf(a.cells, W);
    const [hx, hy] = pts[pts.length - 1];
    const d = 'M' + pts.map((p) => p.join(' ')).join('L');
    const head = `M${hx + dx * 3} ${hy + dy * 3}L${hx - dx * 8 - dy * 6} ${hy - dy * 8 + dx * 6}L${hx - dx * 8 + dy * 6} ${hy - dy * 8 - dx * 6}Z`;
    lines += `<g class="wo-mini-${a.kind}"><path d="${d}" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="${head}" stroke="none"/></g>`;
  }
  return `<svg class="wo-mini" viewBox="0 0 ${W * P} ${H * P}" aria-hidden="true">${dots}${lines}${extra}</svg>`;
}
const tapRing = (x, y) => `<circle cx="${x}" cy="${y}" r="11" class="wo-mini-tap"/>`;
const bumpMark = (x, y) => `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="3" class="wo-mini-bump"/><path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`;
const orderTag = (x, y, n) => `<circle cx="${x}" cy="${y}" r="9" class="wo-mini-num"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="wo-mini-numtxt">${n}</text>`;

function helpPages() {
  // 6 x 4 points. Page 1: a clear arrow is tapped and leaves (dashed way out).
  const W = 6;
  const p1 = miniBoard(W, 4, [
    { cells: [13, 14, 15, 16], kind: 'go' },
    { cells: [0, 6, 7], kind: 'idle' },
    { cells: [5, 4, 10], kind: 'idle' },
    { cells: [19, 20, 21, 22], kind: 'idle' },
  ], `<path d="M${15 + 4 * 30} ${15 + 2 * 30}H${6 * 30}" class="wo-mini-way"/>${tapRing(15 + 2 * 30, 15 + 2 * 30)}`);
  // Page 2: the tapped arrow's way out runs into another arrow: a bump, a life lost.
  const p2 = miniBoard(W, 4, [
    { cells: [12, 13, 14], kind: 'red' },
    { cells: [4, 10, 16, 22], kind: 'block' },
    { cells: [0, 1, 2], kind: 'idle' },
    { cells: [19, 18], kind: 'idle' },
  ], `${bumpMark(15 + 3.5 * 30, 15 + 2 * 30)}`);
  // Page 3: the order. 1 is clear; it was blocking 2; 2 was blocking 3.
  const p3 = miniBoard(W, 4, [
    { cells: [4, 10, 16, 22], kind: 'idle' },
    { cells: [12, 13, 14], kind: 'idle' },
    { cells: [0, 1, 7], kind: 'idle' },
  ], `${orderTag(15 + 4 * 30 + 15, 15 + 3 * 30 - 6, 1)}${orderTag(15, 15 + 2 * 30 - 15, 2)}${orderTag(15, 15 + 15, 3)}`);
  return [{ svg: p1, key: 'how_1' }, { svg: p2, key: 'how_2' }, { svg: p3, key: 'how_3' }];
}

// --- the game ------------------------------------------------------------------------------------

class WayOut {
  constructor(container) {
    this.container = container;
    migrateToLadder2();
    this.settings = loadSettings();
    this.screen = 'home';
    this.raf = 0;
    this.anims = [];        // leaving / bumping arrows
    this.parts = [];        // particles and confetti (garnish)
    this.timers = [];
    this.helpPage = 0;
  }

  mount() {
    this.container.innerHTML = '<div class="wo-root"></div>';
    this.root = this.container.querySelector('.wo-root');
    this._onClick = (ev) => this._handleClick(ev);
    this._onKey = (ev) => this._handleKey(ev);
    this.root.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    // The clock stops while the app is in the background (phone locked, another app in front).
    // Rush's clock is never paused: leaving the app loses the run (Matt, 2026-10-14).
    // ...EXCEPT ON MATT'S DEVICES (2026-10-14): "keep this rule for everyone else, but get rid of
    // it for me. I need to be able to screenshot, send it to you for edits, then go back into the
    // game to keep testing." There the run HOLDS instead (_rushHold): the clock stops while the app
    // is away and runs again on return. The menu and the hub back button still end it.
    this._onVis = () => {
      if (this.rush && !this.rush.over) {
        // Between boards (the Ready screen or its countdown) the run is saved: leaving keeps it,
        // and a countdown under way goes back to Ready.
        if (this.rush.atReady) { if (document.hidden) this._rushBackToReady(); }
        else if (isAdminDevice()) this._rushHold(document.hidden);
        else if (document.hidden) this._rushEnd('left');
      }
      if (document.hidden) this._clockPause(); else this._clockRun();
    };
    document.addEventListener('visibilitychange', this._onVis);
    this.offResize = onViewportResize(() => { this._positionRoot(); this._layout(); });
    this.offLang = onLangChange(() => this.render());
    // A Rush run saved between boards opens by itself, and no other Arrow Maze game can be played
    // until it is finished (Matt, 2026-10-22).
    if (!this._resumeAnyRush()) { this.render(); this._showNews(); }
  }

  destroy() {
    if (this.rush && !this.rush.over && !this.rush.atReady) this._rushEnd('left');   // leaving mid-board loses it
    if (this.rushTick) { clearInterval(this.rushTick); this.rushTick = 0; }
    this._clockPause();
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    document.removeEventListener('keydown', this._onKey);
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
    }
    if (this.canvas && this._onDown) this.canvas.removeEventListener('pointerdown', this._onDown);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.offResize) this.offResize();
    if (this.offLang) this.offLang();
    try { delete window.__woTest; } catch { /* no window */ }
    this.container.innerHTML = '';
  }

  /** Keyboard (QA 2026-10-11): Escape and a Tab trap in popups, arrow keys on the difficulty
   *  radios, and the board itself - arrow keys pick an arrow, Enter or Space sends it. */
  _handleKey(ev) {
    if (!this.root) return;
    const m = this.root.querySelector('.wo-modal');
    if (m && !m.hidden) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        // On Out of lives, Escape is its X: hiding the popup alone left a board nobody could play.
        if (m.querySelector('[data-act="fail-close"]')) this._toSetup(true);
        else if (m.querySelector('[data-act="rush-close"]')) this._toSetup(false);
        else if (m.querySelector('[data-act="rush-ready"]')) { /* the Ready screen waits for Ready */ }
        else this._closeModal();
      } else if (ev.key === 'Tab') {
        const f = [...m.querySelectorAll('button:not([disabled])')];
        if (!f.length) return;
        const at = f.indexOf(document.activeElement);
        const next = ev.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : (at < 0 || at === f.length - 1 ? 0 : at + 1);
        ev.preventDefault();
        f[next].focus();
      }
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    const seg = ev.target && ev.target.closest && ev.target.closest('.wo-seg');
    if (seg && step && this.root.contains(seg) && seg.dataset.rmode) {
      ev.preventDefault();
      const k = RUSH_MODES[(RUSH_MODES.indexOf(this.settings.rushMode) + step + RUSH_MODES.length) % RUSH_MODES.length];
      this.settings = saveSettings({ rushMode: k });
      this.render();
      const now = this.root.querySelector(`.wo-seg[data-rmode="${k}"]`);
      if (now) now.focus();
      return;
    }
    if (seg && step && this.root.contains(seg)) {
      ev.preventDefault();
      const k = TIERS[(TIERS.indexOf(this.settings.tier) + step + TIERS.length) % TIERS.length];
      this.settings = saveSettings({ tier: k });
      this.render();
      const now = this.root.querySelector(`.wo-seg[data-tier="${k}"]`);
      if (now) now.focus();
      return;
    }
    if (this.screen === 'play' && this.canvas && document.activeElement === this.canvas) {
      if (step) { ev.preventDefault(); this._kbMove(step); }
      else if ((ev.key === 'Enter' || ev.key === ' ') && this.kbSel >= 0) {
        ev.preventDefault();
        if (!this.won && !this.failed && !(this.rush && this.rush.paused) && !this.gone[this.kbSel] && !this.busy[this.kbSel]) {
          const id = this.kbSel;
          this._send(id);
          this._kbMove(1);
          if (this.kbSel === id) this.kbSel = -1;
        }
      }
    }
  }

  /** Move the keyboard selection to the next / previous arrow still on the board. */
  _kbMove(step) {
    const n = this.lvl.arrows.length;
    let id = this.kbSel >= 0 ? this.kbSel : (step > 0 ? -1 : n);
    for (let k = 0; k < n; k++) {
      id = (id + step + n) % n;
      if (!this.gone[id] && !this.busy[id]) { this.kbSel = id; break; }
    }
    if (this.canvas) this.canvas.setAttribute('aria-label', t('board_kb_aria', { n: this._left(), i: this.kbSel + 1 }));
    this._kick();
  }

  _later(fn, ms) {
    const id = setTimeout(() => { this.timers = this.timers.filter((x) => x !== id); fn(); }, ms);
    this.timers.push(id);
  }

  /** Same technique as murdoku/js/ui.js: a fixed root measured against the mount point, and in the
   *  hub's immersive mode the top bar shares a row with the hub's floating back button.
   *
   *  The BOTTOM is `bottom: 0`, never a height measured from the viewport (2026-10-14, Matt's
   *  screenshot: the setup screen cut off in the middle of "How to play", the picture pushed up
   *  beside the Hub button). On an iPhone a viewport height read at mount can land mid-transition,
   *  short, and nothing re-measures it for the rest of the visit. Minesweeper hit exactly this on
   *  2026-10-11 and fixed it the same way: `bottom: 0` follows the real screen edge. */
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    this.root.style.bottom = '0px';
    this.root.style.height = 'auto';
    const back = document.querySelector('.hub-top-immersive .hub-back');
    const b = back && back.getBoundingClientRect();
    if (b && b.width && b.height) {
      // Immersive: edge to edge, like the reference (the hub's content column has side gutters).
      this.root.classList.add('is-immersive');
      this.root.style.left = '0px';
      this.root.style.width = (document.documentElement.clientWidth || window.innerWidth || 0) + 'px';
      this.root.style.top = '0px';
      this.root.style.setProperty('--wo-top', Math.max(0, Math.round(b.top + (b.height - 44) / 2)) + 'px');
      this.root.style.setProperty('--wo-inset', Math.max(0, Math.round(b.right + 6)) + 'px');
      return;
    }
    this.root.classList.remove('is-immersive');
    this.root.style.top = Math.max(0, Math.round(r.top)) + 'px';
  }

  // --- rendering --------------------------------------------------------------------------------

  render() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.canvas && this._onDown) this.canvas.removeEventListener('pointerdown', this._onDown);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    this.canvas = null;
    const modal = '<div class="gh-overlay wo-modal" hidden></div>';
    const body = this.screen === 'play' ? (this.rush ? this._rushPlayHTML() : this._playHTML()) : this._homeHTML();
    this.root.innerHTML = body + modal;
    this.root.classList.toggle('is-home', this.screen !== 'play');
    this._positionRoot();
    if (this.screen === 'play') {
      this._bindBoard();
      if (this.rush) {
        this._rushPaint();
        if (this.rush.over) this._showRushEnd();
        else if (this.rush.paused && !this.rush.counting && !this.rush.heldFroze && !this.timers.length) this._showRushReady();
      }
      else if (this.failed && !this.timers.length) this._showFail();
    } else {
      try { delete window.__woTest; } catch { /* no window */ }
    }
  }

  /** The setup screen, in the hub's own style (the Sudoku / Minesweeper layout and css/ui.css's
   *  .gh-* primitives): picture, title, a Difficulty card whose four buttons each show the level
   *  that tier is on, then Play and How to play. */
  /** The setup screen. Levels and Rush share ONE layout (Matt, 2026-10-14: "switching back and forth
   *  is weird because things move around"): the picture, the title, the switch, a card of
   *  [difficulty buttons, three tiles, Play], and a footer card of [a leader, a pill]. The column is
   *  TOP-aligned, so everything down to the card's top edge stands still when the mode changes. */
  _homeHTML() {
    const modeTabs = `<div class="wo-modes" role="tablist">${['levels', 'rush'].map((m) => `
      <button type="button" class="wo-mode${m === this.settings.mode ? ' is-on' : ''}" role="tab" aria-selected="${m === this.settings.mode}" data-act="mode" data-mode="${m}">${t('mode_' + m)}</button>`).join('')}</div>`;
    if (this.settings.mode === 'rush') return this._rushHomeHTML(modeTabs);
    const tier = this.settings.tier;
    const level = this.settings.ladder[tier];
    const news = hasNews();
    // Without the more levels (everyone but Matt until released), Easy, Medium and Hard end.
    const done = !news && level > bandEnd(tier);
    const paused = !done && isPaused(tier, level);
    // Each difficulty: its name, the level it is on, and a thin bar of how far through its stretch
    // of the ladder that is. Expert never ends, so its bar fills every 50 levels and starts over
    // (Matt, 2026-10-14: a solid line like the others, not a dashed one). Since 2026-10-26 Easy,
    // Medium and Hard go on past their last ladder level: their bar then shows every level cleared in
    // that difficulty against the next 50 mark (Medium 101 = 50 of 100, half full; Matt: "Give me
    // some progress on the medium. I've beaten 100 levels"), so it never drops back to empty.
    const segs = TIERS.map((k) => {
      const n = this.settings.ladder[k], end = bandEnd(k), fin = !news && n > end;
      const pct = k === 'expert' ? Math.round(100 * (((n - BAND_START[k]) % EXPERT_LAP) / EXPERT_LAP))
        : n > end && news ? Math.round(100 * (n - BAND_START[k]) / ((Math.floor((n - BAND_START[k]) / EXPERT_LAP) + 1) * EXPERT_LAP))
        : Math.round(100 * Math.min(1, (n - BAND_START[k]) / (end - BAND_START[k] + 1)));
      return `
      <button type="button" class="wo-seg${k === tier ? ' is-selected' : ''}" data-act="tier" data-tier="${k}" role="radio" aria-checked="${k === tier}">
        <span class="wo-seg-top">${diffShapeSVG(TIER_NUM[k])}<b>${t('tier_' + k)}</b></span>
        <span class="wo-seg-sub">${fin ? t('band_done') : t('level_n', { n })}</span>
        <span class="wo-seg-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
      </button>`;
    }).join('');
    // Two tiles with no words under them, and the thick-arrows switch where "3 lives" was (Matt,
    // 2026-10-16: the lives tile "is just there"; fewer words). The words stay for screen readers.
    const thick = this._thick();
    const tiles = this._tilesHTML([
      { cls: 'is-pts', icon: ICON_STAR, v: done ? '-' : t('lv_pts', { n: woLevelPoints(level, tier) }), l: t('lv_tile_worth'), quiet: true },
      { cls: 'is-mine', icon: ICON_CUP, v: String(this._myPoints()), l: t('lv_tile_mine'), quiet: true },
      { cls: 'is-thick', html: `<button type="button" class="wo-thick${thick ? ' is-on' : ''}" data-act="thick" role="switch" aria-checked="${thick}" aria-label="${t('thick_aria')}">${thick ? ICON_THICK : ICON_THIN}<i class="wo-thick-sw" aria-hidden="true"></i></button>` },
    ], t('lv_tiles_aria'));
    // Replay (2026-10-26): levels of this difficulty that earned less than their full points, a
    // count on a button at the left of the Play row; it opens the list. Absent when there are none.
    const missed = news ? woMissed(this._myWayout(), tier).length : 0;
    const replay = missed ? `<button type="button" class="gh-btn wo-play wo-replay" data-act="replays" aria-label="${t('replay_aria', { n: missed })}">${ICON_REPLAY}<b>${missed}</b></button>` : '';
    // A paused level: New game (left, the same board from nothing, clock at 0:00) and Resume
    // (right), Minesweeper's order (Matt, 2026-10-16). Otherwise one Play button.
    const play = done
      ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block wo-play" disabled>${t('band_done_play', { name: t('tier_' + tier) })}</button>`
      : paused ? `<div class="wo-playrow${replay ? ' is-three' : ''}">${replay}
          <button type="button" class="gh-btn gh-btn--block wo-play" data-act="new-level">${t('new_game')}</button>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block wo-play" data-act="play">${t('resume')}</button>
        </div>`
      : replay ? `<div class="wo-playrow">${replay}
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block wo-play" data-act="play">${t('play_level', { n: level })}</button>
        </div>`
      : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block wo-play" data-act="play">${t('play_level', { n: level })}</button>`;
    return `
      <div class="wo-home is-levels">
        <div class="wo-herorow">
          <div class="wo-hero" aria-hidden="true">${HERO_SVG}</div>
          <button type="button" class="wo-howq" data-act="help" aria-label="${t('how_title')}" title="${t('how_title')}">?</button>
          ${isAdminDevice() && IMPOSSIBLE_TESTS.length ? `<button type="button" class="wo-howq wo-testq" data-act="tests" aria-label="${t('tests_title')}" title="${t('tests_title')}">🧪</button>` : ''}
        </div>
        <div class="wo-head">
          <h1>${t('title')}</h1>
        </div>
        ${modeTabs}
        <div class="gh-card wo-menu-card">
          <div class="wo-segs" role="radiogroup" aria-label="${t('diff_label')}">${segs}</div>
          ${tiles}
          ${play}
        </div>
        <div class="wo-lead">${this._levelsLeaderHTML()}</div>
      </div>`;
  }

  /** Three tiles in a row: an icon, a number, a word. Shared by Levels and Rush. */
  _tilesHTML(items, label) {
    return `<ul class="wo-tiles" aria-label="${label}">${items.map((x) =>
      (x.html ? `<li class="${x.cls}">${x.html}</li>`
        : `<li class="${x.cls}">${x.icon}<b>${x.v}</b><span${x.quiet ? ' class="wo-sr"' : ''}>${x.l}</span></li>`)).join('')}</ul>`;
  }
  /** This person's points: from the combined read once it lands (every phone they play on), this
   *  phone's own until then. */
  _myPoints() {
    const st = this.rushStanding, me = st && st.rows && st.rows.find((r) => r.me);
    const local = woPoints(this._myWayout());
    return me && Number.isFinite(me.pts) ? Math.max(me.pts, local) : local;
  }
  /** Levels' footer: the points leader (ties all named) and See all results, in the same place as
   *  Rush's (Matt, 2026-10-16: "The leaderboard button should be included on that screen and should
   *  be in about the same area as it is on the rush screen"). It was How to play, which moved to the
   *  "?" beside the picture. "-" until known. */
  _levelsLeaderHTML() {
    const st = this.rushStanding;
    if (!st || Date.now() - st.at > 60000) this._loadRushStanding();
    const rows = ((st && st.rows) || []).map((r) => ({ ...r, pts: r.me ? Math.max(r.pts || 0, woPoints(this._myWayout())) : (r.pts || 0) }))
      .filter((r) => r.pts > 0);
    const top = rows.reduce((m, r) => Math.max(m, r.pts), 0);
    const lead = rows.filter((r) => r.pts === top);
    return this._leadHTML(`🏆 ${t('lv_leader_label')}`,
      lead.length ? lead.map((r) => this._leadName(r)).join(' & ') : '-',
      lead.length ? String(top) : '-',
      `<button type="button" class="wo-rl-all is-more" data-act="lv-board">${t('leaderboard')}</button>`);
  }
  /** A leader's name on the footer card: emoji and username, this phone's own person included
   *  (Matt, 2026-10-14: "it shouldn't say You"). Before the combined read lands, this phone's own
   *  row has no name yet, so it comes from the profile; "You" only if there is no name at all. */
  _leadName(r) {
    let name = r.name || '', emoji = r.emoji || '';
    if (r.me && !name) { const p = loadProfile() || {}; name = p.name || ''; emoji = emoji || p.emoji || ''; }
    if (!name && r.me) return t('rush_you');
    return `${esc(emoji)} ${esc(name)}`.trim();
  }
  _leadHTML(label, name, score, button) {
    return `
      <div class="wo-rl-who">
        <span class="wo-rl-label">${label}</span>
        <span class="wo-rl-row"><span class="wo-rl-name">${name}</span><b class="wo-rl-score">${score}</b></span>
      </div>${button}`;
  }

  _playHTML() {
    const tier = this.tier;
    // The arrow counters sit under the bar on EVERY difficulty (Matt, 2026-10-14: "I feel the
    // counters can fit on all these screens pretty easily"; a portrait phone's board is limited by
    // its WIDTH, so the row costs it nothing). The How to play pill is EASY only (his mock-up).
    const easy = tier === 'easy';
    return `
      <div class="wo-game${easy ? ' is-easy' : ''}">
        <div class="wo-hud">
          <button type="button" class="wo-iconbtn" data-act="menu" aria-label="${t('menu_aria')}">${ICON_MENU}</button>
          <div class="wo-hud-mid">
            <span class="wo-tierpill">${diffShapeSVG(TIER_NUM[tier])}${t('tier_' + tier)}</span>
            <span class="wo-level">${this.replay && this.replay.test ? testName(this.level) : `${this.replay ? ICON_REPLAY : ''}${t('level_n', { n: this.level })}`}</span>
          </div>
          <button type="button" class="wo-iconbtn wo-restart" data-act="restart" aria-label="${t('restart_aria')}">${ICON_RESTART}</button>
        </div>
        <div class="wo-lifebar">
          <span class="wo-timer" role="timer" aria-label="${t('timer_aria')}">0:00</span>
          <span class="wo-pen" aria-hidden="true"></span>
          <div class="wo-hearts" role="img"></div>
          <button type="button" class="wo-hint" data-act="hint" aria-label="${t('hint_aria')}">${ICON_BULB}</button>
        </div>
        <div class="wo-progress" role="progressbar" aria-valuemin="0"><i></i></div>
        <div class="wo-counts" aria-hidden="true"><span class="wo-count-left"></span><span class="wo-count-done"></span></div>
        <div class="wo-stage"><canvas class="wo-canvas" tabindex="0" role="application"></canvas></div>
        ${easy ? `<div class="wo-playfoot"><button type="button" class="gh-btn wo-howbtn" data-act="help">${t('how_title')}</button></div>` : ''}
        <div class="wo-banner" aria-live="polite"><span></span><b></b></div>
      </div>`;
  }

  // --- home -------------------------------------------------------------------------------------

  _handleClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !this.root.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'mode') {
      if (btn.dataset.mode !== this.settings.mode) { this.settings = saveSettings({ mode: btn.dataset.mode }); this.render(); }
    } else if (act === 'rush-mode') {
      if (btn.dataset.rmode !== this.settings.rushMode) { this.settings = saveSettings({ rushMode: btn.dataset.rmode }); this.render(); }
    } else if ((act === 'rush-play' || act === 'play' || act === 'new-level' || act === 'replays') && this._resumeAnyRush()) {
      // a saved Rush run comes first
    } else if (act === 'rush-later') this._rushLater();
    else if (act === 'rush-play') { this._settleRushSave(this.settings.rushMode, true); this._startRush(this.settings.rushMode); }
    else if (act === 'rush-resume') this._resumeRush(this.settings.rushMode);
    else if (act === 'rush-again') { const m = this.rush ? this.rush.mode : this.settings.rushMode; this._closeModal(); this._settleRushSave(m, true); this._startRush(m); }
    else if (act === 'rush-close') this._toSetup(false);
    else if (act === 'rush-ready') this._rushReady();
    else if (act === 'rush-board') {
      // From the end-of-run popup: back to setup first, then the leaderboard over it.
      const m = btn.dataset.rmode || (this.rush && this.rush.mode) || this.settings.rushMode;
      if (this.screen === 'play') { this._closeModal(); this._toSetup(false); }
      this._openLeaderboard('rush', m);
    }
    else if (act === 'lv-board') this._openLeaderboard('levels');
    else if (act === 'thick') {
      this.settings = saveSettings({ thick: !this._thick() });
      const on = this._thick(), b = btn.closest('.wo-thick') || btn;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
      const svg = b.querySelector('svg');
      if (svg) svg.outerHTML = on ? ICON_THICK : ICON_THIN;
    }
    else if (act === 'tier') {
      if (btn.dataset.tier !== this.settings.tier) { this.settings = saveSettings({ tier: btn.dataset.tier }); this.render(); }   // saved on selection
    } else if (act === 'play') {
      const k = this.settings.tier, n = this.settings.ladder[k];
      if (hasNews() || n <= bandEnd(k)) this._startLevel(k, n);
    } else if (act === 'new-level') {
      const k = this.settings.tier, n = this.settings.ladder[k];
      if (hasNews() || n <= bandEnd(k)) this._newLevel(k, n);
    }
    else if (act === 'replays' && hasNews()) this._openReplays();
    else if (act === 'replay' && hasNews()) this._startReplay(this.settings.tier, +btn.dataset.l, +btn.dataset.g);
    else if (act === 'news-close') this._closeModal();
    else if (act === 'tests' && isAdminDevice()) this._openTests();
    else if (act === 'test' && isAdminDevice()) this._startTest(+btn.dataset.n);
    else if (act === 'help') { this.helpPage = 0; this._openHelp(); }
    else if (act === 'menu') this._toSetup(false);
    else if (act === 'restart') this._restart();
    else if (act === 'hint') this._hint();
    else if (act === 'how-prev') { this.helpPage = Math.max(0, this.helpPage - 1); this._openHelp(); }
    else if (act === 'how-next') { this.helpPage = Math.min(2, this.helpPage + 1); this._openHelp(); }
    else if (act === 'close') this._closeModal();
    else if (act === 'retry') { this._closeModal(); this._restart(); }
    else if (act === 'fail-close') this._toSetup(true);
  }

  /** Back to the setup screen from a level. Cancels the level's timers and frames first: a pending
   *  "next level" (win) or "Out of lives" (loss) must never fire over the setup screen. `dropSave`
   *  after a loss, so the level starts fresh next time. */
  _stopLevel() {
    if (this.rushTick) { clearInterval(this.rushTick); this.rushTick = 0; }
    this._clockPause();
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.anims = [];
    this.parts = [];
  }
  _toSetup(dropSave) {
    // Leaving a Rush run before its clock runs out loses it (Matt: "they lose that round").
    // Between boards it is saved instead (_rushBoardDone), and waits on the setup screen.
    if (this.rush && !this.rush.over && !this.rush.atReady) this._rushEnd('left', true);
    const wasRush = !!this.rush, wasReplay = !!this.replay;
    this.rush = null;
    this.replay = null;
    this._stopLevel();
    // A replay keeps nothing (no save, no clock), so it has nothing to drop.
    if (dropSave && this.tier && !wasRush && !wasReplay) resetSave(this.tier, this.level, this.src);
    this.screen = 'home';
    this.settings = loadSettings();
    this.render();
  }

  _openHelp() {
    const pages = helpPages();
    const p = pages[this.helpPage];
    const last = this.helpPage === pages.length - 1;
    const dots = pages.map((_, i) => `<i class="${i === this.helpPage ? 'is-on' : ''}"></i>`).join('');
    const m = this.root.querySelector('.wo-modal');
    m.innerHTML = `
      <div class="gh-modal wo-dialog" role="dialog" aria-modal="true" aria-labelledby="wo-how-h">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="wo-how-h">${t('how_title')}</h2>
        <div class="wo-how-pic"><div class="wo-how-hearts">${HEART.repeat(3)}</div>${p.svg}</div>
        <p class="wo-how-txt">${t(p.key)}</p>
        <div class="wo-dots" aria-hidden="true">${dots}</div>
        <div class="wo-how-nav">
          <button type="button" class="gh-btn" data-act="how-prev" ${this.helpPage === 0 ? 'disabled' : ''}>${t('how_prev')}</button>
          <button type="button" class="gh-btn gh-btn--primary" data-act="${last ? 'close' : 'how-next'}">${t(last ? 'got_it' : 'how_next')}</button>
        </div>
      </div>`;
    if (m.hidden) this._opener = document.activeElement;
    // Opened from a level (Easy's How to play pill): the clock stops while the rules are read.
    if (m.hidden && this.screen === 'play' && !this.won && !this.failed) { this._clockPause(); this._helpPaused = true; }
    m.hidden = false;
    const go = m.querySelector('.gh-btn--primary');
    if (go) go.focus({ preventScroll: true });
  }

  _closeModal() {
    if (this._newsOpen) { this._newsOpen = false; markNewsSeen(); }
    const m = this.root.querySelector('.wo-modal');
    m.hidden = true;
    m.innerHTML = '';
    if (this._helpPaused) { this._helpPaused = false; this._clockRun(); }
    const back = this._opener;
    this._opener = null;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }

  // --- a level ----------------------------------------------------------------------------------

  /** Ladder level `level` of band `tier`. Its board is the ladder's, unless the save says it is a
   *  level carried over from the old tiers, which is rebuilt on its own generator so its saved
   *  arrows still mean the same arrows. */
  _startLevel(tier, level) {
    this.rush = null;
    this.replay = null;
    this.tier = tier;
    this.level = level;
    this._helpPaused = false;
    const pre = readSave(tier, level, 1e6);
    this.src = pre ? pre.src : defaultSrc(tier, level);
    this.gen = this.src.k === 'T' ? this.src.gen : this.src.g;
    this.lvl = boardOf(this.src);
    const saved = readSave(tier, level, this.lvl.arrows.length);
    this._resetBoard(saved);
    // The clock carries on through Restart and Try again on the same level; a new level starts at 0.
    // A level with progress but no clock was started before the timer existed: no honest time.
    const c = loadClock(tier), key = srcKey(this.src);
    this.clock = c && c.n === level && c.key === key ? c
      : { n: level, key, ms: 0, pen: 0, mistakes: 0, hints: 0, partial: !!(saved && (saved.gone.length || saved.red.length || saved.lives < LIVES)) };
    writeClock(tier, this.clock);
    this.screen = 'play';
    this.render();
    this._clockRun();
    // Every arrow already gone: the player left (or the app was closed) while the LAST arrow was
    // still sliding out, so the win was never counted. Count it now instead of showing an empty
    // board with nothing left to tap.
    if (!this._left()) { this.won = true; this._kick(); }
  }

  /** Every arrow back (or, from a save, the ones it says are gone and red) and three hearts. */
  _resetBoard(saved) {
    const n = this.lvl.arrows.length;
    this.rounds = (peel(this.lvl.cols, this.lvl.rows, this.lvl.arrows) || {}).layers || 1;
    this.gone = new Array(n).fill(false);
    this.red = new Array(n).fill(false);
    this.lives = LIVES;
    if (saved) {
      for (const i of saved.gone) this.gone[i] = true;
      for (const i of saved.red) this.red[i] = true;
      this.lives = saved.lives;
    }
    this.busy = new Array(n).fill(false);   // mid-animation: not tappable
    this.occ = occupancy(this.lvl, this.gone);
    this.anims = [];
    this.parts = [];
    this.hintId = -1;
    this.kbSel = -1;
    this.won = false;
    this.failed = false;
    this.wave = null;
    this.geomWas = null;
    this.winSub = '';
  }

  // --- REPLAY (2026-10-26) ------------------------------------------------------------------------
  // js/arrow-maze-time.js "REPLAY" has the rules. A replay is played on the level's own board with
  // three hearts and its own clock from 0:00, and keeps NOTHING on the phone (no save, no clock key):
  // leaving drops it, Restart and Try again start it clean. Only its finish is recorded.

  /** The one-time popup about Replay and the more levels (2026-10-26, Matt's approved mock-up): shown
   *  on the setup screen the first time this phone opens Arrow Maze with them, stamped seen when it
   *  closes by any route (Got it, X, Escape). The ↻ chip carries this person's own count of levels to
   *  replay, all difficulties; with none, the icon alone. */
  _showNews() {
    if (!hasNews() || this.screen !== 'home' || newsSeen()) return;
    const m = this.root.querySelector('.wo-modal');
    if (!m || !m.hidden) return;
    const rec = this._myWayout();
    const n = TIERS.reduce((a, k) => a + woMissed(rec, k).length, 0);
    m.innerHTML = `
      <div class="gh-modal wo-dialog wo-news" role="dialog" aria-modal="true" aria-labelledby="wo-news-h">
        <button type="button" class="gh-modal__close" data-act="news-close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="wo-news-badge" id="wo-news-h">${t('news_new')}</h2>
        <div class="wo-news-row">
          <div class="wo-news-pic"><span class="wo-news-chip">${ICON_REPLAY}${n ? `<b>${n}</b>` : ''}</span></div>
          <p class="wo-news-txt">${t('news_replay')}</p>
        </div>
        <div class="wo-news-row">
          <div class="wo-news-pic"><span class="wo-news-seg"><b>${diffShapeSVG(TIER_NUM.easy)}${t('tier_easy')}</b><span>${t('level_n', { n: 51 })}</span></span></div>
          <p class="wo-news-txt">${t('news_more')}</p>
        </div>
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block wo-play" data-act="news-close">${t('got_it')}</button>
      </div>`;
    this._opener = document.activeElement;
    this._newsOpen = true;
    m.hidden = false;
    const go = m.querySelector('.gh-btn--primary');
    if (go) go.focus({ preventScroll: true });
  }

  /** IMPOSSIBLE TEST BOARDS (admin only): the list, each with Matt's best finish on it. */
  _openTests() {
    const m = this.root.querySelector('.wo-modal');
    m.innerHTML = `
      <div class="gh-modal wo-dialog wo-replays" role="dialog" aria-modal="true" aria-labelledby="wo-ts-h">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="wo-ts-h">${t('tests_title')}</h2>
        <ul class="wo-rp-list">${IMPOSSIBLE_TESTS.map((_, i) => {
          const n = i + 1, b = bestTest(n);
          return `
          <li><button type="button" class="wo-rp-row" data-act="test" data-n="${n}">
            <span class="wo-rp-n">${testName(n)}</span>
            <b class="wo-rp-gain">${b ? `${woClock(b.t)} · ${'♥'.repeat(Math.max(0, LIVES - b.m))}${'♡'.repeat(Math.min(LIVES, b.m))}${b.h ? ` 💡${b.h}` : ''}` : '-'}</b>
          </button></li>`;
        }).join('')}
        </ul>
      </div>`;
    if (m.hidden) this._opener = document.activeElement;
    m.hidden = false;
  }
  /** Play Impossible test board n: like a replay, it keeps nothing but its result (TESTS2_KEY). */
  _startTest(n) {
    const arrows = IMPOSSIBLE_TESTS[n - 1];
    if (!arrows) return;
    const m = this.root.querySelector('.wo-modal');
    if (m && !m.hidden) { m.hidden = true; m.innerHTML = ''; this._opener = null; }
    this._stopLevel();
    this.rush = null;
    this.replay = { test: n };
    this.tier = 'expert';   // Expert's time penalties; the pill reads Expert, the title "Impossible N"
    this.level = n;
    this._helpPaused = false;
    this.src = { k: 'R', test: n };
    this.gen = 0;
    this.lvl = { cols: IMP_W, rows: IMP_H, arrows: arrows.map((c) => c.slice()) };
    this._resetBoard(null);
    this.clock = { n, key: 'R', ms: 0, pen: 0, mistakes: 0, hints: 0, partial: false };
    this.screen = 'play';
    this.render();
    this._clockRun();
  }

  /** The list of this difficulty's levels with points to win back. */
  _openReplays() {
    const band = this.settings.tier, list = woMissed(this._myWayout(), band);
    if (!list.length) return;
    const m = this.root.querySelector('.wo-modal');
    m.innerHTML = `
      <div class="gh-modal wo-dialog wo-replays" role="dialog" aria-modal="true" aria-labelledby="wo-rp-h">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="wo-rp-h">${t('replay_title')}</h2>
        <ul class="wo-rp-list">${list.map((x) => `
          <li><button type="button" class="wo-rp-row" data-act="replay" data-l="${x.l}" data-g="${x.g}">
            <span class="wo-rp-n">${diffShapeSVG(TIER_NUM[band])}${t('level_n', { n: x.n })}</span>
            <b class="wo-rp-gain">${ICON_STAR}${t('lv_pts', { n: x.gain })}</b>
          </button></li>`).join('')}
        </ul>
      </div>`;
    if (m.hidden) this._opener = document.activeElement;
    m.hidden = false;
    const first = m.querySelector('.wo-rp-row');
    if (first) first.focus({ preventScroll: true });
  }

  /** Replay the level whose log entry is (`l`, `g`): the board it was played on. */
  _startReplay(band, l, g) {
    const miss = woMissed(this._myWayout(), band).find((x) => x.l === l && x.g === g);
    if (!miss) return;
    const m = this.root.querySelector('.wo-modal');
    if (m && !m.hidden) { m.hidden = true; m.innerHTML = ''; this._opener = null; }
    this._stopLevel();
    this.rush = null;
    this.replay = { l, g };
    this.tier = band;
    this.level = miss.n;
    this._helpPaused = false;
    // Generator 5 and 6 boards are rebuilt exactly; a more-levels board too. A board from the old
    // tiers (g 1-4, finished on its own board after the ladder came) cannot be rebuilt from the log,
    // so its level's ladder board stands in. Generator 8 (Hard / Expert by thinking) is a fixed list.
    this.src = { k: 'R', l, g };
    this.gen = g;
    this.lvl = g === B9_GEN && hasB9(band, l) ? buildB9(band, l) : g === B8_GEN && hasB8(band, l) ? buildB8(band, l) : g === MORE_GEN ? buildMore(band, l) : buildLadder(l, g === 5 ? 5 : LADDER_GEN);
    this._resetBoard(null);
    this.clock = { n: miss.n, key: 'R', ms: 0, pen: 0, mistakes: 0, hints: 0, partial: false };
    this.screen = 'play';
    this.render();
    this._clockRun();
  }

  /** New game on a paused level: the same board (an old-tier board stays that board) with every
   *  arrow back, three hearts and the clock at 0:00. Only this level's in-progress save and clock
   *  are reset; every finished level's time is already in `wo.log`. */
  _newLevel(tier, level) {
    const s = readSave(tier, level, 1e6);
    const src = s ? s.src : defaultSrc(tier, level);
    resetSave(tier, level, src);
    writeClock(tier, { n: level, key: srcKey(src), ms: 0, pen: 0, mistakes: 0, hints: 0, partial: false });
    this._startLevel(tier, level);
  }

  _restart() {
    if (!this.lvl || this.won) return;
    if (this.replay && this.replay.test) { this._startTest(this.replay.test); return; }
    if (this.replay) { const { l, g } = this.replay; this._startReplay(this.tier, l, g); return; }
    resetSave(this.tier, this.level, this.src);
    this._stopLevel();
    this._startLevel(this.tier, this.level);
  }

  _save() {
    if (this.won || this.failed || this.rush || this.replay) return;   // a Rush board or a replay is never saved
    const ids = (arr) => arr.reduce((a, v, i) => (v ? (a.push(i), a) : a), []);
    writeSave({ band: this.tier, n: this.level, src: this.src, gone: ids(this.gone), red: ids(this.red), lives: this.lives });
    this._clockStore();
  }

  // --- the clock ------------------------------------------------------------------------------------
  // Runs only while a level is on screen, unfinished, and the app is in front. Shown with penalties
  // already added, so the number on screen is the number that is recorded.

  _clockMs() {
    if (!this.clock) return 0;
    return this.clock.ms + (this.clockT0 ? performance.now() - this.clockT0 : 0);
  }
  _clockRun() {
    if (!this.clock || this.clockT0 || this.screen !== 'play' || this.won || this.failed || this._helpPaused) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.clockT0 = performance.now();
    if (!this.tick) this.tick = setInterval(() => this._paintClock(), 250);
    this._paintClock();
  }
  _clockPause() {
    if (this.tick) { clearInterval(this.tick); this.tick = 0; }
    if (!this.clock || !this.clockT0) return;
    this.clock.ms = this._clockMs();
    this.clockT0 = 0;
    this._clockStore();
  }
  _clockStore() {
    if (!this.clock || !this.tier || this.replay) return;
    writeClock(this.tier, { ...this.clock, ms: Math.round(this._clockMs()) });
  }
  _paintClock() {
    const el = this.root && this.root.querySelector('.wo-timer');
    if (el && this.clock) el.textContent = woClock(this._clockMs() + this.clock.pen);
  }
  /** Add a time penalty and show it beside the clock ("+20s"). */
  _penalty(ms) {
    if (!this.clock || ms <= 0) return;
    this.clock.pen += ms;
    this._clockStore();
    this._paintClock();
    this._flashPen(`+${Math.round(ms / 1000)}s`);
  }
  _flashPen(text, bad = true) {
    const el = this.root && this.root.querySelector('.wo-pen');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-good', !bad);
    el.classList.remove('is-on');
    void el.offsetWidth;   // restart the animation
    el.classList.add('is-on');
  }

  _left() { return this.gone.reduce((n, g) => n + (g ? 0 : 1), 0); }

  _paintHud(popHeart) {
    const hearts = this.root.querySelector('.wo-hearts');
    if (hearts) {
      let h = '';
      for (let i = 0; i < LIVES; i++) {
        const full = i < this.lives;
        h += `<span class="wo-heart${full ? '' : ' is-lost'}${popHeart && i === this.lives ? ' is-pop' : ''}">${HEART}</span>`;
      }
      hearts.innerHTML = h;
      hearts.setAttribute('aria-label', t('lives_aria', { n: this.lives }));
    }
    const total = this.lvl.arrows.length, done = total - this._left();
    const bar = this.root.querySelector('.wo-progress');
    if (bar) {
      bar.style.setProperty('--wo-done', String(total ? done / total : 0));
      bar.setAttribute('aria-valuemax', String(total));
      bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-label', t('progress_aria', { n: done, total }));
    }
    const left = this.root.querySelector('.wo-count-left'), cleared = this.root.querySelector('.wo-count-done');
    if (left) left.textContent = t('count_left', { n: total - done });
    if (cleared) cleared.textContent = t('count_done', { n: done });
    const restart = this.root.querySelector('.wo-restart');
    if (restart) restart.classList.toggle('is-idle', done === 0 && this.lives === LIVES && !this.red.some(Boolean));
    if (this.canvas) this.canvas.setAttribute('aria-label', t('board_aria', { n: total - done }));
    this._paintClock();
  }

  // --- the board ----------------------------------------------------------------------------------

  _bindBoard() {
    this.canvas = this.root.querySelector('.wo-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._onDown = (ev) => this._tap(ev);
    this.canvas.addEventListener('pointerdown', this._onDown);
    this._paintHud(false);
    // A ResizeObserver as well as onViewportResize: the stage also changes size when the
    // stylesheet lands after the first paint, or a flex settle moves it (docs/BUILDING-A-GAME.md,
    // "The .hub-game height trap"). Without it the first frame could keep a zero-size board.
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this._layout());
      this.ro.observe(this.root.querySelector('.wo-stage'));
    }
    this._layout();
    if (this.anims.length || this.parts.length || this.won || this.hintId >= 0) this._kick();
    // Test seam for test-visual.mjs's PLAY probe (the sudoku pattern): read-only state, and where
    // on screen an arrow is, so the probe can tap it through the real input path.
    try {
      window.__woTest = {
        state: () => ({ left: this._left(), lives: this.lives, level: this.level, tier: this.tier,
          rush: this.rush ? { arrows: this.rush.arrows, boards: this.rush.boards, mistakes: this.rush.mistakes, over: this.rush.over, msLeft: Math.round(this._rushLeft()),
            paused: this.rush.paused, counting: this.rush.counting } : null }),
        clearId: () => hintArrow(this.lvl, this.gone, null, this.busy),
        blockedId: () => this.lvl.arrows.findIndex((c, id) => !this.gone[id] && blockerOf(c, this.occ, this.lvl.cols, this.lvl.rows, id)),
        pointOf: (id) => {
          const p = this.pts[id], r = this.canvas.getBoundingClientRect();
          return { x: r.left + (p[0].x + p[1].x) / 2, y: r.top + (p[0].y + p[1].y) / 2 };
        },
      };
    } catch { /* no window */ }
  }

  /** Size the canvas to its stage and work out the point pitch. Measured, every time. */
  _layout() {
    if (this.screen !== 'play' || !this.canvas) return;
    const stage = this.root.querySelector('.wo-stage');
    if (!stage || !this.root.isConnected) return;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;   // the ResizeObserver calls again once it has a size
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { cols: W, rows: H } = this.lvl;
    // The reference leaves a margin either side on small boards (the 40px cap) and runs edge to
    // edge on big ones.
    // Small boards may grow to fill the width (Matt's Easy mock-up, 2026-10-14; the cap was 40px).
    const pitch = Math.min((r.width - 10) / W, (r.height - 10) / H, 72);
    this.pitch = pitch;
    this.ox = (r.width - W * pitch) / 2 + pitch / 2;
    this.oy = (r.height - H * pitch) / 2 + pitch / 2;
    // Thicker arrows (Matt, 2026-10-14: "a little thicker"); still scaled to the pitch so a dense
    // Expert board stays readable.
    // THICK ARROWS on Matt's devices (2026-10-16): he drew one over a Hard board, *"I want all the
    // arrows to be more like this one"* (shaft about a third of the dot gap, head about two thirds
    // wide), to make the right one easier to pick out and hit. Since the same day it is a switch
    // on the Levels screen for everyone (`_thick()`: Matt's devices default on); Rush draws the same.
    if (this._thick()) {
      this.lw = pitch * 0.3;
      this.headL = pitch * 0.52;
    } else {
      this.lw = Math.max(1.7, Math.min(6, pitch * 0.092));
      this.headL = Math.max(5, Math.min(17, pitch * 0.28));
    }
    // Only a real change of geometry counts (a ResizeObserver also calls once on observe).
    const geom = `${pitch}|${this.ox}|${this.oy}`, moved = this.geomWas && this.geomWas !== geom;
    this.geomWas = geom;
    this.pts = this.lvl.arrows.map((cells) => cells.map((c) => this._xy(c)));
    if (moved && this.anims.length) {
      for (const a of this.anims) {
        if (a.kind === 'bump' && !a.hit) { a.hit = true; this._bumped(a.id); }
        this.busy[a.id] = false;
      }
      this.anims = [];
      this.parts = [];
      this._kick();
    }
    this._fitHud();
    this._draw();
  }

  /** The level title is centred on the screen unless that would put it against the buttons beside
   *  it (a narrow phone, with the hub's back button taking the left of the row). Measured. */
  _fitHud() {
    const mid = this.root.querySelector('.wo-hud-mid');
    const left = this.root.querySelector('.wo-hud [data-act="menu"]');
    const right = this.root.querySelector('.wo-hud .wo-restart');
    if (!mid || !left || !right) return;
    this.root.classList.remove('is-tight');
    const m = mid.getBoundingClientRect();
    const tight = m.left < left.getBoundingClientRect().right + 6 || m.right > right.getBoundingClientRect().left - 6;
    this.root.classList.toggle('is-tight', tight);
  }

  _xy(c) {
    const W = this.lvl.cols;
    return { x: this.ox + (c % W) * this.pitch, y: this.oy + ((c / W) | 0) * this.pitch };
  }

  /** The arrow nearest the finger, if it is near enough. Tap targets on Hard and Expert are
   *  necessarily smaller than 44px (the reference's are too: 20+ points across a phone); nearest
   *  arrow wins, so a tap anywhere close still lands, the dots-boxes approach (way-out/CLAUDE.md). */
  _tap(ev) {
    if (this.won || this.failed || this.screen !== 'play') return;
    if (this.rush && this.rush.paused) return;      // the countdown before a Rush board: not yet
    if (ev.button !== undefined && ev.button !== 0) return;   // primary button / touch / pen only
    ev.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    let best = -1, bestD = Infinity;
    this.lvl.arrows.forEach((cells, id) => {
      if (this.gone[id] || this.busy[id]) return;
      const p = this.pts[id];
      for (let k = 1; k < p.length; k++) {
        const d = segDist(px, py, p[k - 1], p[k]);
        if (d < bestD) { bestD = d; best = id; }
      }
    });
    if (best < 0 || bestD > Math.max(this.pitch * 0.7, 22)) return;
    this._send(best);
  }

  _send(id) {
    const { cols: W, rows: H } = this.lvl;
    const cells = this.lvl.arrows[id];
    if (this.hintId === id) this.hintId = -1;
    const block = blockerOf(cells, this.occ, W, H, id);
    const p = this.pts[id];
    const len = pathLen(p);
    const [dx, dy] = dirOf(cells, W);
    const head = p[p.length - 1];
    this.busy[id] = true;
    if (!block) {
      // Out it goes: off the board at once (so the next tap already sees the way clear), then the
      // animation carries it off the screen.
      this.gone[id] = true;
      for (const c of cells) if (this.occ[c] === id) this.occ[c] = -1;
      const toEdge = dx > 0 ? this.cw - head.x : dx < 0 ? head.x : dy > 0 ? this.ch - head.y : head.y;
      const far = toEdge + len + 30;
      const path = p.concat([{ x: head.x + dx * far, y: head.y + dy * far }]);
      const dur = Math.max(320, Math.min(720, 260 + (far / this.pitch) * 14));
      this.anims.push({ id, kind: 'go', path, len, total: far, t0: performance.now(), dur });
      if (this.rush) this._rushGain();
      this._save();
      this._paintHud(false);
      if (!this._left()) this.won = true;
    } else {
      // Bump: forward until the head touches the blocker, back again; red, and a life gone.
      const reach = Math.max(this.pitch * 0.25, block.steps * this.pitch - this.lw * 2 - 1);
      const path = p.concat([{ x: head.x + dx * reach, y: head.y + dy * reach }]);
      this.anims.push({ id, kind: 'bump', path, len, total: reach, t0: performance.now(), dur: 420, hit: false });
    }
    this._kick();
  }

  _hint() {
    if (this.won || this.failed || !this.lvl) return;
    // A hint still pulsing is the same hint: tapping again does not charge again.
    if (this.hintId >= 0 && performance.now() - this.hintT0 < 2600) return;
    const id = hintArrow(this.lvl, this.gone, this.red, this.busy);
    if (id < 0) return;
    this.hintId = id;
    this.hintT0 = performance.now();
    if (this.clock) this.clock.hints += 1;
    this._penalty(woHintMs(this.tier));
    this._kick();
  }

  _kick() {
    if (!this.raf) this.raf = requestAnimationFrame((now) => this._frame(now));
  }

  _frame(now) {
    this.raf = 0;
    const live = [];
    for (const a of this.anims) {
      const u = Math.min(1, (now - a.t0) / a.dur);
      if (a.kind === 'bump') {
        const fwd = 0.4;
        if (u >= fwd && !a.hit) { a.hit = true; this._bumped(a.id); }
        a.s = u < fwd ? a.total * easeOut(u / fwd) : a.total * (1 - easeInOut((u - fwd) / (1 - fwd)));
      } else {
        a.s = a.total * (u * u * 0.55 + u * 0.45);   // gathers speed as it leaves
        if (!reduceMotion() && Math.random() < 0.9) this._spark(a);
      }
      if (u < 1) live.push(a); else this.busy[a.id] = false;
    }
    this.anims = live;
    this.parts = this.parts.filter((q) => now - q.t0 < q.life);
    if (this.won && !this.failed && !this.anims.length && !this.wave) this._celebrate(now);
    this._draw(now);
    const hintOn = this.hintId >= 0 && now - this.hintT0 < 2600;
    if (!hintOn && this.hintId >= 0 && now - this.hintT0 >= 2600) this.hintId = -1;
    const waving = this.wave && now - this.wave.t0 < 1400;
    if (this.anims.length || this.parts.length || hintOn || waving) this._kick();
  }

  _bumped(id) {
    if (this.rush) { if (!this.rush.over) this._rushMiss(id); return; }   // Rush: time, not hearts
    if (this.failed) return;   // a second bump in flight after the last heart: nothing more to lose
    this.red[id] = true;
    this.lives = Math.max(0, this.lives - 1);
    if (this.clock) this.clock.mistakes += 1;
    // The first heart lost costs the tier's base time, the second double (Matt, 2026-10-13). The
    // third ends the attempt; the clock keeps running into the retry, which is its own cost.
    if (this.lives > 0) this._penalty(woMistakeMs(this.tier, LIVES - this.lives));
    this._paintHud(true);
    this._save();
    if (this.lives === 0) {
      this.failed = true;
      this._clockPause();
      if (!this.replay) resetSave(this.tier, this.level, this.src);
      this._later(() => this._showFail(), 650);
    }
  }

  _spark(a) {
    const pos = pointAt(a.path, a.s + a.len);
    const hues = ['#2fd3c0', '#2f7fd8', '#33c46e', '#5b4fd6', '#5fe0ff'];
    this.parts.push({
      x: pos.x + (Math.random() - 0.5) * this.pitch * 0.5, y: pos.y + (Math.random() - 0.5) * this.pitch * 0.5,
      vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, r: 1 + Math.random() * Math.max(1.5, this.pitch * 0.09),
      c: hues[(Math.random() * hues.length) | 0], t0: performance.now(), life: 450 + Math.random() * 300,
    });
  }

  _celebrate(now) {
    // Rush: the same finish (green wave, confetti, the word), with the clock PAUSED, then the Ready
    // screen and a 3-2-1 before the next board (Matt, 2026-10-14).
    if (this.rush) { if (!this.rush.over && !this.rush.paused) this._rushBoardDone(now); return; }
    this._confetti(now);
    const motion = !reduceMotion();
    if (this.replay) { this._replayDone(motion); return; }
    // Record once, then move the player on (the level number only ever goes up). The clock stops
    // at the last arrow; its time (penalties in) is recorded with the finish.
    this._clockPause();
    const c = this.clock || { ms: 0, pen: 0, mistakes: 0, hints: 0, partial: true };
    const fin = { timeMs: c.ms, penaltyMs: c.pen, arrows: this.lvl.arrows.length, rounds: this.rounds, mistakes: c.mistakes, hints: c.hints, timed: !c.partial,
      // The log's `l` names the BOARD with `g`: for a ladder board it is that generator's own number
      // (a first-ladder board carried across keeps its first-ladder number), so (l, g) rebuilds it.
      level: this.src.k === 'L' ? this.src.n : this.level, gen: this.gen };
    try {
      recordWayOut(this.tier, fin);
    } catch (err) {
      console.error('[way-out] recordWayOut failed - the level was NOT recorded', err);
    }
    this._paintClock();
    // Shown under the win word: the level's time, penalties in, and what the level earned (hints and
    // lost lives cost points since 2026-10-17; an untimed level keeps its full points).
    const earned = c.partial ? woLevelPoints(this.level, this.tier) : woEarnedPoints(this.tier, (c.mistakes | 0) + (c.hints | 0));
    this.winSub = `${woClock(c.ms + c.pen)} · ${t('lv_pts', { n: earned })}`;
    writeClock(this.tier, null);
    this.clock = null;
    clearSave(this.tier);
    this.settings = saveSettings({ ladder: { [this.tier]: this.level + 1 } });
    this._later(() => this._banner(), motion ? 650 : 100);
    // On to the next level. Easy, Medium and Hard ended at 50 / 100 / 200 until 2026-10-26; with the
    // more levels they go on, like Expert (admin only until released: hasNews). Without them the
    // last level of a difficulty goes back to the setup screen, which says "Complete".
    if (!hasNews() && this.level + 1 > bandEnd(this.tier)) this._later(() => this._toSetup(false), motion ? 2300 : 1500);
    else this._later(() => this._startLevel(this.tier, this.level + 1), motion ? 2300 : 1500);
  }

  /** A replay cleared: record it (only a better result adds points), show what it added, then back
   *  to the setup screen, with the list again if there is still something to win back. */
  _replayDone(motion) {
    this._clockPause();
    if (this.replay.test) {
      const c = this.clock, n = this.replay.test;
      addTest(n, { t: Math.round(c.ms + c.pen), m: c.mistakes, h: c.hints, d: Date.now() });
      this._paintClock();
      this.winSub = woClock(c.ms + c.pen);
      this.clock = null;
      this._later(() => this._banner(), motion ? 650 : 100);
      this._later(() => { this._toSetup(false); this._openTests(); }, motion ? 2300 : 1500);
      return;
    }
    const c = this.clock, { l, g } = this.replay;
    let up = null;
    try {
      up = recordWayOutReplay(this.tier, { timeMs: c.ms, penaltyMs: c.pen, arrows: this.lvl.arrows.length, rounds: this.rounds,
        mistakes: c.mistakes, hints: c.hints, level: l, gen: g });
    } catch (err) { console.error('[way-out] recordWayOutReplay threw - the replay was NOT recorded', err); }
    if (up == null) console.error('[way-out] the replay was NOT recorded', { tier: this.tier, l, g });
    this._paintClock();
    this.winSub = `${woClock(c.ms + c.pen)} · ${t('lv_pts', { n: up | 0 })}`;
    this.clock = null;
    this._later(() => this._banner(), motion ? 650 : 100);
    this._later(() => {
      this._toSetup(false);
      if (woMissed(this._myWayout(), this.settings.tier).length) this._openReplays();
    }, motion ? 2300 : 1500);
  }

  /** The win's green wave and confetti (the wave is drawn by _draw, the confetti by _frame). */
  _confetti(now) {
    this.wave = { t0: now };
    if (reduceMotion()) return;
    const hues = ['#f5c330', '#e0353f', '#2f7fd8', '#33c46e', '#ff8a2a', '#5fe0ff', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 380;
      this.parts.push({
        x: this.cw / 2, y: this.ch / 2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 120, g: 520,
        r: 2.5 + Math.random() * 4, c: hues[i % hues.length], t0: now + Math.random() * 120, life: 1300 + Math.random() * 600, conf: true,
        rot: Math.random() * 6,
      });
    }
  }

  _banner() {
    const b = this.root.querySelector('.wo-banner');
    if (!b) return;
    // A replay goes back to the setup screen, so never "Next level" (win_5) after one.
    b.querySelector('span').textContent = t('win_' + (1 + ((Math.random() * (this.replay ? 4 : 5)) | 0)));
    const sub = b.querySelector('b');
    if (sub) sub.textContent = this.winSub || '';
    b.classList.add('is-on');
  }

  _showFail() {
    const m = this.root.querySelector('.wo-modal');
    if (!m) return;
    m.innerHTML = `
      <div class="gh-modal wo-dialog" role="dialog" aria-modal="true" aria-labelledby="wo-fail-h">
        <button type="button" class="gh-modal__close" data-act="fail-close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="wo-fail-h">${t('fail_title')}</h2>
        <div class="wo-fail-hearts" aria-hidden="true">${HEART.repeat(3)}</div>
        <p class="wo-fail-txt">${t('fail_body')}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="retry">${t('try_again')}</button>
          <button type="button" class="gh-btn gh-btn--block" data-act="fail-close">${t('change_diff')}</button>
        </div>
      </div>`;
    m.hidden = false;
    m.querySelector('.gh-btn--primary').focus({ preventScroll: true });
  }

  // --- RUSH (2026-10-14) ------------------------------------------------------------------------
  // js/arrow-maze-time.js "RUSH" has the rules. The clock counts DOWN from RUSH_START_MS, never
  // pauses, and ends the run at zero; leaving (the menu, the hub's back button, the app going to the
  // background) loses the run. Boards come from engine.js's buildRush with one random seed per run,
  // the next one built while the current one is played.

  _myWayout() {
    try { return loadStats().games.wayout; } catch { return null; }
  }

  /** The Rush setup card (2026-10-14, after Matt's reviews): Easy / Hard with nothing under them,
   *  the three rule tiles (the same tiles as Levels), Play Rush, and the footer card: the selected
   *  version's leader this week and See all results. */
  _rushHomeHTML(modeTabs) {
    const rm = this.settings.rushMode;
    for (const m of RUSH_MODES) this._settleRushSave(m, false);
    const saved = readRushSave(rm);
    const segs = RUSH_MODES.map((m) => `
      <button type="button" class="wo-seg wo-seg--slim${m === rm ? ' is-selected' : ''}" data-act="rush-mode" data-rmode="${m}" role="radio" aria-checked="${m === rm}">
        <span class="wo-seg-top">${diffShapeSVG(TIER_NUM[m])}<b>${t('tier_' + m)}</b></span>
      </button>`).join('');
    const tiles = this._tilesHTML([
      { cls: 'is-start', icon: RUSH_WATCH, v: `${RUSH_START_MS / 1000}s`, l: t('rush_tile_start') },
      { cls: 'is-gain', icon: RUSH_ARROW('currentColor'), v: `+${RUSH_GAIN_MS / 1000}s`, l: t('rush_tile_gain') },
      { cls: 'is-miss', icon: RUSH_ARROW('currentColor'), v: rushMissMs(rm, 0) ? `\u2212${rushMissMs(rm, 0) / 1000}s` : '0s', l: t('rush_tile_miss') },
    ], t('rush_rules_aria'));
    return `
      <div class="wo-home is-rush">
        <div class="wo-herorow">
          <div class="wo-hero is-rush" aria-hidden="true">${HERO_SVG}<span class="wo-hero-badge">${RUSH_WATCH}</span></div>
        </div>
        <div class="wo-head">
          <h1>${t('title')}</h1>
        </div>
        ${modeTabs}
        <div class="gh-card wo-menu-card">
          <div class="wo-segs wo-segs--two" role="radiogroup" aria-label="${t('diff_label')}">${segs}</div>
          ${tiles}
          ${saved ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block wo-play wo-rush-play" data-act="rush-resume">${t('resume')}</button>` : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block wo-play wo-rush-play" data-act="rush-play">${t('rush_play')}</button>`}
        </div>
        <div class="wo-lead">${this._rushLeaderHTML(rm)}</div>
      </div>`;
  }

  /** The leader of the selected version this week, read in the background (the Results read, at
   *  most once a minute); this phone's own best is always its fresh local one. Ties are all named;
   *  nobody yet (or not read yet) is "-" and "-" (Matt). Then See all results, on that version. */
  _rushLeaderHTML(mode) {
    const st = this.rushStanding;
    if (!st || Date.now() - st.at > 60000) this._loadRushStanding();
    const week = woWeekKey(), mine = woRushBest(this._myWayout(), mode);
    const rows = ((st && st.rows) || []).map((r) => {
      let v = r.best[mode] && r.best[mode][week];
      if (r.me && mine != null) v = Math.max(v == null ? -1 : v, mine);
      return { ...r, s: v == null ? null : v };
    }).filter((r) => r.s != null);
    if (!rows.some((r) => r.me) && mine != null) rows.push({ me: true, s: mine, name: '', emoji: '' });
    const topS = rows.reduce((m, r) => Math.max(m, r.s), -1);
    const top = rows.filter((r) => r.s === topS);
    return this._leadHTML(`🏆 ${t('rush_leader_label', { name: t('tier_' + mode) })}`,
      top.length ? top.map((r) => this._leadName(r)).join(' & ') : '-',
      top.length ? String(topS) : '-',
      `<button type="button" class="wo-rl-all is-more" data-act="rush-board" data-rmode="${mode}">${t('leaderboard')}</button>`);
  }
  _loadRushStanding() {
    if (this._standingBusy) return;
    this._standingBusy = true;
    const done = (rows) => {
      this._standingBusy = false;
      this.rushStanding = { at: Date.now(), rows };
      if (this.root && this.screen === 'home') {
        const el = this.root.querySelector('.wo-lead');
        if (el) el.innerHTML = this.settings.mode === 'rush' ? this._rushLeaderHTML(this.settings.rushMode) : this._levelsLeaderHTML();
        const mine = this.root.querySelector('.wo-tiles .is-mine b');
        if (mine) mine.textContent = String(this._myPoints());
      }
    };
    this._loadRushRows().then((res) => done(res.rows || []), () => done([]));
  }

  _rushPlayHTML() {
    const m = this.rush.mode;
    return `
      <div class="wo-game is-rush">
        <div class="wo-hud">
          <button type="button" class="wo-iconbtn" data-act="menu" aria-label="${t('menu_aria')}">${ICON_MENU}</button>
          <div class="wo-hud-mid">
            <span class="wo-tierpill">${diffShapeSVG(TIER_NUM[m])}${t('mode_rush')} · ${t('tier_' + m)}</span>
            <span class="wo-level wo-rush-boardno"></span>
          </div>
          <span class="wo-iconbtn wo-restart wo-ghost" aria-hidden="true"></span>
        </div>
        <div class="wo-rushbar">
          <span class="wo-rushtime" aria-label="${t('rush_time_aria')}">${RUSH_WATCH}<b></b></span>
          <span class="wo-rushclock" role="timer" aria-label="${t('rush_clock_aria')}"></span>
          <span class="wo-pen" aria-hidden="true"></span>
          <span class="wo-rushscore"></span>
        </div>
        <div class="wo-progress" role="progressbar" aria-valuemin="0"><i></i></div>
        <div class="wo-stage${this.rush.veil ? ' is-veiled' : ''}"><canvas class="wo-canvas" tabindex="0" role="application"></canvas></div>
        <div class="wo-banner" aria-live="polite"><span></span><b></b></div>
        <div class="wo-count" aria-live="assertive"></div>
      </div>`;
  }

  _startRush(mode) {
    this._stopLevel();
    const seed = (Math.random() * 4294967296) >>> 0;
    this.tier = mode;
    this.clock = null;
    this._helpPaused = false;
    // THE FIRST BOARD GETS THE COUNTDOWN TOO (Matt, 2026-10-14: "When you first click start on a
    // rush game it's instant. It needs a countdown just like we have between maps"). The run opens
    // PAUSED and counting, with the board veiled (`veil`, .wo-stage.is-veiled) and taps refused;
    // 3, 2, 1, Go! (the same _rushCountdown the boards after it use), and the clock starts at Go.
    const r = { mode, seed, i: 0, arrows: 0, boards: 0, mistakes: 0, bank: RUSH_START_MS, t0: 0, playMs: 0, over: null, next: null,
      paused: true, counting: true, veil: true, prevBest: woRushBest(this._myWayout(), mode), ...this._rushData(null) };
    this.rush = r;
    this._rushSetBoard(buildRush(mode, 0, seed));
    this.screen = 'play';
    this.render();
    this.rushTick = setInterval(() => this._rushTickFn(), 100);
    this._rushPaint();
    this._rushPrebuild();
    this._rushCountdown(r, () => {
      r.veil = false;
      const st = this.root && this.root.querySelector('.wo-stage');
      if (st) st.classList.remove('is-veiled');
      r.paused = false;
      r.counting = false;
      r.t0 = performance.now();
      this._rushFreezeIfHeld(r);
      this._rushPaint();
    });
  }
  /** A run's tuning data (see woRushExtras), fresh or from its save `s`. `a0` / `p0` = arrows and
   *  play ms when the current board began. */
  _rushData(s) {
    const x = (s && s.x) || {};
    return { bt: x.bt || [], ba: x.ba || [], bc: x.bc || [], mx: x.mx || [], mb: x.mb || [], pk: x.pk || RUSH_START_MS,
      gn: x.gn || 0, pn: x.pn || 0, res: x.res || 0, rv: s ? (x.rv || 2) : RUSH_RULES, a0: s ? s.a0 : 0, p0: s ? s.p0 : 0 };
  }
  /** The tuning data to store with a run. */
  _rushExtras(r) {
    return { bt: r.bt, ba: r.ba, bc: r.bc, mx: r.mx, mb: r.mb, pk: Math.round(r.pk), gn: r.gn, pn: r.pn, res: r.res, rv: r.rv };
  }
  /** If a Rush run is saved between boards, open it (the newest, if both versions have one) and
   *  return true. Runs left mid-board or from a finished week are recorded first, never opened. */
  _resumeAnyRush() {
    if (this.rush && !this.rush.over) return false;
    for (const m of RUSH_MODES) this._settleRushSave(m, false);
    const saved = RUSH_MODES.map((m) => ({ m, s: readRushSave(m) })).filter((x) => x.s && !x.s.live).sort((a, b) => b.s.d - a.s.d)[0];
    if (!saved) return false;
    if (this.settings.mode !== 'rush' || this.settings.rushMode !== saved.m) this.settings = saveSettings({ mode: 'rush', rushMode: saved.m });
    this._resumeRush(saved.m);
    return !!this.rush;
  }
  /** "Later" on the Ready screen: the run is already saved (_rushBoardDone); back to the hub. Opened
   *  on its own page (no hub), back to the setup screen. */
  _rushLater() {
    const r = this.rush;
    if (!r || r.over || !r.atReady || r.counting) return;
    const back = document.querySelector('.hub-back');
    if (back && back.getClientRects().length) { back.click(); return; }
    this.rush = null;
    this._stopLevel();
    this.screen = 'home';
    this.render();
  }
  /** Back into a run saved between boards: its cleared board (veiled), its clock, the Ready screen. */
  _resumeRush(mode) {
    const s = readRushSave(mode);
    if (!s || s.live || woWeekKey(s.d) !== woWeekKey()) { this.render(); return; }
    this._stopLevel();
    this.tier = mode;
    this.clock = null;
    this._helpPaused = false;
    const r = { mode, seed: s.seed, i: s.i, arrows: s.arrows, boards: s.boards, mistakes: s.mistakes, bank: s.bank, t0: 0, playMs: s.playMs,
      over: null, next: null, paused: true, counting: false, veil: true, atReady: true, prevBest: woRushBest(this._myWayout(), mode), ...this._rushData(s) };
    r.res += 1;
    this.rush = r;
    this._rushSetBoard(buildRush(mode, s.i, s.seed));
    this.screen = 'play';
    this.render();   // paused, not counting, no timers: the Ready screen
    this.rushTick = setInterval(() => this._rushTickFn(), 100);
    this._rushPaint();
    this._rushPrebuild();
  }
  /** Record a saved run and clear its slot: always when `force` (New game replaces it), else only
   *  one that was left mid-board (`live`) or whose week is over. A waiting run counts, in the week it
   *  was saved; a live one is a lost run (kept, never counted), unless it ended on time. The slot is
   *  cleared only once the record is written. */
  _settleRushSave(mode, force) {
    const s = readRushSave(mode);
    if (!s || this.rush && this.rush.mode === mode && !this.rush.over) return;
    if (!force && !s.live && woWeekKey(s.d) === woWeekKey()) return;
    const left = s.end ? s.end === 'left' : s.live;
    let st = null;
    try {
      st = recordWayOutRush(mode, { rv: 2, ...s.x, arrows: s.arrows, boards: s.boards, ms: s.playMs, mistakes: s.mistakes, seed: s.seed, left, at: s.d });
    } catch (err) { console.error('[way-out] recordWayOutRush threw - the saved run was NOT recorded', err); }
    if (st) writeRushSave(mode, null);
    else console.error('[way-out] the saved Rush run was NOT recorded; kept', mode, s);
  }
  /** Left the game during the countdown after Ready: stop it, back to the Ready screen. */
  _rushBackToReady() {
    const r = this.rush;
    if (!r || r.over || !r.counting) return;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    r.counting = false;
    const c = this.root && this.root.querySelector('.wo-count');
    if (c) { c.classList.remove('is-on'); c.innerHTML = ''; }
    this._showRushReady();
  }
  /** Matt's devices only (see _onVis): the app went away (`away`) or came back. Away: a running
   *  clock stops where it is (`held`, `heldFroze`); a countdown or Ready screen is left as it is,
   *  and if a countdown finishes while away, _rushFreezeIfHeld stops the clock at once. Back: a
   *  clock this stopped runs again from the same number. */
  _rushHold(away) {
    const r = this.rush;
    if (!r || r.over) return;
    if (away) {
      r.held = true;
      if (!r.paused) this._rushFreeze(r);
    } else {
      r.held = false;
      if (r.heldFroze) {
        r.heldFroze = false;
        r.paused = false;
        r.t0 = performance.now();
      }
      this._rushPaint();
    }
  }
  _rushFreeze(r) {
    r.bank = this._rushLeft();
    if (r.t0) r.playMs += performance.now() - r.t0;
    r.t0 = 0;
    r.paused = true;
    r.heldFroze = true;
  }
  _rushFreezeIfHeld(r) { if (r.held && !r.paused) this._rushFreeze(r); }
  _rushSetBoard(lvl) {
    this.lvl = lvl;
    const n = lvl.arrows.length;
    this.gone = new Array(n).fill(false);
    this.red = new Array(n).fill(false);
    this.busy = new Array(n).fill(false);
    this.occ = occupancy(lvl, this.gone);
    this.anims = [];
    this.lives = LIVES;
    this.hintId = -1;
    this.kbSel = -1;
    this.won = false;
    this.failed = false;
    this.wave = null;
    this.geomWas = null;
    this.level = this.rush.i + 1;
  }
  /** Milliseconds left on the Rush clock. */
  _rushLeft() {
    const r = this.rush;
    if (!r) return 0;
    if (r.over) return Math.max(0, r.leftAtEnd || 0);
    if (r.paused) return r.bank;
    return r.bank - (r.t0 ? performance.now() - r.t0 : 0);
  }
  _rushTickFn() {
    if (!this.rush || this.rush.over || this.rush.paused) return;
    if (this._rushLeft() <= 0) this._rushEnd('time'); else this._rushPaint();
  }
  _rushPaint() {
    const r = this.rush;
    if (!r || !this.root) return;
    const left = Math.max(0, this._rushLeft());
    const clock = this.root.querySelector('.wo-rushclock');
    if (clock) { clock.textContent = (Math.floor(left / 100) / 10).toFixed(1); clock.classList.toggle('is-low', left < 3000); }
    const sc = this.root.querySelector('.wo-rushscore');
    if (sc) sc.textContent = t('rush_arrows', { n: r.arrows });
    const tt = this.root.querySelector('.wo-rushtime b');
    if (tt) tt.textContent = woRushTime(this._rushPlayed());
    const bn = this.root.querySelector('.wo-rush-boardno');
    if (bn) bn.textContent = t('rush_board', { n: r.i + 1 });
  }
  /** How long this run has been PLAYED (ms): the pauses between boards are not in it. */
  _rushPlayed() {
    const r = this.rush;
    return r ? r.playMs + (r.t0 && !r.paused ? performance.now() - r.t0 : 0) : 0;
  }
  _rushGain() {
    const r = this.rush;
    r.arrows += 1;
    r.bank += RUSH_GAIN_MS;
    r.gn += RUSH_GAIN_MS;
    r.pk = Math.max(r.pk, this._rushLeft());
    this._flashPen(`+${RUSH_GAIN_MS / 1000}s`, false);
    this._rushPaint();
  }
  _rushMiss(id) {
    const r = this.rush;
    this.red[id] = true;
    r.mistakes += 1;
    const miss = rushMissMs(r.mode, r.i);
    r.bank -= miss;
    r.pn += miss;
    r.mx.push(miss);
    r.mb.push(r.i + 1);
    if (miss) this._flashPen(`\u2212${miss / 1000}s`, true);
    this._rushPaint();
    if (this._rushLeft() <= 0) this._rushEnd('time');
  }
  /** A board cleared: stop the clock where it is, play the normal finish, then the Ready screen. */
  _rushBoardDone(now) {
    const r = this.rush;
    r.bank = this._rushLeft();
    if (r.t0) r.playMs += performance.now() - r.t0;
    r.t0 = 0;
    r.paused = true;
    r.boards += 1;
    r.bt.push(Math.round(r.playMs - r.p0));
    r.ba.push(r.arrows - r.a0);
    r.bc.push(Math.round(r.bank));
    r.pk = Math.max(r.pk, r.bank);
    r.p0 = r.playMs;
    r.a0 = r.arrows;
    r.atReady = true;
    this._rushSave(false);
    this._rushPaint();
    this._confetti(now);
    const motion = !reduceMotion();
    this.winSub = t('rush_board_cleared', { n: r.boards });
    this._later(() => this._banner(), motion ? 650 : 100);
    this._later(() => this._showRushReady(), motion ? 2000 : 700);
  }
  /** The Ready popup, in the play screen's own look (Matt, 2026-10-14: "More on theme"): the dark
   *  board colours, the seconds in the leaving-arrow teal, the two rules as arrow chips (teal arrow
   *  +0.5s, red arrow -3s: a sign and a word, never colour alone), then Ready. */
  _showRushReady() {
    const r = this.rush, m = this.root && this.root.querySelector('.wo-modal');
    if (!r || r.over || !r.paused || r.counting || r.heldFroze || !m) return;
    const secs = (Math.floor(r.bank / 100) / 10).toFixed(1);
    const arrow = RUSH_ARROW, miss = rushMissMs(r.mode, r.i + 1);   // the NEXT board's cost
    // Seconds lost to mistakes on the board just cleared (Matt, 2026-10-22). Nothing when none.
    const lost = r.mx.reduce((n, c, k) => n + (r.mb[k] === r.i + 1 ? c : 0), 0);
    m.innerHTML = `
      <div class="wo-ready" role="dialog" aria-modal="true" aria-labelledby="wo-ready-h">
        <p class="wo-ready-done" id="wo-ready-h"><span aria-hidden="true">✓</span>${t('rush_board_cleared', { n: r.boards })}</p>
        <p class="wo-ready-secs"><b>${secs}</b><i>s</i><span class="wo-sr">${t('rush_next_secs')}</span></p>
        ${lost ? `<p class="wo-ready-lost">${t('rush_board_lost', { s: lost / 1000 })}</p>` : ''}
        <ul class="wo-ready-rules">
          <li class="is-gain">${arrow('#3fd6bd')}<span class="wo-sr">${t('rush_rule_gain', { gain: RUSH_GAIN_MS / 1000 })}</span><b aria-hidden="true">+${RUSH_GAIN_MS / 1000}s</b></li>
          <li class="is-miss">${arrow('#e0484f')}<span class="wo-sr">${t('rush_rule_miss', { miss: miss / 1000 })}</span><b aria-hidden="true">\u2212${miss / 1000}s</b></li>
        </ul>
        <p class="wo-ready-stats">${t('rush_arrows', { n: r.arrows })}</p>
        <button type="button" class="wo-ready-btn" data-act="rush-ready">${t('rush_ready_btn')}</button>
        <button type="button" class="wo-ready-later" data-act="rush-later">${t('rush_later')}</button>
      </div>`;
    m.hidden = false;
    m.querySelector('.wo-ready-btn').focus({ preventScroll: true });
  }
  /** Ready: 3, 2, 1, Go!, then the next board and the clock again. The board stays hidden until Go. */
  _rushReady() {
    const r = this.rush;
    if (!r || r.over || !r.paused || r.counting) return;
    r.counting = true;
    this._closeModal();
    const b = this.root.querySelector('.wo-banner');
    if (b) b.classList.remove('is-on');
    this._rushCountdown(r, () => this._rushGo());
  }
  /** 3, 2, 1, Go! over the board (`.wo-count`), then `done` (which clears it). Abandoned if the run
   *  ends or a new one starts. */
  _rushCountdown(r, done) {
    const steps = ['3', '2', '1', t('rush_go')];
    const show = (k) => {
      if (this.rush !== r || r.over) return;
      const el = this.root.querySelector('.wo-count');
      if (el) {
        el.innerHTML = `<b class="${k === steps.length - 1 ? 'is-go' : ''}">${steps[k]}</b>`;
        el.classList.add('is-on');
      }
      if (k === steps.length - 1) this._later(() => {
        if (this.rush !== r || r.over) return;
        const c = this.root.querySelector('.wo-count');
        if (c) { c.classList.remove('is-on'); c.innerHTML = ''; }
        done();
      }, 550);
      else this._later(() => show(k + 1), 750);
    };
    show(0);
  }
  _rushGo() {
    const r = this.rush;
    if (!r || r.over) return;
    const el = this.root.querySelector('.wo-count');
    if (el) { el.classList.remove('is-on'); el.innerHTML = ''; }
    r.i += 1;
    r.atReady = false;
    this._rushSave(true);   // its next board is on screen: no longer resumable
    if (r.veil) {
      r.veil = false;
      const st = this.root.querySelector('.wo-stage');
      if (st) st.classList.remove('is-veiled');
    }
    const lvl = r.next && r.next.i === r.i ? r.next.lvl : buildRush(r.mode, r.i, r.seed);
    r.next = null;
    this._rushSetBoard(lvl);
    this.parts = [];
    this.pts = null;
    this._layout();
    this._paintHud(false);
    r.paused = false;
    r.counting = false;
    r.t0 = performance.now();
    this._rushFreezeIfHeld(r);
    this._rushPaint();
    this._rushPrebuild();
  }
  /** This run into its save slot (see RUSH_SAVE_KEY). */
  _rushSave(live, end) {
    const r = this.rush;
    writeRushSave(r.mode, { seed: r.seed, i: r.i, arrows: r.arrows, boards: r.boards, mistakes: r.mistakes,
      bank: Math.max(0, Math.round(r.bank)), playMs: Math.round(r.playMs), d: Date.now(), live: live ? 1 : 0, ...(end ? { end } : {}),
      a0: r.a0, p0: Math.round(r.p0), ...this._rushExtras(r) });
  }
  _rushPrebuild() {
    const r = this.rush, i = r.i + 1;
    this._later(() => { if (this.rush === r && !r.over) r.next = { i, lvl: buildRush(r.mode, i, r.seed) }; }, 60);
  }
  /** The run is over: the clock ran out ('time'), or the player left ('left', which loses it). Kept
   *  either way (THE LAW); only a run that ran its clock out counts. */
  _rushEnd(why, quiet = false) {
    const r = this.rush;
    if (!r || r.over) return;
    // How long the run was PLAYED: the pauses between boards are not in it.
    const ms = Math.round(r.playMs + (r.t0 && !r.paused ? performance.now() - r.t0 : 0));
    r.leftAtEnd = why === 'time' ? 0 : Math.max(0, this._rushLeft());
    r.over = why;
    r.totalMs = ms;
    // The board the run ended on, if any of it was played.
    if (ms > r.p0 || r.arrows > r.a0) { r.bt.push(Math.max(0, Math.round(ms - r.p0))); r.ba.push(r.arrows - r.a0); }
    if (this.rushTick) { clearInterval(this.rushTick); this.rushTick = 0; }
    this.failed = true;   // no more taps
    let st = null;
    try {
      st = recordWayOutRush(r.mode, { ...this._rushExtras(r), arrows: r.arrows, boards: r.boards, ms, mistakes: r.mistakes, seed: r.seed, left: why === 'left' });
    } catch (err) { console.error('[way-out] recordWayOutRush threw - the run was NOT recorded', err); }
    if (!st) console.error('[way-out] the Rush run was NOT recorded', { mode: r.mode, arrows: r.arrows });
    // Recorded: its save slot (if any) is done with. Not recorded: kept, to be recorded next time.
    if (st) { if (readRushSave(r.mode)) writeRushSave(r.mode, null); }
    else { r.playMs = ms; this._rushSave(true, why); }
    r.weekBest = woRushBest(st ? st.games.wayout : this._myWayout(), r.mode);
    r.newBest = why === 'time' && r.arrows > 0 && r.arrows > (r.prevBest == null ? -1 : r.prevBest);
    if (quiet || !this.root || this.screen !== 'play') return;
    this._rushPaint();
    this._showRushEnd();
  }
  _showRushEnd() {
    const m = this.root.querySelector('.wo-modal'), r = this.rush;
    if (!m || !r) return;
    const lost = r.over === 'left';
    m.innerHTML = `
      <div class="gh-modal wo-dialog" role="dialog" aria-modal="true" aria-labelledby="wo-rush-h">
        <button type="button" class="gh-modal__close" data-act="rush-close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="wo-rush-h">${t(lost ? 'rush_lost' : 'rush_over')}</h2>
        <p class="wo-rush-big"><b>${r.arrows}</b><span>${t('rush_arrows_word', { n: r.arrows })}</span></p>
        <p class="wo-rush-time">${RUSH_WATCH}<b>${woRushTime(r.totalMs)}</b></p>
        ${lost ? `<p class="wo-fail-txt">${t('rush_lost_body')}</p>` : `
        <p class="wo-fail-txt">${t('rush_boards_done', { n: r.boards })}</p>
        ${r.newBest ? `<p class="wo-rush-new">${t('rush_new_best')}</p>` : ''}
        <p class="wo-fail-txt">${t('rush_week_best', { n: r.weekBest == null ? 0 : r.weekBest })}</p>`}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="rush-again">${t('rush_again')}</button>
          <button type="button" class="gh-btn gh-btn--block" data-act="rush-board">${t('rush_results')}</button>
        </div>
      </div>`;
    m.hidden = false;
    m.querySelector('.gh-btn--primary').focus({ preventScroll: true });
  }

  // --- the footers' leaders --------------------------------------------------------------------------
  // Everyone's synced records (players/), with this phone's own fresh store for itself, combined
  // per PERSON by js/players-agg.js (a week's best is the best on any of their phones). Read once
  // per opening. Offline: only this phone's own runs.

  async _loadRushRows() {
    let all = {}, offline = false;
    const local = this._myWayout();
    let rows = [];
    // The server-built board first (2026-10-22): everyone else from the ~60 KB package, this person
    // from their own devices + this phone's fresh store (aggregateForViewer, a few KB). Same people
    // and the same numbers as the full read below, without downloading all of players/.
    try {
      const net = await import('../../js/stats-net.js');
      const people = await net.readPeople();
      if (people) {
        const [{ aggregateForViewer }, { isHiddenName }, { loadProfile }] = await Promise.all([
          import('../../js/players-agg.js'), import('../../js/hidden-players.js'), import('../../js/profile-store.js')]);
        const me = aggregateForViewer(await net.readPlayersForMe(), loadProfile() || {}, statsId(), loadStats());
        const row = (g, mine) => ({
          name: g.name, emoji: g.emoji, me: mine, pts: woPoints(g.games.wayout),
          best: Object.fromEntries(RUSH_MODES.map((m) => [m, woRushBestMap(((((g.games.wayout || {}).wo || {}).rush || {}).best || {})[m])])),
        });
        rows = people.list.filter((g) => g.key !== people.meKey && !isHiddenName(g.name)).map((g) => row(g, false));
        if (me) rows.push(row(me, true));
        return { rows, offline: false };
      }
    } catch (err) { console.warn('[way-out] board read failed, using the full read', err); }
    try {
      const net = await import('../../js/stats-net.js');
      all = await net.readPlayersOnce();
      if (!all || !Object.keys(all).length) offline = true;
    } catch { offline = true; }
    try {
      const [{ aggregatePlayers, buildIdentity }, { isHiddenName }, { loadProfile }] = await Promise.all([
        import('../../js/players-agg.js'), import('../../js/hidden-players.js'), import('../../js/profile-store.js')]);
      const merged = Object.assign({}, all || {});
      const myId = statsId(), prof = loadProfile() || {};
      merged[myId] = { profile: Object.assign({}, (merged[myId] || {}).profile || {}, { name: prof.name || '', emoji: prof.emoji || '', playerId: prof.playerId || '' }),
        stats: loadStats(), updatedAt: Number.MAX_SAFE_INTEGER };
      // This phone's own person: the group its own device id falls in (the same test as
      // aggregateForViewer), so it is found even with no player code.
      const myKey = buildIdentity(merged).keyFor(merged[myId].profile, myId);
      const isMe = (g) => g.key === myKey;
      // Test accounts are hidden as on the leaderboard, except from themselves.
      rows = aggregatePlayers(merged).filter((g) => isMe(g) || !isHiddenName(g.name)).map((g) => ({
        name: g.name, emoji: g.emoji, me: isMe(g), pts: woPoints(g.games.wayout),
        best: Object.fromEntries(RUSH_MODES.map((m) => [m, woRushBestMap(((((g.games.wayout || {}).wo || {}).rush || {}).best || {})[m])])),
      }));
    } catch (err) {
      console.error('[way-out] Rush results could not be combined', err);
      rows = [{ name: '', emoji: '', me: true, best: Object.fromEntries(RUSH_MODES.map((m) => [m, woRushBestMap(((((local || {}).wo || {}).rush || {}).best || {})[m])])) }];
      offline = true;
    }
    return { rows, offline };
  }
  /** The hub's leaderboard on Arrow Maze (2026-10-16, Matt: "for Minesweeper, we linked the
   *  Leaderboard. Let's do that instead"), opened on Levels or on one Rush version. It replaced this
   *  game's own Levels results and Rush results screens. */
  /** Thick arrows on? The player's own choice; never chosen = on for Matt's devices only. */
  _thick() {
    const v = this.settings && this.settings.thick;
    return typeof v === 'boolean' ? v : isAdminDevice();
  }
  async _openLeaderboard(woMode, woRush) {
    try {
      const m = await import('../../js/leaderboard-ui.js');
      await m.openLeaderboard({ game: 'wayout', woMode, woRush });
    } catch (err) { console.error('[way-out] leaderboard', err); }
  }

  // --- drawing ------------------------------------------------------------------------------------

  _draw(now = performance.now()) {
    const ctx = this.ctx;
    if (!ctx || !this.pts) return;
    const css = getComputedStyle(this.root);
    const col = (n, d) => (css.getPropertyValue(n) || '').trim() || d;
    const cDot = col('--wo-dot', '#3a3b55'), cArrow = col('--wo-arrow', '#b3b4e0'), cRed = col('--wo-red', '#d8343f');
    const cGo = col('--wo-go', '#3fd6bd'), cWin = col('--wo-win', '#2bd27a'), cHint = '#ffce3a';
    ctx.clearRect(0, 0, this.cw, this.ch);
    const { cols: W, rows: H } = this.lvl;

    // The dots. On a win they turn green in a wave from the middle (the reference does this).
    const dotR = Math.max(1.1, Math.min(3.2, this.pitch * 0.055));
    const wave = this.wave && !reduceMotion() ? (now - this.wave.t0) / 700 : (this.wave ? 9 : -1);
    for (let i = 0; i < W * H; i++) {
      const p = this._xy(i);
      let r = dotR, c = cDot;
      if (wave >= 0) {
        const d = Math.hypot((i % W) - (W - 1) / 2, ((i / W) | 0) - (H - 1) / 2) / Math.max(W, H);
        if (wave > d * 1.6) { c = cWin; r = dotR * 2.2; }
      }
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const moving = new Map(this.anims.map((a) => [a.id, a]));
    const pulse = 0.5 + 0.5 * Math.sin(now / 140);
    this.lvl.arrows.forEach((cells, id) => {
      const a = moving.get(id);
      if (this.gone[id] && !a) return;
      const p = a ? a.path : this.pts[id];
      const len = a ? a.len : pathLen(p);
      const s0 = a ? a.s : 0;
      let color = this.red[id] ? cRed : cArrow;
      if (a && a.kind === 'go') color = cGo;
      const hinted = id === this.hintId;
      if (id === this.kbSel && !a && document.activeElement === this.canvas) {
        drawArrow(ctx, p, s0, s0 + len, cHint, this.lw * 3.4, this.headL * 1.4);
      }
      if (hinted) {
        ctx.save();
        ctx.shadowColor = cHint;
        ctx.shadowBlur = 6 + pulse * 10;
        drawArrow(ctx, p, s0, s0 + len, cHint, this.lw * 1.9, this.headL * 1.25);
        ctx.restore();
      } else {
        drawArrow(ctx, p, s0, s0 + len, color, this.lw, this.headL);
      }
    });

    for (const q of this.parts) {
      const age = (now - q.t0) / 1000;
      if (age < 0) continue;
      const k = 1 - age / (q.life / 1000);
      const x = q.x + q.vx * age, y = q.y + q.vy * age + (q.g ? 0.5 * q.g * age * age : 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.4));
      ctx.fillStyle = q.c;
      if (q.conf) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(q.rot + age * 6);
        ctx.beginPath(); ctx.ellipse(0, 0, q.r * 1.6, q.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(x, y, q.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// --- geometry -----------------------------------------------------------------------------------

function segDist(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  const u = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / L2));
  return Math.hypot(px - (a.x + u * vx), py - (a.y + u * vy));
}
function pathLen(p) {
  let L = 0;
  for (let k = 1; k < p.length; k++) L += Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y);
  return L;
}
/** The point at arc length `s` along polyline `p` (clamped to its ends), with its direction. */
function pointAt(p, s) {
  let acc = 0;
  for (let k = 1; k < p.length; k++) {
    const L = Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y);
    if (acc + L >= s || k === p.length - 1) {
      const u = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      return { x: p[k - 1].x + (p[k].x - p[k - 1].x) * u, y: p[k - 1].y + (p[k].y - p[k - 1].y) * u,
        dx: L ? (p[k].x - p[k - 1].x) / L : 0, dy: L ? (p[k].y - p[k - 1].y) / L : 0 };
    }
    acc += L;
  }
  return { x: p[0].x, y: p[0].y, dx: 0, dy: 0 };
}
/** Draw the part of polyline `p` between arc lengths s0 and s1, with a filled arrowhead at s1.
 *  The shaft stops short of the tip so its round cap never pokes through the point. */
function drawArrow(ctx, p, s0, s1, color, lw, headL) {
  const tip = pointAt(p, s1);
  const stop = s1 - headL * 0.6;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  let started = false, acc = 0;
  for (let k = 1; k < p.length; k++) {
    const a = p[k - 1], b = p[k];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const lo = Math.max(s0, acc), hi = Math.min(stop, acc + L);
    if (hi > lo && L) {
      const u0 = (lo - acc) / L, u1 = (hi - acc) / L;
      const x0 = a.x + (b.x - a.x) * u0, y0 = a.y + (b.y - a.y) * u0;
      if (!started) { ctx.moveTo(x0, y0); started = true; }
      ctx.lineTo(a.x + (b.x - a.x) * u1, a.y + (b.y - a.y) * u1);
    }
    acc += L;
  }
  if (started) ctx.stroke();
  const w = headL * 0.62;
  ctx.beginPath();
  ctx.moveTo(tip.x + tip.dx * lw * 0.6, tip.y + tip.dy * lw * 0.6);
  ctx.lineTo(tip.x - tip.dx * headL - tip.dy * w, tip.y - tip.dy * headL + tip.dx * w);
  ctx.lineTo(tip.x - tip.dx * headL + tip.dy * w, tip.y - tip.dy * headL - tip.dx * w);
  ctx.closePath();
  ctx.fill();
}
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// --- module contract ------------------------------------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  const href = new URL('../css/way-out.css', import.meta.url).href;
  if (!document.querySelector(`link[data-wo-css]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.woCss = '1';
    document.head.appendChild(link);
  }
  instance = new WayOut(container);
  instance.mount();
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** Always false: every change autosaves (see the header). */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
