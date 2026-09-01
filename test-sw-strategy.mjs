// test-sw-strategy.mjs - headless tests for sw.js's CACHING STRATEGY (2026-08-02).
//
// Why this exists: the service worker is the one file in the repo that every screen depends on and
// that no other suite touched. Its two strategy bugs were both invisible on a fast desktop
// connection and both showed up on a phone with poor service:
//
//   1. `cache.addAll(ASSETS)` precached ~8.8 MB across ~272 files ATOMICALLY on every deploy, so the
//      install storm competed with the foreground page for the same connection - and one 404'd path
//      aborted the whole install, stranding the deploy (the "version pill stuck at vN -> vN+1"
//      failure the root CLAUDE.md documents).
//   2. Network-first only fell back to cache when the fetch FAILED. A weak-but-alive signal never
//      fails, it just takes seconds per request, so every module in the graph paid that latency.
//
// The tests below pin the fixed behaviour of both. They run the REAL sw.js source in a `vm` sandbox
// with a fake `caches`/`fetch`/`Request`, so they cannot drift from the shipped file the way a
// hand-transcribed copy of its logic would. They are honest about their scope: this proves the
// strategy's decision-making, not that a real browser's ServiceWorkerGlobalScope behaves the same.
//
// Run: node test-sw-strategy.mjs   (also wired into run-all-tests.mjs)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SW_SRC = readFileSync(join(ROOT, 'sw.js'), 'utf8');

const ORIGIN = 'https://example.test';

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`ok    ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- the fake worker environment ---------------------------------------------------------------

class FakeResponse {
  constructor(body, { ok: isOk = true, tag = '' } = {}) { this.body = body; this.ok = isOk; this.tag = tag; }
  clone() { return new FakeResponse(this.body, { ok: this.ok, tag: this.tag }); }
  async json() { return JSON.parse(this.body); }
}

class FakeRequest {
  constructor(input, init = {}) {
    if (input instanceof FakeRequest) {
      this.url = input.url; this.method = input.method; this.mode = input.mode;
    } else {
      this.url = new URL(String(input), ORIGIN + '/').href;
      this.method = 'GET'; this.mode = 'no-cors';
    }
    if (init.method) this.method = init.method;
    if (init.mode) this.mode = init.mode;
    this.cache = init.cache || 'default';
  }
}

/** Cache keys ignore the query string, mirroring the handler's own `{ ignoreSearch: true }`. */
function keyOf(reqOrUrl) {
  const href = reqOrUrl instanceof FakeRequest ? reqOrUrl.url : new URL(String(reqOrUrl), ORIGIN + '/').href;
  const u = new URL(href);
  return u.origin + u.pathname;
}

class FakeCache {
  constructor() { this.map = new Map(); }
  async put(req, res) { this.map.set(keyOf(req), res); }
  async match(req) { return this.map.get(keyOf(req)) || undefined; }
  async addAll(paths) {
    // Atomic, exactly like the real thing: any miss rejects and NOTHING is written.
    const got = [];
    for (const p of paths) {
      const res = await this.fetchImpl(new FakeRequest(p));
      if (!res || !res.ok) throw new Error(`addAll failed on ${p}`);
      got.push([keyOf(p), res]);
    }
    for (const [k, v] of got) this.map.set(k, v);
  }
}

/** Builds a sandbox and evaluates the real sw.js in it. `net` decides what the network does.
 *  Pass `src` to boot a MODIFIED worker source (the deploy-bump probes), and `existingCaches`
 *  to hand a new worker the cache state a previous one left behind - which is exactly what a
 *  real browser does across a deploy. */
function bootWorker({ net, src = SW_SRC, existingCaches } = {}) {
  const listeners = {};
  const caches = existingCaches || new Map();
  const logs = [];

  const fetchImpl = async (req) => net(req instanceof FakeRequest ? req : new FakeRequest(req));

  const cachesApi = {
    async open(name) {
      if (!caches.has(name)) { const c = new FakeCache(); c.fetchImpl = fetchImpl; caches.set(name, c); }
      return caches.get(name);
    },
    async keys() { return [...caches.keys()]; },
    async delete(name) { return caches.delete(name); },
    async match(req) {
      for (const c of caches.values()) { const hit = await c.match(req); if (hit) return hit; }
      return undefined;
    },
  };

  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    // A real ServiceWorkerGlobalScope's location is a full WorkerLocation at the worker's own
    // URL, and sw.js resolves its relative ASSETS paths against it (REST_PATHS). Modelling it
    // as an origin alone made the sandbox lie about the one thing this file exists to check.
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js`, pathname: '/sw.js' },
  };

  const sandbox = {
    self, caches: cachesApi, fetch: fetchImpl,
    Request: FakeRequest, Response: FakeResponse, URL, Symbol, Promise, Error, JSON, Math, Array, Object,
    setTimeout, clearTimeout,
    console: { warn: (...a) => logs.push(a.join(' ')), log: () => {}, error: (...a) => logs.push(a.join(' ')) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sw.js' });

  /** Drive an event the way the browser would, resolving whatever the handler passed to waitUntil. */
  const fire = async (type, extra = {}) => {
    let waited = null, responded = null;
    const event = {
      ...extra,
      waitUntil: (p) => { waited = p; },
      respondWith: (p) => { responded = p; },
    };
    listeners[type](event);
    if (waited) await waited;
    return responded ? await responded : undefined;
  };

  return { fire, caches, cachesApi, logs, sandbox };
}

const CACHE_NAME = /const CACHE = '([^']+)'/.exec(SW_SRC)[1];

