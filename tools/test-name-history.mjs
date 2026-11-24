// tools/test-name-history.mjs - every name a person used and every other account on their devices
// (js/name-history.js, 2026-11-24), shown on the admin person page. Pure, no network.
import { personNames, devOf } from '../js/name-history.js';
let fail = 0;
const ok = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fail++; };
const U = 'aaaaaaaa-1111-2222-3333-444444444444', V = 'bbbbbbbb-1111-2222-3333-444444444444';
const players = {
  [U]: { profile: { name: 'You', playerId: 'ALT01' }, updatedAt: 5, stats: { games: { ballrun: { total: { played: 8 } } } } },
  [`${U}-MAIN1`]: { profile: { name: 'King', playerId: 'MAIN1' }, updatedAt: 9 },
  [V]: { profile: { name: 'Old King', playerId: 'MAIN1' }, updatedAt: 3 },
  'cccccccc-1111-2222-3333-444444444444': { profile: { name: 'Someone', playerId: 'OTHER' }, updatedAt: 1 },
};
const usernames = { 'el%20fantasma': { code: 'ALT01', at: 4 }, king: { code: 'MAIN1', at: 2 } };
const nameLog = { MAIN1: { a: { from: 'Kingpin', to: 'King', dev: V, at: 7 } } };
const r = personNames({ players, recIds: [`${U}-MAIN1`, V], codes: ['MAIN1'], usernames, nameLog });
const nm = r.names.map((n) => n.name);
ok('devOf names the browser', devOf(`${U}-MAIN1`) === U);
ok('names: every device name, reserved, and renamed-from', ['King', 'Old King', 'Kingpin'].every((x) => nm.includes(x)));
ok('other accounts: the alt on the same browser, with its reserved name', r.others.length === 1 && r.others[0].code === 'ALT01'
  && r.others[0].names.some((n) => n.name === 'el fantasma') && r.others[0].plays === 8);
ok('other accounts: a stranger on another browser is not listed', !r.others.some((o) => o.code === 'OTHER'));
ok('a blank or "You" name reads (no name)', r.others[0].names.some((n) => n.name === '(no name)'));
process.exit(fail ? 1 : 0);
