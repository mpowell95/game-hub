// air-hockey/js/live.js - real-time play over Firebase (brief §5). Stage 3 (2026-09-27) built it
// for the LATENCY TEST (net-test.html); stage 4 (2026-09-28) plays real matches on it (ui.js).
//
// Nothing else in this repo is real-time: js/net.js sends a lockstep move log for turn games. So
// this stays inside air-hockey/ (the brief: no real-time layer in js/net.js without Matt's okay).
// The lobby (create / join by code / heartbeat / leave) IS js/net.js, as every other game.
//
// THE CHANNEL: rooms/<CODE>/ah/s0 and rooms/<CODE>/ah/s1. Each phone overwrites its own node about
// SEND_HZ times a second with one small object and listens to the other's. `rooms` already allows
// any signed-in write, so no rules change and nothing for Matt to publish. The room's own TTL and
// `status: 'ended'` cover clean-up, as for every other game's room.
//
// THE MODEL (brief §5):
//   - Each phone runs ITS OWN mallet locally, so your own mallet never lags.
//   - Whoever's half the puck is in OWNS it: runs its physics, decides goals against itself, and
//     sends it. When the puck crosses the centre line the owner hands over (`o` = the other side,
//     `h` + 1) and stops simulating; the other phone takes over from that state, advanced by half
//     the measured round trip.
//   - The phone that does NOT own the puck shows a GHOST: the last received puck state, stepped
//     forward with the real table physics (walls, the other mallet) between messages, with any
//     jump on a new message smoothed away over ~0.1 s rather than snapped.
//   - A goal is decided ONLY by the phone that was scored on (it owns the puck: it is in its
//     half), which writes the new score with a goal number `g`, so a goal is never counted twice.
//
// Positions on the wire are in the HOST's frame (host at the bottom). Each phone simulates in its
// own frame (itself at the bottom, mallets[0]); the guest turns the table 180 degrees both ways.

import { getStatsApp } from '../../js/firebase-boot.js';
import { TABLE, PHYS, createMatch, resetMatch, advance, clampTarget } from './physics.js';

const { W, H } = TABLE;
export const SEND_HZ = 20;
const PING_EVERY_MS = 500;
const RING = 128;

/** A fixed-size ring of numbers with median / percentile / max, allocation-free after creation. */
function ring() {
  const a = new Float64Array(RING); let n = 0, i = 0;
  const tmp = new Float64Array(RING);
  return {
    push(v) { a[i] = v; i = (i + 1) % RING; if (n < RING) n++; },
    get n() { return n; },
    pct(p) {
      if (!n) return NaN;
      for (let k = 0; k < n; k++) tmp[k] = a[k];
      const s = tmp.subarray(0, n).sort();
      return s[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))];
    },
    max() { let m = -Infinity; for (let k = 0; k < n; k++) if (a[k] > m) m = a[k]; return n ? m : NaN; },
    reset() { n = 0; i = 0; },
  };
}

/** Open the channel for `side` (0 host, 1 guest). Resolves to null when Firebase is unreachable. */
export async function openChannel(code, side, onPeer) {
  const r = await getStatsApp();
  if (!r) return null;
  const { db, api } = r;
  const mine = api.ref(db, `rooms/${code}/ah/s${side}`);
  const theirs = api.ref(db, `rooms/${code}/ah/s${1 - side}`);
  const stop = api.onValue(theirs, (snap) => { const v = snap.val(); if (v) onPeer(v, performance.now()); });
  let failed = 0;
  return {
    send(msg) {
      api.set(mine, msg).catch((err) => { if (!failed++) console.warn('[airhockey] live write failed', err); });
    },
    get failed() { return failed; },
    close() { try { stop(); } catch { /* already detached */ } },
  };
}

