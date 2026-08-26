// pinball/js/render.js - every pixel. Owns the canvas, the static playfield art, and the whole
// effects layer (particles, score popups, lamp pulses, screen shake, flashers).
//
// THREE THINGS SHAPE THIS FILE.
//
// 1. THE STATIC ART IS PAINTED ONCE, INTO AN OFFSCREEN CANVAS. The playfield's paint - the arch,
//    the walls, the lane guides, the arrows, the artwork - is a few hundred path operations and it
//    never changes. Re-issuing it sixty times a second is the difference between a table that
//    holds 60 fps on a phone and one that does not, and it costs one cached bitmap keyed on the
//    device-pixel size.
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
  W, H, ARCH, AXIS, FLIP, PLUNGER, RAMP_PATH, DRAIN_Y, ART, SWITCHES, DROP_COUNT,
} from './table.js';
import { rampPoint } from './game.js';

const TAU = Math.PI * 2;

const C = {
  void: '#05030f',
  bg0: '#150a33',
  bg1: '#2a1163',
  bg2: '#0c0724',
  cyan: '#3ee8ff',
  magenta: '#ff4fd8',
  gold: '#F2B705',
  green: '#3ef2a0',
  red: '#E0532F',
  metal: '#cfd8e6',
  metalMid: '#8e9bb3',
  metalDark: '#39415a',
  ink: '#0a0718',
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
    // 2, not 2.5 (2026-08-26): 2.5 is 56% more pixels to fill every frame than 2, and the repo's
    // other canvases all cap at 2 with nobody able to tell them apart on a phone.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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
    const count = this.reduced ? Math.min(3, n) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.85);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 0.28 + Math.random() * 0.42, age: 0,
        size: 1.6 + Math.random() * 2.6, color,
      });
    }
    if (this.parts.length > 320) this.parts.splice(0, this.parts.length - 320);
  }

  /** A floating score / label. Anchored in table space so it drifts with the shot that made it. */
  popup(x, y, text, color = '#fff', big = false) {
    this.pops.push({ x, y, text, color, big, age: 0, life: big ? 1.5 : 1.0 });
    if (this.pops.length > 26) this.pops.shift();
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
    ctx.setTransform(s, 0, 0, s, (this.ox + sx) * this.dpr, (this.oy + sy) * this.dpr);

    this._ensureStatic();
    if (this.static) {
      // The cached bitmap was painted with the SAME ox/oy transform, so it is already positioned:
      // blit it at the origin and add only the shake. Re-applying ox/oy here shifts the playfield
      // by twice the centring offset, which is exactly the bug the first browser run showed - the
      // table sitting off to one side with the shooter lane clipped off the right edge.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, sx * this.dpr, sy * this.dpr);
      ctx.drawImage(this.static, 0, 0);
      ctx.restore();
    }

    const hud = game.hud();
    this._drawInserts(ctx, game, hud);
    this._drawDrops(ctx, game);
    this._drawStands(ctx);
    this._drawSpinner(ctx, game);
    this._drawScoop(ctx, game, hud);
    this._drawBumpers(ctx);
    this._drawSlings(ctx);
    this._drawRamp(ctx, game, hud);
    this._drawPlunger(ctx, game, hud);
    this._drawFlippers(ctx, game);
    this._drawBalls(ctx, game);
    this._drawParticles(ctx);
    this._drawPopups(ctx);

    if (this.flashAmt > 0.01) {
      ctx.globalAlpha = this.flashAmt * 0.5;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (hud.tilt) {
      ctx.globalAlpha = 0.28 + Math.sin(this.time * 9) * 0.08;
      ctx.fillStyle = C.red;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  _age(dt) {
    this.shake *= Math.pow(0.0016, dt);
    this.flashAmt *= Math.pow(0.0009, dt);
    for (let i = 0; i < 3; i++) this.popPulse[i] = Math.max(0, this.popPulse[i] - dt * 4.5);
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

  _paintPlayfield(g) {
    // --- the wood: a deep space gradient with a nebula and a star field ---------------------------
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, C.bg1);
    bg.addColorStop(0.42, C.bg0);
    bg.addColorStop(1, C.bg2);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    const neb = g.createRadialGradient(AXIS, 250, 20, AXIS, 250, 300);
    neb.addColorStop(0, 'rgba(120,60,255,0.42)');
    neb.addColorStop(0.55, 'rgba(60,30,150,0.20)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = neb;
    g.fillRect(0, 0, W, H);

    // Deterministic stars: a fixed lattice jittered by a hash, so the sky is identical every mount
    // (a Math.random field would twinkle differently on every resize, which reads as a bug).
    g.save();
    for (let i = 0; i < 220; i++) {
      const h = Math.sin(i * 12.9898) * 43758.5453;
      const hx = h - Math.floor(h);
      const h2 = Math.sin(i * 78.233) * 12345.6789;
      const hy = h2 - Math.floor(h2);
      const x = hx * W, y = hy * H;
      const r = 0.4 + hx * 1.3;
      g.globalAlpha = 0.18 + hy * 0.5;
      g.fillStyle = i % 7 === 0 ? C.cyan : '#ffffff';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.restore();

    // --- painted lane art (under everything else) ------------------------------------------------
    this._paintLanePaint(g);

    // --- the shooter lane -------------------------------------------------------------------------
    g.save();
    g.fillStyle = 'rgba(10,6,26,0.75)';
    g.fillRect(356, 250, 36, 480);
    g.restore();

    // --- walls ------------------------------------------------------------------------------------
    // Arch: the orbit channel painted as a lane, then both rails as real metal.
    g.save();
    g.beginPath();
    g.arc(ARCH.cx, ARCH.cy, (ARCH.rOut + ARCH.rIn) / 2, Math.PI, TAU);
    g.strokeStyle = 'rgba(62,232,255,0.10)';
    g.lineWidth = ARCH.rOut - ARCH.rIn - 8;
    g.stroke();
    g.restore();

    this._rail(g, (p) => { p.arc(ARCH.cx, ARCH.cy, ARCH.rOut, Math.PI, TAU); });
    this._rail(g, (p) => { p.arc(ARCH.cx, ARCH.cy, ARCH.rIn, Math.PI, TAU - 20 * Math.PI / 180); });

    this._rail(g, (p) => { p.moveTo(12, 250); p.lineTo(12, 556); p.lineTo(76, 716); });
    this._rail(g, (p) => { p.moveTo(390, 250); p.lineTo(390, 730); });
    this._rail(g, (p) => { p.moveTo(356, 290); p.lineTo(356, 730); });
    this._rail(g, (p) => { p.moveTo(356, 556); p.lineTo(292, 716); });
    this._rail(g, (p) => { p.moveTo(356, 724); p.lineTo(390, 724); });
    this._rail(g, (p) => { p.moveTo(46, 250); p.lineTo(46, 392); });

    // One-way gates get their own look: thin, brassy, obviously a flap rather than a wall.
    this._gate(g, 390, 250, 356, 290);
    this._gate(g, 46, 392, 92, 444);

    // Ramp mouth guides.
    this._rail(g, (p) => { p.moveTo(158, 436); p.lineTo(168, 396); }, C.magenta);
    this._rail(g, (p) => { p.moveTo(210, 436); p.lineTo(200, 396); }, C.magenta);

    // Inlane / outlane dividers.
    for (const [ax, ay, bx, by] of [[40, 524, 110, 634], [328, 524, 258, 634]]) {
      this._rubberRail(g, ax, ay, bx, by, 5, '#9fb0d6');
    }

    // Lane-divider posts at the top.
    for (const [x, y] of [[172, 140], [212, 140]]) this._post(g, x, y, 6);

    // The drain lip, so the bottom of the table reads as a hole rather than an edge.
    const dg = g.createLinearGradient(0, DRAIN_Y - 40, 0, H);
    dg.addColorStop(0, 'rgba(0,0,0,0)');
    dg.addColorStop(1, 'rgba(0,0,0,0.92)');
    g.fillStyle = dg;
    g.fillRect(0, DRAIN_Y - 40, W, H - DRAIN_Y + 40);
  }

  /** The painted-on artwork: shot arrows, lane fills, the table's name. Pure decoration. */
  _paintLanePaint(g) {
    g.save();

    // Big painted disc behind the bumper nest.
    const rg = g.createRadialGradient(AXIS, 235, 10, AXIS, 235, 150);
    rg.addColorStop(0, 'rgba(255,79,216,0.20)');
    rg.addColorStop(1, 'rgba(255,79,216,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(AXIS, 235, 150, 0, TAU); g.fill();

    // Shot arrows: three chevrons pointing the way each major shot goes.
    this._arrows(g, 184, 470, -Math.PI / 2, C.magenta);          // ramp, straight up
    this._arrows(g, 322, 400, -Math.PI / 2 - 0.18, C.cyan);      // right lane to the scoop
    this._arrows(g, 30, 420, -Math.PI / 2, C.gold);              // left orbit
    this._arrows(g, 128, 424, -0.93, C.green);                   // drop target bank

    // The three top rollover lanes, painted as real lane channels with their letters. Without this
    // they are three invisible switches under the arch and nobody discovers the bonus multiplier.
    ART.lanes.forEach(([lx, ly], i) => {
      g.save();
      g.translate(lx, ly);
      g.rotate((i - 1) * 0.22);
      g.strokeStyle = 'rgba(62,232,255,0.13)';
      g.lineWidth = 22;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, -22); g.lineTo(0, 26); g.stroke();
      g.globalAlpha = 0.5;
      g.fillStyle = C.cyan;
      g.font = '800 15px "Trebuchet MS", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('HUB'[i], 0, 2);
      g.restore();
    });

    // Inlane / outlane paint.
    for (const [[ax, ay], [bx, by]] of [[[75, 501], [145, 612]], [[293, 501], [223, 612]]]) {
      g.strokeStyle = 'rgba(62,232,255,0.10)';
      g.lineWidth = 26;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ax + (bx - ax) * 0.12, ay + (by - ay) * 0.12);
      g.lineTo(bx, by);
      g.stroke();
    }

    // The table's name across the lower playfield, ghosted into the paint. Split STAR / H U B
    // on purpose: the lower half echoes the three H-U-B rollover lanes at the top of the table.
    g.save();
    g.translate(AXIS, 552);
    g.globalAlpha = 0.10;
    g.fillStyle = '#ffffff';
    g.font = '700 34px "Trebuchet MS", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STAR', 0, -14);
    g.font = '700 17px "Trebuchet MS", system-ui, sans-serif';
    g.fillText('H  U  B', 0, 12);
    g.restore();

    g.restore();
  }

  _arrows(g, x, y, ang, color) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 0.16 + i * 0.07;
      g.fillStyle = color;
      g.beginPath();
      const o = i * 15;
      g.moveTo(o, -11); g.lineTo(o + 11, 0); g.lineTo(o, 11); g.lineTo(o + 4, 0);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** A chromed metal rail: dark casing, bright core, one highlight. */
  _rail(g, path, tint) {
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath(); path(g);
    g.strokeStyle = C.ink; g.lineWidth = 11; g.stroke();
    g.beginPath(); path(g);
    g.strokeStyle = tint || C.metalMid; g.lineWidth = 8; g.stroke();
    g.beginPath(); path(g);
    g.strokeStyle = tint ? 'rgba(255,255,255,0.55)' : C.metal; g.lineWidth = 3.2; g.stroke();
    g.restore();
  }

  /** A rubber-sleeved guide: the dividers and the sling bodies. */
  _rubberRail(g, ax, ay, bx, by, r, color = '#f4f6ff') {
    g.save();
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
    g.strokeStyle = C.ink; g.lineWidth = r * 2 + 4; g.stroke();
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
    g.strokeStyle = color; g.lineWidth = r * 2; g.stroke();
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = r * 0.7; g.stroke();
    g.restore();
  }

  _gate(g, ax, ay, bx, by) {
    g.save();
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
    g.strokeStyle = C.ink; g.lineWidth = 9; g.stroke();
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
    g.strokeStyle = C.gold; g.lineWidth = 4.5; g.stroke();
    g.setLineDash([6, 7]);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.8; g.stroke();
    g.restore();
  }

  _post(g, x, y, r) {
    g.save();
    g.beginPath(); g.arc(x, y, r + 1.5, 0, TAU); g.fillStyle = C.ink; g.fill();
    const grd = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, C.metalMid);
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = grd; g.fill();
    g.restore();
  }

  // --- live playfield elements ---------------------------------------------------------------------

  /** Lamp inserts. Lit is brighter AND filled with a ring; unlit is a dark hollow lens, so the two
   *  states differ by shape as well as by brightness (the hub's colourblind rule). */
  _drawInserts(ctx, game, hud) {
    const lit = {
      ramp: hud.multiball || hud.lockLit || (hud.mission && hud.mission.id === 'ramp'),
      scoop: hud.bankLit || hud.lockLit || hud.superLit,
      bank: !hud.bankLit,
      orbit: !!(hud.mission && hud.mission.id === 'spin'),
      inlaneL: hud.multiball, inlaneR: hud.multiball,
      saveL: hud.save > 0, saveR: hud.save > 0,
    };
    const color = { ramp: C.magenta, scoop: C.cyan, bank: C.green, orbit: C.gold, inlaneL: C.cyan, inlaneR: C.cyan, saveL: C.green, saveR: C.green };
    const pulse = 0.62 + Math.sin(this.time * 6) * 0.38;
    for (const [x, y, key, rot] of ART.inserts) {
      const on = !!lit[key];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const col = color[key] || C.cyan;
      ctx.beginPath();
      roundRect(ctx, -12, -5.5, 24, 11, 5.5);
      ctx.fillStyle = on ? col : 'rgba(255,255,255,0.06)';
      ctx.globalAlpha = on ? 0.35 + pulse * 0.45 : 1;
      if (on) { ctx.shadowColor = col; ctx.shadowBlur = 16; }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      roundRect(ctx, -12, -5.5, 24, 11, 5.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawBumpers(ctx) {
    ART.pops.forEach(([x, y], i) => {
      const p = this.popPulse[i];
      const r = 20 + p * 4;
      ctx.save();
      ctx.translate(x, y);

      ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, TAU);
      ctx.fillStyle = `rgba(62,232,255,${0.08 + p * 0.4})`;
      ctx.fill();

      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
      ctx.fillStyle = C.ink; ctx.fill();

      const g2 = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r);
      g2.addColorStop(0, p > 0.05 ? '#ffffff' : '#7fe9ff');
      g2.addColorStop(0.55, p > 0.05 ? C.cyan : '#1d6fa8');
      g2.addColorStop(1, '#0b2b44');
      ctx.beginPath(); ctx.arc(0, 0, r - 2.5, 0, TAU);
      ctx.fillStyle = g2; ctx.fill();

      ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, TAU);
      ctx.fillStyle = '#f3f7ff'; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, TAU);
      ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();

      ctx.beginPath(); ctx.arc(0, 0, r * 0.24 + p * 3, 0, TAU);
      ctx.fillStyle = p > 0.05 ? C.gold : C.magenta;
      ctx.fill();
      ctx.restore();
    });
  }

  _drawSlings(ctx) {
    ART.slings.forEach(([[ax, ay], [bx, by]], i) => {
      const p = this.slingPulse[i];
      const nx = -(by - ay), ny = (bx - ax);
      const len = Math.hypot(nx, ny) || 1;
      const push = (i === 0 ? 1 : -1) * p * 5;
      const ox = (nx / len) * push, oy = (ny / len) * push;
      // Body: a solid wedge behind the rubber, so it reads as a mechanism, not a line.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.lineTo(bx - (nx / len) * 26 * (i === 0 ? 1 : -1), by - (ny / len) * 26 * (i === 0 ? 1 : -1));
      ctx.closePath();
      // Lifted off the playfield colour and outlined, so a slingshot reads as the solid triangular
      // mechanism it is rather than as one more white line among the dividers next to it.
      ctx.fillStyle = p > 0.05 ? 'rgba(242,183,5,0.45)' : 'rgba(70,58,132,0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,178,230,0.5)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
      this._rubberRail(ctx, ax + ox, ay + oy, bx + ox, by + oy, 7, p > 0.05 ? C.gold : '#f4f6ff');
      if (p > 0.05) {
        ctx.save();
        ctx.globalAlpha = p * 0.6;
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ax + ox, ay + oy); ctx.lineTo(bx + ox, by + oy); ctx.stroke();
        ctx.restore();
      }
    });
  }

  _drawStands(ctx) {
    ART.stands.forEach(([[ax, ay], [bx, by]], i) => {
      const p = this.standPulse[i];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 14; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = p > 0.05 ? '#ffffff' : C.red;
      ctx.lineWidth = 10; ctx.stroke();
      ctx.restore();
    });
  }

  _drawDrops(ctx, game) {
    const { a, u, len, step } = ART.bank;
    // A backing plate behind the whole bank, so four gold slabs read as one mechanism rather than
    // as a dashed line (which is what they looked like next to the gold one-way gates).
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0] - u[0] * 4, a[1] - u[1] * 4);
    ctx.lineTo(a[0] + u[0] * ((DROP_COUNT - 1) * step + len + 4), a[1] + u[1] * ((DROP_COUNT - 1) * step + len + 4));
    ctx.strokeStyle = 'rgba(12,7,30,0.85)';
    ctx.lineWidth = 20;
    ctx.stroke();
    ctx.restore();
    for (let i = 0; i < DROP_COUNT; i++) {
      const down = game.drops[i];
      this.dropAnim[i] += ((down ? 1 : 0) - this.dropAnim[i]) * 0.28;
      const k = this.dropAnim[i];
      const s0 = i * step;
      const ax = a[0] + u[0] * s0, ay = a[1] + u[1] * s0;
      const bx = a[0] + u[0] * (s0 + len), by = a[1] + u[1] * (s0 + len);
      const mxp = (ax + bx) / 2, myp = (ay + by) / 2;
      const ang = Math.atan2(by - ay, bx - ax);
      ctx.save();
      ctx.translate(mxp, myp);
      ctx.rotate(ang);
      ctx.globalAlpha = 1 - k * 0.82;
      ctx.scale(1, 1 - k * 0.85);
      const h = 13.5;
      ctx.beginPath(); roundRect(ctx, -len / 2, -h / 2, len, h, 3);
      ctx.fillStyle = C.ink; ctx.fill();
      const gr = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      gr.addColorStop(0, down ? '#4a5570' : '#ffe89a');
      gr.addColorStop(0.5, down ? '#333d55' : C.gold);
      gr.addColorStop(1, down ? '#222a3d' : '#b07f02');
      ctx.beginPath(); roundRect(ctx, -len / 2 + 1.4, -h / 2 + 1.4, len - 2.8, h - 2.8, 2.4);
      ctx.fillStyle = gr; ctx.fill();
      ctx.restore();
    }
  }

  _drawSpinner(ctx, game) {
    const sw = SWITCHES.find((s) => s.id === 'spinner');
    ctx.save();
    ctx.translate(sw.x, sw.y);
    // Frame.
    ctx.strokeStyle = C.metalDark; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-15, -13); ctx.lineTo(-15, 13); ctx.moveTo(15, -13); ctx.lineTo(15, 13);
    ctx.stroke();
    // Blade, seen edge-on as it spins.
    const sq = Math.cos(this.spinAngle);
    ctx.save();
    ctx.scale(1, Math.max(0.06, Math.abs(sq)));
    ctx.beginPath(); roundRect(ctx, -14, -12, 28, 24, 2);
    ctx.fillStyle = sq > 0 ? '#e8f4ff' : '#93a6c4';
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (Math.abs(sq) > 0.55) ctx.fillText('SPIN', 0, 0);
    ctx.restore();
    ctx.restore();
  }

  _drawScoop(ctx, game, hud) {
    const { x, y, rad, mouth, half } = ART.scoop;
    const active = hud.bankLit || hud.lockLit || hud.superLit;
    const pulse = 0.5 + Math.sin(this.time * 7) * 0.5;
    ctx.save();
    ctx.translate(x, y);
    // The hole.
    const hg = ctx.createRadialGradient(0, 0, 1, 0, 0, rad);
    hg.addColorStop(0, '#000000');
    hg.addColorStop(0.7, '#0b0620');
    hg.addColorStop(1, active ? 'rgba(62,232,255,0.5)' : 'rgba(60,70,110,0.5)');
    ctx.beginPath(); ctx.arc(0, 0, rad - 1, 0, TAU);
    ctx.fillStyle = hg; ctx.fill();
    // Rim, with the mouth left open.
    ctx.beginPath();
    ctx.arc(0, 0, rad, mouth + half, mouth - half + TAU);
    ctx.lineWidth = 8; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, rad, mouth + half, mouth - half + TAU);
    ctx.lineWidth = 5;
    ctx.strokeStyle = active ? C.cyan : C.metalMid;
    if (active) { ctx.shadowColor = C.cyan; ctx.shadowBlur = 10 + pulse * 14; }
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (this.scoopPulse > 0.02) {
      ctx.globalAlpha = this.scoopPulse;
      ctx.beginPath(); ctx.arc(0, 0, rad + 6 + (1 - this.scoopPulse) * 20, 0, TAU);
      ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** The ramp habitrail. Drawn ABOVE the playfield with a shadow under it, because that is the one
   *  cue that says "the ball is on a wire over the table" in a top-down 2D view. */
  _drawRamp(ctx, game, hud) {
    const lit = hud.multiball || this.rampGlow > 0.02 || (hud.mission && hud.mission.id === 'ramp');
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const path = (c) => {
      c.beginPath();
      c.moveTo(RAMP_PATH[0][0], RAMP_PATH[0][1]);
      for (let i = 1; i < RAMP_PATH.length; i++) c.lineTo(RAMP_PATH[i][0], RAMP_PATH[i][1]);
    };

    // Drop shadow on the playfield below.
    ctx.save();
    ctx.translate(5, 8);
    path(ctx);
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 24; ctx.stroke();
    ctx.restore();

    // Translucent, because a real ramp is a sheet of clear plastic and an opaque one hides a third
    // of the playfield (which is precisely what the first browser run showed).
    path(ctx);
    ctx.strokeStyle = 'rgba(10,6,28,0.42)'; ctx.lineWidth = 24; ctx.stroke();
    path(ctx);
    ctx.strokeStyle = lit ? 'rgba(255,79,216,0.26)' : 'rgba(160,180,230,0.10)';
    ctx.lineWidth = 20; ctx.stroke();

    // Two side rails.
    for (const off of [-10, 10]) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < RAMP_PATH.length; i++) {
        const [px, py] = RAMP_PATH[i];
        const [qx, qy] = RAMP_PATH[Math.min(RAMP_PATH.length - 1, i + 1)];
        const [ox, oy] = RAMP_PATH[Math.max(0, i - 1)];
        const dx = qx - ox, dy = qy - oy;
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l * off, ny = dx / l * off;
        if (i === 0) ctx.moveTo(px + nx, py + ny); else ctx.lineTo(px + nx, py + ny);
      }
      ctx.strokeStyle = lit ? C.magenta : C.metalMid;
      ctx.lineWidth = 3.2;
      if (lit) { ctx.shadowColor = C.magenta; ctx.shadowBlur = 12; }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  _drawPlunger(ctx, game, hud) {
    const p = hud.power || 0;
    const x = PLUNGER.x, base = PLUNGER.y + 22;
    ctx.save();
    // Shaft.
    ctx.strokeStyle = C.metalDark; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, base + 6); ctx.lineTo(x, 740); ctx.stroke();
    // Spring, compressing as the plunger is pulled.
    const top = base + p * 16;
    ctx.strokeStyle = hud.onPlunger ? C.gold : C.metalMid;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const yy = top + i * (2.2 + (1 - p) * 1.4);
      const xx = x + (i % 2 ? 7 : -7);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    // Tip.
    ctx.beginPath(); roundRect(ctx, x - 11, top - 7, 22, 8, 3);
    ctx.fillStyle = hud.onPlunger ? C.gold : C.metalMid;
    ctx.fill();
    // Power meter up the side of the lane.
    if (hud.onPlunger) {
      const h = 150;
      ctx.beginPath(); roundRect(ctx, 372 - 4, base - 20 - h, 8, h, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
      ctx.beginPath(); roundRect(ctx, 372 - 4, base - 20 - h * p, 8, h * p, 4);
      ctx.fillStyle = p > 0.82 ? C.red : p > 0.45 ? C.gold : C.cyan;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  _drawFlippers(ctx, game) {
    for (const f of game.flippers) {
      const ex = f.px + Math.cos(f.angle) * f.len;
      const ey = f.py + Math.sin(f.angle) * f.len;
      ctx.save();
      ctx.lineCap = 'round';
      // Casing.
      ctx.beginPath(); ctx.moveTo(f.px, f.py); ctx.lineTo(ex, ey);
      ctx.strokeStyle = C.ink; ctx.lineWidth = f.r * 2 + 5; ctx.stroke();
      // Body, tapering toward the tip the way the collider does.
      //
      // THE GRADIENT RUNS ACROSS THE PADDLE'S OWN AXIS, NOT DOWN THE SCREEN. It used to be
      // createLinearGradient(px, py - r, px, py + r): a 16-unit vertical band pinned to the PIVOT.
      // A raised paddle's tip sits ~24 units ABOVE its pivot, so the whole swept paddle fell past
      // stop 0 and clamped to solid #ffffff - the flipper turned white the moment you pressed, and
      // white is exactly what the dividers and rails beside it are painted. The one instant you most
      // need to see where your flipper is was the instant it camouflaged itself against the static
      // furniture (2026-08-20 playtest: both flips visible in the clip were misses). Anchoring the
      // gradient on the paddle's own normal gives the same cross-section shading at every angle.
      const gnx = -Math.sin(f.angle), gny = Math.cos(f.angle);
      const gmx = (f.px + ex) / 2, gmy = (f.py + ey) / 2;
      const grad = ctx.createLinearGradient(gmx - gnx * f.r, gmy - gny * f.r, gmx + gnx * f.r, gmy + gny * f.r);
      // ...and the paddle reads as ENERGIZED while it is held. A flipper that looks identical firing
      // and at rest gives the player nothing to aim with. Colour is never the only cue here - the
      // paddle is also visibly rotated - so this satisfies root CLAUDE.md's shape-not-hue rule, and
      // gold against cyan is on the safe axis for red/green colourblindness.
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.45, f.pressed ? C.gold : C.cyan);
      grad.addColorStop(1, f.pressed ? '#8a5b00' : '#0f5f86');
      ctx.beginPath(); ctx.moveTo(f.px, f.py); ctx.lineTo(ex, ey);
      ctx.strokeStyle = grad; ctx.lineWidth = f.r * 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(f.px + Math.cos(f.angle) * f.len * 0.35, f.py + Math.sin(f.angle) * f.len * 0.35);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = f.r * 0.7; ctx.stroke();
      // Pivot cap.
      this._post(ctx, f.px, f.py, f.r * 0.62);
      ctx.restore();
    }
  }

  _drawBalls(ctx, game) {
    const seen = new Set();
    game.balls.forEach((b, idx) => {
      if (!b.live) return;
      const key = idx;
      seen.add(key);
      let trail = this.trails.get(key);
      if (!trail) { trail = []; this.trails.set(key, trail); }
      trail.push([b.x, b.y]);
      if (trail.length > 9) trail.shift();

      const onRamp = b.ramp != null;
      // A ball on the habitrail is physically above the playfield: bigger, with a real shadow.
      const r = b.r * (onRamp ? 1.18 : 1);

      if (!this.reduced && trail.length > 2) {
        ctx.save();
        for (let i = 0; i < trail.length - 1; i++) {
          const a = i / trail.length;
          ctx.globalAlpha = a * 0.32;
          ctx.beginPath();
          ctx.arc(trail[i][0], trail[i][1], r * (0.35 + a * 0.55), 0, TAU);
          ctx.fillStyle = C.cyan;
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.save();
      // Shadow.
      ctx.globalAlpha = onRamp ? 0.5 : 0.34;
      ctx.beginPath();
      ctx.ellipse(b.x + (onRamp ? 7 : 3), b.y + (onRamp ? 10 : 4), r * 0.95, r * 0.72, 0, 0, TAU);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalAlpha = 1;

      // Chrome sphere.
      const g2 = ctx.createRadialGradient(b.x - r * 0.4, b.y - r * 0.45, r * 0.1, b.x, b.y, r);
      g2.addColorStop(0, '#ffffff');
      g2.addColorStop(0.35, '#dfe7f5');
      g2.addColorStop(0.72, '#8492ad');
      g2.addColorStop(1, '#2a3145');
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.fillStyle = g2; ctx.fill();
      // Rim light picked up from the table's neon.
      ctx.beginPath(); ctx.arc(b.x, b.y, r - 0.9, Math.PI * 0.15, Math.PI * 0.95);
      ctx.strokeStyle = 'rgba(62,232,255,0.7)'; ctx.lineWidth = 1.6; ctx.stroke();
      // Specular.
      ctx.beginPath(); ctx.arc(b.x - r * 0.34, b.y - r * 0.38, r * 0.22, 0, TAU);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.restore();
    });
    for (const k of [...this.trails.keys()]) if (!seen.has(k)) this.trails.delete(k);
  }

  _drawParticles(ctx) {
    ctx.save();
    for (const p of this.parts) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * k, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPopups(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.pops) {
      const k = p.age / p.life;
      const rise = 34 * Math.pow(k, 0.6);
      const grow = p.big ? 1 + (1 - Math.pow(1 - Math.min(1, k * 4), 2)) * 0.28 : 1;
      ctx.globalAlpha = clamp(1 - Math.pow(k, 2.4), 0, 1);
      ctx.font = `800 ${(p.big ? 21 : 15) * grow}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(p.text, p.x, p.y - rise);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - rise);
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export { C as PALETTE };
export default { Renderer };
