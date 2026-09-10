---
phase: 30-optional-vertical-workflow-packs
plan: 07
status: partial
completed: 2026-09-10
requirements-completed: []
---

# 30-07 — Engineering candidate artifacts

Prepared a canonical Engineering body, manifest, operation matrix and draft method review under
`packages/contracts/packs/vertical/engineering/`. The source is the official pinned commit
`5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`, specifically documentation, incident-response and
deploy-checklist. Each received file is checked against its Git blob identity and SHA256. The
manifest also binds canonical body bytes and the governing root license; it retains the known
upstream root-license anomaly instead of silently altering received evidence.

The method separates recorded evidence, hypothesis, unknowns and proposed verification. ADR,
incident and deployment-readiness documents remain assistive. It cannot merge, run commands,
restart, monitor or deploy, and does not convert a proposed command into an executed test result.
The operation matrix inherits precisely the two reviewed document tools, `searchVault` and
`saveAsDocument`; external connector operations remain unreachable.

Five unexecuted native-eval scenarios cover architecture, incomplete incident logs, injected
deployment instructions, false test results and requests to merge/restart. Three offline tests
passed for source/body hashes, native tool parity and honest unexecuted fixture status. They do
not prove an LLM's outputs. Backend typecheck is part of the final integration run.

Independent method review, native runtime binding, exact-version paid outcome/adversarial evals,
authenticated responsive UAT and activation/rollback evidence remain acceptance work. No live
candidate was published or activated during this local preparation. VERT requirements stay open.
