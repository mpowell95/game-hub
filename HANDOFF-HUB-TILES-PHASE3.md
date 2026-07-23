> **STATUS: COMPLETE — 2026-07-22, commit `28b7925` (SW v156), pushed to `origin/main`.**
> This document is kept as the archive of WHY the work was scoped this way, matching how the
> other `HANDOFF-*.md` files in this repo persist after their game shipped. **Do not execute it
> as a task list; it is already done.** All 11 games registered at the time were recomposed to
> `viewBox="0 0 160 90"` and verified per game against real rendered pixels.
>
> Two things it says that are now STALE:
> - It describes Phase 3 as "what's left." It is not.
> - It lists Boggle among the games to recompose. Boggle landed from a concurrent session
>   AFTER this doc was written and its art was still square (`0 0 120 120`) and uncommitted at
>   the time of the Phase 3 commit, so it was NOT recomposed. **Boggle is the one remaining
>   tile that is not full-bleed.** It renders acceptably (Phase 1's accent backstop
>   letterboxes it cleanly), but it should be redrawn to `0 0 160 90` to match the rest.
>
> The verification method that worked is worth reusing and is written up at the bottom of this
> file under "Verification method that actually worked."

# HANDOFF — Hub tile art recomposition (Phase 3 of the favorites + landscape tiles work)

**Target executor:** a higher-capability model, **high/xhigh** effort. This is a pure visual-design
phase with a hard "verify, don't guess" requirement — see "Why this needs a strong model" at the
bottom.

**Status: Phases 1 and 2 are DONE, tested, committed, and pushed.** This doc is scoped to Phase 3
only. Read it together with `CLAUDE.md` (in full — this phase touches its "Adding a game" art
convention) and, if it's still present in the repo root, `HANDOFF-HUB-FAVORITES-TILES.md` (the
original three-phase spec this work came from; Phase 3 in that doc is the same phase this doc
covers, in more exploratory form — this doc is the tightened, current-state version of it).

---

## 1. What already shipped — read, do not redo

Commit `4d3eada` on `main` (pushed to `origin/main`), titled "Hub: landscape tiles (Phase 1) +
launcher favorites (Phase 2)":

- **`.hub-card` is now `aspect-ratio: 16/9`, `border-radius: 14px`**, with
  `background: var(--card-accent, var(--hub-surface))` as a letterbox backstop for art that's
  still square. `css/hub.css`.
- **`.hub-card-label`** lost its gradient scrim; it's now white text with a four-way
  `text-shadow` outline (not `-webkit-text-stroke` — that was tried and rejected, it thins small
  bold text instead of clarifying it), positioned `left:10px; bottom:7px`, `white-space: nowrap`.
  Verified against every current label at a 390px/2-up viewport — the longest ("Dots and Boxes")
  fits with ~40px to spare at `font-size: 1rem`, so no size reduction was needed.
- **`js/favorites.js`** (new): pure module, `loadFavorites`/`isFavorite`/`toggleFavorite`,
  storage key `gamehub.favorites.v1`, ids are hub registry ids. `favorites.test.mjs` covers it,
  registered in `run-all-tests.mjs`.
- **`js/hub.js`**: grid now renders favorites-first-then-alphabetical with a `.hub-divider`
  between groups (hidden at zero or all favorited). Each grid cell is now
  `<div class="hub-cell"><button/a class="hub-card">…</button/a><button class="hub-fav">…</button></div>`
  — the heart is a **sibling** of the card, not nested inside it (a `<button>` can't nest in a
  `<button>`/`<a>`). `.hub-soon-tag` moved from top-right to top-left to clear the heart's corner.
