/* Baseball mocks - the field band. One camera for both batting and pitching:
   elevated, from behind and above home plate. Plate at bottom center, mound about
   a third of the way up, fence arc at top. Illustrative only (mock, not the engine). */

function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function outZones(ctx, plate, R, w, h) {
  // Seven hazard wedges standing where fielders would: 4 infield, 3 outfield.
  // Hatched, translucent dark, gaps left plain (the fair territory's own grass).
  const zones = [
    { a0: -100, a1: -78, r0: 0.16, r1: 0.34 },  // 3B
    { a0: -60, a1: -38, r0: 0.16, r1: 0.34 },   // SS
    { a0: -142, a1: -120, r0: 0.16, r1: 0.34 }, // 1B (mirrored side, canvas up-left is negative)
    { a0: -104, a1: -76, r0: 0.36, r1: 0.42 },  // 2B (shallow, behind the bag)
    { a0: -150, a1: -118, r0: 0.55, r1: 0.72 }, // LF
    { a0: -104, a1: -76, r0: 0.60, r1: 0.80 },  // CF
    { a0: -62, a1: -30, r0: 0.55, r1: 0.72 },   // RF
  ];
  const pattern = hatchPattern(ctx);
  for (const z of zones) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(plate.x, plate.y);
    ctx.arc(plate.x, plate.y, R * z.r1, deg(z.a0), deg(z.a1));
    ctx.lineTo(plate.x, plate.y);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = 'rgba(6,10,6,0.28)';
    ctx.fillRect(plate.x - R, plate.y - R, R * 2, R * 2);
    ctx.fillStyle = pattern;
    ctx.fillRect(plate.x - R, plate.y - R, R * 2, R * 2);
    ctx.restore();
    // sector outline
    ctx.beginPath();
    ctx.moveTo(plate.x + Math.cos(deg(z.a0)) * R * z.r0, plate.y + Math.sin(deg(z.a0)) * R * z.r0);
    ctx.lineTo(plate.x + Math.cos(deg(z.a0)) * R * z.r1, plate.y + Math.sin(deg(z.a0)) * R * z.r1);
    ctx.arc(plate.x, plate.y, R * z.r1, deg(z.a0), deg(z.a1));
    ctx.lineTo(plate.x + Math.cos(deg(z.a1)) * R * z.r0, plate.y + Math.sin(deg(z.a1)) * R * z.r0);
    ctx.arc(plate.x, plate.y, R * z.r0, deg(z.a1), deg(z.a0), true);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function deg(d) { return (d * Math.PI) / 180 - Math.PI / 2; }

let _hatch;
function hatchPattern(ctx) {
  if (_hatch) return _hatch;
  const s = document.createElement('canvas');
  s.width = 8; s.height = 8;
  const sc = s.getContext('2d');
  sc.strokeStyle = 'rgba(255,255,255,0.14)';
  sc.lineWidth = 2;
  sc.beginPath();
  sc.moveTo(-2, 8); sc.lineTo(8, -2);
  sc.moveTo(0, 10); sc.lineTo(10, 0);
  sc.stroke();
  _hatch = ctx.createPattern(s, 'repeat');
  return _hatch;
}

export function drawField(cv, opts) {
  const { ctx, w, h } = setupCanvas(cv);
  const plate = { x: w / 2, y: h * 0.94 };
  const R = h * 0.88;

  ctx.clearRect(0, 0, w, h);
  // grass
  ctx.fillStyle = '#3f6b34';
  ctx.fillRect(0, 0, w, h);

  // foul territory (slightly darker), the two wedges outside +/-45deg
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.moveTo(plate.x, plate.y);
  ctx.arc(plate.x, plate.y, R * 1.2, deg(-135), deg(-45));
  ctx.lineTo(plate.x, plate.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill('evenodd');
  ctx.restore();

  // fence arc
  ctx.beginPath();
  ctx.arc(plate.x, plate.y, R, deg(-135), deg(-45));
  ctx.strokeStyle = '#1a2a17';
  ctx.lineWidth = 6;
  ctx.stroke();

  // out zones
  outZones(ctx, plate, R, w, h);

  // foul lines
  ctx.beginPath();
  ctx.moveTo(plate.x, plate.y);
  ctx.lineTo(plate.x + Math.cos(deg(-135)) * R, plate.y + Math.sin(deg(-135)) * R);
  ctx.moveTo(plate.x, plate.y);
  ctx.lineTo(plate.x + Math.cos(deg(-45)) * R, plate.y + Math.sin(deg(-45)) * R);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // infield dirt
  const dR = R * 0.30;
  ctx.beginPath();
  ctx.moveTo(plate.x - dR * 0.72, plate.y - dR * 0.72);
  ctx.lineTo(plate.x, plate.y - dR * 1.05);
  ctx.lineTo(plate.x + dR * 0.72, plate.y - dR * 0.72);
  ctx.lineTo(plate.x, plate.y + 6);
  ctx.closePath();
  ctx.fillStyle = '#a9713f';
  ctx.fill();

  // mound, about a third of the way up
  const moundY = plate.y - (plate.y - (plate.y - R)) * 0.33;
  ctx.beginPath();
  ctx.ellipse(plate.x, moundY, 13, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#a9713f';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // strike zone, above the plate
  const zw = Math.max(w * 0.30, 40);
  const zx = plate.x - zw / 2;
  const zy = plate.y - 46;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(zx, zy, zw, 30);

  // plate
  ctx.beginPath();
  ctx.moveTo(plate.x - 9, plate.y);
  ctx.lineTo(plate.x + 9, plate.y);
  ctx.lineTo(plate.x + 9, plate.y - 6);
  ctx.lineTo(plate.x, plate.y - 11);
  ctx.lineTo(plate.x - 9, plate.y - 6);
  ctx.closePath();
  ctx.fillStyle = '#f4f6fb';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const cbYellow = '#F2B705', cbBlue = '#1F5FA8', cbVermilion = '#E0532F', cbTeal = '#178A7A';

  if (opts && opts.state === 'pitching') {
    // ball in flight, mound toward plate, growing as it approaches
    const t = opts.pitchT != null ? opts.pitchT : 0.55;
    const bx = plate.x + (0) * (1 - t);
    const by = moundY + (plate.y - moundY) * t;
    const br = 2.5 + t * 4.5;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // batting: a landed single, up the middle-right gap
    const lx = plate.x + w * 0.18;
    const ly = plate.y - R * 0.48;
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText('1B', lx, ly - 10);
    ctx.fillText('1B', lx, ly - 10);
  }

  // runner on first (profile color diamond marker, ink border)
  if (opts && opts.runnerFirst) {
    const fx = plate.x + dR * 0.72, fy = plate.y - dR * 0.72;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = cbTeal;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.strokeStyle = '#12181f';
    ctx.lineWidth = 2;
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.restore();
  }

  // batter's box, on the side matching who is at the plate
  const boxSide = opts && opts.state === 'pitching' ? -1 : 1; // pitching: CPU box shown, opposite side illustrated
  ctx.strokeStyle = opts && opts.state === 'pitching' ? cbBlue : cbTeal;
  ctx.lineWidth = 2;
  ctx.strokeRect(plate.x + boxSide * 16, plate.y - 24, 14, 24);
}
