---
name: dropbox
description: Review the screenshots / screen recordings Matt JUST uploaded to Dropbox. Use when Matt types /dropbox (with or without comments after it), or says "look at what I just uploaded to Dropbox", "watch the new recording", "check the screenshots in Dropbox".
argument-hint: "[what to look for, or what to change]"
---

# /dropbox: review the newest Dropbox upload

Matt's comments (may be empty): **$ARGUMENTS**

"Newest" means uploaded **seconds or minutes ago**. Matt films a game on his iPhone, uploads, then
types `/dropbox`. Never review an old file thinking it is the new one.

## 1. Find the newest upload

Load the Dropbox tools with ToolSearch (`select:mcp__Dropbox__list_folder,mcp__Dropbox__download_link`).

1. `list_folder` path `/Claude Code Refs`, `recursive: false`. Also `list_folder` path `""`,
   `recursive: false` (in case he dropped it at the root). Page until `has_more` is false.
   **Skip the `Old` folder** (archived refs; its files show a fake recent `modified_time` from the move).
2. Sort files by **`modified_time`** (upload time), newest first. Not by name, not `client_modified`.
3. **The batch** = the newest file, plus each next-older file uploaded within 5 minutes of the one
   after it. Matt often uploads 5-20 photos at once; review them all, oldest to newest.
4. If his comments name something else ("the last 3", "just the video", "yesterday's recording"),
   do that instead.
5. **Freshness check:** if the newest file is more than ~20 minutes older than now (`date -u`),
   say so in one line ("Newest is `X`, uploaded 3 h ago. Still uploading?") and stop. Do not review
   stale files.
6. If nothing is in those folders, `list_folder` path `""` recursive (skip `/Claude Code Refs/Old/`).

Tell Matt in one line what you are reviewing (names, count, length of any video).

## 2. Download and turn into images

Work in your scratchpad directory, one new folder per run (`<scratchpad>/dropbox/<time>/`).

- `download_link` with the `id:` of each file (`expiration_in_sec: 900`). The URL is **single-use**:
  fetch it exactly once with `curl -sS -L -o <file> '<url>'`; never HEAD or preview it.
- Run `bash .claude/skills/dropbox/prep.sh <file> <out-dir>` on each file. It prints `READ <path>`
  for every image to open:
  - **Video**: contact sheets, 12 frames each, a timestamp on every frame, ~36 frames total.
  - **HEIC** (iPhone photos): converted to JPG (installs `pillow-heif` on first use).
  - **PNG/JPG**: resized to fit one Read.
- **Read every image it prints.** Do not skim one sheet and guess the rest.
- Need detail at a moment (a glitch, small text)? Pull a full-size frame with the `TIP` command
  it prints, at that timestamp. For a fast glitch, pull several frames 0.1 s apart.
- **Audio:** you cannot hear the recording. If Matt seems to be talking in it, say so and ask him
  to type what he said.

## 3. Review

- **Which game and screen** is it? (Top bar, title, layout. Check the game's `CLAUDE.md`.)
- **If Matt wrote comments**, they are the brief: answer exactly what he asked, point at the
  timestamps / photos that show it. If he asked for a change, make it; per the root `CLAUDE.md` a
  change means live on the deployed Game Hub (commit, PR, merge, check the Pages deploy).
- **If he wrote nothing**, report what you see happen, then every problem you spot: bugs, glitches,
  stuck states, layout overlap or clipping, text cut off, wrong scores, things that contradict
  the root `CLAUDE.md` (too many words, "You" instead of profile names, hue-only markers). Then ask
  which to fix. Do not change code unprompted.
- Cite evidence: "at 0:08 the disc goes off the pitch", "IMG_5642: score reads 1-1 but...".
- Be honest about limits: frames are sampled, so something between frames can be missed. Say
  "I can't tell from the frames" rather than guess.

## Rules

- **Read-only on Dropbox.** Never move, rename, delete, share or create anything there.
- Never put a download URL in a reply, commit or file (anyone with it can fetch the file).
- Delete the downloaded media when done (videos can be 150 MB; disk is limited). Keep the JPGs
  only while you still need them.
- Report on the game in the recording only (root `CLAUDE.md`, "Answer about the game you were
  asked about").