// The real ASSETS/SHELL/REST arrays, pulled from the file itself so the tests describe the shipped
// list rather than a guess at it (the same extraction trick validate-sw-assets.mjs uses).
const buildSrc = SW_SRC.slice(SW_SRC.indexOf('const ASSETS = ['), SW_SRC.indexOf("self.addEventListener('install'"));
const { ASSETS, SHELL, REST, REST_MANIFEST, MANIFEST_KEY, NETWORK_FIRST, SHELL_CACHE_FIRST } =
  new Function(`${buildSrc}\nreturn { ASSETS, SHELL, REST, REST_MANIFEST, MANIFEST_KEY, `
    + `NETWORK_FIRST, SHELL_CACHE_FIRST };`)();

/** The warm is fire-and-forget from activate, so probes wait for its own completion signal:
 *  the manifest it writes as its second-to-last act (cleanup of old caches is the last). */
async function drainWarm(w, cacheName, maxMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    const c = w.caches.get(cacheName);
    if (c && c.map.has(keyOf(MANIFEST_KEY))) return true;
    if (Date.now() - t0 > maxMs) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
}

// --- 1. the install is small and atomic; the heavy tier is NOT part of it -----------------------

console.log('\n--- install: shell only ---');

ok('SHELL + REST partition ASSETS exactly',
  SHELL.length + REST.length === ASSETS.length && new Set([...SHELL, ...REST]).size === new Set(ASSETS).size);

ok('the shell is a small fraction of the full list',
  SHELL.length < ASSETS.length / 4, `shell ${SHELL.length} of ${ASSETS.length}`);

for (const must of ['./', './index.html', './css/hub.css', './js/hub.js', './manifest.webmanifest']) {
  ok(`shell contains ${must}`, SHELL.includes(must));
}
for (const heavy of ['./boggle/data/words.txt', './ball-run/vendor/three.module.min.js']) {
  ok(`the heavy asset ${heavy} is NOT in the blocking install`, !SHELL.includes(heavy) && REST.includes(heavy));
}

{
  const requested = [];
  const w = bootWorker({ net: async (req) => { requested.push(new URL(req.url).pathname); return new FakeResponse('x'); } });
  await w.fire('install');
  const cache = w.caches.get(CACHE_NAME);
  eq('install caches exactly the shell', cache.map.size, new Set(SHELL.map(keyOf)).size);
  ok('install never requested the Boggle dictionary', !requested.some((p) => p.includes('words.txt')));
  ok('install never requested three.js', !requested.some((p) => p.includes('three.module')));
}

// --- 2. [KNOWN-BUG PROBE] one 404 in the heavy tier no longer strands the whole deploy ----------
//
// REGRESSION GUARD: this is the exact failure the root CLAUDE.md's "version pill stuck at vN -> vN+1"
// diagnostic describes. Before the split, ONE missing game asset aborted cache.addAll(ASSETS) and the
// previous worker kept serving the old build offline forever, with no other visible symptom.

console.log('\n--- [KNOWN-BUG PROBE] a missing game asset must not abort the install ---');

{
  const dead = REST.find((p) => p.endsWith('.js')) || REST[0];
  const w = bootWorker({
    net: async (req) => (keyOf(req) === keyOf(dead)
      ? new FakeResponse('not found', { ok: false })
      : new FakeResponse('x')),
  });
  let installFailed = false;
  try { await w.fire('install'); } catch { installFailed = true; }
  ok(`install still succeeds with ${dead} 404ing`, !installFailed);

  await w.fire('activate');
  // The warm is deliberately fire-and-forget (it must not block functional events), so wait for
  // its own completion signal before asserting on the result.
  ok('the warm still completes with the bad path in the list', await drainWarm(w, CACHE_NAME));

  const cache = w.caches.get(CACHE_NAME);
  ok('the shell is cached despite the bad path', cache.map.has(keyOf('./index.html')));
  ok('every OTHER heavy asset still got cached', cache.map.has(keyOf(REST.find((p) => p !== dead))));
  ok('the failure was logged loudly, not swallowed (THE LAW rule 6)',
    w.logs.some((l) => l.includes('could not be precached') && l.includes(dead)),
    `logs: ${JSON.stringify(w.logs).slice(0, 300)}`);
}

