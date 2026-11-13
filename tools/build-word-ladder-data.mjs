// build-word-ladder-data.mjs - GENERATOR for word-ladder/data/ (Word Ladder's words, levels and daily puzzles).
// Run it, then `node word-ladder/js/data-test.js`, then commit the data. Never hand-edit the files it writes.
//
//   node tools/build-word-ladder-data.mjs            (both languages, offline: every source is already in the repo)
//
// SOURCES (all in this repo, nothing downloaded)
//   * The WORDS: every grid word and extra word of Word Weaver's shipped levels (word-weaver/data/, word-weaver/data/es/),
//     3 to 5 letters, PLUS every 3-5 letter word of the Boggle dictionaries (boggle/data/words.txt = ENABLE,
//     words-es.txt), so any real word is a legal step (2026-11-13). Word Weaver's lists were already cleaned by Word Weaver's generators: SCOWL / ENABLE (English) and Spelling
//     Bee's Spanish lists, no first names, no bad words or their plurals (word-weaver/data/CREDITS.md). A word is
//     ACCEPTED as a step only if it is on this list, and every par below is the shortest path over exactly this list,
//     so no player can ever beat par.
//     A level's start, target AND hint path are GRID words only (Word Weaver's common, hand-checked list): par is the
//     shortest path over every accepted word and a path of that length exists through grid words alone.
//     words.json lists grid words first, so the game's hint (the earliest word on a shortest path) prefers them.
//   * How COMMON a word is: tools/word-weaver-ranks-{en,es}.txt (FrequencyWords 2018 line numbers, CC BY-SA 4.0). A
//     word with no rank counts as rare (RARE). Start and target words are common (rank caps in plan()); the hint path
//     is the shortest path with the most common words (least summed rank).
//
// WHAT IS WRITTEN (per language, en and es)
//   word-ladder/data/<lang>/words.json  { v: 1, w: { "3": "CAT COT ...", "4": "...", "5": "..." } } (most common first)
//   word-ladder/data/<lang>/levels.json { v: 1, count, levels: [ { s, t, p, h }, ... ] } one level a line
//     s = start, t = target, p = par (the shortest number of changes), h = a shortest path "S W1 W2 ... T"
//   word-ladder/data/<lang>/daily.json  { v: 1, epoch, count, levels: [ same shape ] } (day d = levels[d])
//
// THE RAMP (plan): 1-100 Easy (3 letters, par 3-4; 4 letters once the 3-letter pairs run out), 101-250 Medium (4 letters, par 4-5), 251-400 Hard (4 letters par
// 5-7 or 5 letters par 4-5), 401-500 Expert (5 letters par 5-7 or 4 letters par 7-9). Bands: word-ladder/js/engine.js.
// Daily: 4 letters par 4-6 or 5 letters par 4-5, common words. No start/target PAIR repeats anywhere; a word is a start
// or target at most MAX_USES times in each language. Seeded: the same sources always give the same data.
//
// APPEND-ONLY ONCE SHIPPED TO PLAYERS: progress is per level number. Before release (admin only) a re-run may remake
// everything; after it, only append (word-ladder/js/data-test.js pins the shipped levels by hash).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RARE = 200000;
const LEVELS = 500;
const DAILY = 730;
const EPOCH = '2026-11-13';
const MAX_USES = 3;   // a word is a start or target at most this often per language

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** { all: every accepted word, grid: Set of Word Weaver GRID words (the common, hand-checked ones) }. */
function loadWords(lang) {
  const dir = path.join(ROOT, 'word-weaver/data', lang === 'es' ? 'es' : '');
  const set = new Set(), grid = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!/^(levels-\d+|daily)\.json$/.test(f)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const l of j.levels) { for (const w of l.w) { set.add(w[0]); grid.add(w[0]); } for (const x of l.x) set.add(x); }
  }
  // Every real word counts as a STEP (2026-11-13, Matt: "ASS ... Yes it is" a word): the whole Boggle dictionary
  // too (ENABLE for English, boggle/data/words-es.txt for Spanish), bad words included. Start, target and the
  // hint path stay Word Weaver GRID words (common, clean).
  const broad = fs.readFileSync(path.join(ROOT, 'boggle/data', lang === 'es' ? 'words-es.txt' : 'words.txt'), 'utf8').split(/\r?\n/);
  for (const w of broad) set.add(w.trim().toUpperCase());
  const ok = lang === 'es' ? /^[A-ZÑ]{3,5}$/ : /^[A-Z]{3,5}$/;
  return { all: [...set].filter((w) => ok.test(w)), grid };
}
function loadRanks(lang) {
  const m = new Map();
  for (const line of fs.readFileSync(path.join(ROOT, `tools/word-weaver-ranks-${lang}.txt`), 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const [w, r] = line.trim().split(/\s+/);
    if (w && r) m.set(w, Number(r));
  }
  return m;
}

/** Graph of one word length: neighbours = one letter changed. */
function graph(words) {
  const buckets = new Map();
  for (const w of words) for (let i = 0; i < w.length; i++) {
    const k = w.slice(0, i) + '_' + w.slice(i + 1);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(w);
  }
  const nb = new Map(words.map((w) => [w, []]));
  for (const list of buckets.values()) for (const a of list) for (const b of list) if (a !== b) nb.get(a).push(b);
  return nb;
}
function bfs(nb, from) {
  const d = new Map([[from, 0]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) for (const n of nb.get(q[i])) if (!d.has(n)) { d.set(n, d.get(q[i]) + 1); q.push(n); }
  return d;
}
/** The shortest path from s to t with the least summed rank (dist from t precomputed). */
function bestPath(nb, s, t, rank) {
  const dt = bfs(nb, t);
  const memo = new Map();
  const cost = (w) => {
    if (w === t) return [rank(w), [w]];
    if (memo.has(w)) return memo.get(w);
    let best = null;
    for (const n of nb.get(w)) if (dt.get(n) === dt.get(w) - 1) {
      const c = cost(n);
      if (!best || c[0] < best[0]) best = c;
    }
    const r = [best[0] + rank(w), [w, ...best[1]]];
    memo.set(w, r);
    return r;
  };
  return cost(s)[1];
}

function plan(n) {
  // Easy falls back to 4 letters when the 3-letter words run out (Spanish has few: ~400).
  if (n <= 20) return [{ len: 3, p: [3, 3], cap: 3000 }, { len: 3, p: [3, 3], cap: 8000 }, { len: 4, p: [3, 3], cap: 3000 }];
  if (n <= 100) return [{ len: 3, p: [3, 4], cap: 5000 }, { len: 4, p: [3, 4], cap: 4000 }];
  if (n <= 250) return [{ len: 4, p: n <= 175 ? [4, 4] : [4, 5], cap: 5000 }];
  if (n <= 400) return n % 2 ? [{ len: 4, p: [5, 7], cap: 7000 }, { len: 5, p: [4, 5], cap: 7000 }] : [{ len: 5, p: [4, 5], cap: 7000 }, { len: 4, p: [5, 7], cap: 7000 }];
  return n % 2 ? [{ len: 5, p: [5, 7], cap: 9000 }, { len: 4, p: [7, 9], cap: 9000 }] : [{ len: 4, p: [7, 9], cap: 9000 }, { len: 5, p: [5, 7], cap: 9000 }];
}
const dailyPlan = (d) => [...(d % 3 === 2 ? [{ len: 5, p: [4, 5], cap: 6000 }, { len: 4, p: [4, 6], cap: 6000 }] : [{ len: 4, p: [4, 6], cap: 6000 }, { len: 5, p: [4, 5], cap: 6000 }]),
  // Spanish runs out of common pairs: then less common words (still on the cleaned list).
  { len: 4, p: [4, 6], cap: 15000 }, { len: 5, p: [4, 5], cap: 15000 }, { len: 4, p: [4, 6], cap: 30000 }, { len: 5, p: [4, 5], cap: 30000 }];

function build(lang) {
  const { all: words, grid } = loadWords(lang);
  const ranks = loadRanks(lang);
  // Grid words first (common and hand-checked), then the rest of the accepted list, each by how often it is said.
  const rank = (w) => (grid.has(w) ? 0 : RARE) + (ranks.get(w) ?? RARE);
  const byLen = {};
  for (const w of words) (byLen[w.length] ||= []).push(w);
  for (const k of Object.keys(byLen)) byLen[k].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const graphs = {};
  const gridGraphs = {};
  for (const k of Object.keys(byLen)) { graphs[k] = graph(byLen[k]); gridGraphs[k] = graph(byLen[k].filter((w) => grid.has(w))); }
  const used = new Set();
  const uses = new Map();
  const R = rng(lang === 'es' ? 9173 : 4421);
  const pick = (specs) => {
    for (const spec of specs) {
      const nb = graphs[spec.len];
      const common = byLen[spec.len].filter((w) => rank(w) <= spec.cap && (uses.get(w) || 0) < MAX_USES);
      const gnb = gridGraphs[spec.len];
      const commonSet = new Set(common);
      for (let tries = 0; tries < 80 && common.length; tries++) {
        const s = common[Math.floor(R() * common.length)];
        const d = bfs(nb, s), dg = bfs(gnb, s);
        const want = spec.p[0] + Math.floor(R() * (spec.p[1] - spec.p[0] + 1));
        for (const p of [want, ...[spec.p[0], spec.p[1]].filter((x) => x !== want)]) {
          const ts = [];
          for (const [t, dd] of d) if (dd === p && dg.get(t) === p && commonSet.has(t) && !used.has([s, t].sort().join('-'))) ts.push(t);
          if (!ts.length) continue;
          const t = ts[Math.floor(R() * ts.length)];
          used.add([s, t].sort().join('-'));
          uses.set(s, (uses.get(s) || 0) + 1); uses.set(t, (uses.get(t) || 0) + 1);
          return { s, t, p, h: bestPath(nb, s, t, rank).join(' ') };
        }
      }
    }
    throw new Error(`${lang}: no level for ${JSON.stringify(specs)}`);
  };
  const levels = [];
  for (let n = 1; n <= LEVELS; n++) { levels.push(pick(plan(n))); if (n % 100 === 0) console.log(lang, 'level', n); }
  const daily = [];
  for (let d = 0; d < DAILY; d++) { daily.push(pick(dailyPlan(d))); if (d % 100 === 0) console.log(lang, 'day', d); }
  const dir = path.join(ROOT, 'word-ladder/data', lang);
  fs.mkdirSync(dir, { recursive: true });
  const w = {};
  for (const k of ['3', '4', '5']) w[k] = (byLen[k] || []).join(' ');
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify({ v: 1, w }) + '\n');
  const lines = (arr) => '[\n' + arr.map((l) => JSON.stringify(l)).join(',\n') + '\n]';
  fs.writeFileSync(path.join(dir, 'levels.json'), `{"v":1,"count":${levels.length},"levels":${lines(levels)}}\n`);
  fs.writeFileSync(path.join(dir, 'daily.json'), `{"v":1,"epoch":"${EPOCH}","count":${daily.length},"levels":${lines(daily)}}\n`);
  console.log(lang, 'words', Object.fromEntries(Object.entries(byLen).map(([k, v]) => [k, v.length])), 'levels', levels.length, 'daily', daily.length);
}

for (const lang of ['en', 'es']) build(lang);
