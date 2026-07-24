---
phase: 11-persona-onboarding-business-profile
verified: 2026-07-24T21:15:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 11: Persona Onboarding & Business Profile Verification Report

**Phase Goal:** A guided first-run onboarding identifies the user's persona and captures their
business/idea into a structured, indexed business profile in the vault — the grounded substrate
the evaluation engine and flagship workflow read.
**Verified:** 2026-07-24
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A first-run gate (client-side, not middleware) redirects un-onboarded tenants to `/dashboard/onboarding` | ✓ VERIFIED | `apps/web/app/(app)/layout.tsx:77-90` — `useQuery(api.onboarding.status)` inside `<Authenticated>` Shell, `router.replace(ONBOARDING_PATH)` when `needsOnboarding && !onOnboarding`; no `middleware.ts` change |
| 2 | Persona is one of solopreneur\|startup\|sme; enterprise not emittable | ✓ VERIFIED | `packages/core/src/businessProfile.ts:10-17` `PERSONAS`/`isPersona`; `onboarding.ts:56,83` union-locked at both the mutation arg validator and the `generateObject` json-schema enum; `businessProfile.test.ts` asserts enterprise rejected (16 tests green) |
| 3 | Persona is always confirmed, never auto-committed (SC#1) | ✓ VERIFIED | `decideConfirm` always returns `{needsConfirm:true}` (core); `extractProfile` (onboarding.ts:153-175) only returns the object, writes no doc/audit; onboarding page shows "Looks like you're a [persona] — confirm or change" one-tap control (`page.tsx:406-438`); commit is the sole write path |
| 4 | Intake (pasted/file/spoken) → extractProfile → confirm → commitProfile stores an embedded, indexed `business_profile` vault doc (SC#2) | ✓ VERIFIED | `onboarding/page.tsx` implements all three intake modalities (compose box, Dropzone upload+poll, MediaRecorder+upload+poll) all reducing to `intakeText`→`extractProfile`; `commitProfile` (onboarding.ts:265-282) inserts `kind:"business_profile"` row + `startIngest`; `onboarding.test.ts` SC#2 test retrieves via SMOKE seam |
| 5 | Profile is tenant-scoped (SC#3) | ✓ VERIFIED | `onboarding.test.ts:199` "cross-tenant: tenant B never retrieves tenant A's committed profile" green; `status`/`getProfile`/`commitProfile`/`updateProfile` all use `tenantQuery`/`tenantMutation` (§2) scoped by `ctx.tenantId` |
| 6 | Editable via `/dashboard/profile`; save re-embeds (SC#3 continuity) | ✓ VERIFIED | `apps/web/app/(app)/dashboard/profile/page.tsx` loads `api.onboarding.getProfile`, saves via `api.onboarding.updateProfile`; `writeProfileDoc` (onboarding.ts:198-240) deletes stale rag entry then re-ingests in place; `onboarding.test.ts:215` re-embed test green; nav link present (`layout.tsx:142-149`) |
| 7 | Onboarding audit/telemetry/DLQ payloads carry refs/counts/booleans only, never profile prose (SC#4) | ✓ VERIFIED | `profileRedaction.test.ts` — sentinel-in-every-field scan across audit/telemetry/deadLetters, green; `commitProfile`/`updateProfile` audit payload is literally `{vaultDocId, fieldCount, personaConfirmed[, reembed]}` |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/businessProfile.ts` | Pure profile module: Persona, BusinessProfile, decideConfirm, serializeProfile/deserializeProfile, validateProfile | ✓ VERIFIED | 180 lines, Convex-free; 16 unit tests green |
| `packages/core/src/businessProfile.test.ts` | SC#1 always-confirm + enterprise-not-emittable + serializer roundtrip | ✓ VERIFIED | 16 tests green (incl. serialize/deserialize round-trip, sparse-start rule) |
| `packages/contracts/src/skills/businessProfile.ts` + `packages/contracts/skills/business-profile.md` | Extraction prompt body, §5 (no hardcoded prompt) | ✓ VERIFIED | Canonical `.md` + byte-identical derived `.ts`, drift-tested in `skills.test.ts` |
| `packages/contracts/src/skill.ts` | `BUSINESS_PROFILE_SKILL` const, NOT in `GATED_SKILLS` | ✓ VERIFIED | Line 65 defines the const; `GATED_SKILLS` (line 79-84) does not include it |
| `packages/backend/convex/skills.ts` | seedSkills[] row for business-profile | ✓ VERIFIED | Line 254: `{ name: BUSINESS_PROFILE_SKILL, body: businessProfileSkillBody }` |
| `packages/backend/convex/onboarding.ts` | status/extractProfile/commitProfile/updateProfile/getProfile thin adapter | ✓ VERIFIED | 314 lines; uses `tenantQuery/tenantMutation/tenantAction` (§2); no raw generated-server imports |
| `packages/backend/convex/onboarding.test.ts` | SC#1/#2/#3 backend coverage | ✓ VERIFIED | 12 tests green (status gate, no-auto-commit, embed+retrieve, cross-tenant isolation, re-embed, audit refs-only, invalid-profile reject) |
| `packages/backend/convex/profileRedaction.test.ts` | SC#4 scan | ✓ VERIFIED | 2 tests green (sentinel scan + content-plane counterweight) |
| `apps/web/app/(app)/layout.tsx` | First-run gate in client shell + nav link | ✓ VERIFIED | Gate at lines 77-90; "Business Profile" rail-foot link at lines 142-149 |
| `apps/web/app/(app)/dashboard/onboarding/page.tsx` | Conversational intake → review card → commit | ✓ VERIFIED | 554 lines; three intake modalities, persona confirm, sparse-start-consistent `requiredFilled`, localStorage draft resumability |
| `apps/web/app/(app)/dashboard/profile/page.tsx` | Editable profile page, save re-embeds | ✓ VERIFIED | 271 lines; `getProfile`/`updateProfile` wired; `requiredFilled` mirrors sparse-start rule |
| `docs/playbooks/onboarding.md` | Onboarding subsystem playbook, watched paths registered | ✓ VERIFIED | Exists, `Last verified: 2026-07-24`; `docs/playbooks/watch.json` registers all four prefixes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `layout.tsx` | `api.onboarding.status` | `useQuery` + redirect | ✓ WIRED | `onboarding?.needsOnboarding` drives `router.replace` |
| `onboarding/page.tsx` | `api.onboarding.extractProfile`/`commitProfile` | `useAction`/`useMutation` | ✓ WIRED | Both called with correct args, results drive UI state |
| `onboarding.ts` | `startIngest`/`vaultDocuments` | insert `kind:business_profile` then `startIngest` | ✓ WIRED | `writeProfileDoc` (persistBrief clone) |
| `onboarding.ts` | `@pikar/core businessProfile` | `serializeProfile`/`deserializeProfile`/`validateProfile` | ✓ WIRED | Imported and used at both write and read boundaries |
| `onboarding.ts` | `internal.skills.getActiveSkill` | load `BUSINESS_PROFILE_SKILL` body | ✓ WIRED | `extractProfile` loads skill before every call (incl. SMOKE path, fail-closed if unseeded) |
| `onboarding.ts` | `internal.audit.log` | refs/counts-only payload | ✓ WIRED | `commitProfile`/`updateProfile` each emit one insert-only event |
| `profile/page.tsx` | `api.onboarding.updateProfile` | `useMutation` on save | ✓ WIRED | Re-embed confirmed by `onboarding.test.ts` re-embed assertion |
| `skills.ts` | `packages/contracts/src/skills/businessProfile.ts` | import `businessProfileSkillBody` | ✓ WIRED | Line 29 import, line 254 seed row |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| ONBD-01 | 01, 02, 03 | Guided first-run onboarding identifies persona (solopreneur/startup/SME), enterprise deferred | ✓ SATISFIED | Persona union locked, always-confirm SC#1 structural, client-shell gate live |
| ONBD-02 | 01, 02, 03, 04 | Business/idea intake (files/pasted/spoken) → structured, indexed business profile | ✓ SATISFIED | All three modalities implemented, extractProfile→commitProfile→embed pipeline live, editable via profile page with re-embed |

No orphaned requirements — REQUIREMENTS.md maps only ONBD-01/ONBD-02 to Phase 11, and both are claimed and satisfied across the four plans.

### Anti-Patterns Found

None blocking. No TODO/FIXME/placeholder markers, no stub returns, no empty handlers in any of the phase's key files (`onboarding.ts`, `businessProfile.ts`, `onboarding/page.tsx`, `profile/page.tsx`, `layout.tsx`).

Design decision confirmed as intentional (not a gap): **sparse-start**. `validateProfile`'s `REQUIRED_STRINGS` is `["oneLineDescription"]` only; persona is validated separately; name/stage/offering/targetCustomer are optional. Both the onboarding page's `requiredFilled` (`!!profile && profile.oneLineDescription.trim() !== ""`) and the profile page's identical mirror are consistent with this — no full-required-fields regression present.

### Test Results

- `pnpm --filter @pikar/core test -- businessProfile`: 16/16 green (part of 168/168 core suite).
- `pnpm --filter @pikar/backend test`: 462/463 green. The single failure (`convex/audit.test.ts` — `Component "auditCounts" is not registered"`) is the pre-existing, unrelated test-harness flake logged in `deferred-items.md`; confirmed out of scope for Phase 11 (audit.test.ts untouched by any Phase 11 plan). `onboarding.test.ts` (12/12) and `profileRedaction.test.ts` (2/2) both green.
- `pnpm --filter @pikar/web exec tsc --noEmit`: clean.
- `node scripts/check-playbooks.mjs`: passes (no output = pass).

### Human Verification Required

None outstanding — both plan-03 and plan-04 human-verify checkpoints were already run and approved during execution (documented in 11-03-SUMMARY.md and 11-04-SUMMARY.md).

### Gaps Summary

No gaps found. All observable truths verified against the live codebase (not just SUMMARY claims): the first-run gate is client-side per the ONBD-01 constraint, persona is structurally confirm-only, all three ONBD-02 intake modalities exist and wire to `extractProfile`, `commitProfile`/`updateProfile` embed/re-embed through the shared vault ingest spine with tenant isolation and §4-safe audit payloads, and the profile page closes the editability loop with a working nav link. The sparse-start relaxation (discovered and fixed during plan 03's human-verify) is a deliberate, requirement-aligned design decision correctly propagated through validateProfile, serializeProfile/deserializeProfile, and both UI forms — not a regression.

---

*Verified: 2026-07-24*
*Verifier: Claude (gsd-verifier)*
