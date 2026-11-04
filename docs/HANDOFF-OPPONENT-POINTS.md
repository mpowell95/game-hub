# Handoff: more opponents = more points (2026-11-04)

Written by a session, not by Matt. SHIPPED 2026-11-04 on Matt's "ship it" (v1466). Before that he had said "hold onto
it for rn. I want to ship multiple changes at once."

Matt's words: "Games are more difficult when more people play. So that needs to be rewarded in all games." and
"So we need to update Monopoly Deal, Uno, Pool Cutthroat, and online games."

## The rule (mockups: `docs/mockups/opponents/sheet-<game>.{html,jpg}`, built by `build.py` there)

Each opponent beaten adds its own points (`js/lb-points.js`, read-time only).

- Monopoly Deal (`business`, mode `ai` = computer count 1-4): level points x computers. Medium 2/4/6/8, Hard 3/6/9/12.
- Uno (`uno`, mode `n` = players 2-4): level points x (n - 1). Hard 3/6/9.
- Pool Cutthroat (`eightball`, mode `game` = 'ct'): x2 (2 computers), on top of the 3-rack x2. Online Cutthroat = 6.
- Online at 3-4 seats: online points x opponents. Chinchón 3/6/9, Escoba 2/4/6, Pool 3/6. Mode `n` is saved for
  Chinchón/Escoba online; check each game's saved mode before relying on it.
- Mixed computer levels (Chinchón, Escoba, Parchís) already add each computer's points (`tableSum`); unchanged.
  Monopoly Deal, Uno and Pool set one level for every computer, so no mixed tables exist there.

## Matt's own history (read-time overlay, like `HAND_ADDS`; stored stats untouched)

Matt (MattyIce; never use his code or name in a test): "I only ever play monopoly deal
against 2 robots" and "yes count them as medium". So every Monopoly Deal win of his with no saved count = 2 computers,
and his 4 `legacy` wins (no level) = Medium. Expected: 7 Medium + 4 legacy = 11 wins x 4 = 44 points (live board,
2026-11-04 12:20 PM ET).

Only wins with a saved count (from 2026-10-30) change for anyone else. On 2026-11-04: *King of Games* Uno 10 -> 22.
