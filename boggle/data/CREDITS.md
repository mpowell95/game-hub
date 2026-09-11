# Dictionary — ENABLE word list

`words.txt` is the **ENABLE** word list (Enhanced North American Benchmark
Lexicon), compiled primarily by Alan Beale with assistance from Mendel Cooper
as an open, freely available reference for word-game play. It has served as
the basis for the word lists used in a number of published word games.

- **Source list:** `enable1.txt`, mirrored at
  https://github.com/dolph/dictionary/blob/master/enable1.txt
- **License:** Public domain. ENABLE is not copyrighted; the related YAWL word
  list (elasticdog/yawl) is explicitly released into the public domain by its
  author specifically because it builds on ENABLE and other public-domain
  lists by Alan Beale — see https://github.com/elasticdog/yawl.
- **Changes made:** uppercased, filtered to words of 3-16 letters (Boggle's
  minimum word length and the longest length findable on a 4x4 board), sorted,
  one word per line. No words were added or otherwise altered.

This is a plain word list, not creative artwork, and is used here as Boggle's
dictionary for word validation and the board solver. Being public domain, it
carries no attribution requirement, but is credited here for provenance.

# Dictionary (Spanish) — RLA-ES

`words-es.txt` is GENERATED, not copied: `build-boggle-es.mjs` (repo root)
fetches the **RLA-ES** Spanish spelling dictionary and expands the subset of it
that Boggle plays with. Re-run that script to rebuild it.

- **Source:** `sbosio/rla-es`, the es_ES dictionary shipped with LibreOffice and
  Apache OpenOffice, fetched via the packaged copy at
  https://github.com/wooorm/dictionaries/tree/main/dictionaries/es
  (`index.dic` + `index.aff`).
- **License:** distributed by its authors under a **triple disjoint licence** —
  GNU GPL v3+, GNU LGPL v3+, **or MPL 1.1+** — with the choice left to the
  user. **We use it under the MPL 1.1**, which permits distributing the file in
  a larger work provided the file itself keeps its licence notice; this section
  is that notice. See https://github.com/sbosio/rla-es for the upstream text.
- **Changes made:** proper nouns and abbreviations dropped; noun/adjective
  plurals and feminine forms expanded from the affix rules; for verbs, ONLY the
  infinitive, gerund and participle (the participle in all four adjective
  forms) — no conjugated forms at all; accents stripped and ñ folded to n so
  every word spells on plain A-Z dice; uppercased, filtered to 3-16 letters,
  sorted, one word per line. No words were invented: every entry is an RLA-ES
  form or a regular inflection of one.

The full rationale for each of those choices is in `build-boggle-es.mjs`'s
header, and the effect on real boards is measured by `tune-boggle-es.mjs`.