// --- 3. the fetch deadline: a slow network must not hold the page hostage -----------------------

console.log('\n--- fetch: network-first with a deadline ---');

const NET_TIMEOUT_MS = Number(/const NET_TIMEOUT_MS = (\d+)/.exec(SW_SRC)[1]);
ok('NET_TIMEOUT_MS is a sane deadline (0.5s-5s)', NET_TIMEOUT_MS >= 500 && NET_TIMEOUT_MS <= 5000, `got ${NET_TIMEOUT_MS}`);

/** Seed a worker whose cache already holds `path` with the given body, then fetch it. */
// NOTE the default path: it must be one of the NETWORK_FIRST modules (2026-09-01). ./js/hub.js was
// the default until the shell split, and every probe below silently stopped exercising the
// network-first branch the moment the launcher went cache-first.
async function fetchWith({ cachedBody, netBody, netDelayMs, netFails = false, path = './js/game-stats.js', mode = 'no-cors' }) {
  const w = bootWorker({
    net: async () => {
      if (netDelayMs) await new Promise((r) => setTimeout(r, netDelayMs));
      if (netFails) throw new Error('offline');
      return new FakeResponse(netBody, { tag: 'net' });
    },
  });
  const cache = await w.cachesApi.open(CACHE_NAME);
  if (cachedBody !== undefined) await cache.put(new FakeRequest(path), new FakeResponse(cachedBody, { tag: 'cache' }));
  const res = await w.fire('fetch', { request: new FakeRequest(path, { mode }) });
  return { res, w, cache };
}

{
  const t0 = Date.now();
  const { res, cache } = await fetchWith({ cachedBody: 'OLD', netBody: 'NEW', netDelayMs: NET_TIMEOUT_MS + 400 });
  const elapsed = Date.now() - t0;
  eq('a network slower than the deadline serves the CACHED copy', res.body, 'OLD');
  ok('and it does so at roughly the deadline, not the network latency',
    elapsed < NET_TIMEOUT_MS + 300, `waited ${elapsed}ms with a ${NET_TIMEOUT_MS + 400}ms network`);

  // The slow response must still land in the cache, or the next load repeats the same slow path.
  await new Promise((r) => setTimeout(r, 600));
  const after = await cache.match(new FakeRequest('./js/game-stats.js'));
  eq('the slow response still refreshes the cache in the background', after.body, 'NEW');
}

{
  const { res } = await fetchWith({ cachedBody: 'OLD', netBody: 'NEW', netDelayMs: 5 });
  eq('a fast network still wins the race (freshness is unchanged online)', res.body, 'NEW');
}

{
  const { res } = await fetchWith({ cachedBody: 'OLD', netFails: true });
  eq('a failed request falls back to cache', res.body, 'OLD');
}

{
  const t0 = Date.now();
  const { res } = await fetchWith({ cachedBody: undefined, netBody: 'ONLY', netDelayMs: NET_TIMEOUT_MS + 300 });
  eq('with NOTHING cached, the slow network is awaited rather than failed', res.body, 'ONLY');
  ok('which means that request legitimately outlasts the deadline',
    Date.now() - t0 >= NET_TIMEOUT_MS, 'a deadline with no fallback would only turn slow into broken');
}

{
  // Offline navigation with nothing cached for that URL: the hub shell is the last resort.
  const w = bootWorker({ net: async () => { throw new Error('offline'); } });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put(new FakeRequest('./'), new FakeResponse('SHELL'));
  const res = await w.fire('fetch', { request: new FakeRequest('./chinchon/', { mode: 'navigate' }) });
  eq('an offline navigation with no cached page falls back to the hub shell', res.body, 'SHELL');
}

// --- 3b. the "network is bad right now" latch ---------------------------------------------------
//
// The deadline alone is charged PER REQUEST, and a hub cold start is a serial chain (index.html ->
// hub.js -> the modules it imports -> the modules THEY import). Without the latch every hop pays the
// full deadline again for a build already sitting complete in the cache.

console.log('\n--- fetch: the slow-connection latch ---');

