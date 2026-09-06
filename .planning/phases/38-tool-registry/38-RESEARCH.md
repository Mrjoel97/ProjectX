# Phase 38 — Tool registry (Track C step 10, 08-24 note §3) — RESEARCH

- **Measured**: 2026-09-06, tree `dee3f97` (main, Phase 37 closed)
- **Trigger**: merged rev-5 audit §5, Track C step 10 — "Tool registry (08-24 §3) before the next heavy
  `llm.ts` phase". The next heavy `llm.ts` phases in the order are Track C step 11 (research engine G4,
  Document Canvas G5, durable runs G6/G10) — each adds tools and loop inputs, which is exactly what this
  phase makes cheap and safe.
- **Status**: research only — no code. Owner decisions at the end.

## 1. What the audit claimed, re-measured

| 08-24 claim | Today (dee3f97) |
|---|---|
| `llm.ts` is 6,382 lines | **6,947** lines; 66 commits since 2026-08-01 (the most-edited file in the repo) |
| `buildCockpitTools` takes 7 append-only positional args | **8** — 21-03 appended `tenantSkillIds`. Signature: `(ctx, tenantId, planId, clientContext?, skillVersions?, omitRecipientEdits?, agentContext?, tenantSkillIds?)`; the function body runs `llm.ts:1744–4416` (2,672 lines) |
| grants derived 3× from `toolNames === undefined` | Still **3** (`grantDispatch`, `grantSkillAuthoring`, `grantInvoiceReminderStage` at `:4627–4636`), plus `grantWebResearch` from `toolNames?.includes(...)`, `grantRevenueReads` from an IDENTITY check on the frozen core tuple (`isRevenueToolGrant`, `revenueTools.ts:65`) |
| "registry = declared `{name, schema, handler, requires, grantedTo}`" | Nothing declares a tool's grant beside the tool. Presence is decided in **three different mechanisms** (below) |

**The tool set.** 35 `name: tool(` keys inline in `buildCockpitTools`, plus seven built out-of-line and
spread under a flag: `webResearch` + `declareUnsupported` (`buildWebResearchTool`, `:435`), `saveAsDocument`
(`:509`), `readRevenueCrm` / `readBusinessFinance` / `declareUnsupported` (`buildRevenueTools`,
`revenueTools.ts:284`), `stageInvoiceReminder` (`buildInvoiceReminderTool`, `invoiceReminders.ts:167`).
The `agentSteps.tool` closed union in `schema.ts` carries 46 literals and must name every key (the
swallowed-step trap, `cockpitTools.test.ts:2062`).

**Three presence mechanisms, one record:**
1. **Structural absence at build time** — a conditional spread reading an `agentContext` flag
   (`grantWebResearch`, `documentIsDeliverable`, `grantDispatch` + lineage, `grantSkillAuthoring` + lineage,
   `grantRevenueReads`, `grantInvoiceReminderStage`) or the 6th positional (`omitRecipientEdits`).
   `llm.ts:2386–2440`.
2. **Post-build name filter #1** — `applyGmailCapability(allTools, gmailEnabled ?? true)` strips the
   `GMAIL_TOOL_NAMES` set (`cockpitCapabilities.ts:136–165`) from the finished record. `llm.ts:4415`.
