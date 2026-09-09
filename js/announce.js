// js/announce.js - one-time announcements on the launcher ("here's how to report a bug").
//
// The LOGIC half: which announcement (if any) this device still owes, and the seen-list that makes
// it one-time. js/announce-ui.js draws it. Split for the same reason js/new-badge.js is - the
// decision is pure, headless-testable maths over a literal (test-bug-report.mjs covers it), the
// drawing is not.
//
// THE LAW (root CLAUDE.md): `gamehub.announce.v1` holds the ids this device has dismissed. A
// PREFERENCE, not history - rule 2's carve-out, same class as favorites, theme and language; the
// worst possible failure is seeing a notice twice. The list is append-only, and an id it does not
// recognise is left alone rather than pruned (rule 5's habit: an unknown id may belong to a build
// this device is about to update to).
//
// ADDING ONE: append an entry with a NEW id, a `from` and an `until`. Never re-use or renumber an
// existing id - devices that dismissed it would see it again, and devices that never saw it would
// never get the new one. `until` is what retires an announcement with no follow-up commit (the New
// pill's self-cleaning idea): a phone left in a drawer for two months opens to today's app, not to
// a stack of old news.

import { parseReleaseDate } from './new-badge.js';

const KEY = 'gamehub.announce.v1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Newest last. `action: 'bug-report'` and `action: 'play-golf'` are understood by the hub's
 *  handler and run straight from the popup's own button. `tile: { art, name }` draws that game's
 *  real launcher art (js/game-art.js, keyed by HUB id) with its name under it - use it for a new
 *  game, where the thing being announced is a tile the player is about to go looking for. */
export const ANNOUNCEMENTS = [
  {
    // GOLF. Matt, 2026-09-09: *"I want a popup on the gamehub itself saying something like new
    // game! Golf... It should only appear once per phone. It can't be attached to the v# because
    // other sessions are updating other games and we'll be updating golf still."*
    //
    // Both of those are what this module already is: the seen-list is keyed by this ID and nothing
    // else, so it is one per device for ever, and it has no relationship to `sw.js`'s CACHE - golf
    // can be redeployed twenty more times and no one sees this twice.
    //
    // `requiresGame` HOLDS IT UNTIL GOLF IS ACTUALLY LIVE (js/hub.js's `_maybeAnnounce`). It has to
    // ship while golf is still admin-only, and telling the family about a game none of them can
    // find is worse than saying nothing. This way the popup turns itself on the moment the game is
    // released on the admin page - no second deploy, nothing to remember.
    //
    // No `shots`: those are "here is where the button lives" pictures for a control nobody would
    // find on their own. A new game is a new TILE on the launcher they are already looking at,
    // which is why this one shows the TILE ITSELF (`tile`) instead of a screenshot - the player
    // then knows exactly what to look for when the popup closes.
    //
    // NO BODY TEXT. Matt, 2026-09-09, on the first version: *"Way too much text. The first sentence
    // is useless... It's just supposed to say: New Game! / Golf / And show the thumbnail."* The
    // paragraph it replaced explained the tutorial gate; that explanation belongs in the game,
    // where the lesson is the first thing on the screen anyway. Nothing here needs a `body`, and
    // the `icon` and `badge` are gone with it: the tile is the picture, and a gold NEW pill above
    // a heading that already reads "New game!" is the same word twice.
    id: 'golf-2026-09-09',
    from: '2026-09-09',
    until: '2026-11-15',
    requiresGame: 'golf',
    action: 'play-golf',
    title: { en: 'New game!', es: '\u00a1Juego nuevo!' },
    tile: { art: 'golf', name: { en: 'Golf', es: 'Golf' } },
    cta: { en: 'Play', es: 'Jugar' },
  },
  {
    id: 'bug-report-2026-08-11',
    from: '2026-08-11',
    until: '2026-10-15',
    icon: '🐞',
    // `badge: true` wears the launcher's own gold NEW pill (js/strings.js's hub_new_tag, so it
    // says New / Nuevo exactly as the tiles do). Same word, same gold, same meaning as a new
    // game's tile - the popup is announcing something new, and a second vocabulary for that
    // would be a small lie about how this app labels things.
    badge: true,
    title: { en: 'Please report bugs!', es: '¡Reporta los fallos, por favor!' },
    // Matt's words. The opening clause used to restate the title ("Please tell me about bugs...")
    // and was cut; the joke is the part that earns its space, because it explains WHY the reports
    // are needed without sounding like a support form. Contraction kept on purpose - this is a
    // popup from Matt to his family, not a release note.
    // Spanish: `en el tuyo`, NOT `en los demás` - the latter reads as "everyone else" (people)
    // rather than "the other phones". `reportar` in the title is a mild anglicism in Spain, kept
    // deliberately so it matches the button the picture points at (`Reportar un fallo`).
    // Both are drafted, not native-reviewed (js/strings.js's header says the same of every es
    // string here) - worth a ten-second check with a native speaker before this goes wide.
    body: {
      en: ['And send a screenshot if you can! Apparently, just because everything works perfectly on my phone, that doesn\'t mean it\'s working on yours.'],
      es: ['¡Y manda una captura si puedes! Por lo visto, que todo funcione perfecto en mi móvil no quiere decir que funcione en el tuyo.'],
    },
    // `shots` are the "here is where the button lives" pictures: WHOLE phone screens (Matt's own
    // mock-up), shown side by side, each with a ring round the button and an arrow pointing at it,
    // drawn into the page by the capture script (see the milestone note in js/CLAUDE.md). Paths are
    // repo-relative and resolved against js/announce-ui.js's own URL, so they work from any page.
    // Four variants each, resolved at render time by the SAME textFor() the title and body use:
    // per LANGUAGE, because a Spanish popup pointing at a button labelled "Report a bug" is a
    // picture of somebody else's app, and per THEME, so a light screenshot never glares out of a
    // dark popup. A missing file removes its own figure rather than leaving a broken frame - these
    // sit in the sw's non-atomic REST tier, so one bad path can never break the popup.
    shots: [
      {
        img: { en: 'img/where-hub.jpg', es: 'img/where-hub-es.jpg' },
        imgDark: { en: 'img/where-hub-dark.jpg', es: 'img/where-hub-es-dark.jpg' },
        caption: { en: 'Games list', es: 'Lista de juegos' },
      },
      {
        img: { en: 'img/where-profile.jpg', es: 'img/where-profile-es.jpg' },
        imgDark: { en: 'img/where-profile-dark.jpg', es: 'img/where-profile-es-dark.jpg' },
        caption: { en: 'Your profile', es: 'Tu perfil' },
      },
    ],
    cta: { en: 'Try it', es: 'Pruébalo' },
    action: 'bug-report',
  },
];

