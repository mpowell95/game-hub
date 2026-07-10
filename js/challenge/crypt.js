// crypt.js - comedy-grade obfuscation helpers for the hidden challenge.
//
// NOT security. The goal is only that a curious person browsing the PUBLIC repo
// cannot grep plaintext trigger names, answers, PINs, or codes. Everything here
// is trivially reversible on purpose (that is the "comedy grade" the plan asks for).
// Real secrets (a person's photo, Matt's real flight data) never live in source,
// they live in Firebase behind rules. See CHALLENGE-PLAN.md.
//
// Two primitives:
//   hash(str)        one-way-ish FNV-1a (32-bit) over SALT + str, hex. For values we
//                    only ever COMPARE (trigger name, admin name, question answer, PIN).
//   obf/deobf(str)   reversible base64 + XOR. For values we must DISPLAY (the 5 codes)
//                    and for the local progress blob, so neither is readable at a glance.

const SALT = 'gh-v1-9c3f';   // not secret; just perturbs the hash so it is not a bare FNV
const XORKEY = 'gh-xk-7q2z9'; // not secret; drives the reversible obfuscation (name-free on purpose)

/** Trim + lowercase. Every compare goes through this so matches are forgiving. */
export function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

/** FNV-1a 32-bit of SALT + str, as 8 hex chars. Callers pass norm(x) for text. */
export function hash(str) {
  const s = SALT + String(str == null ? '' : str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Reversible: XOR against XORKEY then base64. ASCII in, base64 out. */
export function obf(str) {
  const s = String(str == null ? '' : str);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += String.fromCharCode((s.charCodeAt(i) ^ XORKEY.charCodeAt(i % XORKEY.length)) & 0xff);
  }
  try { return btoa(out); } catch { return ''; }
}

/** Inverse of obf(). Returns '' on any malformed input (never throws). */
export function deobf(b64) {
  try {
    const bin = atob(String(b64 == null ? '' : b64));
    let out = '';
    for (let i = 0; i < bin.length; i++) {
      out += String.fromCharCode(bin.charCodeAt(i) ^ XORKEY.charCodeAt(i % XORKEY.length));
    }
    return out;
  } catch { return ''; }
}

export default { norm, hash, obf, deobf };
