// js/announce.js — one-time announcements on the launcher ("here's how to report a bug").
//
// The LOGIC half only: which announcement (if any) this device still owes, and the seen-list that
// makes it one-time. js/announce-ui.js draws it. Split for the same reason js/new-badge.js is split
// from js/hub.js — the decision is pure, headless-testable maths over a literal, and the drawing is
// not (test-bug-report.mjs covers this file).
//
// THE LAW (root CLAUDE.md): the one key here, `gamehub.announce.v1`, holds a list of announcement
// ids this device has dismissed. That is a PREFERENCE, not history — rule 2's carve-out, the same
// class as launcher favorites, theme and language. Nothing a player earned is stored here, and the
// worst possible failure is seeing a notice twice. The list is append-only anyway, and an id it
// does not recognise is left alone rather than pruned (rule 5's habit: an unknown key might belong
// to a build this device is about to update to).
//
// ADDING AN ANNOUNCEMENT: append an entry below with a NEW id, a `from` date, and an `until` date.
// Do not re-use or renumber an existing id — devices that dismissed it would be shown it again,
// and devices that never saw it would never see the new one. `until` is what makes an announcement
// retire itself with no follow-up commit (same self-cleaning idea as the New pill): after it
// passes, a phone that has been in a drawer for two months opens to today's app, not to a stack of
// old news.

import { parseReleaseDate } from './new-badge.js';

const KEY = 'gamehub.announce.v1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The announcements, newest last. `action: 'bug-report'` is understood by js/announce-ui.js and
 *  opens the report form directly from the popup's own button. */
export const ANNOUNCEMENTS = [
  {
    id: 'bug-report-2026-08-11',
    from: '2026-08-11',
    until: '2026-10-15',
    icon: '🐞',
    title: { en: 'Found a bug? Tell me.', es: '¿Has visto un fallo? Cuéntamelo.' },
    body: {
      en: [
        'There is a new Report a bug button at the bottom of the games list, and on your profile page.',
        'Say what went wrong, add a screenshot if you have one, and send it. Your phone and app details go with it automatically, so I can see exactly what happened without asking you twenty questions.',
      ],
      es: [
        'Hay un nuevo botón Reportar un fallo al final de la lista de juegos, y en tu página de perfil.',
        'Cuenta qué ha pasado, añade una captura si tienes una, y envíalo. Los datos de tu móvil y de la app van incluidos automáticamente, así puedo ver qué ha pasado sin hacerte veinte preguntas.',
      ],
    },
    cta: { en: 'Try it now', es: 'Pruébalo ahora' },
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

/** Is this entry inside its live window right now? A missing/invalid `from` means "live already";
 *  a missing/invalid `until` means "no expiry" — both safe defaults, because the failure mode of a
 *  bad date should be an announcement that shows, not one that silently never does. */
export function isLive(a, now = Date.now()) {
  const from = parseReleaseDate(a && a.from);
  const until = parseReleaseDate(a && a.until);
  if (from !== null && now < from) return false;
  // `until` is inclusive of that whole day, so an announcement set to end on the 15th is still
  // shown all day on the 15th rather than vanishing at midnight UTC.
  if (until !== null && now > until + DAY_MS) return false;
  return true;
}

/** The one announcement this device should be shown now, or null. Oldest first, so a device that
 *  missed two only ever sees one per visit and in the order they were written. */
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
