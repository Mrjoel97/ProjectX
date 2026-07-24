# Playbook: Persona Onboarding & Business Profile

> Last verified: 2026-07-24 against efbf8d3
> Build history: `.planning/phases/11-persona-onboarding-business-profile/` · Related ADRs: [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

The first-run experience: a brand-new user is guided to describe their business
(pasted text, an uploaded file, or a spoken brief), an LLM extracts a structured
Lean-core profile with an inferred persona, the user CONFIRMS it, and the confirmed
profile is stored as a vault document so every downstream agent turn is business-aware.
This is the substrate Phase 12's evaluation engine reads and the reason the cockpit
becomes a chief-of-staff rather than a generic assistant.

## Key files

Pure packages:
- `packages/core/src/businessProfile.ts` — the Convex-free domain module (CLAUDE.md §1): `Persona`
  union, `BusinessProfile` type, `serializeProfile` (deterministic vault-doc markdown), `decideConfirm`
  (the SC#1 always-confirm decision fn), field validators. `packages/core/src/businessProfile.test.ts`
  is its one runnable check.

Skill registry (extraction prompt, §5 — see `skill-registry.md`):
- `packages/contracts/skills/business-profile.md` — canonical extraction prompt body
- `packages/contracts/src/skills/businessProfile.ts` — derived `businessProfileSkillBody` constant
- `packages/contracts/src/skill.ts` — `BUSINESS_PROFILE_SKILL` name const (UNGATED — absent from `GATED_SKILLS`)
- `packages/backend/convex/skills.ts` — `seedSkills[]` row that boots it v1/active

Backend adapter + frontend (created by Waves 2-4 — registered here so the Stop hook protects them):
- `packages/backend/convex/onboarding.ts` — thin adapter: extraction action + commit mutation
- `apps/web/app/(app)/dashboard/onboarding/` — the first-run onboarding flow
- `apps/web/app/(app)/dashboard/profile/` — the profile view/edit page (re-embeds on save)

## Dependencies & blast radius

Run `graphify query "onboarding business profile"` for the live subgraph. Couplings graphify
cannot see:

- **Extraction skill must be seeded active** — `loadSkill(ctx, BUSINESS_PROFILE_SKILL)` fails closed
  (`NO_ACTIVE_SKILL`) on a deployment that was not seeded. `seedSkills` boots it v1/active.
- **Profile-as-vault-doc** — the confirmed profile is persisted through the SAME vault ingestion path
  as any other doc (`kind: "business_profile"`), so it flows into GraphRAG grounding with zero schema
  migration. Depends on the vault subsystem (`vault.md`) staying the single ingest choke point.
- **Phase 12 eval engine reads the Lean-core field names** — renaming a `BusinessProfile` field is a
  breaking contract change for the downstream evaluator; anchor field names, do not churn them.

## Data flow

1. **Intake** — user pastes text / uploads a file / speaks a brief in `dashboard/onboarding/`.
2. **Extract** — the onboarding adapter calls the LLM with `businessProfileSkillBody`; the model emits
   the Lean-core fields INCLUDING an inferred persona (`solopreneur | startup | sme`).
3. **Confirm (SC#1)** — `decideConfirm` returns `needsConfirm: true` for EVERY inference; the extracted
   fields pre-fill a review card the user edits and explicitly confirms. No path auto-commits a persona.
4. **Serialize + persist** — `serializeProfile` renders deterministic markdown; the commit mutation
   stores it as a `business_profile` vault doc (persistBrief-style clone) which ingests to `ready`.
5. **Ground** — thereafter `searchVault` surfaces the profile, making agent turns business-aware.

## Invariants — what must never break

- **Persona is ALWAYS confirmed, never assumed (SC#1)** — `decideConfirm` returns `needsConfirm: true`
  unconditionally; no branch yields an auto-committed persona. Enforced by `businessProfile.test.ts`.
- **Enterprise is not an emittable persona** — the `Persona` union is exactly `solopreneur | startup | sme`;
  the validator rejects `"enterprise"`. Enforced by `businessProfile.test.ts`.
- **The domain module is Convex-free (CLAUDE.md §1)** — `businessProfile.ts` imports no Convex, no network;
  it is pure and portable. The backend `onboarding.ts` adapter is the only place it meets the DB.
- **§4 redaction boundary (SC#4)** — `audit` / `telemetry` / `deadLetters` payloads written during
  onboarding carry refs / hashes / ids / counts ONLY — never a profile field value or intake prose.
  Redact-then-write. Enforced by `profileRedaction.test.ts` (Wave 2+).
- **The extraction skill is UNGATED and SEPARATE from the gated cockpit-agent** — editing
  `business-profile.md` never touches the cockpit-agent body, and it activates v1 without an eval gate
  (its output is a vault document a human confirms, not autonomous tool-state — same rationale as
  `voice-brief`). Do NOT add it to `GATED_SKILLS`.
- **First-run gate lives in the client `AppShell`, never `middleware.ts`** — the redirect into
  `/dashboard/onboarding` is client-side `<Authenticated>` + `useQuery` routing. Adding it to
  `middleware.ts` would run it on the edge without the tenant/profile query and break resumability.

## How to change safely

- **Add/rename a Lean-core field** — edit `BusinessProfile` + `serializeProfile` + `validateProfile`
  together and update `businessProfile.test.ts`'s serializer-equality fixture; then check the Phase 12
  eval engine still reads the field it expects (breaking rename = coordinate with the evaluator).
- **Change the extraction prompt** — it is a NON-gated skill: edit the canonical
  `contracts/skills/business-profile.md`, regenerate the derived `businessProfileSkillBody` constant
  byte-identically, re-seed. `seedSkills` publishes-and-activates automatically. See `skill-registry.md`.
- **Touch the commit/adapter path** — keep redaction BEFORE the write (SC#4) and keep `decideConfirm`
  as the only persona-commit gate (SC#1). Re-run `profileRedaction.test.ts` + `onboarding.test.ts`.

## How to verify

- `pnpm --filter @pikar/core test -- businessProfile` — pure schema + always-confirm decision + serializer
  roundtrip + enterprise-not-emittable (SC#1). ~5s, no deployment needed.
- `pnpm --filter @pikar/backend test -- onboarding` — commit→ingest→retrieve + tenant isolation
  (SC#2/#3), convex-test. Wave 2+.
- `pnpm --filter @pikar/backend test -- profileRedaction` — §4 audit/telemetry/DLQ scan (SC#4). Wave 2+.
- `node scripts/check-playbooks.mjs` — this playbook covers its watched paths.
- Manual first-run/resumability/review-card checks: see `11-VALIDATION.md` § Manual-Only Verifications.

## Operational notes

- Seed dependency: a fresh deployment must run `seedSkills` (local `convex dev --run skills:seedSkills`,
  prod `npm run seed`) or the extraction action dead-letters `NO_ACTIVE_SKILL: business-profile`.
- The profile vault doc reuses the vault ingest smoke seam (`SMOKE::<docId>`) for offline tests.

## Known gaps & deferred work

- **Names-in-prose PII ceiling** (shared S1/S4 open item): `packages/pii` scrubs STRUCTURED PII only;
  grounded business-profile prose containing person names must stay out of exportable/WORM tables until
  the NER spike resolves. `ponytail:` upgrade path = Presidio/NER before any multi-user export.
- Backend adapter, onboarding UI, and profile page are Wave 2-4 work — their watched paths are
  registered here now so the Stop hook does not block those plans; the sections above describe the
  contract they must satisfy.
