# 29-10 — SUMMARY: the authenticated pack + manual-rerun release gate

**Status: EXECUTED AND GREEN, with two plan criteria recorded as NOT MET rather than faked.**
Executed by the orchestrator on 2026-08-30 against a live local stack, after the agent assigned to
this plan died producing nothing (`API Error: Connection lost mid-response`).

Commits: `75d8bd1` (the two specs + playbooks), `a17ba59` (the paid `@run` result).

---

## 1. What was built

| File | What it is |
|---|---|
| `apps/web/e2e/workflow-packs.spec.ts` | the gate: closed-schema surface, lineage, persistence, honesty, and the paid `@run` rerun block |
| `apps/web/e2e/workflow-packs-isolation.spec.ts` | the two-identity half, split into its own file for a measured reason (§4) |

**Authored against the RENDERED DOM, not against the source.** Every locator was read off a live run
of `/dashboard/workflows` before a line was written — the four field labels, the two headings, the
`Customize a workflow` section, the six pack buttons and their `Approved version N.` lines.
`--list` proves a file PARSES, never that a locator RESOLVES; `knowledge-search.spec.ts` was dead on
its first line while `--list` was perfectly happy.

## 2. Results

```
e2e/workflow-packs.spec.ts + workflow-packs-isolation.spec.ts   --grep-invert @run
  ✓ it offers exactly the four schema fields, and nothing that could name a tool, URL or secret
  ✓ the lineage a tenant is editing against is on screen
  ✓ settings survive a reload — and the page never calls them live, approved or pending
  ✓ two identities — B opens the same pack and does not see A's words
  5 passed · PW_EXIT=0

e2e/workflow-packs.spec.ts --grep @run          (REAL MODEL SPEND)
  ✓ pinning and pressing Run again twice starts two separate governed runs
  2 passed · PW_EXIT=0
```

**Falsified deliberately.** An `<input type="url" aria-label="Webhook endpoint">` planted inside the
customizer turned the closed-schema count RED — `Expected: 4, Received: 5`. Reverted, rebuilt, green.
Two full `next build` + restart cycles: `@pikar/core` exports raw TS, so Next BUNDLES it and without
a rebuild the browser tests the previous bundle.

**The paid half is proven by the LEDGER, not by the assertion.** Four `spendEvents` rows for the E2E
tenant, each with a DISTINCT correlationId, `phase: "actual"`, `or/openai/gpt-5.6-luna`, 1 cent each:
`agentloop:5931cd51-…`, `agentloop:54bc7133-…`, `agentloop:744991a5-…`, `agentloop:36d7f515-…`
(four because the first, timed-out attempt still fired its two runs).

This is **the first evidence that 29-08's `state: "ran"` arm is reachable in production.** Three
independent verifiers proved it unreachable in the test suite: every backend fixture either exhausts
the budget (`blocked`) or kills the agent component (`null`), because those are the cheap ways to
avoid spending money in a test, so the happy arm had never once executed. ROUT-02's freshness
promise — two presses of one pin can never replay a plan or reuse an approval — is now shown by four
distinct correlations rather than by a mock.

## 3. THREE FINDINGS ABOUT THE PRODUCT, not about the tests

1. **THE SAVE EMITS NO COMPLETION SIGNAL.** After "Save these settings" there is no toast, no
   `role="status"` and no `role="alert"`. Success and still-in-flight are indistinguishable in the
   DOM, and navigating straight after the click **aborts the in-flight mutation**. A test can wait
   before navigating and retry the read; **a user who presses Save and navigates simply loses the
   write.** Not fixed here (out of this plan's file ownership) — recorded in `workflow-packs.md` and
   `cockpit.md`.
2. **THE PREFILL IS ASYNCHRONOUS AND CLOBBERS TYPING.** `choose()` fills the form from
   `myCustomizationValues` when the query lands; type before that and the value is silently
   replaced, so the save writes the OLD string. This is how the spec first went green-looking on a
   value nobody entered.
3. **ONE TENANT + ONE PACK = ONE `tenantSkills` ROW.** Two customization tests are two writers of
   the same row and cannot run under `fullyParallel: true`. The file is `mode: "serial"`.

## 4. An unexplained interaction, stated rather than hidden

The two-identity test hangs for the FULL timeout on tenant A's own pack list when it runs fourth in
the serial file — the `Brand review` button never becomes clickable — while passing in ~10s alone,
and still hanging after being given a completely fresh browser context for A. So it is not the
reused `page`; the trigger is something the serial WORKER accumulates. Splitting it into its own file
fixes it because Playwright gives each spec file its own worker process.
**The root cause is NOT established.** A's session is valid (the route renders, `settle()` succeeds)
and the hang is on the pack list specifically; the prime suspect is the Convex websocket in that
worker after the preceding test's reload loop, which would make it an app-level resilience question
rather than a test one. Written into the spec header so the green tick does not imply otherwise.

## 5. PLAN CRITERIA NOT MET — and why they cannot be

The plan asks for **exact-version activation** and **rollback**. Both are unreachable in this release:

- `planTenantActivation` refuses EVERY `pack-*` name with `PACK_GATE`, fail-closed.
- Activation and rollback are both `ownerMutation`, so no tenant surface may call them.
- `cockpit.ts` passes no `tenantSkillIds`, so even an activated candidate would be **INERT** — a run
  uses the approved template.

The gate asserts the honest CONSEQUENCES instead: no control on the surface offers activation,
rollback or a tool grant (`FORBIDDEN_CONTROL`), and the page never says "pending review",
"awaiting approval", "will be reviewed", "once approved" or "in review" — copy that would describe a
queue nobody drains. **No control that calls activation was built, and none was faked.**

Task 2's `workflowPackEvals.test.ts` held-out corpus was NOT extended by this pass; the file's
existing coverage stands. Recorded as owed.

## 6. The precondition that decides whether this gate can run at all

`workflowPackDiscovery.listPacks` returns **ACTIVE** packs only (`by_name_status` with an exact
status — never "newest row", which would surface a candidate and undo the dark pilot). On a
deployment where no `pack-*` skill has an active row the whole surface renders
"No approved workflows are available to you yet." with ZERO controls and every assertion here is
unreachable. `settle()` accepts that state and the tests SKIP loudly rather than failing as if the
product were broken. Five packs are active on the local deployment, which is the only reason these
gates could run.

## 7. How to re-run

```bash
# stack: convex dev (NOT --once) on :3210, and next build + next start -p 3111 (dev OOMs)
cd apps/web
export E2E_USER_EMAIL=e2e-wave6@pikar.test  E2E_USER_PASSWORD='pikar-e2e-2026-Wave6!'
export E2E_USER_B_EMAIL=e2e-w6b@pikar.test  E2E_USER_B_PASSWORD='pikar-e2e-2026-TenantB!'
export CONVEX_URL=http://127.0.0.1:3210     PIKAR_E2E_BASE_URL=http://127.0.0.1:3111
npx playwright test e2e/workflow-packs.spec.ts e2e/workflow-packs-isolation.spec.ts \
  --grep-invert @run --reporter=list,json     # FREE
npx playwright test e2e/workflow-packs.spec.ts --grep @run --reporter=list,json  # COSTS MONEY
```
`--reporter=list,json` matters: the default `list` reporter discards `testInfo.attach` bodies, so a
passing run leaves no evidence on disk. Decide that before the first run of a write-performing spec.
