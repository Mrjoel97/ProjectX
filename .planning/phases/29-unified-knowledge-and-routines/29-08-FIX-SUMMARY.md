# 29-08 FIX — round 2 summary

Commit: `a6a784c` — *fix(29-08): a run that may have been billed is no longer told it was free*

Files changed (all of them mine; `git diff --stat HEAD -- "*.ts" "*.tsx"` after committing is
empty, so HEAD is what the gates read):

- `packages/backend/convex/pinnedWorkflows.ts`
- `packages/backend/convex/pinnedWorkflows.test.ts`
- `packages/backend/convex/savedPrompts.ts`
- `apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.tsx`
- `apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.test.ts`
- `docs/playbooks/workflow-packs.md`, `docs/playbooks/cockpit.md`,
  `docs/playbooks/knowledge-search-routines.md`

`apps/web/app/(app)/dashboard/workflows/page.tsx` is in my ownership list and is **not** changed:
it already mounts `<PinnedWorkflowButton />` and nothing in this round alters what it mounts. That
is a deliberate no-op, not an untouched file I forgot.

---

## 1. THE BLOCKER — fixed at the discriminant, not in the copy

`cockpit.ts:268-277` converts BOTH a pack-binding refusal and EVERY throw out of `runWorkflowPack`
into `{threadId, ok:false}` with `outcome` absent; it never rethrows. `runPackTurn` rethrows from
*after* `runSpecialistTurn`, i.e. after the model may have answered and `recordModelSpend` may have
run. So `outcome === null` was a genuinely unknown cost, and `ran = res.ok && outcome !== null &&
outcome !== "blocked"` collapsed it into the same `false` the $0 governed stop produces.

I could **not** distinguish "refused before spend" from "failed after starting" at the source:
`cockpit.ts` is not mine this round, and it is the module that erases the difference. So the fix is
the one the brief named as the alternative — `outcome === null` is rendered and audited as
**unknown**:

- `RunAgainResult` and the audit payload carry `state: PinRunState = "ran" | "blocked" | "unknown"`.
  The `ran` + `started` boolean pair is **deleted**, not narrowed.
- Only two states may claim $0, and both can prove it: `ok:false` (refused before a thread, a plan
  row, an audit row or a model call exists) and `"blocked"` (`workflowPackBinding` returns
  `costUsd: 0` literally on that path).
- `"unknown"` renders: *"This run did not finish, and Pikar cannot tell whether it reached the
  model. It may have used part of today's budget — open your workspace to see what happened before
  running it again."* It does not navigate, and the test asserts the rendered document does **not**
  contain "nothing was spent" or "Nothing ran".
- `res.ok` is no longer read at all in `runAgain`: the outcome is the single discriminant, so it
  cannot disagree with itself.

**`run_failed` is deleted, not made reachable.** The verifier's corollary was right — its only
trigger was a transport throw, which the client's `transport` state already covers, and its copy
("Nothing ran — try again") made exactly the same unprovable promise as the blocked line. A failed
run is `state: "unknown"` now.

