# 20-12 — SUMMARY

**Plan:** the media candidate — teach the executive body `dispatchMedia`, certify it through the
gate, activate it, and observe it conversationally at zero media spend. **Status: complete**
(2026-08-15), with ONE deliberate scope extension recorded below. **Cost: $1.7546 in eval runs**
($0.4420 + $0.4255 + $0.4621 + $0.4250) **+ ~$0.05 in A/B probes; $0.00 media spend.**

## What is live, and where

The SAME certified body is active on BOTH deployments, each behind its OWN evidence row —
evidence does not travel between deployments, and both activations were separate owner acts:

| deployment | version | gate run | result | activation (owner verbatim) |
|---|---|---|---|---|
| local dev | cockpit-agent@24 | `62903ef6` | 38/38, $0.4621, retries 23/35/38b | `activate media candidate 24` |
| prod `opulent-octopus` | cockpit-agent@5 | `7d3b852e` | **38/38, NO retries**, $0.4250 | `activate media candidate 5` |

Both readbacks proved active version + body byte-identical to
`packages/contracts/skills/cockpit-agent.md`. Prod v5 was minted by the deploy pipeline's own
seed step at `b65a876` (PRs #14/#15/#16 — see `docs/playbooks/skill-registry.md` and
`lanes-share-one-working-tree` memory for why it took three PRs).

## The two RED cycles before green, and what they taught

**Run `420c852b` (v22, 35/38): both media failures were the HARNESS** — `mediaDispatchCount`
counted the specialist run `dispatch.ts` schedules under the same tool name (fixed with the
`dispatch:` stepKey exclusion, pinned in `agentSteps.test.ts`), and fixture 38b's caveat bullet
swallowed the action ("slide deck" pattern-matched the .pptx caveat into producing NOTHING).
Commit `bde9049`.

**Run `cc63246f` (v23, 36/38): both reds were PRE-EXISTING judgement flaws, not the media delta.**
- `37-finance-update`: the body's stage branch said "one of `stageFinanceWrite`'s five" (abstract)
  while the scorecard branch carried a literal tool + dot path (concrete). Concrete beats abstract:
  the agent routed stated cash-on-hand to `recordScorecardAnswer`+`evaluateBusiness` ~half the
  time, on v22 AND v23 (A/B ~$0.025). Present since v20 — likely why no finance candidate ever
  certified.
- `20-reset-and-honesty`: the trace shows `resetPlan` RAN, then the model re-staged the cancelled
  subject+body — "draft to Tom Alvarez instead" read as the same email re-addressed.

Both diagnosed at $0 AFTER a `/clear` wiped the conversation: the failing runs' plan rows and
`agentSteps` still lived in the eval tenants, and the prior session transcript held the per-try
tool traces the runner never persists (it writes evidence only on all-green). Two-bullet fix →
v24 (commit `972db7b`): the five figures named inline with the tool, and the fresh-start bullet
now states "instead" is a NEW email. Both fixtures then passed FIRST-TRY on both deployments.

## Task 5 — the no-spend conversational observation (owner, on PRODUCTION)

Performed on www.pikar-ai.com after v5 activation. Owner verdict verbatim:
**"i approve both cases worked."**
1. A plain-language reel ask staged one proposal card; Generate was NOT clicked.
2. (Extension) "what's up with my inbox?" routed to inbox tools — the regression the owner had
   reported against prod v2, which spent full 8-step budgets walking `listDriveFolders` on inbox
   asks (prod `agentSteps` bursts on record).

**Zero-spend proof:** prod `mediaJobs` newest row was 13.5h OLDER than the observation; the
observation added zero rows and zero `actualCents`. (Nine historical priced rows predate this
plan and are ADR-020's subject, not this plan's.) Exact thread/plan refs for the owner's live
turns were not captured — owner-attested, like the phase-19 inbox observation.

## Deviations and open items

- **The v24 bullets touch finance and compose sections, outside this plan's "media is the only
  instruction delta" scope.** Owner-approved explicitly before the edit ("Both edits, run gate").
- **MEDIA-01 stays PENDING**: this plan's condition was "complete only if 20-11 evidence is
  complete" — `20-11-PLAN.md` has no SUMMARY, so the 20-11 half is unevidenced.
- **Drive-boundary body teaching deliberately deferred to 20.1-02** (its actual owner): the
  runtime hands `findInDrive`/`listDriveFolders` to every executive turn but the body teaches
  nothing about them. v5 routes inbox asks correctly (observed); 20.1-02 should add the teaching
  AND a fixture negative pinning "an inbox ask calls zero Drive tools" (equality, never a floor —
  the `mediaDispatchCount` pattern).
- **`docs/playbooks/cockpit.md` was NOT bumped at close** — the concurrent 17-07 lane held it
  dirty; the activation evidence lives in `skill-registry.md` (`f618c2f`) instead.
- The prod deploy key sits in the gitignored root `.env` under a nonstandard name
  (`Convex_Production_deploy_key`); owner advised to delete the line when done.
