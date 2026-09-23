# Baseball handoff, after R19 (2026-09-23)

Paste everything below the line into a fresh Claude Code session on `mpowell95/game-hub`.

---

You are continuing work on the Baseball game in the Game Hub repo (`baseball/`). Read `baseball/CLAUDE.md` (top two entries: R19, R18) and `docs/BASEBALL-3D-BUILD.md` section 9 (last entries: R19, R19 record) before doing anything.

**Save usage.** Don't use subagents unless they clearly cut usage. Don't re-read whole big docs; grep for the section you need.

## Where things stand (live on main, `game-hub-v914`)

- **R18** (live): Career is the landing tab; 3 presets (Balanced, Hitter, Pitcher); first-season block.
- **R19** (live):
  - Pitch Accuracy matters: edge pitches are harder to square up (`EDGE_CONTACT`), and low Accuracy pulls the aim toward the middle (`FEEL.engine.aimPull`).
  - Hit Speed matters: wider/stronger grounder beat-outs, gap hits stretch, steals 0.02/pt.
  - **Majors points are spent after the season** (`SPEND_AFTER_SEASON`, `career.js` `spendLocked`). Matt chose this.
  - Majors rosters 23.0 / ceiling 26; a Majors loss pays 1 point.
- Simulated careers (`node sim-baseball-career.mjs --all-tiers --careers 200 --assert --perfect 400`, ~1 min): all 8 assertions pass.
  - Strong player, first-try World Series: 30.5% (was 60%).
  - Median player, first title: 11 seasons. Perfect Season: 3.8%.
- The career simulator's player now steals (`HUMAN_STEAL`) and works the corners (`paint` per tier).

## Open items

1. **Playtest first.** Matt hasn't played R19 yet. Act on his feedback before anything below.
2. **Weak player stalls**: about 7% of simulated careers win a World Series; most get stuck in the Minors. The likely fix is a difficulty option. Ask Matt before building it.
3. **Standings**: DONE 2026-09-23 (CPU records match your results; see `baseball/CLAUDE.md`).
4. **Team names**: DONE 2026-09-23 (40 names, `TEAM_NAMES` in `baseball/js/ui.js`; see `baseball/CLAUDE.md`).
5. **After a World Series win**: what happens next (item 10).
6. **Screwball / Eephus / Cutter** movement and speed (item 9); park features (item 11).

## Rules that bit last session

- **Bump `CACHE` in `sw.js` past what's on `main` RIGHT BEFORE merging.** Another session shipped v913 minutes before ours; it had to be fixed with v914. Re-fetch `main` just before the PR.
- Run `node validate-sw-assets.mjs` after any game-file change, and commit `sw.js` + `version.json`.
- Deploy = PR → merge → confirm the `pages build and deployment` run succeeds → tell Matt it's live.
- Any economy or difficulty change: measure it with `sim-baseball-career.mjs`, never guess. The doc's locked rule: a win must always pay at least as much as a loss.
- Baseball suites: `node baseball/js/test.js`, `node test-baseball-career.mjs`, `BB_DEVICE_QUICK=1 node test-baseball-device.mjs`, `node test-visual.mjs baseball`, `node check-no-scroll.mjs baseball` (start `node server.mjs` first). All green at v914.
- Matt's style: succinct, plain words, PC only.
