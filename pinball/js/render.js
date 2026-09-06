// pinball/js/render.js - every pixel. Owns the canvas, the static playfield art, and the whole
// effects layer (particles, score popups, lamp pulses, screen shake, flashers).
//
// THIS DRAWS THE ATTACHED MODEL (2026-09-06). Every part below is one of the model's own named
// meshes seen from above, and every colour is one of its nine materials, taken verbatim:
//
//     playfield-art  #2a1e49    chrome        #dae0ea    neon-magenta  #ff3392
//     art-lit        #3c2b6d    steel-guide   #a8afbd    neon-cyan     #33dcff
//     ramp-plastic   #7d47dc    rubber        #1a1a22    lamp-amber    #ffb43c
//     bumper-cap     #f0f3fa    steel-ball    #e8ecf2    background    #0e0b17
//
// NO COLOUR HERE IS A CHOICE OF OURS. If one looks wrong, the conversion is wrong. (The old
// renderer's palette - a cyan/magenta/gold set on a purple gradient - was invented, and it is gone.
// The one exception is the score popup's white, which is text, not table paint.)
//
// THREE THINGS SHAPE THIS FILE.
//
// 1. THE STATIC ART IS PAINTED ONCE, INTO AN OFFSCREEN CANVAS. The playfield's paint - the deck,
//    the arch, the ball guides, the lamp inserts, the rosette, the artwork - is a few hundred path
//    operations and it never changes. Re-issuing it sixty times a second is the difference between
//    a table that holds 60 fps on a phone and one that does not, and it costs one cached bitmap
//    keyed on the device-pixel size.
//
// 2. THE EFFECTS LAYER LIVES HERE, NOT IN ui.js. ui.js reads game.js's event stream and calls
//    `spawnHit`, `popup`, `flash`; everything about how those look and decay is this file's
//    business. It means the whole feel of a hit can be retuned without touching the rules or the
//    glue, and it means the rules never learn what a particle is.
//
// 3. REDUCED MOTION THINS THE GARNISH, IT DOES NOT FREEZE THE GAME. A pinball table that does not
//    move is not a pinball table, so `prefers-reduced-motion` here kills screen shake, the
//    full-screen flashers and most particles, and leaves the ball, the flippers and the lamps
//    exactly as they are. (test-visual.mjs drives the game in that mode and fails on a blank or
//    unplayable screen, which is the check that keeps this honest.)

import {
  W, H, ARCH, AXIS, FLIP, PLUNGER, RAMP_PATH, DRAIN_Y, ART, DROP_COUNT,
} from './table.js';
import { rampPoint } from './game.js';

const TAU = Math.PI * 2;

