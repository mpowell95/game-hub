// build-contexto-data.mjs - GENERATOR for contexto/data/{en,es}.{json,bin} (Contexto's word
// data). Run it, then `node validate-sw-assets.mjs`, then commit the data files and sw.js.
//
//   node build-contexto-data.mjs [--lang en|es] [--cache <dir>] [--top 200000]
//
// Behind a proxy (a cloud session), prefix NODE_USE_ENV_PROXY=1 so Node's fetch uses it.
//
// WHAT CONTEXTO NEEDS
// -------------------
// Every guess is ranked by how close its MEANING is to the secret word: rank 1 is the word, rank
// 2 the closest word in the language, and so on down the whole vocabulary. "Close in meaning"
// comes from a pre-trained word-vector model: every word is a list of 300 numbers, and words used
// in similar contexts end up pointing the same way (cosine similarity).
//
// SOURCES (downloaded, never committed; cached in --cache, default <os tmp>/contexto-cache)
//   * fastText Common Crawl vectors, cc.en.300 / cc.es.300 (Facebook AI Research, CC BY-SA 3.0,
//     https://fasttext.cc/docs/en/crawl-vectors.html). The .vec files are sorted by frequency, so
//     only the first --top lines are streamed (~70 MB of a 1.3 GB download).
//   * lemmatization-lists (Michal Mechura, ODbL, github.com/michmech/lemmatization-lists): which
//     tokens are inflected FORMS of another word ("cats" -> "cat", "hablando" -> "hablar").
//   * LDNOOBW bad-word lists (CC BY 4.0): dropped from the vocabulary entirely.
//   * English also filters through boggle/data/words.txt (ENABLE, public domain) and Spanish
//     through boggle/data/words-es.txt, so web junk ("thats", "alot", misspellings) is not a word.
//   Credits: contexto/data/CREDITS.md.
//
// WHAT IS WRITTEN, PER LANGUAGE
//   <lang>.json  { v, dim, k, words: [...], forms: {form: lemmaIndex}, secrets: [wordIndex...] }
//                words are LEMMAS only, most frequent first. A guess that is an inflected form is
//                mapped to its lemma, so "cats" and "cat" are one guess, not two.
//   <lang>.bin   [ scales: dim x Float32 ][ vectors: N x dim x Int8 ][ neighbours: S x K x Uint16 ]
//                vectors are the full 300-d vectors projected onto their top `dim` principal
//                components and quantized per component (scales[] turns an int8 back into a float).
//                neighbours are, for each secret, the EXACT top-K closest words computed at full
//                300-d float precision. So ranks 2..K+1 are exact; beyond that the game ranks the
//                remaining words by the compressed vectors. Measured: 64-d PCA keeps ~60% of an
//                exact top-100 but only has to order words that are already past rank K, where a
//                few hundred places either way is invisible. 300-d int8 would be exact everywhere
//                but ~9 MB per language; this is ~3 MB.
//
// THE DAILY ORDER IS APPEND-ONLY. Puzzle #n is secrets[(n-1) % count]. Adding words to the END of a
// SECRETS list keeps every earlier puzzle number meaning the same word; inserting or reordering
// would silently change what "#12" was for anyone comparing. Saved progress is keyed by the word
// itself (contexto/js/ui.js), so it survives either way.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LANGS = arg('--lang') ? [arg('--lang')] : ['en', 'es'];
const CACHE = arg('--cache', path.join(os.tmpdir(), 'contexto-cache'));
const TOP = Number(arg('--top', 200000));
const DIM = 64;       // PCA components shipped
const K = 1000;       // exact neighbours per secret
const MAX_VOCAB = 40000;

const SRC = {
  vec: (l) => `https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.${l}.300.vec.gz`,
  lem: (l) => `https://raw.githubusercontent.com/michmech/lemmatization-lists/master/lemmatization-${l}.txt`,
  bad: (l) => `https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/${l}`,
};

// Everyday words the dictionaries are too old or too formal to carry. Only ever ADDS guessable
// words; a word here still has to be in the vector file.
const EXTRA = {
  en: ['online', 'website', 'email', 'internet', 'app', 'smartphone', 'podcast', 'wifi', 'blog',
    'christmas', 'healthcare', 'laptop', 'selfie', 'emoji', 'offline', 'download', 'upload',
    'homepage', 'inbox', 'username', 'password', 'software', 'hardware', 'video', 'pizza'],
  es: ['internet', 'email', 'online', 'blog', 'video', 'software', 'fútbol', 'pizza', 'wifi',
    'web', 'app', 'selfie', 'emoji', 'taxi', 'hotel', 'robot', 'lunes', 'martes', 'miércoles',
    'jueves', 'viernes', 'sábado', 'domingo', 'cumpleaños', 'paraguas', 'rompecabezas', 'tijeras',
    'vacaciones', 'gafas', 'crisis', 'virus', 'análisis', 'dosis', 'tenis'],
};

