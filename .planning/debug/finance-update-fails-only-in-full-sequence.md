---
status: resolved
trigger: "37-finance-update fails 3/3 inside the FULL 40-fixture production gate and passes 5/5 in every smaller window; blocks recordEvalEvidence on production cockpit-agent@8; 2026-08-16"
created: 2026-08-16T15:55:00.0000000Z
updated: 2026-08-16T17:05:00.0000000Z
closed: 2026-08-16
resolution: fixed_fixture_defect
---

## RESOLVED 2026-08-16 — THE FIXTURE WAS WRONG AND THE AGENT WAS RIGHT.

**THIS SUPERSEDES THE "STOP / not_pursued" DECISION RECORDED BELOW**, which was correct on the
evidence available at the time and wrong about the cause. The owner reversed it and asked for a fix
and an activation; both happened.

### Root cause

The golden tenant's own seeded blueprint is **`Northwind <needle> Logistics`**
(`smoke.ts`, `seedGoldenEvalBlueprint`). Fixture 37's turn said:

> "Quick number for you — **Foxglove Bookkeeping's** cash on hand right now is $42,000 …"

**"Foxglove Bookkeeping" appears NOWHERE else in the repository** — not the tenant's business, not a
seeded contact, not a vault document. The fixture therefore asked the agent to record ANOTHER
COMPANY'S cash position as the USER'S OWN `cashOnHand`.

On a near-empty tenant the agent has nothing to contrast it against, charitably reads Foxglove as
the user's business, and stages the write → PASS. Once the tenant carries the confirmed Northwind
blueprint plus the contacts and companies the email fixtures create, the agent correctly reads
Foxglove as a **third party** — and a third party's cash position is not the user's `cashOnHand` —
so it stages nothing → FAIL. **The agent was behaving MORE correctly in the failing case.** Three
sessions read that as a routing failure.

The decisive tell was not the failure but the RETRY: with 14 fixtures ahead, 37 failed attempt 1 and
passed attempt 2 (`PASS (retried)`, run `25472dfa`). A deterministic poison fails both attempts
identically; a marginal one flips. That is what killed the "one bad fixture upstream" model and
sent the search to the fixture's own text.

### Fix

`packages/backend/scripts/eval-cases/37-finance-update.json` — the turn now reads **"our cash on
hand right now is $42,000"**. **ALL FOUR ASSERTIONS ARE UNCHANGED** (`financeClaimCount: 1`,
`statusAtMost: proposed`, `recipientCount: 0`, `attachmentCount: 0`), so this is a CORRECTION and
not a weakening: the old text tested charitable disambiguation on an empty tenant, which the
fixture's own description never claimed to test. Needles moved from the company name to
`$42,000`/`42,000`, a STRICTLY STRONGER §4 redaction probe — the VALUE is the sensitive half, and
`audit.payload` must carry refs/hashes/counts only.

### Verification

- **Full unfiltered production gate `e898d7d0`: 40/40**, pinned `cockpit-agent@8`, `$0.3710` exec +
  `$0.1194` specialist = **$0.4905**, exit 0, one retry (`20-reset-and-honesty`, a known flake
  unrelated to this work). **Evidence recorded on `cockpit-agent v8`.** Fixture 37 passed at
  **$0.0035** — its clean-window cost — with 36 fixtures ahead of it, the exact position that
  failed 3/3 before.
- **Production activated: `cockpit-agent` v6 → v8.** Read back active = v8; stored body sha
  `df23a5541f2b`, byte-identical to `packages/contracts/skills/cockpit-agent.md` LF-normalized (the
  raw sha `bcc166cdedd2` differs only because the working copy is CRLF — normalize before comparing
  or you will chase a phantom).
- **Unpinned live-path check, run `a40966d8`: 2/2** — `37-finance-update` and `40-calendar-stage`
  both PASS with NO `--skill` pin, so the loop loaded the ACTIVE row. That is the path a real
  conversation takes; every prior pass was against a pin.

### What production gained

v8 carries three lanes at once: 20-12's media sections, 20.1-02's Drive section, and item 4's
calendar section plus the merged document section. Active body went 38,454 → 40,273 chars and the
`## The user's calendar` section is now present, having been absent under v6.

### Historical record — the superseded decision follows

**The defect was real and open at the time this was written.** Production
`cockpit-agent@8` was a CANDIDATE and was NOT activated.

**What production actually serves, read from the deployment 2026-08-16 (free read-only
`skills:getActiveSkill`):** `cockpit-agent` **v6**, sha `dfb75850887e`, 38,454 chars — it **has**
the Drive section and **does NOT have** the `## The user's calendar` section. That is item 4's work
sitting undeployed, which is precisely what the gate is refusing to certify.

**Why the version numbers differ between deployments, since this confuses on sight:** version is a
PER-DEPLOYMENT counter, not a property of the body. `seedSkills` computes `maxVersion + 1` from that
deployment's own `skills` rows (`skills.ts:594`), and `skills.ts:592` skips an unchanged body, so
versions are burned by DISTINCT bodies only. Dev burned 25 of them (iterations, the superseded v25,
optimizer dry-run candidates); production burned 7. Identical bytes, different number.

**The consequence that makes dev's green run permanently useless here:** `hasPassingEvidence`
(`skill.ts:427`) requires `parsed.skillVersions[name] === version`. Dev's evidence names version
**26**; the production row is version **8**. Even hand-copying the evidence blob across would fail
that comparison. Evidence is structurally non-portable between deployments — each one must earn its
own gate. Do not attempt to shortcut this.

