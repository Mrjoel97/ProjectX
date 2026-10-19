# Phase 52: Social marketing service pilot

Researched: 2026-10-19. Status: planning from source at b4deef8bba42347e31df638b828443eb11407138; no new live qualification.

## Current findings

ADR-059 supersedes hosted dynamic-MCP/insights assumptions: Buffer publishing uses registered app GraphQL OAuth; engagement is unavailable through that grant. ADR-060 provides selected Instagram/TikTok Zernio reporting with customer-owned read-only keys, bounded coverage and stale snapshot retention. Platforms needing media cannot accept an invented text-only fallback. Executive tools stage local drafts; authenticated humans approve exact revisions. Existing provider generation/lease/claim fences must be reused. No real publication or engagement is manufactured for acceptance.

## Reuse and dependencies

Phases 48–51 verified; ADR-059/060 provider boundaries. Read/prepare-only standing permission remains binding.

- [docs/decisions/059-buffer-registered-app-oauth.md](../../../docs/decisions/059-buffer-registered-app-oauth.md)
- [docs/decisions/060-zernio-read-only-reporting.md](../../../docs/decisions/060-zernio-read-only-reporting.md)
- [packages/backend/convex/bufferTools.ts](../../../packages/backend/convex/bufferTools.ts)
- [packages/backend/convex/buffer.ts](../../../packages/backend/convex/buffer.ts)
- [packages/backend/convex/bufferActions.ts](../../../packages/backend/convex/bufferActions.ts)
- [packages/backend/convex/zernio.ts](../../../packages/backend/convex/zernio.ts)

## Ordered plans

- 52-01: Configure the first social service and readiness.
- 52-02: Prepare, review and schedule exact approved content.
- 52-03: Measure repeated cycles and seal the pilot.

## Boundary

The owner approved this ordered programme and parallel planning reviews. That is not evidence of a completed paid evaluation, personally executed owner activation, actual provider publication or elapsed-time test. Preserve existing concrete checkpoints and immutable artifacts. Later stages require preceding stage verification, not merely generated plans. Revalidate source/version/environment before using older evidence.
