# Testing Guide

## Frameworks and Configuration

- Vitest 3.2.7 is the primary TypeScript unit/integration runner for `packages/contracts`, `packages/core`, `packages/cost`, `packages/extraction`, `packages/pii`, `packages/vault`, and `packages/voice`.
- Pure-package configs such as `packages/core/vitest.config.ts` use the default Node environment and include `src/**/*.test.ts`.
- Backend tests use Vitest plus `convex-test` and `@edge-runtime/vm`; `packages/backend/vitest.config.mts` selects `environment: "edge-runtime"` and includes `convex/**/*.test.ts`.
- Backend timeouts are centralized at 20 seconds because booting in-memory Convex/component instances is expensive under full parallel load.
- Individual source-structure tests that need `node:fs` override the backend default with `// @vitest-environment node`, for example `packages/backend/convex/auditImmutability.test.ts`.
- Browser end-to-end tests use Playwright 1.61.1, configured in `apps/web/playwright.config.ts`.
- Playwright runs a `setup` authentication project followed by a Desktop Chrome `chromium` project; `forbidOnly` is enabled when `CI` is set.
- The Python SkillOpt surface has no Pytest suite. `skillopt/envs/pikar_cockpit/dataloader.py` contains an executable assert-based `__main__` self-check.

## Test Layout and Types

- Tests are colocated with implementation as `<name>.test.ts`, such as `packages/vault/src/normalize.test.ts` beside `normalize.ts`.
- Backend Convex tests are colocated inside `packages/backend/convex/`, matching Convex file routing and the backend Vitest include pattern.
- Browser specs live in `apps/web/e2e/*.spec.ts`; shared signed-in state is prepared by `apps/web/e2e/auth.setup.ts`.
- The repository currently contains 102 TypeScript test/setup/spec files discovered by `rg --files` (39 pure-package tests, 47 backend tests, and 16 Playwright setup/spec files).
- Pure unit tests cover deterministic functions, literal-union boundaries, parsers, pricing, redaction, normalization, serialization, state transitions, and invariant tables.
- Convex integration tests exercise authenticated public functions, internal functions, database state, storage, scheduler/component seams, and cross-tenant isolation in an in-memory backend.
- Static architecture/security tests read source text and pin forbidden structures, such as `packages/backend/convex/auditImmutability.test.ts`, `importGuard.test.ts`, and `llmRedaction.test.ts`.
- Live smoke scripts under `packages/backend/scripts/run-smoke-*.mjs` cover behavior that `convex-test` cannot faithfully execute, including durable workflows, RAG, external services, and deployed bundling.
- Golden live-model evaluation uses JSON fixtures in `packages/backend/scripts/eval-cases/` and the runner `packages/backend/scripts/run-eval-golden.mjs`.
- Playwright covers signed-in user journeys including cockpit planning, attachments, scheduling, vault ingestion, voice, Gmail connection, and layout behavior.

## Representative Unit Patterns

- Use `describe` for a behavior or invariant group and `test`/`it` for concrete examples; descriptions frequently name the requirement code and expected safety behavior.
- Table/loop tests enforce completeness over closed unions. `packages/core/src/buildTelemetry.test.ts` iterates every terminal outcome and every required telemetry key.
- Boundary tests cover valid, empty, malformed, and fail-closed cases. `packages/contracts/src/routing.test.ts` proves malformed routes fail rather than default.
- Security tests include positive functionality plus explicit negative leakage checks. `packages/pii/src/scan.test.ts` asserts both typed placeholders and absence of every raw entity.
- Deterministic helpers are tested for algebraic properties where useful; `packages/vault/src/normalize.test.ts` covers equivalence, distinction, and idempotence.
- Type-level constraints may be pinned with `@ts-expect-error` in tests when an impossible state is part of the contract, as in `packages/core/src/businessProfile.test.ts`.
- Avoid snapshot-heavy tests; assertions generally target explicit values, shapes, keys, state transitions, and stable semantic UI roles.

## Convex Test Harness Patterns

