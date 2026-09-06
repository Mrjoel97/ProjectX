---
phase: 38-tool-registry
plan: 01
status: complete
completed: 2026-09-06
commits: [see the phase-close commit — feat(38-01)]
requirements-completed: []
requirements-pending: []
---

# 38-01 — One tool context, one grant derivation, one validator (scope A)

**Measured before (2026-09-06, tree `dee3f97`).** `llm.ts` 6,947 lines; `buildCockpitTools` took eight
append-only positionals (`ctx, tenantId, planId, clientContext?, skillVersions?, omitRecipientEdits?,
agentContext?, tenantSkillIds?`) with six grant flags inside `agentContext`; `runAgentLoop` derived the
grants inline with three copies of `toolNames === undefined`; presence was decided by three mechanisms
(build-time spreads, the `applyGmailCapability` name filter, the loop's `toolNames` filter). Every input
the loop's own tool build needed had to be declared at four hops, and the record shows two of them
missed (the 19-11 clock, the 21-03 tenant pin — golden run `6e021dce` 0/41).

**What changed.**
- `buildCockpitTools(toolCtx: ToolContext, grants: ToolGrants = NO_GRANTS)`. `ToolContext` = the trusted
  inputs a closure may read (`ctx`, `tenantId`, `planId`, `clientContext`, `skillVersions`,
  `tenantSkillIds`, `threadId`, `rootRequestId`, `evalRevenueFixtureId`). Every conditional spread reads
  a `grants.<bit>`; the `({} as typeof X)` same-type-both-branches trick, the 4-space `name: tool(` keys,
  the tool bodies and the final `applyGmailCapability(allTools, grants.gmail)` line are unchanged.
- `packages/core/src/toolGrants.ts`: `ToolGrants` (eight booleans), `NO_GRANTS` (the bare shims' record —
  recipient + Gmail tools present, nothing granted; NOT the executive), `isRevenueToolGrant` (the identity
  check, moved; `revenueTools.ts` re-exports it), `grantsFor(input)` — the ONE derivation: `dispatch`,
  `skillAuthoring`, `invoiceReminderStage` from `toolNames === undefined`, `revenueReads` from tuple
  identity `||` the eval seam, `webResearch` from the list, `recipientEdits = !omit`, `gmail = enabled ??
  true`. 13 table tests; ten operator mutations each killed (incl. identity → value equality).
- `runAgentLoop` calls `grantsFor` at the one door with `toolNames` in scope, builds from its own args,
  and still applies the exact-name filter LAST. The SMOKE path passes `NO_GRANTS` + `gmail` /
  `dispatch` (direct video only) / `recipientEdits`; `__invokeCockpitTool` builds bare.
- `lib/toolContextArgs.ts` `TOOL_CONTEXT_ARGS` (`skillVersions`, `tenantSkillIds`) spread into
  `runCockpitAgent.args` and `dispatchArgs`; `toolContextArgs.test.ts` scans both doors for the spread and
  for a hand-declared pin drifting back.
- **The byte-identical net, written first:** `toolRegistrySnapshot.test.ts` records the tool KEY SET per
  caller class as hard literals — bare / continue turn / Gmail off / executive with and without lineage /
  continue turn / Gmail off, six specialist routes, seven workflow packs, the revenue eval seam (both
  skills), both SMOKE paths: **23 classes**, `built` and `modelSees` per allow-listed class, keyed by the
  closed `SpecialistRoute` / `WorkflowPackId` unions so a new route or pack without a literal fails
  typecheck. Printed under the OLD signature, green; the refactor rewrote only its one helper and every
  literal held.
- Test migrations: `cockpitTools.test.ts` (15 call sites, the `authoringGrant` helper now splits lineage
  onto the context and grants onto `ToolGrants`), `dispatch.test.ts`, `fixtureSeam.test.ts`;
  `routines.test.ts`'s module list gained `lib/toolContextArgs.ts`; `workflowPacks.test.ts`'s scan that
  quoted the old derivation text now asserts `grantsFor` behaviourally (an allow-list that NAMES
  `dispatchResearch`/`authorSkillCandidate` still gets neither) and scans `toolGrants.ts`.

**One real gap surfaced and closed.** The executive loop never forwarded `tenantSkillIds` to the
specialists its dispatch tools stage — only the SMOKE path did — so an eval run with a tenant pin that
reached `dispatchResearch` through the model-driven loop would have loaded the ACTIVE row while the
evidence claimed the pin. It now rides `runAgentLoop`'s args like every other input of the loop's own
tool build (no key set changes; the snapshot is unchanged). Exactly the defect class the phase exists for,
one door short.

**Execution.** Owner: "ultracode, not more than 5 agents". One workflow: snapshot test ∥ `grantsFor`
(both green) → the refactor agent, which died at 68 tool calls on the account's session limit with its
edits ~90% applied → finished by hand in the main session (4 `noUncheckedIndexedAccess` errors in the new
snapshot test, the core scan to re-anchor, the tenant-pin fix); the two verify agents never ran, so the
gates below were run by the main session directly.

**Verified.** Backend `--shard=1/2` 68 files / 2057 tests + `--shard=2/2` 68 / 1956, both exit 0; the
13 touched backend files 698/698 (then 401/401 on the five the tenant-pin change can reach); core
`workflowPacks.test.ts` + `toolGrants.test.ts` 48/48; web 47/49 files (the two jsdom `xhr-sync-worker`
artifacts of this worktree); `pnpm typecheck` clean (backend `tsc --noEmit` 0 errors); `pnpm lint
--diagnostic-level=error --max-diagnostics=none` exit 0. **Live on the local deployment** (the detached
`convex dev` had gone silent since 05:13 — restarted, pushed 16:22, then): `cockpit-activity` 2/2 (the
SMOKE path), `cockpit-schedule` 3/3 (the pinned clock on the SMOKE path, `awaiting_reauth` on the
staged stale token), `cockpit-created-document` 3/3 (a REAL model turn through `runAgentLoop`'s own
tool build — the `SMOKE::agent::create=` op selects the tool but does not keep the model out of the
loop; `spendEvents` row `agentloop:be18ad68…:a0`, `agent_loop`, `or/openai/gpt-4o-mini`, 16:26 — the loop's own record served the turn).

**Deliberately not done (owner decisions).** The declared registry table (scope B), extracting tool
bodies out of `llm.ts` (scope C — nine test files anchor on its source and are the safety net), the mock
model provider (36-RESEARCH's deferred alternative — G24 is closed by the allowlist), any tool's behaviour,
folding `applyGmailCapability` into a spread (it would regroup twelve inline tools for no property gain;
the filter satisfies ADR-007's absence rule in one line).
