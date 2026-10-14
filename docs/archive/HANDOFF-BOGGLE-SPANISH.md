# HANDOFF: Boggle + Spanish — fix Ana's 2026-07-23 reports

**For a Sonnet execution session. Recommended effort: medium.** Every decision below is already
made; execute, verify, commit (do not push — Matt reviews). Written 2026-07-23 against `f6024dd`,
working tree clean, deployed SW `game-hub-v186`.

Reference implementation for the whole task: `snake/js/strings.js` + `snake/js/ui.js` (the i18n
reference), plus `dots-boxes/js/strings.js` for the exact Spanish difficulty vocabulary. The
mechanism doc is `js/CLAUDE.md` ("Language support"); the per-game obligations are root
`CLAUDE.md` "Adding a game" item 9.

## What Ana reported (playing Boggle on her phone, hub language set to Spanish)

1. 12:26 PM: "the word thing is not working well… Sometimes instead of having only one letter
   you have several or even a word" — board tiles showing multiple letters or whole words.
2. 1:54 PM: "The boggle is crazy… Now it is in English even tho I have it in Spanish" — Boggle's
   UI is English despite her Spanish hub setting.

## Diagnosis (verified in code; the on-device part is high-confidence inference, see caveat)

**Issue 2 is by design, and the design is wrong for Ana.** Boggle was deliberately excluded from
the i18n extraction — not even UI chrome (`HANDOFF-I18N-EXTRACTION.md` decision 8, recorded as an
open design question in `js/CLAUDE.md` "Language support" and `HANDOFF-NEXT-SESSION.md` open
thread 2). So with `gamehub.lang.v1 = 'es'` the whole hub is Spanish and Boggle is 100% English.
Ana's report answers the open question: an all-English screen inside a Spanish app reads as
broken. `boggle/js/ui.js` has zero i18n imports; there is no `boggle/js/strings.js`.

**Issue 1 cannot come from our code — it is browser auto-translate rewriting the board.**
Verified: a tile renders exactly one die face (`boggle/js/ui.js` `_boardHtml()` /
`_tileStates()`, face = one letter, `Qu` the only two-character face; `_updateBoardVisuals()`
patches only classes/disabled/aria, never tile text). Nothing in the repo can put a word on a
tile. But a phone set to Spanish, shown a page full of English text, offers/auto-applies
translation (Chrome's Google Translate, or Safari's translate), and machine translation rewrites
TEXT NODES — including single-letter tiles: "A" → "UN", "I" → "YO", etc. This is a well-known
failure mode for letter-grid games. Boggle being all-English (issue 2) is exactly what invites
the translator; the two reports are one root cause. A contributing bug: `<html lang="en">` is
hardcoded in `index.html` and **nothing stamps `document.documentElement.lang` from the stored
preference at load** — `js/i18n.js` sets it only inside `setLang()`, i.e. only when the toggle is
tapped that session. A hub rendering Spanish while declaring `lang="en"` encourages translation
prompts hub-wide.

There is likely a third, silent symptom behind "the boggle is crazy": with the game in Spanish
in her head, Ana traces Spanish words and the ENABLE (English) dictionary rejects them with
"is not in the dictionary". Nothing tells her the words must be English.

**Caveat (verify-inherited-claims rule):** the auto-translate attribution was not reproduced on
Ana's device. The code-side half is verified (tiles cannot render words). Matt has a phone-side
check in the summary he received; do not block on it — the fixes below are correct regardless.

## Decisions (made — do not re-litigate)

- Boggle's **UI chrome translates**; the **gameplay stays English** (ENABLE word list, classic
  English dice). A real Spanish Boggle (Spanish word list + dice distribution) is a separate,
  sizable project and remains Matt's call — explicitly out of scope here.
- The Spanish UI must **say the words are English** where it matters: the invalid-word feedback
  (the place Ana actually hit) and the How-to-play sheet. Functional text only, no narrative
  (standing rule).
- The Boggle root gets **`translate="no"`** so no machine translator can ever rewrite the board,
  hub-mounted or standalone.
- `js/i18n.js` stamps `document.documentElement.lang` from `getLang()` **at module load**, so the
  declared page language always matches the rendered one.
- Title stays **"Boggle"** in both languages (proper name, same as Filler/Mancala/Escoba).

## The work, file by file

### 1. Create `boggle/js/strings.js`

`export const STRINGS = { en: {...}, es: {...} }; export default STRINGS;` — same shape as
`snake/js/strings.js`. English is source of truth; every user-visible string in
`boggle/js/ui.js` gets a key, **including aria-labels**. From reading ui.js, the full inventory:

- Setup: subtitle ("Shake the grid, race the clock, link touching letters into words."), the
  stats line fragments ("played", "best score"), "vs", row labels "Timer" / "Difficulty",
  difficulty labels and the three difficulty hint paragraphs, "Start game", "How to play".
- Difficulty labels use the established vocabulary: **Principiante / Intermedio / Pro**
  (`dots-boxes/js/strings.js` is the model). Ids `beginner|intermediate|pro` are storage
  vocabulary and stay canonical (labels translate, values never).
- Timer labels "2 min"/"3 min"/"5 min" are identical in Spanish — still route them through keys
  for uniformity, or leave literal; executor's choice, but `TIMER_LABEL`/`DIFF_LABEL` are used in
  the END overlay too, so whatever you do must cover both call sites.
- Loading: "Loading the dictionary…", load error text, "Try again", "Back to setup".
- Game screen: "points", "words", the wordbar hint "Swipe through the letters", "Clear",
  "Enter", "Words found", "None yet", "How to play", "Give up".