The `unknown` state is **driven end to end**, not stubbed: a backend test runs `runAgain` on a
harness with the agent component deliberately unregistered, so `ensureThreadAndPlan` throws inside
`startWorkflowPack` — a real failure on the thread/plan plumbing, one of the throws that reaches
`runAgain`'s catch in production. It asserts `{ok:true, threadId:null, state:"unknown",
outcome:null}` and the audit row's `state`/`outcome`/`threadId`/`ordinal`. A second test proves an
unknown run still counts toward the pin's ordinal.

## 2. THE UNFALSIFIABLE GUARDS — each is now a test or is gone

- **`runCount` pin-scoping.** New test seeds three pins (two of tenant A, one of tenant B) and audit
  rows against each. `expect(runCount(mine)).toBe(3)` with 2 + 4 + 5 foreign rows in the table.
  Replacing the derived prefix with `"pin:"` now returns 14 → RED. The module header's claim
  ("the pin's own rows and nothing else", "the row id is what makes the range tenant-safe") is that
  test's subject rather than a comment.
- **`runCount` event type.** The range now compares `eventType === PIN_RUN_EVENT`, so a second
  writer reusing the prefix cannot inflate the ordinal. Covered by the 5 rows of a different event
  type in the same test.
- **Audit payload values.** The success payload is asserted with `toEqual` over **every field**
  (ordinal, state, outcome, threadId, both versions, both counts, both customization flags,
  `latencyMs: expect.any(Number)`), plus a second run with a customization, a republished template
  and an unavailable source, asserting `noticeCount: 3`, `sourceUnavailableCount: 1`,
  `templateVersion: 4`, `activeVersion: 9`. `noticeCount: 0` and `activeVersion: 999` are RED.
  The `catch`-path payload no longer exists as a separate shape: there is one audit write.
- **`newestCustomization`'s `templateId === packId`.** New test: a candidate row under this pack's
  skill name that names a *different* template is not this pack's customization.
- **`readinessFor`'s foreign-tenant check.** New test: a customization row whose `tenantId` is
  patched away reads as `customization_missing`, not `customization_not_applied`.
- **`listPins` ordering.** The `createdAt` sort is **deleted** (see §3), and the pack-order result
  is asserted with pins created in the opposite order, so restoring the sort is RED.

## 3. THE UI/BACKEND MISMATCHES

- **One pin per pack, per tenant — the backend is constrained.** Re-pinning replaces. The extra
  rows were invisible (the surface renders one row per pack and takes that pack's pin), unremovable
  (the prompt menu filters workflow pins out) and functionally identical: `runAgain` sends the pack
  id and re-resolves to the ACTIVE version, so a pin of v4 and a pin of v5 ran the same thing. The
  pinned version is a display fact, not a selector. Two tests: the replacement, and that it touches
  neither another tenant's pin nor this tenant's other packs.
- **`savedPrompts.list` filters BEFORE its take.** `.filter((q) => q.eq(q.field("templateId"),
  undefined))` on the same indexed range. Driven: 20 prompts returned 20, then one pin returned 19;
  it returns 20 now, and moving the filter back after the take is RED. `.take(SAVED_PROMPT_LIST_LIMIT)`
  is unchanged, so `savedPrompts.test.ts`'s source scan still holds.
- **`pinButtons`** (write-only ref map) is deleted.
- **`sourcePreferences`** is deleted from the pin: not derived, not stored, not returned, and
  `pinIdentity` is passed `[]` with a `ponytail:` comment. It was inert *and* redundant —
  `customizationHash` is the hash of the exact `customizationValues` the preferences were read from
  and `tenantSkillId` names that row, so it could only ever agree. Side effect: `schema.ts`'s
  "there is no writer of this field yet" comment is true again, which is why `schema.ts` (not mine)
  needed no edit.
- **`checkReadiness` is still not wired to the UI, and that is now RECORDED, not enforced.** I took
  the brief's second option: the source-scan assertion that froze the omission ("the four functions
  it MAY reach, and no fifth") is **deleted**. It was redundant anyway — the `convex/react` stub at
  the top of the test file throws on any unexpected function path, so the closed set is enforced
  behaviourally in every test in the file rather than by a list. Wiring it would be a second read of
  readiness that `listPins` already carries.
- **The plan's "shows last/manual-run outcome" is NOT met.** Stated plainly, as the brief allows.
  The repeat ordinal and the last outcome live on the audit plane only; the surface has no persisted
  memory of either and forgets across a reload. Rather than ship them as dead payload, `ordinal` and
  `correlationId` are no longer returned to the browser at all — the tests read them off the audit
  rows, which is where the evidence actually is. Making the surface show them needs a per-pin audit
  range read on every reactive `listPins` (six range reads per render), which is a bigger change
  than this round should make.

## 4. THE FALSE STATEMENTS

- `pinnedWorkflows.ts` now really does write the range bound as the escape `￿`; the comment
  claiming it is true. **Commit `cdcf7dd`'s message says that change was made and it was not. I
  cannot rewrite that message — this paragraph is the correction.**
- `runCount`'s docstring cited `schema.ts:359` for "there is no run-history table"; the comment is
  at `schema.ts:442` (359 is a `v.literal("archived")` inside the `tenantSkills` status union).
  Fixed.
- `docs/playbooks/knowledge-search-routines.md`'s 29-08 **Files:** line named
  `PinnedWorkflowButton.container.test.ts`, which has never existed. Corrected in place, and the
  correction is also stated in that playbook's new top block. That file is **not** in my ownership
  list, but the `check-playbooks.mjs` gate blocks on it for `pinnedWorkflows.ts`, so it had to be
  touched; I added one top block and edited the one false line, nothing else. The sibling lane's
  recurrence sections are untouched.
- The typo in `docs/playbooks/cockpit.md`'s 29-08 block (`mechanism behind "Run again").)`) is
  **not** fixed: it is inside an immutable prior "Last verified" entry, and this round's convention
  in this repo is to correct a prior entry from a new one rather than edit it. The new top block
  supersedes that entry's `savedPrompts` claim.

## 5. MUTATIONS OBSERVED RED (13/13; each applied, suite run, file restored)

| # | mutation | suite | result |
|---|---|---|---|
| M1 | state derivation: `outcome === null ? "blocked"` | backend pin | RED (1 failed / 43) |
| M2 | `runCount` prefix → constant `"pin:"` | backend pin | RED (1 / 43) |
| M3 | `runCount` drops the `eventType` filter | backend pin | RED (1 / 43) |
| M4 | `pinWorkflow` keeps stale rows (no replace) | backend pin | RED (3 / 43) |
| M5 | stale-row read drops `.eq("templateId", packId)` | backend pin | RED (5 / 43) |
| M6 | `newestCustomization` drops the templateId check | backend pin | RED (1 / 43) |
| M7 | `readinessFor` drops `\|\| mine.tenantId !== tenantId` | backend pin | RED (1 / 43) |
| M8 | `listPins` sorts newest-first again | backend pin | RED (1 / 43) |
| M9 | audit payload hardcodes `noticeCount: 0` | backend pin | RED (1 / 43) |
| M10 | audit payload hardcodes `activeVersion: 999` | backend pin | RED (2 / 43) |
| M11 | `savedPrompts.list` filters AFTER the take | backend pin+saved | RED (1 / 56) |
| M12 | UI renders BLOCKED copy for every non-`ran` state | web button | RED (3 / 30) |
| M13 | UI navigates whenever `res.ok` | web button | RED (2 / 30) |

`git diff --stat` was empty after each restore before the next mutation ran.

## 6. GATES — real numbers

| gate | result |
|---|---|
| `packages/backend` → `pnpm vitest run pinnedWorkflows savedPrompts cockpit` | **11 files / 359 tests, all pass** |
| `packages/backend` → `pnpm vitest run` (full) | **115 files / 3270 tests — 1 failed**: `env.test.ts` (`QUICKBOOKS_*` unclassified, Phase 28, known foreign). `media.test.ts` passed. Baseline failure count 1, unchanged. |
| `apps/web` → `pnpm vitest run PinnedWorkflowButton` | **30 tests pass** (was 28) |
| `apps/web` → `pnpm vitest run` (full) | **39 files / 792 tests, all pass** |
| `packages/backend` → `pnpm typecheck` | silent, exit 0 |
| `apps/web` → `pnpm typecheck` | silent, exit 0 |
| `npx biome check` on all changed files | clean (one formatting fix applied, suite re-run after) |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **empty stdout = passed**, and it was run with a DIRTY tree so it actually examined the changed files. It blocked first, naming `knowledge-search-routines.md`; it passes after that playbook was updated. |

`pinnedWorkflows.test.ts` went 34 → **43 tests**; `PinnedWorkflowButton.test.ts` 28 → **30**.

## 7. WHAT I DID NOT DO

- **`pnpm --filter @pikar/web build` was NOT run.** The brief lists it as a gate and also says
  explicitly "DO NOT run … `next build` … a live stack is running on :3210/:3111". I honoured the
  prohibition. Typecheck and the full 39-file `apps/web` suite both pass; the change touches one
  existing client component with no new files or routes, so build risk is low but **unverified**.
  If the orchestrator wants it, it is one command against a quiet stack.
- **No browser check.** `/dashboard/workflows` still has no Playwright spec and is still absent from
  the nav. Nothing in this round was seen in a browser, and — per the 29-09 lesson recorded in the
  brief — a green unit suite says nothing about whether a deployment can run the feature.
- **`cockpit.ts` is untouched.** The real root cause (one return shape for a refusal and for a
  post-spend throw) lives there. Fixing it there would let `runAgain` report "refused, $0" and
  "failed after starting" separately instead of one honest `unknown`. That is the upgrade path, and
  it belongs to whoever owns `cockpit.ts` next.
- **The ordinal race** (`runCount` read and audit write are two steps of an action; two overlapping
  presses both read N) is **not** fixed. It needs either a mutation that reads-and-writes atomically
  or a counter, and both are larger than this round. The ordinal is a display/evidence number on the
  audit plane, not a governance decision.
- `packages/core`'s `WorkflowPin.sourcePreferences` field still exists; the pin passes `[]`. Core is
  not mine this round, and the `ponytail:` comment at the call site names the upgrade path.
