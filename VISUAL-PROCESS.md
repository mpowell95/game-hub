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
- **Say explicitly what the reference does NOT show.** Battleship's four screenshots were all the
  battle screen; the mode screen, the deploy screen and the win overlay have never been seen, so
  nothing may claim those "match the reference".

## 3. While building

`node test-visual.mjs` drives a game in a real Chromium at 393x852 in light, dark and
reduced-motion, and writes a contact sheet to `.visual-out/`.

**It looks at what CHANGED, not at all 19 games every time.** Matt's rule, and it is the right one:
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
what changed. Running all 19 is a decision a person makes.

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

## 4. Before you say it is done

- **Open your own screenshots.** `.visual-out/` is right there. A painted-element count is not a
  look; it only proves the blank-screen case did not happen.
- **Put your screenshot next to `reference/<game>/`** and compare them as two pictures. Ten
  seconds, versus a round trip that costs a day.
- **Send Matt the screenshot** rather than a paragraph describing it. He can reject a picture in
  five seconds and a paragraph never.
- **A green suite is not a rendered screen.** That sentence has been earned twice.

## 5. What this cannot do

No automated check can tell you a game looks *good*, or that it matches a reference. That needs
eyes. The entire point of the tooling is to make using them cheap: one command, one folder, one
glance per game across three themes.

If four rounds go by on the same visual detail, **stop tuning parameters and go find the picture.**
The Battleship rounds each adjusted size and persistence, because those are the properties you can
name without seeing something. The viewing angle was wrong the whole time.
