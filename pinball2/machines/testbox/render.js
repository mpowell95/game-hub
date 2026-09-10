// Canvas 2D. Clean vector, top down.
//
// It draws the SAME shapes the solver hits, and for the flipper it calls the solver's own
// decomposition, so what you see and what the ball touches cannot drift apart. That is the whole
// reason a rail here is an arc rather than a chain of short straights: a curve drawn as a polyline
// looks hand drawn AND collides like a saw blade, and those are one bug, not two.

import { _geom } from './physics.js';

export function fitView(table, cw, ch, pad) {
  const p = pad == null ? 8 : pad;
  const s = Math.min((cw - p * 2) / table.w, (ch - p * 2) / table.h);
  return { s, ox: (cw - table.w * s) / 2, oy: (ch - table.h * s) / 2, zoom: 1, px: 0, py: 0 };
}

export function toScreen(v, p) {
  return { x: v.ox + (p.x * v.s + v.px) * v.zoom, y: v.oy + (p.y * v.s + v.py) * v.zoom };
}

export function toTable(v, p) {
  return { x: ((p.x - v.ox) / v.zoom - v.px) / v.s, y: ((p.y - v.oy) / v.zoom - v.py) / v.s };
}

const S = (v) => v.s * v.zoom;

function railPath(ctx, sh, v) {
  ctx.beginPath();
  if (sh.kind === 'seg') {
    const a = toScreen(v, sh.a);
    const b = toScreen(v, sh.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (sh.kind === 'arc') {
    const c = toScreen(v, sh.c);
    let span = (sh.a1 - sh.a0) % (Math.PI * 2);
    if (span <= 0) span += Math.PI * 2;
    ctx.arc(c.x, c.y, sh.radius * S(v), sh.a0, sh.a0 + span);
  } else if (sh.kind === 'circle') {
    const c = toScreen(v, sh.c);
    ctx.arc(c.x, c.y, sh.r * S(v), 0, Math.PI * 2);
  }
}

function flipperPath(ctx, def, ang, v, ballR) {
  const tip = { x: def.pivot.x + def.len * Math.cos(ang), y: def.pivot.y + def.len * Math.sin(ang) };
  const { flanks, circles } = _geom.taperedParts(def.pivot, def.r0, tip, def.r1);
  ctx.beginPath();
  if (!flanks.length) {
    const c = toScreen(v, circles[0].c);
    ctx.arc(c.x, c.y, circles[0].R * S(v), 0, Math.PI * 2);
    return;
  }
  const p0 = toScreen(v, flanks[0].A);
  const p1 = toScreen(v, flanks[0].B);
  const q0 = toScreen(v, flanks[1].A);
  const q1 = toScreen(v, flanks[1].B);
  const cp = toScreen(v, def.pivot);
  const ct = toScreen(v, tip);
  const angTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.arc(ct.x, ct.y, def.r1 * S(v), angTo(ct, p1), angTo(ct, q1));
  ctx.lineTo(q0.x, q0.y);
  ctx.arc(cp.x, cp.y, def.r0 * S(v), angTo(cp, q0), angTo(cp, p0));
  ctx.closePath();
}

export function draw(ctx, table, v, state) {
  const st = state || {};
  const cw = ctx.canvas.width / (window.devicePixelRatio || 1);
  const ch = ctx.canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, cw, ch);

  const tl = toScreen(v, { x: 0, y: 0 });
  const br = toScreen(v, { x: table.w, y: table.h });
  const w = br.x - tl.x;
  const h = br.y - tl.y;

  const bg = ctx.createLinearGradient(tl.x, tl.y, tl.x, br.y);
  bg.addColorStop(0, '#16233a');
  bg.addColorStop(1, '#0d1524');
  ctx.fillStyle = bg;
  ctx.fillRect(tl.x, tl.y, w, h);

  if (st.grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= table.w + 1e-6; x += st.grid) {
      const p = toScreen(v, { x, y: 0 });
      ctx.beginPath(); ctx.moveTo(p.x, tl.y); ctx.lineTo(p.x, br.y); ctx.stroke();
    }
    for (let y = 0; y <= table.h + 1e-6; y += st.grid) {
      const p = toScreen(v, { x: 0, y });
      ctx.beginPath(); ctx.moveTo(tl.x, p.y); ctx.lineTo(br.x, p.y); ctx.stroke();
    }
  }

  if (st.mask) {
    ctx.fillStyle = 'rgba(80,200,255,0.10)';
    const c = st.mask.step * S(v);
    for (const p of st.mask.cells) {
      const s = toScreen(v, p);
      ctx.fillRect(s.x - c / 2, s.y - c / 2, c + 0.5, c + 0.5);
    }
  }

  for (const sh of table.shapes) {
    if (sh.kind !== 'drain') continue;
    const a = toScreen(v, { x: sh.x, y: sh.y });
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(a.x, a.y, sh.w * S(v), sh.h * S(v));
    ctx.strokeStyle = '#4a2030';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + sh.w * S(v), a.y); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.lineCap = 'round';
  for (const sh of table.shapes) {
    if (sh.kind !== 'seg' && sh.kind !== 'arc' && sh.kind !== 'circle') continue;
    const wpx = sh.r * 2 * S(v);
    if (sh.kind === 'circle') {
      railPath(ctx, sh, v);
      ctx.fillStyle = '#9fb4cc';
      ctx.fill();
    } else {
      railPath(ctx, sh, v);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = wpx + 3;
      ctx.stroke();
      railPath(ctx, sh, v);
      ctx.strokeStyle = '#9fb4cc';
      ctx.lineWidth = wpx;
      ctx.stroke();
      railPath(ctx, sh, v);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, wpx * 0.3);
      ctx.stroke();
    }
  }

  const angles = st.flipperAngles || {};
  for (const sh of table.shapes) {
    if (sh.kind !== 'flipper') continue;
    const ang = angles[sh.id] != null ? angles[sh.id] : sh.restAng;
    flipperPath(ctx, sh, ang, v, st.ballR);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    flipperPath(ctx, sh, ang, v, st.ballR);
    ctx.fillStyle = '#ffce3a';
    ctx.fill();
    ctx.strokeStyle = '#7a5c00';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const cp = toScreen(v, sh.pivot);
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, Math.max(2, sh.r0 * 0.45 * S(v)), 0, Math.PI * 2);
    ctx.fillStyle = '#3b2c00';
    ctx.fill();
  }

  if (st.trail && st.trail.length > 1) {
    ctx.beginPath();
    for (let i = 0; i < st.trail.length; i++) {
      const p = toScreen(v, st.trail[i]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(120,220,255,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const b of st.balls || []) {
    if (!b.alive) continue;
    const c = toScreen(v, b.p);
    const r = st.ballR * S(v);
    ctx.beginPath();
    ctx.arc(c.x + r * 0.25, c.y + r * 0.45, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    const g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.4, r * 0.1, c.x, c.y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#c8d2dc');
    g.addColorStop(1, '#5d6a78');
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  for (const m of st.marks || []) {
    const c = toScreen(v, m.at || m);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = m.kind === 'gap' ? '#ffb020' : '#ff4444';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(tl.x, tl.y, w, h);
}

export { flipperPath, railPath };
