# Conversational business operations — social-first amendment

Date: 2026-10-24. Status: implementation and acceptance in progress. Decision: [ADR-068](../../docs/decisions/068-conversational-service-knowledge.md).

## User experience

A user asks the Executive to prepare social content. Pikar checks the saved service's current channels, instruction, spending permission and business context. If the four preparation facts are incomplete, Pikar asks only what is missing: what the business offers, whom it serves, how it speaks and what it must not promise. Existing confirmed information is reused with its provenance. The user may type, dictate and review text, or attach source documents through the existing workspace composer.

Pikar presents the exact proposed statements for review. The user confirms or edits them. Confirmation retains the original authorized request and continues the same native service start with a stable idempotency key. The user does not need to repeat the request or press another start button. A running or uncertain earlier attempt is never replayed. Drafted posts still require the user's existing exact-content approval before Buffer publication. A request for supported reports alone does not wait for content facts.

## Reuse and authority

The existing Foundation interview owns the canonical statements. The managed-service record owns conversation progress, bounded proposed answers, revision counters and references to actual confirmed events and user audits. There is no parallel memory database or hidden six-document publication. Unreviewed documents, inferred answers and legacy context cannot impersonate authenticated confirmation. Confirmation does not raise a user's business tier, activate a skill, widen account selection or create a schedule.

The Executive receives a separate bounded service-context block labelled as user-stated context. It does not enter the Blueprint spine or its financial grounding path. Context strings are escaped data. The shared Executive can use them in ordinary turns; specialist access is not implied by this design.

## Execution boundaries

- Review is conditional on current configuration, control and conversation revisions plus the exact current review hash. Concurrent edits and changed sources require a fresh review.
- Preparation readiness resolves current owned canonical facts, their real confirmation audits and source states. Missing, changed, withdrawn or unverified facts remain unavailable.
- Every new preparation run saves the selected knowledge fingerprint. Native execution context, local draft writes and paid-call admission check it again. A missing fingerprint refuses preparation; reporting-only runs remain independent.
- The fingerprint binds selected source identities, content and state, not unrelated interview revision metadata or conversation display state. Knowledge questions have no arbitrary time-to-live.
- Source changes cannot erase accepted provider costs. Settlement and conservative unknown holds remain authoritative even after a source fence or stop.
- Scheduled runs use the same existing workflow and native guards. A future occurrence pins its current confirmed facts without rewriting historical standing-approval terms. Existing pause, account, permission, budget and recovery rules still apply.

## Existing plan extensions

Phase 51's source freshness, business-knowledge history and outcome linkage now include confirmed Foundation service statements and selected-source run fingerprints. Phase 52's configure-once social experience includes conversational setup and continuation of the original authorized request. This is an implementation amendment within those phases, not a replacement programme, new phase or completed acceptance claim.

Native acceptance must cover exact confirmation, edits and duplicate/replayed confirmations; other-tenant refusal; changed/withdrawn sources; stable unrelated metadata; missing preparation pins; accepted late-cost settlement; and report-only operation. Hosted acceptance additionally exercises the existing voice/document composer, authenticated review-and-continue, and the current social cycle on the released source. Current hosted acceptance, CI and production promotion are pending; local synthetic confirmations are not live owner or provider evidence.
