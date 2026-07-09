# Pikar AI — Repository Conventions

These conventions are binding for every contributor (human or agent). They encode the
architecture and governance decisions that later phases depend on.

## 1. Domain logic lives in pure-TS `packages/*`; `convex/` is a thin adapter

All business logic belongs in framework-agnostic packages under `packages/*` (e.g.
`contracts`, `core`, and later `validation`, `pii`, `cost`, `llm-gateway`, `delivery`, ...).
Convex functions in `packages/backend/convex/` are **thin adapters** that import those
packages, read/write the DB, and orchestrate. This keeps domain logic portable (the lock-in
mitigation) and testable without Convex.

## 2. Raw `query`/`mutation`/`action` imports are BANNED outside the wrapper module

Do **not** import `query`, `mutation`, `action` (or their internal variants) directly from
`./_generated/server` in feature files. Import the tenant-scoped wrappers from
`convex/lib/functions.ts` instead (added in plan 02). A small, explicit internal allow-list
is the only exception. This is enforced by a Biome import rule (plan 02). The wrapper injects
`tenantId` scoping — the multi-tenant isolation linchpin.

## 3. The audit module is insert-only

The `audit` table is an append-only log. The audit module exposes **only insert functions** —
never `patch`, `replace`, or `delete`. True immutability/retention lives outside Convex via a
scheduled WORM export (S3 Object Lock). Do not add mutating audit functions.

## 4. Audit and dead-letter payloads must be redaction-safe

`audit.payload` and `deadLetters.payload` (and all structured log fields) carry **refs, hashes,
ids, and counts ONLY** — never raw user content or PII. Redaction happens before the write
(redact-then-write is a workflow-step ordering contract). The audit log must never become a
PII honeypot.

## 5. No hardcoded agent prompts — skills load from the registry

Agent/LLM prompts are **not** hardcoded in source. They are versioned rows in the `skills`
table (`name`, `version`, `body`, `status`) and loaded at runtime. Prompt changes flow through
the skill registry with rollback, not code edits.

## 6. Pinned pre-1.0 component versions must not be bumped casually

The Convex components (Workflow, Agent, RAG, Rate-Limiter, Action-Retrier) and Convex Auth are
pre-1.0 and pinned to EXACT versions (no `^`). Do not bump them without reading the changelog
and re-running the full boot check + tests. API churn is expected.

## 7. Boot order

`convex/_generated/` is git-ignored and produced by codegen. A fresh clone must run
`pnpm install` -> `npx convex dev` (creates the deployment + codegen) -> `pnpm dev`.
Typecheck fails before `_generated/` exists. See `README.md` for the verbatim steps and the
secrets-plane rules.
