---
phase: 16-research-sub-agent-web-research
plan: 09
subsystem: research eval gate
tags: [research, eval-gate, skill-registry, containment, blocked]
requires: [16-06, 16-07, 16-08]
provides:
  - "Structural floor: a research run that never searched writes no vault document"
  - "Verified skill-version pins for the unpaid gate (@8/@4)"
  - "Corrected provenance in two playbooks and one production comment"
affects:
  - packages/backend/convex/dispatch.ts
  - packages/backend/convex/research.test.ts
  - packages/backend/convex/dispatch.test.ts
  - packages/core/src/growth/diagnose.ts
  - docs/playbooks/cockpit.md
  - docs/playbooks/skill-registry.md
  - docs/playbooks/growth-diagnostic.md
tech-stack:
  added: []
  patterns:
    - "refuse-the-artifact containment at a shared persist choke point"
    - "content-marker version readback instead of trusting seedSkills' report"
key-files:
  created:
    - .planning/phases/16-research-sub-agent-web-research/16-09-SUMMARY.md
  modified:
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/research.test.ts
    - packages/backend/convex/dispatch.test.ts
    - packages/core/src/growth/diagnose.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/skill-registry.md
    - docs/playbooks/growth-diagnostic.md
status: BLOCKED — tasks 1-3 complete except the paid gate; task 4 not reached
---

# 16-09 — the research eval gate

> ⚠ **THIS PLAN IS NOT COMPLETE AND THIS FILE IS NOT EVIDENCE.**
> `pnpm eval:golden` has NOT passed. No EVAL_GATE evidence row exists for any 33-case run —
> the highest `casesTotal` ever recorded on this deployment is **27** (run `ed251c29`,
> `cockpit-agent@15`). Phase 16 stays **8/9** and `ACTN-03` stays **Pending** until a run id,
> per-case verdicts, total cost and the active skill versions are recorded in
> `docs/playbooks/agent-runtime.md`. This is the 03.11-01 precedent: authored groundwork
> recorded honestly, never read as a passing gate.

## Why it is blocked

The OpenAI account has **no credits**. Gate run `f93ef691` (33 cases, tenant `eval-f93ef691`,
cap $2.00, all five pins correct) aborted inside `vaultSmoke:seedCorpus` before the first
fixture:

```
Uncaught Error: vault: embeddings API 429
  "message": "You have no credits remaining."
  "type": "insufficient_quota"
  "code": "credit_balance_exhausted"
  at async handler (../convex/vaultSmoke.ts:89:19)
```

**$0 was spent on that attempt.** A free chat-token allowance does not clear this: the gate has
three independently billed OpenAI dependencies, and the two the research fixtures rest on are
not covered by any token grant —

| Dependency | Where | Covered by free chat tokens |
|---|---|---|
| `text-embedding-3-small` | `vaultRag.ts:17` — corpus seeding | **No** — separate product |
| `gpt-4o-mini` | the agent turns | possibly |
| `openai.tools.webSearch` | `llm.ts:770` — provider-executed | **No** — per-call tool fee |

Measured cost of a full run, from `agent-runtime.md`: **~$0.83 clean, ~$1.06 with one research
retry**. Budget for two attempts, not one.

**Resume command — nothing else needs redoing:**

```
cd packages/backend
./scripts/launch-detached.ps1 -Command "pnpm eval:golden \
  --skill cockpit-agent@16 --skill research-specialist@8 \
  --skill offer-architect@4 --skill money-model-designer@4 \
  --skill lead-engine@4" -Label gate1609
```

## What shipped

### 1. The structural floor — a run that never searched writes no vault document

`persistResearchFindings` (`dispatch.ts`) refuses the `web_research` row when
`webSearchCalls === 0`, auditing `research.persist_skipped` with refs and counts only (§4).
One guard at the shared choke point — both `runResearch` and the offline twin route through it.

**Scoped to the vault document, deliberately.** `evidenceVerdict` + `NOT_RESEARCHED_LABEL`
already stamp *"nothing below is evidence"* on the stored body, and that ordering is documented
as load-bearing. The memo CARD lands before the persist seam, so it keeps the findings and the
label and **nothing the user can see is withheld**. Only the RETRIEVABLE artifact is withheld,
because `vaultSearch` returns arbitrary CHUNKS: a chunk sliced from the body carries neither the
label (which sits BEFORE the fence) nor the fence, so a never-searched model-memory answer could
re-enter a model context stripped of every warning and be cited by the Phase-12 engine as a
grounded market fact. The label contains it for a HUMAN reader of the card; only not-writing-it
contains it for a RETRIEVAL reader.

**Measured, not speculative.** Run `56bff5b8` fixture 34 declared the question unsupported having
made ZERO searches; run `eval-f795ede0` logged `webSearchCalls` of **1, 1, 1, 0, 0, 4** across six
dispatches. The body has carried an unconditional search mandate through three separate tunings and
was violated anyway — which is why containment is code, not a fourth sentence.

**It does NOT force a search** and cannot turn a `webSearchCallsAtLeast` fixture green. Forcing the
first tool call would edit `llm.ts`, which carries a zero-edit pin from 17.1-07, and is an unmade
decision. `ponytail:` note at the site records the no-retry ceiling and its upgrade path.

Mutation-verified: disabling the guard turned **exactly 1 of 17** `research.test.ts` tests RED;
restoring returned 17/17.