{
  const SLOW_LATCH_MS = Number(/const SLOW_LATCH_MS = (\d+)/.exec(SW_SRC)[1]);
  ok('SLOW_LATCH_MS is short enough to recover on its own (<= 60s)', SLOW_LATCH_MS <= 60000, `got ${SLOW_LATCH_MS}`);

  let netCalls = 0;
  const w = bootWorker({
    net: async () => { netCalls++; await new Promise((r) => setTimeout(r, NET_TIMEOUT_MS + 500)); return new FakeResponse('NEW'); },
  });
  const cache = await w.cachesApi.open(CACHE_NAME);
  // All three must be NETWORK_FIRST paths, or the latch is never even consulted.
  for (const p of ['./js/game-stats.js', './js/stats-net.js', './js/players-agg.js']) {
    await cache.put(new FakeRequest(p), new FakeResponse('CACHED:' + p));
  }

  const t0 = Date.now();
  const first = await w.fire('fetch', { request: new FakeRequest('./js/game-stats.js') });
  const afterFirst = Date.now() - t0;
  eq('the first slow request still serves cache', first.body, 'CACHED:./js/game-stats.js');
  ok('and it paid the deadline once', afterFirst >= NET_TIMEOUT_MS - 100, `took ${afterFirst}ms`);

  const t1 = Date.now();
  const second = await w.fire('fetch', { request: new FakeRequest('./js/stats-net.js') });
  const third = await w.fire('fetch', { request: new FakeRequest('./js/players-agg.js') });
  const afterRest = Date.now() - t1;
  eq('the next request is served from cache', second.body, 'CACHED:./js/stats-net.js');
  eq('and the one after that too', third.body, 'CACHED:./js/players-agg.js');
  ok('neither re-paid the deadline (the chain costs one stall, not one per module)',
    afterRest < 500, `two further requests took ${afterRest}ms; without the latch they would take ~${NET_TIMEOUT_MS * 2}ms`);
  ok('the latched requests still went to the network to refresh the cache', netCalls >= 3, `netCalls=${netCalls}`);

  // A latched request with NOTHING cached must not be short-circuited into a failure.
  const t2 = Date.now();
  const miss = await w.fire('fetch', { request: new FakeRequest('./js/never-cached.js') });
  eq('a latched request with no cached copy still waits for the network', miss.body, 'NEW');
  ok('which is the only correct answer there', Date.now() - t2 >= NET_TIMEOUT_MS);
}

// --- 4. images stay cache-first (unchanged behaviour, guarded) ----------------------------------

console.log('\n--- fetch: images remain cache-first ---');

{
  let hitNetwork = false;
  const w = bootWorker({ net: async () => { hitNetwork = true; return new FakeResponse('NEW'); } });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put(new FakeRequest('./chinchon/decks/anita/oros-6.webp'), new FakeResponse('CACHED'));
  const res = await w.fire('fetch', { request: new FakeRequest('./chinchon/decks/anita/oros-6.webp') });
  eq('a cached image is served from cache', res.body, 'CACHED');
  ok('and never touches the network (card boards must not flash blank)', !hitNetwork);
}

// --- 4b. game code (the REST tier) is cache-first ----------------------------------------------
//
// [KNOWN-BUG PROBE] Born red on 2026-09-01 against the network-first worker. Matt, on a screen
// recording from Anita's phone of opening Skeeball: "Why does it take so long? It needs to be
// better than this." With the whole game verifiably already in this cache, opening it still sent
// 28 requests and 2,188 KB to the server, because network-first only falls back to cache when the
// network LOSES the deadline race. The deadline capped how bad that got; it never stopped it.

console.log('\n--- fetch: game code is served from cache, not re-downloaded ---');

{
  const restJs = REST.find((p) => p.startsWith('./skeeball/js/') && p.endsWith('.js'));
  ok('the REST tier contains skeeball code to test with', !!restJs, `REST has ${REST.length} entries`);

  let hitNetwork = false;
  const w = bootWorker({ net: async () => { hitNetwork = true; return new FakeResponse('NEW'); } });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put(new FakeRequest(restJs), new FakeResponse('CACHED'));
  const res = await w.fire('fetch', { request: new FakeRequest(restJs) });
  eq(`[KNOWN-BUG PROBE] a cached game module is served from cache (${restJs})`, res.body, 'CACHED');
  ok('[KNOWN-BUG PROBE] and never touches the network (was: 2,188 KB re-downloaded per open)',
    !hitNetwork, 'network-first re-fetched every module in the game on every single open');
}

// [KNOWN-BUG PROBE] Born red on 2026-09-01 against the worker that shipped the cache-first split
// hours earlier. A REST file with nothing in the cache falls through to a network fetch whose
// response is written into the CURRENT cache -- and that fetch was a PLAIN fetch(req). The
// browser's HTTP disk cache sits between the worker and the wire (Pages sends max-age=600), so
// within ten minutes of a deploy it answers with the PREVIOUS build's bytes, which then land in
// the new cache under the new name. warmRest() skips anything already present, and every later
// deploy carries it forward (the manifest hash it is stored against is the correct one -- only
// the bytes are wrong), so the device serves the old file for ever while its version pill reads
// the new build. Measured in a real Chromium: after the server changed the file, a plain fetch in
// a service worker returned the OLD body and `cache: 'reload'` returned the new one.

