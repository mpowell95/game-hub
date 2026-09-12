# PIER NINE — playfield blueprint and build sequence

**Status: designed, approved by nobody yet. No code written.** Written 2026-09-12 from Matt's brief:
*"take the boardwalk tuning too. make it a better, more organized pinball machine... write a plan
for how you would design a playable, fun, competitive, pinball board."*

The visual blueprint (to-scale plan drawing, keyed schedules) is the companion to this file. This
file is the buildable text. Where they disagree, this one wins and the drawing gets fixed.

---

## 0. The finding that shapes everything

**BOARDWALK is not a pinball machine with problems. It is a physics sandbox with no game in it.**

44 parts: 18 segs, 10 posts, 5 arcs, 4 bumpers, 2 slings, 2 ramps, 2 flippers, 1 drain. There is no
score, no target, no lamp, no lock, no mode and no rule anywhere in `pinball2/`. **The engine has
eight shape kinds and not one of them can award a point**, so no amount of moving rails around makes
it a better pinball machine. Six of the seven build phases below are engine work; the table is one
of them.

**BOARDWALK is not deleted, replaced or rewritten.** It stays as a built-in with its three red
probes. It is the physics test bed and it is good at that. PIER NINE is a new table beside it — the
same call this project already made about the old `pinball/` game.

---

## 1. Theme

**PIER NINE** — a seaside pier at night. It keeps BOARDWALK's world (which is already the hub's
arcade register) and gives every mechanism a thing it actually is:

| Mechanism | Is |
|---|---|
| centre saucer / ball lock | the **Ferris Wheel** |
| left wireform ramp | the **Coaster** |
| right wireform ramp | the **Pier** |
| pop bumper nest | the **Arcade** |
| drop target bank | the **Fishing Dock** |
| spinner | the **Lighthouse** |
| top rollover lanes | **P·I·E·R** |
| standup targets | **Ring Toss** |

---

## 2. Playfield geometry

Standard Williams body. Everything in **millimetres**, origin top-left, **y positive DOWN the
playfield toward the drain** — the same frame `table.js` uses.

```
field            515 x 1067
usable playfield 409 wide (x 28 .. 437), once the shooter lane is taken out
tilt             6.5 deg, gravity 1.111 m/s2   (unchanged, config-level)
ball             27 mm diameter
```

### Fixed structure

| Part | Geometry |
|---|---|
| left rail | (22, 150) → (22, 806), r 6 |
| top-left corner | arc centre (134, 150) r 112, 180°→270° |
| top rail | (134, 38) → (381, 38) |
| top-right corner | arc centre (381, 150) r 112, 270°→360° |
| right rail | (493, 150) → (493, 1000) |
| shooter lane wall | (443, 218) → (443, 1000) — **34 mm clear lane** |
| drain | x 28, y 1000, w 409, h 60 |

**The lane must be 34 mm clear, not 30.** The gap rule bans any clearance between 20.3 and 31.1 mm,
so a 30 mm lane is illegal by construction — it is exactly the width a ball wedges in.

### Lower third

| Part | Geometry |
|---|---|
| left flipper | pivot (142, 905), len 76, rest −28°, end +32° |
| right flipper | pivot (323, 905), len 76, mirrored |
| tip gap | **47 mm** at rest — 1.7 balls, a real drain gap |
| left sling | (96, 812) → (136, 888) |
| right sling | (369, 812) → (329, 888) |
| left inlane guide | (74, 706) → (110, 902) |
| right inlane guide | (394, 706) → (358, 902) |
| outlanes | 30 mm clear |
| inlanes | 32 mm clear |
| kickback | left outlane, (46, 968), fires up-lane at 3.2 m/s |

### Features