/** The model's own materials. */
const C = {
  void: '#0e0b17',
  art: '#2a1e49',
  artLit: '#3c2b6d',
  chrome: '#dae0ea',
  steel: '#a8afbd',
  magenta: '#ff3392',
  cyan: '#33dcff',
  amber: '#ffb43c',
  violet: '#7d47dc',
  rubber: '#1a1a22',
  cap: '#f0f3fa',
  ball: '#e8ecf2',
  ink: '#120c22',
  // ui.js names four of these by an older set of keys; they are aliased at the bottom of the file
  // so the event glue keeps working without learning the model's vocabulary.
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Screen-door shading for a chrome tube seen from above: a bright core with darker edges. */
function chromeGradient(g, ax, ay, bx, by, w, base) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const grd = g.createLinearGradient(ax - nx * w, ay - ny * w, ax + nx * w, ay + ny * w);
  grd.addColorStop(0, '#5d6478');
  grd.addColorStop(0.42, base);
  grd.addColorStop(0.6, '#ffffff');
  grd.addColorStop(1, '#6c7387');
  return grd;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.static = null;
    this.staticKey = '';
    this.reduced = false;
    try {
      this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch { /* no matchMedia: assume full motion */ }

    // effects
    this.parts = [];
    this.pops = [];
    this.shake = 0;
    this.flashAmt = 0;
    this.flashColor = C.cyan;
    this.popPulse = [0, 0, 0];
    this.slingPulse = [0, 0];
    this.dropAnim = new Array(DROP_COUNT).fill(0);
    this.standPulse = [0, 0];
    this.scoopPulse = 0;
    this.spinAngle = 0;
    this.spinSpeed = 0;
    this.lanePulse = { laneH: 0, laneU: 0, laneB: 0 };
    this.rampGlow = 0;
    this.time = 0;
    this.trails = new Map();
  }

  /** Fit the table into a CSS box. Keeps the aspect ratio; the table never stretches. */
  resize(cssW, cssH) {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.scale = Math.min(cssW / W, cssH / H);
    this.ox = (cssW - W * this.scale) / 2;
    this.oy = (cssH - H * this.scale) / 2;
    const key = `${this.canvas.width}x${this.canvas.height}`;
    if (key !== this.staticKey) { this.staticKey = key; this.static = null; }
  }

  // --- effects API (called by ui.js from the game's event stream) --------------------------------

  /** A burst of sparks at a table position. `n` scales with how hard the hit was. */
  spawnHit(x, y, n, color, speed = 200) {
    if (this.reduced) n = Math.min(n, 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.35 + Math.random() * 0.9);
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        age: 0, life: 0.28 + Math.random() * 0.4, color, r: 1.4 + Math.random() * 2,
      });
    }
    if (this.parts.length > 320) this.parts.splice(0, this.parts.length - 320);
  }

  popup(x, y, text, color = '#fff', big = false) {
    this.pops.push({ x, y, text, color, big, age: 0, life: big ? 1.4 : 0.95 });
    if (this.pops.length > 24) this.pops.shift();
  }

  flash(amount = 0.5, color = C.cyan) {
    if (this.reduced) return;
    this.flashAmt = Math.max(this.flashAmt, amount);
    this.flashColor = color;
  }

  kick(mag = 4) { if (!this.reduced) this.shake = Math.max(this.shake, mag); }

  hitBumper(i) { this.popPulse[i] = 1; }
  hitSling(i) { this.slingPulse[i] = 1; }
  hitStand(i) { this.standPulse[i] = 1; }
  hitScoop() { this.scoopPulse = 1; }
  hitLane(id) { this.lanePulse[id] = 1; }
  hitSpinner(rips) { this.spinSpeed = Math.max(this.spinSpeed, 6 + rips * 2.4); }
  hitRamp() { this.rampGlow = 1; }

  // --- the frame ---------------------------------------------------------------------------------

  /**
   * @param {import('./game.js').Pinball} game
   * @param {number} dt  seconds since the last frame (for effect decay)
   */
  render(game, dt) {
    this.time += dt;
    this._age(dt);

    const ctx = this.ctx;
    const s = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = C.void;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let sx = 0, sy = 0;
    if (this.shake > 0.05) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }

    this._ensureStatic();
    if (this.static) {
      // The cached bitmap was painted with the SAME ox/oy transform, so it is already positioned:
      // blit it at the origin and add only the shake. Re-applying ox/oy here shifts the playfield
      // by twice the centring offset, which is exactly the bug the first browser run showed - the
      // table sitting off to one side with the shooter lane clipped off the right edge.
      ctx.setTransform(1, 0, 0, 1, sx * this.dpr, sy * this.dpr);
      ctx.drawImage(this.static, 0, 0);
    }
    ctx.setTransform(s, 0, 0, s, (this.ox + sx) * this.dpr, (this.oy + sy) * this.dpr);

    const hud = game.hud();
    this._drawInserts(ctx, game, hud);
    this._drawDrops(ctx, game);
    this._drawStands(ctx);
    this._drawSpinner(ctx);
    this._drawScoop(ctx, hud);
    this._drawBumpers(ctx);
    this._drawSlings(ctx);
    this._drawRamp(ctx, game, hud);
    this._drawPlunger(ctx, game, hud);
    this._drawApron(ctx);
    this._drawFlippers(ctx, game);
    this._drawBalls(ctx, game);
    this._drawParticles(ctx);
    this._drawPopups(ctx);

    if (this.flashAmt > 0.01) {
      ctx.globalAlpha = this.flashAmt * 0.45;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (hud.tilt) {
      ctx.globalAlpha = 0.26 + Math.sin(this.time * 9) * 0.08;
      ctx.fillStyle = C.magenta;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  _age(dt) {
    this.shake *= Math.pow(0.0016, dt);
    this.flashAmt *= Math.pow(0.0009, dt);
    for (let i = 0; i < this.popPulse.length; i++) this.popPulse[i] = Math.max(0, this.popPulse[i] - dt * 4.5);
    for (let i = 0; i < 2; i++) {
      this.slingPulse[i] = Math.max(0, this.slingPulse[i] - dt * 6);
      this.standPulse[i] = Math.max(0, this.standPulse[i] - dt * 4);
    }
    this.scoopPulse = Math.max(0, this.scoopPulse - dt * 2.2);
    this.rampGlow = Math.max(0, this.rampGlow - dt * 1.1);
    for (const k of Object.keys(this.lanePulse)) this.lanePulse[k] = Math.max(0, this.lanePulse[k] - dt * 3);
    this.spinSpeed *= Math.pow(0.12, dt);
    this.spinAngle += this.spinSpeed * dt;

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy += 900 * dt;
      p.vx *= Math.pow(0.2, dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dt;
      if (p.age >= p.life) this.pops.splice(i, 1);
    }
  }

  // --- static playfield ---------------------------------------------------------------------------

  _ensureStatic() {
    if (this.static) return;
    const cv = document.createElement('canvas');
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const g = cv.getContext('2d');
    const s = this.scale * this.dpr;
    g.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
    this._paintPlayfield(g);
    this.static = cv;
  }

  /** The model's `deck` outline: straight sides, the arch across the top, a soft bottom edge. */
  _deckPath(g, inset = 0) {
    const left = 4 + inset, right = W - 4 - inset;
    g.beginPath();
    g.moveTo(left, ARCH.cy);
    g.arc(ARCH.cx, ARCH.cy, ARCH.rOut - inset, Math.PI, TAU);
    g.lineTo(right, DRAIN_Y + 26);
    g.quadraticCurveTo(right, DRAIN_Y + 40, right - 22, DRAIN_Y + 40);
    g.lineTo(left + 22, DRAIN_Y + 40);
    g.quadraticCurveTo(left, DRAIN_Y + 40, left, DRAIN_Y + 26);
    g.closePath();
  }

  _paintPlayfield(g) {
    // --- deck + cabinet rail (the model's `deck` and `cabinet-rail`) -----------------------------
    g.save();
    this._deckPath(g, -14);
    g.fillStyle = C.chrome;
    g.fill();
    this._deckPath(g, -14);
    g.strokeStyle = '#6c7387';
    g.lineWidth = 2;
    g.stroke();

    this._deckPath(g, 0);
    g.fillStyle = C.art;
    g.fill();
    g.save();
    this._deckPath(g, 0);
    g.clip();

    // --- printed art: `art-halo-upper` and `art-fan-lower` ----------------------------------------
    g.fillStyle = C.artLit;
    g.beginPath();
    g.arc(ARCH.cx, ARCH.cy, ARCH.rOut - 6, Math.PI, TAU);
    g.arc(ARCH.cx, ARCH.cy, ARCH.rIn - 34, TAU, Math.PI, true);
    g.closePath();
    g.fill();

    g.globalAlpha = 0.6;
    g.beginPath();
    g.moveTo(AXIS, DRAIN_Y - 34);
    g.lineTo(AXIS + 82, 470);
    g.lineTo(AXIS - 82, 470);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;

    // A faint radial lift behind the rosette, which is where the model puts its brightest art.
    const rose = ART.rosette;
    const glow = g.createRadialGradient(rose.x, rose.y, 6, rose.x, rose.y, rose.r * 2.4);
    glow.addColorStop(0, 'rgba(125,71,220,0.42)');
    glow.addColorStop(1, 'rgba(125,71,220,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    // --- ball guides ------------------------------------------------------------------------------
    this._archGuides(g);
    this._guide(g, [[4, ARCH.cy], [4, 500], [66, 646]], 8, C.chrome);
    this._guide(g, [[344, ARCH.cy], [344, 650]], 9, C.chrome);
    this._guide(g, [[310, 200], [310, 650]], 9, C.chrome);
    this._guide(g, [[310, 500], [248, 646]], 8, C.chrome);
    this._guide(g, [[46, ARCH.cy], [46, 262], [86, 308]], 8, C.steel);
    for (const d of ART.divs) this._guide(g, d, 10, C.chrome);
    this._gate(g, 344, ARCH.cy, 296, 216);

    // --- lamp inserts and arrows ------------------------------------------------------------------
    this._rosette(g);
    this._laneArt(g);
    this._lampRun(g, [[18, 468], [18, 498], [18, 528], [18, 558]], C.amber);
    this._lampRun(g, [[296, 470], [296, 500], [296, 530], [296, 560]], C.amber);
    this._arrows(g, 78, 452, -0.55, C.cyan);       // up the left, at the orbit
    this._arrows(g, 240, 452, 0.55, C.cyan);       // up the right, at the scoop
    this._arrows(g, 96, 396, -0.5, C.magenta);     // across, at the drop bank

    // The model's `return-rail` wireform is deliberately NOT drawn. Seen from above it is two
    // hairlines crossing the ramp, the drop bank and the rosette, and a screenshot showed exactly
    // that: a stray diagonal line over half the table that reads as a rendering fault. Its data is
    // still in table.js's ART if a future pass finds it a route of its own.

    // --- posts (chrome with a rubber ring), the model's own list ----------------------------------
    for (const [x, y] of ART.posts) this._post(g, x, y, 6);
    for (const x of ART.laneX) {
      const top = ARCH.cy - Math.sqrt(ARCH.rIn * ARCH.rIn - (x - ARCH.cx) * (x - ARCH.cx)) + 3;
      this._guide(g, [[x, 108], [x, top]], 8, C.steel);
    }

    g.restore();
    g.restore();
  }

  /** The arch: the deck's own edge is the orbit lane's outer wall, and `orbit-wall-inner` is the
   *  inner one. Drawn as two chrome bands with the lane's floor lit between them. */
  _archGuides(g) {
    g.save();
    g.beginPath();
    g.arc(ARCH.cx, ARCH.cy, ARCH.rOut - 4, Math.PI, TAU);
    g.arc(ARCH.cx, ARCH.cy, ARCH.rIn + 4, TAU, Math.PI, true);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fill();
    g.restore();

    g.lineCap = 'round';
    g.lineWidth = 9;
    g.strokeStyle = C.chrome;
    g.beginPath();
    g.arc(ARCH.cx, ARCH.cy, ARCH.rOut, Math.PI, TAU);
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(ARCH.cx, ARCH.cy, ARCH.rOut - 2, Math.PI, TAU);
    g.stroke();

    g.lineWidth = 8;
    g.strokeStyle = C.steel;
    g.beginPath();
    g.arc(ARCH.cx, ARCH.cy, ARCH.rIn, Math.PI, TAU - 12 * Math.PI / 180);
    g.stroke();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.arc(ARCH.cx, ARCH.cy, ARCH.rIn - 2, Math.PI, TAU - 12 * Math.PI / 180);
    g.stroke();
  }

  /** A chrome ball guide along a polyline: a wide dark base, the tube, and a highlight. */
  _guide(g, pts, w, base) {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = w + 3;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();

    g.lineWidth = w;
    g.strokeStyle = chromeGradient(g, pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1], w, base);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();

    g.lineWidth = Math.max(1, w * 0.28);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }

  /** The one-way shooter-lane gate: a hinged flap, drawn with its hinge dot so it reads as one. */
  _gate(g, ax, ay, bx, by) {
    g.lineCap = 'round';
    g.lineWidth = 4;
    g.strokeStyle = C.steel;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    g.fillStyle = C.chrome;
    g.beginPath();
    g.arc(ax, ay, 4, 0, TAU);
    g.fill();
  }

  /** The model's sixteen-lamp rosette: a ring of alternating cyan and magenta lenses with an amber
   *  jackpot lamp at the centre. Pure paint - the ramp flies over it. */
  _rosette(g) {
    const { x, y, r, lamps } = ART.rosette;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(x, y, r - 16, 0, TAU); g.fill();
    g.lineWidth = 3.5;
    g.strokeStyle = C.chrome;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
    for (let i = 0; i < lamps; i++) {
      const a = i * TAU / lamps;
      this._insert(g, x + Math.cos(a) * r, y + Math.sin(a) * r, 6, i % 2 ? C.cyan : C.magenta, 0.5);
    }
    this._insert(g, x, y, 12, C.amber, 0.9);
  }

  /** The three rollover lanes across the crown, and their lamps. */
  _laneArt(g) {
    for (const [x, y] of ART.lanes) {
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 12, y + 22);
      g.lineTo(x - 12, y - 22);
      g.moveTo(x + 12, y + 22);
      g.lineTo(x + 12, y - 22);
      g.stroke();
      this._insert(g, x, y, 8, C.cyan, 0.4);
    }
  }

  _lampRun(g, pts, color) {
    for (const [x, y] of pts) this._insert(g, x, y, 5, color, 0.8);
  }

  /** A painted lamp lens: dark rim, coloured lens, specular dot. `lit` is its resting brightness. */
  _insert(g, x, y, r, color, lit) {
    g.save();
    g.globalAlpha = lit;
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.restore();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, TAU); g.fill();
  }

  /** The model's `arrowInsert`: a painted chevron pointing at a shot. */
  _arrows(g, x, y, ang, color) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 0.3 + i * 0.14;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, -18 + i * 13);
      g.lineTo(9, -6 + i * 13);
      g.lineTo(-9, -6 + i * 13);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** The model's `post`: a chrome cylinder with a black rubber ring round it. */
  _post(g, x, y, r) {
    g.fillStyle = C.rubber;
    g.beginPath(); g.arc(x, y, r + 3.5, 0, TAU); g.fill();
    const grd = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, '#8b93a6');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  // --- live parts ---------------------------------------------------------------------------------

  /** The lamp inserts game.js actually lights. Painted OVER the static art so they can change. */
  _drawInserts(ctx, game, hud) {
    const lit = {
      ramp: hud.lockLit || (game.mission && game.mission.id === 'ramp'),
      scoop: hud.bankLit || hud.lockLit || hud.superLit,
      bank: !hud.bankLit,
      orbit: !!(game.mission && game.mission.id === 'spin'),
      inlaneL: this.lanePulse.laneH > 0,
      inlaneR: this.lanePulse.laneB > 0,
      saveL: hud.save > 0,
      saveR: hud.save > 0,
    };
    const pulse = 0.55 + Math.sin(this.time * 6) * 0.45;
    for (const [x, y, key, rot] of ART.inserts) {
      const on = lit[key];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.globalAlpha = on ? 0.55 + pulse * 0.45 : 0.16;
      ctx.fillStyle = key === 'ramp' ? C.violet : key.startsWith('save') ? C.amber : C.cyan;
      ctx.beginPath();
      ctx.moveTo(0, -13); ctx.lineTo(8, 5); ctx.lineTo(-8, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /** The drop bank: three targets in steel frames, the middle one amber like the model's. */
  _drawDrops(ctx, game) {
    const { a, u, len, step, count } = ART.bank;
    for (let i = 0; i < count; i++) {
      const down = game.drops && game.drops[i];
      const s = i * step;
      const x0 = a[0] + u[0] * s, y0 = a[1] + u[1] * s;
      const x1 = a[0] + u[0] * (s + len), y1 = a[1] + u[1] * (s + len);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 13;
      ctx.strokeStyle = C.steel;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = down ? 0.18 : 1;
      ctx.lineWidth = 9;
      ctx.strokeStyle = i === 1 ? C.amber : C.cap;
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.restore();
    }
  }

  /** The two stand-up targets, flush to the side walls. */
  _drawStands(ctx) {
    ART.stands.forEach((s, i) => {
      const p = this.standPulse[i];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = C.magenta;
      ctx.globalAlpha = 0.6 + p * 0.4;
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      ctx.lineTo(s[1][0], s[1][1]);
      ctx.stroke();
      ctx.restore();
    });
  }

  /** The spinner in the left orbit lane: two chrome posts and an amber blade that really spins. */
  _drawSpinner(ctx) {
    const { x, y, w } = ART.spinner;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = C.chrome;
    ctx.beginPath(); ctx.arc(-w / 2, 0, 3.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2, 0, 3.5, 0, TAU); ctx.fill();
    const h = Math.abs(Math.cos(this.spinAngle)) * 11 + 1.5;
    ctx.fillStyle = Math.cos(this.spinAngle) > 0 ? C.amber : '#a06f16';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** The kickout scoop: a black hole in a chrome ring, its rim drawn as the model's near-closed
   *  collar so the mouth is visible. */
  _drawScoop(ctx, hud) {
    const sc = ART.scoop;
    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(sc.x, sc.y, sc.rad - 3, 0, TAU); ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = C.chrome;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, sc.rad, sc.mouth + sc.half, sc.mouth - sc.half + TAU);
    ctx.stroke();
    const on = hud.bankLit || hud.lockLit || hud.superLit;
    if (on || this.scoopPulse > 0) {
      ctx.globalAlpha = 0.3 + (this.scoopPulse * 0.5) + (on ? 0.35 + Math.sin(this.time * 7) * 0.2 : 0);
      ctx.fillStyle = hud.superLit ? C.magenta : C.cyan;
      ctx.beginPath(); ctx.arc(sc.x, sc.y, sc.rad - 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /** Three pop bumpers: chrome skirt, coloured ring, white cap, chrome collar. The model alternates
   *  magenta / cyan / magenta and so does this. */
  _drawBumpers(ctx) {
    ART.pops.forEach(([x, y], i) => {
      const p = this.popPulse[i];
      const ring = i === 1 ? C.cyan : C.magenta;
      const r = ART.popR;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 + p * 0.09, 1 + p * 0.09);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, TAU); ctx.fill();
      ctx.fillStyle = C.steel;
      ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.55 + p * 0.45;
      ctx.fillStyle = ring;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      const grd = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r * 0.78);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, C.cap);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, TAU); ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = C.chrome;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, TAU); ctx.stroke();
      ctx.restore();
    });
  }

  /** Two slingshots: the model's violet plate, a black rubber band across its face, three chrome
   *  posts and an amber lamp. */
  _drawSlings(ctx) {
    ART.slings.forEach((s, i) => {
      const p = this.slingPulse[i];
      const [ax, ay] = s[0], [bx, by] = s[1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const side = i === 0 ? -1 : 1;
      ctx.save();
      ctx.fillStyle = C.violet;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + nx * 34 * side, by + ny * 34 * side);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.chrome;
      ctx.stroke();
      ctx.lineCap = 'round';
      ctx.lineWidth = 11 + p * 5;
      ctx.strokeStyle = C.chrome;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.lineWidth = 7 + p * 5;
      ctx.strokeStyle = p > 0.05 ? C.cap : C.rubber;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      this._post(ctx, ax, ay, 5);
      this._post(ctx, bx, by, 5);
      const mx = (ax + bx) / 2 + nx * 20 * side, my = (ay + by) / 2 + ny * 20 * side;
      ctx.globalAlpha = 0.4 + p * 0.6;
      ctx.fillStyle = C.amber;
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, TAU); ctx.fill();
      ctx.restore();
    });
  }

  /** The model's violet U-channel ramp, drawn as an elevated habitrail: a shadow on the deck, the
   *  channel floor, two chrome side rails, and support legs. Brightens while a ball rides it. */
  _drawRamp(ctx, game, hud) {
    const glow = Math.max(this.rampGlow, hud && hud.multiball ? 0.4 : 0);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // The channel is TRANSLUCENT, and that is not decoration. In the model the ramp is a raised
    // plastic U-channel you look straight through; drawn opaque from above it is a 26-unit band
    // right across the middle of the table that hides the rosette, the drop bank and half the
    // playfield art underneath it. Seeing the deck through it is both truer to the model and the
    // only way the shots it flies over stay readable.
    const line = (off = 0) => {
      const pts = off === 0 ? RAMP_PATH : RAMP_PATH.map((p, i) => {
        const q = RAMP_PATH[Math.min(RAMP_PATH.length - 1, i + 1)];
        const r = RAMP_PATH[Math.max(0, i - 1)];
        const dx = q[0] - r[0], dy = q[1] - r[1];
        const l = Math.hypot(dx, dy) || 1;
        return [p[0] + (-dy / l) * off, p[1] + (dx / l) * off];
      });
      // Quadratic through the midpoints: smooth enough to lose the eleven corners of the raw
      // spline, close enough to it that the ball riding RAMP_PATH never leaves the channel.
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx0 = (pts[i][0] + pts[i + 1][0]) / 2, my0 = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx0, my0);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    };

    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 30;
    ctx.strokeStyle = '#000000';
    line(); ctx.stroke();

    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 26;
    ctx.strokeStyle = C.violet;
    line(); ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 15;
    ctx.strokeStyle = '#ffffff';
    line(); ctx.stroke();

    if (glow > 0.02) {
      ctx.globalAlpha = glow * 0.5;
      ctx.lineWidth = 18;
      ctx.strokeStyle = C.cyan;
      line(); ctx.stroke();
    }

    // side rails: solid, because the rails are the part you actually read the ramp by
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = C.chrome;
    line(-13); ctx.stroke();
    line(13); ctx.stroke();

    // the model's ramp-entry flap
    ctx.globalAlpha = 1;
    ctx.lineWidth = 5;
    ctx.strokeStyle = C.chrome;
    ctx.beginPath();
    ctx.moveTo(RAMP_PATH[0][0] - 15, RAMP_PATH[0][1] + 9);
    ctx.lineTo(RAMP_PATH[0][0] + 15, RAMP_PATH[0][1] + 9);
    ctx.stroke();

    // support legs
    ctx.fillStyle = C.steel;
    for (let i = 1; i < RAMP_PATH.length - 1; i += 3) {
      ctx.beginPath(); ctx.arc(RAMP_PATH[i][0], RAMP_PATH[i][1], 3.5, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // a ball riding the habitrail, drawn on top of the channel
    for (const b of game.balls) {
      if (!b.held || b.ramp == null) continue;
      const p = rampPoint(b.ramp);
      this._ball(ctx, p.x, p.y, 1.06);
    }
  }

  /** The shooter lane: the model's rod, spring coils, magenta tip and anchor, plus a power meter
   *  that only appears while the plunger is being pulled. */
  _drawPlunger(ctx, game, hud) {
    const pull = game.plungerHeld ? game.plungerPower : 0;
    const x = PLUNGER.x;
    const y0 = PLUNGER.y + 22 + pull * 16;
    ctx.save();
    ctx.strokeStyle = C.steel;
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const yy = y0 + 6 + i * 5;
      if (yy > DRAIN_Y + 34) break;
      ctx.beginPath(); ctx.arc(x, yy, 8, 0, Math.PI); ctx.stroke();
    }
    ctx.lineWidth = 6;
    ctx.strokeStyle = C.chrome;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + 8); ctx.stroke();
    ctx.fillStyle = C.magenta;
    ctx.beginPath(); ctx.arc(x, y0, 10, 0, TAU); ctx.fill();
    if (pull > 0.01) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 7, 300, 14, 260);
      const h = 260 * pull;
      ctx.fillStyle = pull > 0.85 ? C.magenta : C.amber;
      ctx.fillRect(x - 6, 560 - h, 12, h);
    }
    ctx.restore();
    if (hud.phase === 'ready' && !game.plungerHeld) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(this.time * 5) * 0.25;
      ctx.fillStyle = C.cap;
      ctx.beginPath();
      ctx.moveTo(x, PLUNGER.y - 40);
      ctx.lineTo(x + 9, PLUNGER.y - 22);
      ctx.lineTo(x - 9, PLUNGER.y - 22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /** The model's two chrome apron plates either side of the drain. */
  _drawApron(ctx) {
    ctx.save();
    ctx.fillStyle = C.steel;
    ctx.globalAlpha = 0.9;
    for (const side of [-1, 1]) {
      const x0 = AXIS + side * 40, x1 = AXIS + side * 152;
      ctx.beginPath();
      ctx.moveTo(x0, DRAIN_Y + 34);
      ctx.lineTo(x1, DRAIN_Y + 34);
      ctx.lineTo(x1, DRAIN_Y - 8);
      ctx.lineTo(x0, DRAIN_Y + 12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Two flippers: the model's chrome body with its cyan bat inlay and a steel pivot pin. */
  _drawFlippers(ctx, game) {
    for (const f of game.flippers) {
      const ex = f.px + Math.cos(f.angle) * f.len;
      const ey = f.py + Math.sin(f.angle) * f.len;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = (FLIP.r + 3) * 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.moveTo(f.px, f.py); ctx.lineTo(ex, ey); ctx.stroke();

      ctx.lineWidth = FLIP.r * 2;
      // Centred on the PADDLE, not on its pivot. A gradient anchored at the pivot leaves the whole
      // outer half of the bat on the far end of the ramp, so a raised flipper paints solid white.
      const mx0 = (f.px + ex) / 2, my0 = (f.py + ey) / 2;
      ctx.strokeStyle = chromeGradient(ctx, mx0, my0, ex, ey, FLIP.r * 2, C.chrome);
      ctx.beginPath(); ctx.moveTo(f.px, f.py); ctx.lineTo(ex, ey); ctx.stroke();

      ctx.lineWidth = FLIP.r * 0.9;
      ctx.strokeStyle = C.cyan;
      ctx.globalAlpha = f.pressed ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(f.px + Math.cos(f.angle) * 10, f.py + Math.sin(f.angle) * 10);
      ctx.lineTo(f.px + Math.cos(f.angle) * (f.len - 8), f.py + Math.sin(f.angle) * (f.len - 8));
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = C.steel;
      ctx.beginPath(); ctx.arc(f.px, f.py, 5, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  _ball(ctx, x, y, scale = 1) {
    const r = 9 * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(x + 2.5, y + 3, r, 0, TAU); ctx.fill();
    const grd = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.45, C.ball);
    grd.addColorStop(1, '#5c6473');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r - 0.6, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  _drawBalls(ctx, game) {
    for (const b of game.balls) {
      if (!b.live) continue;
      if (b.held && b.ramp != null) continue;    // already drawn on the habitrail
      // A short motion trail, which is the one thing that makes a fast ball readable at 60 fps on a
      // phone. Skipped under reduced motion.
      if (!this.reduced) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 240) {
          ctx.save();
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = C.ball;
          ctx.lineWidth = 13;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
          ctx.stroke();
          ctx.restore();
        }
      }
      this._ball(ctx, b.x, b.y);
    }
  }

  _drawParticles(ctx) {
    for (const p of this.parts) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.5 + k * 0.7), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawPopups(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.pops) {
      const k = p.age / p.life;
      ctx.save();
      ctx.globalAlpha = clamp(1 - k * k, 0, 1);
      ctx.font = `800 ${p.big ? 30 : 20}px system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(p.text, p.x, p.y - k * 40);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - k * 40);
      ctx.restore();
    }
  }
}

// ui.js drains game.js's event stream and names four colours by an older, generic set of keys. They
// map onto the model's materials rather than being separate values, so nothing in this file has a
// colour of its own that the model did not supply.
const PALETTE = {
  ...C,
  gold: C.amber,
  green: C.cyan,
  red: C.magenta,
  metal: C.chrome,
};

export { PALETTE };
export default { Renderer, PALETTE };
