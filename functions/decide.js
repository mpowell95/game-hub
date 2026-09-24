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
