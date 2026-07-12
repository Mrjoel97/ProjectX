# ADR-001: Convex as the data + orchestration plane, with thin adapters over pure-TS packages

- **Status**: Accepted (owner decision 2026-07-09; substrate proven through Phases 1–3.1)
- **Recorded**: 2026-07-12 (backfilled from `.planning/PROJECT.md` Key Decisions and CLAUDE.md §1–2, §6–7)

## Context

Pikar AI needs a database, serverless functions, realtime subscriptions, vector
search, scheduling, and durable workflows — with a private beta due in ~4 weeks and a
solo builder. The alternative was assembling Postgres + Redis + Inngest (plus a
realtime layer). The honest tradeoff review surfaced one real cost: platform lock-in
to a pre-1.0-component ecosystem.

## Decision

Convex is the single data + orchestration plane: DB, functions, realtime, scheduling,
and the Workflow/Agent/RAG/Rate-Limiter/Action-Retrier components.

Lock-in is mitigated structurally, not avoided:

1. **All domain logic lives in framework-agnostic `packages/*`** (contracts, core, pii, …). Convex functions in `packages/backend/convex/` are thin adapters that import those packages, read/write the DB, and orchestrate. (CLAUDE.md §1)
2. **Raw `query`/`mutation`/`action` builders are banned outside `convex/lib/functions.ts`** — feature code uses the tenant-scoped wrappers (`tenantQuery`/`tenantMutation`/`tenantAction`), which inject `tenantId` scoping. Enforced by a Biome import rule + `importGuard.test.ts`. This is the multi-tenant isolation linchpin. (CLAUDE.md §2)
3. **Pre-1.0 components are pinned to exact versions** (no `^`) — API churn is expected; bumps require reading the changelog and re-running the boot check + tests. (CLAUDE.md §6)

## Alternatives rejected

- **Postgres + Redis + Inngest**: portable, but three services to operate solo, no built-in realtime, and weeks of glue the timeline didn't have.
- **UiPath platform**: rejected earlier and separately — enterprise licensing dependency; the BPMN document became the functional spec, not the runtime.

## Consequences

- Velocity and free realtime (the live REPORT card is a plain reactive query, no infra).
- Domain logic is portable and testable without Convex.
- convex-test cannot execute the workflow component — workflow paths are verified by `smoke:*` scripts against a live deployment, not unit tests. Every playbook's "How to verify" section reflects this split.
- Boot order matters: `_generated/` is git-ignored codegen output; a fresh clone must run `pnpm install` → `npx convex dev` → `pnpm dev` (CLAUDE.md §7).
