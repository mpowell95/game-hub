# Boggle (`boggle/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Timed word search vs AI on a 4x4 grid shaken from the real 16 classic Boggle dice (`boggle/js/game.js`'s `DICE`, shuffled into position then one random face each; random-letter boards are frequently unplayable, so this repo does not generate one). **The solver is the AI, not a separate opponent**: one exhaustive DFS against the dictionary trie (`boggle/js/solver.js`) produces the scoring word list, the end-of-round reveal, AND the opponent all from a single algorithm — `boggle/js/ai.js` has no search of its own, it just samples a difficulty-scaled slice of the solver's own output (beginner ~20% biased toward short words, intermediate ~45% unbiased, pro ~70% biased toward long/high-scoring words), so every AI word is provably a genuine board find, never invented. Dictionary is the public-domain **ENABLE** word list, ~170k words (`boggle/data/words.txt` + `boggle/data/CREDITS.md`) — **the first game in this repo to ship a large non-image data asset**; like any code file it must be in `sw.js`'s `ASSETS` precache list or the game silently breaks offline, and any future word game following this pattern should precache its own word list the same way. Fetched once, lazily, on first game start, and parsed into a trie of nested `Map`s (deliberately not a `Set` of every prefix, which would duplicate ~170k strings many times over) cached in module scope so hub navigation never re-fetches or rebuilds it (`boggle/js/dict.js`). The `Qu` tile is a single tile worth two letters and must advance the trie by both in one board step — the classic Boggle solver bug is getting this wrong, and `boggle/js/test.js` asserts it directly (a board with the Qu tile must find "QUIT" and must never produce a malformed "QIT"). A round is a shared-board timed sprint (2/3/5 minute settings, not turn-based): both sides score independently against the same board with no duplicate cancellation (real Boggle cancels words both sides found; against a solver-backed opponent that would gut the human's score every round), higher total wins, and ties are real. **Input is swipe-to-trace** (drag through the letters without lifting, release to submit, slide back over the previous tile to undo a letter): tapping each letter then pressing a submit button was too slow to be worth playing against a clock (Matt, 2026-07-22). Tap-to-select is kept alongside it, not as a dead fallback but as the path that keeps the board usable by keyboard and screen reader, since every tile is still a real `<button>`. Three things make the swipe work and are easy to break: the board sets `touch-action: none` (without it a drag scrolls the page instead of spelling), tracing hit-tests against tile rects **cached at gesture start** rather than `elementFromPoint` (so backtracking still works over tiles that are `disabled` for being illegal next steps), and a drag patches the board in place via `_updateBoardVisuals()` instead of re-rendering (an `innerHTML` rebuild mid-drag destroys the element under the finger and breaks pointer capture). The synthetic `click` a browser fires after a tap is ignored by **timestamp**, never by a boolean flag: ending a trace can re-render the board, leaving that click aimed at a detached node the delegated handler never sees, which would strand a flag `true` and silently swallow the next keyboard activation. The tracing rules themselves live in `game.js`'s pure `pathAction()` so they unit-test with no DOM. **Boards are quality-gated** (`solver.js`'s `shakePlayableBoard`/`BOARD_QUALITY`, the same regenerate-rather-than-ship-a-bad-one idea as `nuts-bolts/js/generator.js`): the authentic dice are kept, but a shake is rejected and re-rolled if it falls under 60 findable words, 35 short words, or 4 vowels. Measured over 3000 real shakes, the rare letters are NOT over-represented (J/X/Q/Z/K each sit on exactly one face of one die, so ~60% of authentic boards carry one and that is correct) — the actual problem was vowel-starved boards with nothing findable, ~9% of shakes. Gating clears in 1.39 shakes on average (~0.8ms, a solve is ~0.6ms) and drops boards under 40 words from 7.4% to 0%. Settings in `gamehub.boggle.v1`. Results via `recordBoggle(difficulty, won, extras)`: maintains the shared `total`/`byDiff` bucket AND a `bg` breakdown (`{played,won,lost,tied,words,bestScore,longestWord}`) — `tied` is explicit (a round can genuinely tie), `words` is the human's cumulative found-word count (additive), `bestScore` is `Math.max` only, and `longestWord` (`{word,len}`) is replaced only when strictly longer, never by a shorter word even on a winning round. `isInProgress()` is the autosave/resume meaning (Escoba/Mancala's) since the 2026-07-23 resume batch below: leaving mid-round is lossless, so it always returns `false`.

## Autosave/resume (2026-07-23, batch 9 of the feedback arc)

