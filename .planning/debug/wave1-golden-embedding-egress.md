---
status: awaiting_human_verify
trigger: "Wave 1 golden evaluator isolated diagnostic: vaultSmoke:seedCorpus ended EVAL_EMBEDDING_RESPONSE_UNRESOLVED before the first case; sandboxed TCP/443 to OpenRouter failed while unsandboxed TCP succeeded."
created: 2026-09-29T02:27:43Z
updated: 2026-09-29T02:36:00Z
---

## Current Focus

hypothesis: The Sep 28 failure was local egress isolation plus the then-missing egress readiness check. Current source prevents a new local paid attempt in the same sandbox; provider charge and exact network outcome remain unobservable.
test: No further paid test in this investigation. Any future governed qualification must first prove exact-target egress and free preflight.
expecting: The present sandbox refuses locally before budget; an egress-capable exact target is required for end-to-end qualification.
next_action: Return findings to parent; retain historical reservation as unresolved, do not replay or re-import the disposable export.

## Symptoms

expected: The one pinned synthetic diagnostic's seedCorpus embedding finishes or fails with a conclusive terminal without retried billable calls.
actual: One 1-cent reservation remained unsettled in the disposable export after timeout; workflow failed with EVAL_EMBEDDING_RESPONSE_UNRESOLVED; instance exited, no live budget handle.
errors: EVAL_EMBEDDING_RESPONSE_UNRESOLVED / GOLDEN_PAID_CALL_UNRESOLVED.
reproduction: Read 17.1-11-DIAGNOSTIC-2026-09-28.md, current evaluator preflight/evaluator code and tests; only offline mocks/free local egress checks.
started: 2026-09-28; earlier 2026-09-24 chat HTTP 400 belongs to a separate unresolved session.

## Eliminated

- hypothesis: Current runner can start a local paid golden attempt despite this sandbox's unreachable provider route.
  evidence: `runLive` calls `requireProviderReadiness()` before corpus/budget, which calls `assertGoldenLocalProviderEgress()`; the real local probe refuses `local_provider_egress_unavailable` here. The preflight was introduced in commit `3f0c9ea` after the Sep 28 diagnostic.
  timestamp: 2026-09-29T02:36:00Z

- hypothesis: Current workflow retries the paid seed automatically or settles an unobserved provider cost as zero.
  evidence: `goldenEvalAttempts.run` uses one `step.runAction(..., { retry: false })`; `vaultRag.createVaultEmbeddingModel` gives evaluation one attempt, reserves first, and settles only after parsing provider usage and confirming non-BYOK billing. Offline tests cover both branches.
  timestamp: 2026-09-29T02:36:00Z

## Evidence

- timestamp: 2026-09-29T02:30:00Z
  checked: pinned Sep 28 diagnostic
  found: One reservation, zero settlement, failed seed workflow, no case verdict; sandbox TCP/443 failed while unsandboxed succeeded. Snapshot is not a live budget.
  implication: Strong evidence for local egress constraint, but not proof of provider charge or definitive cloud transport result.

- timestamp: 2026-09-29T02:31:00Z
  checked: current `goldenProviderPreflight.mjs` and `vaultRag.ts`
  found: Current preflight probes OpenRouter and Tavily TCP/443 for local instances before a budget. Evaluation embedding reserves before fetch, disables retries, settles only from parsed OpenRouter usage and verified non-BYOK billing, and redacts unknown fetch errors to `EVAL_EMBEDDING_RESPONSE_UNRESOLVED`.
  implication: Unsettled reservation is an intentional fail-closed outcome if fetch never produced conclusive usage.

- timestamp: 2026-09-29T02:34:00Z
  checked: durable attempt and runner call order
  found: One workflow step has `retry:false`; `runLive` calls provider readiness before `openEvalBudget`; after the failed seed, settlement/closure can proceed only if the existing reservation resolves. The old exported budget does not exist as a live handle.
  implication: Current code does not replay the embedding or fabricate budget closure.

- timestamp: 2026-09-29T02:35:00Z
  checked: offline tests
  found: 33/33 Node preflight/paid-attempt tests and 10/10 targeted Convex embedding/attempt tests passed. Embedding tests prove successful observed-cost settlement and unresolved, non-retried unknown response retaining its hold.
  implication: Current fail-closed paths have deterministic regression coverage, not live provider proof.

- timestamp: 2026-09-29T02:36:00Z
  checked: current local no-payload probes
  found: Both OpenRouter and Tavily TCP/443 connections fail from the sandbox; `assertGoldenLocalProviderEgress` emits `local_provider_egress_unavailable` with no credentials, request payload, budget, or external send.
  implication: The same local execution context now refuses before paid work. This supports an environmental egress explanation for Sep 28 but cannot distinguish an untransmitted request from a provider-side charge in the extinct instance.

## Resolution

root_cause: The Sep 28 local diagnostic ran from an execution context whose provider TCP/443 route failed, while its then-current free readiness gate checked configuration but not local egress. The embedding reservation preceded the unresolved fetch and correctly remained unsettled because no trustworthy usage or billing-mode response was observed. The exact provider-side outcome cannot be recovered from the extinct instance/export.
fix: Existing commit `3f0c9ea` added local no-payload egress refusal before budget; no further repository-controlled defect was proven and no application-source edit is proposed.
verification: Offline regression tests 33/33 Node plus 10/10 targeted Vitest pass; current sandbox's real local preflight refuses before budget. End-to-end provider success and historical charge status remain unverified and must not be inferred.
files_changed:
  - .planning/debug/wave1-golden-embedding-egress.md
