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
// THE RAMP (plan): 1-100 Easy (3 letters, par 3-4; 4 letters once the 3-letter pairs run out), 101-250 Medium (4 letters, par 4-5),
// 251-400 Hard (5 letters, par 4-6), 401-500 Expert (6 letters, par 4-6) (2026-11-14; until then Hard/Expert were 4-5 letters).
// `--keep-all` (2026-11-19): every level and daily stays; only par and the hint path are worked out again (new words).
// `--keep-through 250` (used 2026-11-14) keeps levels 1-250 and every daily as shipped and remakes only 251-500. Bands: word-ladder/js/engine.js.
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
const MAX_USES = 3;
const KEEP_ALL = process.argv.includes('--keep-all');
const KEEP = (() => { const i = process.argv.indexOf('--keep-through'); return i > 0 ? Number(process.argv[i + 1]) | 0 : 0; })();   // a word is a start or target at most this often per language

// Rude words and their forms (both languages; Word Weaver's and Spelling Bee's block lists, short form). Never a hint
// when a clean shortest path exists. Anchored at both ends, so GRAPE, SCRAPE, ASSET and TITLE are untouched.
const RUDE = {
  en: new RegExp('^(' + ['ASS(ES)?', 'ARSES?', 'BITCH(ES|ED|Y)?', 'BOOBS?', 'BUTTS?', 'COCKS?', 'CRAP(S|PY|PED)?', 'CUNTS?', 'DAMN(S|ED)?',
    'DICKS?', 'DILDOS?', 'DYKES?', 'FAGS?', 'FART(S|ED)?', 'FUCK\\w*', 'HOMOS?', 'JIZZ', 'NIGG\\w*', 'NUDES?', 'PENIS', 'PISS(ED|ES)?',
    'POOPS?', 'PORNO?S?', 'PRICKS?', 'PUSSY', 'RAP(E|ES|ED|ER|IST)', 'SEX(Y|ES)?', 'SHIT\\w*', 'SLUTS?', 'TITS?', 'TITTY', 'TURDS?',
    'TWATS?', 'WANK\\w*', 'WHORES?'].join('|') + ')$'),
  es: new RegExp('^(' + ['PUT(A|O|AS|OS)', 'CUL(O|OS)', 'MIERDA', 'COÑ(O|A|AZO)', 'POLL(A|AS)', 'VERG(A|AS)', 'PENES?', 'TET(A|AS)', 'CAGON',
    'HUEVON', 'PICHA', 'JOD\\w*', 'MAMADA', 'PAJ(A|ERO)', 'ZORRAS?', 'MARIC\\w*', 'FOLL\\w*', 'CABRON\\w*', 'PEDOS?', 'CHINGA\\w*',
    'PENDEJ\\w*', 'PINCHE', 'NAZIS?', 'VAGINA'].join('|') + ')$'),
};

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
  if (lang === 'es') {
    // Spanish (2026-11-19 review): Boggle's list has NO conjugated verbs (HABLAN, LEE, COMEN refused) and folds Ñ to N
    // (SENOR accepted, the real SEÑOR only from Word Weaver). tools/word-ladder-es-forms.txt (lemmatization-lists, ODbL;
    // written by --fetch-es-forms) brings every inflected form whose lemma or form is in Boggle's list, and gives each
    // Boggle word its Ñ spelling where the spelled list has it (Spelling Bee's `variants`): PENA and PEÑA, SENOR and SEÑOR.
    // Only forms said in films and TV (FrequencyWords es top 50k) come in: every form of every verb in the dictionary
    // made Expert ladders 2 moves long through words nobody uses (BOLLAS, DABAS).
    const { all: L, brought } = loadEsForms();
    const spell = new Map();   // N-folded -> the spellings seen in the spelled list
    for (const w of L) { const k = w.replace(/Ñ/g, 'N'); if (!spell.has(k)) spell.set(k, []); spell.get(k).push(w); }
    for (const raw of broad) {
      const w = raw.trim().toUpperCase();
      if (!w) continue;
      // The folded spelling stays accepted too: a word once accepted is never refused later (a saved ladder could hold
      // it, and taking a word out can make an existing level's par longer).
      set.add(w);
      for (const x of spell.get(w) || []) set.add(x);
    }
    for (const w of brought) set.add(w);
    for (const w of ADD_ES) set.add(w);
  } else {
    for (const w of broad) set.add(w.trim().toUpperCase());
    for (const w of ADD_EN) set.add(w);
  }
  const ok = lang === 'es' ? /^[A-ZÑ]{3,6}$/ : /^[A-Z]{3,6}$/;
  return { all: [...set].filter((w) => ok.test(w)), grid };
}
// Everyday English that ENABLE (1990s) does not carry (2026-11-19 review: EMAIL, APP and SELFIE were refused). Steps only:
// never a start or target (those are Word Weaver grid words).
const ADD_EN = `APP APPS BLOG BLOGS BLOGGED VLOG VLOGS EMAIL EMAILS EMOJI EMOJIS SELFIE ONLINE MEME MEMES TEXTED TEXTER
WIFI WEBSITE PODCAST INBOX UNDO EMAILED`.split(/\s+/).filter(Boolean);

