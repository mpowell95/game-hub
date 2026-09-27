// air-hockey/js/net-test.js - the stage 3 LATENCY TEST page (net-test.html). Two phones join one
// room; each runs a robot mallet (or your finger) on its own side, and the puck is passed back
// and forth through js/live.js exactly as live play would do it. The numbers on screen are what
// decides whether live online play is worth building (brief §5, stage 3).
//
// Also driven headless by the stage 3 session (two browser contexts on one machine) for a
// baseline; `window.__ahNetTest` exposes the numbers for that.

import { TABLE, createMatch, resetMatch, clampTarget } from './physics.js';
import { createCpu, cpuThink } from './ai.js';
import { createRenderer } from './render.js';
import { openChannel, createLiveSession } from './live.js';
import * as net from '../../js/net.js';
import { loadProfile } from '../../js/profile-store.js';
import { deviceId } from '../../js/game-stats.js';
import { getStatsApp } from '../../js/firebase-boot.js';
import { onViewportResize } from '../../js/viewport.js';

const { H } = TABLE;
const $ = (id) => document.getElementById(id);

export function start() {
  const canvas = document.querySelector('canvas');
  const stageEl = $('stage');
  const renderer = createRenderer(canvas);
  const match = createMatch();
  resetMatch(match, 0);
  let session = null, channel = null, code = null, side = -1, robot = true, cpu = createCpu('medium', 0, 7);
  let raf = 0, last = 0, startedAt = 0, dragId = null, stopGuest = null;
  const status = (s) => { $('status').textContent = s; };

  const layout = () => {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (w && h) renderer.layout(w - 8, h - 8, true);
    renderer.render(match, 0);
  };
  onViewportResize(layout);
  layout();

  function me() {
    const p = loadProfile() || {};
    return { name: p.name || 'Player', avatar: p.emoji || '', deviceId: deviceId() };
  }

  async function begin(c, s) {
    code = c; side = s;
    channel = await openChannel(code, side, (msg, now) => session && session.onPeer(msg, now));
    if (!channel) { status('Could not reach the server.'); return; }
    resetMatch(match, side === 0 ? 0 : 1);
    session = createLiveSession(match, side, channel, {});
    net.heartbeat(code, side === 0 ? 'host' : 'guest');
    $('lobby').hidden = true; $('robot').hidden = false;
    startedAt = performance.now();
    status(`Room ${code}: ${side === 0 ? 'host (bottom)' : 'guest'}`);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  $('create').onclick = async () => {
    status('Creating...');
    const r = await net.createRoom('airhockey-test', {}, me());
    if (r.error) { status('Could not create a room (' + r.error + ').'); return; }
    status(`Room ${r.code}: waiting for the other phone to join...`);
    $('code').value = r.code;
    const app = await getStatsApp();
    const ref = app.api.ref(app.db, `rooms/${r.code}/guest`);
    stopGuest = app.api.onValue(ref, (snap) => {
      if (snap.val() && !session) begin(r.code, 0);
    });
  };
  $('join').onclick = async () => {
    const c = $('code').value.trim().toUpperCase();
    if (c.length !== 4) { status('Type the 4-letter code first.'); return; }
    status('Joining...');
    const r = await net.joinRoom(c, me());
    if (r.error) { status('Could not join (' + r.error + ').'); return; }
    begin(c, 1);
  };
  $('robot').onclick = () => { robot = !robot; $('robot').textContent = 'Robot: ' + (robot ? 'on' : 'off'); };

  // Finger: anywhere in your half, mallet just above it (as the real game).
  stageEl.addEventListener('pointerdown', (e) => {
    if (!session) return;
    dragId = e.pointerId; robot = false; $('robot').textContent = 'Robot: off';
    try { stageEl.setPointerCapture(e.pointerId); } catch { /* fine */ }
    aim(e);
  });
  stageEl.addEventListener('pointermove', (e) => { if (e.pointerId === dragId) aim(e); });
  stageEl.addEventListener('pointerup', (e) => { if (e.pointerId === dragId) dragId = null; });
  function aim(e) {
    const r = canvas.getBoundingClientRect();
    const p = renderer.toTable(e.clientX - r.left, e.clientY - r.top);
    clampTarget(match.mallets[0], p.x, p.y - (e.pointerType === 'mouse' ? 0 : 34 / (renderer.scale || 1)));
  }

  const f0 = (v) => (Number.isFinite(v) ? v.toFixed(0) : '-');
  function numbers() {
    const st = session.stats;
    const heard = session.sinceHeard;
    return {
      rttMedian: st.rtt.pct(0.5), rttP90: st.rtt.pct(0.9), rttMax: st.rtt.max(), pings: st.rtt.n,
      gapMedian: st.gap.pct(0.5), gapP95: st.gap.pct(0.95), gapMax: st.gap.max(), msgs: st.msgs,
      jumpMedian: st.jump.pct(0.5), jumpMax: st.jump.max(), takeovers: st.takeovers,
      handoffs: session.handoffs, sinceHeard: heard, writeFailures: channel.failed,
      seconds: (performance.now() - startedAt) / 1000,
    };
  }
  window.__ahNetTest = { numbers: () => (session ? numbers() : null) };

  let lastText = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    let dt = Math.max(0, (now - last) / 1000); last = now;
    if (dt > 0.05) dt = 0.05;
    if (robot) cpuThink(match, cpu, dt);
    session.frame(dt, now);
    renderer.render(match, 0);
    if (now - lastText > 250) {
      lastText = now;
      const n = numbers();
      $('nums').textContent =
        `round trip ms  median ${f0(n.rttMedian)}  p90 ${f0(n.rttP90)}  max ${f0(n.rttMax)}\n` +
        `update gap ms  median ${f0(n.gapMedian)}  p95 ${f0(n.gapP95)}  max ${f0(n.gapMax)}\n` +
        `catch-up jump  median ${f0(n.jumpMedian)}  max ${f0(n.jumpMax)}  (puck 44)\n` +
        `passes ${n.handoffs + n.takeovers}  heard ${f0(n.sinceHeard)} ms ago  fails ${n.writeFailures}  ${f0(n.seconds)} s`;
    }
  }

  addEventListener('pagehide', () => {
    if (stopGuest) try { stopGuest(); } catch { /* fine */ }
    if (channel) channel.close();
    if (code) net.leaveRoom(code, side === 0 ? 'host' : 'guest');
    cancelAnimationFrame(raf);
  });
}