/** Ids this device has dismissed. Never throws; a malformed or missing store reads as "none". */
export function loadSeen() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const seen = parsed && parsed.seen;
    return Array.isArray(seen) ? seen.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}

/** Mark one announcement dismissed. Append-only; returns the new list. */
export function markSeen(id) {
  const seen = loadSeen();
  if (typeof id !== 'string' || !id || seen.includes(id)) return seen;
  const next = seen.concat([id]);
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, seen: next, updatedAt: Date.now() })); }
  catch (err) { console.warn('[announce] could not record the dismissal (it may show again)', err); }
  return next;
}

/** Inside its live window right now? A missing/invalid `from` means "live already", a bad `until`
 *  means "no expiry" - both fail safe, because a bad date should produce an announcement that
 *  shows, not one that silently never does. */
export function isLive(a, now = Date.now()) {
  const from = parseReleaseDate(a && a.from);
  const until = parseReleaseDate(a && a.until);
  if (from !== null && now < from) return false;
  // `until` covers that whole day, so one ending on the 15th still shows all day on the 15th.
  if (until !== null && now > until + DAY_MS) return false;
  return true;
}

/** The one announcement to show now, or null. Oldest first, so a device that missed two sees one
 *  per visit, in the order they were written. */
export function pendingAnnouncement(now = Date.now(), seen = loadSeen(), list = ANNOUNCEMENTS) {
  for (const a of list) {
    if (!a || !a.id) continue;
    if (seen.includes(a.id)) continue;
    if (!isLive(a, now)) continue;
    return a;
  }
  return null;
}

/** Resolve an {en, es} field (or a plain string) for a language. Mirrors hub.js's blurbText. */
export function textFor(field, lang) {
  if (field && typeof field === 'object' && !Array.isArray(field)) return field[lang] || field.en;
  return field;
}

export default { ANNOUNCEMENTS, loadSeen, markSeen, isLive, pendingAnnouncement, textFor };