| Key | Feature | Geometry |
|---|---|---|
| 3 | Ferris Wheel saucer | centre (232, 470), r 23. Ejects 2.4 m/s toward the left flipper |
| A | Arcade — 3 pop bumpers | (168, 272), (232, 222), (296, 272), r 25. **33 mm clear between them** so a ball can thread the nest |
| B | P·I·E·R — 4 rollover lanes | posts at x 131/186/241/296/351, y 96→150. Lane clear 38 mm |
| C | Lighthouse spinner | across the left orbit at (59, 430), span 38 mm |
| D | Ring Toss — 2 standups | (406, 496)–(406, 528) and (406, 566)–(406, 598), facing the left flipper |
| 5 | Fishing Dock — 3 drop targets | (100,626)→(128,613), (136,609)→(164,596), (172,592)→(200,579). Angled at the right flipper |
| 2 | Coaster ramp | mouth (196, 742); crest **z = 62 mm** over the centre; exits left inlane (120, 838) at z 0 |
| 4 | Pier ramp | mouth (300, 716); crest **z = 55 mm**; exits right inlane (368, 838) at z 0 |

**Both ramps must obey the four ramp rules already enforced by `rampProbe`**: both ends at z=0, no
kink over 20° per junction, no level run, and entry decided by a CROSSING rather than a window.

---

## 3. The six major shots

Six, not ten, and that is a hard call driven by measurement: this table renders **306 px wide** on a
phone at the closed sheet detent, so a seventh shot is a 20-pixel target nobody can aim at. A
captive-ball lane and an upper flipper were both designed and then cut for the same reason.

| # | Shot | From | Returns to | Base |
|---|---|---|---|---|
| 1 | Left orbit (past the spinner) | right flipper | right inlane | 3,000 + 250/rev |
| 2 | The Coaster | right flipper | **left inlane** | 5,000 |
| 3 | Ferris Wheel saucer | either | left flipper | 7,500 |
| 4 | The Pier | left flipper | **right inlane** | 5,000 |
| 5 | Fishing Dock bank | right flipper | live rebound | 1,500 ea / 10,000 bank |
| 6 | Right orbit | left flipper | pop bumpers | 3,000 |

**Shots 2 and 4 are the design.** Each returns to the OPPOSITE flipper, so the two ramps together
make a figure-eight the player can ride indefinitely — that is the flow loop, and it falls out of
where the ramps exit rather than needing any extra geometry.

---

## 4. Scoring

### Base

| Element | Points |
|---|---|
| pop bumper | 100 |
| slingshot | 50 |
| inlane | 250 |
| spinner | 250 / revolution |
| P·I·E·R lane | 500 (set of 4: 5,000 + bonus multiplier +1) |
| standup | 1,000 |
| drop target | 1,500 (bank of 3: 10,000, bank resets) |
| orbit | 3,000 |
| ramp | 5,000 |
| saucer | 7,500 |

### Combos

Two majors inside **3 seconds** multiply the second: ×2, then ×3, ×4, ×5 (cap). This is the skill
ceiling and it costs a timer and a counter.

### Skill shot

Judged on the plunge, before any flipper is touched.

| Plunge | Award |
|---|---|
| into the lit P·I·E·R lane | 15,000 |
| soft, into the Ferris Wheel | 25,000 |

**The launch velocities are MEASURED through the real engine, never guessed.** BOARDWALK's band
turned out to be 1.55–1.95 m/s and choppy inside itself; there is no reason to expect this one to be
wider.

### Modes

Each Fishing Dock clear lights the saucer for one mode. One at a time, timed, no stacking.

| Mode | Runs | Scores | Award |
|---|---|---|---|
| Ring Toss | 30 s | standups only | 5,000, +5,000 each |
| Coaster Run | 45 s | ramps only, consecutive | 10,000 / 20,000 / 40,000 |
| High Tide | 30 s | everything | ×2 |
| **Fireworks** (wizard) | 6 balls | all 3 modes played AND multiball completed | 25,000 everything |

### Multiball

Three locks in the Ferris Wheel start **Boardwalk Multiball**, 3 balls.

| Event | Award |
|---|---|
| lock 1 / 2 / 3 | 10,000 / 15,000 / 20,000 |
| jackpot (lit ramp) | 50,000 |
| super jackpot (saucer, after 2 jackpots) | 150,000 |
| add-a-ball | complete P·I·E·R during multiball |

