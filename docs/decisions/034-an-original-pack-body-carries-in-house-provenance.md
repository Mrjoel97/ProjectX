# ADR-034: An original pack body carries in-house provenance, held to the vendor shape

- **Status**: **Accepted** — 2026-09-06.
- **Supersedes**: nothing. Extends the pack activation gate that 27-08 (PACK-01/PACK-03) shipped.
- **Does NOT supersede**: the pack gate's three evidence planes (eval evidence against the exact
  fixture file, authenticated multi-viewport browser evidence, provenance pinned to the exact
  `(name, version)`), the vendor manifest parity (`knowledgeWorkProvenance.test.ts`), or CLAUDE.md
  §5 (no hardcoded prompts — a pack body is a registry row).
- **Evidence**: `.planning/phases/35-outcome-language-and-the-idea-stage-artifact/35-RESEARCH.md`;
  `packages/core/src/workflowPacks.ts` (`PACK_PROVENANCE_LICENSES`, `hasValidPackProvenance`);
  `packages/contracts/src/skills/knowledgeWorkProvenance.ts` (`IN_HOUSE_PACK_PROVENANCE`);
  `packages/backend/convex/skills.ts` (`packProvenanceFor`); the two test files beside them.

## Context

Every Phase 27 workflow pack body was adapted from Anthropic's `knowledge-work-plugins` (Apache-2.0),
so the gate's provenance plane was written for exactly that: `hasValidPackProvenance` required
`license === "Apache-2.0"`, a 40-hex upstream commit, upstream paths, the LF hash of the canonical
`.md`, a §4(b) modification notice and the version pin; `packProvenanceFor` read the record from a
code-owned mirror of the vendor manifest, and a test pins that mirror to the manifest key-for-key.

G23 (rev-5 audit, Track B step 8) asked for an idea-stage artifact — one document, the offer plus a
30-day lead plan — and the owner ruled it ships as a seventh pack **through the pack gate**, not as
an `active v1` seed. That body is original: its method is Pikar's own `offer-architect` and
`lead-engine` specialist bodies. It has no vendor row, so as written the gate could never accept it.

## Options

1. **Seed it `active v1`** (`SEEDS`, the new-name branch). Live at once, un-evaluated, no browser
   evidence, no provenance. Rejected by the owner: the whole point of the gate is that no pack body
   reaches a tenant without measured evidence, and the first original body is the worst one to
   exempt.
2. **Give it vendor-shaped provenance anyway** — the vendor repo and commit, with a notice saying
   "not actually adapted". Passes the predicate; lies in an immutable row. Rejected.
3. **A closed licence set, same shape, second record.** `license` becomes one of
   `["Apache-2.0", "Pikar-original"]`; every other field keeps its rule. The in-house record pins a
   commit of THIS repository (the one at which the two method bodies last changed), their in-repo
   paths, the body hash and a notice, and lives in `IN_HOUSE_PACK_PROVENANCE` beside the vendor
   mirror rather than inside it, so the manifest parity test stays exact. `packProvenanceFor` reads
   the vendor record first and the in-house record second; `ts` is the pinned commit's timestamp
   for the same no-clock reason the vendor `pinnedAt` exists (the seeder's idempotency depends on
   provenance being a pure function of the material).

## Decision

Option 3. An original pack body is **not exempt from provenance**; it is held to the identical shape
with the repository it came from substituted for the vendor's.

## Consequences

- The gate's strictness is unchanged: the same three planes, the same version pin, the same 40-hex
  and 64-hex requirements. Only the licence check widened, to a closed two-element set.
- `scripts/verify-knowledge-work-provenance.mjs --check` covers the vendor snapshot and does not
  read `IN_HOUSE_PACK_PROVENANCE`. The bytes-level check for an original body is the contracts test
  ("pinned to its own body, an exact commit and existing paths"), which hashes the `.md` on disk.
- `THIRD_PARTY_NOTICES.md` is untouched — nothing third-party was added. A future original pack adds
  one record here and one row in `skillBodies.test.ts`; nothing else in the gate moves.
- The in-house `sourceCommit` is a fact about where the METHOD came from, not a claim that the pack
  body existed at that commit; the notice says so.
