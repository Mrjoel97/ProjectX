---
phase: 11-persona-onboarding-business-profile
plan: 02
subsystem: onboarding
tags: [business-profile, vault-doc, embed, tenant-isolation, redaction, convex-adapter]

# Dependency graph
requires:
  - phase: 11-persona-onboarding-business-profile
    plan: 01
    provides: "@pikar/core businessProfile (Persona, BusinessProfile, serializeProfile, validateProfile) + UNGATED business-profile extraction skill seeded v1/active"
  - phase: 10-vault-grounding
    provides: "vaultGroundHydrated SMOKE:: retrieval seam + startIngest ingest spine + ownedDocsMeta tenant-scope"
  - phase: 06-live-voice
    provides: "persistBrief template (vault-doc-from-agent clone) reused verbatim for commitProfile"
provides:
  - "onboarding.ts thin adapter (§1): status (first-run gate), extractProfile (SC#1 no-auto-commit), commitProfile + updateProfile (persistBrief clone → startIngest, embed + re-embed)"
  - "profileRedaction.test.ts — the SC#4 log-plane sentinel scan (audit/telemetry/deadLetters)"
  - "onboarding.test.ts — SC#1/#2/#3 backend coverage via the offline SMOKE seam"
affects: [profile-page, first-run-onboarding-ui, phase-12-evaluation-engine, vault-grounding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The profile is 'just another vault doc' — embed + tenant scope + retrieval come FREE from startIngest / vaultGroundHydrated; the only new work is the extraction call + the §4-safe audit"
    - "Default-runtime V8 adapter co-locating query+mutation+action, jsonSchema (not zod) + explicit Promise<...> returns — the vaultLlm precedent that dodges the node internal-graph inference cliff (llm.ts stays the ONE node module)"
    - "updateProfile re-embeds IN PLACE: delete the stale rag entry (clean replace) → patch text/hash/size → reset to processing → re-ingest, keeping a stable one-doc-per-tenant profile id"

key-files:
  created:
    - packages/backend/convex/onboarding.ts
    - packages/backend/convex/onboarding.test.ts
    - packages/backend/convex/profileRedaction.test.ts
  modified:
    - docs/playbooks/onboarding.md

key-decisions:
  - "extractProfile is a tenantAction that RETURNS the object and writes nothing (no doc, no audit) — SC#1 (confirm-not-assume) is structural: the only write path is the separate human-confirmed commitProfile"
  - "updateProfile re-embeds in place (delete old rag entry + patch + re-ingest) rather than delete+re-commit — keeps a stable profile doc id and stays in-scope (no vault.ts / vault-playbook change); graph-edge GC of the prior version is a named ponytail ceiling"
  - "SMOKE::profile:: extraction seam + the existing SMOKE::<docId> retrieval seam keep the entire suite offline (no OPENAI_API_KEY, no embedding network); durable ingest steps stay pending (row at 'processing') exactly as the voice precedent documents"

patterns-established:
  - "Onboarding audit contract: commitProfile/updateProfile each emit ONE insert-only audit event with payload {vaultDocId, fieldCount, personaConfirmed[, reembed]} — refs/counts/booleans only (§4)"

requirements-completed: [ONBD-01, ONBD-02]

# Metrics
duration: 11min
completed: 2026-07-24
---

# Phase 11 Plan 02: Onboarding Adapter (embed + retrieve + redaction) Summary

**The thin Convex adapter (§1) that turns intake text into a committed, embedded, tenant-scoped business profile — reusing the persistBrief → startIngest spine verbatim, so embed/tenant-scope/retrieval come free and the only new work is the extraction call and the §4-safe audit.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-24T15:44:40Z
- **Completed:** 2026-07-24T15:55:59Z
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `status` (tenantQuery) is the ONBD-01 first-run gate: `needsOnboarding` is true until a non-`failed` `business_profile` vault doc exists — refs/booleans only, tenant-scoped (another tenant's profile never satisfies this tenant's gate).
- `extractProfile` (tenantAction) loads the UNGATED business-profile skill (§5, fails closed unseeded), runs `generateObject`, and returns the Lean-core object incl. a best-fit persona to the CALLER ONLY — it inserts no doc and writes no audit (SC#1 is structural, backstopped by a no-auto-commit test).
- `commitProfile` (tenantMutation) is the persistBrief clone: `validateProfile` gate → `serializeProfile` → insert `kind:"business_profile"` vault doc → `startIngest`. The committed profile is retrievable via the offline SMOKE seam (SC#2) and a foreign tenant gets nothing (SC#3).
- `updateProfile` (tenantMutation) re-embeds in place (deletes the stale rag entry, resets to `processing`, re-ingest) so grounding stays current; a no-throw first commit when none exists yet.
- SC#4 landed as a structural scan: `profileRedaction.test.ts` drives a commit + edit with a sentinel in every field and asserts NO sentinel/prose reaches any audit/telemetry/deadLetters payload — with a counterweight test proving the vault-row content is NOT over-redacted.

## Task Commits

1. **Task 1: status gate + extractProfile (SC#1 no-auto-commit)** — `03e1f76` (feat)
2. **Task 2: commitProfile + updateProfile — persistBrief clone, embed + re-embed (SC#2/#3)** — `87f143d` (feat)
3. **Task 3: §4 redaction scan (SC#4) + onboarding playbook bump** — `c1576a2` (test)

_Tasks 1 & 2 were TDD: the functions did not exist before their tests, and each was verified green after implementation (6 → 12 tests). Committed as feat commits since the failing-first step was confirmed in-flight._

## Files Created/Modified
- `packages/backend/convex/onboarding.ts` — thin adapter (§1): `status`, `extractProfile`, `commitProfile`, `updateProfile` + shared `writeProfileDoc`/`currentProfileDoc` helpers. Default-runtime V8, jsonSchema, §2 wrappers, SMOKE::profile:: seam.
- `packages/backend/convex/onboarding.test.ts` — 12 tests: status gate (fresh/failed/tenant-scoped), extract-returns-persona + no-auto-commit + fail-closed, SC#2 commit→ingest→retrieve, SC#3 cross-tenant empty, in-place re-embed, first-commit-via-update, §4 audit refs-only, invalid-profile reject.
- `packages/backend/convex/profileRedaction.test.ts` — 2 tests: SC#4 sentinel-in-every-field log-plane scan + content-plane counterweight.
- `docs/playbooks/onboarding.md` — `Last verified` bumped to 87f143d; backend adapter marked LIVE with the concrete surface; §4 invariant + verify section reflect the shipped commitProfile/updateProfile audit contract.

## Decisions Made
- **extractProfile writes nothing** — SC#1 (confirm-not-assume) is structural: an action that only returns cannot auto-commit, and the object never enters an audit payload (§4). The sole write path is the separate, explicit `commitProfile`.
- **updateProfile re-embeds in place** — delete old rag entry + patch + re-ingest, keeping a stable one-doc-per-tenant profile id and staying strictly in-scope (no `vault.ts` / vault-playbook change). Graph-edge GC of the prior version is a named `ponytail:` ceiling (upgrade path = route through `vault.deleteVaultDoc`'s full cascade if profile-graph staleness ever matters).
- **Fully offline test suite** — `SMOKE::profile::` extraction seam + the existing `SMOKE::<docId>` retrieval seam, so no `OPENAI_API_KEY` and no embedding network; durable ingest steps stay pending (row at `processing`) exactly as the voice precedent documents.

## Deviations from Plan

None — plan executed as written. The plan's own `ponytail:` note on updateProfile (patch-vs-delete) was resolved to patch-in-place-with-rag-delete after confirming rag keys on `contentHash` (a naive patch would orphan the old entry); this is the plan's explicit "pick the smaller correct path" instruction, not a deviation.

## Issues Encountered
- convex-test emits benign background stderr ("Component rateLimiter is not registered") when the ingest workflow the commit arms tries to advance a step. This is intentional and matches the voice precedent: the unregistered rate-limiter fails the durable step FAST (no network, keeps the suite ~offline and quick), and the row stays at `processing` — the assertions run synchronously before any step completes. No content-bearing rows are written, so SC#4 is unaffected.
- Backend `tsc --noEmit` reports the known pre-existing test-file gaps (withIndex/import.meta.glob typing) — zero errors in `onboarding.ts` or in the new test files' source (grep-verified clean).

## User Setup Required
None — a fresh deployment must run `seedSkills` to boot the business-profile skill (already covered by the skill-registry fresh-deploy checklist; `extractProfile`/`commitProfile` fail closed with `NO_ACTIVE_SKILL` until then).

## Next Phase Readiness
- Wave 3-4 (onboarding UI + profile page) has its full backend contract: `status` gate, `extractProfile` for the review card, `commitProfile`/`updateProfile` for confirm/save. The frontend wires those four functions; no further backend work is needed for the first-run flow.
- Phase 12 eval engine can read committed `business_profile` vault docs (grounded, tenant-scoped) as its business-awareness substrate.
- Carried ceiling: names-in-prose PII (grounded profile prose must stay out of exportable/WORM tables until the NER spike resolves — unchanged from 11-01, recorded in onboarding.md Known gaps + STATE blockers).

---
*Phase: 11-persona-onboarding-business-profile*
*Completed: 2026-07-24*

## Self-Check: PASSED

- All 3 created files + the modified playbook verified present on disk.
- All 3 task commits verified in git history (03e1f76, 87f143d, c1576a2).
- 14 backend tests green (onboarding 12 + profileRedaction 2); importGuard (§2) + auditImmutability (§3) + check-playbooks (§9) all pass.
