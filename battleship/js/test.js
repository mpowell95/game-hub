// test.js - headless engine + fleet + AI + hash assertions (Node, no DOM, no dependencies).
//   node battleship/js/test.js
// Requires Node >= 22.7 (ESM syntax detection; there is no package.json), same as every other
// game's test.js in this repo.

import {
  SHIP_SETS, boardSizeFor, mulberry32, emptyFleet, shipCells, inBounds,
  placeShip, removeShip, isFleetComplete, legalPlacements, autoPlace,
} from './fleet.js';
import {
  CELL_UNKNOWN, CELL_MISS, CELL_HIT, CELL_SUNK, emptyShots, cellAt, newGame, setFleet,
  isShotLegal, resolveShot, applyAnswer, fireAndResolve, shipsAfloat,
} from './game.js';
import { chooseShot } from './ai.js';
import { stateHash } from './hash.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

// === fleet.js =================================================================================

// Placement legality at edges and overlap.
{
  const f0 = emptyFleet('classic');
  const carrier = SHIP_SETS.classic[0];
  const f1 = placeShip(f0, carrier, 0, 0, 'h');
  ok('fleet: in-bounds horizontal placement succeeds', !!f1 && f1.ships.length === 1);
  ok('fleet: off-the-edge placement rejected', placeShip(f0, carrier, 0, 6, 'h') === null);
  ok('fleet: vertical placement fitting exactly the last row succeeds', !!placeShip(f0, carrier, 5, 0, 'v'));
  ok('fleet: vertical placement one past the edge rejected', placeShip(f0, carrier, 6, 0, 'v') === null);

  const destroyer = SHIP_SETS.classic[4];
  ok('fleet: overlapping placement rejected', placeShip(f1, destroyer, 0, 2, 'h') === null);
  ok('fleet: touching (adjacent, non-overlapping) placement IS legal', !!placeShip(f1, destroyer, 1, 0, 'h'));
  ok('fleet: re-placing the SAME ship id does not collide with its own old cells', !!placeShip(f1, carrier, 0, 0, 'v'));
}

// Auto-place always produces a legal, complete fleet, across a few hundred seeds, both sizes.
{
  let allLegal = true, allComplete = true;
  for (let seed = 0; seed < 300; seed++) {
    const rng = mulberry32(seed);
    for (const sizeKey of ['classic', 'quick']) {
      const set = SHIP_SETS[sizeKey];
      const f = autoPlace(sizeKey, set, rng);
      if (!f) { allLegal = false; continue; }
      if (!isFleetComplete(f, set)) allComplete = false;
      if (!inBounds(f.size, f.ships.flatMap((s) => s.cells))) allLegal = false;
      // No two ships may share a cell (touching is fine).
      const seen = new Set();
      for (const s of f.ships) {
        for (const [r, c] of s.cells) {
          const k = `${r},${c}`;
          if (seen.has(k)) allLegal = false;
          seen.add(k);
        }
      }
    }
  }
  ok('fleet: autoPlace always produces an in-bounds, non-overlapping fleet (300 seeds x 2 sizes)', allLegal);
  ok('fleet: autoPlace always places every ship in the set', allComplete);
}

// legalPlacements respects blocked cells.
{
  const blocked = (r, c) => r === 2 && c === 2;
  const spots = legalPlacements(8, 3, blocked);
  ok('fleet: legalPlacements excludes every placement crossing a blocked cell',
    spots.every((p) => shipCells(3, p.r, p.c, p.dir).every(([r, c]) => !(r === 2 && c === 2))));
}

ok('fleet: removeShip drops exactly that ship', removeShip(placeShip(emptyFleet('quick'), SHIP_SETS.quick[0], 0, 0, 'h'), 'battleship').ships.length === 0);

// === game.js ===================================================================================

// resolveShot: miss / hit / sunk / fleetSunk transitions.
{
  const f = placeShip(emptyFleet('quick'), { id: 'destroyer', len: 2 }, 0, 0, 'h');
  const miss = resolveShot(f, 5, 5);
  ok('game: miss on empty water', miss.result === 'miss' && !miss.sunk && !miss.fleetSunk);
  const hit1 = resolveShot(f, 0, 0);
  ok('game: hit on a ship cell', hit1.result === 'hit' && hit1.shipId === 'destroyer' && !hit1.sunk);
  const hit2 = resolveShot(hit1.fleet, 0, 1);
  ok('game: second hit sinks a length-2 ship', hit2.sunk && hit2.fleetSunk);
  ok('game: sunk cells reported match the ship\'s own cells', JSON.stringify(hit2.cells.sort()) === JSON.stringify([[0, 0], [0, 1]]));
}

