# Phase 21 — live session 2026-08-18: what was executed, and what CANNOT be

Refs-only (CLAUDE.md §4). Deployment `b8c08f7d1a5e16e1c80eb69ccdd1c9870a923d4479387c1f1c28439bc39a49bf`
(local). Bound to handoff sha256 `30c9062a53562b26c0504fb328abab46ad2c2ab42fb0e267e2f28a8fd9805eb2`
and eval run `de976d8e` (`$0.49466045`, 41 cases) — **neither re-bought; $0.00 spent this session.**

This is NOT `21-LIVE-RESULT.json`. That artifact requires `authorRuntime`/`foreignRuntime`/
`promptRun`/`privacy` keys this session did not and could not produce, and Task 3 rejects a partial
object by design. Writing one would be a false pass.

## Executed and verified

| Plan step | Result |
|---|---|
| Task 1 — gate intact, bound to frozen handoff | PASS. self-check 14/14; handoff bytes unchanged; `compare-refs` 5/5, 0 mismatches |
| Task 2 step 1 — non-owner refusal | PASS. `OWNER_REQUIRED`, request `c868a28876ec1d28` |
| Task 2 step 1 — invisibility | PASS. `skills:myUserSkills` `[]`, `savedPrompts:list` `[]` as C |
| Task 2 step 1 — state unchanged | PASS. `compare-refs` 5/5; candidate immutables NONE changed |
| Task 2 step 2 — owner activation | PASS. `active` / `passing` / `gatePassed true`; effective became `qx73bwsh…` v12 hash `aee0008c…`; baseline archived; global + foreign unmoved |
| Task 2 step 5 — exact-baseline rollback | PASS. effective = `qx73cg6grg5gjr9tx1r3bzs5zx8ck3te` v1 hash `4b6a29f9…` active; candidate archived, evidence + hash + self-target preserved; `requiredEval: false` |

Non-owner identity: `kn735m0cmfyf8hx7khygbqjwx18cqndt` (`owner:viewer` → `{isOwner:false}`), admitted
through the BETA-01 invite door — waitlist → owner approve → redeem, `redeemedSubject`
`password|…` (provider-qualified, as designed).

## NOT executed — steps 3 and 4 are unrunnable as written

**Both facts verified, not assumed.**

1. **Tenant A is unreachable.** A (`kn790hj6pxay64s1pzrhrv6j2s8cep8s`) is `e2e-wave6@pikar.test`, a
   synthetic row. No password exists anywhere in the repo (full-tree search: 22 hits, all prose in
   `.planning/`), there is no reset flow, and `smoke.ts` exposes no entrypoint that runs the agent
   loop for an arbitrary tenant. Nobody can execute anything "in A's workspace", at any price.
2. **The step is not $0.** A specialist turn is a model call — sibling `subagent.completed` rows
   carry `costUsd` `0.00256` … `0.0541`. This contradicts the plan's truth #1.
3. **The existing witnesses do not substitute.** The only two audit rows attributing a run to
   `qx73bwsh…` sit under tenants `eval-de976d8e` and `eval-a88a4597` — the harness's per-run
   synthetic tenants. `userSkillRuntimeAttribution` re-checks `row.tenantId === tenantId`, so A's
   query returns `null` correctly. Eval isolation and runtime-witness reuse are in direct tension;
   the plan assumed they compose.

## Consequence

SKILL-01 stays **pending**. `REQUIREMENTS.md` and `ROADMAP.md` untouched. Owner boundary, owner
activation and exact-baseline rollback are proven live; **tenant runtime attribution is not**, and
the phase cannot claim it.

## Re-cut needed for steps 3–4

The proof must move to tenants that exist. Options, for the owner to choose:

- **Paid, faithful-ish**: run the specialist in the owner tenant (`kn73kmc…`) and in C
  (`kn735m0c…`), proving attribution + isolation between two REAL tenants. ~$0.05–0.25 per run.
  Does not prove it for A, and A's candidate is the one with the purchased gate.
- **Free, weaker**: accept the `eval-de976d8e` row as the mechanism witness, documented as a
  deviation — it proves *which registry row ran*, under the harness tenant.
- **Structural**: stop minting phase artifacts in synthetic e2e tenants. A candidate whose author
  tenant nobody can sign into can never have its runtime observed.

## Plan bug found

`21-08-PLAN.md` Task 1's verify block does `$H='…path…'; $h=Get-Content -Raw $H | ConvertFrom-Json`.
PowerShell variable names are case-insensitive, so `$h` IS `$H` — the path is overwritten by the
parsed object and `compare-refs` fails with ENOENT on a filename like `@{schema=…}`. Use distinct
names (`$hPath` / `$handoff`).
