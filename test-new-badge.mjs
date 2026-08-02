// test-new-badge.mjs — headless unit tests for js/new-badge.js, the launcher's New pill.
// Run: node test-new-badge.mjs  (no deps)
//
// js/new-badge.js is pure (no storage, no DOM, `now` injectable), so everything here is exact
// rather than clock-dependent. The last block additionally checks the REAL js/hub.js GAMES
// registry: a `released` field that is present but MALFORMED is the silent failure mode worth
// guarding — the game ships, the date looks right in review, and the pill simply never appears.
// Absence is fine and deliberate (see the GAMES comment: only genuinely-new games carry a date).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { NEW_DAYS, parseReleaseDate, daysSinceRelease, isNewGame } = await import('./js/new-badge.js');

const ROOT = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.log(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  } else console.log(`ok   ${label}`);
};

const day = (s) => Date.UTC(...s.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));

// ---- parseReleaseDate ----
eq('parses a valid date to UTC midnight', parseReleaseDate('2026-08-01'), Date.UTC(2026, 7, 1));
eq('trims surrounding whitespace', parseReleaseDate(' 2026-08-01 '), Date.UTC(2026, 7, 1));
eq('missing field -> null', parseReleaseDate(undefined), null);
eq('non-string -> null', parseReleaseDate(20260801), null);
eq('wrong shape -> null', parseReleaseDate('Aug 1 2026'), null);
eq('unpadded month/day -> null', parseReleaseDate('2026-8-1'), null);
eq('date that rolls over -> null (2026-02-31 is not March 3)', parseReleaseDate('2026-02-31'), null);
eq('month 13 -> null', parseReleaseDate('2026-13-01'), null);
eq('a real leap day parses', parseReleaseDate('2028-02-29'), Date.UTC(2028, 1, 29));

// ---- daysSinceRelease ----
eq('same day -> 0 days', daysSinceRelease('2026-08-01', day('2026-08-01') + 3600e3), 0);
eq('next day -> 1 day', daysSinceRelease('2026-08-01', day('2026-08-02')), 1);
eq('a week later -> 7 days', daysSinceRelease('2026-08-01', day('2026-08-08')), 7);
eq('future date -> negative', daysSinceRelease('2026-08-10', day('2026-08-01')), -9);
eq('unparseable -> null', daysSinceRelease('nope', day('2026-08-01')), null);

// ---- isNewGame: the window ----
const g = (released) => ({ id: 'x', released });
eq(`new on release day`, isNewGame(g('2026-08-01'), day('2026-08-01')), true);
eq(`still new on day ${NEW_DAYS - 1}`, isNewGame(g('2026-08-01'), day('2026-08-01') + (NEW_DAYS - 1) * 864e5), true);
eq(`NOT new on day ${NEW_DAYS} (the window is exclusive at its end)`,
  isNewGame(g('2026-08-01'), day('2026-08-01') + NEW_DAYS * 864e5), false);
eq('long past -> not new', isNewGame(g('2026-01-01'), day('2026-08-01')), false);
eq('a future release date counts as new (slow device clock must not miss the announcement)',
  isNewGame(g('2026-09-01'), day('2026-08-01')), true);
eq('no released field -> never new', isNewGame({ id: 'x' }, day('2026-08-01')), false);
eq('malformed released -> never new', isNewGame(g('someday'), day('2026-08-01')), false);
eq('null/undefined game -> never new (never throws)', isNewGame(null, day('2026-08-01')), false);
eq('accepts a bare date string too', isNewGame('2026-08-01', day('2026-08-02')), true);

// ---- the real registry: every released date that IS present must parse ----
// js/hub.js is side-effectful on import (it boots stats sync), so this scrapes the source the
// same way favorites.test.mjs mirrors hub.js's ordering rather than importing it.
{
  const src = readFileSync(join(ROOT, 'js/hub.js'), 'utf8');
  const dates = [...src.matchAll(/^ {4}released: '([^']*)',$/gm)].map((m) => m[1]);
  eq('at least one GAMES entry carries a released date (the scrape still matches the file)',
    dates.length > 0, true);
  eq('every released date in js/hub.js parses', dates.filter((d) => parseReleaseDate(d) === null), []);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
