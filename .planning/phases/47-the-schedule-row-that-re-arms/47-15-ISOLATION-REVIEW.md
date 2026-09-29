# Plan 47-15 — pre-build isolation and harness review

**Prepared:** 2026-09-24. **Root technical-review verdict (2026-09-25): ACCEPT** the exact pre-build six-path inventory and isolated harness feasibility at reviewed SHA-256 `40731f6c605ed30b633b685542a9a3056aab47c56011bf9258efc1f468004ad1`. This is not an `enable-safe`, D1–D8, live, or production verdict.

## Captured pre-edit state

The worktree was already dirty. These are the exact owned-file bytes before Plan 47-15 edits; they must not be replaced by a clean-HEAD reset. The stage and validation files are untracked, and the checker/test files are modified relative to HEAD.

| File | Pre-edit status | SHA-256 |
|---|---|---|
| `47-14-STAGE-DECISION.md` | untracked | `1e8fda827dcf552fda3dd5b1ee4f8149bf2ad596a761cc78abc1e9448de5c02a` |
| `47-VALIDATION.md` | untracked | `44508fe57590b9d03d8416d60dacfccc9e73b8628f9ccbb6da02d406ee852ddf6` |
| `packages/backend/scripts/check-routine-gate.mjs` | modified | `1f86a2437b584bb6b017f41355a29176b1f77fe778efd5f3c8a2542eb321f301` |
| `packages/backend/convex/routineDecision.test.ts` | modified | `59d5a11acc012768d72de28df6f6bbcbfe9ff61c708466e6176d4f092e75703b` |

## Exact proposed inventory

Only these six paths may become candidate files under a reviewed stage amendment:

1. `packages/backend/candidate/recurrence/schema.ts`
2. `packages/backend/candidate/recurrence/model.ts`
3. `packages/backend/candidate/recurrence/model.test.ts`
4. `packages/backend/candidate/recurrence/tsconfig.json`
5. `packages/backend/candidate/recurrence/vitest.config.mts`
6. `packages/backend/candidate/recurrence/README.md`

The `candidate/recurrence` directory did not exist at review. `convex.json` sets `functions` to `packages/backend/convex`; the backend `tsconfig.json` includes `convex/**/*.ts` and `vitest.config.mts`, not `candidate/**`; the default backend Vitest config includes `convex/**/*.test.ts`, not candidate tests. The isolated candidate therefore needs its **own** explicit typecheck and edge-runtime Vitest config. It may import the pure `packages/core/src/routineSchedule.ts` logic, but no production/app/Convex module may import candidate code. A `rg` scan over TypeScript/JavaScript source in `packages`, `apps` and `scripts` for `candidate/recurrence` and `candidate.recurrence` returned exit 1 (no matches). This is a current-tree boundary observation, not a future reachability proof.

## Disposable harness feasibility probe

Three temporary files under `packages/backend/__fixtures__/recurrence-feasibility/` defined a separate `defineSchema({ probeRows: ... })`, an edge-runtime Vitest config whose `include` selected one test, and a test using `convexTest` and two `t.run` transactions to insert/read a synthetic marker. No Convex function was registered or published and no key, provider, network, paid call or tenant data was used. From `packages/backend`:

`node node_modules/vitest/vitest.mjs run --config __fixtures__/recurrence-feasibility/vitest.config.mts __fixtures__/recurrence-feasibility/harness.test.ts`

First run exited **1** because `convexTest(schema, {})` cannot find `_generated`. The installed `convex-test@0.0.54` requires a modules glob containing the existing generated directory even when only `t.run` is used. The probe was corrected to `convexTest(schema, import.meta.glob("../../convex/_generated/**/*.*s"))` (from the same two-level-deep layout planned for the candidate). The second run exited **0**: one file, one test passed; the synthetic row was read back. All three temporary files were deleted with a checked `probe_file_exists=False`; no candidate file was created. Plan 47-16 must carry this explicit glob in the candidate test; a config-only include is insufficient.

This proves only that the installed in-memory harness can exercise a separate schema and that an explicit edge-runtime config can discover a non-`convex/` test. It does **not** prove deployed Convex transaction behavior, real rate-limiter refund, external isolation, or D1–D8 implementation.

## Current governance baseline and gaps

