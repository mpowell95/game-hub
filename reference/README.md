# `reference/` — the pictures a session builds against

**Put the screenshots here. That is the whole point of this folder.**

When Matt says "clone this game" or "make it look like this" and sends screenshots, they belong in
`reference/<game>/` as real committed image files, not described in prose in a handoff document.

## Why this folder exists

Four rounds were spent on Battleship's cannon, and three of them were built by a session that had
never seen the thing it was cloning. `HANDOFF-BATTLESHIP-REDESIGN.md` said, in writing:

> Matt supplied a screenshot grid of a polished mobile Battleship. **You will not have the image.**
> Everything you need is described below; build to this description.

That sentence was not true. `yahtzee.png` and `yahtzee_ref_409x729.png` were sitting in the repo
root the entire time, committed, and the Yahtzee brief tells its reader to open them. A session can
read a PNG. Nobody looked, because nothing said where to look, and one document actively said not
to bother.

The description that replaced the image said "a large black cannon barrel on a dark ring base."
That is a true description of a top-down gun turret. It is also a true description of a wheeled
side-view field gun. Three sessions built the second one. **Prose survives the trip for rules and
protocols. For a drawing it does not.**

## The convention

```
reference/<game>/          the screenshots themselves, named for what they show
reference/<game>/SPEC.md   measurements taken off them, in fractions, not pixels
```

Name files for the state they show, not the order they arrived: `battle-shot-in-flight.png`,
not `IMG_4821.png`. A session skimming filenames should be able to tell which screen is which.

## If you are a session about to do visual work

1. **`ls reference/<game>/` and open every image, before you write a line of code.** If the folder
   is empty, say so and ask for a screenshot. Do not build from a description of a picture when the
   picture could be sitting one `Read` away.
2. **Take measurements while you can see it, and write them into `SPEC.md`** as fractions of the
   frame ("base circle = 37.5% of screen width", "black band = 0.15 × radius"), never as raw
   pixels. Screens differ; ratios do not. Your session ends and your eyes go with it; `SPEC.md` is
   what the next one inherits instead of your prose.
3. **Screenshot your own build and put it next to theirs.** `node test-visual.mjs` writes a contact
   sheet to `.visual-out/`. Comparing two pictures takes ten seconds; guessing takes four rounds.

Full process: `VISUAL-PROCESS.md`.

## Licensing / privacy

These are screenshots of commercial apps, kept as design reference for a personal, ad-free,
non-commercial project. They are never redistributed as assets and never traced into shipped
artwork — every sprite, icon and animation in this repo is drawn from scratch as our own SVG.
Matt's call, 2026-08-08: *"Any screenshot I send you can live in the repo if it helps you be better
at designing the games."*

`mancala/reference/` is in `.gitignore` from an earlier, opposite decision. That is why Mancala's
reference screenshots exist on Matt's machine and in **no** cloud session: the convention was
invented and disabled in the same move. Do not repeat it. If a particular image genuinely cannot be
committed, then convert it to a `SPEC.md` plus an SVG mock of our own while you can still see it,
and commit those.
