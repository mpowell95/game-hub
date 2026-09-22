// hole-editor/js/drafts.js - CLOUD DRAFTS: the editor's document, autosaved to Firebase under the
// designer's PLAYER CODE, so Matt can open anyone's course in his own editor and review it
// (2026-09-22).
//
// Matt: *"we should be able to have his edits autosave and be saved in the repo or something for
// me to review later, right?"* Not the repo - GitHub Pages is static and a page cannot write to
// it without a token that would be public. The hub's own Firebase database can. So:
//
//   courseDrafts/<CODE>/<courseId> = { docJson, name, holes, theme, by: { code, name }, updatedAt }
//
// - Keyed by PLAYER CODE, the same 5-character code messages and careers use, so a draft follows
//   the person, not the phone. The code comes from the hub profile when this browser has one
//   (same origin, same localStorage) and is otherwise typed in once and kept under EDITOR_CODE_KEY.
// - `docJson` is the serialised document as ONE STRING. RTDB turns arrays into objects with
//   numeric keys and drops empty arrays; a document full of `[[x, y], ...]` polygons would come
//   back subtly different. A string comes back byte-for-byte.
// - Writes verify by fresh re-read (THE LAW rule 6) and report through `onStatus`, never throw.
//   The browser's localStorage copy is written first and always, so a dead connection loses
//   nothing - the cloud is the REVIEW copy, the browser is the working copy.
// - Nothing here deletes. A draft is overwritten only by its own author's next autosave.
//
// The rules (database.rules.json): anyone signed in may READ every draft (Matt reviews, and a
// designer can open theirs on a second device); a device may WRITE only the code it has claimed
// (msgAuth/<uid>, js/messages.js) - or Matt, through admins/<uid>.

import { getStatsApp } from '../../js/firebase-boot.js';
import { loadProfile, canonicalizeCode } from '../../js/profile-store.js';
import { ensureAuthClaim } from '../../js/messages.js';
import { writesAllowed } from '../../js/stats-net.js';

export const EDITOR_CODE_KEY = 'golf.holeEditor.code.v1';
const AUTOSAVE_MS = 2500;

/** Who is designing: the hub profile's code and name when this browser has a profile, else the
 *  code typed into the editor. null when neither exists yet. */
export function designer() {
  try {
    const p = loadProfile();
    if (p && p.playerId) return { code: p.playerId, name: p.name || p.playerId, fromProfile: true };
  } catch { /* no profile */ }
  try {
    const raw = localStorage.getItem(EDITOR_CODE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const code = parsed && canonicalizeCode(parsed.code);
    if (code) return { code, name: (parsed.name || '').trim() || code, fromProfile: false };
  } catch { /* fall through */ }
  return null;
}

/** Remember a typed code (and a display name) for this browser. Returns the canonical code or
 *  null when the code is not a valid player code. */
export function rememberDesigner(code, name) {
  const c = canonicalizeCode(code);
  if (!c) return null;
  try { localStorage.setItem(EDITOR_CODE_KEY, JSON.stringify({ code: c, name: String(name || '').trim().slice(0, 40) })); } catch { /* best effort */ }
  return c;
}

export function forgetDesigner() {
  try { localStorage.removeItem(EDITOR_CODE_KEY); } catch { /* best effort */ }
}

/** Firebase, signed in, with THIS designer's code claimed on this device. null offline. */
async function ready(code) {
  const boot = await getStatsApp();
  if (!boot || !boot.uid) return null;
  // ensureAuthClaim claims the HUB PROFILE's code. When the designer typed a different code (no
  // profile in this browser), claim that one instead - same node, same rule.
  const claimed = await ensureAuthClaim(boot);
  if (claimed !== code) {
    try {
      if (!writesAllowed('course draft claim')) return null;
      await boot.api.set(boot.api.ref(boot.db, `msgAuth/${boot.uid}`), code);
    } catch (err) {
      console.warn('[drafts] could not claim this device for ' + code, err);
      return null;
    }
  }
  return boot;
}

function summarise(doc) {
  return {
    name: (doc.course && doc.course.name) || (doc.courseId === 'redmesa' ? 'Red Mesa' : 'My Course'),
    theme: (doc.course && doc.course.theme) || 'desert',
    holes: doc.order.length,
  };
}

/** Write one draft and verify it landed. Resolves { ok, at } or { ok: false, error }. */
export async function saveDraft(doc, docJson, who) {
  if (!who || !who.code) return { ok: false, error: 'no designer code' };
  try {
    const boot = await ready(who.code);
    if (!boot) return { ok: false, error: 'offline' };
    if (!writesAllowed('course draft')) return { ok: false, error: 'dev origin' };
    const { db, api } = boot;
    const at = Date.now();
    const path = `courseDrafts/${who.code}/${doc.courseId}`;
    await api.set(api.ref(db, path), { docJson, ...summarise(doc), by: { code: who.code, name: who.name }, updatedAt: at });
    const back = await api.get(api.ref(db, `${path}/updatedAt`));
    if (!back || !back.exists() || back.val() !== at) return { ok: false, error: 'verify failed' };
    return { ok: true, at };
  } catch (err) {
    return { ok: false, error: String((err && (err.code || err.message)) || err) };
  }
}

/** Every draft in the database, newest first: [{ code, courseId, name, theme, holes, by, updatedAt }]. */
export async function listDrafts() {
  const boot = await getStatsApp();
  if (!boot) return null;
  const snap = await boot.api.get(boot.api.ref(boot.db, 'courseDrafts'));
  const all = (snap && snap.exists()) ? snap.val() : {};
  const out = [];
  for (const [code, byCourse] of Object.entries(all || {})) {
    for (const [courseId, d] of Object.entries(byCourse || {})) {
      if (!d || typeof d.docJson !== 'string') continue;
      out.push({ code, courseId, name: d.name || courseId, theme: d.theme || '', holes: d.holes || 0, by: d.by || { code }, updatedAt: d.updatedAt || 0 });
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** One draft's document JSON string, or null. */
export async function fetchDraft(code, courseId) {
  const boot = await getStatsApp();
  if (!boot) return null;
  const snap = await boot.api.get(boot.api.ref(boot.db, `courseDrafts/${code}/${courseId}/docJson`));
  return (snap && snap.exists()) ? snap.val() : null;
}

/** The autosaver: call `touch()` after every change; it coalesces into one write AUTOSAVE_MS after
 *  the last edit, never overlaps writes, and re-runs once if edits landed mid-write. `onStatus`
 *  gets { state: 'idle'|'saving'|'saved'|'error'|'nocode', at?, error? }. */
export function makeAutosaver({ getDoc, getJson, getDesigner, onStatus }) {
  let timer = null; let inFlight = false; let dirty = false;
  const run = async () => {
    timer = null;
    if (inFlight) { dirty = true; return; }
    const who = getDesigner();
    if (!who) { onStatus({ state: 'nocode' }); return; }
    inFlight = true; dirty = false;
    onStatus({ state: 'saving' });
    const r = await saveDraft(getDoc(), getJson(), who);
    inFlight = false;
    onStatus(r.ok ? { state: 'saved', at: r.at } : { state: 'error', error: r.error });
    if (dirty) touch();
  };
  const touch = () => { clearTimeout(timer); timer = setTimeout(run, AUTOSAVE_MS); };
  const flush = () => { clearTimeout(timer); return run(); };
  return { touch, flush };
}