// The bad-word lists are written for content filters and catch ordinary words a player will
// type ("martillo", "asno", "escort"). These stay guessable.
const NOT_BAD = {
  en: ['escort', 'suck', 'snatch', 'domination', 'butt', 'eunuch', 'bastinado'],
  es: ['asesinato', 'asno', 'drogas', 'heroína', 'infierno', 'maldito', 'martillo', 'orina', 'pis',
    'caca', 'pedo', 'idiota', 'imbécil', 'racista', 'nazi', 'concha', 'fiesta'],
};

// The secret words. APPEND ONLY (see header). Common, concrete-leaning nouns a family would know.
const SECRETS = {
  en: `animal apple army art baby bag ball balloon banana band bank barn baseball basket bath beach
bean bear bed bee beer bell belt bicycle bird birthday blanket boat body bone book bottle box brain
bread bridge brother brush bubble bucket building bus butter butterfly button cake camera camp
candle candy captain car card carpet carrot castle cat cave chair cheese chicken child chocolate
church circle city class clock cloud clown coat coffee coin college computer cookie corn cow crab
crown cup dance desert desk diamond dinner doctor dog doll dollar door dragon dream dress drum duck
eagle earth egg elephant engine eye face family farm father feather fence finger fire fish flag
flower fog food football forest fork fountain fox friend frog fruit game garden garlic ghost gift
giraffe glass glove gold grass guitar hair hammer hand hat heart helicopter hill holiday honey
horse hospital hotel house ice island jacket jail jewel juice jungle key kitchen kite knife ladder
lake lamp language leaf lemon letter library light lion lizard lock love magic map market mask
medicine milk mirror money monkey moon mother mountain mouse mouth movie museum music nail needle
nest newspaper night nose ocean office oil onion orange owl paint palace pancake paper park party
pencil penguin pepper piano picture pig pillow pilot pirate pizza planet plant plate pocket poem
police pool potato prison queen rabbit radio rain rainbow restaurant rice ring river road robot
rock rocket roof rope rose salt sand school science sea shadow sheep shell ship shirt
shoe shop sister skeleton sky sleep snake snow soap soccer sock soldier song soup spider spoon
sport spring star station stone storm street sugar summer sun sword table tea teacher tooth
telephone television tent theater thunder tiger toilet tomato tongue towel tower toy tractor train
treasure tree truck turtle umbrella uniform university vacation valley vegetable village violin
volcano wall wallet war watch water wave wedding whale wheel wind window wine winter wing wolf
wood world worm zoo anger beauty danger death fear freedom health history hope idea joy luck
memory peace power silence time truth weather wisdom energy justice adventure travel work airport
alarm anchor angel arrow avocado bakery battery blood bomb bowl breakfast bride cabbage cactus
calendar canoe carnival cereal chess chimney cinema circus cliff closet compass costume cotton
crayon crocodile cucumber daisy dentist diary dinosaur dolphin donkey dust electricity envelope
factory flute freezer galaxy gasoline glacier goat grape hamburger harbor helmet hurricane insect
jellyfish kangaroo king knight lighthouse lobster magnet mail marriage meat microphone mushroom
necklace octopus orchestra oven oxygen painter parrot passport peanut pearl perfume phone
photograph pie pineapple pumpkin puzzle pyramid recipe refrigerator saddle salad sandwich
satellite sausage scarf shark shower skull sled smoke snail spaghetti sponge squirrel stadium
stamp statue strawberry submarine suitcase sunflower swamp swan tail taxi telescope tennis thief
ticket toast tornado tunnel vampire vase wagon waterfall wizard zebra`,
  es: `animal manzana ejército arte bebé bolsa pelota globo plátano banco granero cesta baño playa
oso cama abeja cerveza campana cinturón bicicleta pájaro cumpleaños manta barco cuerpo hueso
libro botella caja cerebro pan puente hermano cepillo burbuja cubo edificio autobús mantequilla
mariposa botón pastel cámara vela dulce capitán coche carta alfombra zanahoria castillo gato cueva
silla queso pollo niño chocolate iglesia círculo ciudad reloj nube payaso abrigo café moneda
universidad galleta maíz vaca cangrejo corona taza baile desierto escritorio diamante
cena médico perro muñeca dólar puerta dragón sueño vestido tambor pato águila tierra huevo
elefante motor ojo cara familia granja padre pluma valla dedo fuego pescado bandera flor niebla
comida fútbol bosque tenedor fuente zorro amigo rana juego jardín ajo fantasma regalo
jirafa vaso guante oro hierba guitarra pelo martillo mano sombrero corazón helicóptero colina
vacaciones miel caballo hospital hotel casa hielo isla chaqueta cárcel joya jugo selva llave
cocina cometa cuchillo escalera lago lámpara idioma hoja limón biblioteca luz león lagarto candado
amor magia mapa mercado máscara medicina leche espejo dinero mono luna madre montaña ratón boca
película museo música clavo aguja nido periódico noche nariz océano oficina aceite cebolla naranja
búho pintura palacio papel parque fiesta lápiz pingüino pimienta piano cuadro cerdo almohada piloto
pirata pizza planeta planta plato bolsillo poema policía piscina patata prisión reina conejo radio
lluvia restaurante arroz anillo río camino robot roca cohete techo cuerda rosa sal arena
escuela ciencia tijeras mar sombra oveja concha camisa zapato tienda hermana esqueleto cielo
serpiente nieve jabón calcetín soldado canción sopa araña cuchara deporte primavera estrella
estación piedra tormenta calle azúcar verano sol espada mesa té maestro diente teléfono televisión
teatro trueno tigre tomate lengua toalla torre juguete tractor tren tesoro árbol camión tortuga
paraguas uniforme valle verdura pueblo violín volcán pared cartera guerra agua ola boda ballena
rueda viento ventana vino invierno ala lobo madera mundo gusano zoológico miedo belleza peligro
muerte libertad salud historia esperanza idea alegría suerte memoria paz poder silencio tiempo
verdad clima sabiduría energía justicia aventura viaje trabajo aeropuerto alarma ancla ángel
flecha aguacate panadería sangre bomba desayuno repollo cactus calendario canoa carnaval
cereal ajedrez chimenea cine circo acantilado armario brújula disfraz algodón cocodrilo pepino
dentista diario dinosaurio delfín burro polvo electricidad fábrica flauta galaxia gasolina glaciar
cabra uva hamburguesa puerto casco huracán insecto medusa canguro rey caballero faro langosta imán
carne micrófono champiñón collar pulpo orquesta horno oxígeno pintor loro pasaporte cacahuete
perla perfume fotografía piña calabaza rompecabezas pirámide receta nevera ensalada sándwich
satélite salchicha bufanda tiburón ducha calavera trineo humo caracol espagueti esponja ardilla
estadio sello estatua fresa submarino maleta girasol pantano cisne cola taxi telescopio tenis
ladrón billete túnel vampiro florero carreta cascada mago cebra`,
};

