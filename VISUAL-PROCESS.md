# VISUAL-PROCESS.md — how to build something that has to LOOK right

> This file exists because of a measured failure, not a hunch. Battleship's cannon took **four
> rounds** of Matt's time. Three of them were built by a session that had never seen the thing it
> was cloning, because the handoff document said *"You will not have the image"* while a different
> game's reference screenshot sat committed in the repo root the whole time. The fourth round
> looked at the picture and got it in one.
>
> The root `CLAUDE.md` is ~500 lines about never losing player data, and it is that long because
> data actually got lost. Nothing there is about whether a screen renders, because a wrong-looking
> screen never destroyed anything. It just burned Matt's evenings. This file is the other half.

## The rule

**Look at the picture before you write code. Look at your own output before you say you are done.**

Everything below is that sentence, made specific.

## 1. Before the first line of code

- **`ls reference/<game>/`** and open every image with `Read`. A session can read PNGs. Do it.
- **If the folder is empty or does not exist, say so and ask for a screenshot.** Do not build from
  a prose description of a picture. "A large black cannon barrel on a dark ring base" is a true
  description of a top-down gun turret AND of a wheeled side-view field gun. Three sessions built
  the wrong one from that sentence.
- **Never write "you will not have the image" into a document.** If you could not find one, that is
  a question for Matt, not a fact about the world.

## 2. While you can still see it

Your session ends and your eyes go with it. Convert the picture into something durable:

- **Write `reference/<game>/SPEC.md` in fractions, not pixels.** "Base circle = 0.375 x screen
  width", "barrel = 0.48 x base diameter", "black rim = 0.10 x ball diameter". Screens differ;
  ratios port. `reference/battleship/SPEC.md` is the worked example.
- **Sample the actual colours** and write the hex down.
- **The picture is an INPUT; `SPEC.md` is the artifact. Delete the media when the work closes.**
  Battleship and Pool turned their screenshots into 5 KB of fractions and kept nothing else.
  Yahtzee's six how-to `.MOV`s (17 MB) and Mancala's seven (20 MB) sat in `reference/` for weeks
  after both games shipped, because nobody did the converting step or the deleting one. Matt,
  2026-08-26: *"They were references for you that were one time use... they can be deleted."*
  Removing them loses nothing - this repo does not rewrite history, so anything ever committed is
  recoverable from the commit that removed it. Full rule and the recovery command:
  `reference/README.md`, "Retention".
- **Say explicitly what the reference does NOT show.** Battleship's four screenshots were all the
  battle screen; the mode screen, the deploy screen and the win overlay have never been seen, so
  nothing may claim those "match the reference".

## 3. While building

`node test-visual.mjs` drives a game in a real Chromium at 393x852 in light, dark and
reduced-motion, and writes a contact sheet to `.visual-out/`.

**It looks at what CHANGED, not at every game every time.** Matt's rule, and it is the right one:
a finished game re-checked on every unrelated run is 90 seconds of nothing, forever.

```
node test-visual.mjs                 the games whose own folder has changes. Nothing changed,
                                     nothing run - it exits in under a second.
node test-visual.mjs escoba boggle   exactly those, whatever state they are in
node test-visual.mjs --all           every game (a first run, or an occasional sweep)
```

