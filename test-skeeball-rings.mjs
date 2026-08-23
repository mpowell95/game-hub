// Headless check of _ringNumbers: canvas + document shimmed, real three, real geometry.
const painted = [];              // every number this run draws, in order
const ctx = {
  font: '800 100px x', textAlign: '', textBaseline: '', fillStyle: '',
  fillRect() {}, fillText(t) { painted.push(String(t)); },
  measureText(t) {
    const px = parseFloat(String(this.font).match(/(\d+(?:\.\d+)?)px/)[1]);
    return { width: 0.60 * px * t.length, actualBoundingBoxAscent: 0.72 * px, actualBoundingBoxDescent: 0 };
  },
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
globalThis.matchMedia = () => ({ matches: false });

const THREE = await import('./skeeball/js/vendor/three.module.min.js');
const { BOARDS } = await import('./skeeball/js/boards.js');
const { buildMachine } = await import('./skeeball/js/machines/classic/machine.js');
const { Renderer } = await import('./skeeball/js/machines/classic/render.js');

const G = BOARDS[0].geom, M = buildMachine(G);
const fake = {
  G, look: BOARDS[0].look, M,
  _canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  _track(x) { return x; },
  _mat(o) { return new THREE.MeshStandardMaterial(o); },
  _decal: Renderer.prototype._decal,
  _onFace: Renderer.prototype._onFace,
  scene: { add() {} },
};
const map = Renderer.prototype._ringNumbers.call(fake, 0.60);
const onRings = painted.slice();
painted.length = 0;
// The values that cannot go on a ring wall get a free-standing concave arc instead - see
// _numberPlates and DECISIONS.md#where-the-point-values-live.
Renderer.prototype._numberPlates.call(fake, 0.60);
const onPlates = painted.slice();

const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rings = new Map();
for (const [solid, rec] of map) {
  if (!rings.has(solid.ring)) rings.set(solid.ring, { outer: [], inner: [] });
  const g = rings.get(solid.ring);
  const p = norm(solid.faceRot.phi - Math.PI / 2);
  const ha = Math.atan(solid.half[0] / (G.holes[solid.ring].ringD / 2 + G.ringThick / 2));
  if (rec.outer) g.outer.push({ p, ha, m: rec.outer, rec });
  if (rec.inner) g.inner.push({ p, ha, m: rec.inner, rec });
}

// THE LAYOUT. Each value sits on the ring ABOVE its hole where the number can survive the wrap;
// the 50 goes on the inside of its own ring's far wall (it is the top of the stack, so that wall
// is free); the 30 and 40 are on concave arcs of their own because their rings are the tightest
// on the board and a number wide enough to read runs off the visible face; and the 10's ring -
// the lowest - carries nothing at all.
const WANT = { h20: '10', c30: '20', '100L': '100', '100R': '100' };
const WANT_INNER = { c50: '50' };
const WANT_PLATES = ['30', '40'];

let bad = 0;
const fail = (m) => { console.log('  FAIL ' + m); bad++; };

// THE ONE THAT MATTERS, and the one that does not care where anything lives: every value on the
// machine is painted EXACTLY ONCE. A number that moves is fine; a number that is dropped, or
// drawn twice because it was moved without being removed from its old home, is not.
{
  const all = [...onRings, ...onPlates].sort();
  const want = Object.keys(G.holes).map((id) => String(G.holes[id].value)).sort();
  const same = all.length === want.length && all.every((v, i) => v === want[i]);
  console.log('painted:', all.join(' '), '| rings:', onRings.join(' ') || 'none',
    '| plates:', onPlates.join(' ') || 'none');
  if (!same) fail(`every value painted once: got [${all.join(', ')}], wanted [${want.join(', ')}]`);
  const platesSorted = onPlates.slice().sort();
  if (platesSorted.join(',') !== WANT_PLATES.slice().sort().join(','))
    fail(`plates: got [${platesSorted.join(', ')}], wanted [${WANT_PLATES.join(', ')}]`);
}

for (const id of Object.keys(G.holes)) {
  const H = G.holes[id];
  if (!H.ringD) continue;
  const g = rings.get(id) || { outer: [], inner: [] };
  const want = WANT[id], wantIn = WANT_INNER[id];
  const has = g.outer.length > 0, hasIn = g.inner.length > 0;
  const px = (list) => (list.length ? list[0].m.map.image.width + 'x' + list[0].m.map.image.height : '-');
  console.log(
    id.padEnd(5),
    '| outer', String(g.outer.length).padStart(2), 'seg', px(g.outer).padStart(9),
    '| inner', String(g.inner.length).padStart(2), 'seg', px(g.inner).padStart(9),
    '| want', String(want || 'none').padStart(4), wantIn ? '+ inner ' + wantIn : '',
  );
  if (!!want !== has) fail(`${id}: outer expected ${want || 'none'}, got ${has ? 'a number' : 'none'}`);
  if (!!wantIn !== hasIn) fail(`${id}: inner expected ${wantIn || 'none'}, got ${hasIn ? 'a number' : 'none'}`);

  for (const [name, list] of [['outer', g.outer], ['inner', g.inner]]) {
    if (!list.length) continue;
    const sl = list.map((o) => ({ off: o.m.map.offset.x, rep: o.m.map.repeat.x }))
      .sort((a, b) => a.off - b.off);
    const sum = sl.reduce((n, o) => n + o.rep, 0);
    let gap = 0, cur = 0;
    for (const o of sl) { gap = Math.max(gap, Math.abs(o.off - cur)); cur = o.off + o.rep; }
    gap = Math.max(gap, Math.abs(cur - 1));
    if (Math.abs(sum - 1) > 1e-9 || gap > 1e-9) fail(`${id} ${name}: slices do not tile [0,1] (sum ${sum}, gap ${gap})`);
    for (const o of list) {
      for (const k of ['xHi', 'xLo']) {
        const mm = o.rec[k];
        if (!mm) { fail(`${id} ${name}: missing ${k}`); continue; }
        if (mm.map.repeat.x !== 0) fail(`${id} ${name}: ${k} is not a single column`);
        if (mm.map.offset.x < -1e-9 || mm.map.offset.x > 1 + 1e-9) fail(`${id} ${name}: ${k} column outside [0,1]`);
      }
    }
    const lo = Math.min(...list.map((o) => o.p - o.ha));
    const hi = Math.max(...list.map((o) => o.p + o.ha));
    const target = name === 'inner' ? Math.PI / 2 : -Math.PI / 2;
    if (lo > target || hi < target) fail(`${id} ${name}: window does not cover the wall the player sees`);
  }
}
console.log(bad ? `\nFAIL: ${bad} problem(s)` : '\nOK: labels match the asked-for layout, slices tile, seams covered');
process.exit(bad ? 1 : 0);
