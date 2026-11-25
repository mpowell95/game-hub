// js/trip-wires/baseball.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'baseball-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// Baseball is admin only (devOnly); these rules are ready for its release.
//
// What they read: the career result recordBaseball(league, won, extras) (a = [league, won, {...}]) and its private log
// x (baseball/js/ui.js `_careerLog('end', ...)`): x.why, x.side ('home' | 'away', the player's team), x.you / x.them
// (runs), x.score { home, away }, x.ev (career-io.js compactEvents; the last is 'G<away>-<home>:<winner>:<reason>'),
// x.evCut, and from 2026-11-25 x.t0 + x.sw = the player's own swings [ms since t0, 1 = a bunt, timing word].

const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
const presses = (n) => n.ev.filter((q) => (q.kind === 'd' || q.kind === 'k') && !q.fake).length + (n.cut | 0);
const ended = (a, x) => Array.isArray(a) && typeof a[1] === 'boolean' && x && typeof x === 'object' && x.why === 'end';

export default [
  // PROVEN. baseball/js/engine/game.js _finalize is only ever called with the side AHEAD (walkoff, scheduled, the
  // extra-innings cap: 'tie' when level), and ui.js _onCareerGameEnd records won = (winner === the player's side).
  // So a win is always more runs than the other team, and a loss never is.
  { id: 'baseball-won-but-behind', proven: true, text: 'a win without more runs, or a loss with more runs',
    check(e, { a, x }) {
      if (!ended(a, x) || !Number.isFinite(Number(x.you)) || !Number.isFinite(Number(x.them))) return null;
      const you = Number(x.you), them = Number(x.them);
      return a[1] !== (you > them) ? { v: `${a[1] ? 'won' : 'lost'} ${you} to ${them}`, lim: '' } : null;
    } },
  // PROVEN. ui.js takes you / them from game.score[side] and the other side, and the engine's own gameEnd event
  // ('G<away>-<home>:...') carries the same score object. Logged numbers that disagree were not written by the game.
  { id: 'baseball-score-mismatch', proven: true, text: 'a final score that does not match the game itself',
    check(e, { a, x }) {
      if (!ended(a, x) || !x.score || (x.side !== 'home' && x.side !== 'away')) return null;
      const other = x.side === 'home' ? 'away' : 'home';
      if (Number(x.you) !== Number(x.score[x.side]) || Number(x.them) !== Number(x.score[other])) return { v: `${x.you}-${x.them}, game ${x.score.away}-${x.score.home}`, lim: '' };
      const g = Array.isArray(x.ev) ? x.ev.find((s) => typeof s === 'string' && /^G\d+-\d+:/.test(s)) : null;
      if (g) {
        const [aw, hm] = g.slice(1).split(':')[0].split('-').map(Number);
        if (aw !== Number(x.score.away) || hm !== Number(x.score.home)) return { v: `end event ${aw}-${hm}, score ${x.score.away}-${x.score.home}`, lim: '' };
      }
      return null;
    } },
  // PROVEN. ui.js HumanAgent: the player's swing is a tap on the batting pad, and a bunt is a press held on the bunt well
  // (_onBuntDown); nothing swings for the player. So the player's swings while the touch log ran cannot outnumber its
  // real presses (2 spare).
  { id: 'baseball-swings-without-taps', proven: true, text: 'more swings than real taps',
    check(e, { a, x, n }) {
      if (!n || !ended(a, x) || !Array.isArray(x.sw) || !(Number(x.t0) > 0)) return null;
      const t0 = Number(x.t0);
      const acts = x.sw.filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && t0 + q[0] >= n.t0).length;
      const p = presses(n);
      return acts >= 3 && acts > p + 2 ? { v: `${acts} swings, ${p} presses`, lim: p + 2 } : null;
    } },
  // SUSPICIOUS. 'perfect' timing is a window of a few tens of ms around the pitch's arrival (settings.js
  // FEEL.engine.perfectMs); a person misses it often. 95% perfect over 25+ timed swings in a game looks like a script.
  { id: 'baseball-perfect-timing', proven: false, text: 'almost every swing perfectly timed',
    check(e, { a, x }) {
      if (!ended(a, x) || !Array.isArray(x.sw)) return null;
      const timed = x.sw.filter((q) => Array.isArray(q) && q[1] === 0 && typeof q[2] === 'string');
      if (timed.length < 25) return null;
      const perfect = timed.filter((q) => q[2] === 'perfect').length;
      return perfect / timed.length >= 0.95 ? { v: `${perfect} of ${timed.length} perfect`, lim: '95%' } : null;
    } },
  // SUSPICIOUS (kept apart from the timing word): swings in a game whose gaps barely vary. A person's swings are
  // seconds apart and uneven; 20+ swings whose gaps all fall within 50 ms of the middle gap look like a timer.
  { id: 'baseball-machine-rhythm', proven: false, text: 'swings at a machine-steady rhythm',
    check(e, { a, x }) {
      if (!ended(a, x) || !Array.isArray(x.sw)) return null;
      const t = x.sw.filter((q) => Array.isArray(q) && Number.isFinite(q[0])).map((q) => q[0]);
      if (t.length < 21) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]), md = median(gaps);
      return gaps.every((g) => Math.abs(g - md) <= 50) ? { v: `${gaps.length} gaps within 50 ms of ${md} ms`, lim: 50 } : null;
    } },
];
