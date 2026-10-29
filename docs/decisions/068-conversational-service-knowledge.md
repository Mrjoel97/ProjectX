# ADR-068 — Confirm business context through a service conversation

- Date: 2026-10-24
- Status: Implementation; current-source CI, authenticated hosted acceptance and release are pending.
- Authority: The owner's approved post-onboarding conversational knowledge layer, beginning with the social service.

## Decision

Use the existing Foundation interview as the canonical record of exact user statements. The social-service conversation stores only its working answers, revision checks, confirmation references and source hashes on the existing managed-service configuration. Confirmation writes through the existing Foundation path and records a real authenticated user audit. It does not publish the six Foundation documents, change the business tier, activate instructions or grant a new operation.

Before content preparation, collect only missing offering, target customer, brand voice and publishing boundaries. Reuse current confirmed information where its native sources remain valid. Ask in ordinary language and retain unanswered questions without an arbitrary expiry. The existing composer supports typed answers, reviewed voice transcripts and documents; an uploaded document remains source material until the user confirms its interpretation. Reporting-only work has no content-setup prerequisite.

Keep confirmed statements in a separate, bounded business-context section in the Executive prompt. Identify them as user-stated service context with their service and source identity. Do not append them to the Blueprint business spine or represent them as globally verified financial evidence. User text is data, never instructions or permission. This decision adds no new truth store, scheduler or paid extraction model.

Confirmation requires the current service, control and conversation revisions and the exact review hash. An edited, withdrawn or replaced source invalidates a preparation run's saved knowledge fingerprint before another provider call or scoped tool effect. Unrelated interview revision metadata does not invalidate the selected facts. New attended and scheduled preparation runs pin the current fingerprint; an old preparation run without a pin cannot continue. Late accounting remains possible after invalidation so an accepted provider cost or unknown hold is not hidden.

For an unstarted, already-authorized request, confirmation may continue through the same native service start boundary using its original idempotent request key. It must not replay an existing running or uncertain attempt, invent a second dispatcher or require a redundant start button. Knowledge confirmation does not approve publication. Existing exact-item Buffer approval remains mandatory.

Standing approvals retain their original goal, operation, account, instruction, schedule and budget terms. A future occurrence may pin newly confirmed knowledge within those permissions. A running occurrence keeps its own fingerprint and stops at the next guarded boundary when its selected sources change. No stale request or reconnection silently rearms a suspended schedule.

## Programme amendment and acceptance

Extend the existing Phase 51 source-authority/history work and Phase 52 social-service setup and acceptance; do not add a phase or claim a completion count. The implementation design is [Conversational business operations](../../.planning/design/conversational-business-operations.md). Current execution and release evidence remain governed by the existing managed-service programme and ADR-067.

Required proof includes actual user confirmation and CAS refusal, tenant isolation, source withdrawal/change fences, missing-run-pin refusal, unchanged-source stability, confirmation/start idempotency, report-only behavior and late-cost settlement. Offline native fixtures prove local behavior only. Hosted voice/document interaction, authenticated continuation and the complete scheduled social cycle remain pending until observed on the released candidate.
