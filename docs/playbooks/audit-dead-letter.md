# Playbook: Audit Log & Dead-Letter Pipeline

> Last verified: 2026-07-21 against 07-01
> Build history: `.planning/phases/01-foundation-governance-substrate/`, `.planning/phases/03-guardrails/` · Related ADRs: [002](../decisions/002-insert-only-audit.md)

## Purpose

The **audit log** (`audit` table) is the insert-only, tenant-scoped ledger of every
governance event — every request, redaction, model call, tool execution, and review
action, from day one (a hard project constraint). The **dead-letter queue**
(`deadLetters` table) archives failed/canceled workflow runs so failures are never
silent: each dead letter also emits a `deadletter.written` audit event, drives the
request to a `failed` terminal state, and surfaces in the app shell's red badge.

## Key files

- `packages/backend/convex/schema.ts` — `audit`, `deadLetters`, `exportCursors` tables; raw content lives ONLY in `requests`/`plans`
- `packages/contracts/src/audit.ts` — `AuditPayload` type: refs/hashes/numbers/bools/string[] only, no nested objects
- `packages/backend/convex/audit.ts` — the SOLE audit write surface: `log` (internalMutation) + count helpers. No patch/replace/delete exists.
- `packages/backend/convex/deadLetter.ts` — DLQ **writers**: `onPipelineComplete` (workflow onComplete), `deadLetterRecipient` (per-recipient fan-out isolation)
- `packages/backend/convex/deadLetters.ts` — DLQ **operator read/resolve** surface: `newCount`, `listNew`, `markResolved` (tenant-scoped). Distinct file from `deadLetter.ts` — writers vs. readers.
- `packages/pii/src/scan.ts` — the redaction engine: `scanText` → `{ safeText, counts, entities }`; pure TS, fail-closed (see `.planning/design/pii-engine.md`)
- `packages/backend/convex/worm.ts` + `wormCursor.ts` + `crons.ts` — WORM S3 export: daily 03:00 UTC cron, currently a STUB
- Tests: `auditImmutability.test.ts`, `audit.test.ts`, `deadLetters.test.ts`, `worm.test.ts`, `llmRedaction.test.ts`, `packages/pii/src/scan.test.ts`

## Dependencies & blast radius

`graphify query "audit dead letter"`. Nearly every backend module writes audit
(`pipeline.ts`, `llm.ts`, `cockpit.ts`, `gmail.ts`, `deliverApprovedPlan.ts`,
`requests.ts`, `deadLetter.ts`, `smoke.ts`) — changing `audit.log`'s signature or the
`AuditPayload` type touches all of them. Couplings graphify cannot see:
- Workflows must be started with `{ onComplete: internal.deadLetter.onPipelineComplete, context }` or their failures vanish
- `WORM_BUCKET` env (unset ⇒ export is a clean no-op); AWS creds live in the Convex deployment env, not Vercel

## Data flow

1. **Audit write**: any internal mutation/action calls `internal.audit.log` with an already-redacted payload; `log` inserts the row and mirrors it into the `auditCounts` aggregate.
2. **Workflow failure**: `onPipelineComplete` fires on workflow completion; on `failed`/`canceled` it inserts a `deadLetters` row (status `new`), writes a `deadletter.written` audit event, patches the request to `failed`, and writes exactly one `failed` telemetry row (idempotent by correlationId). Success returns early.
3. **Per-recipient failure**: `deadLetterRecipient` does the same for one recipient row inside the fan-out loop, so one bad recipient never poisons the batch.
4. **Resolve**: operator calls `markResolved` (`new → resolved`, idempotent). There is NO replay — the `replayed` status enum member exists in the schema but is deliberately unwritten until idempotency is specified.
5. **WORM export**: daily cron reads audit rows past the cursor and (Phase 7) will PutObject to S3 with COMPLIANCE-mode Object Lock. Today the action is a stub that must NOT advance the cursor.

## Invariants — what must never break

