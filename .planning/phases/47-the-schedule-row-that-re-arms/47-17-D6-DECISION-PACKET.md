# Plan 47-17 — ADR-046 D6 decision packet

**Prepared:** 2026-09-25. **Status:** technical proposal for independent review; no owner disposition recorded. **Operational state:** `defer`. This packet is not a D6 pass, stage amendment, new ADR, or release approval.

## Exact conflict

[ADR-046 D6](../../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md) lines 93–102 requires a pause to write paused state **and** cancel a pending scheduled function, best-effort when its ID may already have committed. Its callback must re-read status and version after claim. The accepted [ADR-050](../../../docs/decisions/050-recurrence-build-for-evidence.md) permits only a disabled, isolated candidate; it does not supersede D6. The [Phase 47 context](47-CONTEXT.md) preserves a 30-minute sweep/no-self-arm design for a later gated build. Those two scheduling contracts cannot both be treated as already satisfied by the current candidate.

The [candidate model](../../../packages/backend/candidate/recurrence/model.ts) lines 91–95 writes `paused` and increments version, but has no pending per-routine scheduled-function ID or cancel call. Its `claimTick` (105–135), `beginAttempt` (137–152), `finishAttempt` (154–187), and pre-mock-call reread (216–224) exercise state/version fences in synthetic `convex-test` transactions. [Candidate schema](../../../packages/backend/candidate/recurrence/schema.ts) lines 28–50 stores due time and active run, not a pending-function ID. The test explicitly leaves cancellation open at [model.test.ts](../../../packages/backend/candidate/recurrence/model.test.ts) line 128. These checks prove only part of D6, not a cancel operation, deployed transaction order, or an immediate production pause.

The production [cron registration](../../../packages/backend/convex/crons.ts) line 62 schedules the global `reliability-sweep` every 30 minutes for existing watchdog work. Its [handler](../../../packages/backend/convex/reliabilitySweep.ts) line 384 does not scan candidate routines. The global cron is not a per-routine pending callback and must not be canceled on one tenant's pause. The four already-armed [DST probes](../../../packages/backend/convex/dstProbe.ts) are independent ADR-046 D9 evidence jobs; do not rename, cancel, re-arm, or count them as recurrence scheduling.

The exact [stage decision](47-14-STAGE-DECISION.md) permits six `packages/backend/candidate/recurrence/` files outside the production Convex functions root (`convex.json`). The candidate has no tenant/app caller, provider or outbound path under the [47-16 review](47-16-TECHNICAL-REVIEW.md). No option below changes this accepted boundary by implication.

## Other candidate versus preserved production-design gaps

These are separate from D6 and must not be hidden by an A or B choice. The [Phase 47 context](47-CONTEXT.md) says the later gated production design will reference `savedPrompts`, compute due-ness from the routine's zone and last occurrence key, store no `nextRunAt` equivalent, and reuse the existing `deadLetters` table. The test-only [candidate schema](../../../packages/backend/candidate/recurrence/schema.ts) lines 23–39 instead stores `promptVersion`/`promptHash` directly and `nextDueUtcMs` plus next-local date/time, with no `savedPrompts` reference. Its lines 58–69 define a separate `candidateDeadLetters` table. The [candidate model](../../../packages/backend/candidate/recurrence/model.ts) lines 58–65 calculates stored next due values and lines 128–133 advance them after a claim. These choices make the isolated synthetic harness deterministic; they are **not** an approved production schema or a quiet revision to the preserved design. A future build must explicitly reconcile and independently test each difference, including outage/missed-run and repeated-wall-hour behavior, before any promotion. Resolving D6 alone does not make the candidate promotable.

## Owner dispositions for review