/** One online match on this phone. `match` is a physics.js match in THIS phone's frame; the caller
 *  moves match.mallets[0] (finger or robot) and calls frame(dt, now) once per rendered frame.
 *
 *  ROUNDS (stage 4): a rematch is a new ROUND (`rd`). Each phone asks for round rd + 1 in its own
 *  messages (`r`); a phone starts it only once it has asked AND seen the other ask, so both start
 *  the same round from the same rule: the LOSER of the last match serves. Puck and score fields
 *  from another round are ignored, and the counters `h` and `g` never go back down.
 *
 *  hooks: onGoal(scorer)   scorer 0 = me, 1 = them; the score is already updated
 *         onOver(winner)   the first time this round reaches WIN on this phone
 *         onRound()        a new round has started (after a rematch)
 */
export function createLiveSession(match, side, channel, hooks = {}) {
  const other = 1 - side;
  const flip = side === 1;
  const X = (x) => (flip ? W - x : x);            // local <-> shared, x
  const Y = (y) => (flip ? H - y : y);            // local <-> shared, y
  const V = (v) => (flip ? -v : v);               // local <-> shared, velocity

  const ghost = createMatch();
  ghost.phase = 'play';
  const out = {};                                  // reused outgoing message (no per-send allocation)
  const S = {
    own: side === 0,                               // the host serves the first round
    rd: 1,                                         // round (a rematch is the next round)
    want: 0,                                       // the round I have asked for (rematch)
    peerWant: 0,
    overSent: false,
    h: 0,                                          // handoff counter (shared, only goes up)
    g: 0,                                          // goal counter (shared, only goes up)
    q: 0,
    lastSend: 0,
    lastRecv: 0,
    peerSeen: false,
    peerQ: -1,
    pingId: 0, pingAt: 0, pingSentAt: 0,
    echoId: -1, echoAt: 0,
    rttEst: 150,                                   // ms, smoothed; used for prediction until measured
    cx: 0, cy: 0,                                  // display correction offset, decays to 0
    peerLive: 0,                                   // is the puck on their screen (0 until told)
    handoffs: 0,
    // The puck as I handed it over (shared frame) and when, kept and RE-SENT on every message
    // until the other phone's messages show it took it. A single handoff message can be
    // overtaken by the next write (the channel is a value, not a queue), and a lost handoff would
    // leave the puck owned by nobody.
    hx: 0, hy: 0, hvx: 0, hvy: 0, hAt: 0,
  };
  const stats = { rtt: ring(), gap: ring(), jump: ring(), msgs: 0, takeovers: 0 };
  match.puckRemote = !S.own;
  if (!S.own) match.puck.live = false;

  function oneWay() { return Math.min(0.25, S.rttEst / 2000); }

  function send(now) {
    const m = match.mallets[0], p = match.puck;
    out.q = ++S.q;
    out.rd = S.rd; out.r = S.want;
    out.mx = X(m.x); out.my = Y(m.y); out.mvx = V(m.vx); out.mvy = V(m.vy);
    out.o = S.own ? side : other;
    out.h = S.h;
    if (S.own) { out.px = X(p.x); out.py = Y(p.y); out.pvx = V(p.vx); out.pvy = V(p.vy); out.pl = p.live ? 1 : 0; out.ha = 0; }
    else if (S.hAt) { out.px = S.hx; out.py = S.hy; out.pvx = S.hvx; out.pvy = S.hvy; out.pl = 1; out.ha = now - S.hAt; }
    else { out.px = null; out.py = null; out.pvx = null; out.pvy = null; out.pl = null; out.ha = null; }
    out.g = S.g;
    out.s0 = side === 0 ? match.score[0] : match.score[1];
    out.s1 = side === 0 ? match.score[1] : match.score[0];
    if (now - S.pingSentAt >= PING_EVERY_MS) { S.pingId++; S.pingSentAt = now; }
    out.pi = S.pingId; out.pt = S.pingSentAt;
    out.ai = S.echoId; out.at = S.echoAt;
    channel.send(out);
    S.lastSend = now;
  }

  /** Put a received (shared-frame) puck state into `dst`, local frame. */
  function puckFrom(msg, dst) {
    dst.puck.x = X(msg.px); dst.puck.y = Y(msg.py);
    dst.puck.vx = V(msg.pvx); dst.puck.vy = V(msg.pvy);
    dst.puck.live = msg.pl !== 0;
  }
  function syncGhostMallets() {
    for (let i = 0; i < 2; i++) {
      const a = match.mallets[i], b = ghost.mallets[i];
      b.x = b.tx = b.fx = a.x; b.y = b.ty = b.fy = a.y; b.vx = a.vx; b.vy = a.vy;
    }
  }
  function stepGhost(dt) {
    syncGhostMallets();
    ghost.phase = 'play'; ghost.puckRemote = false; ghost.acc = 0;
    ghost.ev.hit = 0; ghost.ev.wall = 0;
    advance(ghost, dt);                             // the ghost's own goals mean nothing
    ghost.score[0] = ghost.score[1] = 0;
  }

  function checkOver() {
    if (S.overSent) return;
    const [a, b] = match.score;
    if (a >= PHYS.WIN || b >= PHYS.WIN) {
      S.overSent = true;
      match.phase = 'over'; match.winner = a >= PHYS.WIN ? 0 : 1; match.puck.live = false;
      if (hooks.onOver) hooks.onOver(match.winner);
    }
  }

  /** Both phones have asked for the next round: start it. The loser of the last one serves. */
  function startRound(now) {
    const server = match.winner === 0 ? other : side;   // shared side of the loser
    S.rd++; S.overSent = false;
    resetMatch(match, server === side ? 0 : 1);
    S.own = server === side;
    match.puckRemote = !S.own;
    if (!S.own) match.puck.live = false;
    S.hAt = 0; S.cx = S.cy = 0; S.peerLive = 0;
    if (hooks.onRound) hooks.onRound();
    send(now);
  }

  function onPeer(msg, now) {
    stats.msgs++;
    if (S.peerSeen) stats.gap.push(now - S.lastRecv);
    S.lastRecv = now; S.peerSeen = true;
    if (msg.q <= S.peerQ) return;                  // stale or duplicate
    S.peerQ = msg.q;

    // Round trip: my ping, echoed back, timed on MY clock only (no clock sync needed).
    if (msg.ai === S.pingId && msg.at === S.pingSentAt && S.pingAt !== S.pingId) {
      const rtt = now - S.pingSentAt;
      S.pingAt = S.pingId;
      stats.rtt.push(rtt);
      S.rttEst = S.rttEst * 0.8 + rtt * 0.2;
    }
    if (msg.pi !== S.echoId) { S.echoId = msg.pi; S.echoAt = msg.pt; }

    // Their mallet: aim a little ahead by its velocity; physics moves it (speed-capped, smooth).
    const ahead = oneWay();
    const rm = match.mallets[1];
    clampTarget(rm, X(msg.mx) + V(msg.mvx) * ahead, Y(msg.my) + V(msg.mvy) * ahead);
    if (msg.h > S.h) S.h = msg.h;

    // Rematch handshake.
    S.peerWant = msg.r | 0;
    if (match.phase === 'over' && S.want === S.rd + 1 && S.peerWant === S.rd + 1) { startRound(now); return; }
    if ((msg.rd | 0) !== S.rd) return;             // anything else from another round is stale

    // Score: only ever moves forward, and only from the goal counter.
    if (msg.g > S.g) {
      S.g = msg.g;
      match.score[0] = side === 0 ? msg.s0 : msg.s1;
      match.score[1] = side === 0 ? msg.s1 : msg.s0;
      if (hooks.onGoal) hooks.onGoal(0);           // they were scored on: I scored
      checkOver();
    }

    // They have my handover: stop re-sending it.
    if (S.hAt && msg.o === other && msg.h >= S.h) S.hAt = 0;

    if (!S.own && msg.o === side && msg.h >= S.h && msg.px != null && match.phase !== 'over') {
      // Handed to me. Their handover state, stepped forward by how old it was when they sent it
      // plus half the round trip...
      const gx = match.puck.x, gy = match.puck.y, shown = match.puck.live;
      puckFrom(msg, ghost); stepGhost(Math.min(0.5, ahead + (msg.ha || 0) / 1000));
      const d = Math.hypot(ghost.puck.x - gx, ghost.puck.y - gy);
      // ...unless the puck I have been SHOWING is close to it: then carry on from what the player
      // saw (no jump at all). My ghost has run the same table physics from their states, so near
      // agreement is the normal case; a big gap means their mallet hit it before it crossed.
      if (!(shown && d < 90)) {
        match.puck.x = ghost.puck.x; match.puck.y = ghost.puck.y;
        match.puck.vx = ghost.puck.vx; match.puck.vy = ghost.puck.vy;
      }
      stats.jump.push(shown && d < 90 ? 0 : d);
      match.puck.live = true;
      match.stuckHalf = -1; match.stuckT = 0;
      stats.takeovers++;
      S.cx = S.cy = 0;
      S.own = true; match.puckRemote = false;
      send(now);
      return;
    }
    if (!S.own && msg.px != null) {
      // Keep the ghost on their authoritative state; fold the jump into a decaying offset.
      const wasLive = S.peerLive && ghost.puck.live;
      const oldX = ghost.puck.x + S.cx, oldY = ghost.puck.y + S.cy;
      puckFrom(msg, ghost); stepGhost(ahead);
      S.cx = oldX - ghost.puck.x; S.cy = oldY - ghost.puck.y;
      if (!wasLive || Math.hypot(S.cx, S.cy) > 120) S.cx = S.cy = 0;   // a serve or a reset: jump
      S.peerLive = msg.pl;
    }
  }

  /** One rendered frame. `frozen` (the other phone has gone quiet): send only, move nothing. */
  function frame(dt, now, frozen) {
    if (!frozen && match.phase !== 'over') {
      if (S.own) {
        match.puckRemote = false;
        match.ev.goal = -1;
        advance(match, dt);
        if (match.ev.goal === 1) {
          // Scored on: this phone decides it. physics.js already added the point and serves to
          // me after the pause (the scored-on player serves), so I stay the owner.
          S.g++;
          if (hooks.onGoal) hooks.onGoal(1);
          send(now);
          checkOver();
        } else if (match.puck.live && match.phase === 'play' && match.puck.y < H / 2) {
          // Crossed into their half: hand it over and stop simulating it.
          const p = match.puck;
          S.hx = X(p.x); S.hy = Y(p.y); S.hvx = V(p.vx); S.hvy = V(p.vy); S.hAt = now;
          S.own = false; S.h++; S.handoffs++;
          S.peerLive = 1;
          send(now);
          ghost.puck.x = p.x; ghost.puck.y = p.y; ghost.puck.vx = p.vx; ghost.puck.vy = p.vy; ghost.puck.live = true;
          S.cx = S.cy = 0;
          match.puckRemote = true;
        }
      } else {
        match.puckRemote = true;
        advance(match, dt);                         // mallets only
        if (S.peerLive) {
          stepGhost(dt);
          if (ghost.ev.hit > match.ev.hit) match.ev.hit = ghost.ev.hit;     // their hits still clack
          if (ghost.ev.wall > match.ev.wall) match.ev.wall = ghost.ev.wall;
        }
        const k = Math.exp(-dt / 0.1);
        S.cx *= k; S.cy *= k;
        match.puck.x = ghost.puck.x + S.cx; match.puck.y = ghost.puck.y + S.cy;
        match.puck.vx = ghost.puck.vx; match.puck.vy = ghost.puck.vy;
        match.puck.live = !!S.peerLive && ghost.puck.live;
        // No clamp at the centre line: the ghost carries on into my half so the puck never
        // pauses there waiting for the handover; the takeover then continues from it.
      }
    }
    if (now - S.lastSend >= 1000 / SEND_HZ) send(now);
  }

  return {
    onPeer, frame, stats,
    /** Ask for a rematch (the next round). It starts when both phones have asked. */
    rematch(now) { S.want = S.rd + 1; send(now); if (S.peerWant === S.want && match.phase === 'over') startRound(now); },
    get peerWantsRematch() { return match.phase === 'over' && S.peerWant === S.rd + 1; },
    get wantsRematch() { return S.want === S.rd + 1; },
    get owns() { return S.own; },
    get handoffs() { return S.handoffs; },
    get heard() { return S.peerSeen; },
    get sinceHeard() { return S.peerSeen ? performance.now() - S.lastRecv : Infinity; },
  };
}
