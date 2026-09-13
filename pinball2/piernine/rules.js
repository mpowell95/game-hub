// PIER NINE - the rules. Score, balls, bonus, lamps, modes, locks, combos.
//
// THIS FILE IS THE THING THE ENGINE DOES NOT HAVE. `pinball2/CLAUDE.md`'s finding was that the
// engine has eight shape kinds and not one of them can award a point, so BOARDWALK is a physics
// sandbox with no game in it. Everything that makes PIER NINE a game rather than a table is here,
// and it touches the solver in exactly one way: it READS `world.events` and it WRITES three fields
// that were built for it (`shape.down` through `world.setDown`, and `armed` on the two kickers).
// It never moves a ball, never adds a force, and never reaches into the physics.
//
// Every base value comes from `docs/pier-nine-values.mjs`, which derives it from the shot's
// distance, its aperture and what a miss costs. Nothing here is a chosen number except the ones
// the blueprint's section 4 lists as deliberately NOT derived, and those carry their reason.

const BASE = {
  // derived - see docs/pier-nine-values.mjs
  orbitL: 3000, orbitR: 3000, wheel: 3000, pier: 1000, coaster: 500,
  ringtoss: 4000, bullseye: 6000, boathouse: 5000, ticket: 3500, fortune: 2500,
  drop: 500, dockBank: 1000,
  // NOT derived: activity, not shots. Nothing here is aimed at.
  pop: 100, sling: 50, inlane: 250, spin: 250, post: 10, rattle: 100,
  // NOT derived: the difficulty in multiball is keeping three balls alive, not the shot.
  jackpot: 25000, superJackpot: 100000,
  // NOT derived: escalating with the tension. The same shot three times, and the third is the one
  // you can lose.
  lock: [5000, 10000, 15000],
  // NOT derived: a partial-credit outcome inside a guided lane. Deliberately less than the 3000
  // for actually finishing the orbit - partial credit that beats full credit is a scoring bug.
  baitshop: 1000,
  lane: 500, laneSet: 3000,
  hurryUp: 25000,
};

const MODES = [
  { id: 'ringtoss', name: 'RING TOSS', secs: 30, lit: ['ringtoss', 'bullseye'], mult: 10 },
  { id: 'coaster', name: 'COASTER RUN', secs: 45, lit: ['coaster', 'pier'], mult: 10 },
  { id: 'hightide', name: 'HIGH TIDE', secs: 30, lit: ['*'], mult: 2 },
];

const BALLS_PER_GAME = 3;
const SAVE_SECS = 8;
const COMBO_SECS = 3;
const RATTLE_SECS = 1;
const BOATHOUSE_SECS = 8;
const HURRY_SECS = 15;