// applyAnswer: turn flip, bonus-shot chaining, fleetSunk -> over/winner.
{
  const size = boardSizeFor('quick');
  let s = newGame(size, 'quick', false, 0);
  const oppFleet = placeShip(emptyFleet('quick'), { id: 'destroyer', len: 2 }, 3, 3, 'h');
  s = setFleet(s, 1, oppFleet);
  const r1 = resolveShot(s.fleets[1], 9, 9);   // miss (out of ship bounds since size 8, use in-range miss)
  s = setFleet(s, 1, r1.fleet);
  const before = s.turn;
  s = applyAnswer(s, 1, 5, 5, { result: 'miss', shipId: null, sunk: false, fleetSunk: false });
  ok('game: a miss flips the turn to the defender', s.turn === 1 && before === 0);

  // Bonus-shot variant keeps the turn on a hit.
  let s2 = newGame(size, 'quick', true, 0);
  const f2 = placeShip(emptyFleet('quick'), { id: 'destroyer', len: 2 }, 0, 0, 'h');
  s2 = setFleet(s2, 1, f2);
  const hit = resolveShot(s2.fleets[1], 0, 0);
  s2 = setFleet(s2, 1, hit.fleet);
  s2 = applyAnswer(s2, 1, 0, 0, { result: 'hit', shipId: 'destroyer', sunk: false, fleetSunk: false });
  ok('game: bonusShotOnHit keeps the same shooter\'s turn on a hit', s2.turn === 0);

  // fleetSunk ends the match with the SHOOTER as winner, no draw possible.
  let s3 = newGame(size, 'quick', false, 0);
  const f3 = placeShip(emptyFleet('quick'), { id: 'destroyer', len: 1 }, 0, 0, 'h');
  s3 = setFleet(s3, 1, f3);
  const rr = fireAndResolve(s3, 1, 0, 0);
  ok('game: sinking the last ship ends the match with the shooter as winner', rr.state.over && rr.state.winner === 0);
}

// isShotLegal: can't fire at an already-fired-at cell, or once the match is over.
{
  const size = boardSizeFor('quick');
  let s = newGame(size, 'quick', false, 0);
  const f = placeShip(emptyFleet('quick'), { id: 'destroyer', len: 1 }, 0, 0, 'h');
  s = setFleet(s, 1, f);
  ok('game: a fresh cell is a legal shot', isShotLegal(s, 1, 3, 3));
  s = fireAndResolve(s, 1, 3, 3).state;
  ok('game: a re-fired cell is illegal', !isShotLegal(s, 1, 3, 3));
  ok('game: out-of-bounds is illegal', !isShotLegal(s, 1, -1, 0));
}

// shipsAfloat: derives remaining lengths from sunkIds only, no fleet needed.
{
  const shots = emptyShots(8);
  shots.sunkIds.push('destroyer');
  ok('game: shipsAfloat drops sunk ships and needs no fleet', JSON.stringify(shipsAfloat(SHIP_SETS.quick, shots)) === JSON.stringify([4, 3, 3]));
}

// === hash.js ====================================================================================

// Two independently-built states that received the same answer sequence hash identically, and the
// hash is unaffected by whichever fleet each side happens to hold (public state only).
{
  const size = boardSizeFor('quick');
  const seq = [[0, 0], [0, 1], [5, 5], [7, 7]];
  const fA = placeShip(emptyFleet('quick'), { id: 'destroyer', len: 2 }, 0, 0, 'h');
  const fB = placeShip(emptyFleet('quick'), { id: 'destroyer', len: 2 }, 0, 0, 'h');   // different object, same shape

  let host = newGame(size, 'quick', false, 0);
  host = setFleet(host, 1, fA);
  let guest = newGame(size, 'quick', false, 0);   // guest never holds seat 1's fleet in real MP; host resolves and both apply the SAME answer
  for (const [r, c] of seq) {
    const res = resolveShot(host.fleets[1], r, c);
    host = setFleet(host, 1, res.fleet);
    const answer = { result: res.result, shipId: res.shipId, sunk: res.sunk, fleetSunk: res.fleetSunk, cells: res.cells };
    host = applyAnswer(host, 1, r, c, answer);
    guest = applyAnswer(guest, 1, r, c, answer);
    if (host.over) break;
  }
  ok('hash: two independently-built states fed the same answer sequence hash identically',
    stateHash(host) === stateHash(guest));

  // Now give the two sides DIFFERENT (but equally shaped) fleets and confirm the hash is untouched.
  const hostWithFleetB = setFleet(host, 1, fB);
  ok('hash: swapping which fleet object a side holds never changes the hash (fleets are excluded)',
    stateHash(host) === stateHash(hostWithFleetB));

  // A state whose OTHER seat's fleet is entirely null (the real MP shape) still hashes the same as
  // one holding a real object there, because the hash never looks at fleets at all.
  const nulled = { ...host, fleets: [null, null] };
  ok('hash: a state with fleets:[null,null] hashes identically to one with real fleet objects',
    stateHash(host) === stateHash(nulled));
}