**A full sweep is never automatic.** Matt's rule: *"Always ask before testing all games."* When
shared code changes (`js/`, `css/`, the hub's `index.html`, `sw.js`) the tool says so loudly and
recommends `--all`, because that is how every game has broken at once before. It still only checks
what changed. Running the full sweep is a decision a person makes.

**If you are a session and shared code changed: tell Matt, recommend the sweep, and wait for a
yes.** Do not just run it.

It fails on the things that are wrong no matter what the design is:

| Check | The bug it exists for |
|---|---|
| something painted | Battleship shipped a **blank screen twice**, with 29/29 engine tests green and 21,288 characters of correct HTML |
| no sideways body scroll | a repo-wide rule; it found four pre-existing offenders on its first run |
| no JS error on mount | a game that throws is a game nobody can play |
| all of the above in dark AND reduced-motion | reduced motion is how the blank screen hid, and it is headless Chromium's default |
| **motion probes** | the cannonball was on screen for 340ms. Every static check passed, because a static check cannot tell 340ms from 2s |

A **motion probe** drives a game to the point where something moves, then samples that element's
real on-screen position frame by frame and fails if it is too brief to follow or barely travels.
If your game has a signature animation, add one to `MOTION` in `test-visual.mjs`. It is about
fifteen lines and it is the only automated thing in this repo that can catch "too fast to see".

**`KNOWN_GAPS`** works exactly like the one in `test-game-conventions.mjs`: pre-existing debt is
listed, printed on every run, and a stale entry fails the suite. **A game you just wrote does not
go on that list. Fix the game.**

## 3b. PLAY IT. This is the rule that was broken most recently and most expensively.

**A game is not verified because it rendered.** On 2026-08-08 I promoted Pool over the old build,
merged it, and deployed it to `main` having never played a single game of it. What I had was: it
draws, it fits the screen, it throws no errors, in three themes. Every word true. None of it "a
person can play this."

My own screenshot, taken 1.2s after the one shot I attempted, showed fifteen balls sitting in an
untouched triangle. I looked at it, decided my test drag was too weak, wrote *"the shot mechanic is
fine"* to Matt as a statement of fact, and shipped. It was a guess from reading source, presented
as a finding. (It was also wrong in the details: the shot is a SLINGSHOT, the ball travels opposite
the drag, which I only learned by measuring.)

So:

- **`PLAY` probes in `test-visual.mjs` drive a game through its real UI with real touch** and
  assert something only playing could change: the cue ball crossed the table, the shot resolved to
  a marker, the opponent replied. Not "the button exists."
- **Every run prints `NEVER PLAYED BY ANYTHING`** listing games with no probe. For those, this
  suite proves only that they draw. That list is the honest state of coverage and it should shrink.
- **Write the probe before you call a game finished.** If you are promoting, renaming or replacing
  a game, the probe is not optional - that is exactly the moment it gets skipped.
- **A probe that only ever passes is theatre.** Break the game on purpose, watch it go red, put it
  back. That takes two minutes and it is the only proof the probe works.

## 3c. IT HAS TO FIT ONE SCREEN, IN THE HUB, ON A SHORT PHONE

Pool shipped **138px too tall inside the hub**, with its controls up to 98px below the fold. Matt:
*"I couldn't see the full board and the controls simultaneously."* This suite called it clean, and
it WAS clean - standalone, at 393x852, which was the only thing it looked at.

**The rule itself** (what must be true, and the measurement techniques a fix needs) now lives in
`docs/BUILDING-A-GAME.md`, "Part 3 — Fitting a screen to available viewport space, by
measurement" — this same lesson was independently rediscovered by Dominoes and Battleship, so the
rule is consolidated there rather than duplicated a third time here. What stays here is the
verification side:

- **The `fit` check mounts the game into the hub's real chrome directly** (the launcher hides
  dev-only games behind a name check, and the launcher was never the point - the CSS is), and runs
  it at both a tall AND a short viewport, since browser toolbars eat 100-190px on a real phone and
  a layout can pass one and fail the other.

Three ways this same fix went wrong before it went right at Pool, all worth knowing if you're
debugging a similar failure:

1. **Cancelling the surrounding gap is not enough.** The root still ASKS for `100dvh` and is then
   pushed down, so its bottom lands past the fold. Pin the height too.
2. **Never measure with a raw `getBoundingClientRect().top`.** It is viewport-relative, so it
   moves when the page is scrolled - and the page is scrolled *because* of the overflow you are
   trying to remove. It computed `up = 0`, applied nothing, and left the page scrollable. Add the
   scroll offset back, or measure something that cannot move.
3. **The gap is not always on `el.parentElement`.** In the hub it belongs to `.hub-main`, two
   levels up; the element's own parent has no padding at all. Measure the distance, not a
   particular ancestor's style.

## 4. Before you say it is done

- **Open your own screenshots.** `.visual-out/` is right there. A painted-element count is not a
  look; it only proves the blank-screen case did not happen.
- **Put your screenshot next to `reference/<game>/`** and compare them as two pictures. Ten
  seconds, versus a round trip that costs a day.
- **Send Matt the screenshot** rather than a paragraph describing it. He can reject a picture in
  five seconds and a paragraph never.
- **If self-capturing fails, ask Matt for a screenshot rather than concluding from numbers alone.**
  As of 2026-08-21, on the machine this session ran on, three self-capture methods all failed: the
  preview pane's `screenshot` action (times out), reading a canvas via `toDataURL` and
  reassembling base64 in slices (produced unprocessable images), and `test-visual.mjs` itself
  (SKIPs without `playwright-core`/Chromium installed). This is an environment observation, not a
  permanent law — a different session's `HANDOFF-SKEEBALL-BOARD.md` documents the `toDataURL`
  method working elsewhere — so try the normal path first, but don't burn a long stretch of time
  re-deriving that it's broken here again; asking Matt is always the fallback and he's answered in
  seconds every time it's been tried.
- **A green suite is not a rendered screen, and a rendered screen is not a played game.** The
  first half was earned twice. The second half was earned promoting Pool without playing it.

## 5. What this cannot do

No automated check can tell you a game looks *good*, or that it matches a reference. That needs
eyes. The entire point of the tooling is to make using them cheap: one command, one folder, one
glance per game across three themes.

If four rounds go by on the same visual detail, **stop tuning parameters and go find the picture.**
The Battleship rounds each adjusted size and persistence, because those are the properties you can
name without seeing something. The viewing angle was wrong the whole time.
