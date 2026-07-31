# Phase 20: Media Canvas - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning
**Source:** Owner decisions taken at `/gsd:plan-phase 20`, on top of the discharged spike
(`20-SPIKE.md`), the provider evaluation (`20-PROVIDER-EVAL.md`) and ADR-011.

<domain>
## Phase Boundary

Phase 20 delivers **image and short-form video generation as async, governed, separately-capped
jobs**, reached through the dispatch spine as a new `media` specialist route.

**In scope:**
- A new `media` entry in `SPECIALIST_ROUTES` (`packages/core/src/specialists.ts:23-28`) with its
  own ADR, skill registry row, `stepTool` literal and capability-grant review.
- A media price table in code, modelled on `packages/cost`, failing closed on unknown model.
- A separate named rate-limiter window + its own kill-switch, never folded into the token budget.
- A fal.ai adapter action (`FAL_KEY` deployment secret) submitting to fal's queue with a
  `webhook_url`, and an **authenticated** callback route on `convex/http.ts`.
- Tenant-scoped asset refs, refs-only audit, and a media isolation assertion.
- A documented price-table reconciliation step + a `ponytail:` ceiling comment.

**Out of scope (explicitly):**
- Video longer than **15 seconds**. This is a MODEL ceiling across 28 models from eight labs, not
  a provider limitation (ADR-011). Multi-minute output exists only by ASSEMBLY (concatenating
  clips) or by re-cutting existing footage — both are different features.
- Any OAuth / refresh-token machinery. `gmailAuth.ts`'s token store, rotation and crown-jewel
  handling are NOT copied. An API key in a deployment secret is the whole auth story.
- The Pikar-Ai MCP. It is a claude.ai **client-side** account connector, absent from `.mcp.json`
  and structurally unreachable from a Convex action. There is no backend token-exchange to build.

</domain>

<decisions>
## Implementation Decisions

### D1 — Surface: a new `media` specialist route (LOCKED, owner, 2026-08-01)

Media is reached by DISPATCH, not by a standalone canvas page and not by a cockpit tool. This is
the heaviest of the three options considered and was chosen deliberately for future
agent-orchestrated media.

Consequences the planner must carry:
- `"media"` is added to `SPECIALIST_ROUTES`. That file's own comments (lines 10-22) make widening
  the dispatchable set **ADR territory** (see ADR-009, ADR-010). **A new ADR is required** and is
  part of this phase's deliverable, not a follow-up.
- A new `SpecialistSpec.stepTool` literal (`"dispatchMedia"`) joins the closed union at
  `specialists.ts:39-43`, and `agentSteps.tool` must accept it.
- A new versioned `skills` registry row carries the media specialist body (CLAUDE.md §5 — no
  hardcoded prompts).
- The `SPECIALIST_TOOLS` capability grant is reviewed, not silently widened (see D2).

### D2 — The media specialist PROPOSES; it never GENERATES (LOCKED — invariant preservation)

`specialists.ts:46-57` states the grant is `searchVault` **only**, because "every write stays
behind the ONE human Approve gate", and it records `evaluateBusiness` as *deliberately refused*
for persisting rows and re-entering the engine mid-dispatch.

A media tool that called fal.ai from inside a dispatch would be strictly worse than the thing that
comment already rejects: it spends **real dollars** with no human in the loop, and it would falsify
roadmap SC #3 ("an agent or injected content cannot fire generation without human approval").

Therefore:
- The media specialist stays **read-only**. It emits a media **step into a plan**, returning prose
  plus a structured proposal — nothing more.
- The fal adapter fires from the **post-`approved`** execution path only, reusing the shipped
  lifecycle in `plans.ts:18` (`collecting → proposed → approved → (scheduled|delivering) → done`).
- "Plan-gated by construction" is satisfied **structurally** — there is no code path from a
  dispatched specialist to a paid generation.
- Do NOT "fix" this by adding a generate tool to `SPECIALIST_TOOLS`.

### D3 — Provider and model (LOCKED by ADR-011)

- Provider **fal.ai**; default model **Wan 2.5** (~$0.05/s). Replicate is the recorded fallback.
- Auth: one `FAL_KEY` Convex deployment secret.
- Async: fal queue + `webhook_url` → `convex/http.ts` (which already hosts the Gmail OAuth callback).
- **Exact per-model rates MUST be re-read from fal's live pricing page when the adapter is
  written.** The figures in ADR-011 §"Why Wan 2.5" are indicative, sourced from third-party
  comparisons, not from the vendor API. This is open work under roadmap SC #1.

### D4 — Budget numbers (LOCKED, owner, 2026-08-01)

| Constant | Value | Rationale |
|---|---|---|
| media per-request cap | **$1.00** | A 15 s Wan 2.5 clip is ~$0.75 → passes with headroom. Veo 3 (~$6.00) and Seedance 1080p (~$10.23) fail closed. |
| media daily cap | **500 cents ($5.00/day)** | Mirrors `DAILY_BUDGET_CENTS` exactly, for symmetry and easy reasoning. ~6 clips/day. |

