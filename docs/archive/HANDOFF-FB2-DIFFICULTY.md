# HANDOFF-FB2-DIFFICULTY: colored tier shapes, Easy/Medium/Hard rename, broken setup layouts

**Batch A of the 2026-07-24 feedback arc (see HANDOFF-FB2-INDEX.md). Sonnet execution;
effort: medium-high. Run alone (touches many games' strings + setups).**

Matt, on batch 8's result: the ski-slope shapes shipped WITHOUT the color code ("without the
green circle, blue square, and black diamonds it doesn't make any sense to use those
symbols"), and the tier names should be **Easy / Medium / Hard** (+ Expert), not
Beginner/Intermediate/Pro.

## 1. Color the shapes everywhere

Verified: colors exist only in the leaderboard (`TIER_COLOR = {1:'#2e9e44', 2:'#1F5FA8',
3:'#1c2430', 4:'#1c2430'}`, `js/leaderboard-ui.js:39`, applied via `--lb-pill-color`);
`diffShapeSVG` emits `currentColor` shapes, so every setup screen renders them in plain text
color.

- Move `TIER_COLOR` into `js/difficulty-tiers.js` next to `diffShapeSVG`; leaderboard-ui
  imports it from there (values unchanged).
- `diffShapeSVG(tier)` emits BOTH a tier class (`lb-dshape-t1`..`t4`) AND an inline
  `fill="<TIER_COLOR>"` attribute. The inline fill makes the color work on every surface with
  zero per-game CSS (standalone game pages never load hub.css); the class exists so CSS can
  override it.
- The leaderboard's existing `--lb-pill-color` CSS keeps working as-is (CSS rules beat
  presentation attributes) — verify active pills still invert to white-on-color.
- **Dark mode**: near-black tiers 3/4 vanish on dark surfaces. Add to `css/hub.css`'s
  `:root.gh-dark` block: `.lb-dshape-t3, .lb-dshape-t4 { fill: #e6e9f0; }` and note in
  HANDOFF-FB-THEME.md that each game's Phase 2 pass must include the same override scoped to
  its root (append that line to the theme doc's Phase 2 section).
- Colorblind rule holds by construction: color is paired with shape, never alone.

## 2. Rename the display vocabulary: Easy / Medium / Hard / Expert

**Display labels only. Stored ids, byDiff buckets, and every settings value stay frozen (THE
LAW rule 5) — this is a strings-values edit, zero logic.** Spanish: Fácil / Normal / Difícil /
Experto (matches Parchís's existing facil/normal/dificil vocabulary).

Complete surface inventory (verified 2026-07-24 — edit every row, both languages):

| Surface | Keys |
|---|---|
| `js/difficulty-tiers.js:14,16` | `TIER_LABEL` → Easy/Medium/Hard/Expert; `TIER_SHORT` → Easy/Med/Hard/Exp |
| `js/strings.js:126-129` (+es 331-334) | `gs_diff_beginner/intermediate/pro/expert` values → Easy/Medium/Hard/Expert (keys stay) |
| `js/strings.js:81-83` (+es 286-288) | `pf_skill_*` values → Easy/Medium/Hard |
| `connect-four/js/strings.js:16-19` (+es) | `diff_easy/medium/hard/expert` values → Easy/Medium/Hard/Expert |
| `nuts-bolts/js/strings.js:17-20` (+es) | `tier_*` values → Easy/Medium/Hard/Expert |
| `snake/js/strings.js:14-16` (+es) | `diff_*` values → Easy/Medium/Hard |
| `ball-run/js/strings.js:15-17` (+es) | `diff_*` values → Easy/Medium/Hard |
| filler, mancala, tic-tac-toe, dots-boxes, boggle, escoba, chinchon `strings.js` | each game's `diff_beginner/intermediate/pro`-style DISPLAY values → Easy/Medium/Hard (keys and stored ids untouched) |

Note: `js/strings.js:131-133` (`gs_diff_easy/medium/hard`, legacy buckets) already read
Easy/Medium/Hard — after this rename a `beginner` bucket and an `easy` bucket display the same
word. Within any one game only one stored vocabulary exists, so no visible collision; leave
them.

## 3. Fix the two broken setup layouts (screenshot-confirmed by Matt)

- **Connect Four** ("Expert doesn't fit in its box"): `.cf-segmented` is 4 equal grid tracks
  but the label span has no shrink path (`connect-four/css/connect-four.css:72-97`). The
  rename shortens the worst labels; ALSO make it robust: `min-width:0` on `.cf-seg`,
  `white-space:nowrap` + a small-viewport font step-down (e.g. 0.8rem under 400px) on the
  label span. Prove it at 375px in EN and ES (Spanish labels are longer — Experto).
- **Nuts & Bolts** ("difficulties are on top of each other"): `.nb-segbtn-label` is
  `white-space:nowrap` at 0.8rem/800 inside 4 flex columns (`nuts-bolts/css/nuts-bolts.css:
  77-123`) — "Intermediate" bleeds into neighbors. Rename shrinks it; also allow the shape to
  stack ABOVE the label on narrow widths (or step the font down) so all 4 segments + their
  Level lines fit 375px cleanly, EN and ES.

## 4. Two more setup items in the same sweep

- **Nuts & Bolts difficulty screen gets a "How to play" link** (Matt: "there isn't a how to
  play button at all" — the sheet EXISTS but its only button is on the game screen's bottom
  bar, `nuts-bolts/js/ui.js:332`). Add a ghost "How to play" button under Start on the
  difficulty screen opening the same overlay.
- **Ball Run setup redesign** (Matt: "dumb... too many words. the emoji faces don't make
  any sense. the yellow part of the difficulty bar doesn't move"): delete the `.br-blurb`
  prose line, delete `FACE_SVGS` and the range slider entirely (the frozen 50% gradient fill,
  `ball-run/css/ball-run.css:127-135`, dies with it), and replace with the standard
  3-option segmented control: colored shape + Easy/Medium/Hard. Keep title, the per-difficulty
  best line, Play, and the ? help button. This makes Ball Run's difficulty control match every
  other game.

## Verification

1. `node run-all-tests.mjs` + `node test-i18n-strings.mjs` green; play one round at a renamed
   tier in one game and confirm the stored byDiff bucket key is unchanged in devtools.
2. Browser at 375x812, EN and ES, light and dark: every setup shows colored shapes
   (green/blue/black, and light-on-dark for tiers 3/4 in dark where the surface is themed);
   Connect Four and Nuts & Bolts segments fit with no overlap; leaderboard pills unchanged
   (colored border/text, invert on active); Ball Run setup has no slider, no faces, no blurb.
3. `sw.js` CACHE bump LAST; update touched `<game>/CLAUDE.md`s + the theme doc note (rule 9).
