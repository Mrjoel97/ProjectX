# Design — Business Tier & Conversational Onboarding

**Status:** approved (brainstormed 2026-07-25)
**Scope:** Make the business tier (`solopreneur` / `startup` / `sme` / `enterprise`) a
trustworthy, fact-derived, non-user-settable attribute captured through a conversational
onboarding, and use it to tailor the agent's voice and which Growth OS playbooks run.
**Sequencing:** executes as a NEW phase AFTER Phase 13 (proactive in-app review) completes.
**Deferred:** entitlement/quota gating on tier (the billing half of the fused field) — there is
no billing in the private beta; revisit at monetization.

---

## 1. Problem

Three separate defects, discovered by reading the Phase 11 implementation:

**1a. The tier is guessed from prose, never asked.** Onboarding is a single textarea
(`apps/web/app/(app)/dashboard/onboarding/page.tsx:307`). An LLM infers the persona from that
free text, and the extraction skill explicitly instructs it to guess
(`packages/contracts/skills/business-profile.md:31` — *"a best-fit guess is correct behavior"*).
The determining question — **is this person alone or not** — is never asked. Headcount is not a
field, not in the schema, not in the prompt. Which tier a user lands in is model temperature.

**1b. The tier is freely flippable, forever.** `/dashboard/profile` renders persona as three
pill buttons, always editable (`profile/page.tsx:143`). `updateProfile` accepts any of the three;
`validateProfile` only checks set membership. No re-derivation, no record of the change — and
the audit payload hardcodes `personaConfirmed: true` even on an edit that contradicts onboarding.

**1c. The tailored experience does not exist yet.** Exactly one consumer of `persona` exists in
the backend — `PERSONA_FRAMEWORK` (`packages/backend/convex/evaluations.ts:54`), which picks an
evaluation rubric. It is overridden one line later by
`financialsPresent ? "growth-os" : PERSONA_FRAMEWORK[...]`, so any tenant with financial figures
ignores tier entirely. Nothing else branches on it — not the cockpit agent, not the UI, not the
skills. Today a solopreneur and an SME get the same product with a different diagnostic template,
sometimes.

**1d (structural).** There is no `tenants.tier` column. The tier lives as the string
`- **Persona:** solopreneur` inside a `business_profile` vault doc, recovered by string-matching
in `deserializeProfile`. It cannot be indexed, queried, or audited, and a malformed doc silently
reclassifies the tenant as a solopreneur (`businessProfile.ts:173`).

## 2. Goal

A tier that is **trustworthy** (derived from facts, not claims), **non-manipulable** (no control
sets it directly), **able to change legitimately** (a growing solopreneur becomes a startup), and
**perceivable** (the user can tell they are getting tailored treatment).

