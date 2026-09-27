# 47-12 OAuth and provider-read evidence review — live checkpoint pending

Reviewed 2026-09-24 at 18:04 UTC against the current collector (SHA-256 `8be7d2185d723fdb5d37b6e406a9d8f828bb6ab07b50e634f8e4b5c902c3aae6`, worktree HEAD `dd6ffca`), `gmailAuth.ts`, `gmail.ts`, `tokenExpiry.ts`, the unchanged [29 recurrence decision](../29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md) §7, and [47-10's verified target](47-10-TARGET-CHECK.md). This is a semantic and offline-safety review, **not live OAuth or provider-read evidence**.

## Access-token false positive: refused

`COLLECTORS["oauth-expiry-reauth"]` reads only the count/clock-only grant-state precondition. An unexpired access token refuses; an expired access token also refuses with the explicit reason that silent refresh cannot prove seven-day grant expiry, user reconnect or absence of a catch-up burst. In the expired branch it does **not** invoke `listInbox`. The self-check drives a stub whose first `expiresAt` is past and second would be future, asserts the collector returns `observed:false`, asserts exactly one grant-state call, and rejects any `listInbox` call. The artifact writer runs only for `observed:true`.

`node packages/backend/scripts/collect-recurrence-evidence.mjs --self-check` exited **0** on this source at this checkpoint. This is offline proof of the refusal, not a live trace. No OAuth collector live probe, provider read or artifact write was attempted. The correction is already present in the worktree; this review did not edit the collector.

## What the product can and cannot prove today

The current Gmail testing-mode refresh clock is `gmailTokens._creationTime + 7 days` (`packages/core/src/tokenExpiry.ts`); access-token `expiresAt` is a different, shorter clock. Fresh consent replaces the token row and retires the reconnect notice, but `gmailAuth.store` explicitly leaves existing `awaiting_reauth` requests untouched. `gmailAuth.grantState`, the collector's safe read surface, returns only `{present, real, expiresAt}`—not the refresh grant creation time, a dated human reconnect event, or held-work/no-burst state. Under the accepted `defer` branch there is deliberately **no `routines` table or routine runtime** (`packages/backend/convex/schema.ts`), so §7's literal requirement that a *routine* move to `awaiting_reauth` and later avoid a catch-up burst cannot be witnessed in this product state. A normal Gmail send held at `awaiting_reauth` would not substitute for that scheduled-routine trace. The `oauth-expiry-reauth` matrix row therefore remains **missing** even if an access token refreshes or a user reconnects Gmail.

The `provider-read` collector has a narrower attainable path: an operator supplies one exact tenant; `gmailAuth.grantState` refuses absent or fixture grant; `gmail.probeReadCount` invokes the app's `listInbox` with `range:"today"` and `maxResults:3` and returns only `{ok,count}`; the adapter refuses `ok:false`. Its output artifact can contain only provider name and item count. This is designed to avoid printing message metadata, but no owner-designated production tenant and real grant have been recorded for this checkpoint. A general approval to continue work does not identify whose mailbox to read. No tenants were scanned to choose one, and no provider request was made.

## Live observation boundary and reviewer verdict

| Required fact | Current verdict | Defensible next observation |
| --- | --- | --- |
| Real seven-day refresh-grant expiry | **missing** | A dated, refs-only grant lifecycle trace under a specifically reviewed tenant; do not force expiry or copy a token. |
| Explicit user reconnect | **missing** | Human-confirmed fresh consent event on that same tenant, separate from silent access refresh. |
| Routine held and no catch-up burst | **not currently observable under `defer`** | Resolve the governance-order conflict before designing a non-exposed routine evidence stage; no Gmail-send proxy. |
| Unattended real provider read | **pending tenant/grant designation** | With one owner-designated production tenant and grant, reverify target, run the existing count-only collector once in a fresh empty output directory, then independently review its app-path audit/return. No send. |

Reviewer of this offline analysis: Codex. Human designation of the production tenant/grant, the exact read boundary, and acceptance of any future live traces: **pending**. The historical `provider-read: pass/live` summary in the 29 artifact remains unchanged, but the current gate rejects it as a non-collector artifact, and §7 asks for an additional unattended read. Plan 47-13's decision packet, not this dossier, owns any governance-order choice. No `provider-read.md`, `oauth-expiry-reauth` artifact or Plan 47-12 summary is created from this refusal.
