// pinball/js/render-royal.js - the canvas for the ROYAL FLUSH board.
//
// A SEPARATE RENDERER because render.js paints STARHUB's specific art - its arch, its named lamps,
// its three pop bumpers indexed 0-2, its habitrail. None of that geometry exists here.
//
// THIS FILE HAS BEEN WRONG TWICE, AND BOTH TIMES THE MISTAKE WAS MINE, NOT THE TABLE'S.
//   1. The first version stroked every collider as a flat hairline in colours I picked - cyan
//      walls, purple targets - on a flat background. Matt: "what? it looks terrible."
//   2. The second version went the other way and painted an invented felt-green playfield with a
//      warm glow and a vignette. That was a creative liberty, which is exactly what was not wanted.
//
// Matt, settling it: "the fix is to implement the board exactly as is. Don't simplify or change
// anything. Make it work with our gamehub setup but do not take any creative liberties."
//
// So: BLACK BACKGROUND, AND EVERY COLOUR COMES FROM THE TABLE. Vector Pinball is a vector game -
// bright lines on black - and 53 of its 122 elements carry an explicit `color`. Where one does not,
// table-royal.js has already filled in Vector Pinball's OWN default from their source (see the
// generator header). Nothing in this file chooses a colour.
//
// THE ONE THING THAT IS DRAWN RATHER THAN COPIED IS DEPTH, and the table asks for it: 37 elements
// carry an `inactiveLayerColor`, which is what a ramp is drawn in while the ball is NOT on it. That
// is their mechanism for showing three ramps stacked over one playfield without the picture turning
// to noise, so it is honoured here exactly - active layer in `color`, every other layer in
// `inactiveLayerColor`.
//
// The static half is cached into an offscreen canvas per (size, active layer): 1,315 segments is far
// too much to stroke twice a frame on a phone. If you add art that changes during play, it does NOT
// belong in _paintLayers().
import T from './table-royal.js';
import { BALL_R } from './physics.js';

const BG = '#000000';

