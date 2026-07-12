# ADR-002: Insert-only audit log with redaction-safe payloads; WORM immutability lives outside Convex

- **Status**: Accepted (Phase 1, foundation-governance-substrate)
- **Recorded**: 2026-07-12 (backfilled from CLAUDE.md §3–4, `packages/backend/convex/audit.ts`, `worm.ts`)

## Context

A hard project constraint says every request, redaction, model call, tool execution,
and review action is logged and archived **from day one** — retrofitting audit trails
is not acceptable. Two failure modes had to be designed out:

1. **Mutability**: Convex has no append-only primitive; any code path with `patch`/`delete` access to the audit table can rewrite history.
2. **The PII honeypot**: an audit log that stores raw user content becomes the most sensitive table in the system — and under Google's restricted-scope (`gmail.modify`) rules, a compliance liability.

## Decision

1. **The audit module exposes only insert functions.** `convex/audit.ts` is the sole write surface (`log`, an internalMutation); no patch/replace/delete exists for the table, and no public builder may write it. Enforced by a static scan (`auditImmutability.test.ts`), not convention.
2. **Payloads are structurally incapable of carrying content.** The `AuditPayload` contract type permits refs, hashes, ids, counts, booleans, and string arrays — no nested objects. Redaction (`scanText`) happens **before** the write; raw content lives only in the content-plane tables (`requests`/`plans`). The same rule binds `deadLetters` and telemetry payloads.
3. **True immutability is delegated to a WORM export**: a scheduled daily job exports audit rows to S3 with COMPLIANCE-mode Object Lock. Convex holds the operational copy; S3 holds the tamper-proof one. (Export is currently a stub; the stub must never advance the export cursor — Phase 7 implements the real PutObject.)

## Alternatives rejected

- **DB-level append-only enforcement**: not available in Convex; simulating it in every caller is unenforceable.
- **Storing redacted-but-full content in audit rows**: still a honeypot for anything the scanner misses; refs into the content plane give the same traceability with none of the exposure.
- **Immutability inside Convex only**: anyone with deploy access can mutate; Object Lock in COMPLIANCE mode is the only true WORM guarantee.

## Consequences

- Audit history cannot be rewritten by application code; the static test makes regressions loud.
- Debugging pressure to "just log the content" must be resisted permanently — the pattern is: content in the content plane, ref in the payload. `llmRedaction.test.ts` and `assertNoRawPiiFanout` police this.
- The Object Lock retention *period* is an open decision for Phase 7.
- Nothing is ever deleted in Convex; storage grows monotonically (acceptable at current scale; `by_ts` indexing deferred until export volume demands it).
