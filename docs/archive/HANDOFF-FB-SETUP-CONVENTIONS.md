# HANDOFF-FB-SETUP-CONVENTIONS: alternate first player, ski-slope symbols, one difficulty vocabulary, restart everywhere, Nuts & Bolts setup redesign

**Batch 8 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: high.** This batch touches most games'
setup screens — do NOT run it in parallel with the per-game batches (index doc has the order).
Decisions made; execute, verify, commit.

**The one absolute rule for the whole batch (THE LAW rule 5 + the translations convention):
stored difficulty ids, settings keys, and `byDiff` bucket names NEVER change. Every change
below is a DISPLAY-label or UI change.** `js/difficulty-tiers.js` (read path) and `normDiff`
(write path) are zero-edit. If an edit would touch a stored vocabulary, stop.

## 1. Alternate who goes first, by default (turn-based vs-AI games)

Matt: "every turn based game (connect 4, tic-tac-toe, mancala, etc) should be set to alternate
who goes first by default." Mancala already does exactly this (auto-alternates, persists
`nextStarter`, announces the opener — `mancala/js/ui.js:362-378`); it is the model.

| Game | Current (verified) | Change |
|---|---|---|
| Connect Four | `who_first` You/Opponent, default You, rematch never swaps | Add third option **Alternate**, make it the DEFAULT for devices with no saved choice; alternation persists a `nextStarter` field in a `gamehub.connect4.v1` settings key (this game persists nothing today — new key, standard convention) |
| Tic Tac Toe | `set-first` You/Opponent, default You | Same: add Alternate, default Alternate, `nextStarter` persisted in `gamehub.tictactoe.v1` |
| Dots and Boxes | `set-first` You/Opponent, default You | Same, in `gamehub.dotsboxes.v1` |
| Filler | No setting, human always P1 | Alternate silently (no new setting row): persist `nextStarter` in `gamehub.filler.v1`; the AI opening just plays its first color pick before you |
| Mancala | Already alternates | No change (it is the reference) |
| Chinchón | Dealer fixed to seat 0 every match | Alternate the STARTING dealer per match (persist in its frozen `chinchon-settings` store as a new additive field); per-round rotation already exists |
| Escoba | Random starting dealer each match | Leave as is — random is already fair; changing it buys nothing |

