# 29-08 ROUND 3 — the happy arm is reached by a run, not by a fixture

Commit `d8cdb13`. Files modified (6, and they are exactly the six I own — verified against
`git show --stat`): `packages/backend/convex/pinnedWorkflows.ts` (+`.test.ts`),
`apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.tsx` (+`.test.ts`),
`docs/playbooks/workflow-packs.md`, `docs/playbooks/knowledge-search-routines.md`.
`workflows/page.tsx` untouched; the sibling lane's recurrence files untouched.

## 1. The blocker — closed both of the ways the verifiers named

`state: "ran"` was produced by nothing on the server. Every $0 drive of `runAgain` either
exhausts the budget (`outcome: "blocked"`) or throws before a thread (`outcome: null`), so
`outcome === null ? "unknown" : "blocked"` left `pinnedWorkflows` **43/43 green** while a run
that reached the model, answered and recorded spend rendered *"Pikar stopped this run before it
started. Nothing ran and nothing was spent"* and wrote `state: "blocked"` to the audit plane.

**(a) The derivation is a pure function now.** `export function pinRunState(outcome: string |
null): PinRunState` in `pinnedWorkflows.ts`, called from `runAgain`, with all three arms asserted
directly. `useful`, `partial`, `no_findings` and `failed` are each RAN — which also turns the
module header's *"`outcome: 'no_findings'` is `'ran'`, not `'unknown'`"* (trap 4) from a comment
into an enforced invariant.

**(b) A COMPLETED TURN IS DRIVEN END TO END, OFFLINE, FOR $0 OF REAL MONEY.** This is the half
that matters, and it needed no live deployment — the previous round's test-file header claimed the
opposite ("that needs a live deployment and money"), and that framing is what hid the hole.

`pinnedWorkflows.test.ts` now carries two `vi.mock`s, both documented in the file:

- `./lib/models` -> `resolveModel` returns a scripted `MockLanguageModelV4` (the
  `knowledgeSearch.test.ts` idiom, and the same swap `__runWorkflowPackWithScript` performs).
  **The model is the only fake.** `guardrails.preCall`, the preflight, `runAgentLoop`,
  `priceUsage`, `guardrails.recordSpend`, `outcomeFor`, the pack event log,
  `cockpit.startWorkflowPack`'s thread and plan row, and `runAgain`'s own derivation and audit
  write are all shipped code.
- `./llm` -> the real `runSpecialistTurn`, plus an opt-in throw AFTER it returns. Not an arbitrary
  failure point: it is the exact seam the module header names as the reason `unknown` may not
  claim $0.

Three new drives:

| drive | asserts |
|---|---|
| the model answers | `{ok:true, threadId: <string>, state:"ran", outcome:"useful"}`, audit `state:"ran"`, **one `spendEvents` row with `amountCents > 0`** |
| the reply is empty | `outcome:"no_findings"` and `state:"ran"` — a run that found nothing RAN |
| a throw after the model | `state:"unknown"`, audit `state:"unknown"`, **and a non-zero spend row for that same run** |

## 2. The second blocker — `unknown` is no longer only ever observed at $0

Both pre-existing `unknown` tests kill the agent component, which throws before any model call.
The third drive above lets the model answer, lets `recordModelSpend` run, and then throws from
after `runSpecialistTurn`; `cockpit.startWorkflowPack` swallows it and returns
`{threadId: <a real thread>, ok:false}` with no outcome — the exact production path verifier 3
named as untested. Verifier 3's mutation
`outcome === null ? (threadId === null ? "unknown" : "blocked") : ...`, which re-instates the
original lie on precisely that path, is **RED** on this test and was green before it.

## 3. The "nothing runs by itself" scan now sees the copy a user reads

It enumerated four READINESS states plus empty — all pre-press — so `BLOCKED_RUN`, `UNKNOWN_RUN`,
`TRANSPORT_ERROR` and every `actionLine` branch were outside it. It is now three tests:

- readiness states (as before);
- **every `PinAction` kind through `actionLine`**, driven from a `Record<PinAction["kind"],
  PinAction>` that is TOTAL by type — a new kind fails the typecheck rather than going unscanned —
  plus both other shapes of each refusal family, with a control asserting that 9 of the 10 kinds
  actually announce a sentence (so the scan is not reading a pile of `null`s);
- **the DOM after a real press** in five run-result states (blocked, unknown, not_ready,
  unknown_pin, and a throw).

## 4. Deleted rather than narrowed

- **`latencyMs`** is gone from the audit payload. Its only assertion anywhere was
  `expect.any(Number)`, nothing read the field on any surface, and `Date.now() - startedAt -> 0`
  survived. Deleted, and the fixture records why.
- **`pinWorkflow`'s docstring** no longer claims the pin captures "the source preferences that row
  recorded". That field lost its writer last round; the sentence was left standing.
- **`TRANSPORT_ERROR`** no longer says "That did not go through". A browser that never saw the
  reply cannot know that. It reads "Pikar could not confirm that. Reload the page to see whether it
  went through." and is reachable from PIN and UNPIN only — **a throw out of the RUN channel now
  sets `runUnknown`**, because `runAgain`'s audit write sits outside its try, so a completed and
  possibly billed run can reject after the turn happened (verifier 3's finding 4, closed at the
  surface).
- The `.tsx` heading said THREE and listed FOUR -> FOUR.
- `workflow-packs.md`'s round-2 block said "Three independent verifiers found it"; that round's
  brief recorded TWO -> corrected in place.

## 5. The "blocked => $0" absolute has a guard, and the guard states its own reach

New source scan over `workflowPackBinding.ts`: `outcome: "blocked"` appears at exactly two sites,
both BEFORE `runSpecialistTurn(`, with the literal `costUsd: 0` between the second and the model.
**Its limit is written beside it, because I measured it:** a producer that builds the value
(`outcome: someVar`) is NOT seen — I applied that mutation and the test stayed green. A literal
second producer IS red, and so are the two completed-run drives, which is the stronger half.

## 6. Mutations applied, each observed, each reverted from a byte backup

