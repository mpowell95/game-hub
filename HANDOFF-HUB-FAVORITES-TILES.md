# HANDOFF — Hub favorites + landscape tile redesign

**Target executor:** Sonnet, **high** effort. See "Why high" at the bottom.
**Scope:** a hub-shell feature (favorites) plus a visual redesign of the launcher grid
(landscape tiles, recomposed art, new label treatment). **No game logic is touched.**
**Estimated size:** ~350 LOC of code, plus recomposing every game's tile art.

Read `CLAUDE.md` first, in full. This work changes two documented conventions (grid ordering
and the how-to-play/label styling family), so section 6 is mandatory, not cleanup.

**This is three independently shippable phases. Do them in order.** Phase 3 is the long tail
and may warrant its own session — say so rather than rushing it.

| Phase | What | Shippable alone |
|---|---|---|
| 1 | Card geometry + label treatment | yes |
| 2 | Favorites system | yes |
| 3 | Recompose every game's art for landscape | yes, incrementally |

---

## Phase 1 — card geometry and label

### 1.1 Aspect ratio

`css/hub.css`, `.hub-card`:

```css
aspect-ratio: 16 / 9;    /* was 1 / 1 */
border-radius: 14px;     /* was 18px — 18 reads chunky at the shorter height */
```

Grid stays `repeat(2, 1fr)` on phones. Do not add columns; density comes from the shorter
row, and 2-up is what the reference uses.

### 1.2 Interim art safety net — required for phase 1 to ship alone

Until phase 3 lands, the art SVGs are still `viewBox="0 0 120 120"`. In a 16:9 frame the
default `preserveAspectRatio` letterboxes them, leaving gaps at the left and right where the
art's own background rect no longer reaches.

