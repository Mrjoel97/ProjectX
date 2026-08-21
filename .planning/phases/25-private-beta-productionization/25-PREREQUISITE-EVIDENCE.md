# Phase 25 prerequisite evidence

## GATE RE-SCOPED — 2026-08-16, at owner direction

**This section supersedes the Task 1 verdict below. Everything under "Gate status" and after is
retained as the audit history that produced this decision, and its rows remain true as statements
about those lanes — they are simply no longer all Phase 25 blockers.**

Phase 25 was gated on effectively the whole v2.0 milestone (14, 15.3, 17, 17.1, 18, 19, 20, 20.1,
21, 22.1, 23, 24, 26, 31). Two defects in that scoping were found while reviewing Phases 23 and 25
for simultaneous execution:

1. **A cycle.** Phase 23's first must-have truth blocks on GOVN-01 closure; GOVN-01's closure was
   scheduled inside `25-02`; this plan blocked `25-02` behind Phase 23. The 2026-08-16 milestone
   audit names it: *"Phase 23 depends on Phase 22 closure, while the old Phase 25 plan assigned that
   closure behind Phase 23; Phase 22 must close independently."* **It has since closed
   independently** — `22-VERIFICATION.md` `status: passed` 5/5, GOVN-01 Complete in REQUIREMENTS.md.
   The cycle is broken; no further action is needed on it.
2. **Two requirement lanes conflated.** Phases 23/24/26/31 carry SKILL-02, GOVN-02, product-page and
   marketing scope that **no Phase 25 requirement consumes**. They share source files with Phase 25.
   That is a working-tree sequencing problem, not a requirement dependency, and gating on it stalled
   both lanes indefinitely.

`25-00-PLAN.md` is amended accordingly. Tasks 2 and 3 are **unchanged** — the quiescent-baseline
requirement, the foreign-lane stop rule, and the full Plan 01–13 structural + goal-backward
re-verification all still stand.

### Narrowed prerequisite matrix — derived per requirement

| Phase 25 requirement | Lane it actually consumes | Evidence | Gate |
| --- | --- | --- | --- |
| BETA-01 — invite-only signup | Phase 22 `requireOwner` (admin/ops surface) | `22-VERIFICATION.md` `status: passed`, 5/5, 2026-08-15T22:02Z. Owner-wrapped at source: `optimizerConfig.ts:93`, `skills.ts:371`, `skills.ts:391`. `/ops` presentation half at `29103e9`. | **PASS.** |
| BETA-02 / BETA-05 — cross-tenant isolation | Phase 22.1 table registry, export and erasure | GOVN-03 Complete 2026-08-16. Export `22.1-04`, erasure `22.1-05`, both live-proven on production SHA `1ca7c6f`. Erasure `a73023088f58ea6e`: 1,538 rows / 24 tables removed, `audit:countAudit` still **304** — §3 immutability proven on real data. | **PASS.** |
| BETA-03 — first result via guided onboarding | Phase 11 + Phase 15.1 | Phase 11 complete/verified 2026-07-24 (sparse-start admission). Phase 15.1 `15.1-VERIFICATION.md` `passed`, ONBD-01/02 Complete. | **PASS — 15.1's `planned` VALIDATION is bookkeeping residue behind a passed verifier.** |
| DLVR-02 — Outlook via the same adapter | 17-06's ONE shared Microsoft connection (ADR-018) | `17-06-SUMMARY.md` present; grant, callback and connect page live and browser-verified at `a36c641`, `72ff6bc`, `d783479`. `microsoftAuth.ts` holds one token store with `microsoftMailReady()` deriving mail readiness from granted scope. | **PASS. 17-07..17-11 are calendar MANAGEMENT (ACTN-02) and are not on the mail path.** |

**Task 1 verdict under the narrowed scope: every consumed lane is closed.** The gate now turns on
Task 2's baseline conditions, not on prerequisite completeness.

### Excluded lanes — DEFERRED, NOT COMPLETE

Recorded here so the narrowing can never be misread as closure:

| Lane | Real status | Why excluded |
| --- | --- | --- |
| **Phase 23 — Agent-Authored Skills (SKILL-02)** | **BLOCKED, 9 plans unexecuted.** Its own `23-01` truth stops execution until Phase 21 has a validated `21-LIVE-RESULT` and SKILL-01 closure. Measured 2026-08-16: `21-06`/`21-07` have no SUMMARY, neither `21-LIVE-HANDOFF.json` nor `21-LIVE-RESULT.json` exists on disk, SKILL-01 `Pending`. | No Phase 25 requirement consumes SKILL-02. Shares nine files with Phase 25 — sequencing, not dependency. |
| Phase 24 (GOVN-02), Phase 26, Phase 31 (MKTG-01..03) | Open. 24-02 unexecuted; 26 has 10 unexecuted plans; 31 has 8, zero SUMMARYs. | No Phase 25 requirement consumes them. The private-beta waitlist path lives on the existing signup page per `25-02`, so no marketing surface is required for admission. |
| Phase 14, 15.2, 15.3, 17-07..17-11, 17.1, 18, 20, 20.1, 20.2 | Open — see the historical matrix below for each. | None is on an admission, isolation, onboarding or mail path. |
| Phase 32 | Legally blocked; legal entity not started. | **Unchanged** — expressly off Phase 25's critical path per ADR-015. |

### SUPERSEDED BY EVENTS — 25-01 LANDED WITHOUT THIS GATE (2026-08-16, same session)

**Read this before treating anything below as the live sequencing rule.**

While this re-scope was being written, a concurrent lane executed and committed Plan 25-01:

- `a584793` — `feat(25-01): the beta admission trust boundary — nothing persists for an uninvited
  identity` (adds `packages/backend/convex/invites.ts` + `invites.test.ts`, and amends
  `schema.ts`, `auth.ts`, `lib/allowlist.ts`)
- `c1877ce` — `chore(playbooks): register the BETA-01 invites module under authorization`

**`.planning/phases/25-private-beta-productionization/` still contains NO `25-00-SUMMARY.md`.** The
Task 1 and Task 3 checkpoints in `25-00-PLAN.md` are `checkpoint:human-verify` with
`gate="blocking"`, and that plan's own `<done>` reads *"Owner types `approved` on the reconciled
plan set; only this approval releases Plan 25-01."* No such approval is recorded anywhere in this
directory.

**So the ordering contract in `25-00-PLAN.md` is now factually contradicted by the repository.**
This document does not resolve that, and MUST NOT be read as ratifying it. Two readings are
available and only the owner can choose:

1. **The gate is retroactively satisfied** — the narrowing above shows every consumed prerequisite
   was in fact closed before `a584793` landed, so 25-01 ran against a genuinely clear board and the
   missing artifact is bookkeeping. If so, `25-00-SUMMARY.md` must be written to say exactly that,
   naming `a584793` as having preceded it.
