// test-lb2-parity.mjs - Leaderboard v2 shows the OLD board's numbers (2026-10-31, docs/LEADERBOARD-V2-PLAN-R1.md).
//
// Matt: "This is an interface redesign, not a stats redesign." So, on the SAME people list:
//   1. GOLDEN: `--make-golden --root <dir>` renders the OLD overlay of the code in <dir> (a checkout of main:
//      `git worktree add /tmp/lbmain origin/main`) over every tab of every game, plus By Game's top rows, and
//      saves them to backups/lb2-golden.json (git-ignored: real names). A test-only hook is appended to that
//      checkout's js/leaderboard-ui.js IN THE BROWSER only (route intercept); its file is never changed.
//   2. CHECK (default): this checkout's OLD overlay must still equal the golden (so an edit to
//      js/leaderboard-ui.js cannot move both boards together unseen), and v2's board for every same tab must
//      equal it row for row (rank, tie, name, number, row count), and v2's gold count (Hall of Fame) must equal
//      the old one (By Game's rank-1 rows).
// Data: backups/lb-z.json (a local read-only copy of boards/v1/lb/z), backups/lb-admin.json (adminConfig/v1),
// backups/lb-bee.json (boards/v1/bee), via tools/lb2-harness.html. Nothing is written anywhere but this browser.
//   node tools/test-lb2-parity.mjs [--make-golden --root /tmp/lbmain] [--lang es]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const MAKE = args.includes('--make-golden');
const ri = args.indexOf('--root');
const SRC = ri >= 0 ? path.resolve(args[ri + 1]) : ROOT;
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en';
const GOLDEN = path.join(ROOT, 'backups', `lb2-golden${LANG === 'en' ? '' : '-' + LANG}.json`);
for (const f of ['lb-z.json', 'lb-admin.json', 'lb-bee.json']) {
  if (!fs.existsSync(path.join(ROOT, 'backups', f))) { console.log(`SKIP: backups/${f} missing (read it with the reader key first)`); process.exit(0); }
}
let chromium;
try { ({ chromium } = createRequire(ROOT + '/')('playwright')); } catch { console.log('SKIP: no playwright'); process.exit(0); }

// The harness and the data live in THIS checkout; copy them into the source checkout if it is another one.
if (SRC !== ROOT) {
  fs.mkdirSync(path.join(SRC, 'backups'), { recursive: true });
  for (const f of ['lb-z.json', 'lb-admin.json', 'lb-bee.json']) fs.copyFileSync(path.join(ROOT, 'backups', f), path.join(SRC, 'backups', f));
  fs.copyFileSync(path.join(ROOT, 'tools', 'lb2-harness.html'), path.join(SRC, 'tools', 'lb2-harness.html'));
}
const PORT = String(8150 + Math.floor(Math.random() * 40));
const srv = spawn('node', ['server.mjs'], { cwd: SRC, env: { ...process.env, PORT } });
await new Promise((r) => setTimeout(r, 900));
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 402, height: 874 } });
pg.on('pageerror', (e) => console.log('pageerror:', e.message));
const HOOK = '\nexport function __lbSetBoardForTest(board) { _board = board; _connected = true; rerender({ fromData: true }); }\n';
await pg.route('**/js/leaderboard-ui.js', async (route) => {
  const res = await route.fetch();
  let body = await res.text();
  if (!body.includes('__lbSetBoardForTest')) body += HOOK;
  await route.fulfill({ response: res, body });
});
// No network beyond localhost: the boards must come from the snapshot alone (and never race a live read).
await pg.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
await pg.addInitScript((lang) => { try { localStorage.setItem('gamehub.lang.v1', lang); } catch { /* */ } }, LANG);
await pg.goto(`http://localhost:${PORT}/tools/lb2-harness.html`);
await pg.waitForFunction(() => document.title === 'ready', null, { timeout: 30000 });

