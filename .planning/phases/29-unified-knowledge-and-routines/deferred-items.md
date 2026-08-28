# Deferred items (out of scope, logged not fixed)

## From plan 29-03 (2026-08-28)

- **`packages/backend/convex/schema.ts` L112-118 carries a stale claim about its own code.** The
  doc comment above `const knowledgeSource = literals(KNOWLEDGE_SOURCES)` says the Phase-29 unions
  are "kept as literals here rather than derived from that array". They are DERIVED — 29-01's
  round-2 repair replaced the hand-written copies with the `literals(...)` helper and made that
  derivation invariant 20 of `knowledge-search-routines.md`, but left the paragraph arguing for the
  opposite. Pre-existing, not caused by 29-03, and `schema.ts` is the repo's highest-collision file
  with two other plans live in this worktree. Fix: delete the "kept as literals" sentence.

- **`packages/backend/convex/env.test.ts` fails** because `quickbooksAuth.ts` reads
  `QUICKBOOKS_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` and `ENV_MANIFEST` does not classify
  them. Imported from the Phase 28 merge; 28-06 is mid-plan and owns it.

- **`packages/backend/convex/media.test.ts` is LOAD-FLAKY**, like `vaultDigest.test.ts`. "a
  transcript with no usable words never buys a sandbox" failed once inside a full-suite run and
  once in isolation, then passed 3/3 in isolation immediately after. Not touched by 29-03.
