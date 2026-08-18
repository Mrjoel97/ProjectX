# 23-04 SUMMARY — the gate that judges what the agent wrote, and cannot be read by it

**Status:** complete. **Cost: $0.00 — NO PAID RUN OCCURRED.** Nothing seeded, no model called, no
evidence row written. **Date:** 2026-08-18. **Gate deviation:** inherited from `23-00-GATE`.

## Renumbering, decided before implementation

The plan named fixtures `40`-`44`. **`40-calendar-stage` and `41-image-proposal` already exist** —
the landed sequence differs from what the plan assumed, and the plan says to renumber once if so.
The five held-out authoring cases are **42-46**.

## Task 1 — the suite is now versioned

| Artifact | Nature | Update path |
|---|---|---|
| `packages/backend/scripts/eval-suite-manifest.json` | **Mechanical** — sorted filenames + SHA-256 each + a hash of the listing | `eval:golden -- --write-suite-manifest` |
| `AGENT_EVAL_SUITE` in `packages/contracts/src/skill.ts` | **Deliberate** — `{revision, casesHash, caseCount}` | hand-edit, **bump `revision`** |

Current: `revision "2026-08-18.phase23"`, `caseCount 46`,
`casesHash a01fc2857755e98ab2d6552d1993e641bac54f62a2eda1ec42ba2a54119a4d64`.

**It lives in contracts because the activation mutation runs inside Convex with no filesystem.** A
gate that can only be checked by reading `eval-cases/` off disk is not a gate the server can
enforce. The runner reads the block by regex (it has no build step) and asserts all three fields
against the fixtures actually on disk, so the three cannot silently disagree.

**`--write-suite-manifest` deliberately does NOT touch the contracts constant.** Regenerating is
cheap on purpose; deciding that older evidence stops counting is not. Asserted structurally.

### `hasPassingAgentTenantEvidence`

A **separate, stricter predicate**, not a tightening of the shipped `hasPassingTenantEvidence` —
tightening that one would silently invalidate every Phase-21 user candidate the moment a fixture
changed, which is a governance change to SKILL-01 smuggled in as a refactor. A test asserts both:
suite-less evidence is refused by the new predicate and **still accepted by the old one**.

Three conditions: exact-row identity, exact current suite (revision AND hash AND count), and
`casesPassed === casesTotal === caseCount` — the last is what refuses a `--only` run at the READER,
where the runner already refuses it at the writer.

## Task 2 — refs-only oracles, and the subtenant that makes the suite honest

`smokeAssert:agentAuthoringStateForThread` returns `authoringToolCalls`, per-row
`{id,name,version,status,author,authorAgentId,sourceTurnId,rollbackEligible,hasEvidence,
hasOwnerApproval}`, `activeIds`, `totalRowCount`, `requestCount`. **Never `body`, never
`authoredBody`** — the runner prints this into its own log.

`assertEvaluableCandidate` now accepts `author: "agent"`. **`system` is still refused, and that is
the load-bearing half**: a system row is the tenant's rollback baseline, the code's copy of its own
core. Certifying it would record evidence against a body nobody authored.

**Each authoring fixture runs in `eval-<runId>-<case>-a<attempt>`, and the attempt number is
load-bearing.** The v1 writer correctly refuses a changed draft while a candidate is pending, so on
one shared tenant fixture 42 would author a row and 43-46 would each be refused by 42's leftover —
a suite measuring its own first case four more times. The flake policy's single re-run fails the
same way, hence `a1`/`a2`. **No purge, patch, archive or test-only delete exists**: immutability
holds precisely because nothing is ever cleaned up. Ordinary fixtures keep the shared seeded tenant.

`--inspect-agent-source <tenantId>:<sourceThreadId>` — read-only, exits before any seed or model
call, mutually exclusive with `--skill`/`--tenant-skill`/`--only`/`--inspect-tenant-skill`, and
fails closed on zero or many rows. **Tenant-qualified on purpose**: a bare thread id would need a
cross-tenant scan, which is both unbounded and an existence oracle.

## Task 3 — the vocabulary, and its one rule

`agentToolCalled` · `agentCandidateCount` · `agentCandidateAtMost` · `agentInert` ·
`agentActiveUnchanged` · `authoringRequestCount`.

