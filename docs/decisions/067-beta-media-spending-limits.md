# ADR-067: Beta media spending limits

- Status: Accepted for this isolated source branch, 2026-10-24; not deployed.
- Provenance: the owner explicitly authorises$2,000/day across customers and$100/day per
  customer to accommodate10–20 beta users.
- Supersedes ADR-066's original$10 customer/$100 shared default amounts only. Its exact,
  task-scoped conversation approval and independent shared-service boundary remain.

## Decision

Set the source customer media daily allowance to10,000cents ($100). Set the fallback shared
deployment media daily allowance to200,000cents ($2,000), preserving the existing operator
environment override. These are media-production reservation limits: generated images/video,
audio/transcription and rendering. They are not general chat, research, agent or document
creation budgets. Native per-film$15/60-generated-second admission remains a separate bound.

A batch exceeding the customer's remaining media allowance still requires a fresh, exact
one-task increase in the conversation. Such approval cannot override the shared deployment
limit. Full task costs remain in shared and financial accounting. Neither default guarantees
that a particular number of large batches will fit after other customers have spent money.

Do not reset consumed allowance during activation. New limiter windows use the new limits.
Existing stored bucket balances remain conservative until their natural window reset; raising
source capacities does not manufacture new credit or erase already consumed reservations.
The existing deployment environment may explicitly override the fallback, so release must
verify its nonsecret configured value. Source checks do not establish the live hosted limit.

The separately approved operator testing allowance remains$5. This change makes no paid call,
replays no provider request and changes no credential. Deployment and registry activation remain
separate release work on the isolated branch.

## Verification

Update shared constants and money assertions together. Tests must derive ordinary default
allowances, explicitly preconsume money to exercise overage under the higher limits, prove a
large native batch can request exact extra approval, and prove exhausted shared capacity still
refuses atomically. Preserve task/window/content bindings, no future debt and ordinary spending
history. No test may reset production buckets or infer a live environment value from defaults.