### End-of-ball bonus

`bonus = (2,000 × ramps + 5,000 × banks + 3,000 × lane sets + 100 × spins) × multiplier`,
multiplier 1× to 5×, +1 per P·I·E·R completion.

Extra ball at 250,000.

---

## 5. What the engine is missing

Each new kind is the **five-place engine edit plus seven editor edits** the HANDOFF's landmine list
describes, and each needs its own probe or it is invisible to every check (`distToShape` throws on
an unknown kind, which is the only one that fails loudly).

| New kind | Risk | Note |
|---|---|---|
| `rollover` | **low** — a sensor | like `drain` but scores instead of killing |
| `standup` | **low** | a `seg` that scores |
| `spinner` | **low** — a sensor | counts crossings; does not block |
| `droptarget` | **medium** | must leave the collider set when down, and the bank reset must not re-materialise it under a ball |
| `saucer` | **high** | it HOLDS a ball and then ejects. It applies a velocity to a ball already at that position — **never a position write**, which is the invariant the whole engine rests on. Needs a watchdog that re-fires after 2 s |
| `kickback` | **medium** | same shape of risk as the saucer, in the outlane |

Plus the systems: a per-machine `rules.js` (score, ball, bonus, modes, lamps), a backglass, and
multiball (ball count, drain rules, serve-next — `World.balls` is already an array and `addBall`
already exists).

---

## 6. Build sequence

Each phase ships and is playable on its own.

| # | Phase | Gate |
|---|---|---|
| 1 | The scoring spine: `rules.js`, score/ball/bonus state, backglass, lamp state | headless rules tests |
| 2 | Sensor parts: `rollover`, `standup`, `spinner` | every probe sees them |
| 3 | Mechanical parts: `droptarget`, `saucer`, `kickback` | rest sweep + a saucer watchdog probe |
| 4 | Multiball | 3-ball soak, 0 escapes |
| 5 | Build PIER NINE to this blueprint | all 8 probes green |
| 6 | The rules: modes, locks, jackpots, combos, skill shot, bonus | robot-player score spread |
| 7 | Tune on measurement | the table below |

---

## 7. "Fun and competitive" as a number

This repo does not ship on "feels better now". A robot player measures these; the table gets tuned
until it meets them.

| Measure | Target | Why |
|---|---|---|
| median ball time | 25–45 s | under 25 is frustrating, over 45 the game never ends |
| make rate, any major | ≥ 25% | below this the shot is decoration |
| make rate, any major | ≤ 70% | above this it is a gimme and the skill ceiling collapses |
| score 10th / 50th / 90th | 150k / 400k / 1.2M | an 8× spread over three balls is what makes a leaderboard mean anything |
| dead stops (`restSweep`) | 0 | non-negotiable |
| balls leaving (`escapeProbe`) | 0 | non-negotiable |
| ambiguous gaps (`checkGaps`) | 0 | non-negotiable |

**The robot player does not exist yet and is part of phase 6.** Without it, "make rate" and "score
spread" are opinions. A soak that wanders is not a measurement — this project has the receipts on
that (`pinball/CLAUDE.md` records four soaks passing a table that was unplayable in thirty seconds).

---

## 8. Deliberately NOT in this design

Each of these was considered and cut, and the reason matters more than the cut:

- **Upper flipper** — a 46-pixel control on a phone. The ramps already give the upper playfield a purpose.
- **Captive ball lane** — indistinguishable from a post at this render scale.
- **Subway / ball tunnel** — a place a ball can be lost, in an engine whose entire thesis is that there is nowhere for a ball to be lost.
- **Mini-playfield, spinning platform, magnet** — all of them need a driven position write.
- **A seventh major shot** — see §3.
- **Stats, a hub entry, a leaderboard** — that is after Matt has judged it, and when it comes it must be a NEW stats id (`pinball2`), never the existing `pinball` id (THE LAW rule 5).