// Everyday Spanish neither list carries (2026-11-19 review, each read by hand from the words said in films and TV that
// lemmatization-lists has but Boggle's list lacks, names and brands left out; the rude ones read too (CAGON, COÑAZO) are left out because a shortcut through one became a hint).
const ADD_ES = `MAMI PAPI LINAJE NIÑEZ ANTAÑO AIRBAG ALITAS BOLITA CAJITA CODAZO COPITA COSITA CULITO MUCAMA OJITOS PAJITA PALITO
PELAJE PLAZOS RIMEL ROÑOSO TRULLO YUANES OVEROL MANDON GUASON CARDIO BURO BIFE GATITO GATITA OSITO OSITA NIÑITO NIÑITA
MAMITA PAPITO BESITO CARITA CASITA PERRITO`.split(/\s+/).filter(Boolean);

/** tools/word-ladder-es-forms.txt: { all: every 3-6 letter lemma and form of lemmatization-lists (accents off, Ñ kept),
 *  brought: the forms whose lemma or form is in Boggle's list (marked +) }. */
const ES_FORMS = path.join(ROOT, 'tools/word-ladder-es-forms.txt');
function loadEsForms() {
  const all = [], brought = [];
  for (const line of fs.readFileSync(ES_FORMS, 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const [w, f] = line.split(' ');
    all.push(w);
    if (f === '+') brought.push(w);
  }
  return { all, brought };
}
/** --fetch-es-forms: download lemmatization-lists (Spanish) once and write tools/word-ladder-es-forms.txt (committed, so
 *  a normal run stays offline). */
async function fetchEsForms() {
  const URL_ = 'https://raw.githubusercontent.com/michmech/lemmatization-lists/master/lemmatization-es.txt';
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`${URL_}: HTTP ${res.status}`);
  const txt = (await res.text()).replace(/^\uFEFF/, '');
  const fold = (w) => w.toUpperCase().normalize('NFD').replace(/([AEIOU])[\u0300-\u036f]/g, '$1').replace(/N\u0303/g, 'Ñ').normalize('NFC');
  const FREQ = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt';
  const fr = await fetch(FREQ);
  if (!fr.ok) throw new Error(`${FREQ}: HTTP ${fr.status}`);
  const said = new Set();
  for (const line of (await fr.text()).split(/\r?\n/)) { const w = (line.split(' ')[0] || '').trim(); if (w) { const f = fold(w); said.add(f); said.add(f.replace(/Ñ/g, 'N')); } }
  const boggle = new Set(fs.readFileSync(path.join(ROOT, 'boggle/data/words-es.txt'), 'utf8').split(/\r?\n/).map((w) => w.trim()));
  const flat = (w) => w.replace(/Ñ/g, 'N');
  const WORD = /^[A-ZÑ]{3,6}$/;
  const all = new Map();
  for (const line of txt.split(/\r?\n/)) {
    const [lemma, form] = line.split('\t');
    if (!lemma || !form || /[^a-záéíóúüñ]/.test(lemma) || /[^a-záéíóúüñ]/.test(form)) continue;
    const L = fold(lemma), F = fold(form);
    if (WORD.test(L) && !all.has(L)) all.set(L, false);
    if (WORD.test(F)) all.set(F, all.get(F) || ((boggle.has(flat(L)) || boggle.has(flat(F))) && (said.has(F) || said.has(flat(F)))));
  }
  // A verb form with its pronoun joined on (DEJAME, VERTE, PONTE, DIGAME, OIRLO: lemmatization-lists has none of them),
  // when it is said in films and TV. The verb form = a form whose lemma is an -AR, -ER or -IR verb.
  const verbForm = new Set();
  for (const line of txt.split(/\r?\n/)) {
    const [lemma, form] = line.split('\t');
    if (lemma && form && /(ar|er|ir|ír)$/.test(lemma) && !/[^a-záéíóúüñ]/.test(form + lemma)) { verbForm.add(fold(form)); verbForm.add(fold(lemma)); }
  }
  const CLITIC = ['NOS', 'LOS', 'LAS', 'LES', 'ME', 'TE', 'SE', 'LO', 'LA', 'LE'];
  // Names the rule would catch (each read 2026-11-19).
  const NAMES = new Set('ADELA ADELE DANTE DOYLE ESME LEILA MANILA MANOLO ORESTE SALOME TOOLE VILA VILO VALA CARLA CARLO CARLOS MARLA MARLO'.split(' '));
  for (const w of said) {
    if (!WORD.test(w) || w.length < 4 || all.get(w) || NAMES.has(w)) continue;
    if (CLITIC.some((c) => w.endsWith(c) && w.length - c.length >= 2 && verbForm.has(w.slice(0, -c.length)))) all.set(w, true);
  }
  const head = '# GENERATED by tools/build-word-ladder-data.mjs --fetch-es-forms: never hand-edit.\n' +
    '# lemmatization-lists Spanish (Michal Boleslav Mechura, ODbL 1.0, https://github.com/michmech/lemmatization-lists):\n' +
    '# every lemma and form of 3-6 letters, accents off, Ñ kept. "+" = brought in as a Word Ladder step (its lemma or the\n' +
    '# form is in boggle/data/words-es.txt, and the form is in FrequencyWords es 2018 top 50k, Hermit Dave, CC BY-SA 4.0).\n' +
    '# Also "+": a said word that is a verb form with a pronoun joined on (DEJAME, VERTE). The rest only give Boggle\n' +
    '# words their Ñ spelling.\n';
  fs.writeFileSync(ES_FORMS, head + [...all].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([w, b]) => (b ? w + ' +' : w)).join('\n') + '\n');
  console.log('es forms', all.size, 'brought', [...all.values()].filter(Boolean).length);
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
  // 2026-11-14 (Matt: "How do I get longer words?"): Hard = 5-letter words, Expert = 6-letter words, each its own difficulty.
  if (n <= 400) return [{ len: 5, p: [4, 6], cap: 7000 }, { len: 5, p: [4, 6], cap: 15000 }, { len: 4, p: [6, 8], cap: 9000 }];
  // 6-letter grid words rarely chain into each other, so an Expert ladder's MIDDLE steps may be any accepted word
  // (anyPath); its start and target stay common grid words, and par is still the true minimum.
  return [{ len: 6, p: [4, 6], cap: 9000 }, { len: 6, p: [4, 6], cap: 20000, anyPath: true }, { len: 6, p: [3, 6], cap: 60000, anyPath: true }, { len: 5, p: [6, 8], cap: 12000 }];
}
const dailyPlan = (d) => [...(d % 3 === 2 ? [{ len: 5, p: [4, 5], cap: 6000 }, { len: 4, p: [4, 6], cap: 6000 }] : [{ len: 4, p: [4, 6], cap: 6000 }, { len: 5, p: [4, 5], cap: 6000 }]),
  // Spanish runs out of common pairs: then less common words (still on the cleaned list).
  { len: 4, p: [4, 6], cap: 15000 }, { len: 5, p: [4, 5], cap: 15000 }, { len: 4, p: [4, 6], cap: 30000 }, { len: 5, p: [4, 5], cap: 30000 }];

