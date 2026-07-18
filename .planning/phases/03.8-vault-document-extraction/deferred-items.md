# Phase 3.8 — Deferred items (out-of-scope discoveries)

## From 03.8-02 (Lane 1, 2026-07-18)

- **`@pikar/pii` email regex backtracks O(n²) on long unbroken alphanumeric runs.** A 400k-char
  run of a single letter made `scanText` effectively hang (observed: >5 min). Real documents
  contain whitespace so the ceiling is theoretical, but a hostile/degenerate input could stall an
  extraction action until its scheduler timeout. Fix belongs in `packages/pii` (possessive-style
  bounded local-part match or a pre-tokenized scan) — shared file, not Lane-1's to touch.
- **Pre-existing backend typecheck reds (also red on `main`, not a 3.8 regression):**
  `convex/worm.test.ts` (2× TS2339 `import.meta.glob` — missing `@ts-expect-error`) and
  `convex/tenant.test.ts` (TS2339 + 2× TS2532). `pnpm --filter @pikar/backend typecheck` is not
  clean on main; per-file checks of new 3.8 files are.
- **`npx convex logs --history` on the local backend holds only a small ring buffer** — pool/loop
  noise from the workflow component evicts action lines within ~seconds. Live smokes should tail
  logs DURING the action, not fetch history after.

## From 03.8-05 (Lane 4, 2026-07-18)

- **`@pikar/pii` scanText quadratic on long uniform character runs** (same root issue Lane 1
  hit). Found while writing the Lane-4 truncation test: `scanText("a".repeat(400_000))` takes
  ~6 minutes (measured 361s at 400k chars, clearly super-linear: 4s @ 50k, 17s @ 100k, 90s @
  200k). A detector regex backtracks catastrophically on long UNBROKEN same-character runs.
  Natural-language text of the same size scans in ~10ms (400k chars of word-shaped filler →
  11ms), so real transcripts/PDF text layers are unaffected in practice — but a pathological
  input (e.g. a huge minified/base64-ish text blob reaching any scanText call site) would stall
  a Convex action until its timeout. Not fixed in Lane 4 (packages/pii is outside the lane's
  ownership). Suggested fix: find the backtracking detector in `packages/pii/src/scan.ts`
  DETECTORS and bound it (possessive-style rewrite or a pre-pass length guard on candidate runs).
  Lane-4's test avoids the shape with word-based filler (see vaultTranscribe.test.ts truncation
  test comment).
- **Pre-existing backend tsc errors (30) — identical on main.**
  `pnpm --filter @pikar/backend exec tsc -p . --noEmit` fails with 30 errors in
  skills.test.ts / tenant.test.ts / worm.test.ts / etc. (`import.meta.glob` typing, stale-looking
  index typings). Verified byte-identical error set on the main checkout — pre-existing, not a
  Lane-4 regression. vaultTranscribe.ts / vaultTranscribe.test.ts contribute zero errors.

## Reconciliation (03.8-06 integration, 2026-07-18)

- The `@pikar/pii` quadratic-scanText finding is the SAME root cause reported independently by
  Lanes 1 and 4 — one fix in `packages/pii/src/scan.ts` closes both. Carried forward as a single
  follow-up (not this phase; packages/pii is out of scope for 3.8).
- The pre-existing backend tsc/test reds (audit.test.ts `auditCounts` unregistered,
  worm.test.ts / tenant.test.ts `import.meta.glob` typings) reproduce on `main` and are NOT 3.8
  regressions — excluded from the merged-whole green baseline below.
