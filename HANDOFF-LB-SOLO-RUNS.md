# HANDOFF — Ball Run runs must stop counting as leaderboard "wins"

**For:** Sonnet, implementing session.
**Written:** 2026-07-28.
**Scope:** display only. `js/leaderboard-ui.js`, `js/game-stats-ui.js`, `js/strings.js`, docs, `sw.js` CACHE bump.

---

## The problem, in Matt's words

> "People are abusing ball run games being counted as 'wins'. We need to identify them
> differently on the Leaderboard. Call them Runs or something."

He is right, and the abuse is trivially easy. Every finished Ball Run run — including one that
crashes on obstacle 0 — writes `played += 1; won += 1`:

```js
// js/game-stats.js:640, inside recordBallRun()
if (d) bumpTotals(g, d, true); else { g.total.played += 1; g.total.won += 1; }
```

`lost` is never touched for Ball Run, so downstream `bucketsOf()` derives
`wins = played - losses = played = runs` (`js/leaderboard-rank.js:49-68`). Those runs then flow
into the Leaderboard's cross-game headline number and, worse, **into the sort that ranks the whole
board**:

```js
// js/leaderboard-ui.js:216 — the By Player sort
const w = winsAtTier(b, ALL_IDS, _diff) - winsAtTier(a, ALL_IDS, _diff);
// js/leaderboard-ui.js:223-227 — the card
const wins = winsAtTier(g, ALL_IDS, _diff);
...
<span class="lb-pnum"><b>${wins}</b><span>${t('lb_wins_unit')}</span></span>   // "wins"
```

So a player can reach #1 on the family leaderboard by tapping Ball Run and crashing instantly,
over and over. **Snake and Nuts & Bolts have the identical shape** — every run/solve is also a
`played+1, won+1` write — so fixing only Ball Run leaves the same exploit open one tile over.

