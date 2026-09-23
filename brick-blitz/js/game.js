// brick-blitz/js/game.js — Brick Breaker's engine AND renderer: stages, ball/paddle/brick physics,
// power-ups, particles and the synthwave backdrop. SILENT by design (Matt, 2026-09-23: the
// original's synth was removed; this game has no audio). No DOM beyond the one
// <canvas> it is handed; ui.js owns every screen, the clock's start/stop, input wiring and stats.
//
// A clone of "Neon Breakout / HYPERBRICK" (miaai-lab's 038-neon-breakout.html), ported to a module:
// the physics, level layouts, scoring and effects are the original's; what changed is that it now
// runs as a hub module (no globals, no window listeners, a destroy path), takes a DIFFICULTY, and
// reports what happened through `hooks` instead of touching the page.
//
// Coordinates are LOGICAL units: the field is FW=600 wide and FH tall (780-1000, chosen by layout()
// to match the space available, so a tall phone gets a tall field instead of letterboxing).

export const FW = 600;
const COLS = 13, GX = 12, GY = 92, CW = (FW - GX * 2) / COLS, RH = 28, BH = 21;
const TOP = 26, BALL_R = 7, PADDLE_WIDE_ADD = 60, PADDLE_H = 14;
const COLORS = { p: '#ff2e97', o: '#ff9e00', y: '#fff200', c: '#00f5d4', b: '#00bbf9', v: '#9b5de5' };
const KEYS = Object.keys(COLORS);
export const POWER_COLORS = { M: '#fff200', W: '#00f5d4', L: '#ff2e97', S: '#9b5de5' };
const FONT = "'Arial Narrow','Nimbus Sans Narrow','Helvetica Neue',Arial,sans-serif";

export const DIFFS = ['easy', 'medium', 'hard'];
/** Per-difficulty tuning. Speed scales the whole ball-speed curve; the paddle and the power-up
 *  drop rate make Easy forgiving and Hard stingy. Lives are 5/3/3: Hard is faster and narrower,
 *  not also shorter. */
export const DIFF_TUNING = {
  easy:   { speed: 0.82, paddle: 116, lives: 5, drop: 0.18, fire: 6.0 },
  medium: { speed: 1.00, paddle: 98,  lives: 3, drop: 0.15, fire: 4.5 },
  hard:   { speed: 1.18, paddle: 84,  lives: 3, drop: 0.12, fire: 3.2 },
};

/* Five hand-built stages (13 columns; a capital letter takes two hits). Verbatim from the original. */
export const LEVELS = [
  { key: 'lvl_love', rows: [
    '..PPP...PPP..', '.ppypp.ppppp.', 'ppypppppppppp', 'ppppppppppppp', '.vvvvvvvvvvv.',
    '..vvvvvvvvv..', '...bbbbbbb...', '....bbbbb....', '.....ccc.....', '......c......'] },
  { key: 'lvl_invader', rows: [
    '...b.....b...', '....b...b....', '...CCCCCCC...', '..cc.ccc.cc..', '.ccccccccccc.',
    '.c.ccccccc.c.', '.v.v.....v.v.', '....vv.vv....', '.............', 'y.y.y.y.y.y.y'] },
  { key: 'lvl_spiral', rows: [
    'ooooooooooooo', '............o', 'pbbbbbbbbbb.o', 'p.........b.o', 'p.vvvvvvv.b.o',
    'p.b.....v.b.o', 'p.b.Yyyyv.b.o', 'p.b.......b.o', 'p.bbbbbbbbb.o', 'p...........o', 'ppppppppppppp'] },
  { key: 'lvl_palm', rows: [
    '...cc...cc...', '.ccccc.ccccc.', 'cc..ccCcc..cc', 'c...c.O.c...c', '....c.O.c....', '......O......',
    '.....O.......', '.....O.......', '....O........', '....O........', 'yyyyyyyyyyyyy', 'ppppppppppppp'] },
  { key: 'lvl_sun', rows: [
    '.....yyy.....', '...YYYYYYY...', '..yyyyyyyyy..', '.ooooooooooo.', '.............', 'OOOOOOOOOOOOO',
    '.............', 'ppppppppppppp', '.............', '.PPPPPPPPPPP.', '.............', '..vvvvvvvvv..'] },
];

/** Endless mode: a seeded, mirror-symmetric wave that grows denser and tougher with `wave`. */
function endlessRows(wave) {
  const rows = [], n = Math.min(12, 6 + Math.floor(wave / 2)), hard = Math.min(0.55, 0.06 + wave * 0.05);
  let s = wave * 9301 + 49297;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const offs = Math.floor(rnd() * 6);
  for (let r = 0; r < n; r++) {
    const half = [];
    for (let c = 0; c < 7; c++) half.push(rnd() < (0.5 + Math.min(0.35, wave * 0.03)) + (r % 3 === 0 ? 0.2 : 0));
    const key = KEYS[(r + offs) % 6];
    let row = '';
    for (let c = 0; c < COLS; c++) { const on = half[c < 7 ? c : 12 - c]; row += on ? (rnd() < hard ? key.toUpperCase() : key) : '.'; }
    rows.push(row);
  }
  if (!rows.some((r) => /[a-zA-Z]/.test(r))) rows[0] = 'ppppppppppppp';
  return rows;
}

/* SPACE INVADERS elements (Matt, 2026-09-23). Two 11x8 pixel frames of the classic crab alien,
 * the bomb speed, how long a bomb freezes the paddle, and the saucer's bonus values. */
const ALIEN = [
  ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
  ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.'],
];
const BOMB_V = 240, STUN_S = 0.9, UFO_W = 46, UFO_H = 18, UFO_VALUES = [300, 500, 1000], INVADER_BONUS = 250;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/**
 * The game. `hooks`:
 *   t(key, vars)        translator for the few strings drawn ON the canvas
 *   reduce()            true when reduced motion is on (thins garnish; the ball keeps moving)
 *   onHud()             score/lives/stage changed
 *   onCombo(combo, bump)
 *   onStage(num, nameKey, endless)   a new stage started (ui shows the banner)
 *   onStageClear(bonus)
 *   onLifeLost(livesLeft)
 *   onGameOver()        last ball lost
 *   onVictory()         all five Arcade stages cleared
 */