function build(lang) {
  const { all: words, grid } = loadWords(lang);
  const ranks = loadRanks(lang);
  // Grid words first (common and hand-checked), then the rest of the accepted list, each by how often it is said.
  // A rude word is still a legal step (Matt: ASS "is" a word) but sorts LAST, so the hint and the hint path take it only
  // when every shortest path needs it (2026-11-19 review: the hint showed TIT, BITCH, RAPE, PISS and CUNT).
  const rank = (w) => (RUDE[lang].test(w) ? 4 * RARE : 0) + (grid.has(w) ? 0 : RARE) + (ranks.get(w) ?? RARE);
  const byLen = {};
  for (const w of words) (byLen[w.length] ||= []).push(w);
  for (const k of Object.keys(byLen)) byLen[k].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const graphs = {};
  const gridGraphs = {};
  for (const k of Object.keys(byLen)) { graphs[k] = graph(byLen[k]); gridGraphs[k] = graph(byLen[k].filter((w) => grid.has(w))); }
  const used = new Set();
  const uses = new Map();
  let R = rng(lang === 'es' ? 9173 : 4421);
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
          for (const [t, dd] of d) if (dd === p && (spec.anyPath || dg.get(t) === p) && commonSet.has(t) && !used.has([s, t].sort().join('-'))) ts.push(t);
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
  let daily = [];
  const dirIn = path.join(ROOT, 'word-ladder/data', lang);
  if (KEEP) {
    // --keep-through N: levels 1..N and EVERY daily stay exactly as shipped; only N+1.. are made again (their own seed).
    const oldL = JSON.parse(fs.readFileSync(path.join(dirIn, 'levels.json'), 'utf8')).levels;
    daily = JSON.parse(fs.readFileSync(path.join(dirIn, 'daily.json'), 'utf8')).levels;
    for (const l of [...oldL.slice(0, KEEP), ...daily]) {
      used.add([l.s, l.t].sort().join('-'));
      uses.set(l.s, (uses.get(l.s) || 0) + 1); uses.set(l.t, (uses.get(l.t) || 0) + 1);
    }
    levels.push(...oldL.slice(0, KEEP));
    const R2 = rng((lang === 'es' ? 9173 : 4421) + 7 * KEEP);
    R = R2;
  }
  if (KEEP_ALL) {
    // --keep-all (2026-11-19, the word-list review): EVERY level and daily keeps its start and target and its number; only
    // its par and hint path are worked out again over the new word list (par stays the true minimum, so a level can get
    // SHORTER when a new word opens a shortcut). The changes are printed, so a session can list them.
    const oldL = JSON.parse(fs.readFileSync(path.join(dirIn, 'levels.json'), 'utf8')).levels;
    const oldD = JSON.parse(fs.readFileSync(path.join(dirIn, 'daily.json'), 'utf8')).levels;
    const redo = (l, where) => {
      const nb = graphs[l.s.length];
      const p = bfs(nb, l.t).get(l.s);
      if (!(p >= 1)) throw new Error(`${lang} ${where}: ${l.s} -> ${l.t} no longer joins`);
      const h = p === l.p && l.h.split(' ').every((w) => nb.has(w) && !RUDE[lang].test(w)) ? l.h : bestPath(nb, l.s, l.t, rank).join(' ');
      if (p !== l.p) console.log(`PAR ${lang} ${where} ${l.s}->${l.t}: ${l.p} -> ${p} (${h})`);
      return { s: l.s, t: l.t, p, h };
    };
    levels.push(...oldL.map((l, i) => redo(l, 'level ' + (i + 1))));
    daily = oldD.map((l, i) => redo(l, 'day ' + i));
  }
  for (let n = levels.length + 1; n <= LEVELS; n++) { levels.push(pick(plan(n))); if (n % 50 === 0) console.log(lang, 'level', n); }
  if (!KEEP && !KEEP_ALL) for (let d = 0; d < DAILY; d++) { daily.push(pick(dailyPlan(d))); if (d % 100 === 0) console.log(lang, 'day', d); }
  const dir = path.join(ROOT, 'word-ladder/data', lang);
  fs.mkdirSync(dir, { recursive: true });
  const w = {};
  for (const k of ['3', '4', '5', '6']) w[k] = (byLen[k] || []).join(' ');
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify({ v: 1, w }) + '\n');
  const lines = (arr) => '[\n' + arr.map((l) => JSON.stringify(l)).join(',\n') + '\n]';
  fs.writeFileSync(path.join(dir, 'levels.json'), `{"v":1,"count":${levels.length},"levels":${lines(levels)}}\n`);
  fs.writeFileSync(path.join(dir, 'daily.json'), `{"v":1,"epoch":"${EPOCH}","count":${daily.length},"levels":${lines(daily)}}\n`);
  console.log(lang, 'words', Object.fromEntries(Object.entries(byLen).map(([k, v]) => [k, v.length])), 'levels', levels.length, 'daily', daily.length);
}

if (process.argv.includes('--fetch-es-forms')) await fetchEsForms();
else for (const lang of ['en', 'es']) build(lang);
