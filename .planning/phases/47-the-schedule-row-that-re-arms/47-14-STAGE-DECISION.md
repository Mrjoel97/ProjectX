---
stage: build-for-evidence
status: accepted
adrPath: docs/decisions/050-recurrence-build-for-evidence.md
adrSha256: 5872061c0c2ffa2a1e481116f884af08ac26aa3dc94856a51f451bad236a3303
reviewer: owner
reviewedAt: 2026-09-24
expiresAt: 2026-12-31
environment: isolated-test
candidateFiles: [packages/backend/candidate/recurrence/schema.ts, packages/backend/candidate/recurrence/model.ts, packages/backend/candidate/recurrence/model.test.ts, packages/backend/candidate/recurrence/tsconfig.json, packages/backend/candidate/recurrence/vitest.config.mts, packages/backend/candidate/recurrence/README.md]
tenantActivation: disabled
productionDeployment: forbidden
providerCalls: forbidden
paidCalls: forbidden
externalWrites: forbidden
externalSends: forbidden
---

# Wave 6 build-for-evidence stage decision

The owner accepted the exact ADR-050 draft on 2026-09-24. On 2026-09-25, separate technical review accepted the exact six-file inventory listed in frontmatter after an isolated `convex-test` harness probe and source-boundary review. Those six files now exist only as a disabled synthetic candidate outside the configured production Convex functions root and app imports; [post-build technical review](47-16-TECHNICAL-REVIEW.md) records their bounded tests and remaining gaps. This stage does not provide live evidence or activate product behavior. The historical 29 decision remains `defer` for the operational product, and the pinned manual rerun remains the only user path.

No tenant/public activation, production deployment or migration, provider/paid call, external write or send is permitted. Plan 47-16 created and tested only the six isolated candidate files, with synthetic tenants and stubbed providers, followed by a separate post-build source/reachability review. Feature flags alone are insufficient. Expiry or a failed isolation, spend, approval, audit or live-evidence review returns this stage to `defer`; it does not silently renew. ADR-046 D6's pending scheduled-function cancellation remains unresolved by a sweep-only candidate.

This artifact does not supply live evidence or `enable-safe`. [Prior technical review](47-14-TECHNICAL-REVIEW.md) records the empty-inventory baseline; [inventory review](47-15-ISOLATION-REVIEW.md) records the six-path feasibility and D6 limit. Negative stage mutations cover absent/malformed/unaccepted/expired artifacts; unknown/duplicate fields; changed ADR identity; omitted, duplicated or extra candidate paths; and broadened tenant, production, provider, paid and outbound declarations. The structural checker refuses unlisted candidate files, production/app imports, callable/scheduler and outbound primitives. These checks and the post-build source review support only an isolated disabled candidate, not production reachability or live proof.
