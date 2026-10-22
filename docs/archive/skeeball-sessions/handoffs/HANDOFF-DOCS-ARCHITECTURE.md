# HANDOFF — fix the documentation architecture

This is not a feature task. It is a cleanup of how this repo stores its rules, and it exists
because the current arrangement has caused the same class of bug to be re-found and re-fixed
across many games over a period of months. Matt has raised this repeatedly. Treat it as the
priority it is.

**Do not touch Skeeball, or any game's behaviour, in this session.** Docs, one new test, and one
enforcement mechanism. Nothing else.

---

## The problem, in numbers

Counted 2026-08-21:

| | |
|---|---|
| Markdown files in the repo | **136** |
| Markdown files in the repo ROOT | **80** |
| Of those, `HANDOFF-*` | **55+** (plus `HANDOFF.md`, `HUB-HANDOFF-1/2/3.md`, which don't match that glob) |
| Root `CLAUDE.md` | **543 lines**, loaded into context every session |
| Per-game `CLAUDE.md` | 23 |
| `.claude/skills/` | does not exist |

Two things are wrong and they compound:

**1. Hub-wide rules are stored in single-use documents.** A rule gets discovered while working on
one game, written into that game's handoff or that game's `CLAUDE.md`, and is then never seen
again by anyone working on a different game. It is re-discovered later as a bug.

The clearest live example is already visible in `CLAUDE.md`'s own "Where the deep docs live"
section, which says:

> `tic-tac-toe/CLAUDE.md` — the How-to-play screen pattern (its reference implementation).

Every game has a how-to-play screen. The pattern for building one lives in one game's folder.

**2. Root `CLAUDE.md` carries content that is only relevant occasionally.** It is loaded into
every session's context whether the task is a new game, a one-line CSS fix, or a question about
the leaderboard. Its "Adding a game — checklist" and "Before you build" sections matter perhaps
once a month and cost context every time.

Matt's framing, 2026-08-21, and it is the correct one:

> It should be its own document that is the set of instructions. It should be referenced in the
> CLAUDE.md and should tell Claude that when we're building a new game, he should always read
> that. But when we're not doing that, it's just wasting space/context in claude.md.

---

## The trigger

A playtest of Skeeball on 2026-08-21 found four defects that are baseline, not discoveries:

- A close button at 36×36 and a menu button at 40×40, both under the 44×44 minimum for a
  reliable thumb tap
- Stat labels set at 10px, below a comfortable phone reading floor
- No `safe-area-inset-bottom` handling on a screen whose primary button sits at the bottom edge,
  so it may render under the home-indicator bar
- Text left in the DOM at `opacity: 0` after it fades, which a screen reader announces forever

The repo's `### Accessibility + copy conventions` section in root `CLAUDE.md` is **three bullets
long** — colorblind-safe pairing, no em dashes, and a close X on win/lose popups. None of the
four above are written down anywhere in the repo. They were not ignored; they were never
recorded.

Meanwhile `test-game-conventions.mjs` runs 10 checks on every deploy and **all ten are
structural** — listener hygiene, the module contract, translation plumbing, folder layout. Not
one of them looks at what a screen actually renders like. That is the gap these four fell through.

---

## What to build

### 1. Split the new-game instructions out of `CLAUDE.md`

Create a single authoritative document — suggested name `docs/BUILDING-A-GAME.md`, but pick
whatever fits once you have seen the material. Move into it, from root `CLAUDE.md`:

- `### Before you build: USE WHAT EXISTS` (~line 328)
- `### Adding a game — checklist` (~line 374)
- `### The module contract` (~line 268) — judgement call, it is also referenced outside new-game
  work; decide and say why
- `### Accessibility + copy conventions` (~line 537), **expanded** with the four rules above

Leave behind in `CLAUDE.md` a **one-line pointer**, not a summary. A summary re-creates the
problem: two sources that drift.

### 2. Sweep the scattered rules into it

This is the part that actually pays. Read through the root markdown files and the 23 per-game
`CLAUDE.md` files looking for anything that is a **hub-wide rule wearing a game-specific
costume** — a UI pattern, a layout rule, an accessibility requirement, a naming convention, a
"never do X" that applies to more than the game it is filed under.

Known starting points:

- The how-to-play screen pattern in `tic-tac-toe/CLAUDE.md`
- `VISUAL-PROCESS.md`, `ARCH-REVIEW.md`, `game-hub-audit.md` — root docs whose names suggest
  general process, not one-time work. Check whether they hold live rules
- `skeeball/DECISIONS.md` — currently the only `DECISIONS.md` in the repo. Several of its entries
  are Skeeball-specific and correctly placed, but check for general ones

**Do not delete the source documents.** Move the rule, leave a pointer where it was. Handoff
documents in particular are single-use by Matt's explicit instruction — they are historical
record, not live docs, and should be left alone rather than tidied.

### 3. Make it impossible to skip — this is the point of the task

A pointer in `CLAUDE.md` is the weakest available mechanism and it is currently the only one in
use. Written rules with no enforcement are the reason this handoff exists. Three real options:

| Mechanism | Fits | Notes |
|---|---|---|
| **Skill** (`.claude/skills/`) | Best fit | A skill whose description triggers on new-game work auto-loads its instructions. The directory does not exist yet — this would be the first |
| **Hook** (`.claude/settings.json`) | Partial | Can fire on tool use. Clunky for "is this a new game" but exact for "did the conventions test pass" |
| **Test** (`test-game-conventions.mjs`) | For anything measurable | Fails the build. Nobody has to remember it, and it applies to games that do not exist yet |

**Recommendation: a skill plus test coverage**, with `CLAUDE.md` carrying only the pointer. Confirm
with Matt before building the skill — it is a new pattern for this repo.

### 4. Add the measurable rules to `test-game-conventions.mjs`

Be honest about what is actually automatable. Assessed 2026-08-21:

| Rule | Automatable? |
|---|---|
| No text under 11px | **Yes** — grep the CSS |
| `safe-area-inset-bottom` on any screen with bottom-anchored controls | **Yes** — greppable |
| Tap targets ≥ 44×44 | **Partly** — catchable where CSS sets an explicit size, misses padding-sized ones |
| No text left in the DOM at `opacity: 0` | **No** — needs the live DOM. Doc rule |

So: two solid checks, one partial, one doc rule. Do not claim four.

---

## Constraints

- **Do not change any game's behaviour.** Not one line of game logic.
- **Do not `git add -A`.** The repo has many untracked working documents. Add by path.
- **Do not delete or rewrite handoff documents.** They are single-use historical record.
- Root `CLAUDE.md` should get **shorter**. If it grows, the task has failed.
- Follow the repo's deploy flow if anything shipping changes (it probably should not — docs and a
  test are not precached assets, but check `validate-sw-assets.mjs` before assuming).

## How to know it worked

1. Root `CLAUDE.md` is materially shorter and contains no new-game build instructions, only a
   pointer.
2. There is exactly one document a new-game session must read, and something other than good
   intentions makes it read it.
3. `node test-game-conventions.mjs` runs more than 10 checks, and at least one is about what a
   screen looks like rather than how it is wired.
4. Grepping the per-game `CLAUDE.md` files for hub-wide rules turns up nothing that should have
   been shared.

## Before you start

Ask Matt two things:

1. Where he wants the new document to live (`docs/`, root, elsewhere) and what it should be called.
2. Whether to build the skill, since it introduces a new mechanism to this repo.

Then read root `CLAUDE.md` end to end before moving anything. It is 543 lines and several
sections cross-reference each other.
