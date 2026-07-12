---
title: ISO 9001:2015 principles as an embedded QMS layer (product-strategy record)
status: adopted as direction; build is phased and gated (nothing before beta except
  the planning-skill upgrade)
decided: 2026-07-12
decision: Embed ISO 9001 QMS *principles* (PDCA, risk-based thinking, clause 8.1
  operational control) invisibly via versioned skills in the skills registry — not
  code, not UI vocabulary. Never claim "certified." Companion to
  `moat-strategy.md` (deepens the compliance/trust moat).
---

# ISO 9001:2015 as an Embedded QMS Layer

Idea: Pikar's harness encodes quality-management discipline so every plan it
produces and executes follows curated business-operations guardrails — an
opinionated operating system for running a business, not a raw LLM.

## Claim boundary (hard rule)

ISO 9001 certification applies to an **organization's** management system, audited
annually by an accredited body. Therefore:

- Embedding ISO concepts does **not** make Pikar "ISO certified" and cannot make
  customers certified. Marketing may say **"built on ISO 9001:2015 principles"**
  or **"supports your quality management practices"** — never "certified business
  operations." A false compliance claim would damage the trust moat
  (`moat-strategy.md`) it is meant to deepen.
- Pikar-the-company pursuing real ISO 9001 certification is a separate,
  post-PMF company-process project (enterprise sales asset), not a code feature.

## Why the cost is low: the harness is already ISO-shaped

| ISO 9001 concept | Already in Pikar |
|---|---|
| PDCA cycle | plan → per-plan approval → governed execution → feedback/telemetry → SkillOpt loop |
| Evidence-based decisions | audit trail + telemetry from day one |
| Process approach | governed workflow spine with controls |
| Documented information (records) | insert-only audit table + compliance archival |
| Nonconformity & corrective action (10.2) | dead-letter queue + escalation + notifications |
| Risk-based thinking | cost guardrails, fail-closed PII, pre-execution budget check |
| Operational control (8.1) | single approval gate before anything leaves the building |

The genuinely missing piece is at the **plan level**: clause 8.1 requires planned
work to carry acceptance criteria and verification. Pikar plans today have steps,
not "what does done look like and how will we check it."

## Embedding decision: skills registry, not code

Per CLAUDE.md convention #5 (no hardcoded prompts), the QMS layer lives as
**versioned rows in the `skills` table**, upgradeable with rollback and improvable
by the Phase 8 SkillOpt loop:

1. **QMS-informed planning skill** — the Executive Agent's planning prompt requires
   every plan to carry: objective, acceptance criteria, identified risks, and a
   verification step. PDCA + clause 8.1 baked into every plan, invisible to the
   user. Code impact ≈ a plan-schema field or two.
2. **Curated methodology skill packs** (later) — "run a client project," "launch an
   offer," "handle a complaint" — each encoding process-approach discipline.
3. **No new engine.** The audit/DLQ/feedback machinery ISO calls "records" and
   "corrective action" already exists.

**Vocabulary rule:** solopreneurs want outcomes, not clause numbers. Embed the
principles invisibly; keep ISO vocabulary out of the solopreneur UI. Surface it
only at the enterprise tier, where "operates on ISO 9001 principles with full
audit trails" is a procurement door-opener.

## Phased sequencing

| Phase | Action |
|---|---|
| Now (pre-beta) | Capture only — this record. Zero build; the 4-week clock rules. |
| Phase 3+ (cheap, high-value) | QMS planning skill: acceptance criteria + verification step in every plan. A skill-registry row, not an engineering phase; improves plan quality for beta users regardless of ISO framing. |
| Post-beta, Validated-gated | Methodology skill packs — build only the ones DLQ entries and user conversations prove people need (evidence hierarchy in `moat-strategy.md`). |
| Post-PMF / enterprise milestone | ISO-alignment marketing language; optionally real company certification. |

## Moat linkage

Curated, versioned, self-improving methodology skills are a **compounding asset**
(they improve via the SkillOpt loop and accumulate per-tenant context) and deepen
the **compliance/trust moat** — the two structural moats named in
`moat-strategy.md`.
