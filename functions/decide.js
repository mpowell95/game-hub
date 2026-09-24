// functions/decide.js - WHAT, IF ANYTHING, TO TELL ONE PLAYER ABOUT ONE CONNECT 4 HOOPS ROW.
//
// PURE, so node can test it without Firebase (test-push.mjs). index.js calls it on every write to
// hoops/index/<code>/<gameId>, the row that says what that match looks like from <code>'s side.
// `before`/`after` are that row either side of the write; `game` is hoops/games/<gameId>.
//
// The rule is "the other person just did something you need to answer", and nothing else:
//   - a NEW row that is your turn        -> a challenge (or "game N of M, you shoot first")
//   - an existing row flipping to you    -> "your turn"
//   - a row finishing, not by your hand  -> "they won" / "they resigned" / "a draw"
// Your OWN writes never notify you: your move flips your row AWAY from you, your resignation is
// yours, and a match you created (game.by === you) is not news. Returns null or {title, body, tag}.

const TEXT = {
  en: {
    title: 'Connect 4 Hoops',
    challenge: (w) => `${w} challenged you. Your shot!`,
    seriesStart: (w, n, m) => `${w} started game ${n} of ${m}. You shoot first.`,
    turn: (w) => `Your turn vs ${w}`,
    theyWon: (w) => `${w} won the game.`,
    youWon: (w) => `You won! ${w} resigned.`,
    draw: (w) => `Your game vs ${w} is a draw.`,
  },
  es: {
    title: 'Connect 4 Hoops',
    challenge: (w) => `${w} te ha retado. ¡Tu tiro!`,
    seriesStart: (w, n, m) => `${w} empezó el juego ${n} de ${m}. Tiras primero.`,
    turn: (w) => `Te toca contra ${w}`,
    theyWon: (w) => `${w} ganó la partida.`,
    youWon: (w) => `¡Ganaste! ${w} se rindió.`,
    draw: (w) => `Tu partida contra ${w} es un empate.`,
  },
};

export function strings(lang) { return TEXT[lang] || TEXT.en; }

const clean = (v, n = 40) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** 'a' | 'b' | null: which side of `game` the player `code` is on. */
function sideOf(game, code) {
  if (!game || !code) return null;
  if (game.a && game.a.code === code) return 'a';
  if (game.b && game.b.code === code) return 'b';
  return null;
}

function movesOf(game) {
  const m = game && game.moves;
  if (!m || typeof m !== 'object') return [];
  return Object.keys(m).sort().map((k) => m[k]).filter(Boolean);
}

/**
 * @returns {null | {kind, who, gameId, text: (lang) => {title, body}}}
 */
export function decide({ code, gameId, before, after, game }) {
  if (!after || !code || !gameId) return null;          // a delete: nothing to say
  const who = clean(after.name) || 'Someone';
  const side = sideOf(game, code);
  const moves = movesOf(game);
  const mk = (kind, body) => ({ kind, who, gameId, text: (lang) => ({ title: strings(lang).title, body: body(strings(lang)) }) });

  // FINISHED, just now.
  if (after.over && !(before && before.over)) {
    if (!side || !game || !game.over) return null;
    const over = game.over;
    if (over.why === 'resign') {
      // The resigner is the loser. If that is you, you did it.
      if (over.winner !== side) return null;
      return mk('over', (s) => s.youWon(who));
    }
    // Ended by a move: whoever made the LAST move ended it. If that was you, you know.
    const last = moves[moves.length - 1];
    if (!last || last.by === side) return null;
    if (over.winner == null) return mk('over', (s) => s.draw(who));
    if (over.winner !== side) return mk('over', (s) => s.theyWon(who));
    return null;
  }
  if (after.over || !after.yourTurn) return null;
  if (before && before.yourTurn && !before.over) return null;  // it was already your turn

  if (!before) {
    // A brand-new row. A match you made yourself is not news to you.
    if (game && game.by && game.by === code) return null;
    // Before `by` existed (2026-09-23): the creator was side 'a' with no shot taken yet, the
    // only shape in which a new row could be your own.
    if (game && !game.by && side === 'a' && moves.length === 0) return null;
    const series = Math.max(1, (after.series | 0) || 1);
    const no = Math.max(1, (after.seriesNo | 0) || 1);
    if (no > 1 && moves.length === 0) return mk('series', (s) => s.seriesStart(who, no, series));
    return mk('challenge', (s) => s.challenge(who));
  }
  return mk('turn', (s) => s.turn(who));
}


// --- THE APP IS OPEN ON THAT DEVICE (2026-09-24) --------------------------------------------------
// Matt: "if i have the hub open i shouldn't get them either." A device with the hub on screen stamps
// `activeAt` (server time) on its own subscription every 30 s (js/push.js markActive) and writes 0
// when it goes to the background. 75 s = two missed beats plus slack.
export const ACTIVE_WINDOW_MS = 75000;
export function isActive(sub, now = Date.now()) {
  const at = sub && Number.isFinite(+sub.activeAt) ? +sub.activeAt : 0;
  return at > 0 && now - at < ACTIVE_WINDOW_MS && now - at > -ACTIVE_WINDOW_MS;
}

