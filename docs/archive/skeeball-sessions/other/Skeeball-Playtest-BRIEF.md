# Playtest brief — Skeeball

You are play-testing a web game as a **first-time casual player**. You have never seen it before.
That inexperience is the point: it is the thing being measured. Protect it.

## Ground rules

1. **Black box.** Do not look for, clone, or read the game's source repository. Everything you
   learn must come from playing the game in a browser. Reading the page's own JS in devtools to
   diagnose something you have already observed is fine; source-diving to learn how the game works
   before playing it is not.
2. **Do not fix anything.** You are not making changes — not to the game, not anywhere. Report only.
3. **Do not ask for hints.** If something is confusing, that IS the finding. Write it down and keep
   going. Never ask Matt how the game works.
4. The game is unreleased and under active development. Broken things are expected — finding them
   is the job. Be direct; nothing here is precious.

## Setup

**URL:** https://mpowell95.github.io/game-hub/skeeball/

**You must use the Claude in Chrome extension against real Chrome.** The in-app browser cannot run
this game — it does not fire `requestAnimationFrame`, so a 3D scene will never render or animate
there. Do not waste time on it. Load the Chrome tools with a single ToolSearch call:

```
select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__resize_window,mcp__claude-in-chrome__read_console_messages
```

**This is a phone game.** Before anything else, set the viewport to a phone: `resize_window` with
`preset: "mobile"` (375×812), then reload so any load-time device checks re-run. Playing it at
desktop size will give you a false impression of everything.

**If the page loads but there is no game on it**, stop and tell Matt — it means Chrome is on the
wrong profile. Do not try to work around it.

### Making your swipes human

This game is driven by swipe gestures, and it reads how *fast* your finger moved. This is the one
piece of harness knowledge you need, because getting it wrong will silently corrupt every
judgement you make about difficulty.

Try the `computer` tool's `left_click_drag` first — it is the most honest input. But check the
result: if every throw behaves identically, or the game seems to have no control range at all,
your drags are probably arriving as one instantaneous jump. In that case, inject pointer events
with **real awaited delays between them**:

```js
async function swipe(el, fromX, fromY, toX, toY, ms = 180, steps = 12) {
  const mk = (type, x, y) => new PointerEvent(type, { pointerId: 1, pointerType: 'touch',
    isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true });
  el.dispatchEvent(mk('pointerdown', fromX, fromY));
  for (let i = 1; i <= steps; i++) {
    await new Promise(r => setTimeout(r, ms / steps));           // <-- the delay is mandatory
    const f = i / steps;
    el.dispatchEvent(mk('pointermove', fromX + (toX - fromX) * f, fromY + (toY - fromY) * f));
  }
  el.dispatchEvent(mk('pointerup', toX, toY));
}
```

Dispatching those moves in a tight loop without the `await` collapses the whole gesture into a
single instant, and the game will read it as maximum effort every time. Vary `ms` and the distance
to vary your throws — a slow gentle gesture and a fast long one should not feel the same.

There is a calibration page at `https://mpowell95.github.io/game-hub/skeeball/flick-test.html` if
you want to confirm your generated gestures produce a *range* of values rather than the same number
every time. Use it for that sanity check only, then go back to the game and forget the numbers.

---

## Part 1 — Play it (do this first, while you are still new)

Play properly. Multiple full sessions. Do not skim — actually play.

Keep a running log, in your own words, of every moment where you:

- did not know what to do next
- did not know what just happened, or why
- expected one thing and got another
- had to guess what a control, number, icon or word meant
- did something by accident
- wanted to do something the game would not let you do
- got bored, or frustrated, or wanted to stop

Then go looking for trouble deliberately:

- What happens if you swipe the wrong way? Barely at all? Off the edge of the screen?
- Tap things that are not the main control. Tap them twice. Tap them mid-action.
- Reload the page mid-game. Does anything survive that should? Does anything survive that shouldn't?
- Play a full session to the end. Then play another. Is the second consistent with the first?
- Leave it untouched for a few minutes, then come back and interact with it.
- Check `read_console_messages` periodically and note any errors or warnings.

**On consistency:** the same action should produce the same kind of result. If two things that look
identical behave differently, or the same thing behaves differently on two occasions, that is a
finding even if neither behaviour is wrong on its own.

Write your Part 1 notes down **before** starting Part 2. Do not go back and soften them once you
understand the game better — first-contact confusion is the most valuable thing you will produce
today, and it is gone the moment you get good at this.

## Part 2 — Does it render correctly on real phones

Now the mechanical sweep. For each size below: `resize_window`, **reload the page**, then walk
through every screen the game has — the first screen you land on, mid-game, and whatever it shows
when a session ends.

| | width × height | roughly |
|---|---|---|
| 1 | 360 × 740 | small Android |
| 2 | 375 × 667 | iPhone SE — the short one |
| 3 | 390 × 844 | iPhone 14/15 |
| 4 | 412 × 915 | Pixel |
| 5 | 430 × 932 | iPhone Pro Max |
| 6 | 768 × 1024 | iPad mini, portrait |
| 7 | 844 × 390 | landscape |

At each one, check and record:

- Is anything **cut off**, overlapping, or pushed off the bottom of the screen?
- Does any screen **require scrolling** to reach a control? Which control, at which sizes?
- Is every button actually **reachable and tappable**?
- Is any text too small to read, clipped, or overflowing its container?
- Is the game itself — the 3D part — correctly proportioned, or stretched / squashed / cropped?
- Anything sitting under a notch, status bar, or home-indicator area?

`getBoundingClientRect` via `javascript_tool` is the reliable way to prove something overflows;
"it looks fine" is not a measurement. Attach screenshots where they help, but measure.

Also try `resize_window` with `colorScheme: "dark"` and `"light"` at one phone size and note any
difference.

## What to hand back

Write **`PLAYTEST-REPORT.md`** in your working directory:

1. **First impressions** — the first five minutes, in plain prose. What you thought the game was,
   what you tried, what happened. This section is worth more than the rest combined; write it
   honestly even if it makes you look slow.
2. **Blocking** — could not play, lost progress, got stuck.
3. **Confusing** — you worked it out eventually, but it cost you. Say what you assumed, and why.
4. **Inconsistent** — same input, different result; or two similar things behaving differently.
5. **Rendering** — the Part 2 findings, one row per issue, with the sizes affected.
6. **Small stuff** — wording, polish, anything that felt unfinished.

For each item: what you did, what you expected, what happened, and how reliably it repeats. Rank
each high / medium / low by how much it would bother a real player.

End with a short, blunt answer to one question: **would you keep playing this, and why or why not?**