export function createGame(canvas, hooks) {
  const ctx = canvas.getContext('2d');
  const say = hooks.t;
  let FH = 800, scale = 1, dpr = 1;
  const bgCanvas = document.createElement('canvas'), bgc = bgCanvas.getContext('2d');
  let sprites = {}, ballSprite = null;

  // --- state -----------------------------------------------------------------------------------
  let demo = true;            // attract mode: the AI plays behind the setup screen, nothing scores
  let phase = 'serve';        // serve | play | clear
  let endless = false, stageIdx = 0, wave = 1;
  let diff = 'medium', tune = DIFF_TUNING.medium;
  let score = 0, lives = 3, combo = 0, bestCombo = 0, bricksBroken = 0, stagesCleared = 0, circuit = false;
  let bricks = [], grid = [], breakable = 0;
  let balls = [], caps = [], beams = [];
  let wideT = 0, laserT = 0, slowT = 0, laserCd = 0;
  let bombs = [], ufo = null, ufoT = 15, stunT = 0;
  let shake = 0, flash = 0, flashCol = '255,255,255', hitStop = 0, clearT = 0, serveT = 0, gridPhase = 0, time = 0;
  const paddle = { x: FW / 2, y: FH - 72, w: 98, tw: 98, sq: 0, tx: FW / 2, vx: 0 };
  const keys = { left: false, right: false };
  const MAXP = 520, parts = [];
  for (let i = 0; i < MAXP; i++) parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, life: 0, max: 1, w: 3, h: 3, col: '#fff', kind: 0 });
  const pops = [];

  const live = () => !demo;
  const reduce = () => !!hooks.reduce();

  // --- layout ----------------------------------------------------------------------------------
  /** Fit the field into availW x availH CSS px. Returns the chosen display size. */
  function layout(availW, availH) {
    const aw = Math.max(200, availW), ah = Math.max(260, availH);
    FH = clamp(Math.round(FW * ah / aw / 10) * 10, 780, 1000);
    let dispW = aw, dispH = aw * FH / FW;
    if (dispH > ah) { dispH = ah; dispW = ah * FW / FH; }
    dispW = Math.floor(dispW); dispH = Math.floor(dispH);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = dispW / FW;
    canvas.style.width = dispW + 'px'; canvas.style.height = dispH + 'px';
    canvas.width = Math.round(dispW * dpr); canvas.height = Math.round(dispH * dpr);
    paddle.y = FH - 72;
    for (const b of balls) if (b.stuck) b.y = paddle.y - PADDLE_H / 2 - BALL_R - 1;
    buildBackground(); buildSprites();
    return { w: dispW, h: dispH };
  }

  function buildBackground() {
    const s = scale * dpr;
    bgCanvas.width = Math.max(1, Math.round(FW * s)); bgCanvas.height = Math.max(1, Math.round(FH * s));
    const g = bgc; g.setTransform(s, 0, 0, s, 0, 0);
    const hz = FH * 0.6;
    let gr = g.createLinearGradient(0, 0, 0, hz);
    gr.addColorStop(0, '#0c001f'); gr.addColorStop(0.45, '#12002b'); gr.addColorStop(0.78, '#3a0a5e'); gr.addColorStop(0.95, '#8a1b72'); gr.addColorStop(1, '#ff2e97');
    g.fillStyle = gr; g.fillRect(0, 0, FW, hz);
    let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 110; i++) { const x = rnd() * FW, y = rnd() * hz * 0.8, r = rnd() * 1.2 + 0.3; g.globalAlpha = 0.3 + rnd() * 0.7; g.fillStyle = rnd() < 0.2 ? '#ffc6e6' : '#ffffff'; g.fillRect(x, y, r, r); }
    g.globalAlpha = 1;
    const sx = FW / 2, sy = hz - 8, sr = Math.min(150, FW * 0.25);
    gr = g.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 2.3); gr.addColorStop(0, 'rgba(255,90,160,.55)'); gr.addColorStop(1, 'rgba(255,46,151,0)');
    g.fillStyle = gr; g.fillRect(0, 0, FW, hz);
    const sc = document.createElement('canvas'); sc.width = bgCanvas.width; sc.height = bgCanvas.height;
    const k = sc.getContext('2d'); k.setTransform(s, 0, 0, s, 0, 0);
    gr = k.createLinearGradient(0, sy - sr, 0, sy + sr); gr.addColorStop(0, '#fff200'); gr.addColorStop(0.35, '#ffb800'); gr.addColorStop(0.62, '#ff5e7e'); gr.addColorStop(1, '#ff2e97');
    k.fillStyle = gr; k.beginPath(); k.arc(sx, sy, sr, 0, Math.PI * 2); k.fill();
    k.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) { const y = sy - sr * 0.12 + i * sr * 0.16, h = 2 + i * 2.2; k.fillRect(sx - sr - 2, y, sr * 2 + 4, h); }
    g.drawImage(sc, 0, 0, FW, FH);
    const mount = (pts, fill, stroke) => {
      g.beginPath(); g.moveTo(0, hz); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(FW, hz); g.closePath(); g.fillStyle = fill; g.fill();
      g.strokeStyle = stroke; g.lineWidth = 1.5; g.shadowColor = stroke; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(0, hz); pts.forEach(([x, y]) => g.lineTo(x, y)); g.stroke(); g.shadowBlur = 0;
    };
    mount([[0, hz - 40], [40, hz - 70], [78, hz - 38], [118, hz - 92], [160, hz - 50], [196, hz - 66], [236, hz - 18], [270, hz - 6], [330, hz - 4], [372, hz - 26], [410, hz - 58], [446, hz - 34], [482, hz - 96], [528, hz - 48], [566, hz - 74], [600, hz - 44]], '#1b0336', 'rgba(0,245,212,.8)');
    mount([[0, hz - 14], [60, hz - 30], [112, hz - 12], [170, hz - 26], [228, hz - 6], [372, hz - 8], [430, hz - 28], [492, hz - 10], [548, hz - 32], [600, hz - 16]], '#120024', 'rgba(255,46,151,.7)');
    gr = g.createLinearGradient(0, hz, 0, FH); gr.addColorStop(0, '#2b0647'); gr.addColorStop(0.3, '#16012f'); gr.addColorStop(1, '#0b0019');
    g.fillStyle = gr; g.fillRect(0, hz, FW, FH - hz);
    g.fillStyle = 'rgba(255,46,151,.9)'; g.fillRect(0, hz - 1, FW, 2);
  }

  function buildSprites() {
    const s = scale * dpr, pad = 12, bw = CW - 4, w = bw + pad * 2, h = BH + pad * 2;
    sprites = {};
    for (const k of KEYS) {
      for (const armored of [false, true]) {
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w * s)); c.height = Math.max(1, Math.ceil(h * s));
        const g = c.getContext('2d'); g.setTransform(s, 0, 0, s, 0, 0);
        const col = COLORS[k];
        g.shadowColor = col; g.shadowBlur = 12;
        roundRect(g, pad, pad, bw, BH, 5);
        const gr = g.createLinearGradient(0, pad, 0, pad + BH);
        gr.addColorStop(0, hexA(col, armored ? 0.85 : 0.55)); gr.addColorStop(1, hexA(col, armored ? 0.45 : 0.16));
        g.fillStyle = gr; g.fill();
        g.lineWidth = 2; g.strokeStyle = col; g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(pad + 5, pad + 3, bw - 10, 1.6);
        if (armored) {
          // Two-hit bricks carry a SHAPE marker (inner outline + two rivets), never colour alone.
          g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2; roundRect(g, pad + 3.5, pad + 3.5, bw - 7, BH - 7, 3); g.stroke();
          g.fillStyle = '#fff'; for (const [x, y] of [[pad + 6, pad + BH / 2], [pad + bw - 6, pad + BH / 2]]) { g.beginPath(); g.arc(x, y, 1.6, 0, 6.3); g.fill(); }
        }
        sprites[k + (armored ? '2' : '1')] = c;
      }
    }
    const b = document.createElement('canvas'); const bs = 64; b.width = b.height = bs; const bg = b.getContext('2d');
    const gr = bg.createRadialGradient(bs / 2, bs / 2, 0, bs / 2, bs / 2, bs / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.95)'); gr.addColorStop(0.3, 'rgba(120,250,235,.55)'); gr.addColorStop(1, 'rgba(0,245,212,0)');
    bg.fillStyle = gr; bg.fillRect(0, 0, bs, bs); ballSprite = b;
  }

  // --- stage flow ------------------------------------------------------------------------------
  function loadStage() {
    const rows = endless ? endlessRows(wave) : LEVELS[stageIdx].rows;
    bricks = []; grid = []; breakable = 0;
    rows.forEach((row, r) => {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) {
        const ch = row[c] || '.';
        if (ch === '.') { grid[r][c] = null; continue; }
        const k = ch.toLowerCase(), hp = ch === k ? 1 : 2;
        const b = { x: GX + c * CW + 2, y: GY + r * RH, w: CW - 4, h: BH, k, hp, max: hp, alive: true, flash: 0, r, c };
        grid[r][c] = b; bricks.push(b); breakable++;
      }
    });
    caps = []; beams = [];
    // Invaders: a few of the LOWEST bricks in their columns become aliens. An alien only fires
    // while nothing is below it, so clearing the bricks under one is what unleashes it.
    const lows = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = grid.length - 1; r >= 0; r--) { const b = grid[r] && grid[r][c]; if (b) { lows.push(b); break; } }
    }
    for (let i = lows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lows[i], lows[j]] = [lows[j], lows[i]]; }
    const n = endless ? Math.min(8, 2 + wave) : Math.min(6, 2 + stageIdx);
    lows.slice(0, n).forEach((b) => { b.inv = true; b.fireT = 2 + Math.random() * 3; });
    bombs = []; ufo = null; ufoT = 12 + Math.random() * 10; stunT = 0;
  }
  function exposed(b) {
    for (let r = b.r + 1; r < grid.length; r++) if (grid[r] && grid[r][b.c]) return false;
    return true;
  }
  function hitUfo(byBall) {
    const v = UFO_VALUES[Math.floor(Math.random() * UFO_VALUES.length)];
    if (live()) { score += v; hooks.onHud(); }
    pop(ufo.x, ufo.y, '+' + v, '#ff2e97', 24);
    for (let i = 0; i < (reduce() ? 10 : 30); i++) { const a = Math.random() * 6.28, sp = 60 + Math.random() * 240; spawn(ufo.x, ufo.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.5, i % 2 ? '#ff2e97' : '#fff200', 2 + Math.random() * 4, 2, 0); }
    addShake(byBall ? 4 : 3);
    ufo = null;
  }
  function resetPaddle() { paddle.tw = tune.paddle; wideT = 0; laserT = 0; slowT = 0; }
  function serve() {
    balls = [{ x: paddle.x, y: paddle.y - PADDLE_H / 2 - BALL_R - 1, vx: 0, vy: 0, trail: [], stuck: true }];
    phase = 'serve'; serveT = 0; combo = 0; hooks.onCombo(0, false);
  }
  function baseSpeed() { return (endless ? 440 + Math.min(160, wave * 14) : 420 + stageIdx * 18) * tune.speed; }
  function launch() {
    if (phase !== 'serve') return;
    const sp = baseSpeed(), a = (Math.random() * 0.5 - 0.25);
    for (const b of balls) if (b.stuck) { b.stuck = false; b.vx = Math.sin(a) * sp; b.vy = -Math.cos(a) * sp; }
    phase = 'play';
  }
  const stageNum = () => (endless ? wave : stageIdx + 1);
  const stageNameKey = () => (endless ? null : LEVELS[stageIdx].key);

  function startRun(mode, difficulty) {
    demo = false;
    diff = DIFFS.includes(difficulty) ? difficulty : 'medium';
    tune = DIFF_TUNING[diff];
    endless = mode === 'endless'; stageIdx = 0; wave = 1;
    score = 0; lives = tune.lives; bestCombo = 0; bricksBroken = 0; stagesCleared = 0; circuit = false;
    paddle.w = tune.paddle;
    loadStage(); resetPaddle(); serve();
    hooks.onStage(stageNum(), stageNameKey(), endless); hooks.onHud();
  }
  /** After the Arcade circuit: carry score and lives on into Endless, as ONE run. */
  function continueEndless() {
    demo = false; endless = true; wave = 1;
    loadStage(); resetPaddle(); serve();
    hooks.onStage(stageNum(), stageNameKey(), endless); hooks.onHud();
  }
  function attract() {
    demo = true; diff = 'medium'; tune = DIFF_TUNING.medium;
    endless = false; stageIdx = Math.floor(Math.random() * LEVELS.length);
    score = 0; lives = 3; combo = 0;
    loadStage(); resetPaddle(); serve(); hooks.onHud();
  }
  function nextStage() {
    if (demo) { stageIdx = (stageIdx + 1 + Math.floor(Math.random() * (LEVELS.length - 1))) % LEVELS.length; loadStage(); resetPaddle(); serve(); return; }
    if (endless) wave++;
    else if (stageIdx >= LEVELS.length - 1) { circuit = true; phase = 'done'; hooks.onVictory(); return; }
    else stageIdx++;
    loadStage(); resetPaddle(); serve();
    hooks.onStage(stageNum(), stageNameKey(), endless); hooks.onHud();
  }

  // --- fx --------------------------------------------------------------------------------------
  function spawn(x, y, vx, vy, life, col, w, h, kind) {
    for (const p of parts) {
      if (!p.on) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.col = col; p.w = w; p.h = h; p.r = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 18; p.kind = kind || 0; return p; }
    }
    return null;
  }
  function shatter(b, ball) {
    const col = COLORS[b.k], n = reduce() ? 8 : 20, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = ball ? ball.vx * 0.25 : 0, dy = ball ? ball.vy * 0.25 : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
      spawn(cx + (Math.random() - 0.5) * b.w, cy + (Math.random() - 0.5) * b.h, Math.cos(a) * sp + dx, Math.sin(a) * sp + dy - 60, 0.5 + Math.random() * 0.6, col, 2 + Math.random() * 6, 2 + Math.random() * 3, 0);
    }
    spawn(cx, cy, 0, 0, 0.35, col, b.w * 0.7, 0, 1);
    for (let i = 0; i < 5; i++) spawn(cx, cy, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.25, '#ffffff', 1.5, 1.5, 0);
  }
  function pop(x, y, text, col, size) { pops.push({ x, y, text, col, size: size || 16, t: 0 }); if (pops.length > 18) pops.shift(); }
  function addShake(v) { if (!reduce()) shake = Math.min(16, shake + v); }

  // --- collisions ------------------------------------------------------------------------------
  function hitBrick(b, ball) {
    b.hp--; b.flash = 1;
    if (b.hp > 0) { addShake(1.5); spawn(b.x + b.w / 2, b.y + b.h / 2, 0, 0, 0.25, '#ffffff', b.w * 0.5, 0, 1); return; }
    b.alive = false; grid[b.r][b.c] = null; breakable--;
    combo++; bestCombo = Math.max(bestCombo, combo);
    const pts = (b.max === 2 ? 160 : 100) * Math.min(combo, 12) + (b.inv ? INVADER_BONUS : 0);
    if (live()) { score += pts; bricksBroken++; hooks.onHud(); }
    pop(b.x + b.w / 2, b.y + b.h / 2, '+' + pts, COLORS[b.k], combo >= 5 ? 20 : 15);
    shatter(b, ball); addShake(2.4 + Math.min(4, combo * 0.35));
    if (combo >= 6 && !reduce()) hitStop = 0.035;
    hooks.onCombo(combo, true);
    if (Math.random() < (demo ? 0.12 : tune.drop) && caps.length < 3) {
      caps.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, t: 'MWLS'[Math.floor(Math.random() * 4)], ph: Math.random() * 6 });
    }
    if (breakable <= 0) stageClear();
  }
  function stageClear() {
    phase = 'clear'; clearT = demo ? 1.2 : 2.3; flash = reduce() ? 0.2 : 0.7; flashCol = '255,255,255';
    for (const b of balls) { b.vx = 0; b.vy = 0; }
    if (live()) {
      stagesCleared++;
      const bonus = lives * 500; score += bonus;
      pop(FW / 2, FH * 0.5, say('pop_clear', { n: bonus }), '#fff200', 28);
      hooks.onHud(); hooks.onStageClear(bonus);
    }
    for (let i = 0; i < (reduce() ? 20 : 80); i++) { const a = Math.random() * 6.28, sp = 100 + Math.random() * 420; spawn(FW / 2, FH * 0.42, Math.cos(a) * sp, Math.sin(a) * sp, 0.8 + Math.random() * 0.8, COLORS[KEYS[i % 6]], 3 + Math.random() * 5, 2 + Math.random() * 3, 0); }
  }
  function collideBricks(ball) {
    const r = BALL_R;
    const c0 = Math.floor((ball.x - r - GX) / CW), c1 = Math.floor((ball.x + r - GX) / CW);
    const r0 = Math.floor((ball.y - r - GY) / RH), r1 = Math.floor((ball.y + r - GY) / RH);
    let best = null, bestD = Infinity;
    for (let rr = r0; rr <= r1; rr++) {
      const row = grid[rr]; if (!row) continue;
      for (let cc = c0; cc <= c1; cc++) {
        const b = row[cc]; if (!b || !b.alive) continue;
        const nx = clamp(ball.x, b.x, b.x + b.w), ny = clamp(ball.y, b.y, b.y + b.h), dx = ball.x - nx, dy = ball.y - ny, d = dx * dx + dy * dy;
        if (d < r * r && d < bestD) { bestD = d; best = b; }
      }
    }
    if (!best) return false;
    const cx = best.x + best.w / 2, cy = best.y + best.h / 2;
    const ox = best.w / 2 + r - Math.abs(ball.x - cx), oy = best.h / 2 + r - Math.abs(ball.y - cy);
    if (ox < oy) { const s = Math.sign(ball.x - cx) || 1; ball.vx = s * Math.abs(ball.vx); ball.x += s * ox; }
    else { const s = Math.sign(ball.y - cy) || 1; ball.vy = s * Math.abs(ball.vy); ball.y += s * oy; }
    hitBrick(best, ball);
    return true;
  }
  function paddleHit(ball) {
    const off = clamp((ball.x - paddle.x) / (paddle.w / 2), -1, 1);
    const sp = Math.min(760 * tune.speed, Math.hypot(ball.vx, ball.vy) + 5);
    const a = off * 1.08;
    ball.vx = Math.sin(a) * sp; ball.vy = -Math.cos(a) * sp;
    ball.y = paddle.y - PADDLE_H / 2 - BALL_R;
    paddle.sq = 1; combo = 0; hooks.onCombo(0, false);
    for (let i = 0; i < (reduce() ? 3 : 9); i++) spawn(ball.x, paddle.y - PADDLE_H / 2, (Math.random() - 0.5) * 220, -Math.random() * 200, 0.35, '#00f5d4', 2, 2, 0);
  }
  function stepBall(ball, dt) {
    const sp = Math.hypot(ball.vx, ball.vy);
    // Sub-step so no step travels more than 0.6 of the ball's radius: a brick is 21 units tall,
    // so the ball can never tunnel through one (docs/BUILDING-A-GAME.md, Part 3).
    const n = Math.max(1, Math.ceil(sp * dt / (BALL_R * 0.6)));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      ball.x += ball.vx * sdt; ball.y += ball.vy * sdt;
      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
      else if (ball.x > FW - BALL_R) { ball.x = FW - BALL_R; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < TOP + BALL_R) { ball.y = TOP + BALL_R; ball.vy = Math.abs(ball.vy); }
      if (ball.vy > 0 && ball.y + BALL_R >= paddle.y - PADDLE_H / 2 && ball.y - BALL_R <= paddle.y + PADDLE_H / 2 && Math.abs(ball.x - paddle.x) <= paddle.w / 2 + BALL_R * 0.8) paddleHit(ball);
      if (ball.y - BALL_R < GY + RH * grid.length + 4) collideBricks(ball);
      if (phase !== 'play') return;
    }
    // keep angles lively: never let a ball crawl horizontally
    const s2 = Math.hypot(ball.vx, ball.vy);
    if (s2 > 0 && Math.abs(ball.vy) < s2 * 0.28) { ball.vy = Math.sign(ball.vy || -1) * s2 * 0.28; ball.vx = Math.sign(ball.vx) * Math.sqrt(s2 * s2 - ball.vy * ball.vy); }
  }
  function applyPower(t) {
    pop(paddle.x, paddle.y - 34, say('pw_' + t).toUpperCase(), POWER_COLORS[t], 17);
    if (t === 'M') {
      const src = balls.filter((b) => !b.stuck).slice(0, 3);
      if (!src.length && balls[0]) src.push(balls[0]);
      for (const b of src) {
        for (const da of [-0.35, 0.35]) {
          if (balls.length >= 9) break;
          const sp = Math.max(380 * tune.speed, Math.hypot(b.vx, b.vy)), a = Math.atan2(b.vx, -b.vy) + da;
          balls.push({ x: b.x, y: b.y, vx: Math.sin(a) * sp, vy: -Math.abs(Math.cos(a) * sp), trail: [], stuck: false });
        }
      }
      if (phase === 'serve') launch();
    } else if (t === 'W') { paddle.tw = tune.paddle + PADDLE_WIDE_ADD; wideT = 14; }
    else if (t === 'L') { laserT = 10; laserCd = 0; }
    else if (t === 'S') { slowT = 8; }
    flash = Math.max(flash, 0.25); flashCol = '255,255,255';
  }

  // --- update ----------------------------------------------------------------------------------
  function aiPaddle(dt) {
    let target = FW / 2, best = null;
    for (const b of balls) { if (b.stuck) continue; if (b.vy > 0 && (!best || b.y > best.y)) best = b; }
    if (!best) best = balls[0];
    if (best) {
      let x = best.x;
      if (best.vy > 0) { const tt = (paddle.y - best.y) / best.vy; x = best.x + best.vx * tt; for (let i = 0; i < 4; i++) { if (x < 0) x = -x; if (x > FW) x = 2 * FW - x; } }
      target = x + Math.sin(time * 0.9) * paddle.w * 0.32;
    }
    const d = target - paddle.x; paddle.x += clamp(d, -820 * dt, 820 * dt); paddle.tx = paddle.x;
  }
  function ballLost() {
    if (demo) { serve(); return; }
    lives--; addShake(14); flash = reduce() ? 0.2 : 0.55; flashCol = '255,46,151';
    combo = 0; hooks.onCombo(0, false); caps = []; beams = []; bombs = []; stunT = 0; resetPaddle(); hooks.onHud();
    if (lives <= 0) { phase = 'done'; hooks.onGameOver(); return; }
    hooks.onLifeLost(lives);
    serve();
  }
  function trailPush(b) { b.trail.push(b.x, b.y); if (b.trail.length > 28) b.trail.splice(0, 2); }
  function updateFx(dt) {
    for (const p of parts) {
      if (!p.on) continue;
      p.life -= dt; if (p.life <= 0) { p.on = false; continue; }
      if (p.kind === 0) { p.vy += 520 * dt; p.vx *= Math.exp(-dt * 1.2); p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; }
    }
    for (let i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > 1) pops.splice(i, 1); }
    for (const b of bricks) if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 6);
    shake *= Math.exp(-dt * 11); if (shake < 0.05) shake = 0;
    flash = Math.max(0, flash - dt * 2.2);
  }
  function update(dt) {
    time += dt;
    gridPhase = (gridPhase + dt * (reduce() ? 0.15 : 0.55 + Math.min(combo, 14) * 0.08)) % 1;
    updateFx(dt);
    if (phase === 'done') return;
    if (hitStop > 0) { hitStop -= dt; return; }
    const slow = slowT > 0 ? 0.55 : 1;

    if (demo) aiPaddle(dt);
    else if (stunT > 0) { stunT -= dt; paddle.vx = 0; paddle.tx = paddle.x; }
    else {
      if (keys.left || keys.right) { paddle.vx = clamp(paddle.vx + (keys.right - keys.left) * 5200 * dt, -900, 900); paddle.tx = paddle.x + paddle.vx * dt; }
      else paddle.vx *= Math.exp(-dt * 18);
      paddle.x += (paddle.tx - paddle.x) * Math.min(1, dt * 26);
    }
    paddle.w += (paddle.tw - paddle.w) * Math.min(1, dt * 9);
    paddle.x = clamp(paddle.x, paddle.w / 2, FW - paddle.w / 2); paddle.tx = clamp(paddle.tx, paddle.w / 2, FW - paddle.w / 2);
    paddle.sq *= Math.exp(-dt * 9);

    if (wideT > 0) { wideT -= dt; if (wideT <= 0) paddle.tw = tune.paddle; }
    if (slowT > 0) slowT -= dt;
    if (laserT > 0) {
      laserT -= dt; laserCd -= dt;
      if (laserCd <= 0 && phase === 'play') { laserCd = 0.24; for (const s of [-1, 1]) beams.push({ x: paddle.x + s * (paddle.w / 2 - 8), y: paddle.y - PADDLE_H }); }
    }

    if (phase === 'clear') { clearT -= dt; if (clearT <= 0) nextStage(); return; }
    if (phase === 'serve') {
      serveT += dt;
      const b = balls[0]; if (b) { b.x = paddle.x + Math.sin(time * 3) * paddle.w * 0.18; b.y = paddle.y - PADDLE_H / 2 - BALL_R - 1; trailPush(b); }
      if (demo && serveT > 0.7) launch();
    } else if (phase === 'play') {
      for (const b of balls) { stepBall(b, dt * slow); trailPush(b); }
      if (phase !== 'play') return;
      balls = balls.filter((b) => b.y - BALL_R < FH + 8);
      if (!balls.length) { ballLost(); return; }
    }

    for (let i = caps.length - 1; i >= 0; i--) {
      const c = caps[i]; c.y += 150 * dt * slow; c.ph += dt * 4;
      if (c.y > paddle.y - PADDLE_H / 2 - 9 && c.y < paddle.y + PADDLE_H / 2 + 9 && Math.abs(c.x - paddle.x) < paddle.w / 2 + 18) { caps.splice(i, 1); applyPower(c.t); continue; }
      if (c.y > FH + 20) caps.splice(i, 1);
    }
    // Invaders fire; bombs fall; the saucer crosses. Only while the ball is in play.
    if (phase === 'play') {
      for (const b of bricks) {
        if (!b.alive || !b.inv) continue;
        b.fireT -= dt * slow;
        if (b.fireT <= 0) {
          b.fireT = tune.fire * (0.6 + Math.random() * 0.8);
          if (bombs.length < 6 && exposed(b)) bombs.push({ x: b.x + b.w / 2, y: b.y + b.h, ph: Math.random() * 6 });
        }
      }
      if (ufo) {
        ufo.x += ufo.dir * ufo.v * dt * slow;
        if (ufo.x < -UFO_W || ufo.x > FW + UFO_W) ufo = null;
        else for (const b of balls) {
          if (Math.abs(b.x - ufo.x) < UFO_W / 2 + BALL_R && Math.abs(b.y - ufo.y) < UFO_H / 2 + BALL_R) { hitUfo(true); break; }
        }
      } else if ((ufoT -= dt) <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        ufo = { x: dir > 0 ? -UFO_W / 2 : FW + UFO_W / 2, y: TOP + 28, dir, v: 130 * tune.speed };
        ufoT = 18 + Math.random() * 12;
      }
    }
    for (let i = bombs.length - 1; i >= 0; i--) {
      const bo = bombs[i]; bo.y += BOMB_V * tune.speed * dt * slow; bo.ph += dt * 14;
      if (bo.y > paddle.y - PADDLE_H / 2 - 6 && bo.y < paddle.y + PADDLE_H / 2 + 6 && Math.abs(bo.x - paddle.x) < paddle.w / 2 + 3) {
        bombs.splice(i, 1);
        if (live()) {
          stunT = STUN_S; paddle.vx = 0; combo = 0; hooks.onCombo(0, false);
          addShake(6); flash = Math.max(flash, reduce() ? 0.15 : 0.3); flashCol = '255,46,151';
          pop(paddle.x, paddle.y - 30, say('pop_zap'), '#ff2e97', 18);
        }
        for (let k = 0; k < (reduce() ? 4 : 12); k++) spawn(bo.x, paddle.y - PADDLE_H / 2, (Math.random() - 0.5) * 260, -Math.random() * 220, 0.4, '#ff2e97', 2, 2, 0);
        continue;
      }
      if (bo.y > FH + 20) bombs.splice(i, 1);
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const bm = beams[i]; bm.y -= 900 * dt;
      if (bm.y < TOP) { beams.splice(i, 1); continue; }
      // A laser shot takes out a bomb, or the saucer, before it reaches a brick.
      const hitBomb = bombs.findIndex((bo) => Math.abs(bo.x - bm.x) < 7 && bo.y > bm.y - 4 && bo.y < bm.y + 26);
      if (hitBomb >= 0) { spawn(bombs[hitBomb].x, bombs[hitBomb].y, 0, 0, 0.25, '#ffffff', 10, 0, 1); bombs.splice(hitBomb, 1); beams.splice(i, 1); continue; }
      if (ufo && Math.abs(bm.x - ufo.x) < UFO_W / 2 && bm.y < ufo.y + UFO_H / 2 && bm.y > ufo.y - UFO_H) { beams.splice(i, 1); hitUfo(false); continue; }
      const c = Math.floor((bm.x - GX) / CW), r = Math.floor((bm.y - GY) / RH), row = grid[r], b = row && row[c];
      if (b && b.alive && bm.y < b.y + b.h && bm.y > b.y) { beams.splice(i, 1); hitBrick(b, null); if (phase !== 'play') return; }
    }
  }

  // --- render ----------------------------------------------------------------------------------
  function render(touch) {
    const s = scale * dpr;
    const sx = shake ? (Math.random() - 0.5) * shake * 2 : 0, sy = shake ? (Math.random() - 0.5) * shake * 2 : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.setTransform(s, 0, 0, s, sx * s, sy * s);
    drawGrid();
    ctx.fillStyle = 'rgba(0,245,212,.85)'; ctx.fillRect(0, TOP - 3, FW, 2);
    ctx.fillStyle = 'rgba(0,245,212,.18)'; ctx.fillRect(0, TOP - 8, FW, 8);

    const pad = 12;
    for (const b of bricks) {
      if (!b.alive) continue;
      if (b.inv) drawAlien(b);
      else { const spr = sprites[b.k + (b.hp > 1 ? '2' : '1')]; ctx.drawImage(spr, b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2); }
      if (b.max === 2 && b.hp === 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(b.x + b.w * 0.3, b.y + 2); ctx.lineTo(b.x + b.w * 0.42, b.y + b.h * 0.55); ctx.lineTo(b.x + b.w * 0.36, b.y + b.h - 2);
        ctx.moveTo(b.x + b.w * 0.42, b.y + b.h * 0.55); ctx.lineTo(b.x + b.w * 0.6, b.y + b.h * 0.45); ctx.stroke();
      }
      if (b.flash > 0) { ctx.globalAlpha = b.flash; ctx.fillStyle = '#fff'; roundRect(ctx, b.x - 1, b.y - 1, b.w + 2, b.h + 2, 5); ctx.fill(); ctx.globalAlpha = 1; }
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const bm of beams) { ctx.fillStyle = 'rgba(255,46,151,.35)'; ctx.fillRect(bm.x - 3, bm.y, 6, 22); ctx.fillStyle = '#ffd1ea'; ctx.fillRect(bm.x - 1, bm.y, 2, 22); }
    ctx.globalCompositeOperation = 'source-over';
    for (const c of caps) {
      const col = POWER_COLORS[c.t], w = 36, h = 16;
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.sin(c.ph) * 0.12);
      ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fillStyle = col; roundRect(ctx, -w / 2, -h / 2, w, h, 8); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-w / 2 + 6, -h / 2 + 3, w - 12, 2);
      ctx.fillStyle = '#12002b'; ctx.font = `italic 900 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.t, 0, 1);
      ctx.restore();
    }

    drawBombs();
    if (ufo) drawUfo();
    drawPaddle();
    drawBalls();

    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (!p.on) continue;
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 1) { ctx.globalAlpha = a * 0.8; ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); const rr = p.w * (1.4 - a) + 4; ctx.ellipse(p.x, p.y, rr, rr * 0.45, 0, 0, Math.PI * 2); ctx.stroke(); continue; }
      ctx.globalAlpha = a; ctx.fillStyle = p.col;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of pops) {
      const tt = p.t, a = tt < 0.7 ? 1 : 1 - (tt - 0.7) / 0.3, sc = tt < 0.12 ? 1.6 - tt / 0.12 * 0.6 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = `italic 900 ${Math.round(p.size * sc)}px ${FONT}`;
      ctx.shadowColor = p.col; ctx.shadowBlur = 10; ctx.fillStyle = '#fff'; ctx.fillText(p.text, p.x, p.y - tt * 42);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    if (phase === 'serve' && live()) {
      const a = 0.55 + 0.45 * Math.sin(time * 5); ctx.globalAlpha = reduce() ? 1 : a; ctx.fillStyle = '#fff'; ctx.shadowColor = '#00f5d4'; ctx.shadowBlur = 10;
      ctx.font = `italic 800 20px ${FONT}`;
      ctx.fillText(say(touch ? 'launch_touch' : 'launch_mouse'), FW / 2, paddle.y - 70);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    drawPowerBar();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (slowT > 0) { ctx.globalAlpha = Math.min(1, slowT) * 0.16; ctx.fillStyle = '#9b5de5'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; }
    if (flash > 0) { ctx.fillStyle = `rgba(${flashCol},${(flash * 0.55).toFixed(3)})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }
  function drawGrid() {
    const hz = FH * 0.6, vpX = FW / 2, depth = FH - hz;
    ctx.save(); ctx.beginPath(); ctx.rect(0, hz, FW, depth); ctx.clip();
    for (let i = 0; i < 18; i++) {
      const z = (i + 1 - gridPhase); const y = hz + depth * (1.2 / (z * 0.55 + 0.2)) * 0.18;
      if (y < hz || y > FH) continue;
      const a = clamp((y - hz) / depth, 0, 1);
      ctx.strokeStyle = `rgba(255,46,151,${(0.15 + a * 0.75).toFixed(3)})`; ctx.lineWidth = 0.8 + a * 1.6;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FW, y); ctx.stroke();
    }
    ctx.lineWidth = 1.2;
    const gr = ctx.createLinearGradient(0, hz, 0, FH); gr.addColorStop(0, 'rgba(255,46,151,0)'); gr.addColorStop(1, 'rgba(255,46,151,.75)');
    ctx.strokeStyle = gr; ctx.beginPath();
    for (let i = -14; i <= 14; i++) { const xb = vpX + i * 62; ctx.moveTo(vpX + i * 4, hz); ctx.lineTo(xb * 1.9 - vpX * 0.9, FH + 40); }
    ctx.stroke();
    ctx.restore();
  }
  /** An alien brick: the classic crab, two-frame march, in its brick's colour. A two-hit alien
   *  keeps a white outline box (the same shape marker as a two-hit brick, never colour alone). */
  function drawAlien(b) {
    const frame = reduce() ? 0 : Math.abs(Math.floor(time * 2)) % 2, rows = ALIEN[frame];
    const px = Math.min(b.w / 11.5, 3.2), ox = b.x + (b.w - px * 11) / 2, oy = b.y + (b.h - px * 8) / 2;
    const col = COLORS[b.k];
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.fillStyle = col; roundRect(ctx, b.x, b.y, b.w, b.h, 5); ctx.fill(); ctx.globalAlpha = 1;
    ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.fillStyle = col;
    ctx.beginPath();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 11; c++) if (rows[r][c] === 'X') ctx.rect(ox + c * px, oy + r * px, px + 0.3, px + 0.3);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (b.hp > 1) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; roundRect(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 4); ctx.stroke(); }
    ctx.restore();
  }
  function drawBombs() {
    ctx.save();
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffd1ea'; ctx.shadowColor = '#ff2e97'; ctx.shadowBlur = 8;
    for (const bo of bombs) {
      const w = Math.sin(bo.ph) > 0 ? 3 : -3;
      ctx.beginPath(); ctx.moveTo(bo.x, bo.y - 12); ctx.lineTo(bo.x + w, bo.y - 8); ctx.lineTo(bo.x - w, bo.y - 4); ctx.lineTo(bo.x + w, bo.y); ctx.stroke();
    }
    ctx.restore();
  }
  function drawUfo() {
    const x = ufo.x, y = ufo.y;
    ctx.save();
    ctx.shadowColor = '#ff2e97'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ff2e97'; ctx.beginPath(); ctx.ellipse(x, y + 2, UFO_W / 2, UFO_H / 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#c9fff6'; ctx.beginPath(); ctx.ellipse(x, y - 3, UFO_W / 4.5, UFO_H / 2.6, 0, Math.PI, 0); ctx.fill();
    const on = reduce() ? 0 : Math.floor(time * 6) % 3;
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i === on ? '#fff200' : '#6b0f45'; ctx.beginPath(); ctx.arc(x + (i - 1) * 12, y + 3, 2.2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function drawPaddle() {
    const w = paddle.w * (1 + paddle.sq * 0.22), h = PADDLE_H * (1 - paddle.sq * 0.35), x = paddle.x - w / 2, y = paddle.y - h / 2 + paddle.sq * 3;
    ctx.save();
    ctx.shadowColor = laserT > 0 ? '#ff2e97' : '#00f5d4'; ctx.shadowBlur = 22;
    // Frozen by a bomb: greyed out and flickering until it thaws.
    const frozen = stunT > 0;
    if (frozen) { ctx.globalAlpha = (reduce() || Math.floor(time * 16) % 2) ? 0.6 : 0.35; ctx.shadowColor = '#ff2e97'; }
    const gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, frozen ? '#e6e6f0' : '#c9fff6');
    gr.addColorStop(0.45, frozen ? '#8a8aa0' : laserT > 0 ? '#ff7ab8' : '#00f5d4'); gr.addColorStop(1, frozen ? '#4a4a60' : laserT > 0 ? '#b0126a' : '#008c9e');
    ctx.fillStyle = gr; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.85)'; roundRect(ctx, x + h * 0.6, y + 2.5, w - h * 1.2, 2.4, 1.2); ctx.fill();
    ctx.fillStyle = '#ff2e97'; ctx.shadowColor = '#ff2e97'; ctx.shadowBlur = 10;
    roundRect(ctx, x, y, h * 1.1, h, h / 2); ctx.fill(); roundRect(ctx, x + w - h * 1.1, y, h * 1.1, h, h / 2); ctx.fill();
    if (laserT > 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x + 6, y - 5, 3, 6); ctx.fillRect(x + w - 9, y - 5, 3, 6); }
    ctx.restore();
    ctx.globalAlpha = 0.18; ctx.fillStyle = laserT > 0 ? '#ff2e97' : '#00f5d4'; roundRect(ctx, x + 6, paddle.y + h / 2 + 6, w - 12, 3, 1.5); ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawBalls() {
    ctx.globalCompositeOperation = 'lighter';
    const hot = combo >= 8 ? '255,46,151' : combo >= 4 ? '255,158,0' : '0,245,212';
    for (const b of balls) {
      const tr = b.trail, n = tr.length / 2;
      ctx.lineCap = 'butt'; ctx.strokeStyle = `rgb(${hot})`;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        ctx.globalAlpha = k * 0.22; ctx.lineWidth = BALL_R * 2.6 * k;
        ctx.beginPath(); ctx.moveTo(tr[i * 2 - 2], tr[i * 2 - 1]); ctx.lineTo(tr[i * 2], tr[i * 2 + 1]); ctx.stroke();
        ctx.globalAlpha = k * 0.6; ctx.lineWidth = BALL_R * 1.3 * k;
        ctx.beginPath(); ctx.moveTo(tr[i * 2 - 2], tr[i * 2 - 1]); ctx.lineTo(tr[i * 2], tr[i * 2 + 1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const g = BALL_R * 4.4; ctx.drawImage(ballSprite, b.x - g, b.y - g, g * 2, g * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of balls) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R * 0.82, 0, Math.PI * 2); ctx.fill(); }
  }
  function drawPowerBar() {
    const list = [];
    if (wideT > 0) list.push(['W', wideT / 14]);
    if (laserT > 0) list.push(['L', laserT / 10]);
    if (slowT > 0) list.push(['S', slowT / 8]);
    let x = 14; const y = FH - 26;
    ctx.font = `italic 900 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [k, v] of list) {
      const col = POWER_COLORS[k], w = 120;
      ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(ctx, x, y - 10, w, 20, 10); ctx.fill();
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; roundRect(ctx, x, y - 10, Math.max(20, w * v), 20, 10); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#12002b'; ctx.shadowBlur = 4; ctx.fillText(say('pw_' + k).toUpperCase(), x + w / 2, y + 1); ctx.shadowBlur = 0;
      x += w + 10;
    }
  }

  // --- input -----------------------------------------------------------------------------------
  function setTarget(x) { if (!demo) paddle.tx = clamp(x, 0, FW); }

  return {
    layout, update, render, launch, startRun, continueEndless, attract, setTarget, keys,
    get fieldScale() { return scale; },
    get paddleX() { return paddle.tx; },
    get phase() { return phase; },
    get demo() { return demo; },
    get score() { return score; },
    get lives() { return lives; },
    get stageNum() { return stageNum(); },
    get stageNameKey() { return stageNameKey(); },
    get endless() { return endless; },
    get difficulty() { return diff; },
    get combo() { return combo; },
    get summary() { return { score, bestCombo, bricks: bricksBroken, stages: stagesCleared, circuit, endless }; },
  };
}
