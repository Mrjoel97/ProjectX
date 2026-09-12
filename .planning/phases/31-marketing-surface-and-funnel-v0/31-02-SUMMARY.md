---
phase: 31-marketing-surface-and-funnel-v0
plan: "02"
subsystem: marketing
tags: [convex, tenant-isolation, bearer-links, aggregate-counters]
requires:
  - phase: 31-01
    provides: Approved contracts and aggregate-only schema
provides:
  - Native tenant-scoped create/list/deactivate lifecycle
  - Internal atomic fixed-asset resolver with safe integer counters
  - Native generated public/internal API parity
affects: [31-03, 31-05, 31-06, 31-07]
tech-stack:
  added: []
  patterns: [domain-separated token hashes, fixed storage references, fail-closed resolution]
key-files:
  created: [packages/backend/convex/funnels.ts]
  modified:
    - packages/backend/convex/funnels.test.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/marketing.md
key-decisions:
  - Ordinary authenticated tenants manage their own links without platform-owner privileges
  - Source revision or deletion may invalidate original bytes but never repoints an existing link
  - Public link origins require configured HTTPS Convex site hosts; insecure localhost links are unsupported
requirements-addressed: [MKTG-02]
requirements-completed: []
completed: 2026-09-12
---

# Phase 31 Plan 02: Native funnel lifecycle and atomic resolution

Implemented `api.funnels.create`, `list`, `deactivate` and `internal.funnels.resolveAndIncrement`. Creation checks native tenant ownership, ready Vault state and actual storage metadata, generates 32 CSPRNG bytes, and persists only a domain-separated hash. Raw token and three URLs appear only in the creation result. Listing is bounded to 100 safe display rows with `hasMore`; deactivation is idempotent.

The internal transaction accepts only the frozen stage/source contract, resolves the fixed original file, and increments one non-negative safe-integer counter. Unknown, malformed, inactive, missing-asset, unsafe-counter and overflow cases return null without counting. Public source metadata cannot override attribution. No event rows, arbitrary destinations, public contact writes or outbound actions were introduced.

## Qualification

- Native Convex codegen completed with exit 0 after a coordinated source freeze. The initial attempt failed because another lane changed cockpit.ts during bundling; it was not treated as success. Windows package command shims were unavailable, so the installed native CLI was invoked directly with its bundled typecheck disabled and a separate backend TypeScript check completed successfully.
- Generated API contains exactly one funnels import/module entry; tests directly reference all four generated public/internal functions. Coordinated generation also includes the other lane's authoringProbe module.
- Focused native suites: 58 tests passed (11 funnels and 47 isolation). Coverage includes ordinary non-owner creation, foreign-tenant/auth rejection, 32-byte entropy, hash-only persistence, independent and concurrent stage counts, immutable source, missing bytes, overflow, deactivation and trusted URL checks.
- Real `vault.patchCreatedDoc` followed by original-byte cleanup proves invalidation without repointing or extra counts. Real `vault.deleteVaultDoc` proves fail-closed deletion behavior. Existing export/erasure tests retain foreign-tenant controls.
- Backend `tsc --noEmit` passed; focused Biome check passed after formatting.
- Marketing playbook updated. Combined playbook checker presently identifies unrelated concurrent lanes (agent-runtime, dashboard-pages, guardrails, vertical-packs and authoringProbe watch), reported to root for final qualification.
- Bounded graph fixup completed. Existing graph is partial and cannot resolve new authoringProbe references; no full-refresh success is claimed and the previous 14-minute full rebuild was not repeated.

## Remaining gates

Plan 31-03 must add minimal no-store HTTP responses and transport tests; no public route is implemented here. Later UI work needs a bounded downloadable-artifact picker DTO without storage IDs. Final live acceptance must prove redirect bytes and counter deltas on the deployed version. MKTG-02 is not marked complete until those gates pass. Deactivation cannot revoke a previously issued file URL or downloaded bytes.

Root owns atomic commits and global STATE/ROADMAP updates; this lane performed no git commit or deployment.
