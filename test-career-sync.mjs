// test-career-sync.mjs - headless tests for js/career-store.js (BB-0-phase-0-handoff.md step 11).
//
// WHAT IS NOT COVERED, stated up front: a real Firebase boot. The network-shaped assertions below
// (fork-before-adopt, retire's atomic multi-path update, a relinked code, a denied write) drive the
// REAL pullCareer/pushCareer/retireCareer through a fake { db, api } installed via the test-only
// globalThis.__CAREER_TEST_BOOT__ seam career-store.js's `boot()` checks first - so this exercises
// the actual production code path, not a mirror of it, the same reasoning js/net.js's FakeRoom
// pattern uses one level down for multiplayer.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

function makeFakeApi(initial) {
  const data = Object.assign({}, initial);
  const calls = [];
  const api = {
    ref: (db, path) => ({ path: path || '' }),
    get: async (ref) => {
      const v = data[ref.path];
      return { exists: () => v !== undefined, val: () => v };
    },
    set: async (ref, val) => { calls.push(['set', ref.path]); data[ref.path] = val; },
    update: async (rootRef, updates) => {
      calls.push(['update', Object.keys(updates)]);
      for (const [p, v] of Object.entries(updates)) {
        if (v === null) delete data[p]; else data[p] = v;
      }
    },
  };
  return { api, db: {}, uid: 'uid-1', data, calls };
}

// A working uid/db so ensureAuthClaim (js/messages.js) succeeds against the same fake store, and
// a valid player code so myCode() resolves. The code alphabet excludes I/O/L/0/1.
const CODE = 'BB2XR';
store.set('gamehub.profile', JSON.stringify({ version: 1, name: 'Bud', playerId: CODE }));

