# Batch 02 - Misc Bugs: Difficulty Selector & Ball Run Replay

Two independent bugs, both surfaced in **Screenshot 2** (`02_imessage_from_thomas_...jpg`, a friend's
forwarded complaints).

---

## BUG-1 - Changing computer difficulty does not apply / the selection state does not update

- **Screenshot:** `02_..._difficulty_buttons_greyed_out.jpg` (label notes Chinchón difficulty buttons looking greyed out / unclickable)
- **Verbatim:** "he said you can't change the difficulty of the computer players. I think it changes, the graphics just don't move over. the text changes a little. idk it needs to be fixed."

**Symptom:** selecting a difficulty does not visibly move the selection highlight, though the underlying value
may be changing ("the text changes a little"). At least a UI-state bug; possibly also a wiring bug (chosen
difficulty not actually applied to the agent). Chinchón is the confirmed case (`chinchon/js/ui.js`).

**Do (confirm plumbing first - `01_repo_context.md` confirmation 4):**
- Verify clicking an option updates the stored difficulty (settings-key convention in `CLAUDE.md`), re-renders the selected state, AND is actually consumed by the agent at game start.
- Fix whichever links are broken. The missing highlight re-render is the likely culprit, but **confirm the value truly reaches AI behavior** (Easy vs Hard should play differently) - do not stop at the visual.
- If buttons are genuinely disabled when they should not be, fix that too.
- Selection highlight must use `#ffce3a` paired with a non-color indicator (THE LAW rule 9). Confirm whether the selector is shared or per-game; if shared, one fix covers all.

**Acceptance:**
- [ ] Selecting a difficulty immediately updates the highlighted control (colorblind-safe) and is actually applied - Easy vs Hard differ in play (Chinchón at least). Buttons clickable when they should be.

---

## BUG-2 - Ball Run "Play Again" -> black screen (WebGL context)

- **Screenshot:** `02_imessage..._ball_run_black_screens_on_replay.jpg`
- **Verbatim:** "if you select play again after a round of ball run, the screen goes black"
- **Location:** `ball-run/js/render.js` (constants in `ball-run/js/config.js`).

**Almost certainly a WebGL-context lifecycle bug.** Ball Run already has a teardown fix - `forceContextLoss()`
after `dispose()` around `ball-run/js/render.js:419` - added for context-limit exhaustion across repeated hub
remounts. The in-game **"Play Again"** path likely tears down (or loses) the context without recreating it,
so the canvas goes black. Make "Play Again" fully re-initialize the renderer/scene exactly like a fresh mount:
recreate the WebGL context/renderer, reset state, restart the render loop, rebind inputs. Reuse the existing
dispose/teardown + init sequence rather than a partial reset. Check the console on repro - a black screen here
is usually an uncaught error or a disposed-and-not-recreated context.

**Acceptance:**
- [ ] "Play Again" starts a fresh, playable round (no black screen, no console error), and repeated Play Again in a row keeps working (no context leak/exhaustion).

---

### Batch exit
- [ ] Both verified; console clean on Ball Run replay. Tests + validator clean.
- [ ] Commit (list constant changes); do not push. Report each root cause and whether difficulty is shared or per-game. Update `CLAUDE.md` if relevant.
