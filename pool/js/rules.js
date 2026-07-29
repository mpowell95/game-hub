// rules.js — pure 8-ball rule engine (no DOM, no physics stepping). Standard
// 8-ball ball-in-hand (visual rebuild, 2026-07-29, spec §13.5 / handoff §6.4):
// ball-in-hand after any ordinary foul is anywhere on the table; ONLY a
// scratch on the very first shot (the break) restricts it to behind the head
// string (screen u < 0.25, i.e. physics y < HEAD_SPOT.y). Every other foul,
// including a scratch on any later shot, stays anywhere. This replaces v1's
// "Bar Rules 8-Ball" (ball-in-hand anywhere, always) — see pool/CLAUDE.md.
import { rackBalls, ballById } from './table.js';

export function newGame() {
  return {
    balls: rackBalls(),
    turnSeat: 0,           // seat to move next (0 or 1)
    groups: { 0: null, 1: null },   // 'solid' | 'stripe' | null (open table)
    openTable: true,
    ballInHand: false,     // shooter must place the cue ball before shooting
    over: false,
    winner: null,
    lastFoul: null,        // last foul reason, for UI toast; cleared each shot
    broken: false,
    headStringRestricted: false, // true only for ball-in-hand right after a scratch on the break
  };
}

function kindOf(balls, id) {
  const b = ballById(balls, id);
  return b ? b.kind : null;
}

function firstCueContactKind(state, events) {
  for (const h of events.hits) {
    if (h.a === 'cue' || h.b === 'cue') {
      const otherId = h.a === 'cue' ? h.b : h.a;
      return kindOf(state.balls, otherId);
    }
  }
  return null;
}

function pottedKinds(state, events) {
  return events.pocketed.map((id) => ({ id, kind: id === 'cue' ? 'cue' : kindOf(state.balls, id) }));
}

function remainingOfKind(balls, kind) {
  return balls.filter((b) => b.kind === kind && !b.pocketed).length;
}

/** What the current shooter (seat) is legally allowed to hit first. */
export function legalTarget(state, seat) {
  if (state.openTable) return { allowEight: false, kinds: ['solid', 'stripe'] };
  const mine = state.groups[seat];
  const remaining = remainingOfKind(state.balls, mine);
  return { allowEight: remaining === 0, kinds: [mine] };
}

/** Apply the outcome of one fully-settled shot. `events` is physics.js's
 *  simulateToRest() event log; `cueScratched` is whether the cue ball itself was
 *  pocketed (already reflected in events.pocketed but flagged explicitly since the
 *  caller resets/replaces the cue ball object once removed from the sim). Returns a
 *  NEW state (pure) plus an outcome summary for the UI/stats. */
export function resolveShot(state, events) {
  const seat = state.turnSeat;
  const opp = seat === 0 ? 1 : 0;
  const isBreakShot = !state.broken; // state.broken reflects the shot BEFORE this one
  const st = {
    ...state,
    balls: state.balls.map((b) => ({ ...b })),
    groups: { ...state.groups },
  };
  const potted = pottedKinds(state, events);
  const cueScratched = potted.some((p) => p.kind === 'cue');
  const eightPotted = potted.some((p) => p.id === 'b8');
  const legal = legalTarget(state, seat);
  const firstKind = firstCueContactKind(state, events);

  let foul = false;
  let foulReason = null;
  if (cueScratched) { foul = true; foulReason = 'scratch'; }
  else if (firstKind === null) { foul = true; foulReason = 'no_contact'; }
  else if (firstKind === 'eight' && !legal.allowEight) { foul = true; foulReason = 'wrong_ball_eight'; }
  else if (firstKind !== 'eight' && legal.kinds.indexOf(firstKind) < 0) { foul = true; foulReason = 'wrong_ball'; }
  else if (potted.length === 0 && events.rails === 0) { foul = true; foulReason = 'no_rail'; }

  // Group assignment: the first legal, non-foul pot of a money ball (not the 8)
  // while the table is open decides both players' groups.
  if (st.openTable && !foul) {
    const firstMoneyPot = potted.find((p) => p.kind === 'solid' || p.kind === 'stripe');
    if (firstMoneyPot) {
      st.groups[seat] = firstMoneyPot.kind;
      st.groups[opp] = firstMoneyPot.kind === 'solid' ? 'stripe' : 'solid';
      st.openTable = false;
    }
  }

  let gameOver = false, winner = null;
  if (eightPotted) {
    const clearedOwnGroup = !st.openTable && remainingOfKind(state.balls, st.groups[seat]) === 0;
    if (foul || !clearedOwnGroup) { gameOver = true; winner = opp; }
    else { gameOver = true; winner = seat; }
  }

  // Sync pocketed flags onto the returned state's ball list.
  for (const p of potted) {
    const b = ballById(st.balls, p.id);
    if (b) b.pocketed = true;
  }
  // The cue ball is never left "pocketed" in the persisted state — it comes back
  // into play via ball-in-hand; scrub the flag and park it off-table until placed.
  const cue = ballById(st.balls, 'cue');
  if (cue && cueScratched) { cue.pocketed = false; cue.vx = 0; cue.vy = 0; cue.wx = 0; cue.wy = 0; cue.wz = 0; }

  const pottedOwn = !st.openTable && potted.some((p) => p.kind === st.groups[seat]);
  const wasOpenPot = state.openTable && potted.some((p) => p.kind === 'solid' || p.kind === 'stripe');
  const continues = !foul && !gameOver && (pottedOwn || wasOpenPot);

  st.turnSeat = gameOver ? seat : (continues ? seat : opp);
  st.ballInHand = !gameOver && (foul || cueScratched);
  // Spec §13.5: restricted to behind the head string ONLY for a scratch on
  // the break; every other foul (including a scratch on a later shot) is
  // ball-in-hand anywhere.
  st.headStringRestricted = st.ballInHand && cueScratched && isBreakShot;
  st.over = gameOver;
  st.winner = gameOver ? winner : null;
  st.lastFoul = foulReason;
  st.broken = true;
  return {
    state: st,
    outcome: { foul, foulReason, potted, gameOver, winner, turnPassed: st.turnSeat !== seat || gameOver, cueScratched },
  };
}

/** Place the cue ball (ball-in-hand). Caller (UI) is responsible for keeping (x,y)
 *  off every other ball and inside the cushions; this just writes the position. */
export function placeCueBall(state, x, y) {
  const st = { ...state, balls: state.balls.map((b) => ({ ...b })), ballInHand: false };
  const cue = ballById(st.balls, 'cue');
  cue.x = x; cue.y = y; cue.vx = 0; cue.vy = 0; cue.wx = 0; cue.wy = 0; cue.wz = 0; cue.pocketed = false;
  return st;
}