2. **The gate was skipped** — in which case 25-01's landed code has never been checked against
   Task 2's baseline inventory (schema/wrapper-export/Gmail-caller/onboarding re-inventory) or
   Task 3's plan-set re-verification, and that check is now owed retroactively.

**Do not write `25-00-SUMMARY.md` from this file.** A summary asserting a blocking human approval
that did not happen is the precise defect this document exists to prevent, and it would flip the
mechanical PLAN↔SUMMARY scan to "closed" for a gate nobody cleared.

### Blocking conditions that remain, and are NOT prerequisite completeness

1. **The working tree is MOSTLY quiescent — the code half cleared mid-session.**
   - *Measured 2026-08-16, earlier in the session, at HEAD `15ef427`:* a foreign lane held
     uncommitted edits in `packages/backend/convex/schema.ts` (+37 lines, `AGENT_STEP_REFUSAL`),
     `llm.ts`, `agentSteps.ts`, `packages/core/src/storyboard.ts`, `financeClaim.ts` and
     `docs/playbooks/onboarding.md`. `schema.ts` is owned by `25-01`/`25-05`, `llm.ts` by `25-09`,
     `onboarding.md` by `25-04`. Owner decision: **wait, do not absorb.**
   - *Re-measured the same session at HEAD `1c5b6dc`:* **that lane committed.** Three commits landed
     (`8eb0dd7` 33-11, `e831c73` docs(eval), `1c5b6dc` 33-12) and **every one of those source files
     is now clean.** `25-01`'s and `25-09`'s file blocker is CLEARED without anything being stashed,
     reset or absorbed — the wait was the correct call and it cost nothing.
   - *Still held:* `docs/playbooks/onboarding.md` (+8 lines) carries an uncommitted CLAUDE.md §9
     disclaimer from the same phase-33 lane. It is **documentation only, no code**, but the file is
     owned by `25-04`. It is the one remaining foreign edit in a Phase 25 owned path.
   - This is the fourth recorded instance of HEAD moving under an active session in this tree.
     **Re-measure `git status` immediately before `25-01`, never trust an earlier reading.**
2. **Task 1 and Task 3 remain blocking human checkpoints.** Only the owner releases `25-01`.

### File-collision map — Phase 23 against Phase 25

Both phases are live lanes in ONE working tree (there are no per-lane worktrees). If both are ever
in flight, these are the collision points and they must be wave-sequenced, never concurrent:

| File | Phase 23 plans | Phase 25 plans |
| --- | --- | --- |
| `packages/backend/convex/schema.ts` | 23-01, 23-03 | 25-01, 25-05 |
| `packages/backend/convex/llm.ts` | 23-03 | 25-09 |
| `apps/web/app/(app)/ops/page.tsx` | 23-05 | 25-02 |
| `apps/web/app/(app)/dashboard/workspace/cards.tsx` | 23-03 | 25-04, 25-06 |
| `docs/playbooks/cockpit.md` | 23-03, 23-05, 23-09 | 25-04..25-09, 25-13 |
| `docs/playbooks/skill-registry.md` | 23-01, 23-02, 23-04, 23-05, 23-09 | 25-03 |
| `docs/playbooks/authorization.md` | 23-05, 23-09 | 25-02, 25-03 |
| `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` | 23-09 | 25-13 |
| `apps/web/playwright.config.ts`, `apps/web/e2e/auth.setup.ts` | 23-06 (rewrites both) | consumed by `admin.spec.ts`, `onboarding-first-send.spec.ts`, `mail-provider.spec.ts` |

`23-06` rewriting the shared Playwright auth setup is the sharpest one: it introduces two controlled
identities with separate gitignored storage states, which every Phase 25 authenticated spec then
runs against. **Phase 23's `23-06` must not land mid-Phase-25.**

## Gate status

- **Original audit point:** `aa5445bd9b7288b47f12b7c75607f064fee7be37` on 2026-08-10.
- **First re-audit point:** `d274281` on 2026-08-14, after 141 commits.
- **Second re-audit point:** `8062157` on 2026-08-15, after a further **67 commits** on
  `feature/cash-business-finance`. A 68th (`8062157`) landed from a concurrent lane *during* this
  audit — see "Shared-worktree" below.
- **Task 1 result:** **STILL BLOCKED — not eligible for owner approval.** Four more rows cleared, one
  materially worsened, and **four gap classes surfaced that no prior pass had a row for**.
- **Evidence rule (unchanged):** a ROADMAP checkbox, plan count, or later narrative does not override a
  SUMMARY/VERIFICATION/UAT artifact that remains open. Completion requires final code plus reconciled
  phase evidence at one auditable commit.
- **Execution boundary:** no Phase 25 application code has been changed by this audit. Rows only.

## Method note — three blind spots this pass found in the method itself

Every row is derived from two mechanical facts: whether an `NN-PLAN.md` has a matching
`NN-SUMMARY.md`, and the `status:` frontmatter of the phase's VALIDATION/VERIFICATION file. The
2026-08-10 pass found phases whose ROADMAP rows disagreed with their own verifiers. The 2026-08-14
pass found a phase with **no roadmap row at all** (20.2). This pass found three more classes the
PLAN↔SUMMARY scan cannot see:

1. **Work with no plan number.** Phase 19 commits `b73bff8` (19-11) and five 19-12 commits executed
   real defect closure and a 15/15 owner UAT. **Neither `19-11-PLAN.md` nor `19-12-PLAN.md` exists.**
   The scan cannot count what was never planned on disk. Phase 19 is genuinely `passed`, so this
   produced no false-open — but the same shape elsewhere would be invisible work.
2. **Colliding plan numbers across two planning systems.** Commits `dc2dcc0`, `c870d8f`, `5be62bd`,
   `d1d2455`, `6f1c66d`, `8062157` and eleven more are tagged `21-01` / `21-02` and are **not GSD
   Phase 21**. They belong to a parallel `docs/superpowers/plans/` lane (scorecard field provenance;
   the proposals table + applier). GSD `21-01`…`21-05` were closed long before. `git log --grep 21-0`
   cannot separate them. **GSD Phase 21 has advanced by exactly zero plans since the last audit.**
3. **Phases never entered in the matrix at all.** Phases **15, 15.1 and 15.2** are inside the
   14→25 range and appeared in no prior version of this table. They are added below.

## Prerequisite completion matrix — 2026-08-15 at `8062157`