- Declare a module map with `import.meta.glob`, usually excluding tests: `const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"])`.
- Create a fresh `convexTest(schema, modules)` per test or setup helper so database state is isolated.
- Simulate authentication with `t.withIdentity({ subject: "tenant_a" })`; `packages/backend/convex/tenant.test.ts` proves cross-tenant isolation and unauthenticated failure.
- Call public functions through `api.*` and private functions through `internal.*`; seed or inspect storage/database state with `t.run(async (ctx) => ...)`.
- Register component schemas/modules explicitly when a test reaches components. `packages/backend/convex/vaultExtract.test.ts` registers rate limiter, workflow, workpool, and aggregate components in `setup()`.
- Use typed helpers such as `ReturnType<typeof convexTest>` and `Id<"vaultDocuments">` rather than weakening tests with `any`.
- Fake timers are used only where queued durable work would continue after teardown; always pair `vi.useFakeTimers()` with `vi.useRealTimers()` in hooks.
- For behavior unavailable in `convex-test`, assert the reachable component-free branches offline and delegate the real path to a live smoke test; `guardrails.test.ts` documents this split.
- Source-scan tests are intentional enforcement for invariants Convex cannot encode, but should complement—not replace—behavior tests.

## Fixtures and Mocking

- Most pure-package tests use small inline objects and helper factories rather than global fixture directories.
- `SMOKE::` sentinel strings provide deterministic offline seams for model, extraction, transcription, embedding, and graph behavior without network calls; examples are in `packages/backend/convex/vaultExtract.test.ts` and `apps/web/e2e/vault.spec.ts`.
- Backend tests seed rows/storage through the real public mutation when the ingress path itself is under test; helper `uploadBytes` in `vaultExtract.test.ts` is representative.
- `vi` fake timers control scheduler teardown; there is little general function mocking because tests favor real pure functions and in-memory Convex behavior.
- Component tests import component schemas and use `t.registerComponent`; unregistered component errors usually mean the test crossed beyond its declared harness.
- Golden evaluation fixtures are versioned JSON cases in `packages/backend/scripts/eval-cases/`; the runner validates fixture vocabulary before any paid call.
- Playwright authentication uses real form sign-in once, then saves `storageState` to `apps/web/e2e/.auth/user.json`; this live-token file is git-ignored.
- Playwright fixtures use real UI plus deterministic backend sentinels. Selectors prefer accessible roles, labels, placeholders, and stable `data-testid` values.

## Commands

- Run all package-declared unit/integration suites: `pnpm test` (Turbo executes each workspace package with a `test` script).
- Run one package: `pnpm --filter @pikar/core test`, `pnpm --filter @pikar/vault test`, or `pnpm --filter @pikar/backend test`.
- Run a focused backend file/pattern from the backend package: `pnpm --filter @pikar/backend exec vitest run convex/tenant.test.ts`.
- Run all browser specs: `pnpm test:e2e` or `pnpm --filter @pikar/web test:e2e`.
- Discover/type-load a browser spec without executing its live flow: `pnpm --filter @pikar/web exec playwright test vault --list`.
- E2E execution requires `convex dev` continuously running, Next dev on `127.0.0.1:3111`, and `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`; see `apps/web/e2e/README.md`.
- Run the live golden evaluation: `pnpm eval:golden`; pin a candidate with `pnpm eval:golden --skill <name>@<version>`.
- Validate golden fixtures without Convex/model calls: `pnpm --filter @pikar/backend eval:golden --self-check`.
- Run a live subsystem gate with package scripts such as `pnpm --filter @pikar/backend smoke:vault`, `smoke:pipeline`, or `smoke:guardrails`.
- Run the Python loader self-check directly: `python skillopt/envs/pikar_cockpit/dataloader.py`.
- Type/build checks are separate from tests: `pnpm typecheck`, `pnpm build`, and `pnpm boot:check`.

## Playwright Behavior

