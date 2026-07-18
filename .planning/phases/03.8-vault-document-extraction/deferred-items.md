# Phase 3.8 — Deferred / out-of-scope discoveries

## [Lane 4, 03.8-05] `@pikar/pii` scanText quadratic on long uniform character runs

Found while writing the Lane-4 truncation test: `scanText("a".repeat(400_000))` takes ~6 minutes
(measured 361s at 400k chars, clearly super-linear: 4s @ 50k, 17s @ 100k, 90s @ 200k). A
detector regex backtracks catastrophically on long UNBROKEN same-character runs. Natural-language
text of the same size scans in ~10ms (400k chars of word-shaped filler → 11ms), so real
transcripts/PDF text layers are unaffected in practice — but a pathological input (e.g. a huge
minified/base64-ish text blob reaching any scanText call site) would stall a Convex action until
its timeout.

Not fixed in Lane 4 (packages/pii is outside the lane's ownership). Suggested fix: find the
backtracking detector in `packages/pii/src/scan.ts` DETECTORS and bound it (possessive-style
rewrite or a pre-pass length guard on candidate runs). Lane-4's test avoids the shape with
word-based filler (see vaultTranscribe.test.ts truncation test comment).

## [Lane 4, 03.8-05] Pre-existing backend tsc errors (30) — identical on main

`pnpm --filter @pikar/backend exec tsc -p . --noEmit` fails with 30 errors in
skills.test.ts / tenant.test.ts / worm.test.ts / etc. (`import.meta.glob` typing, stale-looking
index typings). Verified byte-identical error set on the main checkout — pre-existing, not a
Lane-4 regression. vaultTranscribe.ts / vaultTranscribe.test.ts contribute zero errors.