## 3. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **One fused tier field** drives both advice and (eventually) entitlements | Owner's call. Simplest to reason about; a growing customer is migrated deliberately. |
| D2 | **Derive from facts; never render the tier as an input** | The anti-manipulation mechanism. Gaming it requires lying about headcount, which has visible consequences elsewhere. |
| D3 | **Conversational onboarding, scripted spine** | Chief-of-staff feel without losing deterministic capture. |
| D4 | **Agent gets a user-chosen name and a behavior preset** | Ownership/emotional payload from the first minute. |
| D5 | **Tailoring depth = voice/framing + which playbooks run** | No entitlement gating yet (D1's billing half is deferred). |
| D6 | **Enterprise is never derived** — admin-granted only | Already true in code; fusion does not change it. |
| D7 | **Sequencing: after Phase 13** | Phase 13's card is tier-agnostic plumbing; making it tier-aware later is a content change, not structural. |

## 4. Data model

Two kinds of data, currently fused into one markdown blob, separated by purpose:

| Data | Home | Why |
|------|------|-----|
| Narrative profile (offering, target customer, goals, constraints) | `business_profile` vault doc — **unchanged** | Content. Needs embedding, grounding, RAG retrieval. Phase 11's "just another vault doc" was right for this. |
| Tier facts, derived tier, agent identity | **New single-row-per-tenant table** | Control plane. Needs indexing, audit, queryability — none of which a markdown blob provides. |

### 4.1 The new table

One row per tenant, indexed by tenant. Holds:

- **Tier facts:** `headcount`, `paidStaff`, `revenueStage`, `funding`, `yearsOperating`
- **Derived:** `tier`, `tierSource` (`derived` | `confirmed` | `admin` | `legacy`), `derivedAt`
- **Agent identity:** `agentName`, `behaviorPreset`

`tierSource` is the one-field hedge that makes a later business-shape-vs-billing split a field
addition rather than a data-archaeology project. It is NOT an abstraction for a second tier
concept — do not build one until billing exists.

### 4.2 Markdown as projection, table as record

The tier is still **written into** the serialized profile markdown, so grounding retrieval still
sees "this is a solopreneur" in context. But the markdown is a **projection**, never the
authority:

- `evaluations.ts` stops string-matching `- **Persona:**` out of the doc and reads the table.
- `deserializeProfile`'s persona parse becomes a display convenience. Its
  `isPersona(persona) ? persona : "solopreneur"` fallback stops being a silent reclassification
  risk once nothing authoritative depends on it.

## 5. Derivation

A pure function in `packages/core` (§1 — Convex-free, unit-tested), the single home of the rule:

```
deriveTier(facts) -> "solopreneur" | "startup" | "sme"
```

Proposed default thresholds (**tunable — these are a product call, not a technical constraint**):

- `paidStaff === 0 && headcount <= 2` → **solopreneur**
- else if pre-revenue or early-revenue, or actively seeking / holding funding → **startup**
- else → **sme**
- **enterprise** — never returned by this function (D6).

Persist the derived value alongside the facts with `derivedAt`, so a later change to the rule is a
visible re-derivation event rather than a silent reclassification of every tenant.

## 6. Conversational onboarding

**Scripted spine, conversational skin.** The agent must fill a fixed slot set before it can
finish: the tier facts (§4.1) plus the existing required `oneLineDescription`. Within that
constraint it is fully conversational — asks in its own voice, in any order, skips what the user
already volunteered, follows up on vague answers, reacts to what it hears. It simply cannot
**complete** with a required slot empty.

Rationale: a free-roaming agent conversation will sometimes never ask about headcount — it gets
absorbed in the user's product idea and wraps up warm and useless. That returns us to §1a.

**Implementation notes:**

- The prompt is a **registry skill row** (`onboarding-agent`), not a hardcoded string (§5).
- **Reuse the Phase 3.2.1 cockpit agent tool-loop** rather than building a second conversation
  engine — onboarding is a smaller instance of the same pattern. *Confirm this is cleanly
  reusable during planning before committing to it.*
- The agent records each slot through a tool call, mirroring the existing cockpit tool pattern.
- The existing `extractProfile` path still handles the narrative fields; the conversation feeds it.

**The closing beat.** The agent ends by making the tailoring legible and confirming it in one
move — e.g. *"From what you've told me, I'll work with you as a solo operation, so I won't
suggest hiring your way out of problems. Sound right?"* This satisfies the existing SC#1
confirm-not-assume rule **and** is where the differentiation becomes perceivable. A tailored
experience the user cannot perceive is not a selling point.

## 7. Agent identity

- **Name** — free text, sanitized (length cap, strip control characters and newlines),
  display-only. Carries into voice (Phase 6 already speaks).
- **Behavior** — an enum of 3–4 presets, each mapping to a **versioned style directive in the
  registry**. Deliberately NOT a free-text box: user-authored text injected into every future
  system prompt is a standing prompt-injection surface, and it smuggles unversioned prompt
  content into every call, contrary to §5.

*Open: the specific preset set is unspecified — owner to choose during planning.*

## 8. What tier changes (D5 depth)

1. **Voice and framing** — tier, agent name, and behavior preset feed the cockpit agent's
   context. A solopreneur does not receive advice premised on delegation.
2. **Which playbooks run** — tier filters and orders which Growth OS specialists
   (`offer-architect`, `money-model-designer`, `lead-engine`) are offered off a given diagnosis.
   Same diagnosis, genuinely different recommended next steps.
3. **Rubric pick** — the existing `lean` / `bmc` / `swot` selection stays, now reading from the
   table instead of parsed markdown.

Explicitly NOT in scope: feature gating, quotas, or price. See Deferred.

## 9. Profile page

The three persona pills are **removed**. In their place:

- The tier facts, editable.
- The tier itself, **read-only, with its reason** — *"Solo operation — you're the only person
  working on this."*

Editing headcount to 12 moves the tier. No control sets the tier directly. This is the whole
anti-manipulation mechanism, and it is mostly a subtraction.

**The subtraction must reach the mutation, not just the page** (amended 2026-07-25). Removing the
pills is a client-side change; today `onboarding.ts:56` still accepts
`v.union("solopreneur","startup","sme")` from the caller and `validateProfile`
(`businessProfile.ts:81`) only checks set membership — nothing re-derives, nothing compares
against the facts. A UI-only fix hides the button and leaves the control. `updateProfile` must
stop taking a tier argument at all; the tier is a *derived output* of the facts write, never an
input to it. Rationale: once §8 lands, the tier selects agent voice and which specialists are
offered — a user-writable field that selects code paths needs the scrutiny of a permission, not
of a preference.

**Tier change is a moment, not a setting.** When the facts move someone from solopreneur to
startup, that is the product noticing they grew — surface it as such.

## 10. Migration

Existing tenants have a persona in markdown only. Backfill into the table with
`tierSource: "legacy"` and empty facts. **No forced re-onboarding** — the legacy tier stands
until the user completes the facts, and they are prompted to do so on their next profile visit.

## 11. Checks left behind

- `deriveTier`'s rule table as pure unit tests (every branch, including the boundaries).
- A guard that the onboarding conversation cannot complete with a required slot empty.
- A regression asserting the profile page exposes **no direct tier control** — this is what stops
  the pills quietly returning in six months.
- **A regression asserting the MUTATION refuses a caller-supplied tier** (added 2026-07-25). The
  page-level check above only proves the widget is gone; this one proves the control is gone.
  Without it, "no tier control" is a UI claim, not a system property.
- **An assertion that the audit row is truthful on an edit path** (added 2026-07-25).
  `onboarding.ts:278` and `:307` hardcode `personaConfirmed: true`, so an edit that contradicts
  onboarding still logs as a human confirmation. Under CLAUDE.md §3 the audit is insert-only and
  cannot be corrected after the fact — a false row is worse than a missing one.

## 12. Affected surfaces

| File / area | Change |
|---|---|
| `packages/core/src/businessProfile.ts` | `deriveTier` + facts type; persona parse demoted to display |
| `packages/backend/convex/schema.ts` | New tenant-profile table + index |
| `packages/backend/convex/onboarding.ts` | Conversational flow, slot recording, table write |
| `packages/backend/convex/evaluations.ts:54,247` | Read tier from table, drop the `- **Persona:**` string-match |
| `packages/contracts/skills/` | New `onboarding-agent` skill; behavior-preset style directives |
| `apps/web/.../dashboard/onboarding/page.tsx` | Conversational UI |
| `apps/web/.../dashboard/profile/page.tsx` | Remove pills; add facts; read-only tier + reason |
| Cockpit agent context | Tier, agent name, behavior preset |
| Growth OS playbook routing | Tier filters/orders specialist offers |

## 13. Risks

- **Fusion makes onboarding a pricing decision** once billing exists. Fact-derivation blunts this
  (you cannot pick a plan, only claim facts), but the incentive to shade facts appears with money.
  `tierSource` is the cheap hedge; revisit at monetization.
- **Derivation-rule drift** — changing thresholds moves existing tenants. Mitigated by persisting
  `derivedAt` and treating re-derivation as an event.
- **Cockpit loop reuse may not be clean** — if the Phase 3.2.1 tool-loop does not adapt to
  onboarding cheaply, the conversational step grows. Confirm before planning around it.