### 2. A regression this plan caused and caught

`f2fc990` was verified against `research.test.ts` and typecheck only — **not the full backend
suite** — and it broke `dispatch.test.ts`'s zero-search half, which asserted a `research.persisted`
row the floor now refuses. Fixed in `525eef8`. The distinction that test protects — *"never
searched" is not "searched and found nothing"* — is unchanged and still asserted, now via the
absence of `research.persisted` plus the `research.persist_skipped` row and an undefined
`vaultDocId`.

**Lesson worth keeping: a behavioural guard needs the whole suite, not the suite of the file you
edited.** The typecheck baseline held at 150 throughout and told us nothing.

### 3. Two provenance claims corrected before they hardened

- `diagnose.ts:60` read *"(eval run 56bff5b8, fixture 31, 4/4 attempts)"*. The runner's flake
  policy is **exactly one re-run** (`run-eval-golden.mjs:1323`), so a fixture runs at most twice.
- The same comment generalised to *"the executive records the checklist booleans but not the
  free-text list"*. Refuted by fixture 30's own dispatch in the SAME run, which carries an
  `evaluation.answered { field: "identity.currentOffers" }` row. It is phrasing-dependent — which
  is the actual argument for the fix, since the gate must be insensitive to which encoding arrives.
- `skill-registry.md`'s top block claimed the search mandate *"is now NUMBER-FREE"*. `841f668`
  reverted exactly that. HEAD carried a playbook actively misdescribing four shipped bodies.
- `growth-diagnostic.md` carried a placeholder deferring its write-up to "the authoring session";
  it is now an owned entry, and it was one `git checkout` from being lost.

## The version-collision trap was live, and avoided

`seedSkills` writes `maxVersion + 1` and optimizer dry-run candidates occupy versions, so
plan-authored pins are routinely wrong. Verified by **content marker**, not by the seed's report:

```
research-specialist    1*=no  2..7=no  8=YES
offer-architect        1*=no  2=no  3=no  4=YES     (* = ACTIVE)
money-model-designer   1*=no  2=no  3=no  4=YES
lead-engine            1*=no  2=no  3=no  4=YES
```

**Every ACTIVE row still carries the OLD body.** The committed bodies are at `@8`/`@4`. Pinning
the numbers any plan document names would have measured the wrong prompts and burned the run.
`cockpit-agent` stays at active `@15` / candidate `@16` (body unchanged, so no new version minted).

## What the paid evidence so far actually says

Run `56bff5b8` — **29/33, $0.3025** ($0.2290 executive + $0.0734 specialist), cap $2.00.
Failures were **29, 31, 32 AND 34** — four, not the three an earlier note recorded off a partial
stream before 34 finished.

Run `7faf396c` (research-**filtered**, $0.06, five dispatches) measured the sibling session's
`searchVault` removal and is the strongest signal available offline:

- `webSearchCalls: 1` on **all five** — never 0. The zero-search failure is **fixed**; the vault
  was a FREE substitute for the billed hosted search and the model reached for it.
- `vault.searched: 0` for that tenant, against **34** in run `56bff5b8` — independent confirmation
  the grant change is deployed and effective.
- but **all five declared unsupported, and all five searched exactly once**. Fixture 32 needs
  `webSearchCalls >= 2` AND `insufficientEvidence: false`; fixture 34 needs the latter. Fixture 33
  is satisfied and safe.

**A filtered run records NO evidence by design** (`run-eval-golden.mjs:16`), so `7faf396c` could
never have closed this plan whatever it scored.

## Open risks for whoever runs the gate

1. **Fixtures 29 and 31 remain the known risks** (`agent-runtime.md:53`).
2. **Fixture 33 is the keystone and was perturbed without measurement** — it passed under
   `research-specialist@4` and the body changed anyway. Check it FIRST. If 32 goes green and 33
   goes red, the phase is net worse off: 33 is the only fixture proving refusal-to-confabulate.
3. **Fixture 29 gained a new regression surface** from the widened `hasOffer`: one model-inferred
   `offerTypesPresent` leaf now routes it away from offer-architect entirely.
4. Run the gate **UNFILTERED**, or no evidence row is produced.
5. On a dispatch TIMEOUT the cost is read before `subagent.completed` is written, so an abandoned
   run's ~$0.21 reads as $0 while it keeps billing. Cross-check `npx convex data audit` (free).

## Gates at handoff

| Gate | Result |
|---|---|
| `@pikar/contracts` | 21/21 |
| `@pikar/core` | 382/382 |
| backend (`--maxWorkers=1`) | **898/898** |
| backend `tsc --noEmit` | 150, **zero non-test** (baseline held, delta 0) |
| `check-playbooks.mjs` | clean |
| `run-eval-golden.mjs --self-check` | 33 fixtures valid, $0 |
| **`pnpm eval:golden`** | **NOT RUN — no credits** |

Backend typecheck was 150 at handoff; a concurrent session was mid-sweep removing 100 dead
`@ts-expect-error import.meta.glob` directives (37 files), which takes it to ~50. That sweep is
22.1-03's, not this plan's.

## Task 4 was never reached

Task 4 is `checkpoint:human-verify`, `gate="blocking"` — the owner reads the recorded evidence and
types "approved". It cannot be self-certified, and there is no evidence to present yet. **16-09
closes only after the gate runs green AND the owner approves.**
