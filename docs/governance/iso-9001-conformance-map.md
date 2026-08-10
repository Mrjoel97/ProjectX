# ISO 9001 Evidence-Alignment Map

- **Owner:** _TBD_
- **Reviewer:** _TBD_
- **Last reviewed:** 2026-08-10
**Baseline:** ISO 9001:2015 including Amendment 1:2024

## Defined scope and claim boundary

This map covers only Pikar's software/product design, governed behavior release, and governed
service operation. It indexes evidence that those defined mechanisms align with selected ISO 9001
quality-management intents. It does not assess Pikar's complete organizational management system
or any customer's management system.

This artifact is not a certificate, declaration of conformity, certification audit, or claim that
Pikar or a customer is ISO certified. A qualified, independent assessment is required before any
external conformity or certification statement. The adopted design direction and Phase 24 research
are historical inputs, not evidence systems: `.planning/design/iso9001-qms-layer.md` and
`.planning/phases/24-iso-9001-conformance-map/24-RESEARCH.md`.

The baseline is [ISO 9001:2015](https://www.iso.org/standard/62085.html), including
[Amendment 1:2024](https://www.iso.org/standard/88431.html). The
[ISO/IAF climate amendment communique](https://committee.iso.org/files/live/sites/jtcg/files/news/Joint%20ISO-IAF%20Communique%20re%20Climate%20Change%20Amds%20to%20ISO%20MSS%20Feb%202024a.pdf)
informs the climate-context disposition. Publication of the next ISO 9001 edition triggers a
review; this map does not anticipate unpublished requirements.

For clauses 4.1 and 4.2, climate relevance was considered for this defined evidence-map scope.
No repository evidence presently shows climate change to be a material requirement of the mapped
software controls or an identified interested-party requirement. That disposition does not create
an environmental objective or climate program, and it must be revisited when product context,
interested-party requirements, or the published standard changes.

## Closed status vocabulary

- `Direct — defined scope`: the operating mechanism and objective evidence address the intent
  within the defined scope.
- `Supporting`: relevant evidence contributes to the intent but is not sufficient by itself.
- `Partial — gap named`: part of the intent is evidenced and the exact gap has a disposition.
- `Not assessed — organization-wide`: the needed evidence belongs to company-wide practices that
  this repository foundation cannot establish.
- `Not applicable — justified`: the intent is outside the defined scope for a stated reason.

These are the only statuses used by this map. They are classifications, not scores or certification
findings.

## Evidence hierarchy and pointer rule

Prefer evidence in this order: runtime record/read surface; executable test or smoke; implementation
or schema; dated/versioned verification; playbook or ADR; then plan or design intent. Higher-level
intent never substitutes for an operating control.

This file is a pointer-only index. It points to existing artifacts and never copies their content,
runtime rows, test output, or incident narratives. Local evidence pointers use backticked
`repo:PATH` references with optional `#symbol` or `#section` suffixes. Non-path evidence may use
`commit:`, `run:`, or `symbol:` references. External sources use ordinary Markdown links. Pointers
do not use line numbers.

## Clause evidence map

The clause matrix is populated from evidence in the next execution task.
