# Boggle (`boggle/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Hub integration: in-hub `module:`. `isInProgress()` is the autosave/resume meaning (always `false`) for
solo; **MP returns `true` while a room is joined** (lobby, live round, reveal screen).

## Notes

Timed word search vs AI on a 4x4 grid shaken from the real 16 classic Boggle dice (`game.js` `DICE`).
Random-letter boards are frequently unplayable, so this repo does not generate one.

- **The solver is the AI**: one exhaustive DFS against the dictionary trie (`solver.js`) produces the
  scoring list, the end-of-round reveal AND the opponent. `ai.js` has no search; it samples a
  difficulty-scaled slice of the solver's output (beginner ~20% biased short, intermediate ~45%, pro ~70%
  biased long/high-scoring), so every AI word is a genuine board find.
- **Dictionary**: public-domain **ENABLE**, ~170k words (`boggle/data/words.txt` + `CREDITS.md`), plus a
  generated Spanish list (below). Must be in `sw.js` `ASSETS` or the game breaks offline (it is in the
  `LAZY` tier). Fetched once, lazily, on first game start, parsed into a trie of nested `Map`s cached in
  module scope (`dict.js`).
- **The `Qu` tile is one tile worth two letters** and advances the trie by both in one step;
  `boggle/js/test.js` asserts "QUIT" is found and "QIT" never produced.
