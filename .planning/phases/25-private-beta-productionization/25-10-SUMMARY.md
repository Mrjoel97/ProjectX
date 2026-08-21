---
phase: 25-private-beta-productionization
plan: 10
subsystem: production-readiness
tags: [BETA-01, DLVR-02, environment, domains, owner-admin]
requires:
  - phase: 25-02
    provides: owner-only admin surface
  - phase: 25-09
    provides: intended provider live-gate dependency named by the plan
provides:
  - canonical hosted environment manifest with source drift checks
  - owner-only names-only readiness projection
  - durable-origin validation for generated and OAuth origins
  - accepted ADR-022 durable beta domain posture
affects: [deployment, oauth, unsubscribe, beta-admission, delivery]
tech-stack:
  added: []
  patterns:
    - return missing or invalid environment names only, never values or value fragments
    - distinguish absent configuration from set-but-ephemeral origins
key-files:
  created:
    - packages/backend/convex/lib/env.ts
    - packages/backend/convex/env.test.ts
    - packages/backend/convex/ops.ts
    - docs/playbooks/production-beta.md
    - docs/decisions/022-beta-domain-posture.md
  modified:
    - apps/web/app/(app)/admin/AdminView.tsx
    - packages/backend/convex/isolation.test.ts
    - docs/playbooks/beta-admission.md
key-decisions:
  - "Use ADR-022 because ADR-017 already exists and ADRs are immutable."
  - "Require durable HTTPS origins; do not require every managed platform origin to be custom."
patterns-established:
  - "envCheck.ready requires both no missing required names and no non-durable configured origins."
requirements-completed: []
duration: not-recovered
completed: 2026-08-18
---

# Phase 25 Plan 10: Hosted Readiness Summary

**The owner admin now reports missing hosted configuration names and set-but-ephemeral origins without exposing values, backed by an accepted durable-domain ADR.**

## Performance

- **Duration:** Not recoverable from the historical commits
- **Manifest/readiness:** 2026-08-17T00:20:52+03:00
- **Origin enforcement:** 2026-08-17T01:42:17+03:00
- **ADR acceptance:** 2026-08-18T02:08:33+03:00
- **Tasks:** All three source/decision tasks landed; live deployment qualification did not

## Accomplishments

- Added one tiered `ENV_MANIFEST` and a two-way source drift test.
- Added owner-only `ops.envCheck`, returning names-only missing/warning lists plus non-durable origin names.
- Added `isDurableOrigin` checks for `CONVEX_SITE_URL`, `SITE_URL`, and both OAuth redirect origins; readiness fails on preview/local/plain-HTTP values.
- Recorded durable beta posture in ADR-022 and later changed its status from Proposed to Accepted.

## Task Commits

1. **Hosted manifest, drift checks, owner readiness, and admin UI** — [6bb2c81](https://github.com/Mrjoel97/ProjectX/commit/6bb2c819f22f376331db637d6b9381bef03075d0)
2. **ADR-022 and wired durable-origin enforcement** — [dd484ec](https://github.com/Mrjoel97/ProjectX/commit/dd484ec37cb0769ad47f9a9f74515887d2b4815d)
3. **Owner acceptance of ADR-022** — [36f43b8](https://github.com/Mrjoel97/ProjectX/commit/36f43b81601aad651149e2cde34a793163f2bc44)

No separate plan-metadata completion commit or original summary was found; this summary is reconstructed from the commits and current tree.

## Files Created/Modified

- [`env.ts`](../../../packages/backend/convex/lib/env.ts) — manifest, required tiers, origin names, and pure durability predicate.
- [`env.test.ts`](../../../packages/backend/convex/env.test.ts) — source/manifest drift, owner refusal, value non-disclosure, and origin cases.
- [`ops.ts`](../../../packages/backend/convex/ops.ts) — owner-only readiness projection.
- [`AdminView.tsx`](../../../apps/web/app/(app)/admin/AdminView.tsx) — owner-visible missing/non-durable name lists.
- [`production-beta.md`](../../../docs/playbooks/production-beta.md) — operator contract and live verification ceiling.
- [`022-beta-domain-posture.md`](../../../docs/decisions/022-beta-domain-posture.md) — accepted durable-origin decision.

## Decisions Made

- Required keys determine baseline readiness; optional dark features remain warnings, and active fixture seams are a distinct warning class.
- A fixed managed `*.convex.site` origin can be durable. The requirement is stable HTTPS URLs, not cosmetic custom-domain parity at every platform layer.
- DNS resolution, TLS chains, and registered-provider redirect equality stay live checks; the readiness query does not make network calls.

## Deviations from Plan

### ADR number changed from 017 to 022

ADR-017 already existed and is Accepted. The next free immutable decision number was used.

### The A/B framing was updated to landed reality

ADR-020 already recorded `www.pikar-ai.com` as live. The decision therefore ratified durable deployment posture rather than pretending no user-shareable deployment existed yet.

### “Custom” was narrowed to “durable”

The Convex HTTP-action hostname is managed by Convex and can remain stable without being a repository-configured custom hostname. The implementation blocks ephemeral origins, which is the failure consumed by OAuth and unsubscribe links.

### Deployment evidence was not created

`.planning/phases/25-private-beta-productionization/25-DEPLOY-EVIDENCE.md` does not exist. The source gate cannot establish DNS, TLS, deployed values, provider-console redirects, or a production send.

## Verification Evidence

`6bb2c81` records env 14/14, env + isolation 44/44, backend/web typechecks, Biome, and playbook checks. `dd484ec` records env 18/18, env + isolation 48/48, both typechecks, Biome, and playbook checks. These commands were **not rerun** during this reconstruction.

## Requirements and Live Gates

- `requirements-completed` is deliberately empty. This summary does not certify BETA-01 or DLVR-02.
- No claim is made that the current hosted deployment has every key, durable origin, DNS/TLS, registered redirect, or working provider send.

## Next Phase Readiness

The repository can fail closed on missing or obviously ephemeral hosted configuration. A signed-in owner must still run the readiness check on the intended deployment and record the live infrastructure/provider evidence.

---
*Phase: 25-private-beta-productionization · Plan 10*
*Reconstructed: 2026-08-20*