{
  const restCss = REST.find((p) => p.endsWith('.css'));
  ok('the REST tier contains a stylesheet to test with', !!restCss, `REST has ${REST.length} entries`);

  let sawCacheMode = null;
  const w = bootWorker({ net: async (req) => { sawCacheMode = req && req.cache; return new FakeResponse('NEW'); } });
  await w.fire('fetch', { request: new FakeRequest(restCss) });
  eq(`[KNOWN-BUG PROBE] an uncached REST file is fetched with cache:'reload' (${restCss})`,
    sawCacheMode, 'reload');
}

{
  // The shell SPLIT (2026-09-01): a module that touches player data still prefers the network...
  let hitNetwork = false;
  const w = bootWorker({ net: async () => { hitNetwork = true; return new FakeResponse('NEW'); } });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put(new FakeRequest('./js/game-stats.js'), new FakeResponse('CACHED'));
  const res = await w.fire('fetch', { request: new FakeRequest('./js/game-stats.js') });
  eq('a player-data shell module still prefers the network (Matt: keep the stats code fresh)', res.body, 'NEW');
  ok('...which means it did go to the network', hitNetwork);
}

{
  // ...and the rest of the shell does not. This assertion replaced its own opposite: until
  // 2026-09-01 it read "a SHELL module still prefers the network", using this very path.
  let hitNetwork = false;
  const w = bootWorker({ net: async () => { hitNetwork = true; return new FakeResponse('NEW'); } });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put(new FakeRequest('./js/hub.js'), new FakeResponse('CACHED'));
  const res = await w.fire('fetch', { request: new FakeRequest('./js/hub.js') });
  eq('[KNOWN-BUG PROBE] the launcher itself is served from cache (was: 687 KB re-downloaded per launch)',
    res.body, 'CACHED');
  ok('[KNOWN-BUG PROBE] and never touches the network', !hitNetwork,
    'the whole shell was network-first, so opening the app re-downloaded it every single time');
}

{
  // Nothing cached yet (a new device, or mid-warm): cache-first must fall through, not fail.
  const restJs = REST.find((p) => p.startsWith('./skeeball/js/') && p.endsWith('.js'));
  const w = bootWorker({ net: async () => new FakeResponse('FROM-NET') });
  const res = await w.fire('fetch', { request: new FakeRequest(restJs) });
  eq('a game module with nothing cached still comes off the network', res.body, 'FROM-NET');
  const cache = await w.cachesApi.open(CACHE_NAME);
  const after = await cache.match(new FakeRequest(restJs));
  eq('...and is written into the cache for next time', after.body, 'FROM-NET');
}

{
  // A standalone game page is a DOCUMENT. Answering it from cache would hide a new deploy from
  // the one request that is supposed to reveal it.
  const restPage = REST.find((p) => p.endsWith('/index.html'));
  let hitNetwork = false;
  const w = bootWorker({ net: async () => { hitNetwork = true; return new FakeResponse('NEW PAGE'); } });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put(new FakeRequest(restPage), new FakeResponse('CACHED PAGE'));
  const res = await w.fire('fetch', { request: new FakeRequest(restPage, { mode: 'navigate' }) });
  eq(`a standalone game NAVIGATION is not answered from cache (${restPage})`, res.body, 'NEW PAGE');
  ok('...which is how a device still discovers a new deploy', hitNetwork);
}

// --- 5. non-GET is left alone ------------------------------------------------------------------

{
  const w = bootWorker({ net: async () => new FakeResponse('x') });
  const res = await w.fire('fetch', { request: new FakeRequest('./js/hub.js', { method: 'POST' }) });
  eq('a non-GET request is not intercepted at all', res, undefined);
}

// --- 6. an error RESPONSE is not an answer ------------------------------------------------------
// [KNOWN-BUG PROBE] Born red on 2026-08-11. Only a THROWN fetch counted as failure, so a 404 or a
// 503 was handed straight to the page even with a good cached copy in hand. GitHub Pages serves a
// redeploy by swapping the published tree, so a request landing in that window can 404 for a
// moment - and opening the hub during a deploy handed the page a 404 for css/hub.css and rendered
// the launcher as raw unstyled HTML. Matt hit exactly that, minutes after a deploy, on mobile
// data; a force-close "fixed" it, which is what a transient server error always looks like.

{
  const w = bootWorker({ net: async () => new FakeResponse('404 not found', { ok: false, tag: 'NET-404' }) });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put('./css/hub.css', new FakeResponse('.hub{}', { ok: true, tag: 'CACHED' }));
  const res = await w.fire('fetch', { request: new FakeRequest('./css/hub.css') });
  ok('[KNOWN-BUG PROBE] a 404 does not beat a good cached copy (the unstyled-launcher bug)',
    !!(res && res.ok && res.tag === 'CACHED'),
    `got ${res ? `${res.tag} ok=${res.ok}` : 'nothing'} - the page would render unstyled`);
}

