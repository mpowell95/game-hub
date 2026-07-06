# Card artwork — Anita (Española deck with custom pips + back)

"Anita" is a skin over the default **Baraja Española** deck. All four suits' **numbered
pip cards (ranks 1–9)** and the **card back** are custom; the **figure cards**
(Sota/Caballo/Rey, ranks 10–12) still render from the Española deck at runtime — the deck
registry falls back to `baraja-libre` for anything not shipped here (see
`chinchon/js/cards.js`).

- **Oros 1–9:** a project-supplied gold coin bearing "Ana" as an embossed portrait
  medallion (`coin_clean.png`), composited onto a white card in the traditional Spanish
  pip layout.
- **Copas / Bastos / Espadas 1–9:** original vector emblems drawn for this deck — a beer
  mug (copas), a golf driver (bastos), and a pickleball paddle (espadas), reflecting the
  group's real pastimes — laid out in the traditional pip positions. Original artwork
  created for the project; no third-party assets.
- **Back (`back.webp`):** a project-supplied personal photo of Ana, background removed and
  composited into an original card-back design (deep green field, gold engine-turned
  pattern and border, the coin as a centre medallion, 180°-rotational symmetry). The photo
  is the project owner's own asset.
- **Figures (Sota/Caballo/Rey, all suits)** are served from the Española deck, licensed
  **CC BY-SA 3.0** — full attribution in `../baraja-libre/CREDITS.md`, which continues to
  apply wherever this deck reuses those faces.

Roadmap (not yet built): themed **figure/court cards** (real friends as Sota/Caballo/Rey)
and the win/lose screens. Each new file added here is listed in the deck's `own` set in
`cards.js` to override the Española fallback.