Rules: an explicit saved You/Opponent choice always wins (settings precedence — do not
override existing devices' choices); "Alternate" swaps on every completed game INCLUDING
rematches; each game announces who opens the way Mancala does (reuse each game's existing
status/toast line — no new UI surface). Strings EN+ES.

## 2. Ski-slope difficulty symbols on every setup screen + ONE display vocabulary

Matt: "add the difficulty symbols (ski slopes) to each game. Also standardize the terminology."

- Extract `diffShapeSVG` (green circle / blue square / black diamond / double diamond,
  currently `js/leaderboard-ui.js:155-161`) into the shared read-path module
  `js/difficulty-tiers.js` (it already owns the tier mapping; a pure markup helper fits its
  no-DOM discipline — return an SVG string). `leaderboard-ui.js` imports it from there;
  behavior identical.
- Every game's setup difficulty control renders the shape BEFORE the label, sized to the text
  (~1em), via `tierOf(id)` → shape. Shape + label together (never hue alone — colorblind rule;
  the shapes are the point).
- **Display labels standardize on the tier names the leaderboard already uses**
  (`TIER_LABEL`): Beginner / Intermediate / Pro / Expert (es: Principiante / Intermedio / Pro /
  Experto). Per-game display changes (stored ids in parentheses stay FROZEN):
  - Connect Four: Easy/Medium/Hard/Expert → Beginner/Intermediate/Pro/Expert (`easy/medium/hard/expert`)
  - Chinchón: Easy/Average/Hard → Beginner/Intermediate/Pro (`easy/normal/hard`)
  - Escoba: already displays Beginner/Intermediate/Pro — no change (model for the mismatch pattern)
  - Ball Run: EASY/MEDIUM/HARD → Beginner/Intermediate/Pro, normal case (`easy/medium/hard`)
  - Snake: Easy/Medium/Hard → Beginner/Intermediate/Pro (`easy/medium/hard`)
  - Nuts & Bolts: Easy/Medium/Hard/Extra Hard → Beginner/Intermediate/Pro/Expert (`easy/medium/hard/extraHard`)
  - Filler, Mancala, Tic Tac Toe, Dots and Boxes, Boggle: already Beginner/Intermediate/Pro — shapes only.
- The profile page's opponent skill picker (1/2/3) gets the same three shapes+labels if it
  shows difficulty words (check `profile/index.html`).

## 3. Delete difficulty explanation prose, everywhere

Matt, verbatim, about Boggle's "Finds close to half the words on the board, an even mix of
lengths": "delete explanations of difficulties... make sure Claude knows you hate this shit."
Applies repo-wide (his standing minimal-text rule). Remove the per-tier prose paragraphs:
Tic Tac Toe `ttt-hint` (`tic-tac-toe/js/ui.js:174`), Dots and Boxes `db-hint`
(`dots-boxes/js/ui.js:188`), Boggle `bg-hint` (`boggle/js/ui.js` — AFTER the Spanish batch is
committed; the hints were just translated, delete them anyway, both languages), Nuts & Bolts
`tier_desc_*` (see item 5). Delete the orphaned keys from BOTH `en` and `es` in each
`strings.js`. The difficulty row shows shape + name, nothing else.

## 4. Restart button where it's missing

Matt: "Add restart button to some games." Survey result: mid-game restart (instant re-deal,
same settings) is missing in **Tic Tac Toe, Dots and Boxes, Filler** (their only mid-game
button goes to setup). Add a "Restart" ghost button next to the existing mid-game controls in
those three, confirm-guarded the way Connect Four does it (`confirmDestructive`,
`connect-four/js/ui.js:359` — second tap confirms). Boggle (timed sprint) and Snake/Ball Run
(live runs with instant retry on death) deliberately get nothing — restart there is either
Give up or dying, both exist.

## 5. Nuts & Bolts setup redesign (Matt: "I just dislike this. redesign it.")

Replace the four stacked prose cards (screenshot-verified: Easy/Medium/Hard/Extra Hard, each
with "Level N" + a description line) with the hub's standard setup shape:

- Title, then ONE difficulty row: four segmented options, each ski-slope shape + standardized
  label (Beginner/Intermediate/Pro/Expert), no descriptions anywhere.
- The selected tier's progress shows as a single value line on the row: `Level {n}` (the
  per-tier level counters in `gamehub.nutsbolts.v1` are player progress — display them,
  never reset them).
- A primary Start button launches the selected tier (today tapping a card launches directly;
  the two-step select-then-start matches every other game and is the redesign).
- Keep the kept-aside in-progress board behavior exactly as is (it is also being touched by
  HANDOFF-FB-RESUME — coordinate via the index order, resume lands first).

## Verification

1. `node run-all-tests.mjs` + `node test-i18n-strings.mjs` green.
2. Grep-verify zero changes to stored ids: `byDiff` buckets written after playing one game per
   changed game still use the old ids (play one round each at a renamed tier, check
   `gamehub.stats` in devtools — rule 6 style spot check).
3. Leaderboard difficulty pills still filter every game correctly (the pills key off
   `tierOf`, which did not change).
4. Browser pass at 375x812, EN and ES: every setup shows shapes+standard labels, no prose;
   alternate-first games actually swap the opener across two consecutive games (play two);
   restart works mid-game in TTT/D&B/Filler with confirm.
5. `sw.js` CACHE bump LAST. Update each touched `<game>/CLAUDE.md` one-liners + the root
   games-table row for Nuts & Bolts if its setup description changes (rule 9).
