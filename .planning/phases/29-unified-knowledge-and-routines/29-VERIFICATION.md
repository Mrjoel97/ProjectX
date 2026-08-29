# Phase 29 — VERIFICATION (goal-backward)

**Question asked here:** not "were the tasks done", but **"does the shipped code deliver what KNOW-01,
ROUT-01 and ROUT-02 promised?"** Where the answer is no, this document says no.

Verified 2026-08-30 against branch `feat/29-unified-knowledge` at `a17ba59`, on a live local
deployment. Full measured numbers are in `29-VALIDATION.md`.

---

## KNOW-01 — unified knowledge search with honest gaps

**PROMISED:** one question searches everything the tenant has connected; every source states its own
outcome; an unavailable source is never rendered as an empty one; answers are cited; conflicts stay
visible.

**DELIVERED — verified in a real browser, in three modes.**

| Claim | Evidence |
|---|---|
| A question fans out and returns a cited answer | `knowledge-search.spec.ts`, live mode, 3 passed, real `knowledge.plan` spend row |
| Every source states its outcome — five, always | `toHaveCount(5)` on `knowledge-source-state`, offline mode |
| An unconnected mailbox is NOT "no results" | the exact sentence asserted: *"your mailbox is not connected yet, so it was not searched."* |
| A source Phase 28 never landed names its unlock | asserted verbatim, including *"It would need connecting your support desk."* |
| Nothing-searched ≠ searched-and-empty | both sentences asserted, and the wrong one asserted HIDDEN |
| Tenant isolation, browser-to-browser | tenant B signs in from a clean context and cannot see A's search |

**NOT DELIVERED, and it matters:**

- **The synthesizer has never answered from real evidence.** The live run produced a
  `knowledge.plan` ledger row and **no `knowledge.synth` row**: the E2E tenant has no connected
  source, so the planner found nothing readable and the card took the honest "no source could be
  searched" branch. The synthesis half — citation binding, conflict rendering, confidence — is
  proven only by unit tests and the offline fixture seam. **Closing it needs a tenant with a live
  Gmail or Drive connection.**
- **CRM and support projections are `not_landed`**, as the owner ruled on 2026-08-27. Phase 28's
  connector rails do not exist; the search rail is Vault + Drive + Gmail.

**A RELEASE PRECONDITION, discovered by the gate and not by any test:** KNOW-01 is **inert** on a
deployment where `skills:seedSkills` has not run since this phase landed. The first browser run
failed on `NO_ACTIVE_SKILL: knowledge-query-planner`; the code is correct and the rows simply were
not there. Every unit test passed throughout, because `convex-test` seeds the registry inside the
test. This belongs in the deploy runbook.

---

## ROUT-01 — a tenant can adapt an approved workflow without gaining tools

**PROMISED:** a schema-driven customization surface that is structurally incapable of offering a raw
prompt, a tool name, a URL, a secret or an MCP setting; visible lineage; publication through the
governed candidate path only.

**DELIVERED — and the closed schema is proven by count, not by inspection.**

| Claim | Evidence |
|---|---|
| Exactly four controls, all schema fields | `toHaveCount(4)` over `input, select, textarea` in the customizer |
| No control can name a tool, endpoint or credential | `FORBIDDEN_CONTROL` regex over every accessible name |
| The closed count can actually fail | planted `<input type="url" aria-label="Webhook endpoint">` → `Expected: 4, Received: 5` |
| Lineage is on screen | `Approved version N.` asserted per pack |
| A customization persists through the real stack | fill → save → **full reload** → value returns |

**NOT DELIVERED — and it cannot be, in this release:**

- **Activation is unreachable.** `planTenantActivation` refuses every `pack-*` with `PACK_GATE`,
  fail-closed. **Rollback** likewise. Both are `ownerMutation`, so no tenant surface may call them.
- **A published customization is INERT.** `cockpit.ts` passes no `tenantSkillIds`, so a run uses the
  approved template regardless of what the tenant saved.

The surface tells the truth about this rather than implying a queue: the gate asserts the page never
says "pending review", "awaiting approval", "will be reviewed", "once approved" or "in review", and
that no control offers activation. **A customization today is a dark candidate, and the UI says so.**

