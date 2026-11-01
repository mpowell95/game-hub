// build-word-weaver-es.mjs - GENERATOR for word-weaver/data/es/ (Word Weaver's SPANISH ladder, Tejepalabras;
// Matt, 2026-10-29: "Yes, build Spanish puzzles"). Run it, then `node word-weaver/js/data-test-es.js`, then commit
// the data. Never hand-edit the files it writes.
//
//   NODE_USE_ENV_PROXY=1 node tools/build-word-weaver-es.mjs [--cache <dir>] [--levels 2000] [--fresh]
//
// THE SAME GAME AS ENGLISH (tools/build-word-weaver-data.mjs: its ramp, bands, crossword layout and grid
// rules are imported, not copied), with Spelling Bee's Spanish sources and rules (tools/build-spelling-bee-es.mjs,
// whose lists are imported): boggle/data/words-es.txt (RLA-ES) + lemmatization-lists (conjugations) +
// FrequencyWords es 2018 (how often a word is said). NO ACCENTS, Ñ IS ITS OWN LETTER (Ana, 2026-10-26).
//
// THE TWO LISTS
//   EXTRA words (accepted, counted, never shown until found) = every dictionary word and conjugation of 3-7
//     letters (Spelling Bee's bonus rule), no first names (NAME_WORDS keeps LUNA, CLARA), no slurs, and since
//     2026-11-01 no vulgar or adult words and their plurals (English's rule; VULGAR_TOO / VULGAR_OK below).
//     (2026-10-29 they were extras, Matt: "just because these words have bad meanings doesn't mean they
//     aren't words"; the 2026-11-01 review asked for English's rule and Matt approved it: "Yes do all".)
//   GRID lists (English's bits): 1 Easy/Medium = extras lemmatization-lists knows, among the EASY_RANK most
//     said, not a name, not on NOT_ANSWERS, not on GRID_BLOCK; 2 Hard = the same up to HARD_RANK, 4 Expert =
//     any ranked word; a 3- or 4-letter Hard/Expert word must be among the GRID_RANK most said.
//
// 2026-11-01: REMADE, ALL 2,000, with English (Matt: "Yes do all"): common words first, the band caps and
//   the one smooth climb are tools/build-word-weaver-data.mjs's (its header; makeLadder, BANDS, plan()),
//   ranks = es_50k.txt line numbers, accents off, Ñ kept. The grid words were already common; the cliff at
//   1001 and Hard = Expert were the same as English's.
//
// WHAT IS WRITTEN: word-weaver/data/es/index.json and levels-<k>.json, English's format exactly (letters may
//   include Ñ), and tools/word-weaver-ranks-es.txt (the data test's offline ranks). APPEND-ONLY ONCE SHIPPED,
//   as English: a re-run keeps every level in the files (`--fresh`: used once, 2026-11-01, before release).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeLadder, writeLevels, writeRanks, report, COMMON, CHUNK } from './build-word-weaver-data.mjs';
import { FREQ_URL, LEM_URL, NAME_URLS, BAD_URL, BLOCK, ALLOW, NOT_ANSWERS, NAME_WORDS, SPANISH_TOO, SKIP, BLOCK_RE,
  SLURS, ADULT_SKIP, fold, flat } from './build-spelling-bee-es.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CACHE = arg('--cache', path.join(os.tmpdir(), 'word-weaver-es-cache'));
const COUNT = Number(arg('--levels', 2000));
const FRESH = args.includes('--fresh');
const OUT = path.join(ROOT, 'word-weaver/data/es');
const SEED = 20261029;
const GRID_RANK = 12000;   // a short (3-4 letter) Hard/Expert grid word is among these
const EASY_RANK = 15000;   // the Easy/Medium list (BANDS' rank caps cut it further)
const HARD_RANK = 30000;
const WORD = /^[a-zñ]{3,7}$/;
// Read by hand 2026-10-29, still accepted as extras: words whose subtitle count belongs to their Ñ twin (subtitles
// drop the tilde: ANO is mostly AÑO), abbreviations, names and English the lists let through.
const GRID_BLOCK = new Set(`ano anos danes cia seo dea are sir dom nasa tesla cross stand single suite tour set top test pop yes
fans master masters charter aspen alien lord peralta mateo adama
`.split(/\s+/).filter(Boolean));