- `apps/web/playwright.config.ts` does not auto-start services; tests intentionally reuse an already-running local Convex and Next stack.
- All specs are fully parallel; authenticated specs depend on the one-time setup project.
- Trace capture is `on-first-retry`, and the reporter is the concise list reporter.
- Assertions wait on reactive terminal states rather than fixed sleeps; `apps/web/e2e/vault.spec.ts` watches pending/extracting/processing settle to ready.
- Tests assert bounded alternative states where external connection state varies; `cockpit-render.spec.ts` accepts either the composer or Connect-Gmail call-to-action.
- Offline sentinels keep E2E deterministic while still driving real browser, database, scheduler, and UI code; live smoke gates separately prove external integration quality.

## CI and Automation Behavior

- The only committed GitHub Actions workflow is `.github/workflows/skillopt.yml`; it is a weekly/manual, kill-switch- and eligibility-gated optimization pipeline.
- That workflow installs the workspace, runs live Convex gates, installs Python only after eligibility, trains, writes a candidate, and invokes the golden eval for candidate evidence.
- There is no general pull-request CI workflow that automatically runs `pnpm test`, `pnpm typecheck`, `pnpm build`, Biome, or Playwright on every push/PR.
- Turbo caching is configured for build outputs, but the observed local test run reported remote caching disabled.
- Playbook consistency is locally enforced through `scripts/check-playbooks.mjs` and Claude hooks, not through the committed GitHub workflow.
- `scripts/boot-check.mjs` verifies install → Convex codegen → typecheck, but is not currently wired into GitHub Actions.

## Coverage and Current Gaps

- No Vitest coverage provider/configuration, coverage thresholds, Istanbul/NYC config, or coverage CI artifact is committed.
- Coverage is therefore requirement- and seam-oriented rather than measured by a percentage: pure logic, adapter integration, static invariants, live smoke, eval, and UI E2E form separate layers.
- `apps/web` has no component/unit-test script; frontend behavior is covered only through Playwright and TypeScript build/type checking.
- `packages/audit` has no test script, and the Python SkillOpt adapter/rollout has only the dataloader self-check plus live CI execution.
- Live smoke/eval/E2E gates require deployment state, credentials, or model/service access and are not part of `pnpm test`.
- `convex-test` cannot faithfully run every registered component or production bundling path; relevant playbooks explicitly warn that offline green is not sufficient evidence.
- Several files are large and their static-source tests are regex-sensitive, especially `packages/backend/convex/llmRedaction.test.ts`; refactors must update assertions without weakening the invariant.
- A repository-root `pnpm test` attempt on 2026-07-29 exceeded 120 seconds and was terminated. Pure-package suites shown in the run passed, but the backend run hit an initial `vaultExtract.test.ts` timeout followed by `Date is not defined`/`crypto.randomUUID` failures, consistent with fake-timer/environment contamination after the timeout. Reproduce the focused backend file before treating those downstream failures as independent defects.
- The same run emitted unregistered `rag` component errors from asynchronous workflow work after tests; tests that start durable work must either register the component, fake/contain the scheduler, or prove the path with a live smoke gate.

## Adding Tests

1. Put framework-neutral logic in the appropriate `packages/*/src/<module>.ts` and add `<module>.test.ts` beside it.
2. Cover the happy path, malformed/empty boundary, closed-union completeness, and the failure posture (fail closed vs governed stop) rather than only line execution.
3. For Convex behavior, create a fresh `convexTest(schema, modules)`, use `withIdentity` for public tenant functions, and inspect final database/storage state.
4. Register every Convex component the exercised path reaches; if a component cannot run in-memory, stop at a deterministic seam and add/extend the matching live smoke script.
5. For logging/security changes, assert both the expected refs/counts payload and the absence of raw needle values across every log plane.
6. For UI changes, prefer accessible selectors and assertions on user-visible terminal behavior; add a Playwright spec in `apps/web/e2e/` and document any required sentinel or live prerequisite.
7. Keep fixtures small and deterministic. Add eval JSON only when testing model/tool behavior, and update the runner’s closed assertion vocabulary when introducing a genuinely new observable.
8. Run the narrow test first, then the owning package suite, `pnpm typecheck`, relevant Biome checks, and any required smoke/E2E gate.
9. Update the subsystem playbook in `docs/playbooks/` with the command and “Last verified” evidence when watched code changes.