export class RoyalRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.time = 0;
    this.static = null;
    this.staticKey = '';
    // NAMED `flashes`, NOT `flash`. It was `this.flash` and that instance property SHADOWED the
    // flash() method ui.js calls, so every jackpot/bank event threw "R.flash is not a function".
    // Found by playing it; no headless test constructs a renderer at all.
    this.flashes = new Map();        // collider id -> remaining glow, seconds
    this.reduced = false;
    try {
      this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch { /* no matchMedia: assume full motion */ }
  }

  resize(w, h) {
    const dpr = Math.min(3, (window.devicePixelRatio || 1));
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    // Fit the WHOLE field. A cropped shooter lane is the exact bug pinball/CLAUDE.md records
    // STARHUB shipping, and no headless test can see it.
    this.scale = Math.min(w / (T.W + 12), h / (T.H + 12));
    this.ox = (w - T.W * this.scale) / 2;
    this.oy = (h - T.H * this.scale) / 2;
    this.static = null;
  }

  pulse(id) { if (id) this.flashes.set(id, 0.22); }

  /**
   * THE EFFECT SURFACE ui.js CALLS, and the reason this block exists at all.
   *
   * `_drainEvents()` reaches straight into the renderer for every game event - `R.hitBumper(i)`,
   * `R.spawnHit(...)`, `R.kick(...)`, `R.hitRamp()`, `R.hitLane(id)`, `R.popup(...)` and more. That
   * is STARHUB's Renderer API, and this class did not have it, so ON THIS BOARD EVERY SCORING EVENT
   * THREW: "R.hitRamp is not a function", "R.spawnHit is not a function", one uncaught error per
   * contact, forever.
   *
   * FOUR HEADLESS SOAKS COULD NOT SEE ANY OF IT, because they drive the game class directly and
   * never construct a renderer or a DOM. It took thirty seconds of actually playing the thing in a
   * real browser. Matt: "you need to play it." That is the lesson, and it is why
   * `pinball/js/test.js` is not sufficient on its own for this game.
   *
   * The effects are real where this board has something to show (a bumper flash, a ramp glow) and
   * honest no-ops where it does not: Royal Flush has no scoop, no slingshots and no stand-up
   * targets, so those three exist purely so ui.js's switch cannot throw.
   */
  spawnHit() { /* no particle layer on this board */ }
  popup() { /* the DMD already carries the message */ }
  hitBumper(i) { this.pulse('bump:' + i); }
  hitSling() { /* Royal Flush has no slingshots */ }
  hitStand() { /* ...nor stand-up targets */ }
  hitScoop() { /* ...nor a scoop */ }
  hitLane(id) { this.pulse(id); }
  hitSpinner() { this.pulse('spinner'); }
  hitRamp() { this.pulse('ramp'); }
  flash() { /* no full-screen flasher on this board */ }
  kick() { /* no shake: this table is drawn as thin lines and shake reads as a rendering fault */ }
  map() { /* STARHUB's mini-map has no equivalent here */ }

  /** Which layer the ball is on. Everything else is drawn in its inactive colour, which is what the
   *  table's own `inactiveLayerColor` values exist for. */
  static _activeLayer(game) {
    const b = (game.balls || []).find((x) => !x.onPlunger) || (game.balls || [])[0];
    return b ? (b.layer | 0) : 0;
  }

  _paintLayers(active) {
    const key = this.canvas.width + 'x' + this.canvas.height + ':' + active;
    if (this.static && this.staticKey === key) return;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(T.W * this.scale * this.dpr));
    cv.height = Math.max(1, Math.round(T.H * this.scale * this.dpr));
    const g = cv.getContext('2d');
    g.scale(this.scale * this.dpr, this.scale * this.dpr);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Inactive layers first, so the level the ball is actually on is drawn over them.
    for (const pass of [0, 1]) {
      for (const [ax, ay, bx, by, , kick, layer, color, inactive, ghost, disabled] of T.WALLS) {
        if (disabled) continue;
        const isActive = layer === active;
        if ((pass === 0) === isActive) continue;
        // A ghost (`ignoreBall`) is decoration in their table and is still DRAWN - it is part of the
        // picture even though the ball passes through it.
        const stroke = isActive ? color : (inactive || color);
        g.strokeStyle = stroke;
        g.globalAlpha = isActive ? 1 : (inactive ? 1 : 0.28);
        g.lineWidth = kick ? 4.5 : (ghost ? 2 : 3);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }
    g.globalAlpha = 1;

    // Rollovers: their radius, their colour, drawn as the ring their renderer draws.
    for (const grp of T.ROLLOVERS) {
      g.strokeStyle = grp.color;
      g.globalAlpha = (grp.layer | 0) === active ? 1 : 0.3;
      g.lineWidth = 2;
      for (const [x, y] of grp.pts) {
        g.beginPath();
        g.arc(x, y, grp.r, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;

    this.static = cv;
    this.staticKey = key;
  }

  render(game, dt) {
    const ctx = this.ctx;
    this.time += dt;
    for (const [k, v] of this.flashes) {
      const n = v - dt;
      if (n <= 0) this.flashes.delete(k); else this.flashes.set(k, n);
    }

    const active = RoyalRenderer._activeLayer(game);
    this._paintLayers(active);

    ctx.save();
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // The cache is painted WITH the fit transform baked in, so it is blitted in DEVICE pixels -
    // drawing it under the transform again would shift and clip the whole table, the fifth
    // wedge-family bug in pinball/CLAUDE.md.
    ctx.drawImage(this.static, Math.round(this.ox * this.dpr), Math.round(this.oy * this.dpr));

    ctx.translate(this.ox * this.dpr, this.oy * this.dpr);
    ctx.scale(this.scale * this.dpr, this.scale * this.dpr);
    ctx.lineCap = 'round';

    // --- drop targets: their colour, gone when knocked down ------------------------------------------
    for (const d of T.DROPS) {
      const on = (d.layer | 0) === active;
      ctx.strokeStyle = d.color;
      ctx.globalAlpha = on ? 1 : 0.3;
      ctx.lineWidth = 5;
      for (let i = 0; i < d.targets.length; i++) {
        if (game.down && game.down.has(d.id + ':' + i)) continue;
        const [ax, ay, bx, by] = d.targets[i];
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // --- bumpers: their inner disc and their translucent outer ring ---------------------------------
    for (let i = 0; i < T.BUMPERS.length; i++) {
      const [x, y, r, outer, , , layer, color, outerColor] = T.BUMPERS[i];
      const hot = this.flashes.get('bump:' + i) || 0;
      ctx.globalAlpha = (layer | 0) === active ? 1 : 0.3;
      ctx.fillStyle = outerColor;
      ctx.beginPath();
      ctx.arc(x, y, outer + hot * 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- spinner ------------------------------------------------------------------------------------
    for (const [x, y, r, , layer, color] of T.SPINNERS) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = (layer | 0) === active ? 1 : 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- flippers: their colour, their length, their swing -------------------------------------------
    for (let i = 0; i < game.flippers.length; i++) {
      const f = game.flippers[i];
      const row = T.FLIPPERS[i] || [];
      ctx.strokeStyle = row[7] || 'rgb(0,255,0)';
      ctx.lineWidth = f.r * 2;
      ctx.beginPath();
      ctx.moveTo(f.px, f.py);
      ctx.lineTo(f.px + Math.cos(f.angle) * f.len, f.py + Math.sin(f.angle) * f.len);
      ctx.stroke();
    }

    // --- the ball, in the colour the table names ------------------------------------------------------
    for (const b of game.balls) {
      ctx.fillStyle = T.BALL_COLOR;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

export default { RoyalRenderer };