- Worst-case daily exposure is **$5 media + $5 text = $10**, across two rails that never share a
  window. `budgetUsdPerRequest = 0.05` is NOT reused — it would refuse every clip (ADR-011).
- The daily media window must be **keyed per tenant**, matching the correction Phase 22.1-02 just
  landed on `dailySpendCents`. Do not ship a second keyless deployment-wide window; that is the
  exact defect 22.1-02 existed to close.

### D5 — Reconciliation (Claude's discretion, per ponytail §8)

Roadmap SC #5 requires a documented reconciliation step, not an automated one. The laziest
solution that works: a documented **manual** procedure in the media playbook (compare recorded
spend against fal's actual invoice/balance) plus a `ponytail:` comment naming the ceiling and the
upgrade path. No cron, no `/ops` panel, no reconciliation table unless evidence demands it.

### Claude's Discretion
- Which fal image model joins the price table alongside Wan 2.5 (pick from fal's live pricing page
  at implementation time; the phase goal names images as well as video).
- Webhook authentication mechanism — signature verification vs a secret path segment. **Match what
  `http.ts` already does for the Gmail callback** rather than inventing a third pattern.
- Table/schema shape for media jobs and assets, and where the isolation assertion lives.
- Plan/wave decomposition.

</decisions>

<specifics>
## Specific Ideas

**Reuse map (from `20-PROVIDER-EVAL.md` §2 — this is assembly, not invention):**

| Need | Existing pattern to reuse |
|---|---|
| Pre-flight per-request cap | `chooseModel` + `budgetUsdPerRequest` (`guardrails.ts` `DEFAULT_CONFIG`) |
| Price table, fail-closed on unknown model | `packages/cost` `estimateCostUsd` / `unknown_model` |
| Separate daily cap | a second **named** rate-limiter window beside `dailySpendCents` (`guardrails.ts:23-28`) — the component already supports named windows |
| Own kill switch | the `guardrailConfig` single-row upsert pattern (`setKillSwitch`) |
| Record actual spend | `recordSpend`'s `reserve: true` semantics |
| Async job + callback | `convex/http.ts` (already hosts the Gmail OAuth callback) |
| Human gate | the `plans.ts` `proposed → approved` lifecycle, reused verbatim |

**Open questions carried from `20-PROVIDER-EVAL.md` §5 — resolve in RESEARCH, not in execution:**
1. **Moderation verdict ref (SC #4).** Confirm whether fal returns a moderation/safety signal. If
   it does not, decide what the audited "verdict ref" honestly is. **Do not invent a verdict.**
2. **Webhook authenticity.** An unverified callback is an unauthenticated write endpoint.
3. **Price-table drift cadence** and where the `ponytail:` ceiling comment lives.
4. Live fal rates (see D3).

**Governance constraints that bind this phase:**
- CLAUDE.md §2 — no raw `query`/`mutation`/`action` imports; use the tenant wrappers.
- CLAUDE.md §4 — audit carries asset id/hash + verdict ref ONLY. Never the asset, never its URL.
  A signed fal URL in an audit row would be both a PII/content leak and a live credential.
- CLAUDE.md §5 — the media specialist body is a registry row, not source.
- CLAUDE.md §9 — a new playbook for the media subsystem, registered in
  `docs/playbooks/watch.json`, or the Stop hook blocks the phase.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-minute video by assembly** (concatenating ordered clips, e.g. an explainer built from
  blocks) — a different feature from generation. Out of scope per ADR-011.
- **Re-cutting footage the user already has** — likewise a different feature.
- **A premium model default (Veo 3 / Seedance).** Reversible later as a price-table entry behind a
  deliberately raised cap and an explicit owner decision — never as a default (ADR-011).
- **Automated reconciliation** (cron or `/ops` panel). Evidence-gated on the manual step actually
  proving drift. See D5.
- **Agent-orchestrated media chains** — the reason D1 chose the specialist route, but the
  specialist stays proposal-only in this phase (D2).

</deferred>

<sequencing>
## Execution Gate (NOT a planning gate)

D1 requires a new versioned `skills` registry row and touches the gated-skill layer. Per
`.planning/STATE.md`, `cockpit-agent` is a GATED skill with ONE candidate stream that Lane R holds
un-activated at v16, and Phase 18 must edit that same body. Phase 18 → 19 already run SERIAL by
owner decision (2026-07-31).

**Planning proceeds now. Execution serializes behind Phase 16 closing**, exactly as Phase 18 does.
The planner MUST state this gate in the plan frontmatter/notes rather than leaving a lane to
discover it. If the media specialist body can be shown to be a NEW registry row that never touches
the `cockpit-agent` body, the planner should say so explicitly — that would narrow the gate to the
dispatch-surface edits alone (`specialists.ts`, `agentSteps.tool`), which is a much smaller
contention.

</sequencing>

---

*Phase: 20-media-canvas*
*Context gathered: 2026-08-01 via /gsd:plan-phase owner decisions*
