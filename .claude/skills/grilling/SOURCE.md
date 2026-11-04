Copied 2026-11-04 from https://github.com/mattpocock/skills (MIT), skills/productivity/grilling and grill-me.
`grill-me` (typed as /grill-me) just calls `grilling`.

2026-11-04: also added `writing-for-agents` (mattpocock/skills, MIT, unchanged) and `security-audit`
(cloudflare/security-audit-skill, MIT, unchanged minus its test files). Both reviewed in full first:
plain instructions; security-audit's two .cjs files only validate its own JSON (no network, no writes).
A full audit writes its report to ~/security-audit-skill/ by default, which a cloud session loses: pick
a git-ignored folder in the repo or send the report before the session ends.
