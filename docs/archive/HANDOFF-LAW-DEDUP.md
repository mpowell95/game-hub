# Handoff: state THE LAW once — remove the 9 repeated copies from CLAUDE.md

**Audience: a Sonnet 5 session. Recommended effort: low.** This is a small, fully-decided
mechanical change. Move nothing else, improve nothing else. If anything looks ambiguous beyond
what's written here, stop and ask Matt.

**This reverses Matt's earlier standing instruction on purpose.** The 10-copies rule
(2026-07-22) was written for a 1,500-line monolithic CLAUDE.md where a session working at line
600 had the nearest copy far out of sight. After the 2026-07-23 split (`cdfdef5`,
`HANDOFF-CLAUDEMD-SPLIT.md`), the root file is ~700 hand-written lines, per-game detail lives in
lazily-loaded `<game>/CLAUDE.md` files, and every one of those opens with a pointer block back to
THE LAW. The repetition now costs ~585 loaded lines per session (9 × 65) for no added reach.
Matt has explicitly ordered the de-duplication (2026-07-24).

## Where THE LAW is stated afterward (decided — do not re-litigate)

- **Once, in the root `CLAUDE.md`, exactly where the canonical copy already sits** (the first
  occurrence — currently line 33, the first major section after "Repo location"). Root loads
  eagerly into every session, so one top-of-file statement is always in context. Do not move the
  section; just delete the repeats.
- **Per-game files keep their existing pointer blocks** (the `> **THE LAW applies to every file
  in this folder.**` quote block), with one wording fix — see step 3.

## Steps

1. **Strip the 9 generated copies using the script's own tested logic**: edit
   `repeat-the-law.mjs`, change `const COPIES = 10;` to `const COPIES = 1;`, run
   `node repeat-the-law.mjs --write`. Its strip pass removes every marker-wrapped copy (and their
   `---` wrappers) and, with COPIES=1, inserts zero repeats. Its output must report exactly
   1 copy. Do not hand-delete the blocks — the script's strip is byte-exact; hand edits are how
   wrapper lines get orphaned.

2. **Fix the canonical block's own text.** The bolded paragraph inside it (starts "**This
   section is repeated verbatim about every 10% of the way down this file**" and ends "add
   another copy.**") is now false and actively instructs sessions to re-duplicate. Replace that
   entire paragraph with exactly:

   > **This is the single, canonical statement of THE LAW, by Matt's instruction (2026-07-24,
   > superseding his 2026-07-22 repeat-every-10% rule, which belonged to the pre-split
   > 1,500-line file).** It lives at the top of the always-loaded root file on purpose; every
   > `<game>/CLAUDE.md` opens with a pointer back here. Do not re-duplicate it, and do not move
   > it below the fold.

3. **Update the pointer block in all 12 game files.** Each says "the nine full rules repeat
   throughout the root `CLAUDE.md`" — now false. In every `<game>/CLAUDE.md`, change that
   clause to: "the nine full rules are stated near the top of the root `CLAUDE.md`". The rest
   of the block stays as-is.

4. **Retire the script.** `git rm repeat-the-law.mjs` (its only job was maintaining the
   repeats), and delete its row from the root Dev-tooling table. It survives in git history if
   ever wanted again. It is not wired into `run-all-tests.mjs`, so nothing else references it —
   verify with a grep for `repeat-the-law` before committing; the only remaining hits should be
   historical HANDOFF-*.md files, which are records and must NOT be edited.

5. **Verify:**
   - `## THE LAW: player data is never deleted` occurs exactly ONCE in root, zero times in
     game files; zero `<!-- BEGIN THE LAW` / `<!-- END THE LAW` markers remain anywhere.
   - The canonical block still carries all 9 numbered rules and the rule-2 carve-out, untouched
     except the one replaced paragraph.
   - All 12 game files carry the reworded pointer block.
   - `node run-all-tests.mjs` all green (nothing here touches code; red = stray edit).
   - The diff touches only: root `CLAUDE.md`, the 12 game `CLAUDE.md`s, and the deleted script.

6. Commit (message naming this handoff). **Do not push** — Matt reviews first, same as the
   split.

## Out of scope

Everything else. No prose improvements, no section moves, no touching historical handoff docs,
no changes to `<game>/CLAUDE.md` beyond the one clause in step 3.