// The daily order: the list above, shuffled with a FIXED seed so it is the same on every build.
// The shuffle covers this one block. To add words later, add a second block and append its
// (separately shuffled) words AFTER this one - never re-shuffle the first, or every past puzzle
// number changes its word (see "APPEND-ONLY" in the header).
function shuffled(list, seedText) {
  let h = 2166136261;
  for (const ch of 'contexto-' + seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

async function cached(name, url, { gzLines } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, 'utf8');
  console.log(`  fetching ${url}${gzLines ? ` (first ${gzLines} lines)` : ''}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!gzLines) {
    const text = await res.text();
    fs.writeFileSync(file, text);
    return text;
  }
  // Stream-gunzip and stop after gzLines lines: the vectors are frequency-sorted, so the head of
  // the file is exactly the part worth having.
  const gunzip = zlib.createGunzip();
  const reader = res.body.getReader();
  const chunks = [];
  let lines = 0, done = false;
  gunzip.on('data', (buf) => {
    if (done) return;
    let s = buf.toString('latin1');
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 10 && ++lines >= gzLines) { chunks.push(buf.subarray(0, i + 1)); done = true; return; }
    }
    chunks.push(buf);
  });
  const finished = new Promise((resolve, reject) => { gunzip.on('end', resolve); gunzip.on('error', (e) => (done ? resolve() : reject(e))); });
  while (!done) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    if (!gunzip.write(value)) await new Promise((r) => gunzip.once('drain', r));
  }
  reader.cancel().catch(() => {});
  gunzip.end();
  await Promise.race([finished, new Promise((r) => setTimeout(r, 2000))]);
  const text = Buffer.concat(chunks).toString('utf8');
  fs.writeFileSync(file, text);
  return text;
}

// Symmetric eigen-decomposition (cyclic Jacobi). 300x300 converges in about a second.
function jacobi(A, n) {
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q];
      if (Math.abs(apq) < 1e-18) continue;
      const th = (A[q * n + q] - A[p * n + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const a = A[k * n + p], b = A[k * n + q]; A[k * n + p] = c * a - s * b; A[k * n + q] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = A[p * n + k], b = A[q * n + k]; A[p * n + k] = c * a - s * b; A[q * n + k] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = V[k * n + p], b = V[k * n + q]; V[k * n + p] = c * a - s * b; V[k * n + q] = s * a + c * b; }
    }
  }
  return { vals: Array.from({ length: n }, (_, i) => A[i * n + i]), V };
}

async function build(lang) {
  console.log(`\n== ${lang} ==`);
  const lemText = await cached(`lem-${lang}.txt`, SRC.lem(lang));
  const badText = await cached(`bad-${lang}.txt`, SRC.bad(lang));
  const vecText = await cached(`${lang}.vec`, SRC.vec(lang), { gzLines: TOP + 1 });

  const formOf = new Map(), isLemma = new Set();
  for (const line of lemText.replace(/^﻿/, '').split(/\r?\n/)) {
    const [a, b] = line.split('\t');
    if (!b) continue;
    const lemma = a.toLowerCase(), form = b.toLowerCase().trim();
    isLemma.add(lemma);
    if (!formOf.has(form)) formOf.set(form, lemma);
  }
  const bad = new Set(badText.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  for (const w of NOT_BAD[lang]) bad.delete(w);
  const dictFile = path.join(ROOT, 'boggle/data', lang === 'en' ? 'words.txt' : 'words-es.txt');
  const dict = new Set(fs.readFileSync(dictFile, 'utf8').toLowerCase().split(/\r?\n/));
  const extra = new Set(EXTRA[lang]);
  const letters = lang === 'en' ? /^[a-z]+$/ : /^[a-zñáéíóúü]+$/;
  const inDict = lang === 'en'
    ? (w) => dict.has(w) || isLemma.has(w) || formOf.has(w) || extra.has(w)
    : (w) => isLemma.has(w) || formOf.has(w) || extra.has(w) || dict.has(fold(w));

  // Pass 1: every clean token, frequency order, with its vector.
  const cand = [];            // { w, v }
  const seenFold = new Set();
  const lines = vecText.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const sp = lines[i].indexOf(' ');
    if (sp < 0) continue;
    const w = lines[i].slice(0, sp);
    if (!letters.test(w) || w.length < 2 || bad.has(w) || !inDict(w)) continue;
    // Spanish: an unaccented spelling of a word already seen ("colchon" after "colchón") is a
    // typo, unless the lemma list knows it as its own word ("papa" and "papá").
    const f = fold(w);
    if (lang === 'es' && seenFold.has(f) && !isLemma.has(w)) continue;
    seenFold.add(f);
    const nums = lines[i].slice(sp + 1).trim().split(' ');
    if (nums.length !== 300) continue;
    const v = new Float32Array(300);
    let n = 0;
    for (let k = 0; k < 300; k++) { v[k] = +nums[k]; n += v[k] * v[k]; }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < 300; k++) v[k] /= n;
    cand.push({ w, v });
  }
  const candSet = new Set(cand.map((c) => c.w));

  // Pass 2: split lemmas from forms. A token the lemma list only knows as a FORM goes to its
  // lemma. English plurals the list misses ("playlists") fall back to a suffix rule.
  const lemmaOf = (w) => {
    if (isLemma.has(w) || extra.has(w)) return null;
    // Spanish: "martillo" is listed only as a conjugation of "martillar" ("yo martillo"), which
    // would turn a noun into a verb. Boggle's list carries no conjugated forms, so a word it knows
    // that is not a gerund/participle is a word in its own right.
    if (lang === 'es' && formOf.has(w) && /(ar|er|ir)$/.test(formOf.get(w))
      && dict.has(fold(w)) && !/(ando|iendo|[ai]d[oa]s?)$/.test(w)) return null;
    if (formOf.has(w)) return formOf.get(w);
    if (lang === 'en') {
      if (w.endsWith('ies') && candSet.has(w.slice(0, -3) + 'y')) return w.slice(0, -3) + 'y';
      if (w.endsWith('es') && candSet.has(w.slice(0, -2))) return w.slice(0, -2);
      if (w.endsWith('s') && !w.endsWith('ss') && candSet.has(w.slice(0, -1))) return w.slice(0, -1);
    } else if (w.endsWith('s')) {
      if (candSet.has(w.slice(0, -1))) return w.slice(0, -1);
      if (w.endsWith('es') && candSet.has(w.slice(0, -2))) return w.slice(0, -2);
    }
    return null;
  };
  const vocab = [];
  const pendingForms = [];
  for (const c of cand) {
    const l = lemmaOf(c.w);
    if (l && l !== c.w) { pendingForms.push([c.w, l]); continue; }
    if (vocab.length < MAX_VOCAB) vocab.push(c);
  }
  const index = new Map(vocab.map((c, i) => [c.w, i]));
  const forms = {};
  for (const [f, l] of pendingForms) if (index.has(l) && !index.has(f)) forms[f] = index.get(l);
  const N = vocab.length;
  console.log(`  vocab ${N} lemmas, ${Object.keys(forms).length} forms mapped`);

  // Secrets: must be vocabulary words. A missing one is reported and skipped, never guessed at.
  const secrets = [];
  const missing = [];
  for (const w of shuffled([...new Set(SECRETS[lang].split(/\s+/).filter(Boolean))], lang)) {
    if (index.has(w)) secrets.push(index.get(w)); else missing.push(w);
  }
  if (missing.length) console.log(`  secrets NOT in vocab (skipped): ${missing.join(' ')}`);
  console.log(`  ${secrets.length} secrets`);

  // PCA of the (mean-centred) vocabulary.
  const D = 300;
  const mean = new Float64Array(D);
  for (const c of vocab) for (let k = 0; k < D; k++) mean[k] += c.v[k] / N;
  const C = new Float64Array(D * D);
  const r = new Float64Array(D);
  for (const c of vocab) {
    for (let k = 0; k < D; k++) r[k] = c.v[k] - mean[k];
    for (let a = 0; a < D; a++) { const ra = r[a]; if (!ra) continue; for (let b = a; b < D; b++) C[a * D + b] += ra * r[b]; }
  }
  for (let a = 0; a < D; a++) for (let b = 0; b < a; b++) C[a * D + b] = C[b * D + a];
  const { vals, V } = jacobi(C, D);
  const order = [...vals.keys()].sort((a, b) => vals[b] - vals[a]).slice(0, DIM);
  const proj = new Float32Array(N * DIM);
  for (let i = 0; i < N; i++) {
    const v = vocab[i].v;
    for (let j = 0; j < DIM; j++) {
      const col = order[j];
      let s = 0;
      for (let k = 0; k < D; k++) s += (v[k] - mean[k]) * V[k * D + col];
      proj[i * DIM + j] = s;
    }
  }
  const scales = new Float32Array(DIM);
  for (let j = 0; j < DIM; j++) { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(proj[i * DIM + j])); scales[j] = m / 127 || 1; }
  const q = new Int8Array(N * DIM);
  for (let i = 0; i < N; i++) for (let j = 0; j < DIM; j++) q[i * DIM + j] = Math.max(-127, Math.min(127, Math.round(proj[i * DIM + j] / scales[j])));

  // Exact neighbours at full precision.
  const nb = new Uint16Array(secrets.length * K);
  const sims = new Float32Array(N);
  const idx = new Uint32Array(N);
  secrets.forEach((s, si) => {
    const sv = vocab[s].v;
    for (let i = 0; i < N; i++) { const v = vocab[i].v; let d = 0; for (let k = 0; k < D; k++) d += v[k] * sv[k]; sims[i] = d; idx[i] = i; }
    sims[s] = Infinity;
    const top = Array.from(idx).sort((a, b) => sims[b] - sims[a] || a - b).slice(1, K + 1);
    nb.set(top, si * K);
  });

  const outDir = path.join(ROOT, 'contexto/data');
  fs.mkdirSync(outDir, { recursive: true });
  const json = { v: 1, lang, dim: DIM, k: K, words: vocab.map((c) => c.w), forms, secrets };
  fs.writeFileSync(path.join(outDir, `${lang}.json`), JSON.stringify(json));
  const bin = Buffer.concat([Buffer.from(scales.buffer), Buffer.from(q.buffer), Buffer.from(nb.buffer)]);
  fs.writeFileSync(path.join(outDir, `${lang}.bin`), bin);
  const kb = (b) => (b / 1024).toFixed(0) + ' KB';
  console.log(`  wrote ${lang}.json ${kb(JSON.stringify(json).length)}, ${lang}.bin ${kb(bin.length)}`);
  const show = (w) => { const si = secrets.indexOf(index.get(w)); if (si < 0) return; console.log(`  ${w}: ${Array.from(nb.subarray(si * K, si * K + 15)).map((i) => vocab[i].w).join(' ')}`); };
  (lang === 'en' ? ['cat', 'winter', 'music'] : ['gato', 'invierno', 'música']).forEach(show);
}

for (const l of LANGS) await build(l);