3. **Post-build name filter #2** — `runAgentLoop` filters the returned record by `toolNames`
   (`:4649–4651`; `=== undefined` ⇒ the executive's full record, `[]` ⇒ empty).

All three end in the same property ADR-007 requires (the key is ABSENT from the record, so `ai@7` throws
`NoSuchToolError` before any `execute`), so none is wrong — but the rule "who gets what" is spread across
`agentContext` (6 flags), one positional, one name-set in another file, and one derivation block in the
loop. That spread is the defect class.

## 2. The defect class this phase deletes (four incidents, one shape)

`runAgentLoop` builds its own tool set (`:4611`), so **every input `buildCockpitTools` consumes must be
declared four times** to reach a live turn: the entry-point validator (`runCockpitAgent.args` and/or
`dispatchArgs`) → `runAgentLoop.args` → the positional/`agentContext` slot → the tool closure. Missing any
one is silent:

| Incident | Missing hop | Cost |
|---|---|---|
| Clock plane (19-11, memory `clock-plane-dead-in-production`) | `clientContext` never passed from `runAgentLoop` to `buildCockpitTools` (4th positional sat `undefined`) | `setSendTime`, `checkAvailability`, `proposeCalendarEvent`, dated follow-ups refused on EVERY live turn; unit/SMOKE/eval all green because `__invokeCockpitTool` passes a clock directly |
| `tenantSkillIds` (21-03) | declared on `runSpecialistTurn`, absent from `runCockpitAgent.args` | golden run `6e021dce` died 0/41 at the validator door |
| `omitRecipientEdits` (UAT-F2) | threaded by hand through three signatures | worked, but only because someone remembered |
| `skillVersions` (EVAL-01) | same | same |

Today the comments at `:4529–4535` and `:5586–5598` are the guard. Prose is not a guard (the corpus says so
itself at `cockpitTools.test.ts:2062`).

## 3. What already exists (ladder rung 2 — reuse before writing)

- **Agent-side grants as code-owned name lists** — `SPECIALISTS[route].tools` (`packages/core/src/specialists.ts`,
  ADR-007), `toolsForWorkflowPack(packId)` derived from the pack op matrix (27-02), the revenue tuple by identity.
  Consumers: `dispatch.ts` ×5, `workflowPackBinding.ts:386`, `runRevenueCandidateEval`. **Keep.** ADR-007's
  reasoning (a DB row must never widen a capability; a prompt is not a boundary) is untouched by a registry.
- **Out-of-line builders returning `ToolSet`** — the four listed above are already the per-tool "declaration"
  shape: a function of `(ctx, tenantId, planId, …)` returning `{ name: tool(...) }`.
- **A name-set filter** — `applyGmailCapability` is a registry predicate written as a post-filter.
- **The type trick** — every conditional spread uses `({} as typeof X)` so both branches share ONE static
  type; the comment at `:2401–2405` says a union of differing shapes widens the record to an index signature
  and degrades the `onToolExecution*` event types. Measured: the callbacks (`:4735–4760`) read only
  `toolCall.toolName`, `toolCall.toolCallId`, `toolOutput.type`, `toolExecutionMs` — all present on the
  dynamic-tool event variant too — so a `ToolSet`-typed registry is *probably* fine, but this is a
  typecheck-time fact to prove in the first hour, not assume.

## 4. Proposed shape (recommended = scope A)

**A. Context + grants object, one derivation, one validator (the minimum that deletes the class).**

1. `type ToolContext = { ctx, tenantId, planId, clientContext?, skillVersions?, tenantSkillIds?, threadId?,
   rootRequestId?, evalRevenueFixtureId? }` — the trusted inputs a tool closure may read. ONE object replaces
   eight positionals; a new input is a new optional field, added in one place.
2. `type ToolGrants = { executive, webResearch, documentIsDeliverable, revenueReads, invoiceReminderStage,
   recipientEdits, gmail, lineage }` — booleans only, computed ONCE by a pure `grantsFor({ toolNames,
   evalRevenueFixtureId, omitRecipientEdits, gmailEnabled, documentIsDeliverable, hasLineage })` in
   `packages/core` (Convex-free, table-testable). This is where the three `toolNames === undefined` sites
   collapse to one `executive` bit, and `isRevenueToolGrant` moves in beside it.
3. `buildCockpitTools(toolCtx, grants)` — two args. Every conditional spread reads `grants.x`; the Gmail
   post-filter becomes one more spread (`grants.gmail`), so mechanism #2 folds into #1 and the record is
   built right rather than built wide and pruned. The `toolNames` filter (#3) stays as the LAST step in
   `runAgentLoop` — it is the ADR-007 allow-list and is already one line.
4. **One shared args validator** — `TOOL_CONTEXT_ARGS = { clientContext, skillVersions, tenantSkillIds }`
   (Convex `v.*` optionals) spread into `runCockpitAgent.args`, `dispatchArgs`, and the two test shims. The
   21-03 incident becomes impossible by construction: a field added there appears at every door.
5. Callers to migrate: `runAgentLoop` (`:4611`), the SMOKE path (`:5745`), `__invokeCockpitTool` (`:5932`),
   `dispatch.test.ts` ×1, `cockpitTools.test.ts` ×15 positional calls.

**B. A + a declared registry table.** Each conditional group becomes a row `{ tools: () => ToolSet,
present: (g: ToolGrants) => boolean }` and `buildCockpitTools` is a `for` over the rows. The 08-24 wording
("filtering becomes a filter over declarations") is literally this. Adds one table and re-anchors the
4-space `\n {4}name: tool(` scan; buys a single place to READ the grant rules. Tool bodies stay where they
are.

**C. B + extract tool bodies to files** (`convex/tools/*.ts`, plain modules imported only by `llm.ts`).
Moves ~2,700 lines; re-points anchors in **9 test files** that read `llm.ts` source (`cockpitTools`,
`llmRedaction`, `dispatchGuard`, `dispatch`, `cockpitBlueprint`, `routines`, `runCockpitAgent`, `skills`,
`workflowPacks`) — those scans ARE the safety net for invariant 10 (toolless ingestion), refs-only audit, the
closed union and the "one tool-bearing `generateText`" rule. Also walks the node-module boundary (a plain
module importing `pdf-lib`/the OpenAI provider is safe ONLY while nothing outside `"use node"` imports it —
the `foglamp.ts` incident, cockpit.md:1189). Weeks of anchor surgery for no behaviour change; **not
recommended now**. The right time is when a tool file has a second consumer.

**Recommendation: A**, with B's table only if it costs no second mechanism (decide in the first plan task
after the typecheck probe in §3). A deletes the defect class; B makes the rules readable; C is churn.

## 5. Constraints the plan must honour

- **ADR-007 stands**: grants are code-owned; `toolNames` is a REQUEST from the caller, never a source of an
  executive-only capability. `grantsFor` must keep `executive = toolNames === undefined` and never read
  `toolNames.includes("authorSkillCandidate")`-style names for gated tools. The revenue identity check stays
  an identity check.
- **Structural absence, not `activeTools`** (ADR-007, `:4652–4657` ponytail note). The filter order is
  build-with-grants → allow-list, never the reverse.
- **The closed union**: 46 `agentSteps.tool` literals; the tripwire needs > 20 keys matched by its regex —
  if B changes the indentation of `name: tool(`, the scan is re-anchored in the same commit, not loosened.
- **Byte-identical key sets per caller class** — the executive (with/without Gmail, with/without lineage,
  continue turn), each of the six `SPECIALISTS`, each pack via `toolsForWorkflowPack`, the revenue eval seam,
  the SMOKE path, `__invokeCockpitTool`. Snapshot the key sets BEFORE the change (one test file), and the
  refactor must reproduce every snapshot. This is the phase's one runnable check.
- **The one `"use node"` module** rule (agent-runtime invariant 7). Scope A/B adds no module; `grantsFor`
  lives in `packages/core`.
- **Not in scope**: the mock model provider behind `lib/models.ts` (36-RESEARCH named this phase as its
  natural home; G24 was closed by the allowlist instead and no consumer asks for it — see decision 3);
  workspace identity (Track C step 12); any tool's behaviour.

## 6. Verification plan

1. **Snapshot first**: `toolRegistry.test.ts` records `Object.keys(...)` for the eleven caller classes above
   against the CURRENT signature; commit it green before touching `buildCockpitTools`.
2. Refactor; the snapshot test must stay green unchanged (a diff in any key set is a behaviour change and is
   refused).
3. `grantsFor` table test in `packages/core` (every input axis × the eight outputs), mutation-checked by
   flipping each `===`/`||` once.
4. The shared-validator proof: a test that reads `runCockpitAgent.args`, `dispatchArgs` and the shims and
   asserts they carry the identical `TOOL_CONTEXT_ARGS` keys (the "same pair of scopes, stated the same way"
   comment at `:5584` becomes a check).
5. Existing gates: backend both shards, `cockpitTools.test.ts` (3,270 lines, 15 migrated calls),
   `dispatch.test.ts`, `llmRedaction.test.ts`, `dispatchGuard.test.ts` all green with anchors re-pointed
   where the code moved; repo typecheck; `pnpm lint --diagnostic-level=error`.
6. Live: one cockpit turn on the local deployment with a clock (send-time set), one `SMOKE::agent::` op, one
   dispatched specialist — the clock-plane lesson says a browser turn is the only test that sees all four
   hops connected.

## 7. Size

Scope A: ~1.5 days (signature + 19 call sites + `grantsFor` + validator + snapshot test + anchors).
Scope B: +0.5 day. Scope C: +1–2 weeks of anchor surgery. Docs: agent-runtime.md (the tool checklist step 2
changes shape), cockpit.md, a new ADR only if decision 2 inverts the grant model.

## 8. Owner decisions

1. **Scope**: A (recommended) · B · C.
2. **Grant model**: keep agent-side name lists (ADR-007) and add tool-side `requires` predicates
   (recommended — no ADR change), or invert to tool-side `grantedTo` sets (supersedes ADR-007 with a new ADR).
3. **Mock model provider** (36-RESEARCH's deferred alternative): out of this phase (recommended) or in.
