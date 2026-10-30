// build-word-weaver-es.mjs - GENERATOR for word-weaver/data/es/ (Word Weaver's SPANISH ladder, Tejepalabras;
// Matt, 2026-10-29: "Yes, build Spanish puzzles"). Run it, then `node word-weaver/js/data-test.js`, then commit
// the data. Never hand-edit the files it writes.
//
//   NODE_USE_ENV_PROXY=1 node tools/build-word-weaver-es.mjs [--cache <dir>] [--levels 2000]
//
// THE SAME GAME AS ENGLISH (tools/build-word-weaver-data.mjs: its ramp, bands, crossword layout and grid
// rules are imported, not copied), with Spelling Bee's Spanish sources and rules (tools/build-spelling-bee-es.mjs,
// whose lists are imported): boggle/data/words-es.txt (RLA-ES) + lemmatization-lists (conjugations) +
// FrequencyWords es 2018 (how often a word is said). NO ACCENTS, Ñ IS ITS OWN LETTER (Ana, 2026-10-26).
//
// THE TWO LISTS
//   EXTRA words (accepted, counted, never shown until found) = every dictionary word and conjugation of 3-7
//     letters (Spelling Bee's bonus rule), no first names (NAME_WORDS keeps LUNA, CLARA), no SLURS. Adult
//     words and profanity ARE extras (Matt, 2026-10-29: "just because these words have bad meanings doesn't
//     mean they aren't words").
//   GRID words (what a level asks for) = extras that lemmatization-lists knows, among the GRID_RANK most said
//     words, not a name, not on NOT_ANSWERS, not a vulgar or adult word, not on GRID_BLOCK.
//   HARD / EXPERT grid lists (as English: 7-letter wheels, rarer words): the same, up to HARD_RANK / any
//     ranked word; a 3- or 4-letter word there must already be an Easy/Medium grid word.
//
// WHAT IS WRITTEN: word-weaver/data/es/index.json and levels-<k>.json, English's format exactly (letters may
//   include Ñ). APPEND-ONLY ONCE SHIPPED, as English: a re-run keeps every level in the files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, wheelSize, targetWords, maxDims, layout, gridProblems, BAND, CHUNK } from './build-word-weaver-data.mjs';
import { FREQ_URL, LEM_URL, NAME_URLS, BAD_URL, BLOCK, ALLOW, NOT_ANSWERS, NAME_WORDS, SPANISH_TOO, SKIP, BLOCK_RE,
  SLURS, ADULT_SKIP, fold, flat } from './build-spelling-bee-es.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CACHE = arg('--cache', path.join(os.tmpdir(), 'word-weaver-es-cache'));
const COUNT = Number(arg('--levels', 2000));
const OUT = path.join(ROOT, 'word-weaver/data/es');
const SEED = 20261029;
const GRID_RANK = 12000;
const CORE_RANK = 3000;
const HARD_RANK = 25000;
const WORD = /^[a-zñ]{3,7}$/;
// Read by hand 2026-10-29, still accepted as extras: words whose subtitle count belongs to their Ñ twin (subtitles
// drop the tilde: ANO is mostly AÑO), abbreviations, names and English the lists let through.
const GRID_BLOCK = new Set(`ano anos danes cia seo dea are sir dom nasa tesla cross stand single suite tour set top test pop yes
fans master masters charter aspen alien lord peralta mateo adama
`.split(/\s+/).filter(Boolean));

const idx = (c) => (c === 'ñ' ? 26 : c.charCodeAt(0) - 97);
const sortKey = (w) => [...w].sort().join('');
const counts = (w) => { const c = new Uint8Array(27); for (const ch of w) c[idx(ch)]++; return c; };
const maskOf = (w) => { let m = 0; for (const ch of w) m |= 1 << idx(ch); return m; };
const fitsIn = (wc, lc) => { for (let i = 0; i < 27; i++) if (wc[i] > lc[i]) return false; return true; };