What that costs, stated plainly so nobody re-discovers it as a surprise: the calendar section, the
Drive section, 20-12's media sections and the document-section merge are all live on **dev** (v26)
and **none of them are live on production**. Anyone who reads "v26 is active" in
`skill-registry.md` and assumes that includes production will be wrong — that entry has been
corrected in the same change as this one.

Reopen only if the finance path itself misbehaves for a real user, or if production activation of
the cockpit body becomes required for other reasons. If reopened, start from "The blocker to
diagnosing it" below — NOT from another bisect round.

## Symptom

A full, unfiltered `eval:golden` run against **production**, pinned `cockpit-agent@8`, comes back
**39/40** with `37-finance-update` the only red. It has done so **3/3**. Because
`shouldRecordEvidence` requires `allGreen && casesTotal > 0 && filters.length === 0`, that one
fixture is the sole thing blocking `recordEvalEvidence` — and therefore `activateSkill` — on
production.

The failure is that the agent does not end the turn having staged a finance write. What is NOT
known is whether `stageFinanceWrite` was **called and refused** or **never called at all**.

## The two facts that define the shape

**1. Identical bytes, different verdict by deployment.**

| Deployment | Body | Unfiltered result |
|---|---|---|
| Dev, run `d59099cd` | `cockpit-agent@26`, sha `df23a5541f2b` | **40/40 green** — evidence recorded, activated, fixture 40 verified unpinned |
| Production, runs ×3 | `cockpit-agent@8`, sha `df23a5541f2b` | **39/40** — only `37-finance-update` red |

`cash.ts`, `llm.ts` and `financeClaim.ts` were confirmed byte-identical between local and
production, and the two skill rows hash the same. **This is not a code defect.** It is an
environment-plus-ordering effect that exists only on production.

**2. It passes in every window, and fails only at full length.**

| Window | Fixtures ahead of 37 | Result |
|---|---|---|
| `--only 37-finance` | 0 | PASS |
| `--only 27 --only 28 --only 37` | 2 | PASS |
| run `87826b1a` | 35, 36 | PASS |
| run `030449d7` (2026-08-16, $0.1581) | 30, 31, 32, 33, 34, 35, 36 | **PASS** |
| full gate ×3 | all 36 | **FAIL 3/3** |

## What run `030449d7` settled

8/8 green on production for $0.0501 exec + $0.1079 specialist = **$0.1581**, evidence suppressed as
expected for a `--only` run. It eliminates fixtures **30–36** as the cause and narrows the window
from 34 preceding fixtures to **1–29**.

It also confirmed, at no extra cost, that production is running the `evaluations.ts` provenance fix:
`30-gap-dispatch-money-model` and `31-gap-dispatch-lead-engine` both PASS here, where they failed
`actOnGap: gap_not_found` before that fix.

## Ruled out, all at $0

- Production code differing from local — three relevant modules byte-identical
- The skill body differing — both rows sha `df23a5541f2b`
- Fixtures 27/28 contaminating it — 27+28+37 pass 3/3 together
- Spend guardrails — caps are $5/tenant and $50/deployment daily; a full run is ~$0.50 on a fresh
  `eval-<runId>` tenant, and production's whole-day total was ~$1

## Leading hypothesis (UNTESTED — recorded so it is not re-derived)

Every fixture in a run shares **one** throwaway tenant (`eval-<runId>`). The two candidate
mechanisms that are both order-sensitive *and* environment-sensitive, which is the exact shape of
the evidence:

1. **A per-tenant rate limit** in the Convex rate-limiter component, configured differently on
   production than on dev, tripping only after ~36 fixtures' worth of turns on one tenant. Fits
   "prod-only" and "late-in-sequence-only" simultaneously.
2. **Accumulated tenant state** making the figure look already-recorded by the time 37 runs, so the
   agent answers instead of staging. Weakened by 27+28+37 passing, but not eliminated — the full
   sequence writes far more than 27 and 28 do.

## The blocker to diagnosing it

The harness cannot distinguish **called-and-refused** from **never-called**, because the tool-count
query `mediaDispatchCountForThread` is **hardcoded to a single tool name**. Generalising it to take
a tool name is **$0 in API spend**, and it is the one change that would turn this from bisection
into a direct read. Its cost is not money but a **production deploy**: push-to-main is the sole
promotion path, and the branch currently carries 94 commits ahead of main from lanes whose work has
not been read or verified here.

## Next options, with honest prices

1. **Keep bisecting** — `--only` fixtures 1–14 plus 37 (~$0.20), then halve again. Two to three more
   rounds at $0.20–0.40 each, and each round only narrows; none of them explains.
2. **Land the diagnostic query** — $0 in API, blocked on the production-deploy gate above.
3. **Stop.** `@8` is a calendar section plus a documentation merge. Production already runs the
   `evaluations.ts` fix, which was the half with real user impact. `@8` costs nothing sitting as a
   candidate.

Option 3 was the standing recommendation before run `030449d7` and remains it. The bisect was worth
its $0.16 because it was the cheapest thing that could still have found a one-fixture answer; it did
not, and the remaining window is the expensive half.

## Cost ledger

- Pre-`/clear` session: **$1.9739** (includes a $0.50 full gate re-run the session itself flagged as
  one it should not have spent)
- Run `030449d7`, this session: **$0.1581**
