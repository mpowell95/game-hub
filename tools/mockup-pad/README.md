# Mockup Pad

Matt's phone photo editor for marking up Game Hub screenshots and mockups, then pasting them back
into Claude. A claude.ai artifact, not part of the Game Hub: nothing here is deployed with the hub.

- **Live:** https://claude.ai/artifact/NVvuh5KUq88xNm2D8K2ZMz (private to Matt)
- **Source:** `index.html` here is the published page as of 2026-11-03 (version `1793712214-c570`).
  It is the body the Artifact tool publishes (the tool adds the doctype/head skeleton).
- **Capabilities declared:** `downloads`, `assets`, `db`, `user`.

## What it does

Pages (thumbnails + `+` to add, `New` to start over), and tools: Select, Free (lasso), Crop, Box,
Circle, Arrow, Pen, Text, Hide (pixelate/cover). Copy / Cut / Paste work across pages; **Lift** turns
a selection into a piece that stays movable (tap it later to move, resize, copy, delete, or **Stick**
it into the picture). Pasted pictures arrive lifted. Save shows each page to press-and-hold copy.

## Decisions (Matt, 2026-10-15 to 2026-11-03)

- Copy/Cut/Paste between pages; no "Drag it into place" toast after paste ("I know how paste works").
- **Lift** (like Paint 3D's "make 3D"): a dropped piece must stay re-selectable and never erase what
  is underneath. Drawings over a lifted piece become pieces too, so they stay on top.
- Opens on a **blank** phone-shaped page; no sample picture.
- **Remembers the last project**: a local copy (IndexedDB `mockup-pad`/`project`) plus a durable copy
  with the artifact (each page/piece a PNG asset; one private doc `data/users/<id>/project` listing
  them, `t` = the save time). On open the newer copy wins. Superseded assets are deleted right after
  the doc moves on, so storage holds one project.
- **New** (beside `+`) asks "Start a new project? Every page will be deleted." Cancel / Delete all;
  Delete all clears both copies.

## Editing it

Edit `index.html`, then republish with the Artifact tool to the URL above (pass `url`; omit
`capabilities` to keep them). Read the live version first: it may have changed in another chat.
The artifact's Chat button opens whichever conversation last published it.