async function cached(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const txt = await res.text();
  fs.writeFileSync(p, txt);
  return txt;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  // --- the sources, read the way Spelling Bee's Spanish generator reads them ---
  const bad = new Set((await cached(BAD_URL, 'bad-es.txt')).split('\n').map((w) => fold(w.trim())).filter((w) => w && !ALLOW.has(w)));
  for (const w of BLOCK) bad.add(w);
  const A = new Set(fs.readFileSync(path.join(ROOT, 'boggle/data/words-es.txt'), 'utf8').split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean));
  const L = new Set(), B = new Set(), variants = new Map();
  const seenAs = (w) => { const k = flat(w); if (!variants.has(k)) variants.set(k, new Set()); variants.get(k).add(w); };
  for (const line of (await cached(LEM_URL, 'lemmatization-es.txt')).replace(/^﻿/, '').split(/\r?\n/)) {
    const [lemma, form] = line.split('\t');
    if (!form) continue;
    for (const raw of [lemma, form]) { const f = fold(raw); if (/^[a-zñ]+$/.test(f)) { L.add(f); seenAs(f); } }
    const ff = fold(form);
    if (/^[a-zñ]+$/.test(ff) && (A.has(flat(lemma)) || A.has(flat(ff)))) B.add(ff);
  }
  const names = new Set();
  for (const [i, u] of NAME_URLS.entries()) for (const n of (await cached(u, `names-${i}.txt`)).split(/\r?\n/)) if (n.trim()) names.add(fold(n.trim()));
  const rank = new Map(), said = new Map();
  for (const [i, line] of (await cached(FREQ_URL, 'es_50k.txt')).split(/\r?\n/).entries()) {
    const [w0, n] = line.split(' ');
    const f = fold(w0 || '');
    if (!f || !/^[a-zñ]+$/.test(f) || rank.has(f)) continue;
    rank.set(f, i);
    said.set(f, Number(n) || 0);
  }
  const fromA = [];
  for (const w of A) { const v = variants.get(w); if (v) fromA.push(...v); else fromA.push(w); }
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'spelling-bee/data/bee.json'), 'utf8'));
  const english = new Set(`${en.words} ${en.extra}`.split(' '));

  // --- the lists ---
  const isName = (w) => (names.has(w) || NOT_ANSWERS.has(w)) && !NAME_WORDS.has(w);
  const vulgar = (w) => bad.has(w) || BLOCK_RE.test(w) || ADULT_SKIP.has(w);
  const accepted = new Set([...fromA, ...B].filter((w) => WORD.test(w)));
  const common = [...L].filter((w) => WORD.test(w) && !accepted.has(w) && rank.has(w) && !names.has(w)
    && (!SKIP.has(w) || ADULT_SKIP.has(w)) && (!english.has(w) || SPANISH_TOO.has(w)));
  const extra = [...new Set([...accepted, ...common])].filter((w) => !isName(w) && !SLURS.has(w)).sort();
  // A grid word is a DICTIONARY word or one of its conjugations (`accepted`), never only a subtitle word (SET, STOP, JET).
  const gridOk = (w) => accepted.has(w) && L.has(w) && rank.has(w) && !vulgar(w) && !NOT_ANSWERS.has(w) && !isName(w) && !GRID_BLOCK.has(w);
  const grid = extra.filter((w) => gridOk(w) && rank.get(w) < GRID_RANK);
  const commonSet = new Set(grid);
  const isRare = (w) => !commonSet.has(w);
  const coreScore = (w) => (rank.get(w) < CORE_RANK ? 2 : 0) + Math.log10(said.get(w) || 1);
  const gridC = grid.map(counts), gridM = grid.map(maskOf);
  const extraC = extra.map(counts), extraM = extra.map(maskOf);

  const bases = new Map();
  for (const w of grid) { const k = sortKey(w); if (!bases.has(k)) bases.set(k, { key: k, words: [] }); bases.get(k).words.push(w); }
  for (const b of bases.values()) {
    const lc = counts(b.key), lm = maskOf(b.key);
    b.pool = [];
    for (let i = 0; i < grid.length; i++) if (grid[i].length <= b.key.length && !(gridM[i] & ~lm) && fitsIn(gridC[i], lc)) b.pool.push(grid[i]);
    b.common = Math.max(...b.words.map(coreScore));
  }
  const bySize = {};
  for (const b of bases.values()) (bySize[b.key.length] ||= []).push(b);
  for (const s of Object.keys(bySize)) bySize[s].sort((a, b) => (a.key < b.key ? -1 : 1));

  // Hard and Expert: English's shape (BAND: levels, word counts, 3-/4-letter caps), Spanish word lists.
  const BANDS = {
    hard: { ...BAND.hard, rankMax: HARD_RANK },
    expert: { ...BAND.expert, rankMax: Infinity },
  };
  for (const [name, X] of Object.entries(BANDS)) {
    X.list = extra.filter((w) => w.length >= X.minLen && gridOk(w) && rank.get(w) < X.rankMax && (w.length >= 5 || commonSet.has(w)));
    const lc7 = X.list.map(counts), lm7 = X.list.map(maskOf);
    const byKey = new Map();
    for (const w of X.list) if (w.length === 7) { const k = sortKey(w); if (!byKey.has(k)) byKey.set(k, { key: k, words: [] }); byKey.get(k).words.push(w); }
    X.bases = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const b of X.bases) {
      const lc = counts(b.key), lm = maskOf(b.key);
      b.pool = [];
      for (let i = 0; i < X.list.length; i++) if (!(lm7[i] & ~lm) && fitsIn(lc7[i], lc)) b.pool.push(X.list[i]);
      b.rare = b.pool.filter(isRare).length;
      b.common = Math.max(...b.words.map(coreScore));
    }
    console.log(`${name}: list ${X.list.length}, 7-letter bases ${X.bases.length}`);
  }
  const bandOf = (n) => (n >= BANDS.expert.from ? BANDS.expert : n >= BANDS.hard.from ? BANDS.hard : null);

  // --- the levels (English's loop: kept levels first, then append) ---
  const kept = [];
  if (fs.existsSync(path.join(OUT, 'index.json'))) {
    const ix = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
    for (let k = 0; k * CHUNK < ix.count; k++) kept.push(...JSON.parse(fs.readFileSync(path.join(OUT, `levels-${k}.json`), 'utf8')).levels);
  }
  const used = new Set(kept.map((lv) => sortKey(lv.l.toLowerCase())));
  const levels = kept.slice(0, COUNT);
  for (let n = levels.length + 1; n <= COUNT; n++) {
    const r = rng(SEED + n * 7919);
    const X = bandOf(n);
    let size = X ? 7 : wheelSize(n, r);
    let target = targetWords(n, size, r);
    if (X) {
      const p = (n - X.from) / (X.to - X.from);
      target = Math.min(X.words[1], Math.max(X.words[0], Math.round(X.words[0] + (X.words[1] - X.words[0]) * p) + (r() < 0.3 ? -1 : r() < 0.4 ? 1 : 0)));
    }
    const [mr, mc] = X ? [9, 9] : maxDims(n, size);
    let made = null;
    const failed = new Set();
    for (let tries = 0; !made && tries < 400; tries++) {
      const cands = (X ? X.bases : bySize[size] || []).filter((b) => !used.has(b.key) && !failed.has(b.key) && b.pool.length >= target + (size >= 6 ? 2 : 0));
      if (X && !cands.length) { if (target > X.words[0]) { target--; failed.clear(); continue; } break; }
      if (!cands.length) {
        if (tries > 300) { size = size === 7 ? 6 : size + 1; continue; }
        target = Math.max(3, target - 1); continue;
      }
      const from = X ? [...cands].sort((x, y) => y.rare - x.rare || (x.key < y.key ? -1 : 1)).slice(0, Math.max(8, Math.ceil(cands.length * 0.4)))
        : n <= 400 ? [...cands].sort((x, y) => y.common - x.common || (x.key < y.key ? -1 : 1)).slice(0, Math.max(8, Math.ceil(cands.length * (n <= 60 ? 0.2 : 0.4)))) : cands;
      const b = from[Math.floor(r() * from.length)];
      const base = [...b.words].sort((x, y) => coreScore(y) - coreScore(x) || (x < y ? -1 : 1))[0];
      let best = null;
      for (let a = 0; a < 60; a++) {
        const ws = X ? layout(base, b.pool, target, mr, mc, r, { rare: isRare, max3: X.max3, max4: X.max4 }) : layout(base, b.pool, target, mr, mc, r);
        if (ws.length < target) continue;
        const rows = Math.max(...ws.map(([w, r0, , d]) => r0 + (d === 'd' ? w.length : 1)));
        const cols = Math.max(...ws.map(([w, , c0, d]) => c0 + (d === 'a' ? w.length : 1)));
        const score = rows * cols + Math.abs(rows - cols) * 3;
        if (!best || score < best.score) best = { ws, rows, cols, score };
      }
      if (!best) {
        failed.add(b.key);
        if (X && failed.size % 20 === 0) target = Math.max(X.words[0], target - 1);
        continue;
      }
      const problems = gridProblems(best.ws, best.rows, best.cols);
      if (problems.length) throw new Error(`level ${n}: ${problems.join('; ')}`);
      const lc = counts(b.key), lm = maskOf(b.key);
      const inGrid = new Set(best.ws.map(([w]) => w));
      const x = [];
      for (let i = 0; i < extra.length; i++) if (!inGrid.has(extra[i]) && extra[i].length <= b.key.length && !(extraM[i] & ~lm) && fitsIn(extraC[i], lc)) x.push(extra[i]);
      made = { l: b.key.toUpperCase(), g: [best.rows, best.cols], w: best.ws.map(([w, r0, c0, d]) => [w.toUpperCase(), r0, c0, d]), x: x.map((w) => w.toUpperCase()) };
      used.add(b.key);
    }
    if (!made) throw new Error(`level ${n}: no layout (size ${size}, target ${target})`);
    levels.push(made);
  }

  fs.mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (let k = 0; k * CHUNK < levels.length; k++) {
    const part = levels.slice(k * CHUNK, (k + 1) * CHUNK);
    const body = `{"v":1,"first":${1 + k * CHUNK},"levels":[\n${part.map((lv) => JSON.stringify(lv)).join(',\n')}\n]}\n`;
    fs.writeFileSync(path.join(OUT, `levels-${k}.json`), body);
    total += body.length;
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, count: levels.length, chunk: CHUNK }) + '\n');
  console.log(`grid words ${grid.length}, extra words ${extra.length}, levels ${levels.length} (kept ${kept.length}), ${(total / 1024).toFixed(0)} KB`);
  for (const [band, a, z] of [['easy', 1, 500], ['medium', 501, 1000], ['hard', 1001, 1500], ['expert', 1501, 2000]]) {
    const part = levels.slice(a - 1, z);
    if (!part.length) continue;
    const ws = part.flatMap((lv) => lv.w.map((e) => e[0]));
    const sizes = {}; for (const lv of part) sizes[lv.l.length] = (sizes[lv.l.length] || 0) + 1;
    const nw = part.map((lv) => lv.w.length);
    const avg = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
    console.log(`BAND ${band.padEnd(6)} letters ${JSON.stringify(sizes)} words ${Math.min(...nw)}-${Math.max(...nw)} (avg ${avg(nw).toFixed(1)}) avg len ${avg(ws.map((w) => w.length)).toFixed(2)} Ñ levels ${part.filter((lv) => lv.l.includes('Ñ')).length} extras avg ${avg(part.map((lv) => lv.x.length)).toFixed(0)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