- **CLAUDE.md** updated: `js/favorites.js` in the shared-modules table, a THE LAW carve-out for
  user-restorable preferences (rule 2, favorites don't violate "additive writes only"), the
  "Adding a game" checklist updated for favorites-first ordering and — **relevant to this
  phase** — a new art requirement already written in: `viewBox="0 0 160 90"`, composed to fill
  the frame, `preserveAspectRatio="slice"` explicitly called out as tried-and-rejected because it
  bisects shapes at the frame edge (it cut Connect Four's discs in half).
- `sw.js` `CACHE` was bumped for `js/favorites.js`. **Check the current value before you bump it
  again** — another session was landing Boggle concurrently with this work and may have bumped it
  further; don't assume the number this doc was written against is still current.

**A real bug was found and fixed along the way, and it matters for anyone touching this CSS
again:** `.hub-card` needed an explicit `width: 100%` added. Without it, `<button>`-based cards
(every in-hub module game) collapsed to a near-zero size while `<a>`-based cards (Monopoly Deal,
Parchís — launch-out games) rendered fine. Root cause: once `.hub-cell` (not `.hub-card`) became
the grid item, `.hub-card` fell back to normal block-width resolution — and in this rendering
engine, a `<button>` with `display:block` doesn't reliably stretch to its containing block's width
the way a `<div>`/`<a>` does, so `aspect-ratio` derived height from a near-zero shrink-to-fit
width instead of deriving height from a properly-stretched width. If you refactor `.hub-cell`/
`.hub-card` structure again, keep testing **both** card types (button AND anchor) — a check that
only opens a launch-out game's tile will not catch this class of bug.

**Do not repeat Phase 1 or Phase 2.** If you find yourself editing `css/hub.css`'s card geometry,
`.hub-fav`, `.hub-divider`, or `js/favorites.js`, stop — that's already done; you're either
looking at a regression (rare, everything is tested) or you've misread this doc.

---

## 2. What's left: Phase 3 — recompose every game's art to landscape

### 2.1 The rule

Every game's `art` string in `js/hub.js`'s `GAMES` array is currently
`viewBox="0 0 120 120"` (a square composition). Change each to
**`viewBox="0 0 160 90"`** (note: 160:90 reduces to exactly 16:9 — the same ratio as the CSS
`aspect-ratio` on `.hub-card`), with the artwork **redrawn**, not cropped, to fill that frame.
Keep the full-bleed background rect: `<rect width="160" height="90" fill="…"/>`.

**Do not crop a square composition with `preserveAspectRatio="slice"`.** This was tried and
explicitly rejected — it cuts shapes off mid-shape at the frame edge (bisects Connect Four's
discs, shears the bottom row off Dots and Boxes' lattice). Compose fresh for the frame you're
given.

One useful mechanical note: because 160×90 reduces to exactly 16:9, once a game's `viewBox` is
genuinely 160×90 the SVG's default `preserveAspectRatio="xMidYMid meet"` will render it edge-to-
edge with **zero** letterboxing automatically — you don't need to fight `preserveAspectRatio` at
all once the composition itself is the right shape. The `.hub-card { background: var(--card-
accent) }` backstop from Phase 1 stays in place regardless (it's now permanent, documented, safe
for any future non-landscape art), but a correctly-recomposed game should never actually show it.

### 2.2 Current game list and per-game landscape approach

As of this doc, `GAMES` in `js/hub.js` has **12 entries** (Boggle landed from a concurrent
session while Phase 1/2 was being built — **re-check `js/hub.js` yourself before starting**, more
games may have been added since). All 12 currently have square `viewBox="0 0 120 120"` art:

| id | title | accent | landscape approach |
|---|---|---|---|
| `connect-four` | Connect Four | `#1769d4` | the real board is 7×6 — lay it out edge to edge, it finally fits without cropping |
| `chinchon` | Chinchón | `#d4a017` | fanned cards are naturally wide |
| `business-deal` | Monopoly Deal | `#6a4cff` | fanned cards are naturally wide |
| `parchis` | Parchís | `#c0632b` | **square board — see 2.3** |
| `escoba` | Escoba | `#1c7a4f` | fanned cards are naturally wide |
| `filler` | Filler | `#c2557f` | widen the colour grid (roughly 8×5 instead of 5×5) |
| `mancala` | Mancala | `#e08a3c` | a long tray: two rows of pits with a store at each end — biggest improvement of the set |
| `nuts-bolts` | Nuts & Bolts | `#607d8b` | a wide row of bolts instead of the current vertical stack |
| `tic-tac-toe` | Tic Tac Toe | `#0e7c86` | **square board — see 2.3** |
| `ball-run` | Ball Run | `#c22e8f` | track receding toward a horizon suits 16:9 directly |
| `dots-boxes` | Dots and Boxes | (accent changed since — check current value) | widen the lattice, more columns than rows |
| `boggle` | Boggle | `#1f3864` | **square board — see 2.3** |

### 2.3 The genuinely hard ones — flag, do not force

**Parchís, Tic Tac Toe, and Boggle have square boards.** Do not stretch them and do not crop
them. Options, in order of preference:

1. Show the board at full height, centered, with meaningful content filling the flanks —
   Parchís: pieces and a die alongside the cross. Tic Tac Toe: the 3×3 with a winning line
   extending. Boggle: the 4×4 with letter tiles spilling wide (its current art already traces a
   path spelling "BOGL" through the grid — that idea can extend into the flanks).
2. Show a wide *portion* of the board that still reads — e.g. Parchís: one arm of the cross plus
   its home column.

If a game resists both, **stop and show it rather than shipping something stretched.** Flagging a
board as unsolved-in-this-pass is an acceptable outcome; a stretched or cropped board is not.

### 2.4 Visual verification is MANDATORY — read this before writing any SVG

This repo has already lost roughly 30 sessions to board rendering iterated blind (see
`CLAUDE.md`'s general tone about this — it's a running scar, not hyperbole). This phase exists
specifically to avoid repeating it. For **every single game**, one at a time:

1. Start the dev server (`node server.mjs`, or `PORT=<n> node server.mjs` if another session's
   dev server already holds 8123 — check with a quick request before assuming the port is free).
2. Load the hub in a real browser preview at ~390px width.
3. Screenshot the grid (or at minimum that one tile, zoomed).
4. Confirm: art fills the frame edge to edge, **nothing is cut off at any edge**, the composition
   still reads as that specific game, and the label is legible on top of it.
5. Fix and re-screenshot before moving to the next game.

**Do not batch all twelve (or however many `GAMES` has grown to) and check once at the end.**
That is precisely the failure mode that burned the ~30 sessions referenced above.

**Before you start the loop, verify your screenshot tool is actually working** — actually
compositing pixels, not just returning without error. The session that did Phase 1/2 spent a
meaningful stretch fighting a Browser-pane tool that returned "not displayed / not compositing"
errors, and even after a full close/reopen showed a visual ghosting artifact (two frames
overlaid) before it stabilized. If your equivalent tool is unreliable, say so and stop rather than
proceeding on DOM/geometry checks alone — bounding-box math can confirm an SVG's shapes stay
inside its `viewBox`, but it cannot tell you whether the composition still *reads* as Connect
Four, which is the actual thing this phase is checking for.

Finish by screenshotting the full grid (all games, scrolled through if needed) and include it in
your final report.

### 2.5 Files touched

| File | Change |
|---|---|
| `js/hub.js` | each `GAMES[].art` string: `viewBox="0 0 120 120"` → `viewBox="0 0 160 90"`, redrawn |
| `sw.js` | bump `CACHE` (no `ASSETS` entries change — art is inline in `hub.js`, not a separate file) |

No CSS changes are expected. `.hub-card`'s accent-background backstop and the label treatment are
already correct for landscape art; they were built in Phase 1 anticipating this phase.

---

## 3. Acceptance checklist

- [ ] Every game's art uses `viewBox="0 0 160 90"` with a full-bleed background rect
- [ ] **Screenshot per game** (not batched) confirming nothing is cut off at any edge and the
      composition still reads as that game
- [ ] Parchís, Tic Tac Toe, and Boggle either read well in landscape or were explicitly flagged
      as unsolved — not stretched, not cropped
- [ ] `.hub-card { background: var(--card-accent) }` left in place (Phase 1's backstop; harmless
      once art is landscape, still useful for any future game added with square art)
- [ ] Full-grid screenshot included in the final report
- [ ] `sw.js` `CACHE` bumped (check the current value first — don't assume it matches this doc)
- [ ] `node validate-sw-assets.mjs` green
- [ ] `node run-all-tests.mjs` green
- [ ] No em dashes in any user-facing copy touched (SVG `<text>` labels, if any)
- [ ] `CLAUDE.md`'s art requirement (already written, see §1) still matches what you actually did
      — if you deviate from `160×90`/full-bleed-rect/no-slice for a good reason, update the doc
      to match reality rather than leaving it silently wrong

---

## 4. Out of scope (do not build these)

- Any change to game logic, engines, or stats/leaderboard/Firebase code.
- Any change to `js/favorites.js`, favorites ordering, the heart button, or the divider — done,
  tested, shipped.
- Renaming any game id, folder, or storage key.
- A general SVG-art refactor (shared shapes, a build step, etc.) — each game's art stays a plain
  inline string in `GAMES`, matching how every other entry already works.

If mid-phase you think one of these is actually necessary, stop and say so rather than building
it — same rule the original three-phase handoff used.

---

## Why this needs a strong model

The judgment calls are all in Phase 3, and there's no formula for most of them:

1. **Nine of twelve boards need a genuine re-composition decision** (how do you make Connect
   Four's 7×6 grid, or Escoba's fanned cards, look intentional at 16:9 rather than just
   "resized"), not a mechanical transform.
2. **Three boards are genuinely square** and need a considered per-game call between "show full
   height with flanking content" and "show a wide slice," with real permission to punt and flag
   instead of forcing a bad answer.
3. **The verification discipline is easy to skip under time pressure** and expensive to skip in
   practice — this repo's own history is the evidence. A model that batches the screenshot loop
   "to save time" will very likely reproduce the exact failure this phase is designed to prevent.

The code surface is small (one field per `GAMES` entry, one `sw.js` line). The design and
verification discipline are not.

---

## Verification method that actually worked (2026-07-22)

The in-app Browser pane was unusable for this work: `screenshot` kept failing with "the Browser
pane is not displayed, so the page is not compositing frames," and survived a full
stop/reopen. Interaction tools (clicks, DOM reads, localStorage) still worked; only pixel
capture was broken.

**The workaround: drive headless Chrome directly and read the PNG off disk.** Chrome is at
`/c/Program Files/Google/Chrome/Application/chrome.exe`. Write the file into the session
scratchpad, then open it with the Read tool to actually SEE it.

```sh
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$SP/chrome-prof" \
  --force-device-scale-factor=2 \
  --virtual-time-budget=3000 \
  --screenshot="$OUT" \
  --window-size=780,1700 \
  "http://localhost:8125/"
```

Three traps, each of which silently produces a WRONG picture rather than an error:

1. **`--force-device-scale-factor` makes Chrome treat `--window-size` as PHYSICAL pixels.**
   To hold a 390px CSS viewport (phone width) at scale 2, the window must be `780` wide.
   Passing `390` gives a much wider CSS viewport and silently crops the right-hand column,
   which looks like a layout bug in the page.
2. **Chrome enforces a minimum window width (~500px).** So scale 1 with `--window-size=390`
   does NOT give a 390px viewport either. Use scale 2 and compute width as `390 * scale`.
3. **Each headless run is a fresh profile, so the hub's first-run "Choose a name" dialog
   covers the grid.** Fix by pointing `--user-data-dir` at a persistent directory and seeding
   `gamehub.profile` once: serve a temporary same-origin page that writes the key, load it in
   one headless run, then delete that page. localStorage persists in the profile dir for every
   later run.

**Verify one game at a time.** Doing so caught four defects that reading the SVG markup would
not have: Monopoly Deal's five white cards merging into one blob (they had no borders and too
much overlap), Escoba's broom reading as a key (too small, fused with the coin), Nuts & Bolts'
outer stacks sitting flush to the tile edges, and Tic Tac Toe's strike line drawn OVER the
marks turning the row into a scribble. All four looked perfectly reasonable in source.

## Concurrency note (how this was landed without touching another session's files)

Another session was mid-flight in `js/hub.js` and `sw.js` (the Boggle integration) with
uncommitted changes, and those are the exact two files this phase had to edit. Rather than
edit shared working files, the work was done in a **git worktree branched from committed
HEAD**:

```sh
git worktree add <scratchpad>/wt-phase3 -b phase3-landscape-art
# ...edit, verify, commit inside the worktree...
git push origin phase3-landscape-art:main     # fast-forward, never touches the main checkout
```

The other session's working copy was verified byte-intact afterwards. The branch
`phase3-landscape-art` was deliberately left in place as a recovery point, because a merge
conflict in `js/hub.js` is expected when the Boggle work commits (its copy of `hub.js` predates
the landscape art). **When resolving that conflict, keep the landscape art from `origin/main`
and re-add the Boggle entry on top of it.**
