# 21-06 — SUMMARY

**Status: COMPLETE. The browser gate ran, every free gate is green, and
`21-LIVE-HANDOFF.json` exists. No paid eval, no activation, no rollback, no requirement or roadmap
completion occurred — those are exclusively 21-07.**

Candidate frozen: `qx73bwshbfds5nk7hd40vsf5y18cm7z0`, `offer-architect` v12, tenant
`kn790hj6pxay64s1pzrhrv6j2s8cep8s`, published `2026-08-17T13:12:02.886Z`.

## Task 1 — the authenticated browser proof

`apps/web/e2e/skill-authoring.spec.ts` **already existed** — it landed orphaned in `e4e402c`
("land the orphaned skill-authoring harness") and had **never been executed**. Nothing was authored
here; this plan RAN it. `2 passed` (setup + the authoring case), the read-only post-live case
correctly `skipped` because `PHASE21_LIVE_RESULT_PATH` is unset — that is 21-07's to supply.

Stack the run needed, none of it in `playwright.config.ts`: local Convex already up on `:3210`,
`apps/web` **production build** (`next build` + `next start -p 3111`, not `next dev`), and the
seeded local user `e2e-wave6@pikar.test`. Both `apps/web/.env.local` and
`packages/backend/.env.local` point at the local `:3210`, so the cloud/local split recorded in
earlier phases did not bite.

**THE SPEC WAS RUN TWICE, AND THE SECOND RUN IS THE ONE THE HANDOFF PINS.** `playwright.config.ts`
sets `reporter: "list"`, which does not persist attachment bodies, and Playwright cleans the output
directory on a pass — so run 1's `phase21-candidate-ref.json` was destroyed before it could be
read. Run 2 added `--reporter=list,json`, which serializes the attachment body into the report.
**Run 1's candidate is an orphaned draft row on the tenant and was NOT used for anything.** The
handoff's `candidateId` is read from run 2's own mutation-response attachment — never from a
newest-row lookup, which 21-06 expressly forbids. Disclosed rather than hidden: the tenant now
carries one extra `offer-architect` candidate that no plan will ever reference.

Why the id comes off a WebSocket frame at all: this is an append-only, shared deployment, so
"the newest `offer-architect` candidate" is ambiguous the moment a concurrent lane publishes one.
The mutation's own response frame is the only identity provably belonging to *this* click.

## Task 2 — the free gate

| Gate | Result |
|---|---|
| contracts `skillAuthoring.test.ts` | 3/3 |
| backend `skills` + `dispatch` + `savedPrompts` + `importGuard` | **288/288** |
| web focused (`skillAuthoring`, `pinnedPrompts`, `tenantSkillReview`) | 41/41 |
| golden `--self-check` | PASSED |
| `@pikar/core` full | **1032/1032**, 39 files |
| `@pikar/contracts` full | 31/31 |
| `web` full | **432/432**, 28 files |
| `@pikar/backend` full | **2026 passed, 24 skipped**, 87 files, exit 0 |
| `pnpm typecheck` | **10/10 successful** |
| `pnpm --filter web build` | exit 0 |
| `node scripts/check-playbooks.mjs` | exit 0 |
| `git diff --check` | exit 0 |

`pnpm test` as a single command is not used — it OOMs on this machine. Run per package with
`--maxWorkers=1` and `NODE_OPTIONS=--max-old-space-size=3072`.

### The mutation ledger — all 22 rows executed, red observed, restored green

Every row of `21-VALIDATION.md`'s ledger was re-proven **against the current tree**, which is the
point: 21-02 took three fix rounds (`f91cfc9`, `3dca528`, `40046b2`) after its own summary was
written, so the ledger's evidence was stale.