| Included lane | Evidence inspected | Finding | Gate |
| --- | --- | --- | --- |
| Phase 14 — Flagship Voice-Doc | 9/9 plans closed; `14-VALIDATION.md` `complete_with_open_observations`; DOCV-01 Complete. | Unchanged from the 08-14 clearance. | **PASS.** |
| Phase 15 — Sub-Agent Dispatch | **NEW ROW.** 6/6 plans closed; `15-VERIFICATION.md` `passed`; `15-VALIDATION.md` still `draft`. DISP-01/ACTN-01 Complete. | Substantively complete. The `draft` VALIDATION is stale bookkeeping behind a `passed` verifier, not open work. | **PASS — bookkeeping residue only.** |
| Phase 15.1 — Tier & Conversational Onboarding | **NEW ROW.** 7/7 plans closed; `15.1-VERIFICATION.md` `passed`; `15.1-VALIDATION.md` `planned`. ONBD-01/02 Complete. | Same shape as Phase 15. | **PASS — bookkeeping residue only.** |
| Phase 15.2 — Vault Universal Format Recognition | **NEW ROW.** 8/8 plans closed. `15.2-VALIDATION.md` `planned`. **No `15.2-VERIFICATION.md` exists at all.** | Code-complete and **never verified**. Its criteria are local SC#1–SC#7, not milestone requirements, so it holds no requirement hostage — which is why every prior pass missed it. But the vault extraction fan-out that 15.3/15.4/20.1 all build on has no verifier of its own. | **OPEN — unverified phase. Lowest severity in this table; must not be recorded as complete.** |
| Phase 15.3 — Vault folders / Drive import | 9/9 closed; `15.3-VERIFICATION.md` `human_needed` 9/10; VALT-05…12, VALT-14 Complete; VALT-13 Pending. | Unchanged. No real Drive file has traversed `exportOne → landFile → fan-in → member ingest → digest`; this rail has spent $0. | **BLOCKED — owner live gates H1/H2/H3 ONLY. No code work outstanding.** |
| Phase 15.4 — Vault redesign / scoped browse | 4/4 closed; VALIDATION `complete`; VERIFICATION `passed` 5/5; VALT-16 Complete. | Unchanged. | **PASS.** |
| Phase 16 — Research Sub-Agent | 9/9 closed; `16-VALIDATION.md` `complete`; DISP-02 + ACTN-03 Complete. | Unchanged. | **PASS.** |
| Phase 17 — Calendar actions | **MOVED.** `17-06` now closed (SUMMARY present) — the Microsoft grant, callback and connect page are live and browser-verified (`a36c641`, `72ff6bc`, `d783479`). **`17-07` code landed across six commits** (`aaf7059`, `1bb1dde`, `c6db979`, `587a526`, `a221d1b`, `449cd68`) — `microsoftCalendar.ts` exports `freeBusy`, `createEvent`, `graphConcurrencyProbe`; `calendarViews.ts` and `packages/core/src/calendarManagement.ts` exist — **but `17-07-SUMMARY.md` does not.** `17-08`…`17-11` unexecuted. `calendarEvents.ts` still does not exist. `17-VERIFICATION.md` `gaps_found`. | Real progress: the "(Google / Microsoft)" half of ACTN-02 is now largely built. The **"manage" half is still absent** — `calendarEvents.ts` (update/cancel) is 17-08's deliverable and was never started. 17-07 is the repo's only *unclosed-but-landed* plan: its code is in main-line history with no evidence artifact. | **BLOCKED — close 17-07, then 17-08 → 17-09 → 17-10 → 17-11 (11 is an owner live gate).** |
| Phase 17.1 — Business Blueprint | `17.1-10-PLAN.md` still has no SUMMARY. `a2d7a0b` then `bc05eed` record a **failed** L6 gate recovery; nothing since. | Unchanged and still the worst-diagnosed row. **Newly discovered: it is also an ordering prerequisite for Phase 18** — see the ordering inversion below. | **BLOCKED — diagnose the failed recovery, then execute 17.1-10.** |
| Phase 18 — Document & Content Creation | `18-09`, `18-10` no SUMMARY; `18-VALIDATION.md` `planned`; ACTN-04 Pending. 18-09 `depends_on` 18-10. | Unchanged in count. **The dependency is deeper than the audit recorded:** `18-10`'s own must-have truth is *"17.1-10's live gate ran BEFORE any Phase-18 artifact could corrupt the number it measures."* | **BLOCKED — and it is 17.1-10 → 18-10 → 18-09, not 18-10 first.** |
| Phase 19 — Contacts, CRM & Follow-ups | `19-VERIFICATION.md` `passed` 8/8, `human_verification: complete`. ACTN-05, PIPE-01 Complete. `19-11`/`19-12` executed with no PLAN or SUMMARY files (method note 1). | Complete. The missing 19-11/19-12 artifacts are a method blind spot, not open work. | **PASS.** |
| Phase 19.1 — Bulk Contact Import (CSV) | 7/7 closed; VERIFICATION `passed` 11/11; owner `approved`. | Unchanged. | **PASS.** |
| Phase 20 — Media Canvas | **MOVED.** The plan set is now 20 plans, not 12 — `20-13`…`20-20` all carry SUMMARYs. **`20-12` is CLOSED** (`f618c2f`, `306879c`: certified body live on both deployments, readback proven, $0). **Only `20-11` remains open** — `autonomous: false`, tasks 1-3 landed at `1db8a03`, resume point is the owner-approved **paid** Run-A live render gate. `20-VALIDATION.md` `in_progress`. | The audit's #1 blocker chain has half-collapsed: 20-12 no longer blocks anything. What is left in Phase 20 is **one owner action that spends money**, plus final phase verification. | **BLOCKED — 20-11 (paid owner gate) + phase verification.** |
| Phase 20.1 — Drive in the Cockpit | **MOVED.** `20.1-02` code landed (`9bdde53`, `629ed69`, `1320cc3`). Prod gate `df00ab21` 39/39, $0.4445, owner activated `cockpit-agent` v6 on production. **No `20.1-02-SUMMARY.md`.** VALT-15 Pending. | Half-certified by the plan's own record: *"the local half is NOT certified"* — the local v25 gate died at 38/39 on backend Server Errors and the local backend then would not restart (539 MB free of 8 GB). v25 is parked and unevidenced. | **BLOCKED — 20.1-02 is unclosed with a disclosed one-sided certification. See the prod-divergence finding below.** |
| Phase 20.2 — Scene Timeline Reels | **MOVED, substantially.** `20.2-PLAN.md` still `status: proposed`, still ONE document, still no per-plan SUMMARYs. **Waves 1–8 are all recorded COMPLETE**; wave 8's code shipped `media-director` v2, `reserveSceneJobInner`, and deleted `scene_render_not_ready`. ADR-019 recorded. | The phase found its own row's premise wrong: **`media-director` is deliberately ungated**, so wave 8's budgeted paid eval gate does not exist and the body publishes straight to `active`. Two items remain, both owner-side: **(1) SEED THE BODY** — the live row is still v1 and the specialist still proposes block decks; **(2)** 20-12 was *not* folded in and closed separately, which is now correct and done. | **BLOCKED — owner seed + readback, and the auditability exemption below.** |
| Phase 21 — User-Authored Skills & Routines | 21-01…21-05 closed; **21-06 and 21-07 still have no SUMMARY**; `21-VALIDATION.md` `draft`; SKILL-01 Pending. **Zero movement** since the last audit — the intervening `21-0x` commits are the `docs/superpowers/` lane (method note 2). | Unchanged. 21-06 is the authenticated browser-evidence + live-handoff plan; 21-07 is the owner live result. | **BLOCKED — 21-06, then 21-07 (owner live result).** |
| Phase 22 — Owner Authorization Primitive | `22-VERIFICATION.md` `human_needed` 4/5; GOVN-01 Pending. | Unchanged. Closure is scheduled inside `25-02`. | **BLOCKED, but NOT independently — 25-02 owns it.** |
| Phase 22.1 — Beta Admission Readiness | `22.1-03` no SUMMARY; GOVN-03 Pending. CI (`ci.yml`, `deploy-production.yml`, `skillopt.yml`) exists and runs typecheck/lint/test/build. `pnpm gate` was added (`bc9c4f1`). | **Newly measurable, and it fails.** 22.1-03's must-have truth is *"a quiescent current tree passes pnpm typecheck, pnpm lint, pnpm test and pnpm build."* Measured this pass: **typecheck 10/10 GREEN; `pnpm lint` RED** — biome aborts on *"nested root configuration"* from stray `biome.json` files in `.tmp/media-release`, `.tmp/media-release-origin` and four `.worktrees/` checkouts. CI is unaffected (clean checkout); the **local** gate is unrunnable until those worktrees are pruned. | **BLOCKED — prune the stray worktrees first, then run the gate. And see the GOVN-03 orphan below.** |
| Phase 23 — Agent-Authored Skills | 9 plans, **zero SUMMARYs**; `23-VALIDATION.md` `ready`; SKILL-02 Pending. | Unchanged. Largest single unexecuted block inside the milestone. | **BLOCKED — 9 plans.** |
| Phase 24 — ISO 9001 Conformance Map | `24-01` closed; `24-02` (`autonomous: false`, GOVN-02) no SUMMARY; VALIDATION `draft`. | Unchanged. | **BLOCKED — 24-02.** |
| Phase 25 — itself | **14 plans (`25-00`…`25-13`), zero SUMMARYs.** `25-VALIDATION.md` `planned`. BETA-01/02/03/05 and DLVR-02 all Pending. | Entirely unexecuted, as designed — but `25-06` is now **stale**, see below. | **BLOCKED — the whole phase, and 25-06 must be re-cut before it runs.** |
| Phase 26 — Connected Product Pages / Command Center | 20 plans; `26-10`…`26-17`, `26-19`, `26-20` have no SUMMARY. `26-VALIDATION.md` `draft`. All Phase 26 requirements Pending. | Unchanged — 10 unexecuted plans. | **BLOCKED — 10 plans.** |
| Phase 31 — Marketing Surface & Funnel v0 | 8 plans, zero SUMMARYs. MKTG-01…03 Pending. | Unchanged. | **BLOCKED — 8 plans.** |