const {
  CAREER_SCHEMA_V, validateCareer, reconcile, mintCareerId,
  loadLocalCareer, saveLocalCareer, pullCareer, retireCareer, careerSyncHealth,
} = await import('./js/career-store.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass += 1; } else { fail += 1; console.error('  FAIL ' + what); } };
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('test-career-sync.mjs');

// --- validateCareer: rejects a document with one bad field -------------------------------------
const goodDoc = {
  v: CAREER_SCHEMA_V, code: CODE, careerId: `${CODE}-1000-AAAA`,
  seq: 1, baseSeq: 1, updatedAt: 1000, device: 'dev-1', rulesV: 1, state: { foo: 'bar' },
};
ok(validateCareer(goodDoc) !== null, 'a well-formed document validates');
for (const [field, bad] of [
  ['v', 2], ['code', ''], ['code', 5], ['careerId', ''], ['seq', -1], ['seq', 1.5],
  ['baseSeq', 'x'], ['updatedAt', 'x'], ['device', ''], ['rulesV', 0],
]) {
  const broken = Object.assign({}, goodDoc, { [field]: bad });
  ok(validateCareer(broken) === null, `a document with a bad '${field}' is rejected`);
}
{
  const noState = Object.assign({}, goodDoc); delete noState.state;
  ok(validateCareer(noState) === null, 'a document missing state entirely is rejected');
}
ok(validateCareer(null) === null, 'null is rejected');
ok(validateCareer('not an object') === null, 'a non-object is rejected');

// --- reconcile: all four outcomes from a (local.seq, local.baseSeq, remote.seq) table -----------
const mk = (seq, baseSeq) => Object.assign({}, goodDoc, { seq, baseSeq });
eq(reconcile(null, null), 'none', 'reconcile: nothing local, nothing remote -> none');
eq(reconcile(mk(3, 1), null), 'push', 'reconcile: local exists, no remote at all -> push');
eq(reconcile(null, mk(2, 0)), 'adopt', 'reconcile: no local, a remote exists -> adopt');
eq(reconcile(mk(1, 1), Object.assign({}, mk(1, 1), { seq: 1 })), 'none', 'reconcile: neither side moved past baseSeq -> none');
eq(reconcile(mk(2, 1), Object.assign({}, mk(1, 1), { seq: 1 })), 'push', 'reconcile: local moved, remote did not -> push');
eq(reconcile(mk(1, 1), Object.assign({}, mk(1, 1), { seq: 2 })), 'adopt', 'reconcile: remote moved, local did not -> adopt');
eq(reconcile(mk(2, 1), Object.assign({}, mk(1, 1), { seq: 3 })), 'fork', 'reconcile: BOTH sides moved past baseSeq -> fork');

// --- a fork writes the archive BEFORE adopting --------------------------------------------------
{
  const remoteDoc = Object.assign({}, goodDoc, { careerId: `${CODE}-9000-ZZZZ`, seq: 9 });
  const fake = makeFakeApi({ [`careers/${CODE}/baseball/live`]: remoteDoc });
  globalThis.__CAREER_TEST_BOOT__ = fake;
  const localDoc = Object.assign({}, goodDoc, { seq: 5, baseSeq: 1 });   // local ahead of baseSeq
  saveLocalCareer(localDoc);   // saveLocalCareer bumps seq by 1 -> 6, still > baseSeq 1
  // remote.seq (9) is also > baseSeq (1) on both sides -> fork
  const result = await pullCareer();
  eq(result && result.careerId, remoteDoc.careerId, 'a fork ADOPTS the remote document');
  const forkKeys = Object.keys(fake.data).filter((k) => k.includes('/baseball/forks/'));
  ok(forkKeys.length === 1, 'exactly one fork archive was written');
  const archived = fake.data[forkKeys[0]];
  eq(archived.careerId, goodDoc.careerId, 'the fork archive holds the LOCAL document, not the remote one');
  const setIdx = fake.calls.findIndex((c) => c[0] === 'set' && c[1].includes('/forks/'));
  const liveWriteAfterFork = fake.calls.slice(setIdx + 1).some((c) => c[1] === `careers/${CODE}/baseball/live` && (c[0] === 'set' || c[0] === 'update'));
  ok(setIdx >= 0, 'the fork archive write happened');
  ok(!liveWriteAfterFork, 'adopting does not itself re-write the remote live document (nothing to push)');
  eq(careerSyncHealth().state, 'fork', 'sync health records the fork state');
}

// --- retire's update carries BOTH paths in one call, and clears local only after the re-read ----
{
  const fake = makeFakeApi({});
  globalThis.__CAREER_TEST_BOOT__ = fake;
  const localDoc = Object.assign({}, goodDoc, { seq: 1, baseSeq: 1 });
  saveLocalCareer(localDoc);
  ok(loadLocalCareer() !== null, 'a local career is on record before retiring');
  const row = {
    v: 1, careerId: goodDoc.careerId, startedAt: 100, endedAt: 5000, hand: 'L',
    finalLeague: 2, bestLeague: 2, bestTrophyByLeague: { little: 1 }, wsTitles: 0,
    perfectSeasons: 0, seasons: 1, played: 10, won: 6, lost: 4, forfeits: 0, rulesV: 1,
  };
  const okRetire = await retireCareer(row);
  ok(okRetire === true, 'retireCareer reports success');
  const updateCall = fake.calls.find((c) => c[0] === 'update');
  ok(!!updateCall, 'retire went through ONE update() call');
  ok(updateCall[1].some((p) => p === `careers/${CODE}/baseball/history/${row.careerId}`), 'the update carries the history write');
  ok(updateCall[1].some((p) => p === `careers/${CODE}/baseball/live`), 'the update carries the live-nulling write, in the SAME call');
  eq(fake.data[`careers/${CODE}/baseball/history/${row.careerId}`].careerId, row.careerId, 'the history row landed');
  ok(fake.data[`careers/${CODE}/baseball/live`] === undefined, 'live was nulled');
  eq(loadLocalCareer(), null, 'the local career is cleared only after the write verified');
}

// --- retire's update is refused, health records the failure, and nothing throws -----------------
{
  const fake = makeFakeApi({});
  fake.api.update = async () => { throw new Error('PERMISSION_DENIED: Permission denied'); };
  globalThis.__CAREER_TEST_BOOT__ = fake;
  saveLocalCareer(Object.assign({}, goodDoc, { seq: 1, baseSeq: 1 }));
  let threw = false;
  let result;
  try { result = await retireCareer({ careerId: goodDoc.careerId, endedAt: 1 }); }
  catch { threw = true; }
  ok(!threw, 'a denied retire write throws nothing to the caller');
  eq(result, false, 'a denied retire write reports failure');
  eq(careerSyncHealth().state, 'denied', 'sync health records the denied state');
  ok(loadLocalCareer() !== null, 'a denied write never clears the local career (nothing was actually retired)');
}

// --- a denied PUSH also records health and throws nothing (pullCareer's own push path) ----------
{
  const fake = makeFakeApi({});
  fake.api.set = async () => { throw new Error('PERMISSION_DENIED: Permission denied'); };
  globalThis.__CAREER_TEST_BOOT__ = fake;
  saveLocalCareer(Object.assign({}, goodDoc, { seq: 3, baseSeq: 1 }));   // local ahead, no remote -> push
  let threw = false;
  try { await pullCareer(); } catch { threw = true; }
  ok(!threw, 'a denied push (via pullCareer) throws nothing to the caller');
  eq(careerSyncHealth().state, 'denied', 'sync health records the denied state for a refused push');
}

// --- a relinked code pulls the OTHER career ------------------------------------------------------
{
  const OTHER_CODE = 'BB3YQ';
  const otherDoc = Object.assign({}, goodDoc, { code: OTHER_CODE, careerId: `${OTHER_CODE}-7000-QQQQ`, seq: 2, baseSeq: 0 });
  const fake = makeFakeApi({ [`careers/${OTHER_CODE}/baseball/live`]: otherDoc });
  globalThis.__CAREER_TEST_BOOT__ = fake;
  // No local career at all under this (freshly relinked) code, so this is a plain adopt.
  store.set('gamehub.baseball.v1', JSON.stringify({}));
  store.set('gamehub.profile', JSON.stringify({ version: 1, name: 'Bud', playerId: OTHER_CODE }));
  const result = await pullCareer();
  eq(result && result.careerId, otherDoc.careerId, 'relinking to a different code pulls THAT code\'s own career');
  eq(loadLocalCareer().careerId, otherDoc.careerId, 'the adopted career is now the local one');
  store.set('gamehub.profile', JSON.stringify({ version: 1, name: 'Bud', playerId: CODE }));   // restore
}

delete globalThis.__CAREER_TEST_BOOT__;

// --- mintCareerId never repeats across a thousand calls with the same code and millisecond ------
//
// A DETERMINISTIC sweep, not a statistical one: 1000 real draws from crypto.getRandomValues at
// CAREER_ID_RANDOM_LEN=4 over a 31-symbol alphabet has a genuine, non-negligible chance of a
// birthday-paradox collision (roughly 40-50% at n=1000, verified by running the entropy version of
// this test) - that would make the suite flaky through no fault of the code under test. So instead
// this drives `rand` through a fixed enumeration that visits 1000 DISTINCT base-31 4-tuples in
// order, which is what actually needs to be true: given 1000 different random draws, mintCareerId
// must produce 1000 different ids (no accidental clamping/wrapping in the draw-to-character map),
// never that any two draws of crypto randomness happen to coincide (a property of the RNG, not of
// this function, and this codebase's convention - THE LAW rule 7 in spirit - is to test the real
// thing rather than a proxy for it).
{
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    let n = i;
    const rand = () => {
      const v = (n % 31) / 31;
      n = Math.floor(n / 31);
      return v;
    };
    ids.add(mintCareerId(CODE, 123456789, rand));
  }
  eq(ids.size, 1000, 'mintCareerId never repeats across 1000 calls at the same code+millisecond');
  ok(/^BB2XR-123456789-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test([...ids][0]), 'careerId matches the frozen <CODE>-<startedAtMs>-<RAND> shape');
}
// Deterministic form, for a reproducible single assertion alongside the entropy sweep above.
eq(mintCareerId('BB2XR', 5, () => 0), 'BB2XR-5-AAAA', 'mintCareerId is deterministic given an injected rand');

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
