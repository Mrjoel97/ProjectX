# Plan 47-16 — disabled recurrence candidate technical review

**Reviewed:** 2026-09-25. **Root verdict:** accept only the bounded, synthetic, non-deployed candidate for design evidence. This is not a D1–D8 pass, `enable-safe`, ROUT-02 closure, tenant activation, release or Wave 6 closure.

## Exact inventory and source boundary

The six and only six candidate files are `packages/backend/candidate/recurrence/{schema.ts,model.ts,model.test.ts,tsconfig.json,vitest.config.mts,README.md}`. They are outside `convex.json`'s `packages/backend/convex` functions root, outside the backend default TypeScript include (`convex/**/*.ts` and root `vitest.config.mts`), and outside the default Vitest test include (`convex/**/*.test.ts`). An explicit candidate typecheck and edge-runtime runner are required. The model imports only the separate candidate schema, Convex types, and the pure core `routineSchedule.ts` helper; no product module imports the candidate. A source scan over production Convex, web and core found no candidate import; only deliberate negative fixtures in `routineDecision.test.ts` mention that path. No new cron, scheduler registration, public/internal Convex function, app route, feature flag, provider SDK, environment key read, network call, deployment or migration was added by this plan. The playbook watch now includes the candidate prefix.

The separate schema has four test-only tables. The model uses `convex-test` transactions for create/approve/change/pause, due claim, attempt and terminal state. Tests use synthetic tenant identifiers and a glob of the existing generated Convex module stubs; no candidate module is published. The synthetic run stops at a proposed-plan reference. Audit/dead-letter rows contain refs and closed outcomes, not prompts, recipients or hostile text. A mocked global fetch was asserted unused in the prepared path. These are source and in-memory observations, not proof of a deployed call graph or real provider behavior.

| Candidate file | SHA-256 |
|---|---|
| `schema.ts` | `80276b9742cc115c44fe0fc0ff0588aca430d22dfdcc81c45d74216430053a60` |
| `model.ts` | `3317bf07665fab773a9410b7df190d740206614a774137ff56866d5e62464100` |
| `model.test.ts` | `272cd6b00328013c3ecda0d72a7f72ad11a009e12370e751905998cfda6596f2` |
| `tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` |
| `vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |
| `README.md` | `3bf3fdead2ee0a7e745e7fe702d33880a415028ff0fbcb58e916f15a8ad61770` |

The post-review stage artifact has SHA-256 `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34`; its **frontmatter prohibition fields and expiry are unchanged**. Its body now truthfully says that the six files exist but remain disabled. The candidate files were absent at the Task 1 baseline, and the stage, playbook and watch baseline hashes are in the worker handoff. No unrelated dirty file was reset or committed.

## Independent verification

| Check | Result |
|---|---|
| Explicit candidate Vitest, edge runtime, one worker | `9/9`, exit `0`; real `convex-test t.run` transactions |
| Candidate TypeScript project | exit `0` |
| Backend TypeScript | exit `0` after fixing four new strict test typings in `routineDecision.test.ts` |
| `routineDecision`, `routines`, `dstProbe`, `schema` suites | `146/146`, exit `0` |
| Historical `--matrix`, `--eligibility`, `--validate-decision`; stage `--validate-stage` | `0/1/0/0`; eligibility's refusal is expected and required |
| Strict planning, playbook, claim capability and diff checks | all exit `0` |
| Registered repository free-gate sweep | `30/30` green, exit `0`; registry matches tree |
| Source import and candidate primitive scan | no production/app/core import; stage validator exit `0` with all six files present |

The tests cover structured material-change invalidation including recipient element boundaries, one occurrence claim across the repeated wall hour, stale/overlap skips, pause and version reread, bounded retries, terminal classes, fixed 25-cent reservation before mock preparation, independent daily/deployment stub-cap refusals, idempotent stub release, refs-only audit/dead-letter, cross-tenant refusal and zero mocked fetch. This is bounded automated design evidence. The separate full decision suite initially had worker RPC timeouts after passing assertions under host load; a later threaded one-worker run exited `0`, and the current four-suite run also exited `0`.

## Open evidence and tooling limitations

- ADR-046 D6 requires cancellation of a pending scheduled function as well as pause/version reread. This sweep-only candidate has no per-routine pending function to cancel. D6 remains **unpassed**, pending a separately accepted semantic resolution or a different implementation.
- `SyntheticRails` deliberately contracts that a false/thrown reserve made no reservation and release is idempotent by run ID. Tests exercise a stub, not the actual rate-limiter component or a provider boundary. Real reserve/refund and deployed atomic-claim behavior remain unproved; no daily/deployment cap or spend claim is made for the app.
- D1's candidate stops at a synthetic proposed-plan ref; actual product approval interface integration and no-send reachability remain to be proven before enable-safe. The DST, OAuth reconnect and unattended provider-read live rows remain open; the four DST probe jobs were not changed or re-armed.
- Graphify is **not current**. A safe `graphify update . --no-cluster` attempt extracted all 3,145 files, then its post-extraction process climbed above 3 GB and was stopped before the prior out-of-memory pattern. Four already-dirty generated graph files were backed up and hash-compared unchanged. The Convex-edge fixup was not run on that stale graph. No unrelated process was killed. This is a tooling debt, not a candidate-isolation pass.
- GSD atomic commits and completion summaries are pending in the shared dirty worktree; a file-count helper must not treat this review as Phase 47 closure. No production or tenant activation is authorized by this verdict.

If a future isolation, spend, approval or audit review fails, Plan 47-16's fail-closed protocol changes the separate stage to `status: deferred`, clears `candidateFiles`, and verifies stage refusal while preserving historical decision 29 and ADR-050. This review found no such failure; it leaves the accepted, disabled stage in place and all release gates closed.

## Current-file recheck — 2026-09-25

The hash table above is the **original 47-16 checkpoint**. Plans 47-20/21 later strengthened the disabled candidate; it is not a current-file manifest. The current SHA-256 values are `schema.ts` `51a3e31bc583f706b9f7b2207858cc0778dd2e8255fa85a40a2ea2d5c544b8f9`, `model.ts` `4b4c710b22c7271f29052b9e8a2743b3cf729bd2ee5d1f2ba16d799cd2a8006e`, `model.test.ts` `b8eddb3d2af89fe3dba390da93009cee148089bda43a3bed19909275d1112ef8`, `tsconfig.json` `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087`, `vitest.config.mts` `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8`, and `README.md` `d5d049220a3f96bb2ce21c0731105a4e2fd9f91f5bb67902e6e36b7507e33df2`. Stage decision SHA-256 remains `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34`.

On this current state, the explicit candidate suite passed **25/25** and the gate self-check passed **32/32**. Matrix/eligibility/historical-defer/stage exits remained **0/1/0/0**, with 14 eligibility findings. Strict planning, playbook and diff checks exited 0. A later guarded full Graphify refresh and Convex-edge fixup both exited 0, and all six candidate entries matched the refreshed manifest. These supersede only the historical graph-pending and old test-count observations above. The original technical boundary and the live/integration gaps remain unchanged; no GSD completion summary or atomic commit is claimed.

## Current-source reconciliation — 2026-09-28

**Verdict:** Plan 47-16's isolated synthetic build and review criteria hold on the current six files. This is a present-byte checkpoint, not a renewal of the original 9/9 review or a production, D6, D8, `enable-safe`, ROUT-02 or Wave 6 verdict. The 47-23/24/25 reviews describe later candidate changes; 47-25's six-file identity matches this checkpoint. The 2026-09-25 hash table and test counts above remain historical.

| Current file under `packages/backend/candidate/recurrence/` | SHA-256 |
| --- | --- |
| `schema.ts` | `628d3d67dcdefeedd32587341ef715413a537428f6fb6ec9e1c258f61504d909` |
| `model.ts` | `164a0d6513da8ab84932fc44b9b48a1b195b27078a84334d204cb94920424f61` |
| `model.test.ts` | `09711bcd07f68defb83e4bad7d6e4bee46515a30764ed84d3cdeb135f330fb5a` |
| `tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` |
| `vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |
| `README.md` | `818680bd21bff2ff94933a68518ae4567c8fbcda2cffedf40bff87636841410f` |

