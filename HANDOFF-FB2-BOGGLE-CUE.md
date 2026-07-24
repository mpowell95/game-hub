# HANDOFF-FB2-BOGGLE-CUE: replace dead iPhone haptics with a visual valid-word cue

**Batch C of the 2026-07-24 feedback arc (see HANDOFF-FB2-INDEX.md). Sonnet execution;
effort: medium. Run after Batches A and B (all three touch boggle files).**

Matt tested the iOS "switch hack" on his iPhone: no vibration. Verdict final: **web apps
cannot produce haptics on iOS.** His instruction: find another way to indicate that the
current trace is a real word the game accepts — and only for NEW words; once submitted, no
cue on re-trace.

## 1. Remove the dead switch hack

In `boggle/js/ui.js`: delete `ensureHapticSwitch`/`removeHapticSwitch`/`hapticSwitch` and the
`destroy()` call; `haptic(ms)` returns to the plain feature-detected `navigator.vibrate`
(KEEP that — it genuinely works on Android). Update `boggle/CLAUDE.md`'s haptics section:
hack tested on a real iPhone 2026-07-24, did not fire, removed; the visual cue below is the
iOS answer. This closes the question permanently — record it so no future session re-tries it.

## 2. The visual cue

Trigger predicate: identical to the existing haptic trigger 1 (already computed in
`_updateWordBar()`): current path spells a word with length ≥ `MIN_WORD_LEN`, in the trie,
and NOT in `_found`.

- While the predicate holds, add an `is-word` state class to the word bar text AND the traced
  path line (and the current last tile). Style: the game's own gold (`--bg-gold`) — the word
  bar text goes gold and bold, the path polyline brightens to gold, with a single quick pulse
  animation (~200ms scale/glow on the word bar) at the moment the state is ENTERED. State
  entry/exit follows the predicate per pointer move; the pulse fires only on entry per word
  string (reuse `_lastHapticWord`-style edge tracking, and rename that variable to something
  cue-appropriate since it now drives both cue and Android vibration).
- Already-found words: no gold, no pulse, ever (the predicate excludes them). Invalid or
  too-short traces: normal styling.
- The vibration call (Android) stays wired to the same edge.
- `prefers-reduced-motion`: keep the color change, skip the pulse animation.
- Colorblind rule: gold vs the normal ink is a brightness/weight change, not a hue-only pair,
  and it is paired with the bold weight — acceptable. Do not use red/green.

## Verification

1. `node run-all-tests.mjs` green.
2. Browser: trace CAT (valid, new) — word bar and path go gold with one pulse at the moment
   it becomes valid; extend to CATS — pulses again; submit CATS, retrace it — no gold; trace
   junk — never gold. Reduced-motion emulation: color yes, pulse no.
3. Grep: no `switch` input remnants in boggle; `navigator.vibrate` still present.
4. `sw.js` CACHE bump LAST; `boggle/CLAUDE.md` updated (rule 9).
