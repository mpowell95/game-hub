# Batch 06 - Monopoly Deal

All four changes are to **Monopoly Deal**. Its display name is "Monopoly Deal" (do not change any
user-visible string away from it); its **folder is `business-deal/`** and its stats id is **`business`**.

**FROZEN - never rename any of these** (renaming 404s every installed home-screen app and orphans every
player's stats): the `business-deal/` folder, hub `id:'business-deal'` (`js/hub.js:56,62`), stats id
`'business'` (in `gamehub.stats` and `players/<deviceId>/games/business`), `bd-stats`
(`js/game-stats.js:237`), `gamehub.bd.pendingStats.v1` (`:249`). Folder/id names differ from the display
name on purpose - that is not a contradiction to "fix." See `CLAUDE.md`'s settled naming section.

**Module specifics (from `01_repo_context.md`):** offline-first with its **own nested service worker**
(`business-deal-hub-v29`) and its **own in-scope copy of `game-stats-global.js`**. If you add any file here,
add it to **BD's own SW asset list** (not just root `sw.js`) and bump both cache versions. User-visible
strings: `business-deal/index.html:5,12,38`, `business-deal/manifest.json:2-4`, `business-deal/js/ui.js`
(setup dialog / menus around `:299,317,384`). Audit flags **BD's AI-invocation timing was not fully read** -
read it before MD-4.

---

## MD-1 - Back-to-hub button to the top-left (TIER 1-ride-along, S)

- **Screenshot:** `09_monopoly_deal_setup_modal_...jpg`
- **Verbatim:** "move the game hub back button to the top left - like all the other games are"

Match how the other games place it (mirror Escoba / the shared chrome). If it is a shared component, make
Monopoly Deal use it the same way.

**Acceptance:** back control is top-left, consistent with the other games, still returns to the hub.

---

## MD-2 - Default opponents = 2 (TIER 1, trivial)

- **Screenshot:** `09_monopoly_deal_setup_modal_...jpg` (currently defaults to 3 AI)
- **Verbatim:** "change the default opponents to 2. So 2 computers and me"

Change only the **default** (2 AI = 3 players). User can still adjust. Store via the settings-key convention
in `CLAUDE.md` if applicable. Check nothing downstream hard-assumes 3 opponents (seating, turn order, win
checks). Setup UI is around `business-deal/js/ui.js:299`.

**Acceptance:** setup modal defaults to 2 AI; range still adjustable; default start = you + 2 computers.

---

## MD-3 - "WILD" at both the top and bottom of the Wild property card (TIER 1-ride-along, S)

- **Screenshot:** `11_monopoly_deal_...wild_property_card...jpg` (annotated)
- **Verbatim:** "The WILD should be at the top of card and the bottom of the card - both sides."

Render "WILD" mirrored at top and bottom (like a playing card) on the two-color wild property card. Apply to
all wild property cards of this style unless BD intentionally differentiates them (confirm). Do not break the
color bands / other text. Matt is colorblind - if the wild card relies on color bands, ensure a non-color cue
exists (THE LAW rule 9).

**Acceptance:** Wild property cards show "WILD" at both ends; layout/legibility intact.

---

## MD-4 - Replace the standalone "Just Say No?" modal with the normal pay-rent screen (JSN as an option) - TIER 3, APPROVAL-GATED

- **Screenshot:** `10_monopoly_deal_just_say_no_...jpg`
- **Verbatim:** "This page needs more info. How can i decide whether i wanna use a valuable Just Say No card if I don't know how much rent i'm being charged? I need to know what the payment would be and how much i have in my bank and the value of my properties. Actually, I think I want this page to not exist. It should show me the regular pay rent screen - where i can see my bank and my properties and stuff. And when i have a Just Say No card, it becomes an option I can choose on that screen instead of being displayed like this"

**Final intent:** kill the dedicated "Just Say No?" prompt. When an opponent plays something the user could
JSN, show the **normal pay-rent screen** (which already shows amount owed, bank, and properties) and offer
**"Just Say No"** as one choice there, available only when the user holds a JSN card.

**Approval-gated** (Matt's workflow: mock/plan approved before the implementation handoff is finalized).
Before building, produce a short plan reflecting how the code actually works, covering:
- All current ways to satisfy the debt on the pay-rent screen - does JSN slot in cleanly as one more option?
- JSN-vs-JSN wars: how does BD handle them today, and does routing JSN through pay-rent preserve the back-and-forth for both human and AI? (Read BD's AI-invocation timing - flagged un-read.)
- How the opponent's turn resumes / what they see when the human plays JSN from this screen.

**Suggested build (post-approval):** reroute the JSN-eligible trigger to open the existing pay-rent screen;
add a JSN action there enabled only when the human holds the card, resolving per existing rules (incl.
JSN-vs-JSN); retire the old standalone prompt once nothing routes to it.

**Acceptance (post-approval):**
- [ ] Standalone "Just Say No?" prompt gone; the JSN-eligible case opens the normal pay-rent screen (amount owed + bank + properties).
- [ ] "Just Say No" appears there only when the human holds a JSN card and plays correctly; paying normally still works; JSN-vs-JSN still resolves for human and AI.

---

### Batch exit
- [ ] MD-1/2/3 done and verified; MD-4 plan approved before its implementation. Tests + `validate-sw-assets.mjs` clean (BD's nested SW included).
- [ ] Commit (split MD-4 out; list constant changes); do not push. Update `CLAUDE.md` (and note any BD rules assumptions for MD-4). No identifier renamed.