## Findings this pass, that no prior pass had a row for

### 1. The Microsoft OAuth collision was RESOLVED, and it made `25-06` stale

The 2026-08-14 audit recorded a live collision between `17-06` and `25-06` and said it *"must be
decided before 17-06 is executed."* **It was decided, correctly, and then 17-06 executed.**
`ADR-018: One Microsoft connection, not two` was accepted 2026-08-14 while both plans were still
unexecuted, and the code follows it:

- `packages/backend/convex/microsoftAuth.ts` — ONE token store, `MICROSOFT_SCOPES` covering both
  halves, with `microsoftCalendarReady()` / `microsoftMailReady()` deriving per-half readiness from
  the granted scope string.
- `packages/backend/convex/http.ts` — a single `/microsoft/callback`, carrying the explicit comment
  *"must NOT add a second callback here."*
- `apps/web/app/(app)/connect-microsoft/` — one consent surface.

**Consequence for Phase 25:** `25-06` was written to *create* the Microsoft mail grant. That grant
now exists. 25-06 must be re-cut as *"extend the existing single grant's scope set and prove
`mailReady` flips"* — not as new-module work. `25-05` and `25-07` (the `gmailTokens` migration and
provider-schema narrowing) must likewise be re-read against a schema that already carries a second
provider. **Executing 25-05…25-07 as written would unwind shipped, ADR-backed code.**

### 2. Production is LIVE with no admission gate — and BETA-01 is Phase 25's own requirement

