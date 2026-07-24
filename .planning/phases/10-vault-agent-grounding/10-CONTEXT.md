# Phase 10: Vault→Agent Grounding - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

The Executive Agent can retrieve from the user's knowledge vault **mid-conversation** via a
governed `searchVault` tool (VGND-01). This is fundamentally a **wiring** phase: the retrieval
engine already exists (`vaultGround`, built in Phase 5, currently **0 callers**) — Phase 10
exposes it as a read-only agent tool, surfaces the sources to the user, and handles the
empty/no-match case honestly.

**In scope:** the `searchVault` tool inside the cockpit agent loop; the "Searching your vault…"
activity step; the source card; the empty-vault nudge; a cross-tenant isolation assertion (BETA-05).

**Out of scope (own phases):** grounded *voice* discussion of a document → Phase 14 (DOCV-01);
the business-evaluation frameworks that *consume* grounding → Phase 12; auto-grounding every turn.

</domain>

<decisions>
## Implementation Decisions

### Invocation — WHEN the agent searches
- **Model-driven `searchVault` tool.** The agent calls it only when it judges a turn needs the
  user's data (advice, business questions), exactly like `listInbox`/`briefInbox`. No
  auto-ground-on-every-turn — unrelated turns ("add jane@x.com") pay no embedding/retrieval cost.
- Rejected: always-ground (wasteful on composing turns) and a hybrid classifier (more logic to eval).

### Trust boundary — how vault text reaches the loop
- **Hydrated chunk text enters the tool-bearing loop DIRECTLY.** Vault docs are the user's *own*
  uploads — trusted-as-own — so they do NOT go through the toolless-ingestion invariant that
  third-party inbox bodies must. This matches VGND-01's literal "hydrated chunk text" and is one hop.
- **Mark the ceiling.** A `ponytail:` comment names the injection ceiling (a hostile uploaded doc
  carrying instructions) and the upgrade path (route vault chunks through a toolless schema-validated
  digest, mirroring `digestInbox`). Not built now.

### Sourcing — what the user SEES
- **Activity step, then a source card.** While it runs: a "Searching your knowledge vault…" step via
  the existing `agentSteps` (CKPT-05 pattern). After: a **source card** naming the documents the
  answer drew on ("📚 Grounded in N documents") — doc **titles** shown to the user.
- **Each listed doc is clickable → the existing vault `PreviewModal`** opens inline. Reuses a built
  component; note this is a cross-surface wire-up (card lives in the cockpit, `PreviewModal` lives in
  `/dashboard/vault`). If the wiring proves expensive, fall back to a link to the vault page.

### Empty / no-match behavior
- **Fails open** (VGND-01, locked) — an empty/failed search never dead-ends the turn.
- **Honest:** the agent says "I don't have anything in your vault about X" rather than silently
  answering ungrounded.
- **Nudge to upload fires on EVERY no-match search** (user's explicit choice — consistency over
  restraint): the agent suggests uploading a relevant doc so it can ground properly next time.

### Scope / caps
- **Whole tenant-scoped vault, engine defaults.** Reuse `vaultGround`'s existing caps
  (`rag.search` hybrid `limit=8`, `GRAPH_HOP_CAP`). No new type/recency filter knobs (YAGNI).

### §4 audit split (planner invariant — not optional)
- The `vault.searched` audit payload stays **refs-only**: a query **hash** + a result **count**,
  never the raw model query string (it is prose — §4). Doc **titles** go to the UI source card, not
  the audit. This is the same labels-to-loop / refs-to-audit split `listInbox` already uses.

### Claude's Discretion
- Retrieval cap tuning and the chunk char-budget fed into the loop.
- Whether the source card reuses `BriefingCard`/`ResolutionCard` scaffolding or is a small new card.
- `PreviewModal` cross-surface wiring mechanics.

</decisions>

<specifics>
## Specific Ideas

- **Reuse `vaultGround`, don't rebuild retrieval.** It already does hybrid search → doc-id map →
  hop-capped tenant-scoped graph `expand` → `fuse`, with a `SMOKE::` offline seam. The tool likely
  needs a *hydration* addition (return chunk **text** + doc **titles**, not just `{docIds, context}`).
- Source-card idiom: "📚 Grounded in N documents" with clickable titles.
- Activity-step verb idiom (CKPT-05): "Searching your knowledge vault…".

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/backend/convex/vaultGround.ts` — the **engine** (`vaultGround` tenantAction, returns
  `{docIds, context}`; `SMOKE::` seam). Root reuse for the tool; add a text/title hydration path.
- `packages/backend/convex/vaultRag.ts` — the single `rag` instance (`rag.search` hybrid, embed).
- `packages/backend/convex/vaultGraph.ts` — `expand` (hop-capped, tenant-scoped graph traversal).
- `packages/vault/src/index.ts` — pure `fuse`, `GRAPH_HOP_CAP`, `VectorHit`.
- `packages/backend/convex/llm.ts` — `buildCockpitTools` (~L607); add `searchVault` following the
  `listInbox`/`briefInbox` tool pattern (validated args → `internal.*` action → refs-only audit via
  `correlationId: planId` → capped string return into the loop).
- `packages/backend/convex/agentSteps.ts` — the append-only step rows for the "Searching…" activity
  step (CKPT-05).
- `apps/web/app/(app)/dashboard/vault/PreviewModal.tsx` (+ `DocGrid`, vault `page.tsx`) — the
  click-through target for the source card.
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — where the source card renders alongside
  PLAN/BRIEFING/RESOLUTION cards.
- `packages/backend/convex/audit.ts` `log` — insert-only, refs-only.

### Established Patterns
- **Read-only tool shape** (two-shapes rule): validated args → `internal.*` action → refs-only audit
  → capped string return. No plan/Approve gate for a read.
- **labels-to-loop / refs-to-audit** split (`listInbox`): user-facing labels/titles reach the
  loop/UI; only refs/hashes/counts reach the audit payload.
- **`SMOKE::` offline seam** — `vaultGround` already bypasses the embedding network for
  deterministic tests; the `searchVault` tests ride it (no `OPENAI_API_KEY`).
- **Tenant isolation** — `namespace = ctx.tenantId` on `rag.search` and tenant-filtered `expand`
  already prevent cross-tenant retrieval; BETA-05 asserts it for this surface.

### Integration Points
- `searchVault` registered in `buildCockpitTools` (`llm.ts`).
- Source card wired into `workspace/cards.tsx`; `agentSteps` step emitted from the tool.
- **Likely eval-gated:** a new tool + teaching the agent when to call it is a `cockpit-agent`
  skill-body/guidance change → rides the Phase 3.6 eval gate (seed candidate → `pnpm eval:golden`
  → activate) with a new golden fixture for a grounded turn. Confirm during planning (per the 3.9
  precedent: code-only instrumentation skips the gate; a new tool/description does not).
- **BETA-05:** a two-tenant assertion that tenant A's `searchVault` never returns tenant B's chunks.

</code_context>

<deferred>
## Deferred Ideas

- **Grounded voice discussion of a document** — Phase 14 (DOCV-01). Phase 10 grounds the *cockpit
  tool loop* only.
- **Toolless vault digest** — the injection-ceiling upgrade path if hostile uploads ever matter;
  marked by a `ponytail:` comment, not built.
- **Type/recency retrieval filters** on `searchVault` — considered, deferred (YAGNI).
- **Always-ground / hybrid-classifier invocation** — considered, rejected in favor of model-driven.

</deferred>

---

*Phase: 10-vault-agent-grounding*
*Context gathered: 2026-07-24*