- A round is a shared-board timed sprint, not turn-based; **no duplicate cancellation** (it would gut the
  human's score against a solver-backed opponent); higher total wins, ties are real.
- **Input is swipe-to-trace** (Matt, 2026-07-22): drag through letters, release to submit, slide back to
  undo. Tap-to-select is kept for keyboard/screen-reader use (every tile is a real `<button>`). Easy to
  break: the board sets `touch-action: none`; tracing hit-tests tile rects **cached at gesture start**,
  not `elementFromPoint` (backtracking must work over `disabled` tiles); a drag patches the board in
  place via `_updateBoardVisuals()` (an `innerHTML` rebuild mid-drag breaks pointer capture); the
  synthetic `click` after a tap is ignored by **timestamp**, never a boolean flag. Tracing rules live in
  `game.js`'s pure `pathAction()`.
- **Boards are quality-gated** (`solver.js` `shakePlayableBoard`/`BOARD_QUALITY`): a shake is rejected
  if under 60 findable words, 35 short words or 4 vowels (~1.39 shakes on average, ~0.8ms). Rare letters
  are NOT over-represented (that is correct); the problem was vowel-starved boards (~9%).
- Settings `gamehub.boggle.v1`. `recordBoggle(difficulty, won, extras)` maintains `total`/`byDiff` AND
  the `bg` breakdown `{played,won,lost,tied,words,bestScore,longestWord}`: `tied` explicit, `words`
  additive, `bestScore` `Math.max` only, `longestWord` replaced only when strictly longer.
- **Timers 1 / 1.5 / 2 minutes, default 1.5** (Matt: "5 min seems crazy long"; `TIMERS`/`TIMER_LABEL_KEY`
  in `ui.js`). Stored as numeric minutes; an old `3`/`5` falls back to the default (a preference).
  `loadGame()` caps `remainingSec` at `Math.max(...TIMERS) * 60`.

## Autosave/resume (2026-07-23)

`gamehub.boggle.save.v1` (separate from settings) saves `{faces, found, remainingSec, timerMinutes,
difficulty, wordLang}` after every scored word and on `destroy()`. The solver's word list is NOT saved:
`resumeGame()` recomputes it (`solveBoard`). A valid save restores straight onto the live board (no
dialog) and **`_endsAt` is recomputed as `Date.now() + remainingSec * 1000`** (clock paused while away,
on purpose, favoring the player). Cleared on round end (`finish()`), a fresh round and "give up"; never
on hub navigation. A malformed or non-4x4-of-letters save is treated as no save.

## Difficulty display (2026-07-24)

Easy/Medium/Hard labels (label-only; ids `beginner`/`intermediate`/`pro` untouched) with the shared
colored shape (`diffShapeSVG`/`tierOf`, sized via `.bg-root .lb-dshape`). **No per-tier prose hint**
(Matt's standing rule); the `bg-hint` element and `hint_diff_*` keys are gone.

## Haptics (2026-07-24)

Two feature-detected `navigator.vibrate()` calls via `haptic(ms)` in `ui.js`: **trigger 1** `vibrate(12)`
when the trace first becomes a submittable NEW word (in `_updateWordBar()`, swipe path only), **trigger
2** `vibrate(25)` on a successful submit. **iOS web apps expose no vibration API. The "switch hack" was
tested on Matt's real iPhone 2026-07-24 and did not fire: the verdict is final, do not re-try an iOS
haptics workaround** (the gold cue below is the answer). No settings row for haptics.

## The gold word-is-valid cue (2026-07-24)

While the trace is a real new word (`_isCueWord(word)`: length >= `MIN_WORD_LEN`, in the trie, not in
`_found`), the word bar text and traced path get `is-word` (gold `--bg-gold`), the last tile's border
goes gold, and the word bar pulses (`bg-cue-pulse`, ~200ms) once per entered word string
(`_cueState()`/`_lastCueWord`, edge-triggered, shared with trigger 1). `_updateWordCue(word,
{allowHaptic})` is the one apply-point: the swipe path passes `allowHaptic: true`, the keyboard tap path
(full `renderGame()`) gets the visual cue only. `_pulseCue()` does remove-class / force reflow / re-add.
Already-found words never gold. Reduced motion: colour stays, animation suppressed. Gold is a brightness
change, never red/green.

## Multiplayer (2026-07-28)

Two humans race the SAME shaken board over `js/net.js`. `isInProgress()` is `true` for the whole room
life. `gamehub.boggle.mp.v1` is a THIRD key (never touching `gamehub.boggle.v1` or `.save.v1`; rule 5).

**This is NOT the lockstep move-log protocol** the other MP games share: a round has no shared mutable
state during play, so there is nothing to diverge on or hash (write-up: `js/CLAUDE.md`, "Nth consumer:
Boggle"). Do not force it into `tools/test-mp-lockstep.mjs`.

- **Room vocabulary**: `round.deck` = the 16 board FACES (`grid.map(row => row.map(t => t.face))`);
  `round.dealer` = the round's START TIMESTAMP (epoch ms), not a seat; `mp-round.js` `roundEndsAt`
  derives the end time so NEITHER side persists `remainingSec`; a rejoin recomputes and calls `finish()`
  at once if the round already ended.
- **`reportRoundResult(code, role, result)`** (the one new `js/net.js` function) writes
  `hostResult`/`guestResult` as siblings of `result`. `writeResult` does not fit (host-only, sets
  `status:'ended'`, which here means exactly "somebody abandoned the room"). **Each reported result
  carries its OWN round number `n`** because `startRound` never clears them; `bothResultsIn` in
  `mp-round.js` is the guard (`tools/test-boggle-mp.mjs` has a case).
- Both sides start their own local countdown when a round record arrives (`_mpApplyRoundRecord`).
- **No AI, no difficulty setting** (the MP setup hides the difficulty row). `finish()`'s MP branch
  reports the human's own score and waits for both results (Leave button on the waiting card; the
  card's top-right X only dismisses it).
- **The payload carries the actual `foundWords` array** alongside the `words` count (an early build sent
  only the count: "I couldn't see her words"). `foundWords || []` guards pre-fix records. The reveal card
  has "Browse words" (`_mpFullSolveHtml`); `toggle-solve` re-opens whichever overlay is live
  (`this._mpRevealResults`).
- **Stats**: `recordBoggle(difficulty, won, extras)` with `MP_DIFFICULTY = 'mp'` (`tierOf('mp')` null),
  the same `bg` sub-counter, no `players-agg.js` change; `recordHeadToHead('boggle', opp, won)`
  alongside, the opponent captured into `this.mp.opp` and refreshed on every room update
  (`_mpOnRoomUpdate`).
- Rematch series in one room: `round.n` increments; only the HOST starts the next round (`_mpRematch`).
- Tests: `boggle/js/mp-round.js` (pure helpers `roundEndsAt`, `remainingMs`, `wonFor`, `bothResultsIn`)
  and `tools/test-boggle-mp.mjs`. **Status: played once on two real devices; no `FakeRoom` integration test
  exists.**

## Spanish gameplay (2026-09-11) — the dictionary is now a SETTING

Matt: *"Can we make boggle available in Spanish?"* (This superseded the 2026-07-23 "gameplay stays
English" decision; the UI half stands.) **UI language and GAMEPLAY language are two separate choices.**
The setup row **Dictionary / Diccionario** sets the word list and dice; the hub language is only the
DEFAULT until the player has chosen once; a stored `wordLang` always wins.

- **The list is GENERATED**: `tools/build-boggle-es.mjs` fetches **RLA-ES** (LibreOffice es_ES hunspell,
  tri-licensed GPL-3+/LGPL-3+/**MPL 1.1+**; the MPL notice is in `boggle/data/CREDITS.md`) and expands
  the Boggle subset into `words-es.txt` (149,873 words per the generator; 159,778 in the first count).
  Re-run, then `tools/validate-sw-assets.mjs`, commit both. Never hand-edit.
- **Matt's scope calls**: verbs carry **infinitive, gerund and participle only** (no conjugations);
  participles inflect (hablado/a/os/as); nouns/adjectives carry plural (flag `S`) and both genders
  (flag `G`); no proper nouns. **No accents, N stands in for Ñ** (words folded to A-Z), so dice, trie,
  solver, `Qu` tile and scoring are identical to English; the fold MERGES words, never invents them.
  `tools/test-boggle-es.mjs` asserts the edges (HABLO/HABLASTE/COMEREMOS absent).
- **Two bugs found by asking a different question** (printing real solver output, measuring the
  opponent): (1) the generator ran PLURAL rules over FEMININE output (ROJASES, ALTASES): 9,934 bogus
  words, now a `[KNOWN-BUG PROBE]` paired with an assertion that real `-ases` plurals (CLASES, FASES)
  survive; **anything that looks like it needs a second affix pass almost certainly does not**. (2)
  `ai.js` took a fixed percentage, but scoring is superlinear in length and Spanish words are longer:
  AI averaged 37/115/204 vs English 27/76/129. Fixed with `TIER_PCT_BY_LANG` (`es` 0.16/0.33/0.44, `en`
  0.20/0.45/0.70). **`node tools/tune-boggle-es.mjs --ai` is the measurement; re-run after any change to
  dice, gate, word list or `scoreForWord`, and for any future language.**
- **Dictionaries download on FIRST PLAY, not install** (Matt, 2026-09-11): the two lists are 3.23 MB of
  an 11.92 MB REST tier. `sw.js`'s `LAZY` tier (root `CLAUDE.md`) holds only them; still in `ASSETS`
  (hash-tracked, cache-first, validated), just not fetched by the warm; carried forward once present.
  **Cost: a device that never opened Boggle cannot play it OFFLINE** (`renderLoadError` /
  `load_error`). If that bites, the fix is an explicit download feature, NOT un-lazying the tier.
- **`DICE_ES`** is derived (96 faces by letter frequency, 3-6 letter words weighted, vowels spread) and
  measured (`tools/tune-boggle-es.mjs`, 2000 shakes: median 111 words vs English 104). `Qu` carries over; **no
  K/W face, no Ñ face**. **`BOARD_QUALITY_ES`** is its own gate calibrated on Spanish's own 25th
  percentile (no conjugations means fewer short words).
- **Threading**: `dict.js` caches PER LANGUAGE (`dictLang()` maps unknowns to English; a
  `[KNOWN-BUG PROBE]` guards the one-promise bug). The autosave carries the round's `wordLang` (a save
  without one reads as English, rule 3). **In MP the HOST's dictionary decides the match** (in the room
  config beside `timerMinutes`; lobbies show it before the round; a pre-existing room reads English).
  The invalid-word feedback **names the real dictionary** (`{lang}` parameter, never hardcode it).
  **Stats are ONE bucket, deliberately not split by language** (a split `bestScore` that stopped
  counting the other language would break rule 1).

## i18n (2026-07-23) — UI translates; gameplay language is now a setting

- `boggle/js/strings.js` (`{ en, es }`) covers every visible string and tile aria-label; `t = makeT(
  STRINGS)` at render time; no `onLangChange` (it re-renders constantly).
- **`.bg-root` carries `translate="no"` (set in `mount()`). Do not remove it.** Ana's phone auto-
  translated single-letter tiles ("A" -> "UN") and showed "several letters or even a word" on a tile.
- Difficulty ids and timer values are storage vocabulary and stay canonical; title stays "Boggle".
- `js/i18n.js` stamps `document.documentElement.lang` at module load (a Spanish hub declaring
  `lang="en"` invited translation prompts hub-wide).

## Tests

`node boggle/js/test.js` · `node tools/test-boggle-mp.mjs` · `node tools/test-boggle-es.mjs` · `node
tools/tune-boggle-es.mjs [--ai]`.

## The round clock is monotonic, and saved every tick (2026-10-29)

Solo and MP count `performance.now()`; a wall clock moved back adds nothing (a suspended page is charged by it). `remainingSec`/`remainingMs` are saved on EVERY tick (solo save and the MP snapshot), so quit-and-reopen returns the time you had. MP reads the wall clock once when the round arrives (`entryRemainingMs` in `mp-round.js`: never more than the whole round, never more than the last saved tick of the same round) and then runs on its own clock. `saveGame` returns for MP (the solo slot is never written by an MP round). Supersedes "`_endsAt` is recomputed as `Date.now() + remainingSec * 1000`" above.
