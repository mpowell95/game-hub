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

/** Newest last. `action: 'bug-report'` is understood by js/announce-ui.js and opens the report
 *  form straight from the popup's own button. */
export const ANNOUNCEMENTS = [
  {
    id: 'bug-report-2026-08-11',
    from: '2026-08-11',
    until: '2026-10-15',
    icon: '🐞',
    title: { en: 'Found a bug? Tell me.', es: '¿Has visto un fallo? Cuéntamelo.' },
    body: {
      en: ['Say what happened, add a screenshot, send. Your phone details come along.'],
      es: ['Cuenta qué ha pasado, añade una captura y envía. Los datos de tu móvil van incluidos.'],
    },
    // `shots` are the "here is where the button lives" pictures, captured from the real hub with
    // the arrow drawn in (scripted, see the milestone note in js/CLAUDE.md). Paths are
    // repo-relative and resolved against js/announce-ui.js's own URL, so they work from any page.
    // Four variants each, resolved at render time by the SAME textFor() the title and body use:
    // per LANGUAGE, because a Spanish popup pointing at a button labelled "Report a bug" is a
    // picture of somebody else's app, and per THEME, so a light screenshot never glares out of a
    // dark popup. A missing file removes its own figure rather than leaving a broken frame - these
    // sit in the sw's non-atomic REST tier, so one bad path can never break the popup.
    shots: [
      {
        img: { en: 'img/where-hub.png', es: 'img/where-hub-es.png' },
        imgDark: { en: 'img/where-hub-dark.png', es: 'img/where-hub-es-dark.png' },
        caption: { en: 'Bottom of the games list', es: 'Al final de la lista de juegos' },
      },
      {
        img: { en: 'img/where-profile.png', es: 'img/where-profile-es.png' },
        imgDark: { en: 'img/where-profile-dark.png', es: 'img/where-profile-es-dark.png' },
        caption: { en: 'And on your profile page', es: 'Y en tu página de perfil' },
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
