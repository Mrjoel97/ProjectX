---
phase: 02-thin-end-to-end-slice
plan: 03
subsystem: intake
tags: [convex, validation, trust-boundary, notifications, tenant-scope, vitest, tdd]

# Dependency graph
requires:
  - phase: 02-01
    provides: "requests/attachments/notifications tables + indexes, pipelineWorkflow stub + REQUEST_STATUS, tenant wrappers, audit.log, deadLetter.onPipelineComplete"
provides:
  - "validateSubmit — pure, tested INTK-04 content validation with exported caps (MAX_GOAL_LEN / MAX_ATTACHMENT_SIZE / MAX_ATTACHMENTS / MIME_ALLOWLIST)"
  - "requests.submit tenantMutation — the single intake door: validate → (reject: audit+notify, no workflow | accept: create rows + start pipeline workflow)"
  - "requests.generateUploadUrl (upload-first) + requests.list/get tenant-scoped reactive queries"
  - "notifications module: list (unread-first) + markRead tenantQuery/Mutation + internal notify helper"
affects: [02-05, 02-06, 02-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Trust boundary = pure validateSubmit BEFORE the un-testable workflow.start; recipient is the explicit validated To: field, never model-derived"
    - "Rejection is redaction-safe: audit payload carries reason + counts + a SHA-256 goalHash, never the raw goal/recipient (CLAUDE.md §4)"
    - "correlationId minted server-side (crypto.randomUUID) — it names the resume event, never client-supplied"
    - "requestId placed in onComplete context.payload (an id, redaction-safe) so 02-06's failure path can patch requests.status=failed"
    - "ctx.db.get bypasses tenant scope — get/markRead re-check row.tenantId === ctx.tenantId (load-bearing isolation)"

key-files:
  created:
    - packages/core/src/validateSubmit.ts
    - packages/core/src/validateSubmit.test.ts
    - packages/backend/convex/requests.ts
    - packages/backend/convex/notifications.ts
  modified:
    - packages/core/src/index.ts

key-decisions:
  - "MAX_GOAL_LEN=10000, MAX_ATTACHMENT_SIZE=10MiB, MAX_ATTACHMENTS=5 exported for UI reuse (02-08)"
  - "MIME allowlist includes m4a/wav browser variants (audio/x-m4a, audio/x-wav, audio/wave) alongside canonical types"
  - "list sorts newest-first in memory (bounded per-tenant volume); by_tenant_status index order is status-then-time, not pure recency"
  - "Pre-existing pnpm-typecheck test-file failures left out of scope — real function typecheck (convex codegen) is green; logged to deferred-items.md"

patterns-established:
  - "Redaction-safe rejection audit: { reason, attachmentCount, goalHash } — SHA-256 via crypto.subtle in the Convex isolate"

requirements-completed: [INTK-01, INTK-04]

# Metrics
duration: 8min
completed: 2026-07-11
---

# Phase 2 Plan 03: Intake Trust Boundary Summary

Built the intake trust boundary: an authenticated, validated `submit` that either starts the
pipeline workflow or rejects with an auditable "Request Rejected — Validation Failed" outcome
plus an in-app notification (INTK-01, INTK-04), backed by pure/tested validation and the
tenant-scoped reactive queries the UI reads.

## What Was Built

- **`validateSubmit` (pure, TDD)** — `packages/core/src/validateSubmit.ts`. Deterministic
  domain logic (no Convex imports, CLAUDE.md §1) returning `{ ok:true } | { ok:false, reason }`
  across six checks: `empty_goal`, `goal_too_long`, `bad_recipient` (structural email regex,
  not deliverability), `bad_mime` (png/jpg/webp/pdf/mp3/m4a/wav/txt/md/docx allowlist),
  `attachment_too_large` (~10 MiB), `too_many_attachments` (≤5). Caps exported as constants
  for UI reuse (02-08). 8 vitest cases, all green.
- **`requests.submit`** — the single intake door. Validates first; on failure writes a
  redaction-safe `audit request.rejected` event (`reason` + `attachmentCount` + SHA-256
  `goalHash`) and an in-app notification, then returns — **no workflow starts**. On success it
  inserts the `requests` row (status `submitted`, raw goal/recipient in the content plane),
  one `attachments` row per storageId (metadata only — INTK-01), sets `attachmentRefs`, and
  starts `internal.pipeline.pipelineWorkflow` with the DLQ `onComplete` + a redaction-safe
  context payload carrying `requestId` for 02-06's failure path.
- **`requests.generateUploadUrl` / `list` / `get`** — upload-first URL minting; newest-first
  list (optional status filter); single tenant-scoped read.
- **`notifications` module** — `list` (unread-first), `markRead`, and an internal `notify`
  helper the submit rejection (and 02-05's token cron) call. In-app only; OPSG-05 seam.

## Verification

- `pnpm --filter @pikar/core exec vitest run validateSubmit` → 8/8 green.
- `npx convex codegen` (the Convex function TypeScript pass) → exit 0.
- `pnpm --filter @pikar/backend test importGuard` → 10/10 green; now scans `requests.ts` +
  `notifications.ts` and confirms neither imports a raw `query`/`mutation` builder (CLAUDE.md §2).

## Deviations from Plan

### Out-of-scope (logged, not fixed)

**`pnpm --filter @pikar/backend typecheck` fails on pre-existing files.** The package tsconfig
sets `types:["node"]`, dropping vite's `import.meta.glob` ambient types (breaks the static-scan
`*.test.ts` files), and `smoke.ts` hits the known `@convex-dev/workflow` circular return-type
quirk. Proven pre-existing by stashing this plan's new files — HEAD yields the identical
(superset) error set; 02-03 adds zero new type errors, and the real function typecheck
(`convex codegen`) is green. Appended to `deferred-items.md`. No Rule 1–3 auto-fix applies
(unrelated files, not caused by this task).

Otherwise: plan executed as written.

## Self-Check: PASSED
