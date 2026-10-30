# ADR-067 — Scheduled preparation for a configured social service

- Date: 2026-10-24
- Status: Implementation and release acceptance in progress; production promotion requires completed acceptance.
- Authority: The owner's October 24 instruction to finish automatic recurrence and the live social pilot before merging to production.

## Decision

Complete a named recurring runtime for the existing built-in social-marketing service. It may prepare local drafts and read selected-account reports through the same Executive, Workflow, native permissions and accounting as attended runs. It never approves, publishes, provisions accounts, dispatches a specialist or activates an instruction. Each user explicitly approves the current goal, operations, skill identity, accounts, schedule, expiry and spending limit. No existing tenant is opted in by deployment.

Reuse the existing pure calendar/timezone implementation. A daily or weekly approval lasts at most thirty days. Persist the next due callback and its exact approval/control/configuration identity; calculate subsequent calendar occurrences from the approved local schedule. A callback cannot supply a new schedule, authorize a different account or revive an old approval. Missed work is skipped rather than accumulated; duplicate, overlapping and uncertain work cannot create a second run.

The standing occurrence reserves the whole run ceiling in the existing tenant and deployment spend limiters. Provider movements remain in the append-only ledger as accounting-only child receipts under that envelope. They cannot debit or refund the limiters twice. Authoritative precise provider usage determines settlement, rounding once at envelope level. Unknown costs or effects preserve a hold. Late settlements after pause or stop cannot revive work, erase a breach or manufacture success.

Changing service terms or permissions invalidates the approval. Pause/Stop cancels the stored callback and independently fences workers. Reconnecting an account does not resume work: the user reviews the current configuration and explicitly approves a new schedule. Known local setup failure can release an untouched allowance; uncertainty requires reconciliation.

## Relationship to prior decisions

This supersedes ADR-063's construction-only restriction for these named managed-social-service modules and their explicit scheduler call sites. The legacy claim-only diagnostic remains disabled. The Phase 29 general-routine defer record, unrelated vertical/workflow qualifications and other scheduler absence controls retain their historical meaning. No general task scheduler or future-content publishing permission is admitted.

The already armed `dstProbe` exports stay unchanged while Berlin and New York remain armed. Actual production Auckland and Lord Howe armed/fired receipts were collected read-only on October 24; their original timestamps, deployment and observation class are retained under the Phase 50 evidence directory. They are elapsed clock evidence, not proof of this new dispatcher's behavior.

## Release acceptance

A code-owned feature gate may be enabled in the staging release candidate so its real native approval and dispatcher can be tested. Environment variables, function arguments and model output cannot enable it. Do not merge the production release until current-source CI, authenticated setup and controls, distinct browser-closed scheduled runs, accounting/recovery and actual authorization-loss/reconnect/explicit-resume behavior have been observed. Preserve exact-content user approval for every real publication. Record remaining or failed checks honestly; source tests and old provider receipts cannot stand in for the complete live social cycle.
