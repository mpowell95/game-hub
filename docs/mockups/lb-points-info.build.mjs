// Builds the (i) points-sheet mockup v6 (docs/HANDOFF-LB-POINTS-INFO.md). Run from anywhere: node docs/mockups/lb-points-info.build.mjs (writes the current version, v7)
// Builds the (i) points-sheet mockup v6 for all 20 wins games, EN + ES.
// Every number comes from main's real js/lb-points.js (pointsForWin) with the record-time "one level down"
// rule applied by hand per option (js/lb-rules.js / each game's statsDiff), plus the two fixes the handoff
// orders (Cup Pong no reracks x2 at every level; Darts Cricket in order x2), which are reported separately.
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const MAIN = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[3] || path.join(MAIN, 'docs', 'mockups', 'lb-points-info-v7.html');
const imp = (p) => import(pathToFileURL(path.join(MAIN, p)).href);
const { pointsForWin, pointsTable, gamePoints, CAP } = await imp('js/lb-points.js');
const { diffShapeSVG, tierOf } = await imp('js/difficulty-tiers.js');
const { GAME_ART } = await imp('js/game-art.js');
const { STRINGS } = await imp('js/strings.js');

const L3 = ['easy', 'medium', 'hard'];
const down = (d) => L3[Math.max(0, L3.indexOf(d) - 1)];
const LVW = { en: { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' }, es: { 1: 'Fácil', 2: 'Normal', 3: 'Difícil', 4: 'Experto' } };

// The two fixes the handoff orders for the build (not in main's code yet).
const PLANNED = (id, t, mode, v) => {
  const lv = pointsTable(id).lv;
  if (id === 'cuppong' && mode && String(mode.rr) === '0') return lv[t - 1] * 2;
  if (id === 'darts' && mode && String(mode.kind || '').startsWith('cricket-order')) return lv[t - 1] * 2;
  return v;
};
const diffs = [];   // rows where the mockup shows the planned value, not main's

// Is this row under the 20-point limit? Asked of the real gamePoints, never of the level alone (v6 marked Tic Tac Toe
// Ultimate Easy/Medium as limited: gamePoints counts Ultimate wins outside the limit). 100 wins of exactly this kind:
// recorded at recDiff (byDiff), saved with this mode at the setup level rawDiff (byMode, as withMode stores it).
const W = 100;
function codeSays(id, recDiff, rawDiff, mode) {
  const gm = { total: { won: W }, byDiff: { [recDiff]: { won: W } } };
  if (mode) gm.byMode = { [Object.entries(mode).map(([k, v]) => `${k}=${v}`).join('|')]: { [rawDiff]: { won: W } } };
  const pts = gamePoints(gm, id).pts;
  return { pts, perWin: pts / W };
}
// A row: { tier (1-4 shape, or 0), label {en,es}, pts, cap }
function lvRow(id, tier, recDiff, mode, rawDiff = recDiff) {
  const code = pointsForWin(id, recDiff, mode || undefined);
  const pts = PLANNED(id, tier, mode, code);
  const g = codeSays(id, recDiff, rawDiff, mode);
  const cap = g.pts < W * code;
  if (cap && g.pts !== CAP) throw new Error(`${id} ${tier}: limited, but ${W} wins give ${g.pts}`);
  if (!cap && g.perWin !== code) throw new Error(`${id} ${tier} ${JSON.stringify(mode)}: pointsForWin ${code}, gamePoints ${g.perWin} a win`);
  if (pts !== code) diffs.push(`${id} ${JSON.stringify(mode)} ${LVW.en[tier]}: main ${code}, mockup ${pts}`);
  return { tier, label: { en: `Win on ${LVW.en[tier]}`, es: `Victoria en ${LVW.es[tier]}` }, pts, cap };
}
const levels = (id, opt = {}) => {
  const n = pointsTable(id).lv.length;
  const out = [];
  for (let t = 1; t <= n; t++) {
    const d = t === 4 ? 'expert' : L3[t - 1];
    out.push(lvRow(id, t, opt.short ? down(d) : d, opt.mode, d));
  }
  return out;
};
const T = (en, es) => ({ en, es });
const TAG = {
  s: T('Shorter', 'Más corta'), n: T('Normal', 'Estándar'), l: T('Longer', 'Más larga'),
  e: T('Easier', 'Más fácil'), h: T('Harder', 'Más difícil'),
};
// card kinds: tone s (easier/shorter), n (normal), h (harder/longer), x (neutral)
const opt = (title, tag, tone, rows) => ({ kind: 'opt', title, tag, tone, rows });
const cpu = (rows) => ({ kind: 'opt', title: T('Vs computer', 'Contra el ordenador'), tag: null, tone: 'x', rows });
const online = (id) => ({ kind: 'online', rows: [{ tier: 'on', label: T('Win online', 'Victoria en línea'), pts: pointsTable(id).on, cap: false }] });
const table = (id) => ({ kind: 'table', title: T('2 or 3 computers', '2 o 3 ordenadores'),
  note: T("The easiest computer's level counts.", 'Cuenta el nivel del ordenador más fácil.'),
  rows: [{ tier: 'mix', label: T('Easy + Hard', 'Fácil + Difícil'), pts: pointsForWin(id, 'easy'), cap: false }] });
const limit = () => ({ kind: 'limit' });

const G = [
  { id: 'airhockey', art: 'air-hockey', cards: [cpu(levels('airhockey')), online('airhockey')] },
  { id: 'battleship', art: 'battleship', cards: [
    opt(T('Quick board (8x8)', 'Tablero rápido (8x8)'), TAG.s, 's', levels('battleship', { mode: { size: 'quick' } })),
    opt(T('Classic board (10x10)', 'Tablero clásico (10x10)'), TAG.n, 'n', levels('battleship', { mode: { size: 'classic' } })),
    online('battleship'), limit()] },
  { id: 'boggle', art: 'boggle', cards: [
    opt(T('2-minute timer', 'Reloj de 2 min'), TAG.e, 's', levels('boggle', { short: true })),
    opt(T('1 min or 1 min 30 s timer', 'Reloj de 1 min o 1 min 30 s'), TAG.n, 'n', levels('boggle')),
    online('boggle')] },
  { id: 'chinchon', art: 'chinchon', cards: [
    opt(T('Under 100 points or 10 rounds', 'Menos de 100 pts o 10 rondas'), TAG.s, 's', levels('chinchon', { short: true })),
    opt(T('100+ points or 10+ rounds', '100+ puntos o 10+ rondas'), TAG.n, 'n', levels('chinchon')),
    table('chinchon'), online('chinchon')] },
  { id: 'connect4', art: 'connect-four', cards: [cpu(levels('connect4'))] },
  { id: 'hoops4', art: 'hoops4', cards: [
    opt(T('Until you score', 'Hasta encestar'), TAG.e, 's', levels('hoops4', { short: true })),
    opt(T('One shot only', 'Un solo tiro'), TAG.h, 'h', levels('hoops4')),
    online('hoops4')] },
  { id: 'cuppong', art: 'cuppong', cards: [
    opt(T('Unlimited reracks', 'Recolocaciones ilimitadas'), TAG.e, 's', levels('cuppong', { short: true, mode: { rr: 'inf' } })),
    opt(T('1, 2 or 3 reracks', '1, 2 o 3 recolocaciones'), TAG.n, 'n', levels('cuppong', { mode: { rr: 2 } })),
    opt(T('No reracks', 'Sin recolocaciones'), TAG.h, 'h', levels('cuppong', { mode: { rr: 0 } })),
    online('cuppong'), limit()] },
  { id: 'darts', art: 'darts', cards: [
    opt(T('201 or 101', '201 o 101'), TAG.s, 's', levels('darts', { short: true, mode: { kind: '201' } })),
    opt(T('301 or Cricket', '301 o Cricket'), TAG.n, 'n', levels('darts', { mode: { kind: '301' } })),
    opt(T('Cricket in order', 'Cricket en orden'), TAG.h, 'h', levels('darts', { mode: { kind: 'cricket-order' } })),
    online('darts')] },
  { id: 'dominoes', art: 'dominoes', cards: [
    opt(T('To 150 points', 'A 150 puntos'), TAG.s, 's', levels('dominoes', { short: true, mode: { to: 150 } })),
    opt(T('To 300 points', 'A 300 puntos'), TAG.n, 'n', levels('dominoes', { mode: { to: 300 } })),
    opt(T('To 500 points', 'A 500 puntos'), TAG.l, 'h', levels('dominoes', { mode: { to: 500 } }))] },
  { id: 'dotsboxes', art: 'dots-boxes', cards: [
    opt(T('Small or medium board', 'Tablero pequeño o mediano'), TAG.n, 'n', levels('dotsboxes', { mode: { size: 'medium' } })),
    opt(T('Large board', 'Tablero grande'), TAG.l, 'h', levels('dotsboxes', { mode: { size: 'large' } })),
    online('dotsboxes')] },
  { id: 'escoba', art: 'escoba', cards: [cpu(levels('escoba')), table('escoba'), online('escoba')] },
  { id: 'filler', art: 'filler', cards: [cpu(levels('filler')), online('filler')] },
  { id: 'flicksoccer', art: 'flick-soccer', cards: [
    opt(T('First to 1 goal', 'A 1 gol'), TAG.s, 's', levels('flicksoccer', { short: true, mode: { goals: 1 } })),
    opt(T('First to 2 goals', 'A 2 goles'), TAG.n, 'n', levels('flicksoccer', { mode: { goals: 2 } })),
    opt(T('First to 3 goals', 'A 3 goles'), TAG.l, 'h', levels('flicksoccer', { mode: { goals: 3 } })),
    online('flicksoccer'), limit()] },
  { id: 'mancala', art: 'mancala', cards: [cpu(levels('mancala')), online('mancala')] },
  { id: 'business', art: 'business-deal', cards: [cpu(levels('business')),
    { kind: 'old', title: T('Older wins', 'Victorias antiguas'), rows: [{ tier: 0, label: T('Saved with no level', 'Guardadas sin nivel'), pts: pointsForWin('business', 'none'), cap: false }] }] },
  { id: 'parchis', art: 'parchis', cards: [cpu(levels('parchis')), table('parchis')] },
  { id: 'eightball', art: 'eight-ball', cards: [
    opt(T('First to 1 rack', 'A 1 partida'), TAG.s, 's', levels('eightball', { short: true, mode: { racks: 1 } })),
    opt(T('First to 2 racks', 'A 2 partidas'), TAG.n, 'n', levels('eightball', { mode: { racks: 2 } })),
    opt(T('First to 3 racks', 'A 3 partidas'), TAG.l, 'h', levels('eightball', { mode: { racks: 3 } })),
    online('eightball')] },
  { id: 'tictactoe', art: 'tic-tac-toe', cards: [
    opt(T('Classic', 'Clásico'), TAG.n, 'n', levels('tictactoe', { mode: { v: 'classic' } })),
    opt(T('Ultimate', 'Definitivo'), TAG.h, 'h', levels('tictactoe', { mode: { v: 'ultimate' } })),
    online('tictactoe'), limit()] },
  { id: 'uno', art: 'uno', cards: [cpu(levels('uno'))] },
  { id: 'yahtzee', art: 'yahtzee', cards: [cpu([{ tier: 0, label: T('Win', 'Victoria'), pts: pointsForWin('yahtzee', 'normal'), cap: false }]), online('yahtzee')] },
];

// --- render -------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PEOPLE = '<svg viewBox="0 0 22 20" aria-hidden="true"><circle cx="7" cy="6.5" r="3.6" fill="currentColor"/><circle cx="15" cy="6.5" r="3.6" fill="currentColor"/><path d="M0.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6zM8.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6z" fill="currentColor"/></svg>';
const icon = (tier) => {
  if (tier === 'on') return `<span class="ic ppl">${PEOPLE}</span>`;
  if (tier === 'mix') return `<span class="ic mix"><span class="sh">${diffShapeSVG(1)}</span><span class="sh">${diffShapeSVG(3)}</span></span>`;
  if (!tier) return '<span class="ic"></span>';
  return `<span class="ic"><span class="sh${tier === 4 ? ' x2' : ''}">${diffShapeSVG(tier)}</span></span>`;
};
const PT = { en: (n) => `${n} ${n === 1 ? 'point' : 'points'}`, es: (n) => `${n} ${n === 1 ? 'punto' : 'puntos'}` };
const LIM = { en: '20-point limit', es: 'Límite de 20 puntos' };
// The 20-point limit marker on a row: a yellow ball with "20" (Matt, v6 review: "a yellow 20 circle that looks kinda
// like a pool ball"), between the row's label and its points. The words live once, in the box at the bottom.
const BALL = (L) => `<span class="ball" role="img" aria-label="${LIM[L]}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.4" fill="#ffce3a" stroke="#a37c12" stroke-width="1.2"/><ellipse cx="7.6" cy="6.2" rx="3.2" ry="1.7" fill="#fff" opacity=".5" transform="rotate(-35 7.6 6.2)"/><circle cx="12" cy="12" r="7.6" fill="#fff"/><text x="12" y="15.4" text-anchor="middle" font-size="9.6" font-weight="800" fill="#1c1606" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${CAP}</text></svg></span>`;
const row = (r, L) => `<div class="r">${icon(r.tier)}<div class="t"><span class="lb">${esc(r.label[L])}</span></div>${r.cap ? BALL(L) : ''}<div class="p" data-pts="${r.pts}"><b>${r.pts}</b> ${esc(PT[L](r.pts).replace(/^\d+ /, ''))}</div></div>`;
const LIMIT_BODY = {
  en: (b) => `Wins marked ${b} are almost always won. Only your first ${CAP} points from them count.`,
  es: (b) => `Las victorias con ${b} son casi seguras. Solo cuentan los primeros ${CAP} puntos que te dan.`,
};
function card(c, L) {
  if (c.kind === 'opt') return `<div class="card k-${c.tone}"><div class="ch"><span class="ct">${esc(c.title[L])}</span>${c.tag ? `<span class="tag">${esc(c.tag[L])}</span>` : ''}</div>${c.rows.map((r) => row(r, L)).join('')}</div>`;
  if (c.kind === 'online') return `<div class="card k-x"><div class="ch"><span class="ct">${L === 'en' ? 'Online' : 'En línea'}</span></div>${c.rows.map((r) => row(r, L)).join('')}</div>`;
  if (c.kind === 'table') return `<div class="card k-x"><div class="ch"><span class="ct">${esc(c.title[L])}</span></div><div class="cn">${esc(c.note[L])}</div>${c.rows.map((r) => row(r, L)).join('')}</div>`;
  if (c.kind === 'old') return `<div class="card k-x"><div class="ch"><span class="ct">${esc(c.title[L])}</span></div>${c.rows.map((r) => row(r, L)).join('')}</div>`;
  if (c.kind === 'limit') return `<div class="card k-cap"><div class="ch"><span class="lim big">${LIM[L]}</span></div><div class="cn">${LIMIT_BODY[L](BALL(L))}</div></div>`;
  return '';
}
const LEAD = { en: 'Every win adds points:', es: 'Cada victoria suma puntos:' };
const DONE = { en: 'Done', es: 'Hecho' };
const titleOf = (id, L) => STRINGS[L]['game_title_' + id];
const ORDER = [...G].sort((a, b) => titleOf(a.id, 'en').localeCompare(titleOf(b.id, 'en')));
const sheet = (g, L) => `<div class="phone" data-game="${g.id}" data-lang="${L}"><div class="grab"></div>
  <div class="hd"><span class="art">${GAME_ART[g.art] || ''}</span><h2>${esc(titleOf(g.id, L))}</h2></div>
  <p class="lead">${LEAD[L]}</p>
  ${g.cards.map((c) => card(c, L)).join('\n  ')}
  <div class="done">${DONE[L]}</div></div>`;
const groups = (L) => [ORDER.slice(0, 10), ORDER.slice(10)].map((part, i) => `<section class="grp" id="${L}-${i + 1}" data-lang="${L}">${part.map((g) => sheet(g, L)).join('\n')}</section>`).join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Points info v7</title>
<style>
  :root { --bg:#0E1014; --sheet:#171A20; --card:#1E222A; --line:#2B313B; --ink:#F1F3F6; --dim:#A2A9B5; --accent:#7AA7FF; --gold:#ffce3a; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.3 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
  .bar { display:flex; gap:8px; padding:12px 16px; background:var(--bg); border-bottom:1px solid var(--line); }
  .bar button { min-height:44px; min-width:64px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--ink); font:inherit; font-weight:700; }
  .bar button[aria-pressed="true"] { background:var(--accent); color:#0E1014; border-color:var(--accent); }
  body[data-lang="en"] .grp[data-lang="es"], body[data-lang="es"] .grp[data-lang="en"] { display:none; }
  .grp { display:flex; flex-wrap:wrap; gap:24px; padding:24px 16px; align-items:flex-start; }
  .phone { width:360px; max-width:100%; background:var(--sheet); border-radius:20px 20px 0 0; padding:10px 16px 24px; display:flex; flex-direction:column; gap:12px; }
  .grab { width:40px; height:5px; border-radius:3px; background:#3a414c; align-self:center; }
  .hd { display:flex; align-items:center; gap:12px; }
  .art { width:56px; height:32px; border-radius:8px; overflow:hidden; background:#252A33; flex:none; display:flex; }
  .art svg { width:100%; height:100%; display:block; }
  .hd h2 { margin:0; font-size:20px; font-weight:700; }
  .lead { margin:0; font-size:16px; font-weight:700; }
  .card { border-radius:14px; overflow:hidden; border:1px solid var(--line); background:var(--card); }
  .ch { display:flex; align-items:center; gap:8px; padding:9px 12px; font-weight:800; font-size:15px; background:#2a2f3a; }
  .ct { flex:1; min-width:0; }
  .tag { flex:none; font-size:12px; font-weight:700; padding:3px 9px; border-radius:999px; background:rgba(255,255,255,.14); }
  .k-n .ch { background:#263040; color:#dfe6f1; }
  .k-s { border-color:#7a5a2a; } .k-s .ch { background:#4a3720; color:#ffd9a3; }
  .k-h { border-color:#5a4a8a; } .k-h .ch { background:#352c5a; color:#d9ccff; }
  .k-x .ch { background:#2a2f3a; color:#e6e9f0; }
  .k-cap { border:2px solid var(--gold); background:#2a2614; }
  .k-cap .ch { background:transparent; padding-bottom:4px; }
  .cn { padding:8px 12px 10px; font-size:14px; line-height:1.4; color:#e6e9f0; }
  .k-cap .cn { padding-top:2px; }
  .k-cap .cn b { color:var(--gold); }
  .r { display:flex; align-items:center; gap:10px; padding:9px 12px; border-top:1px solid rgba(255,255,255,.07); min-height:44px; }
  .ch + .r { border-top:0; }
  .ic { width:22px; display:flex; gap:3px; flex:none; justify-content:center; color:#cfd6e0; }
  .ic.mix { width:44px; }
  .ic.ppl svg { width:22px; height:20px; }
  .sh { display:inline-flex; width:18px; height:18px; background:#fff; border-radius:4px; padding:2px; }
  .sh.x2 { width:24px; }
  .sh svg { width:100%; height:100%; }
  .t { flex:1; min-width:0; }
  .lb { font-size:15px; }
  .ball { display:inline-flex; width:28px; height:28px; flex:none; }
  .ball svg { width:100%; height:100%; display:block; }
  .cn .ball { vertical-align:middle; margin:-6px 1px -4px; }
  .lim { display:inline-block; font-size:11.5px; font-weight:800; color:#1c1606; background:var(--gold); border-radius:999px; padding:1px 8px; white-space:nowrap; }
  .lim.big { font-size:13px; padding:3px 10px; }
  .p { flex:none; min-width:86px; text-align:right; font-size:14px; color:var(--dim); white-space:nowrap; }
  .p b { font-size:20px; font-weight:800; color:var(--ink); }
  .done { min-height:52px; border-radius:14px; background:var(--accent); color:#0E1014; font-weight:700; font-size:17px; display:flex; align-items:center; justify-content:center; margin-top:4px; }
  @media (max-width:420px) { .grp { padding:0 0 24px; gap:16px; } .phone { width:100%; } }
</style></head>
<body data-lang="en">
<div class="bar" role="group" aria-label="Language"><button type="button" data-l="en" aria-pressed="true">EN</button><button type="button" data-l="es" aria-pressed="false">ES</button></div>
${groups('en')}
${groups('es')}
<script>
  const set = (l) => { document.body.dataset.lang = l; document.documentElement.lang = l; document.querySelectorAll('.bar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.l === l))); };
  document.querySelectorAll('.bar button').forEach((b) => b.addEventListener('click', () => set(b.dataset.l)));
  const q = new URLSearchParams(location.search).get('lang'); if (q === 'es' || q === 'en') set(q);
</script>
</body></html>
`;
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log('wrote', OUT, (html.length / 1024).toFixed(0) + ' KB');
console.log('planned-fix rows (mockup differs from main):');
for (const d of diffs) console.log('  ' + d);
