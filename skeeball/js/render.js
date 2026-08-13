// skeeball/js/render.js - the canvas. One perspective camera, one machine, one ball.
//
// The scene is drawn from where the player actually stands: eye above the near end of the lane,
// looking down the alley at the tilted scoring face. Everything is projected through one pinhole
// helper (P()), so the lane's converging planks, the ellipses the rings become, the ball
// shrinking as it climbs and the arc of a lob are all the SAME geometry the physics computed -
// the renderer never invents a position.
//
// Split, same as Pinball: the machine that never changes (room, cabinet, lane, face, rings,
// marquee, cage) is painted once into an offscreen canvas per size (paintStatic) and blitted
// every frame; the ball, lamp flashes, score popups and particles are drawn live on top.
// If you add painted art that changes during play, it does NOT belong in paintStatic.
//
// No DOM beyond the canvas it is handed, no storage, no timers. ui.js owns the clock.

import { R, SERVE_Y } from './physics.js';

const TAU = Math.PI * 2;
const DPR_CAP = 2;

export class Renderer {
  constructor(canvas, board) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.board = board;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.staticCanvas = null;

    this.flashes = new Map();      // hole id -> seconds remaining
    this.popups = [];              // { x, y, z, text, color, t, big }
    this.sparks = [];              // { x, y, z, vx, vy, vz, t, color }
    this.glow = 0;                 // marquee celebration
    this.rollDist = 0;             // for the ball's rolling stripe
    this.lastBallPos = null;

    this.reducedMotion = false;
    try {
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { /* headless */ }

    // Camera: eye above the player's end, looking down the alley. F set in resize().
    this.eyeY = -0.92;
    this.eyeZ = 1.06;
    this.F = 0;
    this.cy = 0;
    this.cx = 0;
  }