| # | mutation | result |
|---|---|---|
| M1 | `pinRunState`: `outcome === null ? "unknown" : "blocked"` (the three verifiers' exact mutation) | **RED 6/53** — four arm tests, the completed-run drive, the no_findings drive |
| M2 | `pinRunState`: `outcome === null ? "blocked"` | **RED 3/53** — incl. the new throw-after-spend test |
| M3 | `runAgain`: `outcome === null && threadId !== null ? "blocked" : pinRunState(outcome)` (verifier 3's blocker-2 mutation) | **RED 1/53** — the throw-after-spend test, and only it |
| M4 | `workflowPackBinding.ts`: return `outcome: "blocked"` from the completed-run return | **RED 3/53** — both drives + the new scan |
| M5 | `workflowPackBinding.ts`: a post-model blocked producer built from a variable | **GREEN — the scan cannot see it.** Recorded in the test and above, not papered over |
| M6 | scripted usage -> 0 tokens (probe: is the spend row real?) | **RED 2/53** — both spend assertions trace to real `priceUsage` output |
| M7 | `BLOCKED_RUN` += "Pikar will retry this automatically every day." (verifier 1's mutation) | **RED 2/33** — actionLine scan and pressed-DOM scan |
| M8 | `doRun` catch -> `{kind:"transport"}` | **RED 1/33** |
| M9 | `TRANSPORT_ERROR` restored to "That did not go through." | **RED 1/33** |
| M10 | `actionLine` returns `null` for `runBlocked` | **RED 2/33** — incl. the scan's own control |

`workflowPackBinding.ts` was restored from a byte backup after M4/M5 and `git diff --stat` on it
is empty; nothing outside my six files is in the commit.

## 7. Gates, measured now

| gate | result |
|---|---|
| `cd packages/backend && pnpm vitest run pinnedWorkflows` | **53 passed** (was 43) |
| `pnpm vitest run pinnedWorkflows savedPrompts cockpit workflowPackBinding` | 12 files / **408 passed** |
| backend full `pnpm vitest run` | 116 files, **2 failed**: `env.test.ts` (`QUICKBOOKS_*`, the standing foreign failure) and `vaultDigest.test.ts` (17/17). **`vaultDigest` passes 1/1 in isolation** — the documented load flake; `env.test.ts` fails identically at baseline. An earlier identical run reported 3 failed files, which is the same flake |
| `cd apps/web && pnpm vitest run PinnedWorkflowButton` | **33 passed** (was 30) |
| `cd apps/web && pnpm vitest run` | 39 files / **795 passed** (was 792) |
| `packages/backend pnpm typecheck` / `apps/web pnpm typecheck` | both exit 0, silent |
| `npx biome check` on the four changed source files | clean |
| check-playbooks (piped `{}`, stdout read) | empty stdout — **passed** at the time of my code commit `d8cdb13`. It later printed `"decision":"block"` naming `packages/backend/convex/tick.ts` and `packages/core/src/recurrenceEngine.ts` — two UNTRACKED files the recurrence sibling created in this shared worktree while I worked. Neither is mine and neither is in either of my commits; my six paths are covered |

## 8. WHAT I DID NOT FIX, AND WHY

**The web suite is fixture-driven end to end, and that is the mechanism that hid blocker 1.**
Saying it plainly, as asked: no test in `apps/web` calls a Convex function; every `runAgain`
result is a literal. `"ran"` existed in this repo *only* as a string in one of those literals —
never as a value a handler had been observed to return — which is exactly why the backend hole
could sit under a green web suite that appeared to "cover" the `ran` branch. I narrowed the drift
half: `PinRow` and `RunResult` are now `FunctionReturnType<typeof api.pinnedWorkflows....>`, so a
renamed or dropped state fails the web typecheck. That is all it buys. **A fixture-typed suite
still cannot prove a state is ever produced** — only the backend drive does, and only now.

**The browser is still unrun for `/dashboard/workflows`.** No Playwright spec, still absent from
the nav. `pnpm --filter @pikar/web build` also not run.

**`pinIdentity` collides with a user-typed saved prompt, and `pinWorkflow` fails OPEN** (verifier
3's finding 3, which they demonstrated with a real drive). `pinIdentity` returns a plainly
typeable string (`brand-review|t4|cnone||`) hashed into the SAME `by_tenant_textHash` space
`savedPrompts.save` writes `contentHash(normalizePromptText(text))` into, with no namespace
between them. Saving that text first makes the pack permanently unpinnable while `pinWorkflow`
keeps returning `{ok:true}`. **I did not fix it, deliberately.** Every fix available inside my own
file is either a narrowing that a typeable string defeats (any prefix is itself typeable —
`normalizePromptText` only folds CRLF and trims) or it creates two rows sharing one `textHash`,
which makes `savedPrompts.save`'s `.unique()` throw for that tenant for ever. The correct fix
separates the two hash spaces and therefore edits `savedPrompts.ts`, which this plan does not own.
Flagged for whoever owns that file next. Same-tenant only, so it is a fail-open availability bug,
not an isolation breach.

**`unpinWorkflow` / `savedPrompts.remove` asymmetry** (verifier 3, minor 6) — same root cause and
the same ownership boundary.

**`runAgain`'s audit write is still outside the try.** I fixed the *surface* consequence (a throw
there now reads as `unknown`, not "that did not go through") and left the write unguarded on
purpose: catching it would make a run vanish from an insert-only log plane silently, which is
worse than a loud failure. The run is still lost from `runCount`'s ordinal in that case, and that
is not fixed.

**`RunAgainResult.outcome` and `PinnedWorkflowView.createdAt` are still returned and unread by the
UI** (verifier 3, minor 8). `outcome` is the derivation's input and is asserted by four tests, so
it is diagnostic rather than dead; `createdAt` genuinely is unread. Not churned.

**`pinWorkflow`'s idempotence early-return still precedes the dedupe sweep**, so a pre-existing
duplicate row would never be cleaned (verifier 3, minor 8). Unreachable through the shipped
writer; left alone.