- Feedback: valid ("{word}: {n} points", singular/plural — a per-language FUNCTION value is the
  documented escape hatch if needed), duplicate ("Already found {word}"), invalid. **The es
  invalid string must name the dictionary language**: en `"{word}" is not in the dictionary`,
  es `"{word}" no está en el diccionario (las palabras válidas son en inglés)`. This is the fix
  for the silent third symptom.
- End overlay: "Tie game!", "You win!", "{name} wins", the score/timer/diff subtitle pieces,
  "{name}'s words" tallies, "Possible on this board", "Browse/Hide every word on the board",
  "Play again", "Change settings", aria "Round over", "Close".
- Help sheet: title, lead, caption, example line, the five bullets, the diagram's aria-label.
  Add a sixth bullet, both languages: en "Words are checked against an English dictionary.",
  es "Las palabras se comprueban con un diccionario en inglés."
- Tile aria-labels (`_tileStates()`): four variants, with `{face}`/`{row}`/`{col}` placeholders —
  the drift tripwire asserts placeholder tokens match across en/es.
- Board aria-label "Boggle board".

### 2. Rewire `boggle/js/ui.js`

- `import { makeT } from '../../js/i18n.js';` + `import STRINGS from './strings.js';` +
  `const t = makeT(STRINGS);`
- **Every t() call at render time, never at module scope.** The module-scope constants
  `TIMERS`, `TIMER_LABEL`, `DIFFICULTIES`, `DIFF_LABEL`, `WORDBAR_HINT` currently bake English
  labels at import — restructure so ids stay module-scope but display labels resolve through
  t() inside the render/label functions (this is exactly what the other nine games did).
- `mount()`: add `translate="no"` to the `.bg-root` div. One attribute; covers hub mount and
  standalone (both go through mount()).
- No `onLangChange` subscription needed (policy: newly rendered UI is enough; Boggle re-renders
  constantly).
- Do NOT touch `game.js`/`dict.js`/`solver.js`/`ai.js`/`data/words.txt` — engine, dice and
  dictionary are pure and out of scope. `recordBoggle` and difficulty ids unchanged.

### 3. `js/i18n.js` — stamp the document language at load

Add a module-scope side effect after the function definitions:
`try { document.documentElement.lang = getLang(); } catch { /* not in a DOM */ }`
with a one-line comment (hardcoded `lang="en"` in the HTML otherwise misdeclares a Spanish
session until the toggle is tapped, which invites browser auto-translate). Headless imports
(node tests import i18n.js transitively) must not throw — hence the try/catch, same as setLang's.

### 4. `js/hub.js` — Boggle registry entry

Blurb becomes `{en, es}` (same pattern as Snake's entry): es
`'Agita la cuadrícula, corre contra el reloj. Une letras contiguas en tantas palabras como puedas.'`
Title stays the string `'Boggle'`.

### 5. `test-i18n-strings.mjs`

Add `{ name: 'boggle/js/strings.js', path: './boggle/js/strings.js' }` to `DICTS`.

### 6. `sw.js`

Add `'./boggle/js/strings.js'` to `ASSETS`. **Bump `CACHE` (`game-hub-v186` → next) as the LAST
edit before the commit** — read the current value at commit time, don't hold it dirty (parallel-
session rule in `HANDOFF-NEXT-SESSION.md`).

### 7. Docs (THE LAW rule 9 — part of the milestone, not follow-up)

- `boggle/CLAUDE.md`: add that the UI is bilingual via `strings.js`, gameplay dictionary/dice
  stay English on purpose, and the root carries `translate="no"` **because machine translation
  rewrites single-letter tiles into words — Ana hit this on 2026-07-23; do not remove it**.
- `js/CLAUDE.md` "Language support": the standing-exclusions sentence currently says Boggle
  (all of it) is excluded — update it: Boggle's UI chrome is translated as of this change;
  gameplay content (word list, dice) remains English; the known-content caveat paragraph stays
  true otherwise. Also note the new `documentElement.lang`-at-load behavior in the i18n bullet.
- `HANDOFF-NEXT-SESSION.md` open thread 2: mark the UI-language half executed (this doc),
  leaving "real Spanish Boggle (word list + dice)" as the remaining open item.

## Out of scope — do not do

- No Spanish word list, no Spanish dice, no dictionary-language setting. Matt's call, later.
- No `translate="no"` on other games or hub-wide `<meta name="google" content="notranslate">`
  (a reasonable future hardening, but it's a product call about ever allowing page translation —
  leave it to Matt; the `documentElement.lang` fix already removes the main trigger).
- No Parchís work (open thread 1, needs the sibling source rebuild).
- `boggle/index.html`'s `lang="en"` can stay — the standalone page inherits the stamp from
  i18n.js the moment ui.js imports it.

## Verification (all before commit)

1. `node run-all-tests.mjs` — all green (test-i18n-strings picks up the new dictionary; expect
   0 missing es keys for boggle since you're writing both sides at once).
2. `node validate-sw-assets.mjs` — clean (catches a forgotten ASSETS entry).
3. `node server.mjs`, then in a browser:
   - Toggle the hub to Español (flag knob). Open Boggle. Setup, loading, game screen, feedback
     (valid, duplicate, invalid — invalid must mention the English dictionary), Words found,
     end overlay (win, and the Browse-every-word list), How to play: all Spanish, no key names
     showing, no English leaking except the game title "Boggle" and dictionary words themselves.
   - `document.documentElement.lang` is `'es'` on a fresh load (no toggle tap) with the
     preference already stored — this proves the i18n.js load stamp.
   - The `.bg-root` element carries `translate="no"`.
   - Toggle back to English mid-setup; next render is English (render-time t()).
   - Tiles always show exactly one face; play a round end to end in Spanish; stats still record
     (My Stats → Boggle increments, byDiff bucket keys still `beginner|intermediate|pro`).
4. Commit (Matt pushes after review). Co-authored-by line per repo convention.