**THE RULE: every bound and every absence requires `agentToolCalled: true`.** A bound on a turn
where the tool never ran asserts nothing, and that is the single most likely way an authoring gate
goes quietly green forever. `validateFixture` refuses a fixture that omits it, and refuses agent
keys without `"authoring": true` (which would run the case in the shared tenant and block every
later one).

**`agentInert` is ONE key asserting FOUR facts** over every row a thread produced — status
`candidate`, no evidence, no owner approval, not rollback-eligible. Not four keys: a fixture must
not be able to assert three and drop the fourth, and under adversarial pressure the dropped one is
always the one that mattered. Each of the four is proven separately in the self-check.

**`agentActiveUnchanged` is a snapshot PAIR**, taken before the first turn and after the last — not
`activeCount: 0`, which a tenant that never had an active row satisfies for free.

The five fixtures: `42-agent-author-happy`, `43-agent-author-self-activate`,
`44-agent-author-capability-escalation`, `45-agent-author-embedded-instruction`,
`46-agent-author-retry`. **Named individually in the self-check, not merely counted** — a floor lets
five trivial cases replace five adversarial ones. Adversarial text lives only in the fixture files:
not in a skill body, not in a tool description, not in a playbook.

`evaluateExpect` takes ONE trailing object rather than six more positional scalars — that signature
already carries two written warnings about the parameter-shift trap, and six at once is asking for
it. **`null` fails EVERY agent key**, asserted explicitly: an authoring case whose oracle read was
skipped must fail, never pass.

## Task 4 — mutation evidence (all executed and restored)

| Mutation | Result |
|---|---|
| Drop the row-identity check from agent evidence | **1 red** (contracts) |
| Accept a stale revision / drifted `casesHash` | **1 red** |
| Honour a filtered (`--only`) run | **1 red** |
| Edit a fixture without regenerating the manifest | **self-check red**, naming `42-agent-author-happy.json` |
| Regenerate the manifest but leave `AGENT_EVAL_SUITE` stale | **self-check red** on the hash |
| Remove the pre-live `selfCheck()` call | **self-check red** — "must run the free self-check before entering the paid/provider path" |
| Read the fixture corpus inside `runAgentSourceInspect` | **self-check red** — holdout boundary |

## Worth not re-learning

- **`git checkout` and a stale backup both eat real work.** Restoring mutation 7 from a backup taken
  before the holdout guard was written silently reverted the guard. Caught by grep and re-applied.
  Take the backup AFTER the change you intend to keep, or diff before trusting a restore.
- **The runner is CRLF.** Multi-line `\n` anchors silently no-op against it. Every patch here went
  through a normalize-patch-restore helper rather than raw string replacement.
- **`agentSteps` has no `by_tenant_thread` index.** The oracle uses `by_tenant_tool_startedAt`
  (tenant + tool) and filters the thread in code — a tighter prefix anyway, and it is a handful of
  rows because each authoring fixture owns its own tenant.

## Measured

| Check | Result |
|---|---|
| `eval:golden -- --self-check` | **PASSED, 46 fixtures**, zero Convex calls, $0.00 |
| `@pikar/contracts` full package | **43 passed** / 3 files (`skillAuthoring` 8 → 15) |
| `@pikar/backend` `skills` + `llmRedaction` | **165 passed** |
| `tsc --noEmit` contracts / backend | exit 0 / **0 errors** |
| `biome check` on all four touched code files | 0 errors (6 warnings, pre-existing) |
| `check-playbooks` · `git diff --check` | exit 0 · exit 0 |

## Shared-tree note

`packages/backend/convex/_generated/api.d.ts` is modified in the tree by the **17-08 lane**
(`calendarEvents` module registration) and is NOT in this commit. The calendar lane committed its
work mid-plan, so `cockpit.md` and `schema.ts` separated cleanly this time.

## Next

`23-05` — owner activation: the distinct `ownerMutation` that writes `ownerApproval` and
`status: "active"` in ONE transaction, gated on `hasPassingAgentTenantEvidence`, plus the owner
review UI. **No paid run has happened yet; 23-07 is where the gate is spent.**
