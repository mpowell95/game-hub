// ui.js — Ball Run UI module. Exposes the hub module contract (init/destroy/
// isInProgress), owns all DOM/screens, and drives the fixed-timestep sim loop
// (brief section 3). Game rules/state live in sim.js and track.js, kept
// separate from this file per the build guide's module split.

import { Sim, RunState } from './sim.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { SIM_DT, MAX_STEPS_PER_FRAME, DEFAULT_DIFFICULTY, DEFAULT_MAP, MAPS } from './config.js';
import { loadProfile } from '../../js/profile-store.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordBallRun, loadStats, withMode, activeCode } from '../../js/game-stats.js';
import { appendPlayLog } from '../../js/play-log-queue.js';
import { syncMyStats } from '../../js/stats-net.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';
import { Track } from './track.js';
import { isAdminDevice } from '../../js/admin-config.js';
import { isAdmin } from '../../js/challenge/hooks.js';

/** ORBITAL HARD SCORED LIKE CLASSIC, ADMIN ONLY (2026-11-16, Matt: "for admin, on ball run orbital on hard,
 *  make it so it awards the same points as classic ... Again, admin only"). Hard Orbital gives fewer points
 *  a meter than Hard Classic (about 53 vs 64 a km: fewer obstacle rows, the rest is orbs, splits, jumps).
 *  On Matt's admin device (the device AND his name, Darts' aim-help gate) a Hard Orbital run scores what a
 *  Hard CLASSIC track with the SAME seed would give for the same distance: every Classic obstacle row whose
 *  far edge the ball passed. Frozen at the crash, like Classic. The run's own Orbital score is kept as
 *  `raw` in the private play log. Everyone else, and every other map/level: unchanged. */
export function classicScoringOn(map, difficulty) {
  if (map !== 'orbital' || difficulty !== 'hard') return false;
  try { const p = loadProfile(); return isAdminDevice() && !!(p && p.name && isAdmin(p.name)); } catch { return false; }
}
export class ClassicEquiv {
  constructor(seed) { this.tr = new Track('classic', 'hard', seed); this.n = 0; this.last = -1; }
  at(z) {
    const tr = this.tr;
    tr.ensureAhead(z + 60);
    for (const seg of tr.segments) {
      if (seg.index <= this.last) continue;
      if (seg.z1 > z) break;
      if (seg.type === 'obstacle') this.n += 1;
      this.last = seg.index;
    }
    tr.trimBehind(z - 60);
    return this.n;
  }
}

const t = makeT(STRINGS);
// config.js's own DIFFICULTIES[].label stays English (a tuning/config module, same discipline as
// sim.js/track.js) — this maps the same keys onto translated display text instead.
const DIFF_LABEL_KEY = { easy: 'diff_easy', medium: 'diff_medium', hard: 'diff_hard' };
const MAP_LABEL_KEY = { classic: 'map_classic', orbital: 'map_orbital' };

// Fourth-playthrough item 2: the local per-difficulty personal best changed from distance (meters)
// to obstacle count. Renamed (not just re-valued) so old meter-based bests under the old
// 'ballrun.best.' prefix are simply never read as if they were counts - a fresh key, per this
// module's existing plain-localStorage convention (no old data is touched or deleted, it's just
// orphaned under its old key). BALLRUNMAP2ORBITALSPEC.md Phase 1: this prefix is now the LEGACY,
// difficulty-only (no map) shape - frozen in place per THE LAW rule 5, read only by
// migrateBestScoresToMaps() below. Live reads/writes go through BEST_KEY_PREFIX + '<map>.<diff>'
// (bestKey()) instead.
const BEST_KEY_PREFIX = 'ballrun.bestObstacles.';
const BEST_MAP_MIGRATED_KEY = 'ballrun.bestObstacles.mapMigrated.v1';
const DIFFICULTY_KEY = 'ballrun.difficulty';
const MAP_KEY = 'ballrun.map';
const SEEN_HELP_KEY = 'ballrun.seenHelp';
const DIFF_ORDER = ['easy', 'medium', 'hard'];
const MAP_ORDER = ['classic', 'orbital'];

// Fifth-playthrough incident: a player's finished runs never reached the shared stats store, and
// the only trace of the failure was a swallowed exception nobody could see. `recordBallRun` writing
// straight into the shared multi-game blob is genuinely the more fragile path (shared shape, shared
// migrations, shared code touched by every other game); the local best above never lost anything.
// This is a dead-simple, independent "flight recorder": every finished run is appended here FIRST,
// synchronously, before the shared store is touched at all. If the shared write then fails (throws,
// or silently doesn't move the needle), the entry stays `synced:false` and `reconcileRunLog()` (run
// on every Ball Run open, i.e. before every subsequent play) retries it. A run can now only vanish
// from the leaderboard/My Skills if this log entry AND every later retry all fail, not just one call.
const RUN_LOG_KEY = 'ballrun.runLog.v1';
const RUN_LOG_MAX = 200;

