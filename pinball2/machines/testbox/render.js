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

  // ---------------------------------------------------------------- deck art
  // SENSORS ARE DRAWN FIRST because they are painted ON the deck: a rollover, a spinner's lane, a
  // scoop's mouth and a kickback's strip all sit UNDER anything solid, which is also the order
  // they exist in on a real playfield. `st.lamps` is a map of shape id to a state name, and a
  // sensor with no entry is cold. Colour is never the only channel - see the root CLAUDE.md.
  const lamp = (id) => (st.lamps && st.lamps[id]) || 'cold';
  const LIT = { cold: '#55697f', hot: '#ffce3a', mode: '#fff3d0', spent: '#3d4a5c' };
  for (const sh of table.shapes) {
    if (sh.kind !== 'sensor') continue;
    const state = lamp(sh.id);
    const col = LIT[state] || LIT.cold;
    if (sh.role === 'spinner') {
      const a = toScreen(v, sh.a);
      const b2 = toScreen(v, sh.b);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y);
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([5, 4]); ctx.stroke();
      ctx.setLineDash([]);
      const mid = { x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 };
      ctx.beginPath(); ctx.arc(mid.x, mid.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#cfdae8'; ctx.fill();
      continue;
    }
    const c = toScreen(v, sh.c);
    const R = sh.r * S(v);
    if (sh.role === 'saucer' && sh.part === 'wheel') {
      // THE WHEEL IS DRAWN BIGGER THAN ITS HOLE, and that is correct: on a Ferris wheel the frame
      // is AROUND the hole, not the hole itself. It is decor - nothing here is a collider, and no
      // probe can see it (`docs/PINBALL2-PIER-NINE-ART.md`, "Art bigger than its collider").
      const RIM = R * 1.9;
      ctx.beginPath(); ctx.arc(c.x, c.y, RIM, 0, Math.PI * 2);
      ctx.strokeStyle = '#35d0c0'; ctx.lineWidth = 2; ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(c.x + RIM * Math.cos(a), c.y + RIM * Math.sin(a), 1.6, 0, Math.PI * 2);
        ctx.fillStyle = '#fff3d0'; ctx.fill();
      }
      const locked = (st.locks || 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2 + (st.wheelAng || 0);
        const cx = c.x + RIM * 0.78 * Math.cos(a);
        const cy = c.y + RIM * 0.78 * Math.sin(a);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(cx, cy);
        ctx.strokeStyle = '#35d0c0'; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
        if (i < locked) { ctx.fillStyle = '#ffce3a'; ctx.fill(); }
        else { ctx.strokeStyle = '#55697f'; ctx.lineWidth = 1.8; ctx.stroke(); }
      }
    }
    if (sh.role === 'saucer') {
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
      ctx.fillStyle = '#05090f'; ctx.fill();
      ctx.strokeStyle = state === 'cold' ? '#55697f' : col; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = state === 'cold' ? '#12202f' : col; ctx.fill();
      continue;
    }
    if (sh.role === 'bullseye') {
      // Ring and dot, vermilion, lit or not. The precision shot must never read as a standup.
      ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.78, 0, Math.PI * 2);
      ctx.strokeStyle = '#e0532f'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = state === 'cold' ? '#e0532f' : col; ctx.fill();
      continue;
    }
    if (sh.role === 'diverter') {
      // THE FLAP PHYSICALLY SWINGS, which is the strongest kind of state there is: you can see
      // where the ramp will feed BEFORE you shoot it, without reading a word (the art file's
      // "state as geometry rather than as light").
      const piv = toScreen(v, sh.a);
      const tip = toScreen(v, sh.on ? sh.alt : sh.b);
      ctx.beginPath(); ctx.moveTo(piv.x, piv.y); ctx.lineTo(tip.x, tip.y);
      ctx.strokeStyle = '#35d0c0'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
      const gh = toScreen(v, sh.on ? sh.b : sh.alt);
      ctx.beginPath(); ctx.moveTo(piv.x, piv.y); ctx.lineTo(gh.x, gh.y);
      ctx.strokeStyle = 'rgba(53,208,192,0.30)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(piv.x, piv.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#cfdae8'; ctx.fill();
      continue;
    }
    if (sh.role === 'kicker') {
      ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.85, 0, Math.PI * 2);
      ctx.strokeStyle = sh.armed ? '#35d0c0' : '#3d4a5c';
      ctx.lineWidth = 3; ctx.setLineDash(sh.armed ? [] : [4, 4]); ctx.stroke();
      ctx.setLineDash([]);
      if (sh.armed) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y + R * 0.45); ctx.lineTo(c.x, c.y - R * 0.45);
        ctx.moveTo(c.x - R * 0.3, c.y - R * 0.15); ctx.lineTo(c.x, c.y - R * 0.45);
        ctx.lineTo(c.x + R * 0.3, c.y - R * 0.15);
        ctx.strokeStyle = '#35d0c0'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      continue;
    }
    // rollover: an oval insert. Filled and ringed when lit, an outline when not - shape AND hue.
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, R * 0.62, R * 0.95, 0, 0, Math.PI * 2);
    if (state === 'cold') { ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke(); }
    else {
      ctx.fillStyle = col; ctx.fill();
      ctx.beginPath(); ctx.ellipse(c.x, c.y, R * 1.0, R * 1.3, 0, 0, Math.PI * 2);
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.setLineDash([3, 4]); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // What a solid part is PAINTED. One map, keyed by the table's own `part` label, so a colour is
  // never decided at the point of drawing and a new part that forgets to add a row simply looks
  // like a rail instead of throwing.
  const PAINT = {
    ringtoss: '#e0532f', baitshop: '#e0532f', boathouse: '#8fa6bb', ticket: '#e8dcc0',
    drop: '#a8874f', shooterGate: '#35d0c0', orbitGate: '#35d0c0', lanepost: '#cfdae8',
  };

  ctx.lineCap = 'round';
  for (const sh of table.shapes) {
    if (sh.kind !== 'seg' && sh.kind !== 'arc' && sh.kind !== 'circle' && sh.kind !== 'sling') continue;
    // A DROPPED TARGET LIES FLAT. It is not a collider and it must not look like one: a low
    // ellipse at 30%, which is the "spent" state the art file names for exactly this.
    if (sh.down) {
      const mid = toScreen(v, { x: (sh.a.x + sh.b.x) / 2, y: (sh.a.y + sh.b.y) / 2 });
      const L = Math.hypot(sh.b.x - sh.a.x, sh.b.y - sh.a.y) * S(v);
      ctx.save();
      ctx.translate(mid.x, mid.y);
      ctx.rotate(Math.atan2(sh.b.y - sh.a.y, sh.b.x - sh.a.x));
      ctx.beginPath(); ctx.ellipse(0, 0, L / 2, Math.max(2, sh.r * S(v) * 0.45), 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(168,135,79,0.30)'; ctx.fill();
      ctx.strokeStyle = 'rgba(85,105,127,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
      continue;
    }
    const wpx = sh.r * 2 * S(v);
    if (sh.kind === 'sling') {
      const a = toScreen(v, sh.a);
      const b2 = toScreen(v, sh.b);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = wpx + 4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y);
      const hot = st.hot && st.hot[sh.id];
      ctx.strokeStyle = hot ? '#ffe9a3' : '#e0532f'; ctx.lineWidth = wpx; ctx.stroke();
      continue;
    }
    const paint = PAINT[sh.part] || '#9fb4cc';
    if (sh.kind === 'circle') {
      // A RUBBER POST is a white cap in a dark rubber ring, and it is never lit amber: amber on
      // this table means "shoot this", and nobody shoots a post.
      railPath(ctx, sh, v);
      ctx.fillStyle = sh.part === 'post' ? '#16222f' : paint;
      ctx.fill();
      if (sh.part === 'post') {
        const c = toScreen(v, sh.c);
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1.5, sh.r * S(v) * 0.62), 0, Math.PI * 2);
        ctx.fillStyle = '#cfdae8'; ctx.fill();
      }
    } else {
      railPath(ctx, sh, v);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = wpx + 3;
      ctx.stroke();
      railPath(ctx, sh, v);
      ctx.strokeStyle = st.hot && st.hot[sh.id] ? '#ffe9a3' : paint;
      ctx.lineWidth = wpx;
      ctx.stroke();
      railPath(ctx, sh, v);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, wpx * 0.3);
      ctx.stroke();
    }
  }

  for (const sh of table.shapes) {
    if (sh.kind !== 'bumper') continue;
    const c = toScreen(v, sh.c);
    const R = sh.r * S(v);
    const hot = st.hot && st.hot[sh.id];
    ctx.beginPath(); ctx.arc(c.x, c.y + R * 0.18, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    const g = ctx.createRadialGradient(c.x - R * 0.3, c.y - R * 0.35, R * 0.15, c.x, c.y, R);
    g.addColorStop(0, hot ? '#ffffff' : '#7fd8ff');
    g.addColorStop(1, hot ? '#ffce3a' : '#1f5fa8');
    ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = hot ? '#fff6d5' : '#0d2f57'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = hot ? '#fff' : '#0e2038'; ctx.fill();
  }

  // RAMPS. Height is drawn as a LIFT up the screen plus a shadow left on the playfield, which is
  // how a raised lane reads on a top-down table. The shadow is the part that sells it.
  const LIFT = 0.55;                       // screen metres of lift per metre of height
  for (const sh of table.shapes) {
    if (sh.kind !== 'ribbon') continue;
    const lift = (p, z) => toScreen(v, { x: p.x, y: p.y - (z || 0) * LIFT });
    const wpx = sh.w * S(v);
    const line = (fn, width, style) => {
      ctx.beginPath();
      sh.pts.forEach((p, i) => { const q = fn(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke();
    };
    // A WIREFORM, NOT A TUBE. A ramp drawn as a solid 46 mm lane is opaque, and on a table whose
    // ramps cross the middle that means the deck under them - the Fishing Dock, the Boathouse, the
    // wheel - simply is not there to look at. `docs/PINBALL2-PIER-NINE-ART.md` calls for cream
    // sleepers between two rails, and a real wireform is mostly air, which is the point: you can
    // see the playfield through it. A ramp opts in with `look: 'wire'`; the editor's own solid lane
    // is still the default, because when you are EDITING a ramp you want to see its whole footprint.
    // A DISARMED LANE IS DRAWN COLD. On a table with a diverter two ramps share a mouth and only
    // one of them is where the ball will actually go, and drawing both at full strength hides the
    // one thing the diverter exists to tell you BEFORE you shoot: where this shot feeds. The flap
    // swinging says it too; this says it along the whole length of the lane.
    const dim = sh.armed === false;
    ctx.globalAlpha = dim ? 0.22 : 1;
    if (sh.look === 'wire') {
      const off = (d) => (p) => {
        const q = lift(p, p.z);
        return { x: q.x + d * 0.5 * wpx * (p.n ? p.n.x : 0), y: q.y + d * 0.5 * wpx * (p.n ? p.n.y : 0) };
      };
      // Sideways axis per point, so the two rails follow the curve instead of being a fat stroke.
      for (let i = 0; i < sh.pts.length; i++) {
        const a = sh.pts[Math.max(0, i - 1)];
        const b2 = sh.pts[Math.min(sh.pts.length - 1, i + 1)];
        const dx = b2.x - a.x; const dy = b2.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        sh.pts[i].n = { x: -dy / L, y: dx / L };
      }
      line((p) => toScreen(v, p), wpx * 0.55, 'rgba(0,0,0,0.22)');               // the shadow only
      const tie = sh.tie || '#e8dcc0';
      const rail = sh.rail || '#8fa6bb';
      ctx.beginPath();
      for (let i = 0; i < sh.pts.length; i += 2) {
        const p = sh.pts[i];
        const A = off(-1)(p); const B = off(1)(p);
        ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      }
      // MULTIPLY the tie's own translucency by the lane's, never overwrite it: setting alpha back
      // to 1 here is what made a disarmed lane draw at full strength for one build, so both Coaster
      // paths looked live at once and the diverter told the player nothing.
      const A = ctx.globalAlpha;
      ctx.strokeStyle = tie; ctx.lineWidth = Math.max(1, wpx * 0.10); ctx.globalAlpha = A * 0.55;
      ctx.stroke();
      ctx.globalAlpha = A;
      line(off(-1), Math.max(1.6, wpx * 0.10), rail);
      line(off(1), Math.max(1.6, wpx * 0.10), rail);
    } else {
    line((p) => toScreen(v, p), wpx * 0.9, 'rgba(0,0,0,0.35)');                 // the shadow, on the deck
    line((p) => lift(p, p.z), wpx + 6, 'rgba(10,16,28,0.9)');                   // the lane's own edge
    line((p) => lift(p, p.z), wpx, '#2b4a72');                                  // the lane floor
    line((p) => lift(p, p.z), Math.max(1, wpx * 0.12), 'rgba(180,220,255,0.35)');
    }
    for (const end of [sh.pts[0], sh.pts[sh.pts.length - 1]]) {
      const q = lift(end, end.z);
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(3, wpx * 0.22), 0, Math.PI * 2);
      ctx.fillStyle = '#7fd8ff'; ctx.fill();
    }
    ctx.globalAlpha = 1;
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

  // THE TRAIL FADES INTO ITS TAIL, AND IT HAS TO.
  //
  // Drawn as one stroke at a flat 45% it read as a stray teal polyline crossing the table - the
  // ball's path and a piece of geometry look identical when both are a uniform line, and on a tool
  // whose whole job is showing you geometry that is the worst possible ambiguity. Fading it says
  // "this is history, and that end is the recent end" without a legend.
  //
  // It is drawn as segments rather than one path because a single stroke can only have one alpha.
  // The cost is one stroke per segment over at most 90 points, which is nothing next to the
  // playfield underneath it.
  if (st.trail && st.trail.length > 1) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < st.trail.length; i++) {
      const t = i / (st.trail.length - 1);          // 0 at the oldest point, 1 at the ball
      const a = toScreen(v, st.trail[i - 1]);
      const b = toScreen(v, st.trail[i]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(120,220,255,${(0.5 * t * t).toFixed(3)})`;
      ctx.lineWidth = 0.8 + 1.7 * t;
      ctx.stroke();
    }
  }

  for (const b of st.balls || []) {
    if (!b.alive) continue;
    if (!Number.isFinite(b.p.x) || !Number.isFinite(b.p.y)) continue;   // createRadialGradient THROWS on these
    const z = b.z || 0;
    const c = toScreen(v, { x: b.p.x, y: b.p.y - z * 0.55 });
    const ground = toScreen(v, b.p);
    const r = st.ballR * S(v);
    // On a ramp the shadow stays on the playfield and the ball lifts away from it. That gap IS the
    // height: without it a raised ball just looks like a ball somewhere else.
    ctx.beginPath();
    ctx.ellipse(ground.x + r * 0.25, ground.y + r * 0.45, r * (1 - z * 2), r * 0.75 * (1 - z * 2), 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.45 - z * 3})`;
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
