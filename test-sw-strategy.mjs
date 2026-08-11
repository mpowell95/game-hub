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

/** Builds a sandbox and evaluates the real sw.js in it. `net` decides what the network does. */
function bootWorker({ net }) {
  const listeners = {};
  const caches = new Map();
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
    location: { origin: ORIGIN },
  };

  const sandbox = {
    self, caches: cachesApi, fetch: fetchImpl,
    Request: FakeRequest, Response: FakeResponse, URL, Symbol, Promise, Error, JSON, Math, Array, Object,
    setTimeout, clearTimeout,
    console: { warn: (...a) => logs.push(a.join(' ')), log: () => {}, error: (...a) => logs.push(a.join(' ')) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox, { filename: 'sw.js' });

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
const { ASSETS, SHELL, REST } = new Function(`${buildSrc}\nreturn { ASSETS, SHELL, REST };`)();

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
  // The warm is deliberately fire-and-forget (it must not block functional events), so let its
  // microtasks and awaits drain before asserting on the result.
  await new Promise((r) => setTimeout(r, 30));

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
async function fetchWith({ cachedBody, netBody, netDelayMs, netFails = false, path = './js/hub.js', mode = 'no-cors' }) {
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
  const after = await cache.match(new FakeRequest('./js/hub.js'));
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
  for (const p of ['./js/hub.js', './js/game-stats.js', './js/strings.js']) {
    await cache.put(new FakeRequest(p), new FakeResponse('CACHED:' + p));
  }

  const t0 = Date.now();
  const first = await w.fire('fetch', { request: new FakeRequest('./js/hub.js') });
  const afterFirst = Date.now() - t0;
  eq('the first slow request still serves cache', first.body, 'CACHED:./js/hub.js');
  ok('and it paid the deadline once', afterFirst >= NET_TIMEOUT_MS - 100, `took ${afterFirst}ms`);

  const t1 = Date.now();
  const second = await w.fire('fetch', { request: new FakeRequest('./js/game-stats.js') });
  const third = await w.fire('fetch', { request: new FakeRequest('./js/strings.js') });
  const afterRest = Date.now() - t1;
  eq('the next request is served from cache', second.body, 'CACHED:./js/game-stats.js');
  eq('and the one after that too', third.body, 'CACHED:./js/strings.js');
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

// --- summary -----------------------------------------------------------------------------------

console.log(`\nSW strategy tests: ${passed} passed, ${failures.length} failed.`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
