// stats-screens-fixture.mjs - a made-up player's store with every game's mode (byMode) and match detail (dt),
// written by the REAL recorders through withMode (js/game-stats.js), never by hand. Used by
// tools/test-stats-screens.mjs and tools/stats-screens-shots.cjs. In memory only: a localStorage shim, no network,
// a made-up name and code (never Matt's), nothing synced.
export async function buildFixture() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzfixture', playerId: 'ZZZF7' }));
  localStorage.setItem('gamehub.devAllowSync.v1', '0');
  const G = await import('../js/game-stats.js');
  const { withMode: W } = G;
  const quiet = console.error; console.error = () => {};
  try {
    const R = (id, mode, d, won, detail) => W(mode, d, () => G.recordResult(id, d === 'mp' ? 'mp' : d, won), detail ? { detail } : undefined);
    // Connect 4: who moved first is its own grid.
    for (const [d, f, w] of [['easy', 'player', true], ['hard', 'computer', false], ['medium', 'player', true], ['expert', 'computer', true]]) W({ first: f === 'player' ? 'me' : 'them' }, d, () => G.recordConnect4(d, f, w));
    for (const [d, w, x] of [['normal', true, 2], ['hard', false, 1], ['mp', true, 3]]) W({ n: x === 3 ? 3 : 2, vc: 'points', first: 'me' }, d, () => G.recordChinchon(d, w, { closed: 1, minusTen: x === 1 ? 1 : 0, chinchon: x === 3 }));
    for (const [d, w] of [['normal', true], ['mp', false], ['easy', null]]) W({ n: 2, to: 21, first: w ? 'me' : 'them' }, d, () => G.recordEscoba(d, w, { escobas: 2 }));
    for (const [v, d, w, f] of [['classic', 'easy', true, 'me'], ['classic', 'hard', null, 'them'], ['ultimate', 'medium', false, 'them'], ['ultimate', 'mp', true, 'me']]) W({ v, first: d === 'mp' ? f : 'alternate', went: f }, d, () => G.recordTicTacToe(v, d, w));
    for (const [d, w, f] of [['easy', true, 'me'], ['hard', false, 'them'], ['mp', true, 'them']]) W({ size: '4x4', first: f }, d, () => G.recordDotsBoxes(d, w, { boxes: 9, bestChain: 4 }), { detail: { mine: 9, theirs: 7, chain: 4 } });
    for (const [d, w] of [['easy', true], ['mp', false]]) W({ min: 3, lang: d === 'mp' ? 'es' : 'en' }, d, () => G.recordBoggle(d, w, { words: 20, score: 31, longestWord: 'GALLERY' }));
    for (const [d, w, s] of [['easy', true, 241], ['hard', false, 190], ['mp', true, 260]]) W({ first: w ? 'me' : 'them' }, d, () => G.recordYahtzee(d, w, { yahtzees: 1, score: s }), { detail: { score: s, theirs: 200, yahtzees: 1, upper: s > 200 } });
    for (const [d, w] of [['easy', true], ['medium', false]]) W({ to: d === 'easy' ? 100 : 150 }, d, () => G.recordDominoes(d, w, { rounds: 5, bestRound: 22, points: 104 }), { detail: { rounds: 5, pts: 104, theirs: 80 } });
    for (const [d, w, f] of [['easy', true, 'me'], ['hard', false, 'them'], ['mp', true, 'me']]) W({ size: d === 'easy' ? 'quick' : 'classic', shots: 1, rule: 0, bonus: 1, first: f }, d, () => G.recordBattleship(d, w, { shots: 40, hits: 17, sunk: 5 }));
    for (const [d, w] of [['easy', true], ['mp', false]]) W({ to: 7 }, d, () => G.recordAirHockey(d, w, { goalsFor: 7, goalsAgainst: 4, shot: 2400 }));
    for (const [d, w, f] of [['easy', true, 'me'], ['hard', false, 'them']]) W({ gent: 1, rr: 2, first: f }, d, () => G.recordCupPong(d, w, 1), { detail: { throws: 22, made: 10, ballsBack: 2, onFire: 1, reracks: 1, rack: 'diamond' } });
    R('cuppong', { gent: 1, rr: 2, su: 0, series: 1, first: 'me' }, 'mp', true);
    W({ solo: 1 }, 'solo', () => G.recordCupPongSolo(14), { lo: 14, detail: { throws: 14 } });
    for (const [d, w, k, f] of [['easy', true, '301', 'me'], ['hard', false, 'cricket-order', 'them'], ['medium', true, '101', 'them'], ['mp', true, '201', 'me']]) R('darts', { kind: k, first: f }, d, w, { turns: 9, left: 0, oppLeft: 40 });
    for (const [d, w, off, def, f] of [['easy', true, 'balanced', 'defend', 'me'], ['hard', false, 'attack', 'diamond', 'them'], ['easy', true, 'balanced', 'defend', 'them']]) R('flicksoccer', { goals: 2, off, def, first: f }, d, w, { gf: w ? 2 : 0, ga: w ? 1 : 2, flicks: 11 });
    R('flicksoccer', { goals: 2, off: 'balanced', def: 'defend', first: 'me' }, 'mp', true, { gf: 2, ga: 0, flicks: 8 });
    for (const [d, w, one, f] of [['easy', true, 1, 'me'], ['hard', false, 0, 'them'], ['mp', true, 0, 'me']]) R('hoops4', { one, first: f }, d, w, { shots: 12, made: 4, missed: 8 });
    for (const [d, w, f] of [['easy', true, 'me'], ['hard', false, 'them'], ['mp', null, 'me']]) R('mancala', { first: f }, d, w, { mine: w ? 30 : 18, theirs: w ? 18 : 30 });
    for (const [d, w, f] of [['easy', true, 'me'], ['medium', false, 'them'], ['mp', true, 'them']]) R('filler', { first: f }, d, w, { mine: 30, theirs: 26, moves: 22 });
    for (const [d, w, n] of [['easy', true, 2], ['hard', false, 4]]) R('uno', { n }, d, w);
    for (const [d, w, g, f] of [['easy', true, '8', 'me'], ['hard', false, '9', 'them'], ['mp', true, 'ct', 'me']]) R('eightball', { game: g, racks: 1, call: 0, bank: 0, obst: 0, first: f }, d, w);
    for (const [id, d, w] of [['business', 'easy', true], ['business', 'hard', false], ['parchis', 'pro', true], ['archery', 'easy', true], ['archery', 'mp', false], ['cupbaseball', 'easy', true], ['battlearena', 'hard', false]]) R(id, { first: w ? 'me' : 'them' }, d, w);
    for (const [d, w, tier] of [['medium', true, 'buddy'], ['hard', false, 'world'], ['easy', true, 'buddy'], ['mp', false, 'free']]) R('holdem', { n: 4, tier, speed: 'normal' }, d, w);
    G.recordHoldemHand({ won: true, amt: 12000, score: 5, cat: 7, cards: [48, 49, 50, 51, 44] });
    // Solo games.
    W({ walls: 'on' }, 'easy', () => G.recordSnake(31, 'easy', 'on'), { hi: 31 });
    W({ map: 'classic' }, 'medium', () => G.recordBallRun(42, 'medium', 'classic'), { hi: 42 });
    for (const m of ['arcade', 'endless']) W({ m }, 'easy', () => G.recordBrickBlitz(m === 'arcade' ? 4200 : 9100, 'easy', { bricks: 120, stages: 3 }), { hi: m === 'arcade' ? 4200 : 9100 });
    W({ look: 'wood' }, 'easy', () => G.recordTower(18, 'easy', { perfects: 3 }), { hi: 18 });
    W({ sd: 1 }, 'easy', () => G.recordSudoku('easy', { timeMs: 312000, mistakes: 1, hints: 0 }), { lo: 312000, detail: { mistakes: 1, hints: 0 } });
    W({ size: 6 }, 'easy', () => G.recordMurdoku('easy', { hints: 0 }), { lo: 251000 });
    W({ size: 8 }, 'hard', () => G.recordMurdoku('hard', { hints: 1 }), { lo: 611000 });
    for (const [l, w] of [['easy', true], ['hard', false], ['easy', true]]) W({ ng: 1, marks: 1 }, l, () => G.recordMinesweeper(l, w, { timeMs: 80000, cleared: w ? 100 : 62, flagsRight: 8, mines: 10, noGuess: true }));
    for (const [tier, n] of [['easy', 1], ['easy', 2], ['medium', 1], ['hard', 3]]) W({ mode: 'levels', g: 11 }, tier, () => G.recordWayOut(tier, { timeMs: 60000, arrows: 40 + n, rounds: 1, timed: true, n, level: n, gen: 11 }), { detail: { mistakes: 0, hints: 0, arrows: 40 + n } });
    W({ mode: 'rush', rush: 'easy' }, 'easy', () => G.recordWayOutRush('easy', { arrows: 230, boards: 6, ms: 180000, mistakes: 1, seed: 7, at: Date.now(), rv: 2 }), { detail: { arrows: 230, boards: 6, left: 0 } });
    W({ lvl: 'ladder' }, 'easy', () => G.recordNutsBolts(1, 14, 'easy'), { detail: { moves: 14 } });
    W({ lang: 'en', daily: 0 }, 'en', () => G.recordContexto('en', true, { guesses: 22, hints: 0, k: 1 }), { detail: { guesses: 22, hints: 0 } });
    W({ round: 'pinevalley3', holes: 3 }, 'pinevalley', () => G.recordGolf('pinevalley', { round: 'pinevalley3', strokes: 11, points: 3, holes: 3, birdies: 1 }));
    for (const [b, s] of [['classic', 260], ['basketball', 410], ['popongo', 33]]) W({ board: b, ch: 0 }, b, () => G.recordSkeeball(b, { score: s, balls: 9, hundreds: 1, fifties: 2, bestThrow: 100, at: Date.now() }), { hi: s });
    W({ veh: 'jeep', up: '0-0-0-0' }, 'countryside', () => G.recordHillClimb(812, 'countryside', { coins: 120, flips: 2 }));
  } finally { console.error = quiet; }
  const st = G.loadStats();
  return { games: st.games, code: 'ZZZF7' };
}