// --- MESSAGES (2026-09-24) ------------------------------------------------------------------------
// Watches messages/index/<code>/<other>, the row that lists the conversation in <code>'s inbox.
// A send `update`s BOTH people's rows with {at, from, preview, name, emoji} - `name`/`emoji` are
// always the OTHER person as seen from that row - so the row is everything a notification needs.
// Notify only when the row's `at` moved forward AND the newest message is FROM the other person:
// the sender's own row moves too, and a read stamp (`seenAt`) or a hide (`hiddenAt`) moves nothing.
const MSG_TEXT = {
  en: { title: (w) => `Message from ${w}` },
  es: { title: (w) => `Mensaje de ${w}` },
};

export function decideMessage({ code, other, before, after }) {
  if (!after || !code || !other) return null;
  if (after.from !== other) return null;                         // our own send
  const was = before && Number.isFinite(+before.at) ? +before.at : 0;
  if (!(+after.at > was)) return null;                           // nothing new arrived
  const who = clean(after.name) || 'Someone';
  const preview = String(after.preview == null ? '' : after.preview).slice(0, 140);
  return {
    kind: 'message', who,
    text: (lang) => ({ title: (MSG_TEXT[lang] || MSG_TEXT.en).title(who), body: preview }),
  };
}

// --- BUG REPORTS, to the admins (2026-09-24) -------------------------------------------------------
// Matt: "and bug reports for me". A report is written in ONE set (js/bug-report.js), so its creation
// carries the whole record. Only a short line goes in the notification - never the environment.
export function decideBugReport(report) {
  if (!report || typeof report !== 'object') return null;
  const who = clean(report.reporter && report.reporter.name) || 'Someone';
  const game = clean(report.gameTitle || report.game || '', 30);
  const desc = String(report.description || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    kind: 'bug', who,
    text: () => ({
      title: game ? `Bug report: ${game}` : 'Bug report',
      body: desc ? `${who}: ${desc}` : `${who} sent a report`,
    }),
  };
}

// --- SKEEBALL CHALLENGES (2026-09-24) ---------------------------------------------------------------
// Watches skeeChallenges/index/<code>/<id>, the row that lists one challenge from <code>'s side
// (skeeball/js/challenge.js rowFor). The row carries everything a notification needs - the other
// person's name, the format, the machine, totals and games won - so no read of the match is needed.
//   - the challenged player's row APPEARING  -> "<them> challenged you ..." (it is only written once
//     the challenger has played every game, so this is the delivery)
//   - the challenger's row turning over      -> the result
// The challenged player finishes the match themselves, so their own row turning over is not news;
// the challenger's own row appearing (sent:true) is not news either.
const SKEE_TEXT = {
  en: {
    title: 'Skeeball challenge',
    one: (w, m, n) => `${w} challenged you on ${m}. Beat ${n}!`,
    games: (w, m, k) => `${w} challenged you: ${k} games on ${m}.`,
    all: (w) => `${w} challenged you on every machine.`,
    won: (w) => `${w} played your challenge. You won!`,
    lost: (w) => `${w} beat your challenge.`,
    draw: (w) => `${w} tied your challenge.`,
    oneWon: (w, m, n) => `${w} scored ${n} on ${m}. You won!`,
    oneLost: (w, m, n) => `${w} scored ${n} on ${m} and beat you.`,
    oneDraw: (w, m, n) => `${w} scored ${n} on ${m}. It's a tie.`,
  },
  es: {
    title: 'Reto de Skeeball',
    one: (w, m, n) => `${w} te ha retado en ${m}. ¡Supera ${n}!`,
    games: (w, m, k) => `${w} te ha retado: ${k} partidas en ${m}.`,
    all: (w) => `${w} te ha retado en todas las máquinas.`,
    won: (w) => `${w} jugó tu reto. ¡Ganaste!`,
    lost: (w) => `${w} superó tu reto.`,
    draw: (w) => `${w} empató tu reto.`,
    oneWon: (w, m, n) => `${w} hizo ${n} en ${m}. ¡Ganaste!`,
    oneLost: (w, m, n) => `${w} hizo ${n} en ${m} y te ganó.`,
    oneDraw: (w, m, n) => `${w} hizo ${n} en ${m}. Empate.`,
  },
};

export function decideSkee({ code, id, before, after }) {
  if (!after || !code || !id) return null;
  const who = clean(after.name) || 'Someone';
  const machine = clean(after.boardName || after.board, 30) || 'Skeeball';
  const k = Math.max(1, Math.round(+after.n) || 1);
  const single = k === 1 && !after.all;
  const n = Number.isFinite(+after.theirs) ? Math.round(+after.theirs) : 0;
  const mk = (kind, body) => ({
    kind, who,
    text: (lang) => { const s = SKEE_TEXT[lang] || SKEE_TEXT.en; return { title: s.title, body: body(s) }; },
  });
  if (!before) {
    if (after.sent || !after.yourTurn || after.over) return null;
    if (after.all) return mk('challenge', (s) => s.all(who));
    if (single) return mk('challenge', (s) => s.one(who, machine, n));
    return mk('challenge', (s) => s.games(who, machine, k));
  }
  if (after.over && !before.over && after.sent) {
    const r = after.result === 'won' ? 'won' : after.result === 'lost' ? 'lost' : 'draw';
    if (single) return mk('over', (s) => s[{ won: 'oneWon', lost: 'oneLost', draw: 'oneDraw' }[r]](who, machine, n));
    return mk('over', (s) => s[r](who));
  }
  return null;
}
