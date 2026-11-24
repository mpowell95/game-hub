// tools/test-game-chat-history.mjs - js/game-chat-history.js: in-game quick chat folded into a
// Messages conversation (2026-10-17). Headless, with fakes for the index read, the chat read and
// each game's match module. Run: node tools/test-game-chat-history.mjs
import { readGameChatsWith, readEarlierChats, __setDepsForTest } from '../js/game-chat-history.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name, extra); } };

const ME = 'MMMMM', ANA = 'AAAAA', BOB = 'BBBBB';
const match = (a, b) => ({ a: { code: a }, b: { code: b } });
const sideOf = (g, c) => (g.a.code === c ? 'a' : g.b.code === c ? 'b' : null);
const games = {
  d1: match(ME, ANA),          // darts, I am a
  d2: match(BOB, ME),          // darts with Bob: must not appear
  h1: { ...match(ANA, ME), chat: [{ by: 'a', t: 'c', v: 'hi from hoops', at: 300 }, { by: 'b', t: 'e', v: '🔥', at: 400 }] },
  s1: match(ANA, ME),          // skeeball, no chat at all
};
const chats = {
  'darts/d1': [{ by: 'a', t: 'p', v: 'nice', at: 100 }, { by: 'b', t: 'c', v: 'rematch', at: 200 }],
  'darts/d2': [{ by: 'a', t: 'c', v: 'bob only', at: 150 }],
};
let reads = [];
__setDepsForTest({
  loadAll: async () => ({ rows: [
    { game: 'darts', id: 'd1', with: ANA, updated: 10 },
    { game: 'darts', id: 'd2', with: BOB, updated: 11 },
    { game: 'hoops4', id: 'h1', with: ANA, updated: 12 },
    { game: 'skeeball', id: 's1', with: ANA, updated: 13 },
  ] }),
  readChat: async ({ node, id }) => { reads.push(`${node}/${id}`); return chats[`${node}/${id}`] || []; },
  loaders: {
    darts: async () => ({ readGame: async (id) => games[id], sideOf }),
    hoops4: async () => ({ readGame: async (id) => games[id], sideOf }),
    skeeball: async () => ({ readChallenge: async (id) => { reads.push(`match:${id}`); return games[id]; }, sideOf }),
  },
});

const lines = await readGameChatsWith(ME, ANA);
ok('only lines with that person (none from Bob)', lines.every((l) => l.matchId !== 'd2'), JSON.stringify(lines));
ok('four lines, oldest first', lines.map((l) => l.atMs).join(',') === '100,200,300,400', lines.map((l) => l.atMs).join(','));
ok('my side mapped per match (darts: I am a)', lines[0].mine === true && lines[1].mine === false);
ok('my side mapped per match (hoops: I am b)', lines[2].mine === false && lines[3].mine === true);
ok('each line names its game', lines[0].game === 'darts' && lines[2].game === 'hoops4' && lines[2].statsId === 'hoops4');
ok('a match with no chat is not opened', !reads.includes('match:s1'));
ok('Bob\'s match chat is never read', !reads.includes('darts/d2'));
ok('no person, no lines', (await readGameChatsWith(ME, '')).length === 0);

// --- the chat carries on from match to match (2026-11-24) ----------------------------------------
games.d3 = match(ANA, ME);   // the match open now: I am b
chats['darts/d1'] = [{ key: 'k1a', by: 'a', t: 'p', v: 'nice', at: 100 }, { key: 'k2b', by: 'b', t: 'i', v: 'photo0001b', at: 200 }];
chats['darts/d3'] = [{ key: 'k3a', by: 'a', t: 'c', v: 'this match', at: 500 }];
__setDepsForTest({
  loadAll: async (ids) => ({ rows: [
    { game: 'darts', id: 'd1', with: ANA, updated: 10 },
    { game: 'darts', id: 'd2', with: BOB, updated: 11 },
    { game: 'darts', id: 'd3', with: ANA, updated: 20 },
    { game: 'hoops4', id: 'h1', with: ANA, updated: 12 },
  ].filter((r) => ids.includes(r.game)) }),
});
const early = await readEarlierChats({ node: 'darts', id: 'd3', side: 'b' });
ok('earlier: lines from the earlier match with the same person', early.length === 2, JSON.stringify(early));
ok('earlier: the open match\'s own lines are left out', early.every((l) => l.pm.id !== 'd3'));
ok('earlier: same game only (no Hoops lines)', early.every((l) => l.pm.node === 'darts'));
ok('earlier: my side from THAT match (d1: I was a)', early[0].mine === true && early[1].mine === false);
ok('earlier: keys never collide with the open match\'s', early[0].key === 'd1~k1a');
ok('earlier: a photo keeps the match it lives in', early[1].t === 'i' && early[1].pm.id === 'd1');
ok('earlier: a game with no chat node gives nothing', (await readEarlierChats({ node: 'nope', id: 'd3', side: 'b' })).length === 0);

__setDepsForTest({ loadAll: async () => { throw new Error('offline'); } });
ok('a failed index read gives nothing, never throws', (await readGameChatsWith(ME, ANA)).length === 0);
__setDepsForTest(null);

console.log(`\nGame chat history: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