// --- the OLD overlay, every tab of every game -------------------------------------------------------------
const old = await pg.evaluate(async () => {
  const L = await import('/js/leaderboard-ui.js');
  const { isGameOnLauncher } = await import('/js/game-stats-ui.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const games = L.GAME_META.map((m) => m.id).filter((id) => isGameOnLauncher(id));
  const ATTR = { mstier: 'tier', lbview: 'view', lbmachine: 'machine', lbbeeby: 'by', lbbeelang: 'lang' };
  const stOf = (btn, id) => {
    for (const a of Object.keys(ATTR)) {
      const v = btn.dataset[a];
      if (v == null) continue;
      if (a === 'mstier') return { tier: v === '' ? null : Number(v), view: '' };
      if (a === 'lbview') return { tier: null, view: v === 'ctall' || (id === 'skeeball' && v === 'points') ? '' : v };
      return { [ATTR[a]]: v };
    }
    return null;
  };
  const host = () => document.querySelector('.lb-overlay, [class*="lb-"]');
  const scrape = () => [...document.querySelectorAll('.lb-plist.is-board .lb-pcard')].map((c) => {
    const chip = c.querySelector('.lb-chip');
    const lab = (chip && (chip.getAttribute('aria-label') || chip.textContent) || '').trim();
    const m = /(\d+)/.exec(lab);
    return { rank: m ? Number(m[1]) : 0, tie: /^\D/.test(lab), name: (c.querySelector('.lb-pname') || {}).textContent.trim(),
      val: ((c.querySelector('.lb-pnum b') || {}).textContent || '').trim() };
  });
  const out = { boards: {}, standing: {} };
  for (const id of games) {
    L.closeLeaderboard(); await sleep(150);   // its history.back() pops later and would close the next one
    await L.openLeaderboard({ game: id, legacy: true });
    L.__lbSetBoardForTest(H.board);
    await sleep(40);
    const groups = [...document.querySelectorAll('.lb-mstabs')].map((g) => [...g.querySelectorAll('button')].filter((b) => stOf(b, id)));
    const rows = groups.filter((g) => g.length);
    const combos = rows.reduce((acc, row) => acc.flatMap((c) => row.map((_, i) => c.concat(i))), [[]]);
    for (const combo of combos) {
      const st = { tier: null, view: '', machine: 'all', lang: 'all', by: 'points' };
      for (let r = 0; r < combo.length; r++) {
        // Re-find the button: every click re-renders the board.
        const g = [...document.querySelectorAll('.lb-mstabs')].map((x) => [...x.querySelectorAll('button')].filter((b) => stOf(b, id))).filter((x) => x.length)[r];
        const btn = g[combo[r]];
        Object.assign(st, stOf(btn, id));
        btn.click();
        await sleep(40);
      }
      const key = [st.tier == null ? '' : st.tier, st.view || '', st.machine || 'all', st.lang || 'all', st.by || 'points'].join('~');
      out.boards[id + '|' + key] = scrape();
    }
    if (!combos.length || !rows.length) out.boards[id + '|~~all~all~points'] = scrape();
  }
  // By Game's top rows (the one standing per game).
  L.closeLeaderboard(); await sleep(150);
  await L.openLeaderboard({ legacy: true });
  L.__lbSetBoardForTest(H.board);
  await sleep(40);
  const seg = document.querySelector('[data-seg="games"]');
  if (seg) { seg.click(); await sleep(40); }
  for (const card of document.querySelectorAll('.lb-gcard[data-game]')) {
    out.standing[card.dataset.game] = [...card.querySelectorAll('.lb-gtop')].map((x) => {
      const lab = (x.querySelector('.lb-tb') || {}).textContent || '';
      const m = /(\d+)/.exec(lab);
      return { rank: m ? Number(m[1]) : 0, tie: /^\D/.test(lab.trim()), name: (x.querySelector('.lb-gtop-nm') || {}).textContent.trim() };
    });
  }
  L.closeLeaderboard();
  return out;
});

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (detail ? '\n     ' + JSON.stringify(detail).slice(0, 600) : '')); } };

if (MAKE) {
  fs.writeFileSync(GOLDEN, JSON.stringify(old));
  const nb = Object.keys(old.boards).length;
  const golds = Object.values(old.standing).reduce((a, rows) => a + rows.filter((r) => r.rank === 1).length, 0);
  console.log(`golden written: ${nb} tabs, ${Object.keys(old.standing).length} games, ${golds} golds -> ${path.relative(ROOT, GOLDEN)}`);
  await br.close(); srv.kill(); process.exit(0);
}
if (!fs.existsSync(GOLDEN)) { console.log('SKIP: no golden; run with --make-golden --root <main checkout> first'); await br.close(); srv.kill(); process.exit(0); }
const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. This checkout's old overlay still equals main's.
ok('old board: same tabs as main', same(Object.keys(old.boards).sort(), Object.keys(gold.boards).sort()),
  { only_here: Object.keys(old.boards).filter((k) => !gold.boards[k]), only_main: Object.keys(gold.boards).filter((k) => !old.boards[k]) });
