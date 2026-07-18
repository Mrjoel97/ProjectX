# Deferred items (out-of-scope discoveries)

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
