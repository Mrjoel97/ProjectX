# Phase 49: Shared managed-service boundary

Researched: 2026-10-19. Status: planning from source at b4deef8bba42347e31df638b828443eb11407138; no new live qualification.

## Current findings

Phase 38 already supplies ToolContext, grantsFor and exact-name tool filtering. Packs remain leaf agents and cannot grant themselves delegation or social tools. Reuse startWorkflowPack, workflowPackBinding, dispatchRun and existing outcome/cost stores. Buffer/Zernio tools are currently Executive-only behind trusted thread/root-request lineage and excluded from evaluator contexts. Buffer has no provider-cancel operation; local Pause/Stop cannot cancel already accepted queue items. Stage 2 remains attended; new storage must not hide a generic recurrence feature.

## Reuse and dependencies

Phase 48 readiness seal. No general recurrence is enabled here.

- [.planning/design/service-architecture-post-beta.md](../../../.planning/design/service-architecture-post-beta.md)
- [packages/core/src/workflowPacks.ts](../../../packages/core/src/workflowPacks.ts)
- [packages/core/src/toolGrants.ts](../../../packages/core/src/toolGrants.ts)
- [packages/backend/convex/workflowPackBinding.ts](../../../packages/backend/convex/workflowPackBinding.ts)
- [packages/backend/convex/dispatchRun.ts](../../../packages/backend/convex/dispatchRun.ts)
- [docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md)

## Ordered plans

- 49-01: Define service ownership and policy.
- 49-02: Persist tenant setup and bounded service views.
- 49-03: Add the trusted start, pause and stop boundary.
- 49-04: Validate agent-composed service operations.
- 49-05: Deliver conversational setup and supervision.

## Boundary

The owner approved this ordered programme and parallel planning reviews. That is not evidence of a completed paid evaluation, personally executed owner activation, actual provider publication or elapsed-time test. Preserve existing concrete checkpoints and immutable artifacts. Later stages require preceding stage verification, not merely generated plans. Revalidate source/version/environment before using older evidence.
