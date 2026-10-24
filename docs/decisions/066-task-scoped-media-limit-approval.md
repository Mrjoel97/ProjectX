# ADR-066: Conversation approval for a media batch's daily-limit increase

- Status: Accepted for this isolated source branch, 2026-10-24; not deployed.
- Provenance: the owner chose customer-approved limits with a $10/day default, then specified
  that an over-limit media batch must ask for the required increase in the conversation and
  that approval applies to that task.

## Decision

Keep the ordinary customer media allowance at $10/day. A ready batch that exceeds its remaining
allowance displays the reviewed batch cost, remaining allowance and exact extra amount needed
in the conversation. Only the explicit human approval action can supply that one-time increase.
The agent's staging tools cannot approve their own request. Browsing or planning never reserves
media generation. The existing media review and campaign maximum remain required.

Consent binds the owned campaign, exact reviewed child content and native pricing profile,
selected items, maximum cost and daily window. Fresh reservation recalculates all estimates,
remaining allowance and required extra amount. A changed window, changed amount, stale review,
unconfirmed claim or unknown purchase refuses before buying anything. A paid selective retry
needs a fresh approval; a completed item is never included as an implicit retry.

The increase exists only as a private, bounded allowance inside the atomic campaign reservation
transaction. Each child consumes what fits in the ordinary daily bucket and the exact remainder
from that task allowance. Full cost still consumes the shared deployment budget and is recorded
in the spend ledger. The ordinary bucket never becomes negative, so this does not borrow future
days or reset consumed allowance. Nothing is left as reusable credit for another task. Persist
only the auditable decision facts (campaign reference, cents, window and counts), not a reusable
bypass flag. Normal direct generation has no task-overage argument.

Shared service capacity is independent. Preflight the entire selection against its remaining
deployment allowance before asking for a customer increase. The source default is $100/day
across customers, configurable only through the existing operator environment setting; customer
approval cannot increase it. Therefore the 15-deliverable structural maximum does not promise
that every 15-film premium batch fits the deployment's configured spending limit. Show the
shared-limit refusal and keep work paused instead of accepting unusable customer consent.

Read snapshots advance the component's stored fixed-window state to the current time without
mutating it. Uninitialised and naturally reset windows must produce stable review identities.
Do not silently reset the limiter to make a batch affordable.

## Verification and limits

Test over-limit refusal with zero jobs/movements, exact approval, scope isolation, stale amount
and window refusal, no global-limit bypass, no future debt, new-day reset, whole-batch rollback
and selected retries. Exercise native30/45/60s films mixed with images through the actual batch
estimator/reserver and queue. Render the conversation question and verify only its explicit
click sends the reviewed amount/window. Existing two-active-deliverable queueing, at most15
items, cancellation, unknown-outcome holds and ready-output downloads remain.

This changes source approval/admission only. No customer charge, paid test, live budget update,
registry activation or deployment is authorised by these tests. The original $5 operator testing
allowance remains separate. Product and voice reference continuity remains qualification work.