| Choice | Meaning | What must happen before D6 could pass |
|---|---|---|
| **A — preserve literal D6** | Design a cancellable per-routine pending function and keep ADR-046 D6 intact. | First review the change against the pinned sweep/no-self-arm decision and ADR-050 isolation; amend exact inventory and governance if needed, then build only a disabled candidate. Prove cancel-on-pause, already-committed/throw behavior, callback post-claim reread, outage/redeploy races, duplicate occurrence identity, no burst and no public/outbound edge. A scheduler stub alone is insufficient. |
| **B — sweep-specific supersession** | Keep the global sweep; seek a new, owner-accepted ADR narrowly replacing D6's *pending-function cancellation clause* with a proved invariant that no per-routine pending function exists. Retain immediate paused state, version fencing and callback/worker rereads. | Draft exact ADR text separately. Prove bounded due selection and transactional pause/claim ordering, queued and in-flight run refusal at every claim and before-paid boundary, no next-arm or catch-up burst, deploy/outage races, and no effect on other sweep work. Preserve D1/D3/D4/D7/D8 and D9 live requirements. Current synthetic tests are insufficient; do not mark the row `pass` until implementation, adversarial tests, independent source review and applicable live evidence exist. |
| **C — continue defer** | Leave ADR-046 and candidate as they are; D6 remains open. | No new authority. The operational manual rerun continues. |

**Recommendation for owner consideration, not a verdict:** B preserves the already reviewed sweep/no-self-arm architecture and avoids introducing a per-routine scheduler chain. It is acceptable only if a separate technical proof establishes the no-pending-function invariant and the owner accepts the exact narrow ADR text. If that proof fails, choose A through a new architecture review or continue C; do not silently interpret absent callbacks as a D6 pass.

## Non-negotiable proof and authority boundaries

- Both A and B need adversarial pause-vs-due-selection, pause-vs-claim, pause-vs-reservation, pause-vs-provider-call, retry, deployment-restart and delayed-callback tests. A running paid call is not interrupted mid-call, but no later paid step or external write may cross the moved approval. Terminal release and refs-only audit must hold on every branch.
- A design review must separate global sweep behavior from per-routine work, show a bounded scan/claim path and one occurrence key across repeated wall time, and prove tenant isolation. Synthetic `convex-test` results are `automated`, not deployed or `live` evidence.
- Any code or ADR change needs its own scoped plan, exact changed-file inventory, independent review and—if governance text changes—owner acceptance of that exact text. The current six-path stage does not grant production deployment, tenant activation, provider/paid calls or external writes/sends.
- The historical [29 decision](../29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md) remains `defer`; `dst-boundary`, `oauth-expiry-reauth` and `provider-read` each retain distinct real-world collected evidence and human review. The four DST jobs must remain stable through their last fire. An owner choice among A/B/C is a route selection only, not `enable-safe`, ROUT-02 closure, or a product release.

## Source snapshot and open checkpoint

Hashes below are SHA-256 of the exact files inspected on 2026-09-25. `crons.ts` was already modified; the accepted stage, ADR-050, `convex.json` and candidate directory were already untracked in this shared worktree. This packet does not adopt or reset those unrelated bytes.

| Source | SHA-256 |
|---|---|
| ADR-046 | `153412ad41ddf274799cf77019915c4d344103a6bf8fa74468e79cc0fd522b45` |
| ADR-050 | `5872061c0c2ffa2a1e481116f884af08ac26aa3dc94856a51f451bad236a3303` |
| `47-14-STAGE-DECISION.md` | `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34` |
| candidate `schema.ts` / `model.ts` / `model.test.ts` | `80276b9742cc115c44fe0fc0ff0588aca430d22dfdcc81c45d74216430053a60` / `3317bf07665fab773a9410b7df190d740206614a774137ff56866d5e62464100` / `272cd6b00328013c3ecda0d72a7f72ad11a009e12370e751905998cfda6596f2` |
| `crons.ts` / `reliabilitySweep.ts` / `dstProbe.ts` / `convex.json` | `2de9e9bc6f00390e046aa65dc79b70ad369f87378d61221d933ac0bf171d98fa` / `16fd8f86730f268b796ff9dcd7686a126a4cf573421833754d88c53f7544134a` / `c265841a87574166cb5957f6e7ac68ddf54c9c96299146a4e00177829311d0c0` / `93e8a633cf3140087ab69f76745e53ddf2e0eb727848d373d4adaeb32070a5b7` |

**Owner checkpoint (2026-09-25):** After independent technical/governance review accepted this packet for presentation, the owner answered: **“B — keep sweep; draft narrow D6 amendment (recommended)”**. This selects the *drafting path* for a sweep-specific, narrowly superseding D6 proposal. It does not accept any unseen ADR text, change ADR-046 or ADR-050, amend the six-file stage, pass D6, authorize production/tenant recurrence, or satisfy any live trace. A separate scoped plan must draft exact text and proof obligations; the owner must review that text before it can take effect.
