# Playbook: Persona Onboarding & Business Profile

> Last verified: 2026-07-26 — Phase 15.1 Wave 0 (plan 15.1-01): the tier stopped being a guess. `businessProfile.ts` gained the fact-derived tier surface (`TierFacts`/`deriveTier`/`TIER_REASON`, the closed `REVENUE_STAGES`/`FUNDING_STATES`/`TIERS`/`TIER_SOURCES`/`BEHAVIOR_PRESETS` unions, the `REQUIRED_SLOTS` completion gate, `sanitizeAgentName`) — see "Tier derivation" below. Nothing on the Phase-11 write path changed yet: `decideConfirm`, `validateProfile`, `serializeProfile`, `deserializeProfile` and the `persona` argument are all byte-identical (plan 15.1-03 owns that surgery). Prior: 2026-07-25 — upload `accept` now lists EXTENSIONS alongside the MIME types (`.txt,.md,.markdown,.csv`). Chrome resolves an `accept` MIME type to extensions through the OS registry, and Windows has no entry for `text/markdown`, so the MIME-only list rendered `.md` files invisible in the picker — the folder simply looked empty, with no error to explain it. Prior: 2026-07-24 against 11-04 (editable profile page + re-embed on save; getProfile/deserializeProfile edit-form loader)
> Build history: `.planning/phases/11-persona-onboarding-business-profile/`, `.planning/phases/15.1-fact-derived-tier-conversational-onboarding/` · Related ADRs: [003](../decisions/003-skill-registry-for-prompts.md)

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
  union, `BusinessProfile` type, `serializeProfile` (deterministic vault-doc markdown) + its inverse
  `deserializeProfile` (parses the committed markdown back to structured fields — the profile page's
  edit-form loader; there is NO separate structured copy, the markdown IS the record), `decideConfirm`
  (the SC#1 always-confirm decision fn), field validators. `packages/core/src/businessProfile.test.ts`
  is its one runnable check (incl. the serialize↔deserialize round-trip).

### Tier derivation (Phase 15.1, design §5) — same file, `businessProfile.ts`

The tier is **derived from facts, never asked for and never guessed from prose**. All of it is pure
TS in `businessProfile.ts`, unit-tested in `businessProfile.test.ts`:

- **Closed unions** — `REVENUE_STAGES` (`pre-revenue` | `early-revenue` | `steady-revenue`),
  `FUNDING_STATES` (`bootstrapped` | `seeking` | `funded`), `TIER_SOURCES`
  (`derived` | `confirmed` | `admin` | `legacy`), `BEHAVIOR_PRESETS` (`direct` | `coaching` |
  `concise`). Owner decision Q7: these are literals, never free strings — a free string here
  reintroduces the string-matching defect class 15.1 exists to close.
- **Two tier types of deliberately different width** — `DerivedTier` (= `Persona`, three members) is
  what `deriveTier` returns; `Tier`/`TIERS` (four members, `enterprise` included) is what the TABLE
  can hold. D6 ("enterprise is never derived") is therefore a TYPE property, not a review note; a
  `@ts-expect-error` in the test file fails the BUILD if the return type is ever widened.
- **`deriveTier(facts)`** — `paidStaff === 0 && headcount <= 2` ⇒ `solopreneur`; else not
  (`steady-revenue` and `bootstrapped`) ⇒ `startup`; else ⇒ `sme`. Branch ORDER is load-bearing (the
  solo test runs first, so a pre-revenue one-person business is a solopreneur, not a startup).
  Thresholds are the design doc's defaults and are a **product call** — retune by editing
  `TIER_BOUNDARY_TABLE` in the test plus the two comparisons, **never** by adding a config row (a
  DB-tunable threshold makes the tier DB-writable by proxy, which D2 forbids).
- **`yearsOperating` is captured but unused by the rule** — design §4.1 names it a tier fact and the
  conversation asks it; a test pins the current contract so nobody "fixes" the omission by accident.
- **`TIER_REASON`** — the read-only reason the profile page renders next to the tier (design §9). A
  `satisfies Record<Tier, string>` table, not a switch: a new tier without a reason is a compile error.
- **`REQUIRED_SLOTS` / `missingSlots` / `canComplete`** — the design §6 completion gate. `0` is an
  ANSWER (`headcount: 0`, `paidStaff: 0`, `yearsOperating: 0` all count as PRESENT); a truthiness
  check here would re-ask a solo founder forever. An off-union enum value is MISSING, never admitted.
- **`sanitizeAgentName`** — 40-char cap, `\p{C}` (Cc + Cf) stripped, whitespace collapsed, trimmed
  after the cap. This string rides into a model system prompt in plan 15.1-05, so it is a trust
  boundary: no newline means a name cannot open a fake instruction block.

### Tier control plane — `tenantProfiles` (Phase 15.1, design §4.1)

`packages/backend/convex/schema.ts` → `tenantProfiles`, indexed `by_tenant`. **One row per tenant.**
A new table, not a column: there is no `tenants` table (tenancy is a `tenantId: string` column on
every row), so this was the only option. Adapter: `packages/backend/convex/tenantProfile.ts` (plan
15.1-02 — its watched paths are already registered here so the Stop hook protects it from day one).

- **Record vs projection (§4.2)** — this table is the RECORD for `tier`. The `- **Persona:** x` line
  in the `business_profile` vault doc stays (grounding retrieval must still see "this is a
  solopreneur" in context) but it is a PROJECTION; `deserializeProfile`'s
  `isPersona(x) ? x : "solopreneur"` fallback becomes a display convenience once nothing
  authoritative reads it (plan 15.1-03).
- **Facts are all optional; tier / tierSource / derivedAt are REQUIRED.** A `legacy` backfill row has
  no facts by definition and design §10 forbids forced re-onboarding, so the schema deliberately
  never narrows. A row cannot exist without a tier and a provenance for it — that is what stops a
  half-written row from becoming a silent "solopreneur". Completeness lives at the WRITE boundary
  (`missingSlots`), never in the schema.
- **`tierSource` semantics** — `derived` (deriveTier over complete facts) · `confirmed` (the user
  acknowledged the derivation in the design §6 closing beat) · `admin` (operator grant; the ONLY
  route to `enterprise`) · `legacy` (design §10 backfill, tier recovered from markdown, facts empty).
  It is design §4.1's one-field hedge for a later business-shape-vs-billing split — **not** an
  abstraction for a second tier concept. Do not build one until billing exists.

Three decisions this phase locked that have no other home:

- **Q3 — `financialsPresent` keeps overriding the framework pick, and that is CORRECT.**
  `evaluations.ts:291-295` gives any financially-grounded tenant `growth-os` regardless of tier;
  financials mean a growth-os diagnosis is actually possible. The tier's effect lands on voice,
  framing and the specialist prompt instead, which is **unconditional**. A verifier must NOT read
  SC#5 as "the rubric pick must change" — see [ADR-009](../decisions/009-tier-shapes-the-specialist-prompt-not-the-offer-set.md).
- **Q4 — `enterprise` is granted by an OPERATOR, not by any tenant-callable function.** A grant is an
  `internalMutation` with **no public API surface** (the `actOnGapInternal` precedent), invoked via
  `npx convex run`, writing `tierSource: "admin"`. There is no `tenantMutation`, no UI and no route,
  because `requireOwner`/**GOVN-01 is Phase 22 and is NOT closed by this phase**. Do not add a fourth
  tenant-callable pseudo-admin function — that deepens the Phase-22 blocker. D6 holds regardless of
  who can call the grant, because `deriveTier`'s return type structurally excludes `enterprise`.
- **Q6 — `onboarding-agent` and the behavior-preset style directives are UNGATED**, matching
  `business-profile` (the nearest precedent: also an onboarding skill, also ungated, also producing
  something a human confirms rather than autonomous tool-state). Gating would add an eval-corpus
  obligation this phase has no budget for, and Phase 15's eval gate is already unpaid. Do NOT add
  them to `GATED_SKILLS`.

Skill registry (extraction prompt, §5 — see `skill-registry.md`):
- `packages/contracts/skills/business-profile.md` — canonical extraction prompt body
- `packages/contracts/src/skills/businessProfile.ts` — derived `businessProfileSkillBody` constant
- `packages/contracts/src/skill.ts` — `BUSINESS_PROFILE_SKILL` name const (UNGATED — absent from `GATED_SKILLS`)
- `packages/backend/convex/skills.ts` — `seedSkills[]` row that boots it v1/active

Backend adapter (Wave 2 — LIVE) + frontend (Wave 3 gate+onboarding LIVE; profile page Wave 4):
- `packages/backend/convex/onboarding.ts` — thin adapter (§1): `status` (tenantQuery, first-run gate),
  `getProfile` (tenantQuery — the committed profile parsed back to structured fields via
  `deserializeProfile`, or null; the profile page's edit-form loader), `extractProfile` (tenantAction,
  returns the object — NEVER auto-commits, SC#1), `commitProfile` + `updateProfile` (tenantMutation,
  persistBrief clone → `startIngest`; updateProfile re-embeds in place). Checks: `onboarding.test.ts`
  (SC#1/#2/#3) + `profileRedaction.test.ts` (SC#4).
- `apps/web/app/(app)/layout.tsx` — the first-run GATE (Wave 3, LIVE): inside `<Authenticated>` Shell,
  `useQuery(api.onboarding.status)` → `router.replace("/dashboard/onboarding")` for `needsOnboarding`
  tenants; the shell loader holds while the status query resolves. NOT in `middleware.ts` (invariant below).
- `apps/web/app/(app)/dashboard/onboarding/page.tsx` — the first-run onboarding flow (Wave 3, LIVE):
  a conversational surface (BRAND §5 chat idiom, adapted — NOT the thread-bound ChatPane) with the three
  ONBD-02 intake modalities all reducing to `intakeText` for `extractProfile`: pasted text (compose box) →
  straight through; uploaded file and spoken brief (MediaRecorder one-shot) → `vault.vaultUpload` → poll
  `listVaultDocs` until the row's extracted `text` lands (pending_extraction/extracting show a waiting
  state) → `extractProfile`. The result renders a pre-filled EDITABLE review card + a persona confirm/change
  control (SC#1); `commitProfile` on confirm releases the gate (`router.replace("/dashboard")`). Resumable
  via a `pikar:onboarding-draft` localStorage draft (no new table — RESEARCH Open-Q2), cleared on commit.
- `apps/web/app/(app)/dashboard/profile/page.tsx` — the profile view/EDIT page (Wave 4, LIVE): loads
  `api.onboarding.getProfile`, renders the Lean-core fields as an editable form (the onboarding
  review-card shape + BRAND §5 tokens, no new component library), and on Save calls
  `api.onboarding.updateProfile` which RE-EMBEDS the doc in place (stale rag entry replaced) so
  grounding stays current. Sparse-start mirror: only `oneLineDescription` is required to Save —
  name/stage/offering/target customer never block it. This is the enrichment surface an idea-stage
  user returns to as the idea matures.

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

- **Sparse-start: only `oneLineDescription` + a valid persona are required to commit** — an idea-stage
  user (a vague idea, no business yet — ONBD-02 covers "business/idea") has no name/stage/offering/target
  customer, so those are OPTIONAL and enriched later on the profile page. `validateProfile`'s
  `REQUIRED_STRINGS` is exactly `["oneLineDescription"]`; the onboarding page's `requiredFilled` mirror and
  `serializeProfile`'s empty-name heading fallback must stay in lockstep with it. The front door admits an
  idea; it does not demand a finished business. Enforced by `businessProfile.test.ts` (sparse-start +
  empty-name cases) and `onboarding.test.ts` (empty-description rejected).
- **Persona is ALWAYS confirmed, never assumed (SC#1)** — `decideConfirm` returns `needsConfirm: true`
  unconditionally; no branch yields an auto-committed persona. Enforced by `businessProfile.test.ts`.
- **Enterprise is not an emittable persona** — the `Persona` union is exactly `solopreneur | startup | sme`;
  the validator rejects `"enterprise"`. Enforced by `businessProfile.test.ts`.
- **Enterprise is never DERIVED (D6)** — `deriveTier`'s return type is `DerivedTier` (= `Persona`), so
  `enterprise` is structurally unreachable from the facts. Widening it breaks the `@ts-expect-error`
  bind in `businessProfile.test.ts` and the BUILD fails. `enterprise` is representable on the table
  and reachable only through an operator grant (`tierSource: "admin"`, Q4).
- **`deriveTier` is the ONLY writer of the tier** — no caller-supplied tier, no config-row threshold,
  no string-match out of markdown. The markdown persona line is a PROJECTION (design §4.2).
- **Zero is an answer** — `missingSlots` tests numbers for finiteness, never truthiness. A solo
  founder answering `paidStaff: 0` has ANSWERED; treating that as absent makes the design §6
  conversation uncompletable. Enforced by `businessProfile.test.ts`.
- **The domain module is Convex-free (CLAUDE.md §1)** — `businessProfile.ts` imports no Convex, no network;
  it is pure and portable. The backend `onboarding.ts` adapter is the only place it meets the DB.
- **§4 redaction boundary (SC#4)** — `audit` / `telemetry` / `deadLetters` payloads written during
  onboarding carry refs / hashes / ids / counts / booleans ONLY — never a profile field value or intake
  prose. The profile `text` is CONTENT (it lives on the vaultDocuments row + rag chunks), never a log.
  `commitProfile` / `updateProfile` emit exactly one audit event each — payload `{vaultDocId, fieldCount,
  personaConfirmed[, reembed]}`. Enforced by `profileRedaction.test.ts` (sentinel-in-every-field scan).
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
- `pnpm --filter @pikar/backend test -- onboarding` — status gate + extract-no-auto-commit (SC#1) +
  commit→ingest→retrieve + tenant isolation + re-embed (SC#2/#3), convex-test. LIVE.
- `pnpm --filter @pikar/backend test -- profileRedaction` — §4 audit/telemetry/DLQ scan (SC#4). LIVE.
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
- Backend adapter, onboarding UI, and profile page are all LIVE (Waves 2-4). Their watched paths stay
  registered here so the Stop hook keeps protecting them.