// === ai.js: no-cheat seam + all three tiers ====================================================

// Structural no-cheat: chooseShot never reads state.fleets. Proven by calling it with fleets
// deliberately [null, null] (this is exactly how a real MP defender's state looks to the AI code
// path in solo-vs-mixed testing) and confirming it still returns a legal shot every time.
{
  const size = boardSizeFor('classic');
  let allLegal = true;
  for (const diff of ['beginner', 'intermediate', 'pro']) {
    let s = { size, sizeKey: 'classic', bonusShotOnHit: false, turn: 0,
      fleets: [null, null], shots: [emptyShots(size), emptyShots(size)], shotCount: [0, 0], over: false, winner: null };
    const rng = mulberry32(7);
    for (let i = 0; i < 15; i++) {
      const shot = chooseShot(s, 1, SHIP_SETS.classic, diff, rng);
      if (!shot || !isShotLegal(s, 1, shot[0], shot[1])) { allLegal = false; break; }
      // Answer purely from the PUBLIC grid, no fleet consulted -- proves the AI needed nothing else.
      const isHit = (shot[0] + shot[1]) % 3 === 0;   // synthetic, deterministic answer, no fleet involved
      s = applyAnswer(s, 1, shot[0], shot[1], { result: isHit ? 'hit' : 'miss', shipId: null, sunk: false, fleetSunk: false });
    }
  }
  ok('ai: every tier returns a legal shot with fleets:[null,null] (structural no-cheat)', allLegal);
}

// Full solo playthroughs, every tier vs every tier, always terminate with a legal winner and no
// exceptions -- across both board sizes.
{
  let finished = 0, threw = false, total = 0;
  for (const sizeKey of ['classic', 'quick']) {
    const size = boardSizeFor(sizeKey);
    const shipSet = SHIP_SETS[sizeKey];
    for (const diffA of ['beginner', 'intermediate', 'pro']) {
      for (const diffB of ['beginner', 'intermediate', 'pro']) {
        total++;
        const seed = size * 1000 + diffA.length * 7 + diffB.length * 13;
        const rng = mulberry32(seed);
        let s = newGame(size, sizeKey, false, 0);
        const fA = autoPlace(sizeKey, shipSet, rng);
        const fB = autoPlace(sizeKey, shipSet, rng);
        s = setFleet(s, 0, fA);
        s = setFleet(s, 1, fB);
        try {
          let guard = 0;
          while (!s.over && guard++ < size * size * 2) {
            const shooter = s.turn, defender = 1 - s.turn;
            const diff = shooter === 0 ? diffA : diffB;
            const shot = chooseShot(s, defender, shipSet, diff, rng);
            if (!shot) break;
            const res = fireAndResolve(s, defender, shot[0], shot[1]);
            s = res.state;
          }
          if (s.over) finished++;
        } catch (err) { threw = true; console.error('  Battleship sim threw:', err); }
      }
    }
  }
  ok(`ai: every tier-pair x board-size match terminates (${finished}/${total})`, finished === total);
  ok('ai: no match threw', !threw);
}

// Pro beats Beginner decisively more often than the reverse (sanity on tier ordering), over enough
// games to not be noise-dominated. Not a tight bound -- just proves Pro is not worse than Easy.
{
  const sizeKey = 'quick';
  const size = boardSizeFor(sizeKey);
  const shipSet = SHIP_SETS[sizeKey];
  let proWins = 0, games = 40;
  for (let i = 0; i < games; i++) {
    const rng = mulberry32(9000 + i);
    let s = newGame(size, sizeKey, false, i % 2);   // alternate who opens
    s = setFleet(s, 0, autoPlace(sizeKey, shipSet, rng));
    s = setFleet(s, 1, autoPlace(sizeKey, shipSet, rng));
    let guard = 0;
    while (!s.over && guard++ < size * size * 2) {
      const shooter = s.turn, defender = 1 - s.turn;
      const diff = shooter === 0 ? 'pro' : 'beginner';
      const shot = chooseShot(s, defender, shipSet, diff, rng);
      if (!shot) break;
      s = fireAndResolve(s, defender, shot[0], shot[1]).state;
    }
    if (s.over && s.winner === 0) proWins++;
  }
  ok(`ai: Pro beats Beginner in most games (${proWins}/${games})`, proWins > games * 0.6);
}

console.log(`\nBattleship tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