Boggle is the special case among the "every game defaults to resumable" batch
(`HANDOFF-FB-RESUME.md`): a round is a live countdown, so pausing the clock
across a hub navigation would be wrong. `gamehub.boggle.save.v1` (new key,
separate from settings) saves `{faces, found, remainingSec, timerMinutes,
difficulty}` after every scored word and on `destroy()` (belt and braces, so
backgrounding mid-word-entry is covered too). Deliberately NOT saved: the
solver's full word list, which `resumeGame()` recomputes from the saved board
letters once the dictionary trie is loaded again (`solveBoard`), since that is
cheap and deterministic. On mount, a valid save restores straight onto the
live board (no setup screen, no "resume?" dialog) with the found-words list
intact, then **`_endsAt` is recomputed fresh as `Date.now() + remainingSec *
1000`** -- the clock is paused while away, on purpose, favoring the player.
Cleared on round end (`finish()`), on starting a fresh round, and on explicit
"give up" from the game screen; never on hub navigation. A malformed or
non-4x4-of-letters save is treated as no save (`loadGame()`'s hard validation)
and never crashes the mount. `isInProgress()` flipped to the Escoba/Mancala
meaning (always `false`) since leaving is now lossless.

## Difficulty display (2026-07-24)

The setup screen's difficulty row (Beginner/Intermediate/Pro) shows the shared ski-slope shape
(`diffShapeSVG`/`tierOf`, `js/difficulty-tiers.js`) before each label, same shapes the leaderboard
uses, sized ~1em via `.bg-root .lb-dshape`. **The per-tier prose hint** ("Finds close to half the
words on the board...") that used to sit under the segmented control was deleted per Matt's
standing rule against difficulty-explanation prose — the row now shows only shape + name. The
`bg-hint` DOM element, its CSS rule, and the `hint_diff_*` keys (both `en`/`es` in `strings.js`)
are gone; difficulty ids (`beginner`/`intermediate`/`pro`) are untouched.

## i18n (2026-07-23) — UI translates, gameplay stays English

Ana reported two things the same afternoon: garbled board tiles ("sometimes instead of one
letter you have several or even a word") and an all-English screen despite her hub language
being set to Spanish. The second was true by original design (Boggle was the one standing
i18n exclusion); the first could not come from this repo's code — a tile renders exactly one
die face, nothing here ever writes a word onto one — and was diagnosed as the phone's browser
auto-translating the page, which rewrites TEXT NODES including single-letter tiles ("A" → "UN").
An all-English screen inside an otherwise-Spanish app is exactly what invites that. Both reports
trace to one root cause, fixed together:

- **`boggle/js/strings.js`** (`{ en, es }`) covers every user-visible string in `ui.js` —
  setup, loading, the game screen, feedback, the end overlay, the how-to-play sheet, and every
  tile aria-label. `ui.js` builds `const t = makeT(STRINGS)` and calls it at RENDER time, same
  pattern as every other bilingual game (reference: `snake/`). No `onLangChange` subscription:
  Boggle re-renders constantly on its own, so the next render is enough.
- **Gameplay stays English on purpose** — the ENABLE word list and the classic English dice are
  untouched; a real Spanish Boggle (Spanish word list + dice distribution) is a separate, larger
  project, Matt's call. The Spanish UI says so explicitly where it matters: the invalid-word
  feedback names the dictionary language (`"{word}" no está en el diccionario (las palabras
  válidas son en inglés)` — this is the fix for a likely silent third symptom, a Spanish-minded
  player tracing Spanish words the ENABLE dictionary was always going to reject with no
  explanation), and the how-to-play sheet's sixth bullet says the same thing.
- **`.bg-root` carries `translate="no"`** (set in `mount()`) so no machine translator can ever
  rewrite the board again, hub-mounted or standalone. **Do not remove this** — it is the direct
  fix for what Ana hit, verified by re-reading the tile-rendering code (a tile can only ever show
  one die face; nothing in this file can put a word on it) but not reproduced live on her device,
  so the attribute is cheap insurance against the same failure mode even if the auto-translate
  diagnosis turns out to be incomplete.
- Difficulty ids (`beginner|intermediate|pro`) and the timer values (`2|3|5`) are storage
  vocabulary and stay canonical; only their display labels translate.
- Title stays **"Boggle"** in both languages (a proper name, same as Filler/Mancala/Escoba).
- `js/i18n.js` now also stamps `document.documentElement.lang` from the stored preference at
  MODULE LOAD, not only inside `setLang()` — a hub rendering Spanish while declaring `lang="en"`
  (the prior behavior on any load before the toggle was tapped that session) was itself inviting
  translation prompts hub-wide, a contributing factor independent of Boggle specifically.