{
  const w = bootWorker({ net: async () => new FakeResponse('503', { ok: false, tag: 'NET-503' }) });
  const res = await w.fire('fetch', { request: new FakeRequest('./js/hub.js') });
  ok('...but with NOTHING cached, the error response is still passed through honestly',
    !!(res && res.ok === false && res.tag === 'NET-503'),
    'a request with no cached copy has nothing better to offer, and must not invent one');
}

// --- 7. the manifest-driven warm: a deploy must not re-download the whole REST tier -------------
// [KNOWN-BUG PROBE] Born red on 2026-08-23 against the pre-manifest worker. CACHE is bumped on
// essentially every commit (~13 deploys/day when this landed), and every bump rolled the cache
// name over, so warmRest() re-downloaded the ENTIRE ~11 MB REST tier on nearly every open of the
// hub - measured at 347 requests / 12.6 MB per deploy, which is the "launcher got laggy" report:
// the storm saturated the connection for the whole session on any device that opened the hub
// after a deploy. The REST_MANIFEST content hashes are what let the warm tell "unchanged" (GitHub
// Pages re-stamps every mtime/ETag per deploy, so HTTP validators cannot), and the old cache is
// the copy source.

console.log('\n--- [KNOWN-BUG PROBE] a CACHE bump carries unchanged REST files forward ---');

{
  // Deploy 1: a fresh device installs and warms in full (that part is expected and unchanged).
  let netPaths = [];
  const recorder = async (req) => { netPaths.push(new URL(req.url).pathname); return new FakeResponse('gen1'); };
  const w1 = bootWorker({ net: recorder });
  await w1.fire('install');
  await w1.fire('activate');
  ok('deploy 1: the fresh-install warm completes', await drainWarm(w1, CACHE_NAME));
  const restFetches1 = netPaths.filter((p) => REST.some((r) => keyOf(r) === ORIGIN + p)).length;
  ok('deploy 1: a fresh device fetches the whole REST tier (nothing to carry yet)',
    restFetches1 >= REST.length - 1, `fetched ${restFetches1} of ${REST.length}`);

  // Deploy 2: CACHE bumped, manifest UNCHANGED (the overwhelmingly common deploy).
  const bumped = SW_SRC.replace(/const CACHE = 'game-hub-v(\d+)'/, (_, n) => `const CACHE = 'game-hub-v${Number(n) + 1000}'`);
  const BUMPED_NAME = /const CACHE = '([^']+)'/.exec(bumped)[1];
  netPaths = [];
  const w2 = bootWorker({ net: recorder, src: bumped, existingCaches: w1.caches });
  await w2.fire('install');
  await w2.fire('activate');
  ok('deploy 2: the warm completes', await drainWarm(w2, BUMPED_NAME));
  const restFetches2 = netPaths.filter((p) => REST.some((r) => keyOf(r) === ORIGIN + p)).length;
  eq('[KNOWN-BUG PROBE] deploy 2 re-downloads ZERO unchanged REST files (was: all 292)', restFetches2, 0);
  const newCache = w2.caches.get(BUMPED_NAME);
  ok('every REST entry was carried into the new cache anyway',
    REST.every((p) => newCache.map.has(keyOf(p))),
    'carried-forward entries must be present, not merely skipped');
  ok('the old cache is deleted once the warm is done (still exactly one generation at rest)',
    !w2.caches.has(CACHE_NAME));

  // Deploy 3: one REST file actually changed (its hash differs) - that one, and only that one,
  // must be re-fetched. A manifest that carried a CHANGED file forward would serve stale bytes
  // to the cache-first image path forever, which is the one invariant the old full re-download
  // bought; this probe is what proves the manifest keeps it.
  const changedPath = REST.find((p) => REST_MANIFEST[p]);
  const bumped3 = bumped
    .replace(/const CACHE = '([^']+)'/, `const CACHE = 'game-hub-v99999'`)
    .replace(`'${changedPath}': '${REST_MANIFEST[changedPath]}'`, `'${changedPath}': 'aaaaaaaaaa'`);
  netPaths = [];
  const w3 = bootWorker({ net: recorder, src: bumped3, existingCaches: w2.caches });
  await w3.fire('install');
  await w3.fire('activate');
  ok('deploy 3: the warm completes', await drainWarm(w3, 'game-hub-v99999'));
  const restFetches3 = netPaths.filter((p) => REST.some((r) => keyOf(r) === ORIGIN + p));
  eq('a changed hash re-fetches exactly that file', restFetches3.length, 1);
  ok('...and it is the changed file', restFetches3[0] === new URL(keyOf(changedPath)).pathname,
    `fetched ${restFetches3[0]}`);
}

