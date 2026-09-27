---
phase: 48-business-website-and-landing-page-runtime
plan: 06
status: complete
completed: 2026-09-21
requirements: [SITE-01, SITE-02, LAND-01, LAND-02]
local_evidence_sha256: b8b99b398038b0d8c1b21a481e09a6dbf24e46430d2176d67f34d9af8289bc11
---

# 48-06 Summary — Controlled qualification and honest re-entry

Phase 48 is complete at the repository-controlled/local qualification layer. The protected editor,
immutable preview, anonymous public runtime, lifecycle mutations, forms, metrics, cleanup seams and
claim boundaries were exercised together against one isolated local deployment. No provider,
custom domain, public DNS, mailbox, production traffic or paid model was contacted.

## Acceptance evidence

- The serial Playwright matrix passed 2/2 (setup plus acceptance) in 31.4 seconds against the
  isolated local Convex and production-built web surfaces.
- Both `site` and `landing` shapes passed authenticated create/edit/preview/approve/publish/update,
  stale-CAS refusal, ambiguous-route fail-closed behavior and recovery, rollback, unpublish and
  refresh checks at desktop and mobile widths.
- Anonymous reads returned the exact stored artifact bytes with the declared platform-hosting and
  tenant-content ownership headers. The rendered CTA—not a direct test-only endpoint call—produced
  the raw-request click aggregate.
- Form coverage proved accepted, duplicate, invalid, consent-required, suppressed, rate-limited and
  unavailable outcomes, attribution persistence, bounded idempotency/abuse expiry and deterministic
  fixture cleanup.
- The combined SHA-256 over the named Phase 48 runtime, editor, acceptance and governance artifacts
  is `b8b99b398038b0d8c1b21a481e09a6dbf24e46430d2176d67f34d9af8289bc11`. Git is unavailable in
  this execution environment, so no commit identifier is fabricated.

## Verification

- Core tests: 11/11 passed.
- Backend lifecycle/form/runtime/HTTP tests: 19/19 passed.
- Editor and preview tests: 4/4 passed.
- Core, backend and web TypeScript checks passed.
- The production web build passed and emitted `/dashboard/sites` and
  `/dashboard/sites/preview`.
- Phase 48 claim-guard self-test and actual scan, playbook check, planning check and audit-payload
  self-test passed.
- All 24 repository free gates passed. The root dependency change intentionally changed the
  dependency-bound evaluator identity to
  `2026-09-11.budgeted-evaluator.7a6ea4e538739c639be6dc2d5928bdb17213a21d708bd5874ca4671737dd9d95`;
  its offline self-check passed. This retires older evaluator evidence and does not constitute a
  paid evaluation.

## Claim boundary and re-entry

The legal name remains provisionally `pikar-ai`; jurisdiction, registration number and registered
address remain pending. Custom-domain DNS/TLS, hosting/provider approval and anonymous production
traffic remain Wave 7 work under `docs/releases/phase-48-wave7-reentry.md`. Wave 8 still requires
exact-production founder acceptance. Phase 48 therefore closes the technical/local layer only and
does not claim those external or production layers.
