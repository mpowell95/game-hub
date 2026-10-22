# HANDOFF — finish THE CLASSIC

Live at **v422** (`69e13aa`). Still `devOnly`. Deploy on every change.

Read `skeeball/MACHINE-SPEC.md` before touching geometry, materials or the board.

---

## Read this first

**Matt's instructions are the job. Do not do things he did not ask for.** Today a lot of time was
lost to work he never requested and to changes made on my own judgement. If you think something
else needs doing, say so in one sentence and wait.

**Measure what the ball touches, not just what it scores.** Every sweep that only prints
"power → score" will miss the thing that is actually wrong. `startThrow` + `step` + `takeEvents`
gives the contact sequence with part names. That one output found two invisible bodies that had
been corrupting every measurement since 13 August.

**Never say a change is done before the evidence is in.** Run the check, read it, then speak.

**Write plainly.** No "here's the thing", no "worth noting", no "correctly fails". Say what
happened. Matt has asked for this repeatedly.

---

## Do this before anything else

`node skeeball/js/test.js --full` has **not been run** since ring restitution went back to 0.18.
Before v421 it failed three assertions; two were deleted, one remains unverified:

```
the walkout/emergency path stays rare (under 2% of the sweep)
```

Run it. If that still fails, the cause is known and Matt has said **leave it**: balls jam in the
top corner of the board, where the face, the side rail and the backboard meet at right angles,
about 3% of a synthetic sweep. The rescue works and nothing is visibly broken. Do not "fix" it by
loosening the threshold without asking.

---

## Open, in Matt's words

### 1. The flare — undecided, ask him

The flare is the visible wooden wedge on each side where the narrow lane opens out to the wider
board. It is at `x = ±0.427`, the side rail is at `0.515`, and the flare is **as bouncy as the
rail** (`wall`, rest `0.42`).

Matt: *"I need to be able to throw the ball a little farther right and still be able to bank the
ball off the wall. it can't hit that piece so quickly and go crazy."*

Then later, after the two invisible bodies came out: *"The 'flare' was the problem... now it's not
a problem. Whatever is above it IS the problem."* Both of those are now removed.

**So it is unresolved whether the flare still needs moving.** Ask him. Do not change geometry on a
guess.

Measured before the removal: at the 100's power, aim 0.64–0.78 hit the flare and scored zero — a
seventh of the aim range. Re-measure before proposing anything.

### 2. The hub-wide record: 700 · MattyIce

From a build where every throw could score 100. Matt wants it gone.

It is not on this device. `appWideBest` scans every `players/*` node on the server and takes the
highest; the 700 lives on another node whose profile name is MattyIce. Two routes:

- Open Skeeball on that device and press **Reset Skeeball stats** (the dev-only button on the
  setup screen). Its node mirrors up cleared on the next hub load.
- Or delete `players/<thatDeviceId>/stats/games/skeeball` in the Firebase console.

**Do not delete player data without Matt asking in those words.** He has asked for this one.

### 3. Go live

Drop `devOnly: true` at `js/hub.js:261`. The leaderboard row in `js/game-stats-ui.js` is gated on
the same flag and flips with it. That is the whole of releasing it.

### 4. From the playtest, still awaiting his call

He has not ruled on these. Do not act until he does.

- The menu artwork contains a painted-on scoreboard full of dashes, sitting directly above his
  real stats.
- The Game over card's "Today" means *best* today, not latest.
- `MISS!` is left in the DOM at `opacity: 0`, so a screen reader keeps announcing it.
- The × on the Game over card is 36×36 and the ☰ is 40×40, both under 44.
- Stat labels are 11px after today's floor was applied; he may want larger.

### 5. Not verified on a real device

The setup screen's bottom padding clears the home-indicator bar in code, but nobody has looked at
it on a notched phone. Same for 375×667 and 360×740, which were the sizes that were broken.

---

## Needed before machine 2 exists

These are in `MACHINE-SPEC.md` as "does not exist yet".

1. **Per-machine objectives.** `skeeball/js/goals.js` holds one global set of three, hardcoded,
   with no board attached. Matt: *"I will create new criteria depending on each specific board...
   the objectives themselves will always change."* Fireworks and tiles stay global; tile colours
   may change per machine.
2. **The locked-machine slide.** A machine not yet unlocked should show the machine greyed out
   behind a large lock, with only a sliver of the board visible — enough to make the player
   curious, not enough to show what it is.
3. **Choosing where a number goes.** Numbers are painted wrapped around a ring, top or bottom, and
   which ring carries which is worked out automatically. There is no per-hole override. If Matt
   names a position, build the override.

Also untested: the setup screen becomes a swipeable carousel at two machines. The code switches on
by itself and **has never run with more than one slide**. Check the dots, the arrows and the swipe
by hand the first time.

---

## Shipped today, for context

- The swipe now reads the whole gesture, not just its upward part, so angling costs no power.
- A ball that comes back down the ramp is always given back. Do not split that rule again.
- The invisible ceiling at y 1.60 and the invisible pane at the ramp crest are **gone**. They were
  present in every version from v316. Nothing may span the top of the machine again.
- `boards.js` had two `mat` blocks; the first was dead, so `wallRest: 0.25` and `ring100Rest: 0.10`
  had never applied. Deleted. Rails run at **0.42**. Rings and corner rings at **0.18**.
- Objectives are five 100s, 360 in a single game, 10,000 points total. They fire the instant they
  complete, and the Game over card waits for the fireworks to finish.
- A dev-only **Reset Skeeball stats** button on the setup screen, gated on `isDevProfile`. Delete
  it, its two strings and its CSS when Skeeball ships.

---

## Deploy flow

1. `git fetch origin main` and branch off **`origin/main`**, never local `main` — it goes stale
   after a merge and you will silently revert other work.
2. Bump `CACHE` in `sw.js` past what is on `origin/main` right now. Re-check at commit time; other
   sessions bump it too.
3. `node validate-sw-assets.mjs`, `node test-game-conventions.mjs`, `node test-skeeball-rings.mjs`,
   `node test-skeeball-machine-spec.mjs`. `node skeeball/js/test.js --full` for anything touching
   physics, geometry or materials.
4. `git add` by explicit path. Several other sessions have uncommitted work in this repo —
   `CLAUDE.md`, `js/CLAUDE.md`, `VISUAL-PROCESS.md` and others. Never `git add -A`, never
   `git checkout --` a file you did not write.
5. Commit, push, open a PR, merge it. **Do not chain `gh run watch` onto the same command** — it
   blocks for ten minutes and Matt cannot interrupt you.
