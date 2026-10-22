# Stop shipping. Verify what's already out there.

## Context

Six builds shipped today (v550-v555). Three of them fixed bugs I introduced earlier the same
day. Matt has had to film three screen recordings to tell me things were broken, and has spent
the day undoing damage to keep the one real improvement.

He also caught me stating a limitation I never tested ("this container can't reach github.io")
while I had been successfully curling github.io throughout. curl works; the browser doesn't.
I made the claim broader than the evidence and didn't check before saying it.

The pattern, in his words: ship before thinking, then he untangles it.

So the next step is not another feature or another fix. It is to stop adding and confirm what
is already live actually works on his device.

## Plan

**1. Ship nothing else until Matt says so.** No fixes, no batches, no "while I'm in here."
The queued Batch 2/3/4 work stays queued.

**2. Confirm the three live fixes on his phone, from his side.** These are the only things that
matter and I cannot test any of them here (iOS, and Firebase is unreachable from this container):

- Skeeball gallery: does a swipe land on a picture, or still an empty box?
- The version chip: does it read a plain `v555` and stay there?
- The hub-wide record / King of Games numbers: correct?

**3. If any of the three is wrong, fix that one thing and nothing else.**

**4. If he wants today undone**, the revert points are clean — every change went in as its own
squashed commit on `main` (#300, #303, #305, #307, #308, #310, #314), so any subset can be
reverted independently.

## How I work for the rest of this

- **Verify before claiming.** Especially claims about what I can't do. One failed attempt is
  not a limitation.
- **Short answers.** He has asked for "simpler / layman's terms / be concise / be succinct"
  repeatedly. Lead with the answer, stop.
- **No hidden caveats.** If something is untested, say so in the same breath as the result,
  not in a footnote after he asks.
