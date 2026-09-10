---
phase: 30-optional-vertical-workflow-packs
plan: 04
status: partial
completed: 2026-09-10
requirements-completed: []
---

# 30-04 — Product and Design candidate artifacts

Created independently versioned Product and Design candidate directories under
`packages/contracts/packs/vertical/`, each with manifest, operation matrix, source-method review and
canonical skill body. Both preserve the core document workflow/output/disclaimer ids and exactly
`searchVault` plus `saveAsDocument`. No source is registered, seeded, activated or given a runtime route.

The exact official source commit is `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`. Product adapts
`product-management/skills/write-spec/SKILL.md` and `roadmap-update/SKILL.md`; Design adapts
`design/skills/design-critique/SKILL.md` and `accessibility-review/SKILL.md`. Downloaded snapshots
were checked against the official pinned Git tree's blob SHA and independently SHA256 hashed.
Manifests pin those hashes, canonical body hashes and governing license evidence. Product has its
own clean Apache-2.0 file. Design has no per-plugin license and records the inherited root-license
trailing-text anomaly already tracked by the repository; this work is not licensing sign-off.

Product removes default demand, capacity, effort and score assumptions, requiring supplied
prioritization criteria and retaining unknowns, source refs and open questions. Design requires actual
visual access before visual findings and separates observable evidence from DOM/keyboard/contrast/
screen-reader checks that need testing. It does not certify accessibility or claim Figma access.
Both treat source instructions as untrusted data and forbid external system mutation and publishing.

Five native-eval scenarios per pack cover positive, sparse/missing evidence, unsupported claims and
injected external authority. Their execution status is `not-run`; Design visual scenarios explicitly
require attaching a real visible artifact during native eval, not treating fixture prose as an image.
`verticalProductDesign.test.ts` passes six artifact-integrity/policy tests: source SHA256 and Git blob
pins, license and canonical-body hashes, core ids/version/tool parity, absence of release evidence and
adversarial-corpus completeness. These tests do not execute an LLM or certify candidate output quality.

Remaining for plan/phase acceptance: independent method review, execution binding through the existing
immutable candidate flow, exact-version native evals with real artifacts, authenticated responsive UAT,
and retained-artifact/rollback evidence. `nativeEval`, `browserUat` and `activation` stay null and
`runtimeEnabled` stays false. VERT-02 and VERT-03 are not marked complete from draft authoring.