for (const k of Object.keys(gold.boards)) ok('old board unchanged: ' + k, same(old.boards[k], gold.boards[k]), { main: gold.boards[k].slice(0, 4), here: (old.boards[k] || []).slice(0, 4) });
for (const k of Object.keys(gold.standing)) ok('old By Game unchanged: ' + k, same(old.standing[k], gold.standing[k]));

// 2. v2, every same tab, row for row; and the gold count.
const v2 = await pg.evaluate(async (keys) => {
  const L = await import('/js/leaderboard-ui.js');
  const V = await import('/js/leaderboard2-ui.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stKey = (st) => [st.tier == null ? '' : st.tier, st.view || '', st.machine || 'all', st.lang || 'all', st.by || 'points'].join('~');
  const out = { boards: {}, hof: null };
  const byGame = {};
  for (const k of keys) { const [id, key] = k.split('|'); (byGame[id] || (byGame[id] = [])).push(key); }
  for (const id of Object.keys(byGame)) {
    const tabs = L.lb2Tabs(H.people, id);
    V.closeLeaderboard2(); await sleep(150);
    await V.openLeaderboard2({ game: id }).catch(() => {});
    V.__setPeopleForTest(H.people, '');
    await sleep(40);
    for (const key of byGame[id]) {
      // Click the v2 tab(s) whose state makes this key (tabs, not a state poke: the real screen).
      const want = key.split('~');
      for (let r = 0; r < tabs.rows.length; r++) {
        const i = tabs.rows[r].findIndex((x) => {
          const st = { tier: null, view: '', machine: 'all', lang: 'all', by: 'points', ...x.st };
          const kk = stKey(st).split('~');
          return Object.keys(x.st).every((p) => kk[['tier', 'view', 'machine', 'lang', 'by'].indexOf(p)] === want[['tier', 'view', 'machine', 'lang', 'by'].indexOf(p)]);
        });
        const btn = document.querySelector(`.lb2 [data-act="stab"][data-v="${r}:${i}"]`);
        if (btn) { btn.click(); await sleep(40); }
      }
      out.boards[id + '|' + key] = [...document.querySelectorAll('.lb2 [data-role="rows"] .lb2-lr')].map((el) => ({
        rank: Number(el.dataset.rank), tie: el.dataset.tie === '1', name: el.querySelector('.lb2-nmt').textContent.trim(),
        val: el.querySelector('.lb2-val').textContent.trim() }));
    }
  }
  V.closeLeaderboard2(); await sleep(150);
  await V.openLeaderboard2({}).catch(() => {});
  V.__setPeopleForTest(H.people, '');
  const t = document.querySelector('.lb2 [data-act="tab"][data-v="hof"]'); if (t) t.click();
  await sleep(40);
  out.hof = [...document.querySelectorAll('.lb2 .lb2-lr')].map((el) => [...el.querySelectorAll('.lb2-strong, .lb2-gm')].map((x) => Number(x.textContent)));
  V.closeLeaderboard2();
  return out;
}, Object.keys(gold.boards));
for (const k of Object.keys(gold.boards)) {
  const a = gold.boards[k], b = v2.boards[k] || [];
  const strip = (rows) => rows.map((r) => ({ rank: r.rank, tie: r.tie, name: r.name, val: r.val.replace(/\s+/g, ' ') }));
  ok('v2 = old: ' + k, same(strip(a), strip(b)), { old: strip(a).slice(0, 5), v2: strip(b).slice(0, 5), nOld: a.length, nV2: b.length });
}
const oldGolds = Object.values(gold.standing).reduce((a, rows) => a + rows.filter((r) => r.rank === 1).length, 0);
const v2Golds = v2.hof.reduce((a, r) => a + (r[0] || 0), 0);
ok(`gold medals: v2 Hall of Fame ${v2Golds} = old By Game ${oldGolds}`, v2Golds === oldGolds);
console.log(`\n${pass} passed, ${fail} failed (lang ${LANG}; old gold ${oldGolds}, v2 gold ${v2Golds})`);
await br.close(); srv.kill();
process.exit(fail ? 1 : 0);