// Other forms of vulgar words the plural rule does not reach; and plain words the lists catch
// (BLOCK_RE's foll- and coñ-, BLOCK's cono = cone, LDNOOBW's asno, maciza and trio), all read by hand 2026-11-01.
export const VULGAR_TOO = new Set('maldita malditas sadica sadicas bollero bolleros pajera pajeras'.split(' '));
export const VULGAR_OK = new Set('asno asnos asna asnas coñac coñacs follaje follajes folleto folletos follon follones trio trios cono conos maciza macizas'.split(' '));
const PLURAL_OK = new Set(['pises']);   // pisar, not pis + es

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
    rank.set(f, i + 1);   // the line number (the 2026-11-01 review's rank)
    said.set(f, Number(n) || 0);
  }
  const fromA = [];
  for (const w of A) { const v = variants.get(w); if (v) fromA.push(...v); else fromA.push(w); }
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'spelling-bee/data/bee.json'), 'utf8'));
  const english = new Set(`${en.words} ${en.extra}`.split(' '));

  // --- the lists ---
  const isName = (w) => (names.has(w) || NOT_ANSWERS.has(w)) && !NAME_WORDS.has(w);
  // Vulgar and adult words, with their plurals: out of the grid AND, since 2026-11-01, out of the extras
  // too (English's rule; slurs were already out). VULGAR_TOO and VULGAR_OK were read by hand that day.
  const vulgar1 = (w) => !VULGAR_OK.has(w) && (bad.has(w) || BLOCK_RE.test(w) || ADULT_SKIP.has(w) || SLURS.has(w) || VULGAR_TOO.has(w));
  const vulgar = (w) => vulgar1(w) || (w.endsWith('s') && vulgar1(w.slice(0, -1))) || (w.endsWith('es') && !PLURAL_OK.has(w) && vulgar1(w.slice(0, -2)));
  const accepted = new Set([...fromA, ...B].filter((w) => WORD.test(w)));
  const common = [...L].filter((w) => WORD.test(w) && !accepted.has(w) && rank.has(w) && !names.has(w)
    && (!SKIP.has(w) || ADULT_SKIP.has(w)) && (!english.has(w) || SPANISH_TOO.has(w)));
  const all = [...new Set([...accepted, ...common])].filter((w) => !isName(w));
  const extra = all.filter((w) => !vulgar(w)).sort();
  // A grid word is a DICTIONARY word or one of its conjugations (`accepted`), never only a subtitle word (SET, STOP, JET).
  const gridOk = (w) => accepted.has(w) && L.has(w) && rank.has(w) && !NOT_ANSWERS.has(w) && !isName(w) && !GRID_BLOCK.has(w);
  // The grid lists, one bit each (English's): 1 Easy/Medium, 2 Hard, 4 Expert; a 3- or 4-letter Hard/Expert
  // word must be among the GRID_RANK most said. Plus every accepted COMMON word (lists 0 if never a grid word).
  const vocab = [];
  for (const w of extra) {
    const k = rank.get(w) ?? Infinity, ok = gridOk(w), shortOk = w.length >= 5 || k <= GRID_RANK;
    const lists = (ok && k <= EASY_RANK ? 1 : 0) | (ok && shortOk && k <= HARD_RANK ? 2 : 0) | (ok && shortOk ? 4 : 0);
    if (lists || k <= COMMON) vocab.push({ w, rank: k, lists });
  }
  console.log(`grid ${vocab.filter((v) => v.lists & 1).length}, hard ${vocab.filter((v) => v.lists & 2).length}, expert ${vocab.filter((v) => v.lists & 4).length}, extra ${extra.length}, common extras never in a grid ${vocab.filter((v) => !v.lists).length}`);

  // --- the levels (English's ladder) ---
  const kept = [];
  if (!FRESH && fs.existsSync(path.join(OUT, 'index.json'))) {
    const ix = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
    for (let k = 0; k * CHUNK < ix.count; k++) kept.push(...JSON.parse(fs.readFileSync(path.join(OUT, `levels-${k}.json`), 'utf8')).levels);
  }
  const levels = makeLadder({ count: COUNT, seed: SEED, vocab, extra, kept, A: { counts, maskOf, fitsIn, sortKey }, log: console.log });
  writeLevels(OUT, levels);
  const rk = (w) => rank.get(w.toLowerCase()) ?? Infinity;
  writeRanks(path.join(ROOT, 'tools/word-weaver-ranks-es.txt'), levels, rk, 'FrequencyWords es 2018 (es_50k.txt line number, accents off, Ñ kept)');
  console.log(`levels ${levels.length} (kept ${kept.length}), Ñ levels ${levels.filter((lv) => lv.l.includes('Ñ')).length}`);
  report(levels, rk, console.log);
}

// word-weaver/js/data-test-es.js imports the hand lists above; main runs only when called.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