On the unchanged historical decision and empty-inventory stage, independent CLI exits were `--matrix` **0**, `--eligibility` **1** (14 findings), `--validate-decision` **0** (`defer`), and `--validate-stage` **0**. The accepted ADR-050 SHA-256 is pinned by the checker. The stage expiry remains `2026-12-31`, and tenant activation, production deployment, provider calls, paid calls, external writes and external sends remain disabled/forbidden.

ADR-046 D6 requires pause state **and cancellation of a pending scheduled function**, followed by callback status/version reread. A sweep-only candidate has no per-routine pending scheduled function to cancel; a reread alone cannot pass D6. Record this as a substantive gap for later governance review, not a passing row. The three real DST/OAuth/provider-read traces remain separate live requirements; a synthetic candidate cannot substitute for them. This stage transition, if signed and implemented, permits only creation and testing of these six isolated files. It cannot activate any tenant or change operational `defer`.

## Technical checkpoint

Root reviewer independently confirmed the six paths, the explicit modules-glob harness result, `convex.json` functions root, backend tsconfig exclusion, no source import matches, absent candidate, disposable probe cleanup, exact pre-edit hashes, independent `0/1/0/0` historical/stage exits, and the unresolved D6 cancellation gap. The acceptance permits only the scoped checker and six-path stage inventory work in Plan 47-15. It does not authorize candidate code outside the six paths, tenant/production activation, provider/paid calls, external writes or sends. A separate post-transition review is still required before Plan 47-15 can close.

## Post-transition technical review — 2026-09-25

**Root verdict: ACCEPT the narrow six-path checker/stage boundary; do not infer GSD plan closure or release readiness.** I inspected the current checker, adversarial tests, exact stage frontmatter/body, validation map and playbook. The checker still rejects changed ADR identity, widened activation/deployment/provider/paid/outbound fields, hidden candidate files, production-to-candidate imports and executable edges; its structural scan is not a semantic reachability proof. The candidate directory remains absent. The historical matrix, eligibility, defer validation and stage validation independently return `0/1/0/0`.

The checker self-check passed `32/32`; stage-specific Vitest passed `6/6`, exit `0`. Two full focused Vitest attempts passed `89/89` assertions but exited `1` from worker RPC timeouts under shared-host load. A separate full run using `--pool=threads --maxWorkers=1 --no-file-parallelism` passed `89/89`, process exit `0` (116.84 seconds). Strict planning, playbook and diff checks were green. ADR-046 D6 cancellation, real component integration and live DST/OAuth/provider evidence remain open; neither stage nor candidate is `enable-safe`.

Graphify refresh is the remaining tooling exception. `graphify update . --no-cluster` extracted `3145/3145` files, then its post-extraction process rose above 3 GB; it was stopped before the previously observed out-of-memory failure. The four already-dirty generated files (`.graphify_labels.json`, `GRAPH_REPORT.md`, `graph.json`, `manifest.json`) were backed up before the run and hash-compared afterward; all four remained byte-for-byte unchanged. The Convex-edge fixup was not run on a stale graph. No unrelated process was stopped. The graph is not claimed current, and atomic GSD commit/summary remains pending because the shared source files carried pre-existing uncommitted changes. This tooling debt does not expand the stage authority; Plan 47-16 must independently recheck the boundary before writing candidate code.

## Later tooling resolution — 2026-09-25

The paragraph above records the original checkpoint, not current graph state. A later guarded full Graphify refresh completed successfully, followed by the Convex-edge fixup. The stage checker self-check now passes 32/32 and the four independent decision exits remain 0/1/0/0. The exact six-file inventory is still the only accepted candidate scope; see the current-file addendum in `47-16-TECHNICAL-REVIEW.md`. Atomic GSD summary/commit bookkeeping remains pending in the shared dirty worktree, and this update grants no runtime or release authority.

## 2026-09-28 plan-record closure

The preceding bookkeeping sentence is historical. [47-15-SUMMARY.md](47-15-SUMMARY.md) now
records this plan's narrow completed inventory/harness/stage transition and the non-atomic shared
integration commit. Current gate self-check passes 32/32, `routineDecision.test.ts` passes 92/92,
and matrix/eligibility/defer/stage exits remain 0/1/0/0 with 14 eligibility findings. The current
candidate's later source changes still await independent review; Plan 47-16, D6, ROUT-02 and
Wave 6 are not closed by this plan-record update.
