# Word Weaver handoff (2026-11-02)

Read this, then `word-weaver/CLAUDE.md` (the game's full rules), then continue as if it were the same session.
Matt said "pick up where we left off" on Word Weaver = this file.

## Where it stands

Word Weaver (folder `word-weaver/`, hub id `word-weaver`, stats id `wordweaver`) is **live but admin only**
(`devOnly: true`). Testers: Matt, Lili and Ana ("Anita Bonita") have access. **Not released yet** (see "Release" below).

Built and live (all on `main`):
- Setup screen: Daily button, Easy / Medium / Hard / Expert (bands 1-500 / 501-1000 / 1001-1500 / 1501-2000), Play N,
  How to play, EN/ES button, Report a bug (added by another session).
- 2,000 English + 2,000 Spanish levels, remade 2026-11-01 "common words first" (every common word a wheel makes is in
  the grid; Medium went from ~15 common bonus-only words a level to under 1) with one smooth climb.
- Stars per level: 0 hints 3, 1 hint 2, 2+ 1. Leaderboard = points = stars x 1/2/3/4 by band (no points for the daily).
- Hints recorded at tap time (wiping the save gains nothing); most-hints merge across phones (`wwMerge`).
- Bonus words (gold pill, "Bonus word!", flying star) and **star squares** (1-3 per level; fill one by finding its
  word yourself; a hint-revealed one is lost).
- The bonus counter (star chip, "N/10" toward a free hint), free hints (10 bonuses = 1, **max 3 banked**, extra lost).
- Daily puzzle (EN + ES, 730 days from 2026-11-02, board `wwDaily/`, rules live, only today playable).
- A sky per difficulty (dawn / sunset / dusk / night) and a real dark mode (night skies, dark tiles, light letters).
- Big wheel (up to 290px), bigger letters, tap-to-pick letters with a small ink check.
- Fixed 2026-11-02: the counter counted a finished level's bonuses twice (jumped on the done screen, dropped at the next
  level). Matt kept the grid word COMMIES (Expert 1501): "keep it, whatever".

## DONE 2026-11-02: bonus stars are a currency you SPEND on hints (built and live; `word-weaver/CLAUDE.md`)

The open item now is the RELEASE (below). The notes under this heading are the history of the build.

**Settled 2026-11-02 (Matt: "yes to all")**: prices Letter 40, Pick a square 60, Word 120 bonus stars. Broke = earn more
or take the plain hint (costs a level star). Free hints already used count as spent (`fu` x 10). Bought hints never lower
the level's stars; balance replaces "N/10"; no cap. Mockup sent for review: `docs/mockups/word-weaver-hint-shop.html`
(+ `.jpg`). Next: Matt's comments on the mockup (edit the MOCKUP), build only when he says "build it".

Matt, 2026-11-02, in order:
1. "We should change the bonus structure. You should have to spend bonus stars to buy hints."
2. On my proposal (letter 5, pick-a-square 8, word 15): **"that's too affordable. We don't want people to be able to
   buy hints whenever they want"** -> prices must be much higher. NOT yet set: propose numbers to Matt first (players
   earn roughly 1-15 bonus words + 1-3 star squares a level after the remake; measure it from the data before picking,
   e.g. aim for about one letter hint every ~5-10 levels).
3. **"when you're broke, you should be forced to play on easy to collect more stars to buy a hint or you should be
   forced to use a hint"** -> when the balance is too low: either go earn more stars (Easy levels are the quick way),
   or use the plain hint that costs the level's rating (today's paid hint: 1 hint = 2 stars, 2+ = 1 star). Confirm this
   reading with Matt in one line if unsure.
4. **"yes those 3 sound good"** -> three hint kinds:
   - **Letter**: one letter, as today (first empty square of the shortest unfound word).
   - **Pick a square**: the player taps the square to reveal.
   - **Word**: fills the shortest unfound word.

My proposal he did not object to: bought hints never lower the level's stars; the balance shows at the top
instead of the "N/10" meter; the "3 free hints max" rule goes away (a currency is meant to be saved; offer a cap if he
wants one).

### How to build it (THE LAW applies: nothing earned is lost)
- Balance = lifetime bonuses earned (`ww.x` bonus words + `ww.b` star squares + this level's unrecorded,
  `wwBonuses` in `js/word-weaver-points.js`) minus a NEW spent counter (e.g. `ww.sp`, only grows, merged by adding).
  The free-hint fields `ww.fu`/`ww.fl` stay as stored (rule 5) but are no longer read; decide whether free hints
  already used should count as spent (honest: `fu` x 10 were "spent").
- A bought hint is recorded at tap time like the paid one (new recorder, e.g. `recordWordWeaverBuy(kind, cost, level,
  lang)` in `js/game-stats.js`, through the play log; daily too, keyed like `ww.dh`). It must NOT count toward the
  level's hint count (stars). The save already keeps `free` (reveals that cost no star): reuse it for bought reveals so
  `cleanState` never turns them into paid hints.
- UI: the bulb opens a small sheet with the three kinds and their prices (fewest words: icon + price; greyed when
  unaffordable) plus the plain hint (costs a level star). Pick-a-square = a mode where the next grid tap reveals that
  square. Root CLAUDE.md "as few words as possible" applies.
- Update How to play, `word-weaver/CLAUDE.md`, tests (`tools/test-word-weaver.mjs`, `word-weaver/js/test.js`), and the
  free-hint code paths (`_freeBank`, `wwFreeHints`, the hint badge).
- Shared files change (`js/game-stats.js`, `js/players-agg.js`, `js/word-weaver-points.js`) -> bump CACHE past main,
  `node tools/validate-sw-assets.mjs`, and the Firebase workflow redeploys functions (boards). Word Weaver-only files
  need no CACHE bump (held back, network-first).

## Release (when Matt says "release Word Weaver")

Matt was advised to play a few levels + the daily first (nobody had finished a level on the rebuilt data as of
2026-11-02 ~noon ET). The release commit: remove `devOnly` from the `GAMES` entry in `js/hub.js` (add `released`), drop
`wordweaver` from `ADMIN_ONLY` in `js/game-stats.js` and the `devOnly` on its row in `js/game-stats-ui.js` TABS, put
`word-weaver/data/**` (ladder chunks EN/ES + `daily.json` both) in `sw.js` LAZY so phones download levels only on
first play, run `validate-sw-assets`, bump CACHE, deploy, verify Pages + Firebase runs. Per Matt's rule, admin-only
test plays (Matt's, Lili's, Ana's) do NOT carry over: Word Weaver starts at 0 for everyone at release.

## Tools

- Play logs: `GAMEHUB_READER` env var is set in these sessions; `node tools/read-play-log.mjs <CODE>` or the
  `readPath(... 'playLog/<CODE>' ...)` pattern with `tools/reader-auth.mjs` `signInForReading()`; `directory/` maps
  codes to names (MattyIce, Lili, "Anita Bonita" = Ana). Never print or use Matt's code in a test.
- Daily board: `node tools/read-ww-daily.mjs`. Data tests: `node word-weaver/js/data-test.js`, `data-test-es.js`.
- Browser probes: localhost `node server.mjs`, profile test1 / DREG5, `gamehub.devAllowSync.v1`='0'; the test seam
  `window.__wwTest` (`ui`, `submit(word)`, `hint()`) exists only once a level is on screen.
- A Pages deploy run can be CANCELLED when another merge lands right after; then check that the next successful run's
  commit contains yours (`git merge-base --is-ancestor <yours> <theirs>`).
