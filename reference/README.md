# `reference/` — the pictures a session builds against

**Put the screenshots here while the work is open. That is the whole point of this folder.**

When Matt says "clone this game" or "make it look like this" and sends screenshots, they belong in
`reference/<game>/` as real committed image files, not described in prose in a handoff document.

**And they come back OUT when that work closes** - see "Retention" below. A picture is an INPUT.
`SPEC.md` is the artifact.

## Why this folder exists

Four rounds were spent on Battleship's cannon, and three of them were built by a session that had
never seen the thing it was cloning. `HANDOFF-BATTLESHIP-REDESIGN.md` said, in writing:

> Matt supplied a screenshot grid of a polished mobile Battleship. **You will not have the image.**
> Everything you need is described below; build to this description.

That sentence was not true. Yahtzee's two reference images (`yahtzee.png`, `yahtzee_ref_409x729.png`)
were sitting in the repo root the entire time, committed, and the Yahtzee brief tells its reader to
open them. A session can read a PNG. Nobody looked, because nothing said where to look, and one
document actively said not to bother. (Those two are retired now, per Retention below; the lesson
is not.)

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

**Two `SPEC.md` files exist so far and neither has its images any more** (`battleship/`, `pool/`).
Both sets arrived as chat attachments, which a session receives as content, not as files it can
write to disk, and both were converted to measurements the same session they were seen. That is the
whole shape this folder is for, and it is why those two are 5 KB each while Yahtzee's and Mancala's
un-converted recordings were 17 MB and 20 MB.

**A `SPEC.md` is not a style opinion, it is a citation.** Pool's palette was rebuilt off
`pool/SPEC.md`; a later session that dislikes salmon and quietly darkens it has not made a design
choice, it has un-done an instruction. If a spec looks wrong, the fix is a new screenshot, not a
new hex code.

## Video (`.MOV`) — you cannot Read one. Here is how to see it.

Matt uploads screen recordings as well as screenshots, and **a session cannot open a video**: the
Read tool takes images and PDFs. The ffmpeg that ships with Playwright is a cut-down build that
only opens WebM and refuses an iPhone `.MOV` outright. So:

```
npm install --no-save ffmpeg-static
# one contact sheet per recording - 30 frames laid out as a grid, so you see the MOTION
node_modules/ffmpeg-static/ffmpeg -i "reference/<game>/clip.MOV" \
  -vf "fps=3,scale=200:-1,tile=6x5" -frames:v 1 -q:v 3 sheet.jpg
# or single frames, one per second
node_modules/ffmpeg-static/ffmpeg -i "reference/<game>/clip.MOV" \
  -vf "fps=1,scale=430:-1" -q:v 4 frame_%02d.jpg
```

Then `Read` the jpgs. **Use the contact sheet first** — a recording exists precisely because the
thing being shown MOVES, and a single still throws away the only information the video was carrying.
Write the choreography into `SPEC.md` while you can still see it.

This lives here, not in a game's own `CLAUDE.md`, because a session working in `mancala/` never
loads `yahtzee/CLAUDE.md` — the same reason the root file carries the "USE WHAT EXISTS" table.

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

## Retention: the media is an INPUT, the `SPEC.md` is the artifact

Matt, 2026-08-26, on 86 MB of committed reference media: *"They were references for you that were
one time use... they can be deleted."* He is right, and the folder already proved it - Battleship
and Pool turned their screenshots into **5 KB of fractions** and kept nothing else, while Yahtzee's
six how-to `.MOV`s (17 MB) and Mancala's seven (20 MB) sat here for weeks after both games shipped,
because nobody ever did the converting step or the deleting one.

**The rule:**

1. While a game's visual work is OPEN, its media lives in `reference/<game>/`, committed, so any
   session can open it.
2. **While you can still see it**, convert it: `SPEC.md` in fractions, plus whatever belongs in that
   game's own `CLAUDE.md`.
3. When the work CLOSES, **delete the media in the same commit that closes it.** The `SPEC.md`
   stays. So does the game's `CLAUDE.md`.

**Nothing is lost by deleting.** This repo does not rewrite history, so every file ever committed
here stays permanently recoverable from the commit that removed it:

```
git log --oneline --diff-filter=D -- 'reference/yahtzee/*'     # find the removing commit
git checkout <sha>^ -- 'reference/yahtzee/'                    # get them all back
```

Removed 2026-08-26 and recoverable that way: `reference/{Skeeball,mancala,yahtzee,ball-run}/`
(48 MB of recordings), `filler/`'s ~30 playtest screenshots (14 MB), `3am 7.22/`'s 22 annotated
screenshots (its `.md` notes stayed), the root's `dpad*`/`yahtzee*`/`Leaderboard` images, and
`skeeball/ScreenRecording_08-26-2026...mp4` (the 10 fps clip, already read - see
`skeeball/CLAUDE.md`, "Frame rate"). Tracked repo: **100.7 MB -> 34.4 MB**.

`js/challenge/assets/` (19 MB) is NOT reference material and is not covered by this rule - it is the
retired challenge system's own celebration artwork, a gift, and it stays.

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