The other four Plan 16 inventory hashes before this review update were: stage decision `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34`, this review `55888edd67632a55175d17f9afb88c2fac276affa65ff0d4d047c47b96636775`, playbook `a6f38b9cb01242d4b1706e670b89a3d6a35c91a04c69345f0b3e4e0f898b7f16`, and watch map `093a27eb140946d2e76ff813dfd3b9197d17489f390c15579bad15dfd5ad410f`. All ten were clean in Git before this documentation edit; four pre-existing dirty `graphify-out` files were left untouched. The stage remains accepted with exactly six paths, expiry 2026-12-31 and every tenant, deployment, provider, paid and outbound prohibition intact.

Direct reachability review confirms `convex.json` points at `packages/backend/convex`, backend TypeScript includes `convex/**/*.ts`, and default Vitest includes `convex/**/*.test.ts`. Only the explicit candidate project and runner include the candidate. `model.ts` imports Convex types, its test-only schema and the pure core schedule helper; its pure core import is one-way. The candidate test additionally imports the existing limiter configuration for a local component transaction probe. Search over production Convex, web and core found no candidate import; `routineDecision.test.ts` contains only deliberate negative fixtures. The model registers no Convex function, cron or scheduler and contains no network/provider/paid/outbound call. The manually invoked due and recovery sweeps have no runtime caller. The playbook watch includes the candidate prefix. This source and test review supports isolation in this tree, not a deployed call-graph proof.

| Current check | Result |
| --- | --- |
| Explicit candidate edge-runtime Vitest | 49/49, exit 0; `convex-test` transactions, including three installed limiter component transaction probes |
| Existing `routineDecision`, `routines`, `dstProbe`, `schema` suites | 149/149, exit 0 |
| Candidate and backend TypeScript projects | exit 0 each |
| Historical `--matrix`, `--eligibility`, `--validate-decision`; stage `--validate-stage` | **0/1/0/0**; eligibility refuses 14 findings |
| Gate `--self-check` and source-review `--self-test` | 32/32 and identity cases pass, exit 0 each |
| Strict planning, playbook, claim-capability, `git diff --check` | exit 0 each; diff check emitted only line-ending warnings for pre-existing graph files |

The present suite exercises material recipient boundaries, fall-back occurrence identity, missed/overlap skips, bounded sweeps, pause/version races, retries and unknown paid outcomes, fixed 25-cent synthetic reservations, refs-only audit/dead-letter, per-run synthetic approval and an unused mocked `fetch`. The installed limiter probe establishes only same-transaction admission/replay/rollback in `convex-test`; the candidate reducer still uses injected keyed rails. There is no real per-run release/lookup/tombstone adapter, cross-window compensation, provider-result authentication, production approval/action admission, deployed sweep or live DST/OAuth/provider trace. ADR-051/052 conditionally change D6's evidence wording but do not supply its required implemented proof. The historical operational decision remains `defer`, eligibility still refuses, and the fail-closed stage revocation protocol is not triggered by this review.
