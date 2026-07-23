# Handoff: translate the hub — the big string extraction (English/Spanish)

**Audience: a Sonnet 5 session. Recommended effort: medium.** The mechanism, the method, and
every architectural decision are already made and shipped (see below); what remains is a large
but mechanical extraction plus careful translation drafting. Medium, not low, because the
translations themselves need real care; not high, because nothing here is open-ended — and the
one catastrophic mistake this task can make (translating a STORED value) is enumerated below in
its own warning. When in doubt, stop and ask Matt rather than deciding.

## What already exists (do not rebuild, do not redesign)

The i18n layer shipped 2026-07-23 and is live: `js/i18n.js` (`getLang`/`setLang` over
`gamehub.lang.v1`, `makeT(dict)` with the chosen-language → English → key fallback and `{name}`
placeholders, `gamehub:lang` event, `onLangChange`), the first-run English/Español chooser, the
flag-knob toggle in the hub top bar, and **`snake/` as the reference implementation** — read
`snake/js/strings.js` + `snake/js/ui.js` before touching anything; every game converts to
exactly that shape. The full mechanism doc is `js/CLAUDE.md` → "Language support"; new-game
obligations are root CLAUDE.md "Adding a game" item 9.

This handoff is the deferred bulk that doc mentions: the hub chrome, the My Stats and
Leaderboards overlays, the profile page, and the 10 pre-Snake games. The fallback chain is the
migration strategy — anything not yet extracted simply keeps showing English, so every phase
below is independently shippable.

## THE one rule that can corrupt data — read twice

**Translate DISPLAYED text only. Never translate a STORED value.** Difficulty ids
(`easy/medium/hard/expert`, `beginner/intermediate/pro`, `extrahard`, `normal`), stats game ids,
localStorage keys, `byDiff` bucket names, event names, and anything passed to a `recordX()` /
`recordResult()` call are storage vocabulary. A translated value there writes NEW bucket names
into `gamehub.stats` and fragments every player's history — a THE LAW violation via i18n. The
pattern everywhere: the `<option>`/segment VALUE stays canonical, its LABEL goes through `t()`.
`js/game-stats.js` (`normDiff`), `js/difficulty-tiers.js`, and every recorder are **completely
out of scope — zero edits**. `test-stats-replay.mjs`/`test-stats-identity.mjs` staying green is
the tripwire, but don't rely on it: just never touch a value.

## Decisions (made — do not reopen)

1. **Game titles stay untranslated.** They are this family's proper names (Chinchón, Escoba,
   Parchís already Spanish; Snake, Filler, Boggle are names), and titles drive alphabetical sort
   in three surfaces (launcher, leaderboard tiles, stats tabs) — per-language titles would
   reorder those per language and unlabel cross-references. If Matt later wants "Tres en raya",
   that's his call, not this task's.
2. **Shared UI gets ONE dictionary: `js/strings.js`**, `{ en, es }`, keys prefixed by surface:
   `hub_` (hub.js incl. first-run, confirm dialog, version pill, card aria), `gs_` (My Stats),
   `lb_` (Leaderboards), `pf_` (profile page), `a2hs_` (add-to-home-screen sheet). One file
   because these change together and precache as one asset.
3. **Hub card blurbs live in the registry as `{ en, es }` objects** (e.g.
   `blurb: { en: 'Drop discs…', es: 'Encesta fichas…' }`), resolved at render
   (`blurb[getLang()] || blurb.en`) — registry data stays co-located with its entry rather than
   scattering 13 keys into js/strings.js.
4. **The profile page uses `data-i18n` attributes** — it's the one static-HTML surface, so its
   existing inline module script gains a tiny applier:
   `document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); })`
   plus `data-i18n-placeholder` and `data-i18n-aria` variants handled the same way, run on load
   and on `onLangChange`. This pattern is profile-page-only; do not spread it to games (their
   strings are runtime templates — the `t()`-at-render convention stands).
5. **Per-game dictionaries**: each game gets `<game>/js/strings.js` exporting `{ en, es }`,
   `const t = makeT(STRINGS)` in its ui.js, every user-visible string (including aria-labels
   and canvas-drawn text) through `t()` at render time. Live `onLangChange` re-rendering is
   OPTIONAL and mostly unnecessary (the launcher is where switching happens); only add it where
   a screen is trivially re-renderable, and always unsubscribe in `destroy()`.