// --- 8. mid-warm, the previous deploy's cache still answers -------------------------------------
// The old delete-at-activate behaviour opened a window on EVERY deploy where games had no cache
// at all: the old cache was gone and the new one held only the shell, so any game opened during
// the warm queued behind it on the network (and was broken offline). Old caches now live until
// the warm finishes - and the CURRENT cache must win when both hold an entry, because
// caches.match searches in cache-CREATION order, which would hand back the older copy.

console.log('\n--- fetch: current cache beats a lingering older generation ---');

{
  const w = bootWorker({ net: async () => { throw new Error('offline'); } });
  const older = await w.cachesApi.open('game-hub-v1');       // created FIRST, like a real leftover
  const current = await w.cachesApi.open(CACHE_NAME);
  await older.put(new FakeRequest('./js/hub.js'), new FakeResponse('STALE', { tag: 'old-gen' }));
  await current.put(new FakeRequest('./js/hub.js'), new FakeResponse('FRESH', { tag: 'current' }));
  const res = await w.fire('fetch', { request: new FakeRequest('./js/hub.js') });
  eq('the CURRENT cache answers even though the older cache was created first', res.body, 'FRESH');

  const onlyOld = await w.fire('fetch', { request: new FakeRequest('./css/hub.css') }).catch(() => null);
  // Seed only the old generation for a second path. It must be one that is STILL network-first,
  // or this probe silently stops exercising the network-first fallback it exists for: ./css/ went
  // cache-first in the 2026-09-01 shell split.
  await older.put(new FakeRequest('./js/stats-net.js'), new FakeResponse('OLD-ONLY'));
  const res2 = await w.fire('fetch', { request: new FakeRequest('./js/stats-net.js') });
  eq('an entry only the older generation holds still answers mid-warm (no dead window)', res2.body, 'OLD-ONLY');
}

// --- 8b. the shell split: the hand-written fresh list must not drift ----------------------------
//
// Matt chose "keep the stats code fresh" over caching the whole shell, and accepted that the list
// is hand-maintained ON CONDITION that something fails when a data module goes missing from it.
// This is that something. Everything here is structural: it reads sw.js and the files on disk, so
// a module ADDED tomorrow is covered the day it is written, not the day someone remembers it.

console.log('\n--- the shell split: NETWORK_FIRST vs SHELL_CACHE_FIRST ---');

