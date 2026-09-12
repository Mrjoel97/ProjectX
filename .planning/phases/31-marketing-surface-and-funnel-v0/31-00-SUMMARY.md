---
phase: 31-marketing-surface-and-funnel-v0
plan: "00"
subsystem: planning
tags: [marketing, funnels, consent, owner-decision]
requires: []
provides:
  - Explicit owner-approved A1/B1/C1 semantic contract
  - PROCEED_COMPATIBLE verdict for downstream implementation
affects: [31-01, 31-02, 31-03, 31-04, 31-05, 31-06, 31-07]
tech-stack:
  added: []
  patterns: [aggregate-only funnel attribution, authenticated operator lead recording]
key-files:
  created: [.planning/phases/31-marketing-surface-and-funnel-v0/31-00-SUMMARY.md]
  modified: [.planning/phases/31-marketing-surface-and-funnel-v0/31-VALIDATION.md]
key-decisions:
  - A1 THREE_STAGE_302_PATHS
  - B1 TOKEN_PER_SOURCE
  - C1 AUTHENTICATED_OPERATOR
  - PROCEED_COMPATIBLE
requirements-addressed: [MKTG-01, MKTG-02, MKTG-03]
requirements-completed: []
completed: 2026-09-12
---

# Phase 31 Plan 00: Owner semantic decision

The owner explicitly approved A1/B1/C1. **PROCEED_COMPATIBLE** unblocks implementation; it does not claim the Marketing requirements, live acceptance, or navigation activation are complete.

## Exact decision exchange

Question presented to the owner, preserved verbatim:

> Phase 31’s plan requires an explicit product contract before implementation. Shall I use the planned A1/B1/C1 contract: three visit/claim/download URLs each count raw requests (including bots/retries) and redirect to the same fixed Vault file; a separate token per source fixed when the signed-in operator creates the link; and signed-in operators add leads through existing contact consent/suppression rules, with no public contact form or automatic sending? These counters do not mean unique people or enforce a sequence. Disabling the funnel link cannot revoke a file URL already obtained.

Owner response, preserved verbatim:

> PROCEED_COMPATIBLE — use this A1/B1/C1 contract

The response explicitly incorporates the full presented contract and the named Plan 31-00 options. It is neither silence nor an executor-selected default.

## Normalized implementation contract

| Decision | Approved behavior |
| --- | --- |
| A1 — request grammar | GET `/f/:token/:stage`, with stage exactly `visit`, `claim`, or `download`, on the Convex HTTP plane. Each accepted request atomically increments only its named counter and returns HTTP 302 to the same persisted, trusted Vault file bytes. |
| A1 — counter meaning | Exactly three nonnegative safe-integer aggregate counters per link: `visits`, `claims`, `downloads`. Bots and retries count. They do not identify unique people, measure completed consumption, or require visit → claim → download sequencing. No event or visitor record is created. |
| A1 — refusal | Malformed/unknown stages or tokens, inactive links, and missing/unavailable assets produce the same minimal 404 and no increment. Reject unsafe counter overflow before mutation. Non-GET requests cannot mutate counters. |
| B1 — source persistence | Normalize a bounded source when an authenticated operator creates a link; persist that one source on its link row. Each source link receives a separate unguessable token and its own three counters. |
| B1 — public query | Public `?s=` is bounded input for reporting/redirect continuity only. It cannot override the fixed source, create new keys, add a source map/event row, or choose a destination. Omitting or changing `?s=` does not change attribution on the existing token. |
| C1 — actor and storage | A signed-in operator records a person through an authenticated tenant-scoped adapter into Phase 19's existing contacts store and shared upsert path. No public contact form/write endpoint, second leads table, or shadow CRM is authorized. |
| C1 — origin and consent | Manual operator entry uses existing `user-entered` origin. An explicit per-person consent assertion uses existing `asserted-by-user` semantics, wording/context and server-recorded time; manually entering a lead never implies `inbound-form` provenance. Preserve existing first origin/consent on duplicates; do not overwrite or fabricate prior evidence. Recording alone does not grant outreach permission. |
| C1 — suppression | Preserve the existing suppression store and truthful outbound posture. A suppressed lead remains outbound-blocked; both `executePlan` and final `gmail.send` must refuse it. No automatic sending, sequence, campaign membership, or social publishing is added. |
| File access limitation | Deactivating a funnel stops future successful funnel resolutions. It cannot revoke a storage file URL already issued, a copied URL, or downloaded bytes. UI/runbook copy must state this; do not represent link deactivation as file revocation. |

The token remains a bearer capability: Plans 31-01/02 require 32 cryptographic random bytes, 43-character unpadded base64url encoding, hash-only persistence, and raw disclosure only on creation. Later list responses cannot recover the token. Existing Vault ownership and trusted storage-origin checks remain mandatory.

## Compatibility verdict and boundaries

**PROCEED_COMPATIBLE.** A1 supplies MKTG-02's three counters and stored-byte redirects. B1 resolves source attribution without unbounded attacker-controlled storage or event-level tracking. C1 supplies MKTG-03 through the existing authenticated person store and consent/suppression rules. The authenticated Marketing page remains within MKTG-01: honest channel status and a workspace handoff, without publishing.

The public surface is the link/redirect on Convex only; no Next middleware exception, public contact write, arbitrary redirect, per-visitor analytics, conversion-rate claims, or Phase 32 metrics are approved. Existing authentication is Convex Auth; older plan references to Clerk describe a stale stack, not an instruction to introduce Clerk. Downstream adapters must use the current tenant wrappers.

The permission to implement is complete. Plan 31-07 still requires its actual live evidence and distinct navigation-activation decision. This decision alone is not that acceptance record.

## Verification and handoff

- Read Plans 31-00 through 31-07 and the Phase 31 validation contract.
- Recorded the actual owner question and answer and all four Wave-0 fields.
- Only this decision summary and Wave-0 validation bookkeeping were changed by this task; no application code, production state, or requirement completion checkboxes were changed.
- No code tests were run for this documentation-only decision record. Plan 31-01 owns the first implementation tests.
- No commit was created by this task; the coordinating release owner handles commits.

Wave order: 31-01 contracts/schema/runbook → parallel 31-02 funnel lifecycle and 31-04 contacts adapter → 31-03 HTTP after 31-02 → 31-05 UI after 31-03 and 31-04 → 31-06 automated/full qualification → 31-07 live acceptance and navigation activation.
