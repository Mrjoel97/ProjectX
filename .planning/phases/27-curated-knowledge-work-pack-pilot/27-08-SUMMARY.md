---
phase: 27-curated-knowledge-work-pack-pilot
plan: 08
status: partial
completed: 2026-08-23
requirements: [PACK-01, PACK-03, PACK-04]
files_modified:
  - scripts/verify-knowledge-work-provenance.mjs
  - third_party/knowledge-work-plugins/manifest.json
  - packages/core/src/workflowPacks.ts
  - packages/core/src/workflowPacks.test.ts
  - packages/contracts/src/skill.ts                                # DEVIATION (PACK_EVAL_SUITE)
  - packages/contracts/src/skills/knowledgeWorkProvenance.ts       # NEW, DEVIATION
  - packages/contracts/src/skills/knowledgeWorkProvenance.test.ts
  - packages/contracts/src/skills/packEvalSuite.test.ts            # NEW, DEVIATION
  - packages/backend/convex/skills.ts
  - packages/backend/convex/skills.test.ts
  - packages/backend/convex/smoke.ts                               # DEVIATION (eval-tenant seeder)
  - packages/backend/convex/smokeAssert.ts                         # DEVIATION (leak scan)
  - packages/backend/scripts/run-workflow-pack-evals.mjs
  - packages/backend/scripts/workflow-pack-fixtures/*.json         # 36 reconciliation edits
  - packages/backend/scripts/workflow-pack-fixtures/thresholds.json # NEW
  - docs/playbooks/skill-registry.md
  - docs/playbooks/workflow-packs.md
---

# 27-08 — Final provenance, six DEV candidates, and an eval runner that can go red

**Deployment: DEV. Nothing prod was touched and no prod version number exists.**

Tasks 1 and 2 are complete and verified against the live dev deployment. Task 3's harness is
complete, self-tested and committed; **its six paid runs did not happen** — see *What is not done*.

## Per-pack DEV version numbers (read back, not assumed)

All six published at **v1**, all `status: "candidate"`, `versionCount: 1`, `provenanceValid: true`,
`evidenceValid: false`, `browserValid: false`. Re-running the publisher inserted nothing.

| pack | dev version | skillId | body sha256 (= manifest `adaptedBodySha256`) |
|---|---|---|---|
| `pack-business-pulse` | 1 | `kh7c1gcdkdgj5cxgs23j9akrkd8d1jbp` | `9a28d1a0…4b19a4` |
| `pack-campaign-plan` | 1 | `kh73pdp7r4zmeh2xs96hgkem058d0yyw` | `4bcee6bf…b2f4c1` |
| `pack-customer-complaint` | 1 | `kh7ecb0vwrgypcshv86tqnd8198d19h2` | `73b156ba…911442` |
| `pack-sales-call-prep` | 1 | `kh744kstp1vpgfebtr4q22mm4x8d10cg` | `a3ff998f…bd096a` |
| `pack-process-sop` | 1 | `kh7casthkg999r03pd9kx9wfh98d1c66` | `e49bdac2…fc4ba5` |
| `pack-brand-review` | 1 | `kh7129qqewmhw4g7km9rky9va18d1k7j` | `53bcde00…7a4919` |

The stored body hash equals the manifest hash of the canonical `.md`, which is the cross-check that
the derived `.ts` the runtime actually ships has not drifted from the bytes provenance pins.

**Dollars spent: $0.00.** No model turn ran. One embeddings call was attempted while probing the
seeding path and failed on an exhausted balance.

## Per-pack eval verdict

**None.** No pack has eval evidence. All six remain dark, and correctly so.

## The finding that shaped this plan

**24 of the 30 wave-2 fixtures asserted something the shipped runtime cannot produce.** 27-04/05/06
authored the corpus against the *contract* vocabulary; 27-07 wrote the deriving code afterwards.

- **21 named a `vault`/`web` state `probeSources` never returns.** It hardcodes both to `available`
  deliberately — an empty vault is the tool's own honest answer, not a preflight fact. Also
  surfaced: `calendar` is never `unavailable` (an empty calendar is `partial`) and `finance-inputs`
  is never `partial` (the spine exists or it does not).
- **3 expected an outcome `outcomeFor` never derives.** `blocked` is a guardrail stop, `failed` is a
  thrown bug, and **nothing anywhere in the system emits `refused`**.

The owner ruled *fix the corpus, not the runtime*. `workflowPackBinding.ts` is byte-unchanged; 36
fixture edits landed. Two structural cases changed meaning and are recorded as such:
`business-pulse-02` no longer expects `read-finance-figures` (the preflight tells the pack the
figures are unreadable, so the tool is never called), and `process-sop-04-drive-sourced` became
`process-sop-04-drive-unreadable` because the eval tenant has no Drive.

What keeps them reconciled is code, not memory: `PACK_SOURCE_PROBE_STATES` declares what the probe
can return per source, a test SCANS `probeSources`' own return block so the declaration cannot drift
from it, and the runner refuses any fixture outside those states or outside the three derivable
outcomes. **A case that can only ever fail is worse than no case** — it makes an honest red run
indistinguishable from a broken pack.

## Decisions the next plan must carry

1. **Evidence is SUITE-BOUND now.** The pack gate's eval plane is `hasPassingPackEvalEvidence`, not
   `hasPassingEvidence`: it additionally requires `runner: "eval:pack"`, `PACK_EVAL_SUITE.revision`,
   this pack's exact fixture-file hash and count, and `casesPassed === casesTotal === caseCount`. A
   global-scope blob carries no suite identity, so before this an `eval:golden` row — or a pack row
   from a corpus since rewritten — would have gated an activation silently.
2. **No wall clock may enter pack provenance.** `publishPack` treats `(body, provenance)` as the
   identity of a version, so a `Date.now()` mints candidate N+1 on every re-run. `ts` is the pinned
   upstream commit's timestamp; publication time is `skills.createdAt`.
3. **The version is resolved BEFORE provenance is built.** Predicting `newest.version + 1`
   unconditionally deadlocks: the duplicate check declines to mint v2, then the pin check rejects
   provenance naming v2, forever.
4. **The adapted hash is over LF-normalized bytes.** `* text=auto` makes a raw-byte `.md` hash
   machine-dependent, and LF is what actually ships.
5. **`drive` is honestly unavailable for every eval case.** There is no Drive fixture seam (unlike
   `inboxFixtures`), so a Drive-scoped token would make the preflight promise a plane every call
   403s. `findInDrive` / `listDriveFolders` therefore have **no eval coverage at all**.

## What is not done, and why

**The six paid per-pack eval runs.** The dev deployment's OpenAI key returns
`insufficient_quota` / `credit_balance_exhausted`; no run can reach a model today. This is the
failure mode this repo has already paid to learn — it presents as every case failing at $0.0000,
which reads exactly like six broken bodies — so the runner now classifies provider/quota/network
failures and a failed tenant seed as `EnvironmentAbort` (exit 2) rather than a verdict.

Also stated rather than papered over:

- `citationCoverage` / `unsupportedClaimRate` still report `not_applicable: no_data` in the
  production plane. This runner grades citations and fabricated money for the eval corpus and puts
  the numbers in its report; it writes no claim counts into `workflowPackEvents` (that table is
  insert-only and the binding owns its rows).
- `vaultSmoke:seedCorpus` is **not free** — it embeds through the OpenAI API. It gets one retry.

## To run the evals (once the balance is topped up)

```
cd packages/backend
node scripts/run-workflow-pack-evals.mjs --self-test          # free; always first
node scripts/run-workflow-pack-evals.mjs --packs business-pulse     --candidate
node scripts/run-workflow-pack-evals.mjs --packs campaign-plan      --candidate
node scripts/run-workflow-pack-evals.mjs --packs customer-complaint --candidate
node scripts/run-workflow-pack-evals.mjs --packs sales-call-prep    --candidate
node scripts/run-workflow-pack-evals.mjs --packs process-sop        --candidate
node scripts/run-workflow-pack-evals.mjs --packs brand-review       --candidate
```

One pack per invocation, never `--all`, against a verified-stable `convex dev`. A failing pack
blocks only that pack. Exit 0 green + evidence written · 1 the pack failed · 2 environment.

## Evidence

- `node scripts/verify-knowledge-work-provenance.mjs --check` green; **three mutations observed
  RED** (a wrong hash, a reverted-to-pending hash, a drifted `.ts`) and restored.
- `packages/core` 43 files / 1176 · `packages/contracts` 6 / 93 · **backend 99 files / 2457**.
- Three typechecks clean; `biome ci` clean over the touched files.
- `--self-test` 35 rejections; **observed RED** by disabling the scorer's forbidden-tool check.
- The cross-registry parity test **observed RED** by giving one operation id two states.
- The `probeSources` scan test **observed RED** by changing one probe branch.
- Live on dev: publish → read back → re-publish (0 inserted); the seeding path (`gmailAuth`,
  `cash`, `calendarEvents`, the leak scan) verified plane by plane at $0.