| Row | Red observed |
|---|---|
| 1. Candidate tenant predicate | `two tenants: identical name and version, zero crossover` — A's row exposed to B |
| 2. Candidate-only status | `expected 'active' to be 'candidate'` |
| 3. Authenticated provenance | `promise resolved … instead of rejecting` on a spoofable `authorUserId` arg |
| 4. Exact eval target | `A's passing evidence COPIED onto B's colliding row still cannot certify B` |
| 5. Filtered evidence suppression | `a --only run executes cases and records NO evidence` |
| 6. Exact evidence identity | foreign evidence certifies: `promise resolved … instead of rejecting` |
| 7. Effective-loader isolation | `tenant A's active adaptation reaches A's specialist prompt and NEVER B's` |
| 8. Global fallback | no-overlay tenant throws `NO_ACTIVE_SKILL` instead of loading the global body |
| 9. Initial rollback baseline | `ROLLBACK_NOT_ELIGIBLE … was never active` |
| 10a. Trusted browser send | reddens **three** guards, incl. `crmCard.test.ts`'s cross-cutting clock door |
| 10b. Fresh-thread run | `expected [ 'text, threadId' ] to deeply equal [ 'text' ]` |
| 11. Prompt delete ownership | `expected { removed: true } to deeply equal { removed: false }` |
| 12a. Candidate audit privacy | key-set equality **and** the needle scan both red |
| 12b. Prompt log privacy | needle `ZP5ALPHA…` reaches the audit plane |
| 12c. Runtime audit privacy | **four** guards red, incl. the dedicated `llmRedaction.test.ts` scan |
| +`cockpit-agent` in `USER_AUTHORABLE_SKILLS` | exact three-name set |
| +remove UTF-8 byte cap | `expected [Function] to throw an error` |
| +`take(1)` → `.collect()` | bounded-source contract |
| +drop `tenantSkillIds` at a handoff | pinned candidate body never reaches the model |
| +colliding skill id in runtime audit | exact attribution/readback mismatch |
| +bypass `transitionSkillActivation` | eval gate skipped **and** `unique() returned more than one result` |
| +downgrade the activation wrapper | importGuard source pin **and** the real non-owner truth-table cell |
| +remove `rollbackEligible` predicate | never-active archived candidate becomes restorable |

Every hunk was reversed and the owning command re-run green. `git status` shows **no
mutation-owned file modified**.

### One coverage hole found while doing this, NOT fixed here

The ledger row "drop `tenantSkillIds` at one handoff" was first applied at
`packages/backend/convex/dispatch.ts:596` (the scheduled-dispatch handoff) and **the whole suite
stayed green — 182/182.** The row only reddens when applied at the consumption boundary
(`llm.ts`'s `const tenantSkillIds = args.tenantSkillIds`). So the pin's survival across the
`dispatch.ts:596` scheduled handoff has **no test of its own**; that hop could be deleted silently.
Recorded, not fixed — 21-06 is a verification plan and an unrequested product edit made while
closing a gate is how a gate stops meaning anything. First item for any 21 follow-up.

## Task 3 — the refs-only handoff

Two read-only inspection snapshots taken and compared: **byte-equivalent canonical JSON**,
`mismatches: []`, `foreignCollision: null`.

**Two plan errors corrected to make the command run at all:**

1. The plan's documented command uses **space-separated** flags
   (`--expect-status candidate`). The runner requires `=` form and refuses otherwise:
   `--expect-status requires a value, e.g. --expect-status=candidate`.
2. The runner emits **`deploymentHash`**; the handoff schema the plan's own validator checks
   requires **`deploymentUrlHash`**. Mapped on write.

**`PHASE21_FOREIGN_TENANT_ID` was not supplied, so one was chosen and is disclosed here:**
`kn73kmcdzqxem7mkq4n5b9x2b18abrnq` — the owner's real tenant, the one the 17-07 Graph concurrency
probe ran against, genuinely distinct from the e2e user's `kn790hj6…`. The choice cannot game the
assertion: any tenant B ≠ A tests the same thing, and the snapshot confirms
`candidateIdVisible: false` with `foreignBefore.effective` differing from the candidate in both id
and bodyHash.

The plan's schema validator was run **verbatim** against the written artifact: `handoff ok`.

## What did NOT happen

No paid eval, no evidence write, no activation, no rollback, no `REQUIREMENTS.md` tick, no
`ROADMAP.md` tick. SKILL-01 and Phase 21 stay **pending**. The candidate is `status: candidate`,
`evidenceState: absent`, `gatePassed: false`, `rollbackEligible: false` — exactly the state 21-07
must find.

## Shared-tree note

`docs/playbooks/agent-runtime.md`, `docs/playbooks/cockpit.md`, `packages/backend/convex/smoke.ts`,
`packages/backend/convex/agentSteps.test.ts`, `packages/backend/scripts/run-eval-golden.mjs`,
`scripts/eval-cases/38-media-dispatch.json` and the untracked `41-image-proposal.json` carry a
**concurrent lane's `proposeImage` work** (the lane behind `add451e`). They were left untouched and
uncommitted by this plan. My row-5 mutation lived inside `run-eval-golden.mjs` and was verified
individually restored (`git diff` on that file contains no `filters.length` hunk).