  resize(w, h) {
    const dpr = Math.min(DPR_CAP, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Focal length: the lane's near end should nearly fill the width; the horizon sits high so
    // the face gets the top of the frame and the lane sweeps the rest.
    this.F = w * 1.62;
    this.cx = w / 2;
    this.cy = h * 0.245;
    this.paintStatic();
  }

  /** World (x lateral, y depth, z up) -> screen. s is the scale factor at that depth. */
  P(x, y, z) {
    const dy = Math.max(0.18, y - this.eyeY);
    const s = this.F / dy;
    return { sx: this.cx + x * s, sy: this.cy + (this.eyeZ - z) * s, s };
  }

  /** A face-plane point (u lateral, v up the slope) in world coordinates. */
  face(u, v) {
    const Ph = this.board.physics;
    return { x: u, y: Ph.faceY0 + v * Math.cos(Ph.faceTilt), z: v * Math.sin(Ph.faceTilt) };
  }

  facePt(u, v) { const f = this.face(u, v); return this.P(f.x, f.y, f.z); }

  // --- the machine (static, cached) -----------------------------------------------------------

  paintStatic() {
    const { w, h, dpr } = this;
    if (!w || !h) return;
    const off = this.staticCanvas || (this.staticCanvas = document.createElement('canvas'));
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    const ctx = off.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = this.board.look;
    const Ph = this.board.physics;

    // The room: a dim arcade wall behind everything, warmer near the machine's lights.
    const room = ctx.createLinearGradient(0, 0, 0, h);
    room.addColorStop(0, shade(L.wall, 1.35));
    room.addColorStop(0.5, L.wall);
    room.addColorStop(1, shade(L.wall, 0.55));
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, w, h);

    const laneHalf = Ph.laneW / 2;
    const bodyHalf = Ph.faceW / 2 + 0.08;      // the cabinet is a little wider than the face
    const yFront = 0.30;                        // nearest visible slice of the machine
    const yBack = Ph.cageY;

    // Cabinet side walls: tall quads from the lane bed up past the face.
    const wallTop = 1.55;
    for (const side of [-1, 1]) {
      const a = this.P(side * bodyHalf, yFront, 0);
      const b = this.P(side * bodyHalf, yBack, 0);
      const c = this.P(side * bodyHalf, yBack, wallTop);
      const d = this.P(side * bodyHalf, yFront, wallTop);
      const g = ctx.createLinearGradient(a.sx, 0, b.sx, 0);
      g.addColorStop(0, shade(L.cabinet, side < 0 ? 0.92 : 0.78));
      g.addColorStop(1, shade(L.cabinet, 0.5));
      ctx.fillStyle = g;
      quad(ctx, a, b, c, d);
      ctx.strokeStyle = L.cabinetEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // The pit: the dark well between the hump and the face.
    {
      const a = this.P(-bodyHalf, Ph.laneLen + Ph.rampLen, 0.0);
      const b = this.P(bodyHalf, Ph.laneLen + Ph.rampLen, 0.0);
      const c = this.P(bodyHalf, Ph.faceY0 + 0.05, Ph.pitZ);
      const d = this.P(-bodyHalf, Ph.faceY0 + 0.05, Ph.pitZ);
      ctx.fillStyle = shade(L.cabinet, 0.28);
      quad(ctx, a, b, c, d);
    }

    this.paintFace(ctx);
    this.paintCage(ctx);       // behind the marquee, so the wires never cross its lettering
    this.paintMarquee(ctx);

    // Lane apron: the cabinet flanks outside the rails, so the lane reads as a channel.
    for (const side of [-1, 1]) {
      const a = this.P(side * laneHalf, yFront, 0);
      const b = this.P(side * laneHalf, Ph.laneLen + Ph.rampLen, 0);
      const c = this.P(side * bodyHalf, Ph.laneLen + Ph.rampLen, 0);
      const d = this.P(side * bodyHalf, yFront, 0);
      ctx.fillStyle = shade(L.cabinet, side < 0 ? 0.72 : 0.6);
      quad(ctx, a, b, c, d);
    }

    this.paintLane(ctx);

    // Soft vignette so the cabinet glows out of the dark.
    const vg = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.25, w / 2, h * 0.5, h * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  paintLane(ctx) {
    const L = this.board.look;
    const Ph = this.board.physics;
    const half = Ph.laneW / 2;
    const yFront = 0.30;

    // The bed: varnished wood, lit from the marquee end.
    const near = this.P(0, yFront, 0), far = this.P(0, Ph.laneLen, 0);
    const g = ctx.createLinearGradient(0, near.sy, 0, far.sy);
    g.addColorStop(0, shade(L.wood, 0.88));
    g.addColorStop(0.75, L.wood);
    g.addColorStop(1, shade(L.wood, 1.12));
    ctx.fillStyle = g;
    quad(ctx, this.P(-half, yFront, 0), this.P(half, yFront, 0),
      this.P(half, Ph.laneLen, 0), this.P(-half, Ph.laneLen, 0));

    // Plank seams, converging with the perspective.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const x = -half + (Ph.laneW * i) / 5;
      const a = this.P(x, yFront, 0), b = this.P(x, Ph.laneLen, 0);
      line(ctx, a, b);
    }
    // A little worn sheen down the centre where every ball has ever rolled.
    const sheen = ctx.createLinearGradient(0, near.sy, 0, far.sy);
    sheen.addColorStop(0, 'rgba(255,240,205,0.10)');
    sheen.addColorStop(1, 'rgba(255,240,205,0.03)');
    ctx.fillStyle = sheen;
    quad(ctx, this.P(-half * 0.4, yFront, 0), this.P(half * 0.4, yFront, 0),
      this.P(half * 0.4, Ph.laneLen, 0), this.P(-half * 0.4, Ph.laneLen, 0));

    // The hump: a lighter band rising to the lip, with a bright top edge.
    const steps = 7;
    for (let i = 0; i < steps; i++) {
      const u0 = i / steps, u1 = (i + 1) / steps;
      const y0 = Ph.laneLen + Ph.rampLen * u0, y1 = Ph.laneLen + Ph.rampLen * u1;
      const z0 = Ph.lipHeight * u0 * u0, z1 = Ph.lipHeight * u1 * u1;
      ctx.fillStyle = shade(L.wood, 1.05 + 0.4 * u1);
      quad(ctx, this.P(-half, y0, z0), this.P(half, y0, z0), this.P(half, y1, z1), this.P(-half, y1, z1));
    }
    const lipA = this.P(-half, Ph.laneLen + Ph.rampLen, Ph.lipHeight);
    const lipB = this.P(half, Ph.laneLen + Ph.rampLen, Ph.lipHeight);
    ctx.strokeStyle = 'rgba(255,236,190,0.75)';
    ctx.lineWidth = 2;
    line(ctx, lipA, lipB);

    // Side rails: low varnished walls with a highlight along the top.
    const railH = 0.07;
    for (const side of [-1, 1]) {
      const a = this.P(side * half, yFront, 0);
      const b = this.P(side * half, Ph.laneLen + Ph.rampLen, Ph.lipHeight * 0.2);
      const c = this.P(side * half, Ph.laneLen + Ph.rampLen, Ph.lipHeight * 0.2 + railH);
      const d = this.P(side * half, yFront, railH);
      ctx.fillStyle = shade(L.woodDark, side < 0 ? 1.0 : 0.82);
      quad(ctx, a, b, c, d);
      ctx.strokeStyle = 'rgba(255,236,190,0.35)';
      ctx.lineWidth = 1.2;
      line(ctx, d, c);
    }
  }

  paintFace(ctx) {
    const L = this.board.look;
    const Ph = this.board.physics;
    const S = this.board.scoring;
    const halfW = Ph.faceW / 2;

    // The tilted board itself.
    const c0 = this.facePt(-halfW, 0), c1 = this.facePt(halfW, 0);
    const c2 = this.facePt(halfW, Ph.faceLen), c3 = this.facePt(-halfW, Ph.faceLen);
    const g = ctx.createLinearGradient(0, c2.sy, 0, c0.sy);
    g.addColorStop(0, L.face);
    g.addColorStop(1, shade(L.face, 0.8));
    ctx.fillStyle = g;
    quad(ctx, c0, c1, c2, c3);
    ctx.strokeStyle = shade(L.cabinetEdge, 1.3);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Concentric ring bands, outermost first: painted band, pale lip, value stencil.
    const rings = [...S.rings].reverse();     // big to small
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      ctx.fillStyle = i % 2 === 0 ? shade(L.ring, 1) : shade(L.face, 0.93);
      this.faceCircle(ctx, 0, S.ringCenterV, ring.r);
      ctx.fill();
      ctx.strokeStyle = L.ringLip;
      ctx.lineWidth = 2.4;
      this.faceCircle(ctx, 0, S.ringCenterV, ring.r);
      ctx.stroke();
    }
    // The 50's mouth: an open hole at the centre - small, so the stencil under it stays legible
    // through the perspective foreshortening.
    const mouth = S.rings[0].r * 0.45;
    ctx.fillStyle = L.pocket;
    this.faceCircle(ctx, 0, S.ringCenterV, mouth);
    ctx.fill();

    // Values, stencilled low in each band where a player standing at the lane reads them. The 50
    // gets a pale outline so it reads even where the hole's dark edge crowds it.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < S.rings.length; i++) {
      const ring = S.rings[i];
      const vLabel = i === 0
        ? S.ringCenterV - (mouth + ring.r) / 2
        : S.ringCenterV - (ring.r + S.rings[i - 1].r) / 2;
      const p = this.facePt(0, vLabel);
      const px = Math.max(9, p.s * 0.052);
      ctx.font = `700 ${px}px system-ui, sans-serif`;
      const onRed = i % 2 === 0;
      if (i === 0) {
        ctx.lineWidth = Math.max(2, px * 0.22);
        ctx.strokeStyle = shade(L.ring, 0.55);
        ctx.strokeText(String(ring.value), p.sx, p.sy);
      }
      ctx.fillStyle = onRed ? L.ringLip : shade(L.ring, 0.9);
      ctx.fillText(String(ring.value), p.sx, p.sy);
    }

