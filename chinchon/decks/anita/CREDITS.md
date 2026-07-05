# Card artwork — Anita (Española deck with a custom Oros suit + back)

"Anita" is a light skin over the default **Baraja Española** deck. Only the **Oros
(coins) pip cards** and the **card back** are custom; every other card is rendered from
the Española deck at runtime (the deck registry falls back to `baraja-libre` for
anything not shipped here — see `chinchon/js/cards.js`).

- **Oros 1–9 (this folder):** a project-supplied gold coin bearing "Ana" as an
  embossed portrait medallion (`coin_clean.png`), composited onto a white card in the
  traditional Spanish pip layout and saved as WebP.
- **Back (`back.webp`):** a project-supplied personal photo of Ana, background removed
  and composited into an original card-back design (deep green field, gold engine-turned
  pattern and border, the coin as a centre medallion, 180°-rotational symmetry). The
  photo is the project owner's own asset.
- **Everything else** (Oros figures Sota/Caballo/Rey, all Copas/Espadas/Bastos) is
  served from the Española deck. Its artwork is licensed **CC BY-SA 3.0** — full
  attribution in `../baraja-libre/CREDITS.md`, and that license continues to apply to
  those shared faces wherever this deck reuses them.

Roadmap (not yet built): custom Copas/Espadas/Bastos pips and themed picture cards
will be added to this folder one file at a time; each new file is listed in the
deck's `own` set in `cards.js` to override the Española fallback.