- **Insert-only audit** (CLAUDE.md §3): `audit.ts` exposes only inserts; no `.patch`/`.replace`/`.delete` on audit anywhere; no public builder writes audit. Enforced statically by `auditImmutability.test.ts`.
- **Redaction-safe payloads** (CLAUDE.md §4): audit/DLQ/telemetry payloads carry refs, hashes, ids, counts only — never raw content or PII. Enforced by the `AuditPayload` type (no nested objects), `llmRedaction.test.ts` (static), and `assertNoRawPiiFanout` in `smoke:fanout` (runtime).
- **Redact-then-write ordering**: `scanText` runs BEFORE any log write; only `safeText`/`safeTextHash`/`counts` cross into log planes. Raw `entities` from the scanner are never destructured in llm/guardrails/pipeline code (checked by `llmRedaction.test.ts`).
- **Tenant scoping**: operator DLQ surface goes through `tenantQuery`/`tenantMutation`; cross-tenant `markResolved` rejection and unauth fail-closed are tested in `deadLetters.test.ts`.
- **Stub never advances the WORM cursor** — advancing it would mark unexported rows as exported, a permanent compliance hole. Tested in `worm.test.ts`.
- **DLQ writes idempotent by correlationId** — never a second terminal telemetry row.

## How to change safely

- **New audit event type**: redact first, build a payload of refs/counts only, call `internal.audit.log`. If the writer is a new file, extend `llmRedaction.test.ts`'s scan scope to cover it.
- **New workflow**: always pass `onComplete: internal.deadLetter.onPipelineComplete` with a refs-only `context` payload, or failures are silent.
- **Never** add a mutating audit function, a public audit writer, or a payload field that could carry user content. If a debugging need tempts you to store content, store it in the content plane (`requests`/`plans`) and put the ref in the payload.
- **Implementing real WORM export (Phase 7 / OPSG-03)**: gotchas are documented in `worm.ts` — bucket Object Lock must be enabled at bucket creation, checksum headers required. `@aws-sdk/client-s3` is now installed (07-01) so `worm.ts` ("use node") can import it. The pure serialization/key/retention math lives in `@pikar/core` retention.ts (`serializeAuditNdjson` sorts keys → byte-identical re-export → idempotent PutObject; `wormObjectKey`; `retainUntilDate`/`RETENTION_MS`). The cursor may only advance after a confirmed successful PutObject.
- **DLQ replay**: blocked on specifying idempotency; the `replayed` status is reserved for it.

## How to verify

- `pnpm --filter @pikar/backend test` — immutability scan, audit round-trip, DLQ surface + tenant rejection, WORM cursor safety, redaction static scan
- `pnpm --filter @pikar/pii test` — no raw PII survives into `safeText`
- Live smokes (need a running deployment; workflows don't run under convex-test): `smoke:dlq`, `smoke:fanout`, `smoke:guardrails`, `smoke:pipeline`, `smoke:worm` (see `packages/backend/package.json`)

## Operational notes

- **Unseeded skills dead-letter every request** with `NO_ACTIVE_SKILL: executive-router` — run `skills:seedSkills` (skill names are hyphenated: `executive-router`, not `executive_router`)
- Retention: nothing is ever deleted in Convex; the immutable copy is the (future) S3 export. Object Lock retention *period* is not yet specified — decide it in Phase 7.
- Dead-letter reasons are distinct and explicit (`unknown_route` vs `route_not_implemented`) — never add a silent default reason
- Operator visibility: red badge in the app shell bound to `deadLetters.newCount`

## Known gaps & deferred work

- WORM export is a stub (schedule + cursor + no-op); real S3 Object Lock in Phase 7
- No DLQ replay path yet (`replayed` status reserved)
- The `audit` table now has a global `by_ts` index (07-01) that backs `auditSince` (was a full scan) and the cross-tenant WORM export window
- Not every `audit.log` caller's payload is covered by the static scan (e.g. `gmail.ts`, `deliverApprovedPlan.ts`) — extend `llmRedaction.test.ts` when touching those