    // The twin 100 pockets: dark mouths with a painted rim and their promise stencilled above.
    for (const pk of S.pockets) {
      ctx.fillStyle = shade(L.ring, 0.75);
      this.faceCircle(ctx, pk.u, pk.v, pk.r * 1.32);
      ctx.fill();
      ctx.fillStyle = L.pocket;
      this.faceCircle(ctx, pk.u, pk.v, pk.r * 0.92);
      ctx.fill();
      ctx.strokeStyle = L.ringLip;
      ctx.lineWidth = 2;
      this.faceCircle(ctx, pk.u, pk.v, pk.r * 1.32);
      ctx.stroke();
      const p = this.facePt(pk.u, pk.v + pk.r * 2.1);
      const px = Math.max(8, p.s * 0.045);
      ctx.font = `800 ${px}px system-ui, sans-serif`;
      ctx.fillStyle = shade(L.ring, 0.9);
      ctx.fillText('100', p.sx, p.sy);
    }
  }

  paintMarquee(ctx) {
    const L = this.board.look;
    const Ph = this.board.physics;
    // A lit header board above the face's top edge.
    const topV = Ph.faceLen;
    const a = this.facePt(-Ph.faceW / 2 - 0.05, topV + 0.02);
    const b = this.facePt(Ph.faceW / 2 + 0.05, topV + 0.02);
    const hPx = Math.max(30, a.s * 0.24);
    const x0 = a.sx, x1 = b.sx;
    const y1 = Math.min(a.sy, b.sy);
    const y0 = y1 - hPx;
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, shade(L.marquee, 1.5));
    g.addColorStop(1, L.marquee);
    ctx.fillStyle = g;
    roundRect(ctx, x0, y0, x1 - x0, hPx, 6);
    ctx.fill();
    ctx.strokeStyle = shade(L.marqueeText, 0.55);
    ctx.lineWidth = 2;
    roundRect(ctx, x0, y0, x1 - x0, hPx, 6);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.max(13, hPx * 0.42)}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = L.marqueeText;
    ctx.save();
    ctx.shadowColor = L.glow;
    ctx.shadowBlur = 8;
    ctx.fillText(this.board.name, (x0 + x1) / 2, y0 + hPx * 0.52, (x1 - x0) * 0.86);
    ctx.restore();

    // Bulb rows along the top and bottom edges.
    const bulbs = 11;
    for (let i = 0; i < bulbs; i++) {
      const bx = x0 + ((i + 0.5) / bulbs) * (x1 - x0);
      for (const by of [y0 + 4, y1 - 4]) {
        ctx.fillStyle = i % 2 ? L.bulb : shade(L.bulb, 0.6);
        ctx.beginPath();
        ctx.arc(bx, by, 2.2, 0, TAU);
        ctx.fill();
      }
    }
    this.marqueeBox = { x0, y0, x1, y1 };
  }

  paintCage(ctx) {
    const L = this.board.look;
    const Ph = this.board.physics;
    // The safety net: hooped wires over the pit and face, drawn faint so it reads as mesh.
    ctx.strokeStyle = withAlpha(L.net, 0.28);
    ctx.lineWidth = 1;
    const y0 = Ph.laneLen + Ph.rampLen - 0.05;
    for (let i = 0; i <= 6; i++) {
      const x = -Ph.faceW / 2 + (Ph.faceW * i) / 6;
      const a = this.P(x, y0, 1.06);
      const b = this.P(x * 0.9, Ph.cageY - 0.2, 1.5);
      line(ctx, a, b);
    }
    for (const yc of [y0 + 0.28, y0 + 0.68]) {
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const x = -Ph.faceW / 2 + (Ph.faceW * i) / 12;
        const p = this.P(x, yc, 1.1 + 0.3 * ((yc - y0) / 1.0));
        if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();
    }
  }

  /** Path of a circle drawn ON the face plane (it projects to an ellipse-ish shape). */
  faceCircle(ctx, cu, cv, r) {
    ctx.beginPath();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const p = this.facePt(cu + r * Math.cos(th), cv + r * Math.sin(th));
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    }
    ctx.closePath();
  }

  // --- events from the ui ----------------------------------------------------------------------

  flashHole(hole, seconds = 1.1) { this.flashes.set(hole, seconds); }

  popupAt(wx, wy, wz, text, color, big = false) {
    this.popups.push({ x: wx, y: wy, z: wz, text, color, t: 0, big });
  }

  burstAt(wx, wy, wz, color, n = 14) {
    if (this.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU;
      this.sparks.push({
        x: wx, y: wy, z: wz,
        vx: Math.cos(th) * 0.7, vy: (((i % 3) - 1) * 0.3), vz: Math.abs(Math.sin(th)) * 1.6 + 0.6,
        t: 0, color,
      });
    }
  }

  celebrate() { this.glow = 1.2; }

  // --- the frame -------------------------------------------------------------------------------

  render(game, dt) {
    const { ctx, w, h, dpr } = this;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.staticCanvas) ctx.drawImage(this.staticCanvas, 0, 0, w, h);

    this.drawFlashes(dt);
    this.drawBall(game, dt);
    this.drawSparks(dt);
    this.drawPopups(dt);
    this.drawGlow(dt);
  }

  drawFlashes(dt) {
    const { ctx } = this;
    const S = this.board.scoring;
    for (const [hole, left] of [...this.flashes]) {
      const next = left - dt;
      if (next <= 0) { this.flashes.delete(hole); continue; }
      this.flashes.set(hole, next);
      const k = Math.min(1, next / 0.9);
      ctx.save();
      ctx.globalAlpha = 0.55 * k;
      ctx.lineWidth = 4;
      ctx.strokeStyle = this.board.look.glow;
      if (hole === 'gutter') {
        // The whole face sighs, dimly.
        ctx.globalAlpha = 0.15 * k;
        this.faceCircle(ctx, 0, S.ringCenterV, S.rings[S.rings.length - 1].r);
        ctx.stroke();
      } else if (hole === '100L' || hole === '100R') {
        const pk = S.pockets.find((p) => p.id === hole);
        if (pk) { this.faceCircle(ctx, pk.u, pk.v, pk.r * 1.5); ctx.stroke(); }
      } else {
        const ring = S.rings.find((r) => `r${r.value}` === hole);
        if (ring) { this.faceCircle(ctx, 0, S.ringCenterV, ring.r); ctx.stroke(); }
      }
      ctx.restore();
    }
  }

  drawBall(game, dt) {
    const st = game && game.ball;
    const { ctx } = this;
    // A waiting ball sits on the lane at the serve spot.
    const bx = st ? st.x : 0, by = st ? st.y : SERVE_Y, bz = st ? st.z : R;
    if (!st && game && game.over) return;

    // Rolling stripe: advance by distance travelled so the ball visibly rolls.
    if (this.lastBallPos) {
      const d = Math.hypot(bx - this.lastBallPos.x, by - this.lastBallPos.y, bz - this.lastBallPos.z);
      this.rollDist += d;
    }
    this.lastBallPos = { x: bx, y: by, z: bz };

    const p = this.P(bx, by, bz);
    const rp = Math.max(3, R * p.s * 1.12);

    // Shadow: on the lane while rolling, on the face plane once it is settling there.
    const inSink = st && st.phase === 'sink' && st.sink && st.sink.kind !== 'drop';
    if (!inSink) {
      const sh = this.P(bx, by, Math.min(bz - R, 0) * 0 + 0.001);
      if (st && (st.phase === 'flight')) {
        const k = Math.max(0.25, 1 - (bz / 1.2));
        ctx.save();
        ctx.globalAlpha = 0.28 * k;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(p.sx, sh.sy, rp * (0.8 + bz * 0.3), rp * 0.32, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy + rp * 0.78, rp * 0.92, rp * 0.34, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    // The ball: warm off-white composite with a window highlight and a rolling seam.
    const g = ctx.createRadialGradient(p.sx - rp * 0.35, p.sy - rp * 0.42, rp * 0.15, p.sx, p.sy, rp);
    g.addColorStop(0, '#fff8ea');
    g.addColorStop(0.55, '#e8d9bc');
    g.addColorStop(1, '#a8916b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, rp, 0, TAU);
    ctx.fill();

    const ang = this.rollDist / R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, rp, 0, TAU);
    ctx.clip();
    ctx.strokeStyle = 'rgba(120,95,60,0.4)';
    ctx.lineWidth = Math.max(1, rp * 0.14);
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, rp * 0.95, rp * Math.abs(Math.sin(ang)) * 0.9 + rp * 0.05, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // A faint flight trail (skipped under reduced motion).
    if (st && st.phase === 'flight' && !this.reducedMotion) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = '#fff3d8';
      ctx.lineWidth = Math.max(1.5, rp * 0.3);
      ctx.beginPath();
      const back = this.P(bx - st.vx * 0.045, by - st.vy * 0.045, bz - st.vz * 0.045);
      ctx.moveTo(back.sx, back.sy);
      ctx.lineTo(p.sx, p.sy);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawSparks(dt) {
    const { ctx } = this;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t > 0.8) { this.sparks.splice(i, 1); continue; }
      s.vz -= 5.5 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const p = this.P(s.x, s.y, s.z);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - s.t / 0.8);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, Math.max(1.2, p.s * 0.01), 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawPopups(dt) {
    const { ctx } = this;
    const dur = 1.15;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pu = this.popups[i];
      pu.t += dt;
      if (pu.t > dur) { this.popups.splice(i, 1); continue; }
      const k = pu.t / dur;
      const p = this.P(pu.x, pu.y, pu.z + (this.reducedMotion ? 0.12 : k * 0.34));
      const px = Math.max(13, p.s * (pu.big ? 0.085 : 0.06));
      ctx.save();
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.font = `800 ${px}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, px * 0.16);
      ctx.strokeStyle = 'rgba(20,10,5,0.85)';
      ctx.strokeText(pu.text, p.sx, p.sy);
      ctx.fillStyle = pu.color;
      ctx.fillText(pu.text, p.sx, p.sy);
      ctx.restore();
    }
  }

  drawGlow(dt) {
    if (this.glow <= 0 || !this.marqueeBox) return;
    this.glow = Math.max(0, this.glow - dt);
    const { ctx } = this;
    const m = this.marqueeBox;
    ctx.save();
    ctx.globalAlpha = 0.4 * Math.min(1, this.glow);
    ctx.fillStyle = this.board.look.glow;
    roundRect(ctx, m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0, 6);
    ctx.fill();
    ctx.restore();
  }
}

// --- small helpers ------------------------------------------------------------------------------

function quad(ctx, a, b, c, d) {
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.lineTo(c.sx, c.sy);
  ctx.lineTo(d.sx, d.sy);
  ctx.closePath();
  ctx.fill();
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lighten (k > 1) or darken (k < 1) a #rrggbb colour. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export default { Renderer };