{
  ok('sw.js exposes both halves of the split', Array.isArray(NETWORK_FIRST) && Array.isArray(SHELL_CACHE_FIRST),
    `NETWORK_FIRST=${typeof NETWORK_FIRST}, SHELL_CACHE_FIRST=${typeof SHELL_CACHE_FIRST}`);

  // 1. No phantom entries. A rename (js/messages.js -> js/msgs.js) would otherwise silently DEMOTE
  //    a player-data module to cache-first, with nothing anywhere reporting it.
  const phantom = NETWORK_FIRST.filter((p) => !ASSETS.includes(p));
  ok('every NETWORK_FIRST path exists in ASSETS (a rename cannot silently demote a data module)',
    phantom.length === 0, `not in ASSETS: ${phantom.join(', ')}`);

  // 2. The drift guard. Any shell module that TOUCHES PLAYER DATA must be network-first.
  //
  //    GUARD: THIS IS DELIBERATELY NOT TRANSITIVE, AND MUST NOT BE "FIXED" INTO A CLOSURE.
  //    js/hub.js is cache-first and statically imports js/profile-store.js, which is network-first.
  //    That is correct: ES modules are fetched per URL, so one graph is served from both places at
  //    once and each file gets the freshness it asked for. Following imports here would drag
  //    hub.js, name-gate.js and announce.js into NETWORK_FIRST and delete the entire point of the
  //    split - a 687 KB re-download on every launch.
  //    The test is "does this file WRITE player data", not "does it import something that does".
  //    A first draft used the import edge too and immediately flagged js/hub.js and
  //    js/name-gate.js for importing profile-store.js - which is a one-hop transitive closure,
  //    i.e. precisely the mistake the guard above forbids. Calling loadProfile() does not make a
  //    file a data module; owning the write does.
  const DATA_WRITE = /localStorage\.(setItem|removeItem)\s*\(\s*[`'"]?gamehub\./;
  const leaked = [];
  for (const rel of SHELL_CACHE_FIRST) {
    if (!/^\.\/js\/.*\.js$/.test(rel)) continue;
    let src;
    try { src = readFileSync(join(ROOT, rel.slice(2)), 'utf8'); } catch { continue; }
    if (DATA_WRITE.test(src)) leaked.push(`${rel} (writes a gamehub.* localStorage key)`);
  }
  ok('[KNOWN-BUG PROBE] no cache-first shell module touches player data', leaked.length === 0,
    `${leaked.join('\n      ')}\n      -> add it to NETWORK_FIRST in sw.js, or stop it touching player data.`
    + '\n      Do NOT make this check transitive - read the guard above it first.');

  // 3. Positive pins: nobody can quietly empty the cache-first half back into network-first.
  for (const must of ['./js/hub.js', './css/hub.css', './css/ui.css', './js/game-art.js', './js/strings.js']) {
    ok(`${must} is cache-first (the launch path stays off the network)`, SHELL_CACHE_FIRST.includes(must));
  }
  // ...and the reverse: the modules Matt explicitly wanted fresh.
  for (const must of ['./js/game-stats.js', './js/stats-net.js', './js/players-agg.js', './js/leaderboard-ui.js']) {
    ok(`${must} is network-first (Matt: keep the stats code fresh)`, NETWORK_FIRST.includes(must));
  }
}

{
  // 4. [KNOWN-BUG PROBE] sw.js must NEVER be answered from cache.
  //
  // js/hub.js's _latestVersion() asks the network what is deployed. If that answer can come from
  // the cache, `running === latest` for ever: the version pill can never go stale and _forceUpdate
  // never reloads, so a device can sit on an old build with the UI insisting it is current.
  // sw.js is safe by CONSTRUCTION - CACHE_FIRST_PATHS is an allow-list built from ASSETS, and
  // sw.js is not in ASSETS - which is exactly the property this probe pins. Note the worker is
  // ALREADY in the cache in real life: the network-first branch's background put writes it there.
  ok('sw.js is not in ASSETS (the allow-list cannot reach it)', !ASSETS.includes('./sw.js'));
  let hitNetwork = false;
  const w = bootWorker({ net: async () => { hitNetwork = true; return new FakeResponse('DEPLOYED'); } });
  const cache = await w.cachesApi.open(CACHE_NAME);
  await cache.put(new FakeRequest('./sw.js'), new FakeResponse('STALE-COPY'));
  const res = await w.fire('fetch', { request: new FakeRequest('./sw.js') });
  eq('[KNOWN-BUG PROBE] a cached sw.js never beats the network (the version pill must not freeze)',
    res.body, 'DEPLOYED');
  ok('...which means the version check really did leave the device', hitNetwork);
}

{
  // 5. version.json is the pill's source and must match CACHE, or the pill lies. It is also
  //    deliberately OUT of ASSETS, for the same reason as sw.js above.
  let v = null;
  try { v = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8')); } catch { /* reported below */ }
  ok('version.json exists and matches CACHE (else run: node validate-sw-assets.mjs)',
    !!v && v.cache === CACHE_NAME, `version.json=${v ? v.cache : '(missing/unparseable)'} vs CACHE=${CACHE_NAME}`);
  ok('version.json is not in ASSETS (a cached answer would freeze the version pill)',
    !ASSETS.includes('./version.json'));
}

// --- 9. the manifest itself must match the bytes on disk ----------------------------------------
// validate-sw-assets.mjs REWRITES the block; this check is what makes run-all-tests.mjs fail if a
// stale one is about to ship (a session that edited a game file and skipped the validator). The
// cost of shipping stale is bounded - online play is network-first regardless - but the whole
// point of the manifest is that it tells the truth about the bytes.

console.log('\n--- the REST_MANIFEST matches the deployed bytes ---');

{
  const { createHash } = await import('node:crypto');
  const { readFileSync: rf, existsSync: ex } = await import('node:fs');
  const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.htm', '.json', '.txt', '.svg', '.md', '.webmanifest']);
  const stale = [];
  for (const entry of REST) {
    let rel = entry.replace(/^\.\//, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const abs = join(ROOT, rel);
    if (!ex(abs)) continue; // validate-sw-assets.mjs owns missing-file failures
    // Line endings normalised for text, exactly as validate-sw-assets.mjs does it - the manifest
    // describes the LF blob GitHub Pages serves, not the CRLF copy a Windows checkout holds. See
    // that file's hashAsset() for the incident this rule comes from.
    const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
    const raw = rf(abs);
    const body = TEXT_EXT.has(ext) ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : raw;
    const h = createHash('sha256').update(body).digest('hex').slice(0, 10);
    if (REST_MANIFEST[entry] !== h) stale.push(entry);
  }
  ok('REST_MANIFEST matches the bytes on disk (else run: node validate-sw-assets.mjs, commit sw.js)',
    stale.length === 0, `stale entries: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ` (+${stale.length - 5} more)` : ''}`);
}

// --- summary -----------------------------------------------------------------------------------

console.log(`\nSW strategy tests: ${passed} passed, ${failures.length} failed.`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