function readRunLog() {
  try {
    const v = JSON.parse(localStorage.getItem(RUN_LOG_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function writeRunLog(log) {
  try { localStorage.setItem(RUN_LOG_KEY, JSON.stringify(log)); } catch (err) { console.error('[ball-run] run log write failed', err); }
}
function appendRunLog(entry) {
  const log = readRunLog();
  log.push(entry);
  while (log.length > RUN_LOG_MAX) log.shift();
  writeRunLog(log);
  return log;
}
function markRunLogSynced(ts) {
  const log = readRunLog();
  const e = log.find((x) => x.ts === ts);
  if (e) { e.synced = true; writeRunLog(log); }
}

/** Attempt the shared-store write for one flight-recorder entry. Verifies the write actually landed
 *  on disk (a FRESH loadStats() re-read afterward, not the in-memory object recordBallRun returns)
 *  rather than trusting "didn't throw" alone: game-stats.js's own persist() swallows storage-write
 *  failures internally, so its returned object can show an incremented count even when nothing was
 *  actually written to localStorage. Returns true only on a confirmed-on-disk new run. Never throws;
 *  logs loudly on any failure so a connected debugging session can see it. */
// BALLRUNMAP2ORBITALSPEC.md Phase 1: an entry's `map` field defaults to 'classic' for run-log
// entries written before this map existed (still awaiting retry from a prior session) - they were
// all genuinely Classic runs, so this is a real default, not a guess. `recordBallRun`'s own default
// mirrors this so the two can never disagree.
function brBucketKey(map) { return map === 'orbital' ? 'brOrbital' : 'br'; }

function trySyncRunEntry(entry) {
  const map = entry.map || 'classic';
  const bucketKey = brBucketKey(map);
  let before = -1;
  try { before = loadStats().games.ballrun[bucketKey].runs | 0; } catch (err) { console.error('[ball-run] pre-write stats read failed', err); }
  try {
    withMode({ map }, entry.difficulty, () => recordBallRun(entry.score, entry.difficulty, map), () => ({ hi: entry.score | 0 }));
  } catch (err) {
    console.error('[ball-run] recordBallRun threw', { entry, err });
    return false;
  }
  let after = -1;
  try { after = loadStats().games.ballrun[bucketKey].runs | 0; } catch (err) { console.error('[ball-run] post-write stats read failed', err); return false; }
  if (after >= 0 && (before < 0 || after > before)) return true;
  console.error('[ball-run] recordBallRun did not confirm a new run (persist may have failed)', { entry, before, after });
  return false;
}

/** Retry any run this device recorded locally but never confirmed reaching the shared store, e.g.
 *  because the shared write threw or silently no-opped last time. Runs on every Ball Run open, so a
 *  failed run gets another chance every time the player comes back, not just once. Idempotent: a
 *  successfully-synced entry is never retried, so this cannot double-count a run that already landed. */
function reconcileRunLog() {
  const log = readRunLog();
  for (const entry of log) {
    if (entry.synced) continue;
    if (trySyncRunEntry(entry)) markRunLogSynced(entry.ts);
  }
}

/** Every number a finished run has (2026-11-16, Matt: "save all data from every play/game/turn/round/
 *  level for all games" ... "somewhere that only I can see and that is never pushed to the player's
 *  phone"). Saved on this phone's run log entry and sent ONLY to the admin play log (`e: 'run'`,
 *  logRunDetail), never into the stats store, players/ or the board every phone downloads.
 *  m = meters, ms = time played, topSpd = top speed x10. Never throws: a bad read drops that number. */
export function runDetail(sim) {
  const d = {};
  const put = (k, f) => { try { const v = f(); if (v != null && Number.isFinite(+v)) d[k] = Math.max(0, Math.floor(+v)); } catch (err) { console.error('[ball-run] run detail', k, err); } };
  put('m', () => sim.z);
  put('ms', () => sim.elapsed * 1000);
  put('obst', () => sim.stats.obst);
  put('tiers', () => sim.tiersPassed);
  put('topSpd', () => sim.stats.topSpeed * 10);
  if (sim.track && sim.track.map && (sim.track.map.split || sim.track.map.jump || sim.track.map.pickups)) {
    put('orbs', () => sim.orbsCollected);
    put('splits', () => sim.stats.splits);
    put('jumps', () => sim.stats.jumps);
    put('jumpMiss', () => sim.stats.jumpMiss);
    put('lifeGot', () => sim.stats.lifeGot);
    put('lifeUsed', () => sim.stats.lifeUsed);
    for (const k of ['obstacle', 'edge', 'void', 'landing']) put('save_' + k, () => (sim.stats.saves || {})[k] | 0);
  }
  try { const c = sim.crashCause || sim.crashReason; if (c) d.end = String(c); } catch { /* the end is optional */ }
  return d;
}

function logRunDetail(entry) {
  try {
    const d = JSON.stringify({ ...(entry.detail || {}), score: entry.score | 0, seed: entry.seed >>> 0 });
    const id = appendPlayLog(activeCode(), { g: 'ballrun', e: 'run', k: String(entry.ts), m: `map=${entry.map}@${entry.difficulty}`, d });
    if (!id) console.error('[ball-run] run detail not queued for the play log (no player code?)', entry);
  } catch (err) { console.error('[ball-run] run detail not logged', err); }
}

/** ONE-TIME: runs this phone logged before 2026-11-16 kept their distance only on the phone (the run
 *  log, newest 200). Each is copied once into the play log (`e: 'oldrun'`, its own time in `k`, the
 *  whole entry in `a`) so it reaches playLog/<CODE>. The run log itself is never changed (THE LAW).
 *  `ballrun.runLogSent.v1` = the newest entry time copied; it moves only past entries that queued. */
const RUN_LOG_SENT_KEY = 'ballrun.runLogSent.v1';
function sendOldRunsOnce() {
  const code = activeCode();
  if (!code) return;
  let sent = 0;
  try { sent = +localStorage.getItem(RUN_LOG_SENT_KEY) || 0; } catch { sent = 0; }
  let top = sent;
  for (const e of readRunLog()) {
    if (!e || !(+e.ts > sent) || e.detail) continue; // newer runs went up with their own 'run' entry (logRunDetail)
    const id = appendPlayLog(code, {
      g: 'ballrun', e: 'oldrun', k: String(e.ts), m: `map=${e.map || 'classic'}@${e.difficulty || '-'}`,
      a: JSON.stringify({ ts: e.ts, score: e.score, distance: e.distance, map: e.map || 'classic', difficulty: e.difficulty }),
    });
    if (!id) { console.error('[ball-run] an old run was not queued; it will be tried again next open', e); break; }
    top = Math.max(top, +e.ts);
  }
  if (top > sent) {
    try {
      localStorage.setItem(RUN_LOG_SENT_KEY, String(top));
      if (+localStorage.getItem(RUN_LOG_SENT_KEY) !== top) console.error('[ball-run] old-run stamp did not stick; they may queue again (duplicates, never losses)');
    } catch (err) { console.error('[ball-run] old-run stamp not saved; they may queue again', err); }
  }
}

function ensureStylesheet() {
  const href = new URL('../css/ball-run.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/ball-run.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function bestKey(map, difficulty) { return `${BEST_KEY_PREFIX}${map}.${difficulty}`; }

/** One-time, guarded migration of the local per-difficulty best-score key onto the new
 *  per-map-per-difficulty shape (BALLRUNMAP2ORBITALSPEC.md section 4: "do not lose anything").
 *  Every pre-Phase-1 best IS a Classic best (Orbital didn't exist yet), so this copies each old
 *  `ballrun.bestObstacles.<diff>` value forward to `ballrun.bestObstacles.classic.<diff>`,
 *  verifies the write by an immediate fresh re-read, and marks itself done only once every
 *  difficulty has either migrated clean or had nothing to migrate. The old keys are NEVER
 *  written to or deleted - if a re-read ever disagreed, this key is simply not folded into the
 *  "done" guard and the next app open retries it, exactly like the shared-store retry pattern
 *  above (RUN_LOG_KEY). */
function migrateBestScoresToMaps() {
  try {
    if (localStorage.getItem(BEST_MAP_MIGRATED_KEY) === '1') return;
    let allOk = true;
    for (const d of DIFF_ORDER) {
      const oldKey = BEST_KEY_PREFIX + d;
      const oldRaw = localStorage.getItem(oldKey);
      if (oldRaw === null) continue; // nothing to migrate for this difficulty
      const newKey = bestKey('classic', d);
      if (localStorage.getItem(newKey) !== null) continue; // never overwrite an existing new-shape value
      localStorage.setItem(newKey, oldRaw);
      if (localStorage.getItem(newKey) !== oldRaw) {
        console.error('[ball-run] best-score map migration failed to verify by re-read', { difficulty: d, oldKey, newKey });
        allOk = false;
      }
    }
    if (allOk) localStorage.setItem(BEST_MAP_MIGRATED_KEY, '1');
  } catch (err) {
    console.error('[ball-run] best-score map migration threw', err);
  }
}

function loadBest(map, difficulty) {
  try {
    const v = parseInt(localStorage.getItem(bestKey(map, difficulty)) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

function saveBest(map, difficulty, obstaclesPassed) {
  try { localStorage.setItem(bestKey(map, difficulty), String(Math.floor(obstaclesPassed))); } catch { /* ignore */ }
}

function loadSavedDifficulty() {
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY);
    return DIFF_ORDER.includes(v) ? v : null;
  } catch { return null; }
}

function saveDifficulty(v) {
  try { localStorage.setItem(DIFFICULTY_KEY, v); } catch { /* ignore */ }
}

function loadSavedMap() {
  try {
    const v = localStorage.getItem(MAP_KEY);
    return MAP_ORDER.includes(v) ? v : null;
  } catch { return null; }
}

function saveMap(v) {
  try { localStorage.setItem(MAP_KEY, v); } catch { /* ignore */ }
}

// Skill tiers (build guide section 5) map 1:1 onto Ball Run's three difficulties.
const SKILL_TO_DIFFICULTY = { 1: 'easy', 2: 'medium', 3: 'hard' };

// Four-slide how-to-play pager (2026-07-24 restore, HANDOFF-FB2-HOWTO2 item 2: Matt liked the
// pager, he just wanted the broken "|<-" first-page button fixed into a real previous, and an
// obstacles slide added since obstacles are the main thing being dodged). Every still is drawn
// with the same track colors render.js actually uses (COLOR_TRACK_TILE fill, COLOR_OBSTACLE /
// COLOR_OBSTACLE_EDGE, COLOR_CHEVRON) so each sheet matches what the player sees in-game.
function stillSteer() {
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${t('help_1')}">
    <rect width="200" height="200" fill="#000"/>
    <path d="M14 196 L100 40 L186 196 Z" fill="#2b2f6b"/>
    <path d="M14 196 L100 40" stroke="#8f9aef" stroke-width="3" fill="none"/>
    <path d="M100 40 L152 118" stroke="#8f9aef" stroke-width="3" fill="none"/>
    <path d="M162 134 L186 196" stroke="#39f4ff" stroke-width="3" stroke-dasharray="3 5" fill="none"/>
    <path d="M50 160 L150 160" stroke="#8f9aef" stroke-width="1.2" opacity="0.6"/>
    <path d="M70 122 L130 122" stroke="#8f9aef" stroke-width="1" opacity="0.6"/>
    <circle cx="88" cy="140" r="19" fill="#e91ec4"/>
    <ellipse cx="81" cy="133" rx="6" ry="4" fill="#ff9fe6" opacity="0.7"/>
    <g stroke="#39f4ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <line x1="44" y1="182" x2="156" y2="182"/>
      <path d="M44 182 l16 -11 M44 182 l16 11"/>
      <path d="M156 182 l-16 -11 M156 182 l-16 11"/>
      <circle cx="100" cy="182" r="9" fill="#000"/>
    </g>
  </svg>`;
}
function stillObstacles() {
  // Two obstacle cubes (COLOR_OBSTACLE fill, COLOR_OBSTACLE_EDGE stroke) with the ball
  // lined up in the gap between them, the way render.js's cube meshes read from the front.
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${t('help_2')}">
    <rect width="200" height="200" fill="#000"/>
    <path d="M10 196 L100 40 L190 196 Z" fill="#2b2f6b"/>
    <path d="M50 158 L150 158" stroke="#8f9aef" stroke-width="1.2" opacity="0.6"/>
    <path d="M67 120 L133 120" stroke="#8f9aef" stroke-width="1" opacity="0.6"/>
    <rect x="52" y="100" width="26" height="26" rx="2" fill="#9b1fd6" stroke="#ff5fe0" stroke-width="2"/>
    <rect x="122" y="100" width="26" height="26" rx="2" fill="#9b1fd6" stroke="#ff5fe0" stroke-width="2"/>
    <circle cx="100" cy="152" r="19" fill="#e91ec4"/>
    <ellipse cx="93" cy="145" rx="6" ry="4" fill="#ff9fe6" opacity="0.7"/>
  </svg>`;
}
function stillEdge() {
  // Track skewed hard right with the left edge simply absent past the ball, plus a dashed
  // drop-off line, so "falling off ends the run" reads from the picture alone.
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${t('help_3')}">
    <rect width="200" height="200" fill="#000"/>
    <path d="M120 196 L150 40 L190 40 L190 196 Z" fill="#2b2f6b"/>
    <path d="M150 40 L190 40" stroke="#8f9aef" stroke-width="3" fill="none"/>
    <path d="M190 40 L190 196" stroke="#8f9aef" stroke-width="3" fill="none"/>
    <path d="M120 196 L150 40" stroke="#39f4ff" stroke-width="3" stroke-dasharray="4 6" fill="none"/>
    <path d="M160 150 L184 150" stroke="#8f9aef" stroke-width="1" opacity="0.6"/>
    <circle cx="108" cy="168" r="19" fill="#e91ec4"/>
    <ellipse cx="101" cy="161" rx="6" ry="4" fill="#ff9fe6" opacity="0.7"/>
    <path d="M76 196 L100 178" stroke="#39f4ff" stroke-width="2" stroke-dasharray="2 4" opacity="0.6"/>
    <path d="M50 210 L76 196" stroke="#39f4ff" stroke-width="2" stroke-dasharray="2 4" opacity="0.35"/>
  </svg>`;
}
function stillSpeedpoint() {
  // The in-game speedpoint tunnel (render.js's isTunnel segment): cyan side rails, a
  // brighter floor, plus motion streaks trailing the ball for the acceleration cue.
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${t('help_4')}">
    <rect width="200" height="200" fill="#2b0a3d"/>
    <path d="M0 0 L100 46 L200 0 Z" fill="#9b1fd6" opacity="0.5"/>
    <path d="M0 200 L100 148 L200 200 Z" fill="#3a2f7b"/>
    <path d="M18 178 L100 116 L182 178" fill="none" stroke="#39f4ff" stroke-width="9" stroke-linecap="round"/>
    <path d="M42 152 L100 116 L158 152" fill="none" stroke="#39f4ff" stroke-width="9" stroke-linecap="round"/>
    <g stroke="#39f4ff" stroke-width="3" stroke-linecap="round" opacity="0.7">
      <line x1="60" y1="196" x2="80" y2="176"/>
      <line x1="100" y1="200" x2="100" y2="178"/>
      <line x1="140" y1="196" x2="120" y2="176"/>
    </g>
    <circle cx="100" cy="150" r="16" fill="#e91ec4"/>
    <ellipse cx="93" cy="143" rx="5" ry="3.5" fill="#ff9fe6" opacity="0.7"/>
  </svg>`;
}

const HELP_PAGES = [
  { still: stillSteer, textKey: 'help_1' },
  { still: stillObstacles, textKey: 'help_2' },
  { still: stillEdge, textKey: 'help_3' },
  { still: stillSpeedpoint, textKey: 'help_4' },
];

// HAZARD AND JUMP CUES, ADMIN DEVICES ONLY until Matt says "release it" (2026-11-17, Matt on the mockup:
// "looks great - build it"; docs/BALL-RUN-UX-REVIEW.md). `cuesOn()` is read once at mount and once per
// run; off = every screen exactly as before.
function cuesOn() { try { return isAdminDevice(); } catch { return false; } }

// How to play, cues on (2026-11-17, Matt: "the how to play is atrocious. please improve."): every picture is a
// REAL frame from the game renderer with cues on (ball-run/img/help/*.jpg, 720x900 = the 360x450 box at 2x, made
// by tools/ballrun-ux/help-frames.cjs), one short caption, one overlay. Classic shows pages 1-4 in its own colours;
// Orbital shows 1-8. Players (cues off) keep HELP_PAGES above exactly.
// `mark`: 'steer' = a finger on a two-way arrow; [x, y, side] = an arrow pointing at (x, y) in the 360x450 box,
// coming from above-left ('l') or above-right ('r') (tools/ballrun-ux/help-frames.cjs prints the projected targets).
function helpImg(name) { return new URL(`../img/help/${name}.jpg`, import.meta.url).href; }
const CUE_HELP_CLASSIC = [
  { img: 'steer-classic', key: 'hp_steer', mark: 'steer' },
  { img: 'blocks-classic', key: 'hp_blocks', mark: [115, 132, 'r'] },
  { img: 'edge-classic', key: 'hp_edge', mark: [207, 256, 'r'] },
  { img: 'tunnel-classic', key: 'hp_tunnel', mark: [184, 120, 'r'] },
];
const CUE_HELP_ORBITAL = [
  { img: 'steer-orbital', key: 'hp_steer', mark: 'steer' },
  { img: 'blocks-orbital', key: 'hp_blocks', mark: [245, 131, 'l'] },
  { img: 'edge-orbital', key: 'hp_edge', mark: [207, 256, 'r'] },
  { img: 'tunnel-orbital', key: 'hp_tunnel', mark: [180, 120, 'r'] },
  { img: 'hole', key: 'hp_hole', mark: [298, 200, 'l'] },
  { img: 'jump', key: 'hp_jump', mark: [114, 171, 'l'] },
  { img: 'droprise', key: 'hp_droprise', mark: [130, 116, 'r'] },
  { img: 'pickups', key: 'hp_pickups', mark: [212, 160, 'r'] },
];

/** The overlay drawn on a help picture: shape only (white with a dark outline), never colour alone. */
function helpMarkSVG(mark) {
  const open = '<svg class="br-help-mark" viewBox="0 0 360 450" aria-hidden="true">';
  const ink = 'fill="#fff" stroke="#0b0d14" stroke-width="5" stroke-linejoin="round"';
  if (mark === 'steer') {
    return `${open}<g ${ink}>
      <path d="M96 404 L122 384 V396 H238 V384 L264 404 L238 424 V412 H122 V424 Z"/>
      <path d="M166 446 V392 a14 14 0 0 1 28 0 V446 Z"/>
    </g></svg>`;
  }
  const [x, y, side] = mark;
  const dx = side === 'l' ? -1 : 1;
  // An arrow from 78 px away at 45 degrees; its head stops 12 px short of the target.
  const tx = x + dx * 55, ty = y - 55, k = 12 / 78;
  const hx = x + dx * 55 * k, hy = y - 55 * k;
  const ang = Math.atan2(hy - ty, hx - tx), c = Math.cos(ang), sn = Math.sin(ang);
  const p = (a, b) => `${(hx + a * c - b * sn).toFixed(1)} ${(hy + a * sn + b * c).toFixed(1)}`;
  return `${open}<g ${ink}>
    <path d="M${p(-62, -6)} L${p(-20, -6)} L${p(-20, -16)} L${p(0, 0)} L${p(-20, 16)} L${p(-20, 6)} L${p(-62, 6)} Z"/>
  </g></svg>`;
}

// Game over, cues on: a picture of what ended the run (sim.crashCause), so the hazards teach themselves.
const CAUSE_ICONS = {
  obstacle: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="16" y="14" width="32" height="32" rx="2" fill="#aab2bd" stroke="#ffce3a" stroke-width="2"/><circle cx="32" cy="54" r="7" fill="#8fe9ff"/></svg>`,
  edge: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M4 30 H36 V38 H4 Z" fill="#242e45"/><rect x="4" y="28" width="32" height="3" fill="#8ea3c8"/><circle cx="48" cy="48" r="7" fill="#8fe9ff"/><path d="M40 20 Q46 26 48 38" fill="none" stroke="#eef0ff" stroke-width="2.5" stroke-dasharray="3 4"/></svg>`,
  void: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><pattern id="br-hzi" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#16120a"/><rect width="4" height="8" fill="#ffce3a"/></pattern></defs><rect x="2" y="24" width="20" height="10" fill="#242e45"/><rect x="42" y="24" width="20" height="10" fill="#242e45"/><rect x="16" y="24" width="6" height="22" fill="url(#br-hzi)"/><rect x="42" y="24" width="6" height="22" fill="url(#br-hzi)"/><circle cx="32" cy="44" r="7" fill="#8fe9ff"/></svg>`,
  landing: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="40" width="18" height="8" fill="#242e45"/><rect x="40" y="30" width="22" height="8" fill="#242e45"/><rect x="40" y="29" width="22" height="3" fill="#5fe3ff"/><g fill="#5fe3ff"><circle cx="24" cy="30" r="2"/><circle cx="30" cy="24" r="2"/><circle cx="36" cy="22" r="2"/></g><circle cx="34" cy="54" r="7" fill="#8fe9ff"/></svg>`,
};

class BallRunUI {
  constructor(container) {
    ensureStylesheet();
    this.container = container;

    // Retry any run recorded locally last session that never confirmed reaching the shared
    // stats/leaderboard store (see RUN_LOG_KEY above). Cheap no-op when there's nothing to retry.
    try { reconcileRunLog(); } catch (err) { console.error('[ball-run] reconcile on open failed', err); }
    try { sendOldRunsOnce(); } catch (err) { console.error('[ball-run] old runs not sent', err); }
    // One-time, guarded local best-score migration onto the per-map shape (see its own doc
    // comment). Cheap no-op once migrated.
    migrateBestScoresToMaps();

    const profile = loadProfile();
    const opp = profile && profile.opponents && profile.opponents[0];
    const skillDefault = SKILL_TO_DIFFICULTY[opp && opp.skill];
    this.difficulty = loadSavedDifficulty() || skillDefault || DEFAULT_DIFFICULTY;
    this.map = loadSavedMap() || DEFAULT_MAP;

    this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.sim = null;
    this.renderer = null;
    this.input = null;
    this.rafId = 0;
    this.running = false;
    this.helpPage = 0;
    this.helpReturnScreen = 'setup';
    this._lastTime = 0;
    this._acc = 0;
    this._pausedForVisibility = false;
    this._resultRecorded = false;

    this._onVisibilityChange = () => this.handleVisibilityChange();
    this._onResize = () => this.handleResize();

    // Lock page scroll for the whole time this route is mounted (item 3):
    // .br-root is fixed full-viewport, but an unlocked body can still
    // rubber-band/scroll on iOS Safari on touch drag. Restored in destroy().
    this._prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    this.mount();
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this._offViewport = onViewportResize(this._onResize);
  }

  /** Map picker (BALLRUNMAP2ORBITALSPEC.md section 4: "two cards, name plus a small visual
   *  preview swatch. No description text, no helper copy"). Each swatch is a tiny inline SVG
   *  built straight from that map's own `MAPS[key].colors` (config.js) — the same colors
   *  render.js actually paints the track with, never a separate art asset to keep in sync. */
  mapCardsHTML() {
    return MAP_ORDER.map((m) => {
      const c = MAPS[m].colors;
      const hex = (n) => '#' + n.toString(16).padStart(6, '0');
      return `
      <button type="button" class="br-mapcard${m === this.map ? ' is-selected' : ''}"
        data-map="${m}" role="radio" aria-checked="${m === this.map}" aria-label="${t(MAP_LABEL_KEY[m])}">
        <svg class="br-mapswatch" viewBox="0 0 48 30" aria-hidden="true">
          <rect width="48" height="30" fill="${hex(c.void)}"/>
          <path d="M4 28 L24 6 L44 28 Z" fill="${hex(c.trackTile)}"/>
          <path d="M4 28 L24 6" stroke="${hex(c.obstacleEdge)}" stroke-width="2" fill="none"/>
          <path d="M44 28 L24 6" stroke="${hex(c.obstacleEdge)}" stroke-width="2" fill="none"/>
          <circle cx="24" cy="22" r="3.2" fill="${hex(c.ball)}"/>
        </svg>
        <span>${t(MAP_LABEL_KEY[m])}</span>
      </button>`;
    }).join('');
  }

  /** Standard 3-option segmented control (colored shape + label), same shape as every other
   *  game's difficulty picker (2026-07-24 redesign — see root CLAUDE.md, "Ball Run setup
   *  redesign": no faces, no slider, no blurb). */
  diffSegsHTML() {
    return DIFF_ORDER.map((d) => `
      <button type="button" class="br-seg${d === this.difficulty ? ' is-selected' : ''}"
        data-diff="${d}" role="radio" aria-checked="${d === this.difficulty}">
        ${diffShapeSVG(tierOf(d))}<span>${t(DIFF_LABEL_KEY[d])}</span>
      </button>
    `).join('');
  }

  // --- DOM construction -------------------------------------------------

  mount() {
    this.container.innerHTML = `
      <div class="br-root">
        <section class="br-setup" data-role="setup">
          <h1 class="br-title">${t('title')}</h1>
          <div class="br-mapcards" data-role="map-cards" role="radiogroup" aria-label="${t('map_aria')}">${this.mapCardsHTML()}</div>
          <div class="br-best" data-role="setup-best"></div>
          <div class="br-segmented" data-role="diff-segmented" role="radiogroup" aria-label="${t('diff_aria')}">${this.diffSegsHTML()}</div>
          <div class="br-setup-actions">
            <button type="button" class="br-btn br-btn-primary" data-role="play">${t('play')}</button>
            <button type="button" class="br-btn br-btn-help" data-role="help-open" aria-label="${t('howto_aria')}">?</button>
          </div>
        </section>

        <section class="br-game" data-role="game" hidden>
          <canvas class="br-canvas" data-role="canvas"></canvas>
          <div class="br-hud" data-role="hud">
            <div class="br-hud-score" data-role="score" aria-label="${t('score_aria')}">
              <svg class="br-hud-cube" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 7 L12 12 L21 7 M12 12 V22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              <span data-role="score-value">0</span>
            </div>
            <div class="br-hud-distance" data-role="distance">0 m</div>
            <div class="br-hud-tiers" data-role="tiers"></div>
            <div class="br-hud-orbs" data-role="orbs" aria-label="${t('orbs_aria')}" hidden>
              <span class="br-orb-dot"></span>
              <span data-role="orbs-value">0</span>
            </div>
            <div class="br-hud-lives" data-role="lives" aria-label="${t('lives_aria')}"></div>
          </div>
          <div class="br-floaters" data-role="floaters" aria-hidden="true"></div>
          <div class="br-life-used" data-role="life-used" aria-live="polite"></div>
          <div class="br-gate" data-role="resume-gate" hidden>
            <button type="button" class="br-btn br-btn-primary" data-role="resume">${t('resume')}</button>
          </div>
          <div class="br-overlay" data-role="gameover" hidden>
            <div class="br-panel">
              <button type="button" class="br-help-close" data-action="close-gameover" aria-label="${t('close')}">&times;</button>
              <div class="br-go-cause" data-role="go-cause" hidden></div>
              <h2 data-role="go-title">${t('run_over')}</h2>
              <p class="br-go-score" data-role="go-score"></p>
              <p class="br-go-distance" data-role="go-distance"></p>
              <p class="br-go-best" data-role="go-best"></p>
              <div class="br-panel-actions">
                <button type="button" class="br-btn br-btn-primary" data-role="play-again">${t('play_again')}</button>
                <button type="button" class="br-btn br-btn-ghost" data-role="go-hub">${t('back_to_hub')}</button>
              </div>
            </div>
          </div>
        </section>

        <div class="br-help-overlay" data-role="help" hidden>
          <div class="br-help-panel">
            <button type="button" class="br-help-close" data-action="close-help" aria-label="${t('close')}">&times;</button>
            <h2 class="br-help-title">${t('howto_title')}</h2>
            <div class="br-help-card">
              <div class="br-help-still" data-role="help-still"></div>
              <p class="br-help-text" data-role="help-text"></p>
            </div>
            <div class="br-help-dots" data-role="help-dots"></div>
            <div class="br-help-nav">
              <button type="button" class="br-btn br-btn-nav" data-action="help-prev" aria-label="${t('prev_page_aria')}">&larr;</button>
              <button type="button" class="br-btn br-btn-primary" data-action="help-ok">${t('ok')}</button>
              <button type="button" class="br-btn br-btn-nav" data-action="help-next" aria-label="${t('next_page_aria')}">&rarr;</button>
            </div>
          </div>
        </div>
      </div>`;

    const root = this.container.querySelector('.br-root');
    const q = (sel) => root.querySelector(sel);
    this.el = {
      root,
      setup: q('[data-role="setup"]'),
      setupBest: q('[data-role="setup-best"]'),
      mapCards: q('[data-role="map-cards"]'),
      diffSegmented: q('[data-role="diff-segmented"]'),
      play: q('[data-role="play"]'),
      helpOpen: q('[data-role="help-open"]'),
      game: q('[data-role="game"]'),
      canvas: q('[data-role="canvas"]'),
      hud: q('[data-role="hud"]'),
      score: q('[data-role="score"]'),
      scoreValue: q('[data-role="score-value"]'),
      distance: q('[data-role="distance"]'),
      tiers: q('[data-role="tiers"]'),
      orbs: q('[data-role="orbs"]'),
      orbsValue: q('[data-role="orbs-value"]'),
      lives: q('[data-role="lives"]'),
      floaters: q('[data-role="floaters"]'),
      lifeUsed: q('[data-role="life-used"]'),
      resumeGate: q('[data-role="resume-gate"]'),
      resumeBtn: q('[data-role="resume"]'),
      gameover: q('[data-role="gameover"]'),
      goCause: q('[data-role="go-cause"]'),
      goTitle: q('[data-role="go-title"]'),
      goScore: q('[data-role="go-score"]'),
      goDistance: q('[data-role="go-distance"]'),
      goBest: q('[data-role="go-best"]'),
      playAgain: q('[data-role="play-again"]'),
      goHub: q('[data-role="go-hub"]'),
      help: q('[data-role="help"]'),
      helpStill: q('[data-role="help-still"]'),
      helpText: q('[data-role="help-text"]'),
      helpDots: q('[data-role="help-dots"]'),
      helpPrev: q('[data-action="help-prev"]'),
      helpNextBtn: q('[data-action="help-next"]'),
    };

    this.syncBestUi();
    this.syncCues();

    this.el.mapCards.addEventListener('click', (e) => {
      const card = e.target.closest('[data-map]');
      if (!card) return;
      this.map = card.dataset.map;
      saveMap(this.map);
      this.el.mapCards.querySelectorAll('.br-mapcard').forEach((b) => {
        const on = b.dataset.map === this.map;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-checked', String(on));
      });
      this.syncBestUi();
    });
    this.el.diffSegmented.addEventListener('click', (e) => {
      const seg = e.target.closest('[data-diff]');
      if (!seg) return;
      this.difficulty = seg.dataset.diff;
      saveDifficulty(this.difficulty);
      this.el.diffSegmented.querySelectorAll('.br-seg').forEach((b) => {
        const on = b.dataset.diff === this.difficulty;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-checked', String(on));
      });
      this.syncBestUi();
    });
    this.el.play.addEventListener('click', () => this.startRun());
    this.el.helpOpen.addEventListener('click', () => this.openHelp('setup'));
    this.el.resumeBtn.addEventListener('click', () => this.resumeFromGate());
    this.el.playAgain.addEventListener('click', () => this.startRun());
    this.el.goHub.addEventListener('click', () => this.showSetup());
    // No "view board" equivalent exists for a finished run (there's nothing more
    // to look at once the run has ended), so the X reuses "Back to hub"'s own
    // handler - same non-destructive exit, just from the corner instead of a
    // labeled button.
    this.el.gameover.querySelector('[data-action="close-gameover"]').addEventListener('click', () => this.showSetup());

    root.querySelector('.br-help-overlay').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'close-help') this.closeHelp();
      else if (action.dataset.action === 'help-ok') this.closeHelp();
      else if (action.dataset.action === 'help-prev') this.helpGo(this.helpPage - 1);
      else if (action.dataset.action === 'help-next') this.helpGo(this.helpPage + 1);
    });

    this.showSetup();

    if (!this.hasSeenHelp()) {
      this.markSeenHelp();
      this.openHelp('setup');
    }
  }

  hasSeenHelp() {
    try { return localStorage.getItem(SEEN_HELP_KEY) === '1'; } catch { return true; }
  }
  markSeenHelp() {
    try { localStorage.setItem(SEEN_HELP_KEY, '1'); } catch { /* ignore */ }
  }

  syncBestUi() {
    const best = loadBest(this.map, this.difficulty);
    this.el.setupBest.textContent = best > 0 ? t('best_passed', { n: best }) : t('no_runs_yet');
  }

  // --- Screens ------------------------------------------------------------

  /** Cues on/off (admin devices only): read here at mount and again at every run start. */
  syncCues() {
    this._cues = cuesOn();
    this.el.root.classList.toggle('br-cues', this._cues);
    // "Back to hub" only ever returned to this game's setup screen; with cues on it says so.
    this.el.goHub.textContent = this._cues ? t('setup') : t('back_to_hub');
  }

  showSetup() {
    this.stopLoop();
    this.teardownRun();
    this.el.game.hidden = true;
    this.el.setup.hidden = false;
    this.syncBestUi();
  }

  startRun() {
    this.teardownRun();
    this.el.setup.hidden = true;
    this.el.game.hidden = false;
    this.el.gameover.hidden = true;
    this.el.resumeGate.hidden = true;

    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this._seed = seed;
    this.sim = new Sim(this.map, this.difficulty, seed);
    this._eq = null; this._eqVal = 0;
    try { if (classicScoringOn(this.map, this.difficulty)) this._eq = new ClassicEquiv(seed); } catch (err) { console.error('[ball-run] classic scoring not set up; the Orbital score counts', err); this._eq = null; }
    this.syncCues();
    this.renderer = new Renderer(this.el.canvas, this.map, { cues: this._cues });
    this.input = new InputController(this.el.canvas);
    this._resultRecorded = false;

    // Pickups HUD state (Phase 4 follow-up): force every pickup-driven readout to redraw on the
    // next updateHud() call, and clear any leftover floaters/banner from a previous run - restart
    // reuses this same DOM (Play Again, back-to-setup-and-Play) rather than remounting it.
    this._lastShownOrbs = -1;
    this._lastShownLives = -1;
    this.el.floaters.innerHTML = '';
    this.el.lifeUsed.classList.remove('is-active');
    if (this._lifeUsedTimer) { clearTimeout(this._lifeUsedTimer); this._lifeUsedTimer = 0; }

    this.handleResize();
    this.renderer.resetCamera(0);
    this.updateHud(true);
    this.startLoop();
  }

  /** `fullExit` is false for an in-game restart (Play/Play Again reuse the same canvas
   *  immediately after) and true for actually leaving the game (hub destroy()) - see
   *  Renderer.dispose()'s doc comment for why forcing context loss on a restart blacks
   *  out the canvas. */
  teardownRun(fullExit = false) {
    this.stopLoop();
    if (this.input) { this.input.destroy(); this.input = null; }
    if (this.renderer) { this.renderer.dispose(fullExit); this.renderer = null; }
    this.sim = null;
  }

  // --- Fixed-step loop ------------------------------------------------------

  startLoop() {
    this.running = true;
    this._acc = 0;
    this._lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  stopLoop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  frame(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > 0.25) dt = 0.25; // clamp a huge stall (e.g. devtools pause) instead of spiral-of-death
    this._acc += dt;

    let steps = 0;
    while (this._acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      const dragAxis = this.input.consumeDragAxis();
      const keyAxis = this.input.keyAxis();
      this.sim.step(dragAxis, keyAxis);
      this._acc -= SIM_DT;
      steps++;
      if (this.sim.isOver()) break;
    }

    // Pickup animations (Phase 4 follow-up): drained here, once per RENDERED frame, not once per
    // sim.step() - several ticks can run per frame under the fixed-timestep accumulator above, and
    // splice-draining the whole queue at once (rather than peeking the last entry) means a frame
    // that happened to contain two collections in the same render still animates both instead of
    // silently dropping one.
    if (this.sim.pickupEvents.length) this.handlePickupEvents(this.sim.pickupEvents.splice(0));

    this.renderer.render(this.sim, this.reducedMotion);
    this.updateHud();

    if (this.sim.isOver()) this.onGameOver();
  }

  /** The run's score: Orbital Hard on Matt's admin device = the Classic Hard equivalent (classicScoringOn). */
  scoreNow() {
    const sim = this.sim;
    if (!sim) return 0;
    if (!this._eq) return sim.score;
    try { if (!sim.crashReason) this._eqVal = this._eq.at(sim.z); } catch (err) { console.error('[ball-run] classic scoring failed; the Orbital score counts', err); this._eq = null; return sim.score; }
    return this._eqVal;
  }

  updateHud(force) {
    if (!this.sim) return;
    // Obstacle count is the primary HUD number (fourth-playthrough item 2); distance stays as a
    // secondary flavor line, never compared against a best.
    const score = this.scoreNow();
    if (force || this._lastShownScore !== score) {
      this._lastShownScore = score;
      this.el.scoreValue.textContent = String(score);
    }
    const meters = Math.floor(this.sim.z);
    if (force || this._lastShownDistance !== meters) {
      this._lastShownDistance = meters;
      this.el.distance.textContent = `${meters} m`;
    }
    const tierCount = Math.min(6, this.sim.tiersPassed);
    if (this._lastShownTiers !== tierCount) {
      this._lastShownTiers = tierCount;
      this.el.tiers.innerHTML = Array.from({ length: tierCount }, () => '<span class="br-pip"></span>').join('');
    }
    // Pickups (Phase 4, Orbital only): `sim.lives` stays 0 for the lifetime of any run that never
    // spawns a life pickup (Classic, or Orbital before this phase), so this row stays empty and
    // this is a no-op for every map/event this file already supported.
    const lives = this.sim.lives || 0;
    if (force || this._lastShownLives !== lives) {
      this._lastShownLives = lives;
      this.el.lives.innerHTML = Array.from({ length: lives }, () => '<span class="br-life"></span>').join('');
    }
    // Orb counter (follow-up to Phase 4): a persistent running tally, separate from the lives row
    // above - reserved-but-hidden on any map/run with no pickups config at all (Classic), same
    // "no-op unless the map actually uses it" shape as lives.
    const hasPickups = !!this.sim.track.map.pickups;
    const orbs = this.sim.orbsCollected || 0;
    if (force || this._lastShownOrbs !== orbs) {
      this._lastShownOrbs = orbs;
      this.el.orbs.hidden = !hasPickups;
      this.el.orbsValue.textContent = String(orbs);
    }
  }

  /** Pickup animations (Phase 4 follow-up): a "+1" floater for an orb, a distinct pink "+1 life"
   *  floater for a life pickup, and an unmissable banner (not just a floater - Matt asked for
   *  something "obvious") when a banked life is actually spent. Anchored to the HUD elements the
   *  respective counters live on, not the ball's screen position - the ball can be anywhere
   *  laterally, but the score/orb/life counters are always in the same place, so anchoring there
   *  reads as "this number just changed" rather than requiring the player to track a floater
   *  drifting across a moving 3D scene. */
  handlePickupEvents(events) {
    for (const ev of events) {
      if (ev.type === 'orb') this.spawnFloater(this.el.score, '+1', 'br-floater-orb');
      else if (ev.type === 'life') this.spawnFloater(this.el.lives, '+1', 'br-floater-life');
      else if (ev.type === 'lifeSpent') this.showLifeUsedBanner();
    }
  }

  spawnFloater(anchorEl, text, extraClass) {
    if (!anchorEl || !this.el.floaters) return;
    const hudRect = this.el.hud.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = `br-floater ${extraClass}`;
    span.textContent = text;
    span.style.left = `${anchorRect.left - hudRect.left + anchorRect.width / 2}px`;
    span.style.top = `${anchorRect.top - hudRect.top}px`;
    this.el.floaters.appendChild(span);
    // Reduced motion (non-negotiable-adjacent accessibility rule this file already follows for
    // camera shake): skip the animation and just remove after a short flat display instead of
    // never showing feedback at all.
    const duration = this.reducedMotion ? 500 : 900;
    span.addEventListener('animationend', () => span.remove());
    if (this.reducedMotion) setTimeout(() => span.remove(), duration);
  }

  showLifeUsedBanner() {
    const el = this.el.lifeUsed;
    if (!el) return;
    el.textContent = t('life_used');
    // Retrigger the CSS animation even if a second life is spent while the first banner is still
    // showing - remove-then-reflow-then-readd is the standard trick for restarting a CSS animation
    // on the same element/class pair.
    el.classList.remove('is-active');
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth;
    el.classList.add('is-active');
    if (this._lifeUsedTimer) clearTimeout(this._lifeUsedTimer);
    this._lifeUsedTimer = setTimeout(() => { el.classList.remove('is-active'); this._lifeUsedTimer = 0; }, 1600);
  }

  // --- Pause / resume (non-negotiable 4) ------------------------------------

  handleVisibilityChange() {
    if (document.hidden) {
      if (this.running) { this.stopLoop(); this._pausedForVisibility = true; this.el.resumeGate.hidden = false; }
    }
  }

  resumeFromGate() {
    this.el.resumeGate.hidden = true;
    this._pausedForVisibility = false;
    if (this.sim && !this.sim.isOver()) this.startLoop();
  }

  handleResize() {
    if (!this.renderer || !this.el.canvas) return;
    const rect = this.el.canvas.parentElement.getBoundingClientRect();
    this.renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  }

  // --- Game over --------------------------------------------------------

  onGameOver() {
    this.stopLoop();
    // Fourth-playthrough item 2: obstacle count is now the headline score and what's compared
    // against the personal best. Distance is shown once as secondary flavor info only.
    const score = this.scoreNow();
    const distance = Math.floor(this.sim.z);
    const prevBest = loadBest(this.map, this.difficulty);
    const isNewBest = score > prevBest;
    if (isNewBest) saveBest(this.map, this.difficulty, score);
    // Shared cross-device stats/leaderboard store, additive alongside the local best above (which
    // stays the source of truth for the pre-game/game-over "your best" display).
    if (!this._resultRecorded) {
      this._resultRecorded = true;
      // Sixth-playthrough fix: write the raw result to the flight-recorder log FIRST, before
      // touching the shared store at all, so the run is never lost even if the write below fails.
      let detail = null;
      try { detail = runDetail(this.sim); } catch (err) { console.error('[ball-run] run detail failed; the run is saved without it', err); }
      try { if (this._eq && detail) { detail.eq = 1; detail.raw = this.sim.score | 0; } } catch { /* private log only */ }
      const logEntry = { ts: Date.now(), difficulty: this.difficulty, map: this.map, score, distance, seed: this._seed, detail, synced: false };
      appendRunLog(logEntry);
      logRunDetail(logEntry);
      if (trySyncRunEntry(logEntry)) markRunLogSynced(logEntry.ts);
      // Fifth-playthrough fix: previously the only thing that pushed a finished run up to Firebase
      // was hub.js's own lifecycle sync (tab-hide / returning to the launcher grid). This screen's
      // own "Back to hub" button only calls this module's showSetup() - it stays mounted inside Ball
      // Run, it does not leave the module - so a player who finishes a run, sees "Back to hub", and
      // plays again (or closes the tab) from there could go an entire session without the hub's sync
      // ever firing for that run. Syncing right here means every finished run reaches the leaderboard
      // on its own, regardless of what the player clicks next. Best-effort/fire-and-forget like every
      // other syncMyStats() call site; never blocks the game-over screen from showing.
      try { syncMyStats(); } catch (err) { console.error('[ball-run] syncMyStats failed', err); }
    }

    if (this._cues) {
      const cause = CAUSE_ICONS[this.sim.crashCause] ? this.sim.crashCause : (this.sim.crashReason === 'edge' ? 'edge' : 'obstacle');
      this.el.goCause.innerHTML = CAUSE_ICONS[cause];
      this.el.goCause.hidden = false;
      this.el.goTitle.textContent = cause === 'void' ? t('go_void') : cause === 'landing' ? t('go_landing')
        : cause === 'edge' ? t('fell_off') : t('crashed');
      this.el.goScore.textContent = t(score === 1 ? 'score_one' : 'score_many', { n: score });
    } else {
      this.el.goCause.hidden = true;
      this.el.goTitle.textContent = this.sim.crashReason === 'edge' ? t('fell_off') : t('crashed');
      this.el.goScore.textContent = t('obstacles_passed', { n: score });
    }
    this.el.goDistance.textContent = t('distance_m', { n: distance });
    this.el.goBest.innerHTML = isNewBest
      ? `<span class="br-star" aria-hidden="true">&#9733;</span> ${t('new_best')}`
      : t('best_n', { n: Math.max(prevBest, score) });
    this.el.gameover.hidden = false;
  }

  // --- Help carousel (4 slides, restored 2026-07-24 with a real previous button) ---------

  openHelp(fromScreen) {
    this.helpReturnScreen = fromScreen;
    this.helpPage = 0;
    if (this.running) { this.stopLoop(); this._pausedForHelp = true; }
    this.renderHelpPage();
    this.el.help.hidden = false;
  }

  closeHelp() {
    this.el.help.hidden = true;
    if (this._pausedForHelp) { this._pausedForHelp = false; if (this.sim && !this.sim.isOver()) this.startLoop(); }
  }

  helpPages() {
    if (!this._cues) return HELP_PAGES;
    return this.map === 'orbital' ? CUE_HELP_ORBITAL : CUE_HELP_CLASSIC;
  }

  helpGo(i) {
    this.helpPage = Math.max(0, Math.min(this.helpPages().length - 1, i));
    this.renderHelpPage();
  }

  renderHelpPage() {
    const pages = this.helpPages();
    const page = pages[this.helpPage];
    if (page.img) {
      // Cues on: a real frame + its overlay; the next page's picture is fetched ahead so paging never flashes.
      this.el.helpStill.innerHTML = `<img class="br-help-img" src="${helpImg(page.img)}" alt="" draggable="false">${helpMarkSVG(page.mark)}`;
      this.el.helpText.textContent = t(page.key);
      const next = pages[this.helpPage + 1];
      if (next) { const im = new Image(); im.src = helpImg(next.img); }
    } else {
      this.el.helpStill.innerHTML = page.still();
      this.el.helpText.textContent = t(page.textKey);
    }
    this.el.helpDots.innerHTML = pages.map((_, i) =>
      `<span class="br-dot${i === this.helpPage ? ' is-active' : ''}"></span>`).join('');
    this.el.helpPrev.disabled = this.helpPage === 0;
    this.el.helpNextBtn.disabled = this.helpPage === pages.length - 1;
  }

  // --- Teardown -----------------------------------------------------------

  destroy() {
    this.stopLoop();
    this.teardownRun(true);
    if (this._lifeUsedTimer) { clearTimeout(this._lifeUsedTimer); this._lifeUsedTimer = 0; }
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    document.body.style.overflow = this._prevBodyOverflow;
    this.container.innerHTML = '';
  }

  isInProgress() {
    return !!this.sim && this.sim.state === RunState.PLAYING;
  }
}

// --- Module contract --------------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new BallRunUI(container);
  return instance;
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!instance && instance.isInProgress();
}

/** The hub covers the game (Leave? dialog, a sideways phone): stop at the "tap to resume" gate, as when the app is
 *  hidden (2026-11-12). */
export function onCovered() {
  try {
    if (instance && instance.running) { instance.stopLoop(); instance._pausedForVisibility = true; instance.el.resumeGate.hidden = false; }
  } catch (err) { console.warn('[ball-run] pause', err); }
}
export default { init, destroy, isInProgress, onCovered };
