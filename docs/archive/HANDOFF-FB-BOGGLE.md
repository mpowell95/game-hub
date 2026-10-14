# HANDOFF-FB-BOGGLE: haptics + shorter timers

**Batch 11 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: medium.**
**Sequencing: start ONLY after HANDOFF-BOGGLE-SPANISH.md's execution is committed** (it
rewrites `boggle/js/ui.js` strings-handling; this batch builds on that). The How-to trim and
difficulty-hint deletion live in other batches (FB-HOWTO, FB-SETUP-CONVENTIONS) — not here.

## 1. Haptic feedback while tracing (Matt: "a small vibration when you've highlighted a word that can be submitted and another small vibration when you submit it... it only vibrates in new, unsubmitted, words")

**Honest capability note first (Matt asked "Is that possible?"):** `navigator.vibrate` works
on Android Chrome; **iOS Safari/PWAs do not expose any vibration API**, so on the family's
iPhones this will be a silent no-op. Implement it feature-detected for Android and say exactly
that in the commit message — do not fake it with audio or skip the feature because iOS can't.

Decisions:

- Trigger 1: during a trace (swipe or tap-built), the moment the current path first becomes a
  **submittable NEW word** — length ≥ `MIN_WORD_LEN`, `isValidWord()`, and NOT already in
  `_found` — fire `navigator.vibrate(12)`. Edge-triggered per word string: track the last
  vibrated word for the current path; extending the path to a longer valid new word vibrates
  again (each new valid word is a new "you could release now" signal), shrinking back to an
  already-signaled word does not re-fire. Already-found words never vibrate (Matt's explicit
  rule).
- Trigger 2: on successful submit (the `valid` feedback branch in `onSubmitWord`,
  `boggle/js/ui.js`), fire `navigator.vibrate(25)`. Duplicate and invalid submits: nothing.
- Wrap in a tiny `haptic(ms)` helper with the feature check; no setting row for it (it is
  subtle and self-explanatory; add an off switch only if Matt asks).
- The dictionary check per pointermove is a trie walk on a ≤16-char word — negligible; but
  compute it inside the existing `_updateWordBar()` path (which already derives the word per
  move) rather than adding a second walk.

## 2. Shorter timers (Matt: "the game pigeon version of this gives you 1:20 to play. 5 min seems crazy long.")

`TIMERS = [2, 3, 5]`, default 3 (`boggle/js/ui.js`). Replace with **1 / 1.5 / 2 minutes,
default 1.5** (closest clean set to GamePigeon's 1:20 without an oddball 80-second option):

- Stored values stay numeric minutes in `gamehub.boggle.v1` (`1`, `1.5`, `2`); the existing
  validation (`TIMERS.includes(saved.timerMinutes)`) makes old saved `3`/`5` fall back to the
  default automatically — a preference, allowed to reset (rule-2 carve-out).
- Display labels: `1 min` / `1 min 30 s` / `2 min` (es the same forms). The end-overlay
  subtitle reuses the same label map — verify both call sites.
- Timer internals already tick off an `_endsAt` timestamp and handle fractional minutes
  (`timerMinutes * 60`) — no engine change.

## Verification

1. `node run-all-tests.mjs` + `node test-i18n-strings.mjs` green.
2. Browser: trace CAT (new) — devtools-log the haptic call once at the moment it becomes
   valid; extend to CATS — fires again; retrace CAT after submitting it — never fires; invalid
   submit — nothing. (Log-based verification is fine on desktop where vibrate is absent;
   Matt confirms feel on an Android device if one is available, else it ships dark.)
3. Timer options render 1 / 1:30 / 2, default 1:30 on a cleared setting; a legacy save with 5
   comes up as 1:30; round end records stats normally (`recordBoggle` untouched).
4. `sw.js` CACHE bump LAST; one-line updates to `boggle/CLAUDE.md` (haptics, timers), rule 9.