6. **Difficulty display labels** translate everywhere via each surface's own dictionary:
   Beginner/Intermediate/Pro/Expert → Principiante/Intermedio/Pro/Experto (mirror Parchís's
   existing terms exactly), Easy/Medium/Hard → Fácil/Normal/Difícil (mirror Snake's). Values
   stay canonical per the warning above.
7. **Not translated**: `console.*` messages (dev-facing), code comments, the `js/challenge/`
   system (retired, and its copy is Matt's own words by standing instruction — zero edits),
   Monopoly Deal (excluded by Matt), page `<title>`s and manifest names (branding), card-suit
   terms Oros/Copas/Espadas/Bastos (the games' real vocabulary in BOTH languages).
8. **Boggle is out of scope entirely** (Matt, 2026-07-23): not even its UI chrome. It's an
   English word game to its core (dictionary, dice, validation), and Matt has deferred the whole
   question — leave every Boggle file untouched. If someone later wants it, the open design
   question is whether a Spanish UI over English-only gameplay is more confusing than helpful.
9. **Parchís is out of scope.** It has its own working ES setting; wiring `gamehub.lang.v1` as
   its default requires the sibling `../Parchís/` source rebuild (see parchis/CLAUDE.md) — a
   separate small task for a session with that folder available.
10. **Spanish register**: Spain Spanish, neutral imperative/infinitive UI style (like Parchís's
    existing strings — "Nueva partida", not "Empieza una..."), no embellishment. Matt's standing
    rule (memory + repo convention): minimal functional text, no invented narrative or flavor —
    translate what the English says, nothing more. Native speakers will review; keep every
    string a one-line edit away.

## The new test (build this FIRST, in phase 0)

`test-i18n-strings.mjs` at repo root, wired into `run-all-tests.mjs` (after
`favorites.test.mjs`). Node-only, no deps, same idiom as the other suites. It imports every
dictionary that exists (`js/strings.js` + each `<game>/js/strings.js` — enumerate them in the
test; add each as its phase lands) and asserts, per dictionary:

- every `es` key also exists in `en` (no orphaned Spanish);
- for every key present in both, the set of `{placeholder}` tokens matches between languages
  (a missing `{len}` in Spanish silently prints a wrong sentence);
- no value is an empty string;
- (informational, not a failure) log the count of `en` keys missing from `es` — the fallback
  makes that legal, but the number should trend to zero.

This is the drift tripwire for every later session that edits a translation.

## Execution order — one commit per phase, each independently shippable

Every phase ends the same way: `node run-all-tests.mjs` (all green), `node
validate-sw-assets.mjs` (it WARNS about any new strings.js you forgot to add to `ASSETS` — heed
it), CACHE bump in `sw.js` (one per commit that touches deployed files), browser spot-check of
that surface in BOTH languages (flip the top-bar toggle), commit with a message naming this
handoff. **Do not push** — Matt reviews, as always.

- **Phase 0**: `test-i18n-strings.mjs` + `js/strings.js` created with the `hub_` keys +
  `js/hub.js` converted (buttons My Stats/Leaderboards/My Profile, confirm dialog, first-run
  headings/placeholders/messages incl. "Taken. Use that code instead.", version-pill text/aria,
  card aria-labels, blurbs to `{en, es}` per decision 3). The hub toggle already re-renders the
  launcher on switch, so this phase is fully visible immediately.
- **Phase 1**: profile page (`pf_` keys + the `data-i18n` applier per decision 4).
- **Phase 2**: My Stats overlay (`gs_`) + Leaderboards overlay (`lb_`) — every header, tally
  label, empty-state, note ("* fewer than 5 plays…", "Rating weighs win rate…"), and the
  DIFF_META / tier display labels (values untouched).
- **Phases 3–11, one game per commit, smallest first**: Filler, Mancala, Tic Tac Toe,
  Dots and Boxes, Nuts & Bolts, Ball Run, Connect Four,
  Escoba, Chinchón. The two card games are last and largest (Escoba ~219 visible strings incl.
  round-scoring tables; Chinchón similar plus MP room UI — room-code prompts and status lines
  translate, protocol fields and seat ids do not). For each: create `strings.js`, convert
  `ui.js`, add the file to `sw.js` `ASSETS`, add the dictionary to `test-i18n-strings.mjs`'s
  list, one-line i18n note in that game's `CLAUDE.md`.
- **Phase 12 (closeout)**: grep sweep for stragglers in converted files — search them for
  `>Play<`, `>New game<`, `'Difficulty'`, `'You win'`, `'wins!'`, `aria-label="` with English
  words — anything found is either converted or explicitly listed in the commit message as
  deliberately untranslated (with why). Update `js/CLAUDE.md`'s "Language support" section:
  remove the "Shared-UI strings are NOT yet translated" caveat, record what IS translated and
  the standing exclusions (challenge, Monopoly Deal, all of Boggle, Parchís wiring). Rule 9:
  that doc edit is part of the milestone, not follow-up.

## Verification notes specific to this repo

- The preview browser throttles background timers and can't screenshot overlays — verify text
  via `read_page`/`javascript_tool` DOM reads, not screenshots (documented quirk).
- The hub test device is NAMELESS on purpose. Do not set a profile name in the browser while
  testing (it would sync a fake player to the real family leaderboard). The first-run gate can
  be dismissed for testing by removing its DOM node, which writes nothing.
- Escoba and Chinchón have autosaves/MP state in the test browser's localStorage — don't clear
  keys you didn't create; snapshot-and-restore localStorage around destructive UI tests (the
  established pattern in this repo's session history).
- If a converted screen renders `some_key_name` literally, that's the fallback chain telling
  you the key is missing from BOTH languages — fix the dictionary, don't special-case the UI.

## Out of scope

Monopoly Deal (all of it), Boggle (all of it — decision 8), Parchís (decision 9),
`js/challenge/` (decision 7), `normDiff`/`difficulty-tiers.js`/recorders (the warning section),
game logic and engines, storage keys, THE LAW copies, pushing.