**Do not fix this with `slice`.** Cropping a square composition to 16:9 cuts content off
mid-shape (it bisects Connect Four's discs) — that is the wrong fix and it was explicitly
rejected.

Instead, set the card's own background to the accent so the letterbox blends:

```css
.hub-card { background: var(--card-accent); }
```

The square art then sits centered on a matching field and reads as intentional. Phase 3
removes the need for this, but leave the rule in — it is a harmless backstop for any future
art that is not yet landscape.

### 1.3 Label — outline, no scrim

**Delete the gradient background from `.hub-card-label`.** Once the letters carry their own
contrast the scrim is dead weight, and it currently covers roughly the bottom third of every
tile. Removing it returns that third of the artwork on every game, which matters much more
now that tiles are shorter.

```css
.hub-card-label {
  position: absolute;
  left: 10px; bottom: 7px;      /* was left:0; right:0; bottom:0 with padding */
  right: auto;
  padding: 0;
  font-weight: 800;             /* unchanged, already correct */
  font-size: 1rem;
  color: #fff;
  background: none;             /* the scrim is removed */
  text-shadow:
    -1px -1px 0 #000, 1px -1px 0 #000,
    -1px  1px 0 #000, 1px  1px 0 #000,
     0 2px 6px rgba(0, 0, 0, 0.7);
}
```

Four offset shadow copies, **not `-webkit-text-stroke`.** Stroke centers on the glyph edge
and eats inward, which makes small bold text look thinner instead of clearer. The offsets sit
fully outside the letterform.

**Verify against the hardest case, which is Mancala** — its light tan board is the lowest
contrast art in the library. If the label holds there, it holds everywhere.

### 1.4 Font size must be measured, not guessed

The longest labels are "Dots and Boxes", "Monopoly Deal", and "Connect Four". At a 2-up tile
on a 390px viewport the tile is ~175px wide, leaving ~155px of usable label width.

Apply the repo's own how-to-play rule here (CLAUDE.md, Accessibility + copy conventions):
**measure the actual rendered width against the real available width and size down until it
fits.** Do not pick a font-size because it looks about right. The label must not wrap and must
not truncate.

---

## Phase 2 — favorites

### 2.1 New shared module `js/favorites.js`

Pure, DOM-free, no dependencies. Model it on `js/profile-store.js` for validation style.

```js
export function loadFavorites()      // -> string[] of hub ids, [] on missing/malformed
export function isFavorite(id)       // -> bool
export function toggleFavorite(id)   // -> new bool state, persists
```

Storage key `gamehub.favorites.v1`:

```js
{ version: 1, ids: ['escoba', 'tic-tac-toe'], updatedAt: '2026-07-22T...' }
```

- Store **hub registry ids** (`'tic-tac-toe'`), never stats keys (`'tictactoe'`). Same
  dashed/undashed trap as every game handoff.
- try/catch on read; malformed data returns `[]` and never throws.
- **An id that no longer matches a registered game is ignored on read but never pruned from
  storage.** If a game is temporarily unregistered its favorite returns when the game does.

### 2.2 THE LAW does not govern favorites — settle this explicitly

Rule 2 says writes are additive only and nothing is ever zeroed or overwritten with less.
Unfavoriting is literally a removal, so a strict reading forbids the feature's core action.

**The distinction: THE LAW governs history and achievement — data a player earned and cannot
recreate. Favorites are a user-controlled preference restorable in one tap.** Removal is the
user's intent, not data loss.

Write this into CLAUDE.md (section 6). Without it, a future session will either refuse to
implement removal or invent a tombstone scheme to satisfy a rule that was never about
preferences.

### 2.3 Ordering — extends the alphabetical rule, does not break it

Current, in `js/hub.js`'s render:

```js
const visible = GAMES.filter((g) => !g.devOnly || dev)
  .sort((a, b) => a.title.localeCompare(b.title));
```

New:

```js
const visible = GAMES.filter((g) => !g.devOnly || dev);
const favs = new Set(loadFavorites());
const byTitle = (a, b) => a.title.localeCompare(b.title);
const ordered = [
  ...visible.filter((g) => favs.has(g.id)).sort(byTitle),
  ...visible.filter((g) => !favs.has(g.id)).sort(byTitle),
];
```

Still fully deterministic. Still `localeCompare` so accents sort correctly (Chinchón,
Parchís). CLAUDE.md's "always alphabetical, no exceptions" becomes "favorites first,
alphabetical within each group."

**Do not build drag-to-reorder.** It is a large touch-interaction cost and it reintroduces
exactly the arbitrary-order problem deterministic sorting avoids.

### 2.4 The heart must be a sibling, not a child

`.hub-card` is a `<button>` or an `<a>` at the top level (`cardHTML` in `js/hub.js`). **You
cannot nest a button inside either** — invalid HTML, and it breaks keyboard and screen-reader
navigation.

Wrap each entry in a positioned cell:

```html
<div class="hub-cell">
  <button class="hub-card" ...>…</button>       <!-- or <a> for launch-out games -->
  <button class="hub-fav" data-id="…" aria-pressed="false"
          aria-label="Add Escoba to favorites">…</button>
</div>
```

- `.hub-cell { position: relative; }`, `.hub-fav` absolutely positioned top-right above the
  card. Both are real buttons; no `stopPropagation` needed because they are not nested.
- The grid's children become `.hub-cell`, so move any `.hub-grid > *` sizing accordingly.
- `aria-pressed` reflects state. `aria-label` flips between "Add X to favorites" and "Remove X
  from favorites".
- **Hit area ~40px, visual ~20px**, via transparent padding. At a 175×98 tile a 40px corner
  target still leaves the card comfortably tappable.

**Collision to fix:** `.hub-soon-tag` currently sits at `top: 12px; right: 12px` — exactly
where the heart goes. **Move `.hub-soon-tag` to the top-left.** It only appears on
`comingSoon` and `devOnly` cards (which only Matt sees), so the impact is minimal.

### 2.5 Heart visual state

Outline heart when off, filled when on. **This is colorblind-safe by construction** — a
fill/shape difference, not a hue difference, per CLAUDE.md's palette rule.

Unfavorited hearts sit on every card, so keep them quiet: white outline at ~55% opacity.
Favorited goes to full opacity with a filled glyph. Do not use color as the only signal.

Always-visible beats long-press here: discoverable, one tap, and it works on desktop.

### 2.6 The divider

Insert a full-width row between the two groups:

```html
<div class="hub-divider" style="grid-column: 1 / -1;">All games</div>
```

Thin rules either side of a small muted label. **Hide it entirely when `favs.length === 0`
or when every visible game is favorited.**

This is not decoration. Without it the alphabet visibly restarts mid-grid (Escoba, Tic Tac
Toe, then Ball Run, Boggle, Chinchón) and reads as a bug.

### 2.7 Event handling

`js/hub.js` already delegates via `e.target.closest('.hub-card')`. Add a check for
`.hub-fav` **before** the card check, toggle, and re-render the grid. A full re-render is fine
at this size and keeps ordering logic in exactly one place.

### 2.8 Test — `favorites.test.mjs` at repo root

`js/favorites.js` is pure, so test it headlessly. `players-agg.test.mjs` is the precedent.

- toggle adds then removes
- malformed JSON returns `[]` and does not throw
- missing key returns `[]`
- an unknown id survives a load/save round trip (not pruned)
- ordering helper puts favorites first and sorts alphabetically within each group, with
  `localeCompare` handling Chinchón and Parchís correctly

Register it in `run-all-tests.mjs`'s `SUITES`.

---

## Phase 3 — recompose every game's art for landscape

**This is the real work, and it is the phase most likely to go wrong.**

### 3.1 The rule

Each game's `art` string in `js/hub.js`'s `GAMES` registry changes from
`viewBox="0 0 120 120"` to **`viewBox="0 0 160 90"`**, with the artwork **redrawn to fill that
frame**.

**Recompose. Do not crop, do not scale-and-letterbox, do not add `preserveAspectRatio="slice"`.**
Slicing a square composition cuts shapes in half at the frame edge — it bisects Connect Four's
discs and shears the bottom row off Dots and Boxes' lattice. That approach was tried and
explicitly rejected.

Every art string keeps a full-bleed background: `<rect width="160" height="90" fill="…"/>`.

### 3.2 Most games get better, not worse

Several boards are naturally wide and were being squeezed by the square frame:

| Game | Landscape approach |
|---|---|
| Connect Four | the real board is 7×6 — lay the grid out edge to edge, it finally fits |
| Mancala | a long tray: two rows of pits with a store at each end. Biggest improvement in the set |
| Monopoly Deal, Escoba, Chinchón | fanned cards are naturally wide |
| Nuts & Bolts | a wide row of bolts instead of the current vertical stack |
| Ball Run | track receding toward a horizon suits 16:9 directly |
| Filler | widen the colour grid (roughly 8×5 instead of 5×5) |
| Dots and Boxes | widen the lattice, more columns than rows |

### 3.3 The three genuinely hard ones — flag, do not force

**Parchís, Tic Tac Toe, and Boggle have square boards.** Do not stretch them and do not crop
them. Options, in order of preference:

1. Show the board at full height, centered, with meaningful content filling the flanks
   (Parchís: pieces and a die alongside the cross; Tic Tac Toe: the 3×3 with a winning line
   extending; Boggle: the 4×4 with letter tiles spilling wide).
2. Show a wide *portion* of the board that still reads (Parchís: one arm of the cross plus
   its home column).

If a game resists both, **stop and show it rather than shipping something stretched.**

### 3.4 Visual verification is mandatory

This phase is visual work, and this repo has already lost roughly 30 sessions to board
rendering that was iterated blind. Do not repeat it.

Use the browser preview tools. For **every** game tile:

1. `preview_start` the dev server, load the hub.
2. Screenshot the grid at 390px width.
3. Confirm: art fills the frame edge to edge, **nothing is cut off at any edge**, the
   composition still reads as that game, and the label is legible over it.
4. Fix and re-screenshot before moving on.

**Do not batch all twelve and check once at the end.** Verify per game.

Finish by screenshotting the full grid and including it in your report.

---

## 4. Integration touchpoints

| File | Change |
|---|---|
| `css/hub.css` | `.hub-card` aspect-ratio + radius + accent background, `.hub-card-label` outline and no scrim, new `.hub-cell` / `.hub-fav` / `.hub-divider`, `.hub-soon-tag` moves to top-left |
| `js/hub.js` | import `favorites.js`, partitioned sort, `cardHTML` wraps in `.hub-cell` + heart, divider insertion, delegated heart handler |
| `js/favorites.js` | **new** |
| `sw.js` | add `'./js/favorites.js'` to `ASSETS`, **bump `CACHE`** |
| `run-all-tests.mjs` | add `favorites.test.mjs` |
| `favorites.test.mjs` | **new**, repo root |
| `CLAUDE.md` | section 6 |

`CACHE` was `'game-hub-v154'` when this was written — **verify the current value first**,
Dots and Boxes and Boggle may have bumped it. `cache.addAll()` is atomic: miss
`js/favorites.js` and the whole SW install aborts silently, leaving the version pill stuck at
`vN → vN+1`.

Run `node validate-sw-assets.mjs` before committing.

---

## 5. Acceptance checklist

**Phase 1**
- [ ] Tiles are 16:9; 12 games fit in 6 rows instead of 6 taller rows
- [ ] Label has the four-way outline and **no gradient scrim**
- [ ] Label is legible over Mancala's light board
- [ ] Longest label ("Dots and Boxes") fits on one line at 390px, **verified by measuring
      rendered width**, not by picking a size that looked right
- [ ] Square art still letterboxes cleanly on the accent background (pre-phase-3 state)

**Phase 2**
- [ ] `node favorites.test.mjs` green
- [ ] Tapping a heart favorites the game and it moves above the divider immediately
- [ ] Tapping the card still launches; tapping the heart never launches
- [ ] Heart is a real button: reachable by keyboard, `aria-pressed` correct, label reads
      "Add X to favorites" / "Remove X from favorites"
- [ ] Zero favorites: no divider, grid is plain alphabetical (identical to today)
- [ ] All favorited: no divider
- [ ] Favorites survive a reload and a hub navigation
- [ ] A favorited id for a non-existent game is ignored on render and still present in storage
- [ ] `.hub-soon-tag` moved to top-left, no overlap with the heart on a `devOnly` card
- [ ] `node run-all-tests.mjs` green

**Phase 3**
- [ ] Every game's art uses `viewBox="0 0 160 90"` with a full-bleed background rect
- [ ] **Screenshot per game** confirming nothing is cut off at any edge
- [ ] Parchís, Tic Tac Toe, and Boggle either read well or were flagged, not stretched
- [ ] `.hub-card { background: var(--card-accent) }` left in place as a backstop
- [ ] Full-grid screenshot included in the final report

**All phases**
- [ ] `node validate-sw-assets.mjs` green
- [ ] `sw.js` CACHE bumped
- [ ] No em dashes in user-facing copy
- [ ] CLAUDE.md updated

---

## 6. CLAUDE.md — required, part of the milestone

THE LAW rule 9. Four edits:

1. **Shared modules table:** add `js/favorites.js` — "hub-only launcher favorites;
   `gamehub.favorites.v1`; ids are hub registry ids, not stats keys."
2. **THE LAW carve-out.** Add to rule 2, or as a short note directly beneath it: THE LAW
   governs history and achievement data. User-controlled preferences that the player can
   restore in one tap (favorites) are exempt from the additive-writes rule — removing a
   favorite is user intent, not data loss. Without this a future session will refuse to
   implement removal.
3. **"Adding a game" checklist item 5.** Array position is still irrelevant, but the ordering
   rule is now *favorites first, then alphabetical by title within each group*. Update the
   wording so "always alphabetical, no exceptions" does not read as contradicted.
4. **"Adding a game" checklist**, art requirement: new games must supply
   `viewBox="0 0 160 90"` landscape art composed to fill the frame, with a full-bleed
   background rect. Note explicitly that cropping square art with
   `preserveAspectRatio="slice"` was tried and rejected because it bisects shapes at the
   frame edge.

Item 4 matters most for the future — it is the instruction that stops the next game's handoff
from shipping square art into a landscape grid.

---

## 7. Out of scope

- Category filter chips. The reference has them; 12 games does not justify a second
  organizing principle competing with favorites.
- A hero/featured card, a separate Favorites tab or screen, a header sort control.
- Drag-to-reorder.
- **Syncing favorites across devices.** Deliberately per-device for v1. Adding `favorites` to
  the `js/stats-net.js` payload would make it per-person later for little work — note it as a
  follow-up, do not build it now.
- Any change to game logic, stats, leaderboards, Firebase, or `database.rules.json`.
- Renaming any game, folder, or storage key (THE LAW rule 5).

If you think one of these is necessary, stop and say so rather than building it.

---

## Why high effort

Phase 2 is mechanical and phase 1 is nearly trivial. The case rests on phase 3 and on two
traps:

1. **Phase 3 is visual work, and this repo has already lost ~30 sessions to board rendering
   iterated blind.** The screenshot-per-game loop in 3.4 is the entire mitigation. A lower
   tier tends to batch the work and verify once at the end, which is precisely the failure
   mode. Three of the boards are genuinely square and need a judgement call rather than a
   formula — the instruction there is to stop and show, not to force.
2. **The heart cannot be nested in the card**, and the reason (a `<button>` inside a
   `<button>`) is invisible until someone tries keyboard navigation. It is an easy thing to
   implement wrongly and have appear to work.
3. **Removing a favorite superficially violates THE LAW.** Section 2.2 exists so that gets
   resolved by reasoning rather than by a session inventing a tombstone scheme, or refusing.

The total code is small. The judgement is not.