**A PRODUCT GAP FOUND BY THIS GATE:** the save emits **no completion signal** — no toast, no
`role="status"`, no `role="alert"`. Success and still-in-flight are indistinguishable, and navigating
straight after Save **aborts the in-flight mutation**. A test can wait and retry the read; a user
loses the write. Not fixed in this phase; recorded in `workflow-packs.md` and `cockpit.md`.

---

## ROUT-02 — a safe manual routine, and an honest answer on recurrence

**PROMISED:** a version-pinned workflow that always starts a FRESH governed run; manual reruns
available whether or not recurrence ships; and a recurrence decision that cannot be reached without
proof.

**DELIVERED — the freshness promise is shown by the ledger, not asserted by a mock.**

Two presses of one pin produced two workspace threads and **four distinct `agentloop` correlation
ids**, `phase: "actual"`, real model, on the governed spend ledger. Nothing replayed a stored plan or
reused an approval.

This also closes the phase's most stubborn defect. 29-08's money discriminant is
`state: "ran" | "blocked" | "unknown"`, and three independent verifiers proved the **`"ran"` arm was
unreachable in the test suite** — every backend fixture either exhausts the budget (`blocked`) or
kills the agent component (`null`), because those are the cheap ways to avoid spending money in a
test. Collapsing the ternary left 43 tests green while resurrecting "nothing was spent" for a billed
run. **The live gate is the only thing that exhibited the arm at all.**

**Recurrence: DEFERRED, and the deferral is the verified outcome — not a shortfall.**

```
--matrix            exit 0   OK (decision: defer)
--eligibility       exit 1   FAIL — 13 problem(s)      <- enable-safe is unreachable
--validate-decision exit 0   OK (decision: defer)
```

`enable-safe` requires every row `pass` with **`live`** evidence on `oauth-expiry-reauth`,
`dst-boundary` and `provider-read`. None has a live trace: nothing in this repo has executed across a
DST boundary, and the Microsoft Graph probe returned `supported: false`. Those rows are `missing`,
not relabelled.

The absence is proven **structurally, not by a word blocklist** — which matters, because a blocklist
was defeated three rounds running by simply renaming things. `routines.test.ts` now pins
**CONVEX_MODULES** (the whole namespace, enumerated from the filesystem) and **SCHEDULER_CALL_SITES /
CRON_REGISTRARS**, so a new scheduler is a visible governance diff under any name. Proven by planting
a disguised self-arming `internalMutation` — innocuous name, no banned token, not under `routines/` —
and watching both allowlists go red. The browser half (`routines.spec.ts`, 5 passed incl. tenant B)
confirms the surface offers a manual **Run again** and no schedule/pause/resume/revoke control.

---

## What this phase's testing discipline actually cost, and bought

The recurring defect was never "a test failed". It was **a check that could not fail**:

- a boolean whose "we don't know if money was spent" case was unreachable;
- the enum that replaced it, whose *happy* arm was unreachable;
- an absence blocklist defeated by a trailing `//`, then by renaming;
- a citation check defeated by one letter's case on a case-insensitive filesystem;
- a Playwright **settle signal** that matched static prose and fired before any query resolved;
- a typecheck left red, silently disabling two guarantees claimed elsewhere, while vitest read 33/33.

Every one was found by an adversarial pass or a live run, and **none by the passing suite**. The
rule that generalises: *a settle signal, a positive control, and an oracle must each match something
that cannot already be true.*

---

## Outstanding

| Item | Owner |
|---|---|
| **29-13 Task 3 — owner review of the running app** | the owner; a human act, blocking |
| Synthesizer against a real model with a connected source | needs a tenant with live Gmail/Drive |
| Save completion signal on the customizer | product fix, not scoped here |
| Unexplained serial-worker hang in the pack isolation spec | root cause not established; see spec header |
| `env.test.ts` `QUICKBOOKS_*` red | **Phase 28 lane** (added by 28-06) |
| `vaultDigest.test.ts` full-suite load flake | unowned; 17/17 in isolation |