`ADR-020` was recorded **today, 2026-08-15**, at the first real production deploy (run
`31854161028`, off `9eada53` / PR #17). `https://www.pikar-ai.com` serves the full platform with
**no invite module, no waitlist table, no domain lock, no password**. Any Google sign-in yields a
working tenant that can drive the cockpit agent against the owner's single production
`OPENAI_API_KEY`, with only global — not per-tenant — budget rails between an anonymous signup and
that key. The owner was shown this twice and chose to ship open; the ADR exists so the decision is
recorded rather than discovered from a bill.

**This is not a documentation gap — it is the milestone's live risk position.** BETA-01 is owned by
`25-01`/`25-02`, which are unexecuted. ADR-020 also pre-records where the gate belongs when it is
built: `requireScope` in `packages/backend/convex/lib/functions.ts`, **not** a tenant-creation hook,
because no tenant-creation event exists to guard.

### 3. Production Convex is AHEAD of `main`, deployed off a feature branch

`20.1-02`'s own record (`1320cc3`): *"prod Convex functions were deployed directly off this branch
so the gate could read the new observable, bypassing `deploy-production` — prod backend is ahead of
main until this branch merges."* Combined with ADR-020's separate production deploy off `9eada53`,
**there is no single commit that describes what production is running.** Phase 25's Task 2 requires
a stable baseline SHA; that SHA does not currently exist. `feature/cash-business-finance` is
**9 commits behind and 12 ahead** of `origin/main` (which already merged this branch once, PR #19).

### 4. GOVN-03 has orphaned scope with no plan in any phase — and 17-06 regressed its standard

GOVN-03 requires *"in-app disconnection of a connected account WITH revocation at the provider …
and tenant data deletion and export."* Two halves are unowned:

- **Tenant data deletion and export.** `22.1-03`'s own must-have truth states plainly: *"Closing this
  plan does not complete GOVN-03: tenant data deletion and export remain unimplemented requirement
  scope."* A repo-wide search for `deleteTenant|exportTenant|purgeTenant|dataExport` returns
  **nothing**. Phase 22.1 has three plans and none covers it. **No plan in any phase does.**
- **Microsoft provider-side revocation.** `gmailAuth.disconnectGoogle` revokes at Google then deletes
  the row — the standard 22.1-01 established. `microsoftAuth.disconnectMicrosoft` returns
  `revokedAtProvider: false` and is documented in-source as *"NOT PARITY WITH `disconnectGoogle`,
  AND MUST NOT BE DESCRIBED AS IF IT WERE."* The code is honest, but **17-06 shipped a new connected
  account that does not meet GOVN-03's own bar**, and Phase 22.1's plans predate it.

The privacy policy is the specification here (`apps/web/app/privacy/page.tsx`). **A published policy
promising controls that do not exist is the exact defect that minted GOVN-03 on 2026-08-01.**

### 5. The blocker ordering in the previous audit was inverted for Phase 18

Prior list: *"4. 18-10 → 18-09. 5. 17.1-10."* `18-10`'s must-have truth requires that **17.1-10's
live gate has already run** before any Phase-18 artifact exists to corrupt the drift number it
measures. Correct order: **17.1-10 → 18-10 → 18-09.**

## Explicit non-prerequisite

| Lane | Evidence | Decision |
| --- | --- | --- |
| Phase 32 — Channel connection, publishing and metrics | ADR-015 and ROADMAP identify tranche B as blocked on a legal entity that has not started. `9a74e59` defers the legal formation gate. | **EXCLUDED from Phase 25's critical path.** |
| Phase 33 — Media creation UX overhaul | Added to the ROADMAP `e2a93a8` on 2026-08-15, after Phase 25 was specified. Planning directory is untracked. | **EXCLUDED — post-dates the Phase 25 prerequisite set; must not silently widen it.** |

## Shared-worktree and baseline evidence — measured at `8062157`

| Signal | Measurement | Verdict |
| --- | --- | --- |
| `pnpm typecheck` | **10/10 tasks successful**, 2m31s | **GREEN.** Better than every prior audit — the two historical `cash.ts` errors are gone. |
| `pnpm lint` — before | **RED, aborted** — *"Found a nested root configuration"*; zero files checked | Caused by stray `biome.json` in `.tmp/media-release`, `.tmp/media-release-origin`, `.worktrees/favicon-production-clean`, `.worktrees/lane-c-voicedoc`, `.worktrees/live-finance-inputs`, `.worktrees/pipeline-activation-release-20260812`. |
| `pnpm lint` — after the fix | **RUNS**: 597 files in 8s. **RED on 84 errors, 268 warnings, 2 infos** | Fixed in this pass: `biome.json` `files.includes` gained `!.tmp` / `!.worktrees`, `.gitignore` gained `.tmp/`, and five stray worktrees were deregistered. **The 84 diagnostics are pre-existing and were MASKED by the abort** — real source (`dashboard/vault/*`, `PipelineView.tsx`, `ingestEstimate.test.ts`, two `package.json`), likely mostly formatter drift from concurrent in-flight edits. **`22.1-03`'s blocker MOVED, it did not clear:** the gate is now runnable and red on real diagnostics. The 2026-08-12 `ci-gate.md` entry already asserted the repo gate was red in unfinished feature work; that is now measured rather than inferred. |
| `pnpm test` / `pnpm build` | Not run this pass | Unqualified. |
| Tracked modifications | **13** — incl. `MediaCanvas.tsx`, `render/assembleScript.ts`, `assemble_final.sh`, `burn_caps.sh`, `vaultDrive.ts`, `core/src/render.ts`, `docs/playbooks/media.md` | Active in-flight media/vault edits. Not quiescent. |
| Untracked paths | **35** — incl. `.playwright-cli/`, `.tmp/`, `output/`, `.planning/phases/33-…/` | `.worktrees/` is gitignored; **`.tmp/` is NOT.** |
| Registered worktrees | **8**, incl. two under `.tmp/` and one outside the repo at `Desktop/pikar-ai-cash` on `main` | The "lanes share one tree" rule now coexists with real worktrees. **Never `git add -A` here.** |
| Concurrent-lane write | `8062157` landed **during this audit** (`fix(21-02)`, the superpowers lane) | Confirmed again: the tree moves under you mid-session. |
| Playbook §9 debt | **THREE playbooks now carry "NOT a verification" disclaimers instead of `Last verified` bumps**: `cockpit.md` and `vault.md` across three consecutive sessions (`f885a82`, the item-4 session, this audit), and `business-evaluation.md` added by a **fourth firing during this same session**. | Two distinct foreign lanes trigger it: `MediaCanvas.tsx` + `vaultDrive.ts` (Drive/media lane) and `evaluations.ts` + `evaluations.test.ts` (the scorecard-provenance lane). The §9 hook cannot be scoped to one lane's diff, so in a shared working tree every passing session must either assert a verification nobody performed or stack another disclaimer. **Both lanes owe their playbooks a real entry.** Four firings and three playbooks in one session is past annoyance — it is playbook debt that should close before Phase 25 freezes a baseline, and it is also evidence for the quiescence problem: **HEAD moved four times during this audit** (`8062157`, `12eb2a6`, `2d74b1a`, `40046b2`). |
| `.planning/STATE.md` ownership | Top frontmatter block is now `stopped_at: Phase 33 context gathered`, `last_updated: 2026-08-15T14:05:32Z` | **The 2026-08-14 phase-25 audit's STATE entry has been overwritten by the Phase 33 lane.** STATE.md is a stack of frontmatter blocks and the live block no longer describes the Phase 25 gate. **This audit deliberately did NOT write STATE.md** — reclaiming the top block would clobber an active lane. `25-PREREQUISITE-EVIDENCE.md` is therefore the only current record of the gate, and STATE must be reconciled by the owner, not by a lane. |
| Branch vs `origin/main` | **12 ahead, 9 behind** | No single commit describes production. |
| Local dev capacity | **MEASURED 2026-08-15: RAM 7.88 GB total, 0.36 GB free. Disk 27.16 GB free.** | **CORRECTION — an earlier version of this row treated the constraint as DISK. It is RAM.** The `1320cc3` figure ("539 MB free of 8 GB") and the Phase 19.1 STATE entry ("OOM at 0.43 GB free of 7.88 GB, exit 134") are both *memory*, not storage. Deleting 2.15 GB of stray worktrees moved free disk 27.10 → 27.16 GB and **cannot** help. **Local paid/live gates remain unrunnable — 20-11, 21-06 and 17.1-10 are blocked on MEMORY**, which pruning, tidying and config changes do not address. The known workarounds are per-package runs with `--maxWorkers=1` and `NODE_OPTIONS=--max-old-space-size=3072`; whether a local Convex backend can start at all under this ceiling is unproven. |

## Exact blockers before owner approval — ordered by real dependency

**Unexecuted plans inside 14→25: 23 prerequisite plans + Phase 25's own 14 = 37.**
Plus **18** in the two out-of-range lanes Phase 25 names as prerequisites (26: 10, 31: 8).

1. ~~**Make `pnpm lint` runnable.**~~ **DONE 2026-08-15.** `biome.json` now excludes `.tmp` and
   `.worktrees`, `.gitignore` covers `.tmp/`, and five stray worktrees are deregistered. Uncommitted
   work from all five was backed up first and verified redundant (`5c06b33` is an ancestor of HEAD,
   all three branches merged, the "new" untracked files already exist in the main tree).
   The leftover directories were also deleted (2.15 GB across ten trees; `_stale-patches` kept —
   it holds seven lane `.patch` snapshots and costs 20 MB).
   **This item is now CLOSED, and it did NOT unblock the live gates.** The blocker was mis-stated
   as disk; **it is RAM** — see the capacity row above. Free disk moved 27.10 → 27.16 GB.
   **20-11, 21-06 and 17.1-10 remain blocked on a 7.88 GB machine with 0.36 GB free**, and no
   amount of tree-pruning changes that. Treat "find a way to run the live gates under this memory
   ceiling" as its own unowned task.
2. ~~**Triage the lint errors.**~~ **DONE 2026-08-15 — and it changes what `22.1-03` can be asked
   to prove.** Zero errors are lint-rule violations; all are the **formatter**. **76 of 86 are a
   Windows CRLF artifact** (`* text=auto` + `core.autocrlf=true` gives a CRLF working tree; biome
   defaults to `lineEnding: lf`), so **`pnpm lint` and `pnpm gate` cannot be green on this machine
   at all** — the same commits pass on Linux CI. The remaining **10 are real** but are branch-only
   changes absent from `origin/main`, which is why CI is green (`31883067840`, success) while local
   is red; **CI will redden on them at merge**. Root `package.json` is LF with ONE CRLF line, so
   `file(1)` mis-sorts it — only byte-level tooling sees it. Full analysis in `docs/playbooks/ci-gate.md`.
   **DECISION NEEDED:** either normalise the working tree to LF (`core.autocrlf=false` /
   `core.eol=lf` + re-checkout — **NOT while lanes hold a dirty tree**, and note `.gitattributes`
   already pins `*.sh text eol=lf` for the same reason without generalising it), or **qualify
   `22.1-03` against CI rather than a local run** and amend its must-have truth, which as written
   demands something a Windows checkout cannot deliver. Not fixed in this pass: `package.json`
   gained `"gate:lint"` from a concurrent lane mid-session and `proposal.ts`/`storyboard.ts` are
   held by the 21-02 and 20.2 lanes. Note 22.1-03 still does **not** close GOVN-03.
3. **17-07 — CORRECTION 2026-08-15: this is NOT a bookkeeping gap and its SUMMARY MUST NOT BE
   WRITTEN YET.** An earlier line in this document implied 17-07 only lacked paperwork for code
   already in history. Reading the plan disproves that. Its `resume:` field states that Tasks 1
   (code half), 2 and 3 are complete and verified — backend 1759 passed, core 936/936, five
   mutations observed red then reverted — **but that Task 1's Graph concurrency probe HAS NOT RUN**,
   because it needs a real Azure app registration and a disposable Microsoft account, and the
   placeholder credentials used to prove the connect branch were deliberately removed afterwards.
   `17-GRAPH-CONCURRENCY-PROBE.json` **does not exist and the plan says in capitals that it must not
   be fabricated**; the plan's own `<verify>` hard-asserts `stalePatchStatus === 412` and
   `supported === true` from that artifact. Writing a SUMMARY would flip this document's own
   mechanical PLAN↔SUMMARY rule to "closed" for a plan with an unmet hard gate — **the ledger would
   start lying about the thing it exists to measure.** The probe also gates 17-08: the plan forbids
   starting it before `supported === true`, and forbids unconditional Graph PATCH/DELETE and
   GET-then-compare `changeKey` as fallbacks. **Real blocker: obtain an Azure registration + a
   disposable account, run the probe, write the artifact, THEN the SUMMARY.** After that,
   **17-08 → 17-09 → 17-10 → 17-11**; 17-08 is where `calendarEvents.ts` and the "manage" half of
   ACTN-02 finally get built.
4. **17.1-10** — diagnose the recorded failed L6 recovery first *(owner live gate)*.
5. **18-10 → 18-09** — strictly after step 4, per 18-10's own truth. Closes ACTN-04.
6. **20-11** — the paid owner render gate *(spends money)*, then Phase 20 verification.
7. **20.2 owner seed + readback** — the live `media-director` row is still v1. Then either land
   per-wave summaries or record an explicit exemption (item 12).
8. **Close `20.1-02`** — write the SUMMARY, and decide whether the disclosed one-sided (prod-only)
   certification is accepted or the local half must be re-gated. Closes VALT-15.
9. **21-06 → 21-07** *(21-07 owner live result)*. Closes SKILL-01.
10. **24-02**, then **Phase 23** (9 plans), then **Phase 31** (8 plans).
11. **Phase 26** — 10 plans: source pages, authenticated gates, Command Center.
12. **Owner live gates, queued and unscheduled:** 15.3 H1/H2/H3 (populated Drive folder + real Shared
    Drive), 17 H1/H2/H3 (real Google consent + live create), 20 fal.ai render gate *(spends money)*.
    Phase 22's `/ops` DOM residue is **not** on this list — 25-02 owns it.
13. **Decisions the owner must make before Phase 25 executes, not during it:**
    - ~~**Re-cut `25-05`/`25-06`/`25-07`**~~ **DONE 2026-08-15 at owner direction** (which also
      lifted this document's own "downstream plan reconciliation is prohibited" boundary for that
      task — recorded in each plan's `amended:` field rather than silently bypassed). What the
      re-cut found: **`25-07` was ~2/3 obsolete**, not merely stale. Its Tasks 1-2 (backfill, then
      narrow `gmailTokens.provider` to required) act on a column that will never exist — 17-05
      landed `microsoftCalendarTokens` as a SEPARATE tenant-keyed table and schema.ts records why a
      discriminator is the wrong shape. Those tasks are deleted; 25-07 is rebuilt around its
      surviving third, live continuity, which now matters MORE because 25-05 moves both production
      callers off `internal.gmail.send`. **`25-06`'s prose amendment was already correct but its
      machine-readable fields were never updated to match it** — `files_modified`, `artifacts` and
      `key_links` still named `http.ts`, `gmailAuth.ts`, `connect-gmail/page.tsx`,
      `ReconnectBanner.tsx` and a `by_tenant_provider` index that must not exist. An executor reads
      those fields, so the plan would have rebuilt 17-06's callback. Fixed. **`25-05` keeps its real
      work** (mailProvider, graph.ts, delivery.ts, both callers) and loses the widening/migration;
      `graph.ts` is now required to reuse `microsoftCalendar.freshGraphToken` rather than open a
      second refresh path over one row. **Two things surfaced that are NOT resolved:** 17-06 shipped
      `/connect-microsoft` as its own page beside `/connect-gmail`, so the phase now has two
      connection surfaces where one was assumed — a UX decision needing its own plan; and
      `disconnectMicrosoft` returns `revokedAtProvider:false`, so **GOVN-03's provider-revocation
      clause stays open and 25-06 is now explicit that it does not close it.**
      **FOLLOW-UP THE SAME DAY — re-cutting the plans was NOT sufficient, and nearly failed.** A
      sweep found the superseded design still prescribed in **six other documents**, two of which
      (`25-RESEARCH.md`, `25-CONTEXT.md`) are loaded in the `<context>` block of all three re-cut
      plans. An executor opening 25-05 would have read its "DO NOT TOUCH `gmailTokens`" instruction
      and then, in the same context window, research telling it to add the `provider` column, the
      `by_tenant_provider` index and a tracked backfill — including a ⚠️ note arguing the migration
      is mandatory. **A plan cannot out-vote its own attached research.** Superseding banners are
      now in `25-RESEARCH.md` and `25-CONTEXT.md`, the stale `ROADMAP.md` SC#5 widening clause is
      corrected (its `schema.ts:625-632` citation was also stale — `gmailTokens` now sits near
      1146), and `design/growth-surfaces-canvas-funnels-connections.md` is marked superseded for the
      mail grants with a warning not to cite them as precedent if the same idiom is later applied to
      Phase 32 channel connections. **General lesson for this ledger: when a decision reverses,
      grep for the OLD design across `.planning/` and `docs/`, not just for the plan that owns it —
      the instruction usually lives in more places than the decision does.**
    - ~~**Assign GOVN-03's orphaned scope**~~ **DONE 2026-08-15 — two plans minted in Phase 22.1,
      which owns GOVN-03.** `22.1-04` takes EXPORT (Art. 15 access + Art. 20 portability);
      `22.1-05` takes DELETION (Art. 17), kept separate because it is irreversible and needs its own
      owner gate. Both are built on a **table-classification registry** covering all 43 schema tables
      (37 carry `tenantId`), with a drift test that fails when `schema.ts` gains an unclassified
      table — without it, export and deletion silently rot to a stale subset as the schema grows.
      **The sharpest constraint found while writing them:** a tenant-deletion feature is the single
      most likely thing in this codebase to breach CLAUDE.md §3 (insert-only audit) by accident,
      because "delete everything belonging to this tenant" is the obvious implementation and it is
      wrong here. The privacy policy already resolves it — §9 rests the coexistence of an immutable
      log with the right to erasure entirely on the audit log holding "references, identifiers,
      hashes, and counts only ... there is nothing in the archive to erase" — so 22.1-05 implements
      the policy's own resolution and makes audit **unreachable by construction** (the registry
      exposes a `deletableTables()` accessor and the deletion module has no other way to name a
      table) rather than skippable by an `if`. **STILL OPEN AFTER BOTH PLANS, and explicitly not
      claimed by either:** GOVN-03's Microsoft provider-side revocation clause. `disconnectMicrosoft`
      returns `revokedAtProvider:false` by design; `25-06` Task 2 owns the owner posture decision.
      Deletion must therefore REPORT per-provider what revocation actually achieved rather than
      averaging Google and Microsoft into one boolean.
    - **Decide BETA-01's timing against ADR-020.** Production is open right now. Either 25-01/25-02
      move to the front of the phase, or the open door is re-affirmed with a per-tenant spend cap.
    - **Exempt or document Phase 20.2** — its single-document form means plan-level completion cannot
      be audited by this document's own rule, and MEDIA-01 would otherwise close on unauditable evidence.
    - **Record Phase 15.2's verification** or accept it as an unverified dependency of 15.3/15.4/20.1.
14. **Only then:** reach a quiescent worktree, merge to `main`, redeploy production from `main` so one
    SHA describes it, and re-inventory the merged finance, media-provider, scene-contract, 17.1,
    schema, skill, CI/deploy and delivery baselines before Task 2 can claim a stable SHA.

**Approval state: not eligible for review. Do not type `approved`.**

---
*Original audit 2026-08-10 at `aa5445b`. Re-audited 2026-08-14 at `d274281`. Re-audited 2026-08-15 at
`8062157` — 4 rows cleared or advanced (17-06 closed, 20-12 closed, 20.2 waves 1-8 complete, 20.1-02
code landed), 3 rows added that were never in the table (15, 15.1, 15.2), 2 rows worsened by
measurement (22.1 local lint red, 20.1 one-sided certification), and 5 cross-phase findings recorded
that no PLAN↔SUMMARY scan could produce.*

---

# TASK 2 — THE BASELINE FREEZE, AND ITS VERDICT

> Run 2026-08-16. Inventory measured by 6 parallel readers; Plans 01–13 drift-checked by 5 more
> against that inventory. 11 agents, 0 errors. Baseline SHA at measurement: **`a584793`**.

## Verdict: `replanning required` — MATERIAL DRIFT IN 9 OF 13 PLANS

Task 2's own rule is that material drift stops the lane and returns to planning-only revision.
**It does.** Every finding below is a measured contradiction between a plan and the code, not a
stale line number (line numbers are advisory in this repo and were excluded by construction).

| Plan | Verdict | The finding that matters most |
| --- | --- | --- |
| 25-01 | material → **RESOLVED, executed at `a584793`** | Two allowlists, not one; adding a table is a 4-file change. Both handled. |
| 25-02 | material | `/ops` is 806 lines / 11 APIs, not "three controls"; Playwright has ONE identity; the `(app)` onboarding gate makes the non-owner proof vacuous. |
| 25-03 | material | Would build a SECOND table classification beside Phase 22.1's; would convert a token-authenticated internalQuery to `ownerQuery` and break CI. |
| 25-04 | immaterial | `persona` is not an input at any layer; the committed onboarding.md disclaimer is factually wrong. |
| 25-05 | material | `internal.microsoftCalendar.freshGraphToken` does not exist; 3 row-writers, not 1; the `awaiting_reauth` hold surface is hardcoded Google. |
| 25-06 | material | Its own `key_link` names a file that cannot write the field; forbids the ReconnectBanner fix that its own truth 5 requires. |
| 25-07 | material | Live-continuity gate; inherits the 25-05 surface corrections. |
| 25-08 | material | Outlook threading; inherits the same. |
| 25-09 | material | Read-plane parity; inherits the same. |
| 25-10 | material | **ADR number 017 is already taken.** Branch A/B is counterfactual — the decision already shipped. |
| 25-11 | material | The release pipeline has NO manual trigger and NO SHA input. |
| 25-12 | material | Its one verification command cannot pass, for three independent reasons. |
| 25-13 | material | "all three owner APIs" is 14. |

## The five findings that change the phase, not just a plan

**1. Production is already live with no admission gate, and the A/B decision 25-10 poses was made
and shipped.** `docs/decisions/020-production-opened-without-an-admission-gate.md` is **Accepted**
and records `https://www.pikar-ai.com` serving the full platform, promoted at deploy-production run
`31854161028` off `9eada53`. `deploy-production.yml` already validates `vars.PRODUCTION_URL` as an
absolute HTTPS URL and pins Convex `SITE_URL`/`MEDIA_RENDER_URL` to it with a read-back assertion.
**Branch B is not "decline to ship" — it is "take down a live promoted deployment."** 25-10 must
ratify or supersede ADR-020, not re-litigate it. This also makes BETA-01 the phase's most urgent
item rather than its first bureaucratic one: the door is open right now.

**2. There is no manual production deploy.** `deploy-production.yml`'s only trigger is
`workflow_run` on `ci` completing, filtered to `conclusion=='success' && event=='push' &&
head_branch=='main'`. No `workflow_dispatch`, no SHA input. **The deployable SHA is whatever head of
main last passed CI.** 25-11's "deploy the recorded clean SHA" describes a mechanism that does not
exist; a hand-run `convex deploy`/`vercel deploy` would bypass the staged-then-promote ordering, the
`_generated` drift check, the SITE_URL read-back, and the seed step. The real release is: merge →
CI green → the pipeline promotes → record the run id and `head_sha`.

**3. `CONVEX_SITE_URL` is not ours to set.** It is the Convex deployment's own origin, read with no
fallback at `auth.config.ts:5` and with `?? ""` at `contacts.ts:679` (where the unsubscribe link
fails CLOSED when empty). The pipeline deliberately never touches it. 25-10's must_have demanding
durable **custom** origins would therefore force Branch B over a non-problem — the default
`*.convex.site` origin is durable, just not custom.

**4. A red lint silently means production is never redeployed.** Because `deploy-production` is
`workflow_run`-gated on `ci`, any lint failure on main stops the release with no deploy-side signal.
This is what makes the two-allowlist divergence (found and fixed in 25-01) a release hazard rather
than a formatting nit. Recorded in `docs/playbooks/ci-gate.md`.

**5. "All three owner-gated functions" is 14.** Measured: `finance.ts` ×5 (including the global
spend kill switch and the master kill switch), `optimizerConfig.ts` ×2, `skills.ts` ×5, plus
`invites.ts` ×2 from 25-01. `importGuard.test.ts` pins only 7 of them; **all five finance owner
endpoints are pinned by nothing**, so a silent downgrade to `tenantMutation` there would break no
test. 25-03 and 25-13 both carry the stale "three" from `25-CONTEXT.md` and `25-VALIDATION.md`. The
fix is to derive the list from the source scan rather than enumerate it.

## Baseline inventory — measured, not asserted

- **Schema: 45 explicit tables** (43 at the audit point + `betaWaitlist`/`betaInvites` from 25-01),
  **108 index descriptors**, zero search/vector indexes. 6 tables carry no `tenantId`
  (`users`, `skills`, `pendingTimeouts`, `exportCursors`, `guardrailConfig`, `optimizerConfig`);
  the other 37 declare it first. `Object.keys(schema.tables)` at RUNTIME additionally contains the
  six `...authTables` names, which Phase 22.1's regex parse of the source cannot see — that gap is
  the one genuinely new thing 25-03 has to add.
- **`gmailTokens` has no `provider` column and must not gain one** (schema.ts records why: a
  discriminator makes every existing `by_tenant` `.unique()` read ambiguous).
  `microsoftCalendarTokens` exists as a separate tenant-keyed table with `accessToken`/`expiresAt`
  **required**, unlike gmailTokens where both are optional. The 25-05/06/07 re-cut holds.
- **Public function surface: 179 exports.** 74 `tenantQuery`, 69 `tenantMutation`, 19
  `tenantAction`, 6 `ownerQuery`, 8 `ownerMutation` — plus, for the first time, **3 raw public
  builders** (`invites.requestAccess`, `invites.preflight`, and one action). Any surface scan that
  enumerates only the five wrapper names is now structurally blind to the only unauthenticated,
  internet-reachable endpoints the beta has.
- **8 `http.route` blocks bypass the wrapper plane entirely**, each with bespoke auth. No plan
  counts them as public surface.
- **`internal.gmail.send` has exactly 2 non-test production callers**: `deliverApprovedPlan.ts:37`
  and `pipeline.ts:379`. The count in 25-05 is right. But `send` is an `internalAction`, so the
  "zero remaining callers" artifact is unreachable — one `ctx.runAction` call site must always
  remain, inside the new dispatcher.
- **`freshGraphToken` is a plain exported module function**, `(ctx, tenantId, nowMs)`, called
  directly at three sites — NOT an internalAction. Note the third argument; `gmail.ts`'s
  `freshAccessToken(ctx, tenantId)` has no such parameter.
- **`graph.ts`, `mailProvider.ts`, `delivery.ts` do not exist anywhere.** Confirmed.

## Gate commands at the baseline SHA

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **10/10 tasks, exit 0** (3 turbo-cached). |
| `pnpm turbo run test --concurrency=1` | **9/9 tasks, exit 0.** backend 83 files / 1901 passed / 24 skipped; web 24 files / 399 passed. |
| `node scripts/check-playbooks.mjs` | exit 0, no block. |
| `git status` (excl. `graphify-out/`) | Clean of foreign edits. |

**Known-flaky, recorded rather than hidden:** `convex/intake.test.ts`'s §4 honeypot test burns
~11.8s of a 20s budget and intermittently times out; when it does, the rest of the file cascades.
Observed failing (4, then 6 in isolation) and then passing 10/10 unchanged, twice. It is a timeout,
not a regression — but it means a red `intake.test.ts` must be re-run before it is believed.

## Foreign-lane state — the fifth and sixth instances

HEAD moved under this session **twice more**: `2f12d0d` (phase-33 biome formatting) at 21:33, and
`c1877ce` (a concurrent lane pre-registering `invites.ts` under `authorization.md`) later. Two
orphaned foreign files — `e2e/skill-authoring.spec.ts` and `docs/playbooks/onboarding.md`, the
latter a Phase-25-owned path — were **committed under their own lane** at `e4e402c` rather than
stashed, reset or absorbed, which is what the Task 2 rule requires and what reaching a quiescent
tree demanded. **Re-measure `git status` immediately before every remaining plan.**

**A correction that follows from this:** the `onboarding.md` disclaimer preserved in `e4e402c` is
**factually wrong** — it states `writeProfileDoc` and `currentProfileDoc` are both exported.
Measured: only `currentProfileDoc` is (`onboarding.ts:560`); `writeProfileDoc` is a private
function whose own comment says "NOT exported", and the single legal write door is
`validateAndWriteProfile`. It was committed verbatim because preserving foreign work intact is the
rule; **25-04 owns `onboarding.md` and must correct it.**

## Disposition — how the lane proceeds

The drift is real and the plans are not executable verbatim. Rather than a full `$gsd-plan-phase 25`
round trip, each affected plan is **amended in place with the measured correction and its evidence**
(the same remedy, recorded per plan in its `amended:` field so the change is never silent), and then
executed. Every finding above carries a specific fix; none required a design decision that the
measurement did not already settle.

**Plans 07, 08, 11, 12 and 13 remain BLOCKING OWNER CHECKPOINTS and are not executed** — they need
real provider consent, a live browser, and a production release. 25-11 in particular is a
merge-to-main, which auto-promotes to a live `pikar-ai.com` serving real users; that is re-asked
every time, not inherited from this session.