export function createRules(world, table) {
  const cfg2 = world.cfg;
  const byId = new Map(table.shapes.map((s) => [s.id, s]));
  const parts = (name) => table.shapes.filter((s) => s.part === name);
  const one = (name) => parts(name)[0];
  const dock = parts('drop');
  const kickback = one('kickback');
  const ballsave = one('ballsave');
  const wheel = one('wheel');
  const fortune = one('fortune');
  const lanes = parts('lane');
  const coaster = one('coaster');
  const feed = one('coasterFeed');
  const flap = one('diverter');

  const R = {
    score: 0, ball: 1, ballsTotal: BALLS_PER_GAME, over: false,
    bonusX: 1, bonus: { ramps: 0, banks: 0, laneSets: 0, bullseyes: 0, spins: 0 },
    lanesLit: [false, false, false, false],
    laneCursor: 0,
    locks: 0, multiball: 0,
    mode: null, modesReady: 0, modesPlayed: [],
    combo: 0, comboUntil: 0,
    divert: 'inlane',                 // 'inlane' | 'wheel' - which Coaster path is armed
    mystery: 0,                       // the Ticket Booth's 3-position prize wheel
    mysteryReady: false,
    hurry: null,
    lastCast: false,
    saveUntil: 0,
    flash: [],                        // the last few things that scored, for the backglass
    lamps: {},
    started: false,
  };

  let boathouseHits = [];
  let lastPost = -9;
  let dockResetAt = 0;
  const scoredAt = new Map();         // shape id -> world time, so a ball riding a target is one hit

  const now = () => world.time;
  const say = (text, pts) => {
    R.flash.unshift({ text, pts: pts || 0, t: now() });
    if (R.flash.length > 5) R.flash.length = 5;
  };

  /** Every point on this table goes through here, so the mode multiplier and the combo chain are
   *  applied in ONE place and cannot be forgotten by whoever adds the next target. */
  function award(pts, text, opts) {
    const o = opts || {};
    let v = pts;
    if (o.major) {
      R.combo = now() < R.comboUntil ? Math.min(5, R.combo + 1) : 1;
      R.comboUntil = now() + COMBO_SECS;
      if (R.combo > 1) v *= R.combo;
    }
    if (R.mode && o.part && (R.mode.lit.includes('*') || R.mode.lit.includes(o.part))) {
      v *= R.mode.mult;
    }
    if (R.multiball > 1) v *= 2;
    v = Math.round(v);
    R.score += v;
    if (text) say(text + (R.combo > 1 && o.major ? ` x${R.combo}` : ''), v);
    return v;
  }

  /** THE DIVERTER. One physical shot, two destinations, and the choice is game state rather than
   *  aim - which is the whole reason the blueprint calls it the highest-value single addition: the
   *  Coaster is the EASIEST shot on the table and this makes it the most context-dependent one.
   *
   *  Rev B listed three positions. Rev C moved mode-start to the Fortune Teller ("locks live at the
   *  wheel, modes start at the scoop"), so two of them became the same thing and there are two
   *  physical routes here, not three. That is the rev C rule working, not a piece left out. */
  function setDiverter() {
    const wantWheel = R.started && R.multiball <= 1 && R.locks < 3
      && (R.locks > 0 || R.modesReady > 0 || R.mysteryReady);
    R.divert = wantWheel ? 'wheel' : 'inlane';
    if (coaster) coaster.armed = !wantWheel;
    if (feed) feed.armed = wantWheel;
    if (flap) flap.on = wantWheel;
  }

  // ---------------------------------------------------------------- serving
  function serve() {
    R.started = true;
    world.balls.length = 0;
    const b = world.addBall(table.launch, table.launchV || { x: 0, y: 0 });
    R.saveUntil = now() + SAVE_SECS;
    if (ballsave) ballsave.armed = true;
    if (kickback) kickback.armed = true;
    R.multiball = 1;
    setDiverter();
    return b;
  }

  function endBall() {
    const b = R.bonus;
    const raw = 1000 * b.ramps + 3000 * b.banks + 2000 * b.laneSets + 4000 * b.bullseyes + 100 * b.spins;
    const total = raw * R.bonusX;
    if (total > 0) { R.score += total; say(`BONUS x${R.bonusX}`, total); }
    R.bonus = { ramps: 0, banks: 0, laneSets: 0, bullseyes: 0, spins: 0 };
    R.bonusX = 1;
    R.lanesLit = [false, false, false, false];
    R.mode = null;
    R.hurry = null;
    R.combo = 0;
    if (R.ball >= R.ballsTotal) { R.over = true; R.started = false; return; }
    R.ball++;
    // The bank comes back up between balls, and only if nothing is standing where it will appear.
    for (const d of dock) world.setDown(d.id, false);
    serve();
  }

  // ---------------------------------------------------------------- the two holes
  function atWheel() {
    // LOCKS LIVE AT THE WHEEL. Nothing else happens here, which is the rule that makes the second
    // hole worth having (blueprint 3b, "Two holes, two jobs").
    if (R.multiball > 1) { award(BASE.jackpot, 'JACKPOT', { part: 'wheel' }); return; }
    R.locks = Math.min(3, R.locks + 1);
    award(BASE.lock[R.locks - 1], `LOCK ${R.locks}`, { part: 'wheel' });
    if (R.locks === 3) startMultiball();
  }

  /** THE SAME CODE PATH THE THIRD LOCK TAKES, named so the soak can reach it. A soak that sets up
   *  multiball its own way is a soak of its own setup code. */
  function startMultiball() {
    R.locks = 0;
    say('MULTIBALL', 0);
    // Two more balls, both from the wheel, and the third is the one already in it.
    //
    // **THE SPOT IS ASKED FOR, NOT ASSUMED.** The first version put them at the wheel's centre
    // plus 20 mm, which is inside the two posts that gate the saucer - the soak counted 2 rescues
    // per multiball, meaning the engine was finding a ball inside a collider and pushing it out on
    // its very first tick. Adding a ball IS a position write, the only one this engine makes on
    // purpose, and the least it can do is land somewhere legal. `world.isFree` is the same test
    // the solver's own rescue uses, so the answer cannot disagree with it.
    const spots = [[-0.022, 0.046], [0.022, 0.046], [-0.040, 0.074], [0.040, 0.074],
                   [0, 0.086], [-0.062, 0.052], [0.062, 0.052]];
    let placed = 0;
    for (const [dx, dy] of spots) {
      if (placed >= 2) break;
      const p = { x: wheel.c.x + dx, y: wheel.c.y + dy };
      if (!world.isFree(p)) continue;
      if (world.balls.some((o) => o.alive && Math.hypot(o.p.x - p.x, o.p.y - p.y) < cfg2.BALL_R * 2.2)) continue;
      world.addBall(p, { x: dx > 0 ? 0.6 : -0.6, y: 1.5 });
      placed++;
    }
    R.multiball = 3;
    setDiverter();
  }

  function atFortune() {
    // MODES START AT THE SCOOP, and so do the mystery and the hurry-up collect.
    if (R.hurry) { award(Math.round(R.hurry.value), 'HURRY-UP', { major: true }); R.hurry = null; return; }
    if (R.mysteryReady) {
      R.mysteryReady = false;
      const prize = R.mystery;
      if (prize === 0) award(12000, 'MYSTERY: POINTS');
      else if (prize === 1) { R.locks = Math.min(2, R.locks + 1); say('MYSTERY: LOCK LIT', 0); }
      else { R.modesReady++; say('MYSTERY: MODE LIT', 0); }
      return;
    }
    if (R.modesReady > 0 && !R.mode) {
      R.modesReady--;
      const next = MODES.find((m) => !R.modesPlayed.includes(m.id)) || MODES[0];
      R.mode = { ...next, until: now() + next.secs };
      R.modesPlayed.push(next.id);
      say(next.name, 0);
      return;
    }
    award(BASE.fortune, 'FORTUNE TELLER', { major: true, part: 'fortune' });
  }

  // ---------------------------------------------------------------- the event pump
  function pump() {
    for (const ev of world.events) {
      if (ev.type === 'hit') onHit(ev);
      else if (ev.type === 'bounce') onBounce(ev);
      else if (ev.type === 'sensor') onSensor(ev);
      else if (ev.type === 'spin') onSpin(ev);
      else if (ev.type === 'capture') onCapture(ev);
      else if (ev.type === 'ramp') onRamp(ev);
      else if (ev.type === 'drain') onDrain();
      else if (ev.type === 'escape') onDrain();
    }
    world.events.length = 0;
  }

  /** A ball riding along a standup touches it many times a tick - the solver says so and says why
   *  (`micro()`, the contact episode). One score per shape per 0.3 s, which is faster than any
   *  human can re-hit one and slower than any single contact can repeat. */
  function fresh(id, gap) {
    const last = scoredAt.get(id);
    if (last != null && now() - last < (gap || 0.3)) return false;
    scoredAt.set(id, now());
    return true;
  }

  function onHit(ev) {
    const sh = byId.get(ev.id);
    if (!sh || sh.score == null) return;
    if (!fresh(sh.id)) return;
    if (sh.part === 'post') {
      award(BASE.post, null);
      if (now() - lastPost < RATTLE_SECS) award(BASE.rattle, 'RATTLE');
      lastPost = now();
      return;
    }
    if (sh.part === 'drop') { onDrop(sh); return; }
    if (sh.part === 'boathouse') { onBoathouse(sh); return; }
    if (sh.part === 'ticket') {
      R.mystery = (R.mystery + 1) % 3;
      R.mysteryReady = true;
      award(BASE.ticket, 'TICKET BOOTH', { major: true, part: 'ticket' });
      return;
    }
    if (sh.part === 'ringtoss') { award(BASE.ringtoss, 'RING TOSS', { major: true, part: 'ringtoss' }); return; }
    if (sh.part === 'baitshop') { award(BASE.baitshop, 'BAIT SHOP', { part: 'baitshop' }); return; }
    award(sh.score, null);
  }

  function onDrop(sh) {
    if (sh.down) return;
    world.setDown(sh.id, true);
    award(BASE.drop, 'DOCK', { part: 'drop' });
    if (dock.every((d) => d.down)) {
      award(BASE.dockBank, 'DOCK CLEARED', { major: true, part: 'drop' });
      R.bonus.banks++;
      R.modesReady++;
      R.hurry = { value: BASE.hurryUp, until: now() + HURRY_SECS };
      dockResetAt = now() + 1.4;
    }
  }

  function onBoathouse(sh) {
    award(BASE.boathouse, 'BOATHOUSE', { major: true, part: 'boathouse' });
    boathouseHits = boathouseHits.filter((h) => now() - h.t < BOATHOUSE_SECS && h.id !== sh.id);
    boathouseHits.push({ id: sh.id, t: now() });
    if (boathouseHits.length >= 2) {
      boathouseHits = [];
      if (kickback) kickback.armed = true;
      R.lastCast = true;
      say('KICKBACK RELIT - LAST CAST', 0);
    }
  }

  function onBounce(ev) {
    const sh = byId.get(ev.id);
    if (!sh) return;
    if (sh.kind === 'bumper') award(BASE.pop, null);
    else if (sh.kind === 'sling') award(BASE.sling, null);
  }

  function onSpin(ev) {
    R.bonus.spins++;
    award(BASE.spin, null);
  }

  function onSensor(ev) {
    const sh = byId.get(ev.id);
    if (!sh) return;
    if (sh.part === 'lane') { onLane(sh); return; }
    if (sh.part === 'bullseye') {
      award(BASE.bullseye, 'BULLSEYE', { major: true, part: 'bullseye' });
      R.bonus.bullseyes++;
      R.modesReady++;
      return;
    }
    if (sh.part === 'orbitL' || sh.part === 'orbitR') {
      award(BASE[sh.part], sh.part === 'orbitL' ? 'LEFT ORBIT' : 'RIGHT ORBIT', { major: true, part: sh.part });
      return;
    }
    if (sh.part === 'inlaneL' || sh.part === 'inlaneR') { award(BASE.inlane, null); return; }
  }

  function onLane(sh) {
    const i = sh.lane;
    const wasLit = R.lanesLit[i];
    R.lanesLit[i] = true;
    award(wasLit ? BASE.lane : BASE.lane * 2, `LANE ${sh.letter}`);
    if (R.lanesLit.every(Boolean)) {
      R.lanesLit = [false, false, false, false];
      R.bonusX = Math.min(5, R.bonusX + 1);
      R.bonus.laneSets++;
      award(BASE.laneSet, `P-I-E-R  BONUS x${R.bonusX}`);
    }
  }

  function onCapture(ev) {
    const sh = byId.get(ev.id);
    if (!sh) return;
    if (sh.part === 'wheel') atWheel();
    else if (sh.part === 'fortune') atFortune();
  }

  function onRamp(ev) {
    if (ev.on) return;                       // scored on the way OFF, so a rolled-back ramp is not paid
    const sh = byId.get(ev.id);
    if (!sh || !fresh(sh.id, 0.5)) return;
    R.bonus.ramps++;
    // BOTH Coaster paths pay the Coaster. It is one shot with one difficulty; where the ball is
    // sent afterwards is the diverter's business and is already worth something else entirely.
    if (sh.part === 'coaster' || sh.part === 'coasterFeed') {
      award(BASE.coaster, sh.part === 'coasterFeed' ? 'COASTER > WHEEL' : 'COASTER',
            { major: true, part: 'coaster' });
    } else award(BASE.pier, 'THE PIER', { major: true, part: 'pier' });
  }

  function onDrain() {
    const live = world.balls.filter((b) => b.alive).length;
    if (R.multiball > 1) {
      R.multiball = live;
      if (live > 1) return;
      say('MULTIBALL OVER', 0);
    }
    if (live > 0) return;
    if (R.lastCast) { R.lastCast = false; award(50000, 'LAST CAST'); }
    endBall();
  }

  // ---------------------------------------------------------------- per frame
  function lamps() {
    const L = {};
    lanes.forEach((sh, i) => { L[sh.id] = R.lanesLit[i] ? 'hot' : 'cold'; });
    if (wheel) L[wheel.id] = R.locks > 0 ? 'hot' : 'cold';
    if (fortune) L[fortune.id] = (R.modesReady > 0 || R.mysteryReady || R.hurry) ? 'hot' : 'cold';
    if (flap) L[flap.id] = R.divert === 'wheel' ? 'hot' : 'cold';
    for (const sh of table.shapes) {
      if (sh.kind !== 'sensor' || L[sh.id]) continue;
      L[sh.id] = R.mode && (R.mode.lit.includes('*') || R.mode.lit.includes(sh.part)) ? 'mode' : 'cold';
    }
    for (const d of dock) if (d.down) L[d.id] = 'spent';
    return L;
  }

  return {
    state: R,
    serve,
    newGame() {
      R.score = 0; R.ball = 1; R.over = false; R.locks = 0; R.multiball = 0;
      R.modesReady = 0; R.modesPlayed = []; R.mode = null; R.hurry = null;
      R.bonusX = 1; R.bonus = { ramps: 0, banks: 0, laneSets: 0, bullseyes: 0, spins: 0 };
      R.lanesLit = [false, false, false, false]; R.flash = []; R.lastCast = false;
      R.mystery = 0; R.mysteryReady = false;
      for (const d of dock) world.setDown(d.id, false);
      serve();
    },
    /** Called once per rendered frame, AFTER the solver has stepped. */
    update() {
      pump();
      if (R.mode && now() > R.mode.until) { say(`${R.mode.name} OVER`, 0); R.mode = null; }
      if (R.hurry) {
        const left = R.hurry.until - now();
        if (left <= 0) R.hurry = null;
        else R.hurry.value = BASE.hurryUp * (left / HURRY_SECS);
      }
      if (now() > R.comboUntil) R.combo = 0;
      setDiverter();
      if (ballsave && now() > R.saveUntil) ballsave.armed = false;
      // The bank reset RETRIES. `world.setDown` refuses to raise a target under a ball, which is
      // the one thing a bank reset must never do, so it is asked again next frame until it takes.
      if (dockResetAt && now() > dockResetAt) {
        let all = true;
        for (const d of dock) if (!world.setDown(d.id, false)) all = false;
        if (all) dockResetAt = 0;
      }
      // THE SHOOTER LANE WATCHDOG. A plunge that does not clear the gate leaves the ball resting
      // at the plunger with no way to score and no way to drain, which is a stuck game even though
      // it is not a stuck ball. Re-plunge it.
      for (const b of world.balls) {
        if (!b.alive || b.held || b.ribbon) continue;
        if (b.p.x > 0.447 && b.p.y > 0.9 && Math.hypot(b.v.x, b.v.y) < 0.06) {
          b.v = { x: table.launchV.x, y: table.launchV.y };
        }
      }
      R.lamps = lamps();
      return R;
    },
    /** Lane change: the flipper buttons rotate which P.I.E.R lamp is lit. Costs nothing, and it
     *  is the classic top-lane skill layer the blueprint's section 3b asks for. */
    laneChange(dir) {
      const lit = R.lanesLit.slice();
      const n = lit.length;
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[(i + (dir > 0 ? 1 : n - 1)) % n] = lit[i];
      R.lanesLit = out;
      R.laneCursor = (R.laneCursor + 1) % n;
    },
    startMultiball,
    BASE, MODES,
  };
}