This was a known-and-accepted tradeoff when the wins-only board shipped (see `js/CLAUDE.md`,
"The leaderboard's rating model": *"Known, accepted property: solo volume inflates win counts with
no rating left to discount it"*). Matt has now reversed that call. **That bullet is stale as of
this handoff and you must rewrite it — see step 6.**

---

## Decisions already made (do not re-litigate)

Matt was asked both questions directly and answered:

1. **Scope: all three solo games** — Ball Run, Snake, Nuts & Bolts. Not Ball Run alone.
2. **Treatment: one wins number plus a separate runs line.** The big number becomes competitive
   wins only and the board sorts by it; solo plays stay visible as their own labeled count on the
   same card. Not two equal-weight numbers, and not dropping runs from the screen.

---

## Hard constraints — read before you touch anything

- **This is a READ-PATH change only. Do not touch the write path.** `recordBallRun`,
  `recordSnake`, `recordNutsBolts`, `bumpTotals`, and every stored shape stay exactly as they are.
  Do not "fix" `recordBallRun` to write `won: false`. Every stored `won` counter on every device
  and in every `players/<id>` node stays byte-identical after this change. `js/leaderboard-ui.js`'s
  own header (lines 6-8) already declares the file a read-only consumer; keep that true.
- **THE LAW rule 1 — stored is not enough, data must stay VISIBLE.** Run counts are not being
  deleted, they are being relabeled and moved one line down. Every screen that shows a number
  today must still show that number (or its honestly-labeled parts) after this change. The
  verification checklist in step 8 is how you prove it.
- **Nobody may fall off the board.** The By Player list filter stays
  `playsAtTier(g, ALL_IDS, _diff) > 0` — a player who has only ever played Ball Run must still be
  listed, now showing `0 wins` and their run count. Do not narrow that filter to competitive
  games; that would make a real player vanish, which is a rule 1 regression.
- **Ball Run's own game page is already correct — leave it alone.** `gameMetricAt()`
  (leaderboard-ui.js:147-151) already routes Ball Run/Snake to `brBestAt`/`snBestAt` (best
  obstacles / longest snake) with `lb_unit_obstacles`/`lb_unit_longest` labels, and the By Game
  row and the "who leads what" chips (`lb_tex_total_runs`, leaderboard-ui.js:275-278) are already
  honest. The bug is confined to the **cross-game** number.
- **Do not touch `ttCardHTML`'s fallback** (leaderboard-ui.js:356) or `gameMetricAt` — both are
  single-game calls where "wins" is the right word.

---

## The edits

### 1. `js/strings.js` — one new key pair

Add after `lb_unit_solved` in the **en** block (currently strings.js:184):

```js
    lb_runs_count: '{n} runs',
```

Add after `lb_unit_solved` in the **es** block (currently strings.js:402):

```js
    lb_runs_count: '{n} carreras',
```

`carreras` is the word Ball Run's and Snake's own stats screens already use for `gs_runs`
(strings.js:345), so this stays consistent with what Spanish-language players already see.

`gs_runs` ('Runs' / 'Carreras', strings.js:127 / :345) **already exists** and is reused as-is in
step 5. Do not mint a second key for it.

`test-i18n-strings.mjs` enforces matching `{placeholder}` tokens and matching en/es key sets, so
add both or it goes red.

### 2. `js/leaderboard-ui.js` — split the id list

`SOLO` is already exported from `js/players-agg.js:14` (`new Set(['nutsbolts','ballrun','snake'])`)
and this file already imports from that module (leaderboard-ui.js:23). **Import `SOLO` there
rather than minting a second hardcoded list** — a private copy is exactly the kind of duplicate
that drifts.

Add to the existing import:

```js
import { aggregatePlayers, buildIdentity, SOLO } from './players-agg.js';
```

Then below `ALL_IDS` (leaderboard-ui.js:74):

```js
// Solo games (Ball Run/Snake/Nuts & Bolts) record every run/solve as played+1, won+1 (game-stats.js's
// recordBallRun/recordSnake/recordNutsBolts — a crash on obstacle 0 is a "win"), so folding them into
// the cross-game wins number let volume alone top the board. Matt, 2026-07-28: they are RUNS, counted
// and labeled separately. Derived from ALL_IDS (not players-agg's COMPETITIVE) so this file's two lists
// can never disagree about which games it renders.
const COMP_IDS = ALL_IDS.filter((id) => !SOLO.has(id));
const SOLO_IDS = ALL_IDS.filter((id) => SOLO.has(id));
```

*(Both lists happen to match `players-agg.js`'s `COMPETITIVE` today — `GAMES` in
`js/game-stats.js:84` and `GAME_META` here hold the same 16 ids — but deriving from `ALL_IDS`
keeps them in step automatically if a game is added to only one.)*

### 3. `js/leaderboard-ui.js` — a runs counter

For solo games, plays === runs: `recordBallRun` bumps `total.played` and `br.runs` by exactly one
each per run, and `recordSnake`/`recordNutsBolts` do the same with `sn.runs`/`nb.solved`. So reuse
the existing tier-aware `playsAtTier` rather than reaching into the `br`/`sn`/`nb` sub-counters —
one code path, and it respects the difficulty pills for free. Add next to `playsAtTier`
(after leaderboard-ui.js:112):

```js
/** Solo plays (Ball Run/Snake runs, Nuts & Bolts solves) at `tier`. Every solo record bumps
 *  `total.played` exactly once per run/solve, so plays IS the run count — no need to read the
 *  br/sn/nb sub-counters, and this stays tier-filterable like everything else on this screen. */
function runsAtTier(group, tier) { return playsAtTier(group, SOLO_IDS, tier); }
```

### 4. `js/leaderboard-ui.js` — the By Player card and the player detail header

**`playerCardHTML`** (leaderboard-ui.js:197-210): add a `runs` parameter and rebuild the
`.lb-pmeta` line. Replace line 207:

```js
    <div class="lb-pmeta">${t('lb_games_count', { n: games })}</div>
```

with a partitioned line. The two numbers **partition** the old total (competitive plays + solo
plays = the number that used to render there), so nothing is hidden and the old figure is still
derivable; a zero part is omitted rather than shown as `0`:

```js
    <div class="lb-pmeta">${metaLine(games, runs)}</div>
```

and add above `playerCardHTML`:

```js
/** The card's sub-line. `games` is COMPETITIVE plays and `runs` is solo plays; together they are
 *  exactly the all-games play count this line used to show, so nothing became invisible (THE LAW
 *  rule 1) — it is now split so a run is never read as a game won. A zero part is dropped rather
 *  than rendered as "0". */
function metaLine(games, runs) {
  const parts = [];
  if (games > 0 || !runs) parts.push(t('lb_games_count', { n: games }));
  if (runs > 0) parts.push(t('lb_runs_count', { n: runs }));
  return parts.join(' &middot; ');
}
```

**`playerListHTML`** (leaderboard-ui.js:212-229) — the headline, the tiles and the sort all move
to `COMP_IDS`; the *list filter* stays on `ALL_IDS`:

```js
function playerListHTML(list) {
  const rows = list.filter((g) => playsAtTier(g, ALL_IDS, _diff) > 0);   // UNCHANGED: a solo-only player stays listed
  if (!rows.length) return emptyState(t('lb_empty_all'));
  rows.sort((a, b) => {
    const w = winsAtTier(b, COMP_IDS, _diff) - winsAtTier(a, COMP_IDS, _diff);
    if (w) return w;
    const gg = playsAtTier(a, COMP_IDS, _diff) - playsAtTier(b, COMP_IDS, _diff);   // fewer games wins ties
    if (gg) return gg;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return `<div class="lb-plist">${rows.map((g, i) => {
    const wins = winsAtTier(g, COMP_IDS, _diff);
    const games = playsAtTier(g, COMP_IDS, _diff);
    const runs = runsAtTier(g, _diff);
    const tiers = tiersPresent(g, COMP_IDS);
    const tiles = miniTilesHTML(tiers, (tier) => winsAtTier(g, COMP_IDS, tier));
    return playerCardHTML(g, i, wins, games, tiles, null, runs);
  }).join('')}</div>`;
}
```

Note the tiles switch to `COMP_IDS` **on both arguments** — `tiersPresent` as well as the value
function. If you change only the value function, a solo-only player gets a row of `0` tiles that
says nothing; changing both means they get no tile row at all, and their runs line carries the
information instead.

Pick whichever parameter order you like for `playerCardHTML` — it already has an optional
`unitKey` in position 6, so appending `runs` in position 7 (as above) is the smallest diff. The
**game detail** call site (leaderboard-ui.js:408) passes no `runs` and must keep rendering exactly
what it renders today: that screen is per-game, where `lb_games_count` already means the right
thing. Verify `metaLine(games, undefined)` returns the unchanged string.

**`playerDetail`** (leaderboard-ui.js:437-452) — same substitution:

```js
  const wins = winsAtTier(g, COMP_IDS, null);
  const games = playsAtTier(g, COMP_IDS, null);
  const runs = runsAtTier(g, null);
  const tiers = tiersPresent(g, COMP_IDS);
  const tiles = miniTilesHTML(tiers, (tier) => winsAtTier(g, COMP_IDS, tier));
```

and swap the header's `lb_games_count` call (line 448) for `metaLine(games, runs)`.

The rest of that screen — `gsGameListHTML(g.games)` — is untouched and already shows each solo
game's own real metric, so a player's full Ball Run history is still one tap away.

### 5. `js/game-stats-ui.js` — My Stats' overview tally

Same mislabel, same fix. `overviewTotals` (game-stats-ui.js:418-427) currently folds solo plays
into `wins`. It has no notion of solo games yet, so add the import:

```js
import { SOLO } from './players-agg.js';
```

*(`players-agg.js` imports only `GAMES` from `game-stats.js` — no DOM, no cycle back into this
file. Safe.)*

Then:

```js
/** Sum across every visible game: total plays, competitive wins, and solo runs. Ball Run/Snake
 *  runs and Nuts & Bolts solves are recorded as played+1/won+1 (they have no loss axis), so folding
 *  them into "Wins" made a crash read as a victory — they are counted and labeled as runs instead
 *  (Matt, 2026-07-28; same split as the Leaderboard's By Player card). `plays` still counts every
 *  game, solo included: it was always an honest number and stays one. */
function overviewTotals(games) {
  const g = games || {};
  let plays = 0, wins = 0, runs = 0;
  for (const tab of visibleTabs()) {
    const tot = (g[tab.id] || {}).total || {};
    plays += tot.played | 0;
    if (SOLO.has(tab.id)) runs += tot.played | 0;
    else wins += record(tot).wins;
  }
  return { plays, wins, runs };
}
```

In `overviewHTML` (game-stats-ui.js:441-444), add a third tally, rendered **only when `runs > 0`**
so a player who has never touched a solo game sees exactly today's two-tally layout:

```js
      <div class="gs-tallies is-4">
        <div class="gs-tally"><b>${totals.plays}</b><span>${t('gs_total_games')}</span></div>
        <div class="gs-tally"><b>${totals.wins}</b><span>${t('gs_wins')}</span></div>
        ${totals.runs > 0 ? `<div class="gs-tally"><b>${totals.runs}</b><span>${t('gs_runs')}</span></div>` : ''}
      </div>
```

`gs_runs` already exists in both languages. **Check the `.gs-tallies.is-4` layout with three
tallies in the browser** — that class was written for a fixed count and may need a CSS tweak in
the `#gs-css` block; if it does, follow the existing `var(--hub-surface, #fff)` fallback pattern
so light and dark both work with no new `:root.gh-dark` rule.

Do **not** change `headlineOf` (game-stats-ui.js:380-385) or any per-game `screenFor` screen.
`ballRunScreen` and `snakeScreen` already say "Runs" and were always correct.

### 6. `js/CLAUDE.md` — rule 9, this is part of the milestone, not follow-up

In "The leaderboard's rating model (2026-07-22)", the first bullet ends:

> **Known, accepted property:** solo volume inflates win counts with no rating left to discount
> it; Matt is trading precision for legibility.

That is now false. Rewrite that bullet so it says: a draw counts as a win in competitive games;
solo games (Ball Run/Snake/Nuts & Bolts) are counted and labeled as **runs**, separately from
wins, on the cross-game By Player card, the player detail header and My Stats' overview, because
every run/solve records as `played+1/won+1` and volume alone was topping the board (Matt,
2026-07-28). Say plainly that this is a DISPLAY split only — no stored counter changed — and that
each solo game's own game page still ranks by its real metric (best obstacles / longest / solved).
Mention `COMP_IDS`/`SOLO_IDS` in `leaderboard-ui.js` and that `SOLO` in `players-agg.js` is the
single source for the membership.

Root `CLAUDE.md` needs no change — its module table line for `leaderboard-ui.js` is still accurate.

### 7. `sw.js`

No new files, so `ASSETS` is unchanged. Bump `CACHE` (`game-hub-vN` → `vN+1`) so the version pill
moves and clients pick up the new JS, then run:

```bash
node validate-sw-assets.mjs
```

---

## 8. Verification — do all of it

### Headless

```bash
node run-all-tests.mjs
```

```bash
node test-i18n-strings.mjs
```

Both must be green. Note that `test-leaderboard-rank.mjs` and `players-agg.test.mjs` cover pure
modules you are not touching — they passing proves nothing about this change, so do not treat them
as verification of it. `leaderboard-ui.js` is DOM-bound and has no headless suite; the browser
checks below are the real proof. Do not add a headless suite for it as part of this task.

### Browser (`node server.mjs`, then http://localhost:8123)

**Read `js/CLAUDE.md`'s "Sync health" warning first: never seed fake player stats into a browser
that can reach the real Firebase config.** `hub.js` mirrors `localStorage` to the live
`players/<id>` node on every page load, with no test gate. Verify against your own real data, or
with Firebase blocked in devtools.

Open the Leaderboard and confirm:

1. **By Player** — the big number is competitive wins; a player with solo plays shows a
   `N games · M runs` sub-line; the two numbers sum to the count that line showed before.
2. **A solo-only player is still listed** (this is the rule 1 check that matters most) showing
   `0 wins` and their runs, not missing from the board.
3. **A player with no solo plays** renders identically to before this change — same number, same
   `N games` line, same tiles.
4. **The ranking actually moved**: whoever was inflated by Ball Run volume is no longer above
   players with more real wins.
5. **Difficulty pills** still filter both numbers, and a Beginner-only player is still visible
   under All.
6. **Ball Run's own By Game row and game page are unchanged** — best obstacles, "obstacles" label,
   the `Best obstacles` / `Total runs` chips.
7. **Player detail** header shows the same wins/runs split, and its game list still opens Ball
   Run's real screen with full history.
8. **My Stats** — overview shows Plays / Wins / Runs; the per-game Ball Run and Snake screens are
   untouched.
9. **Spanish** (`Español` in the top bar): the runs line reads `M carreras`, no raw `lb_runs_count`
   key leaking through.
10. **Dark mode** (the ☀️/🌙 toggle): the new line and any third tally are legible.

Screenshots are unreliable on these overlays — per the repo's known quirk, the preview browser
times out on overlay screenshots and forces reduced motion. Verify via `read_page` /
`get_page_text` / computed styles instead, and report what you actually observed.

---

## What "done" looks like

- Ball Run, Snake and Nuts & Bolts volume can no longer move a player up the leaderboard.
- Their run counts are still on screen, on the same card, labeled as runs in both languages.
- Not one stored byte changed: no migration, no new storage key, no recorder edit.
- `js/CLAUDE.md`'s stale "solo volume inflates win counts" bullet is rewritten.
- `node run-all-tests.mjs` and `node test-i18n-strings.mjs` green, `node validate-sw-assets.mjs`
  clean, `sw.js` `CACHE` bumped.

Then **commit and push** — Matt reviews on his phone after the deploy lands.
