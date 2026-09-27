# Phase 49 Plan 06 — root acceptance review

Reviewed: 2026-09-23. Disposition: **not accepted; implementation and live local proof required**.
This supersedes the completion claims in the initial 49-06 summary. No production or provider
acceptance is inferred. The governing closure programme remains Waves 0–8.

## Findings confirmed in current source

1. `webRecipeEvals.ts` wraps the whole `current.inputs` loop in one catch. The first rejected
   injection/commerce input skips the rest, yet credits the entire case. Run and assert every input
   independently; add a regression where an early item rejects but a later item is accepted.
2. The same catch credits `expected: identity` when an identity assertion throws, including the
   assertion that a bad identity was accepted. Assertion failures must fail qualification, not
   count as the intended input refusal. Add mutation controls that prove the assertion executes.
3. `changed-bundle` changes `suite.casesHash`, not the bundle. `source-removal` deletes a value from
   a temporary Set without exercising the verifier/materializer. `source-influence` checks only
   nonempty profile values. Test actual bundle tampering/removal and observable output influence;
   do not label collection operations as source acceptance tests. Consent/attribution fixtures
   likewise need output assertions, not just successful materialization.
4. `advanceWebRecipeBrowserQualification` accepts caller-asserted outcomes and hashes; preview
   does not persist observed operations. Finalization can claim Playwright success without preview.
   Require server-observed validation/partial/edit/preview transitions, exact candidate identity,
   per-viewport progress, and stale-write rejection. Neither client labels nor a server hash prove
   pixels: browser execution needs a separate trusted runner witness of actual rendered behavior.
5. The internal evidence writer conditionally validates a transcript only when `transcriptHash`
   exists. Remove this legacy-fixture bypass and migrate tests rather than weakening production.
6. `WebRecipeQualification.tsx` displays document hashes/counts, not the returned document. Render
   the exact safe artifact in a sandboxed preview, assert visible authored content and edits at both
   widths, and compare actual document/body identities. Exercise refusal and recovery at each width.
7. The E2E rollback drill does not create a v2 project or compare its immutable bytes/lineage after
   rollback. Add this for each family, along with subsequent v1 resolution and storefront darkness.
8. Cleanup iterates all recipe rows, deletes those outside an incomplete baseline, and overwrites
   retained rows' evidence/status. Do not run this against the existing local database. Repair to
   disposable-only, exact fixture ownership and bounded cleanup; refuse nonempty recipe baselines.
9. The suite's `casesHash` hashes only case IDs; editing input values or expected outcomes leaves
   it unchanged. The self-check even requires this ID-only derivation. Bind the full canonical
   fixture content and evaluator revision/source identity, and add input-only/expectation-only
   tamper controls. A passing old receipt must not certify a changed suite with identical names.
10. Root traced the design profile to persisted output: `webProjects.appendVersion` calls
    `renderWebDocumentBytes` without a profile, and `renderWebDocument` emits unstyled HTML. Thus
    dials/profile IDs currently affect metadata, not rendered aesthetics. Add a pure, closed,
    versioned designed renderer and wire profile-aware artifact creation/preview; preserve existing
    immutable bytes and the legacy manual-renderer behavior. The evaluator must test actual designed
    output, not claim that a changed metadata object proves visual influence. Prior Plan 02/04
    acceptance does not qualify this newly observed missing integration.
11. The owner UI tests scan source strings; compatibility comments contain several required strings
    even though the matching controls no longer exist. Replace those checks with rendered behavior
    and mutation-argument assertions. A comment must not satisfy evidence that an owner control
    selects the exact row, renders output, or refuses stale/foreign qualification.

## Execution order and acceptance

Evaluator/renderer review update (2026-09-23): the worker returned 7 backend tests, 17 core tests,
three typechecks and the exact-candidate self-check passing. Root reviewed the actual code and
sent one consolidated correction request to the same native Sol worker. Remaining acceptance
issues: raw generated-bundle tamper/removal controls; role-specific rendered influence and
independent-dial mutation tests (a `<style>` marker is insufficient); genuine path bounds and
independent required-field cases; evidence-predicate/fixture-builder source identity binding;
and reduced-motion/long-content rendering. The independent grouped-input and assertion false-pass
repairs are present, but the slice remains not accepted pending these corrections. Browser
integration is still dependent. Development-only native routing/usage tooling was separately
accepted and does not qualify this product slice.

1. Repair and regression-test cleanup — accepted after root review and fresh focused tests.
2. Repair the deterministic evaluator and mutation controls; rerun every family at zero cost.
3. Implement the server-observed qualification protocol and genuine rendered browser witness,
   keeping owner activation separate. Root reviews the evidence trust boundary before dispatch.
4. Run production-built authenticated desktop/mobile E2E against a fresh isolated local backend,
   including all-family v1→v2→v1 immutable-output proof. Do not use production storage state.
5. Review artifacts and rerun integration/type/privacy gates before accepting Plan 06 or starting
   dependent Plan 07. Unit counts, discovery, and source-string tests cannot substitute for this.

No listeners on ports 3111/3112/3210/3211 were returned by the local listener check on this review.
That check is not a permanent environment diagnosis; revalidate before starting a disposable stack.

## Root-set browser trust boundary for the next implementation slice

- The public owner UI may begin a session, perform previews, and submit a completed transcript
  for review. It must not mint `runner: playwright:web-recipe` evidence on its own.
- Preview operations validate exact candidate/version/body/bundle and record only server-derived
  hashes and bounded outcome classes. Persist expected input refusal as a result rather than
  throwing away the mutation's observation. Keep unexpected errors distinct from expected refusal.
- Maintain per-viewport progression and an incrementing compare-and-swap revision. A client-supplied
  viewport label is a requested lane, not proof of browser size. Edit proof requires changed input
  and changed rendered artifact hashes, not another click with identical inputs.
- The trusted local Playwright runner must witness actual document rendering, viewport size,
  partial/refusal/recovery/edit behavior and identity checks before submitting refs-only evidence
  through the internal writer. That writer requires the exact complete finalized transcript and
  rejects missing/stale/foreign transcripts; no legacy-shape exemption. Internal/admin access is
  the trusted issuer boundary, not a claim of cryptographic pixel proof.
- Activation remains a separate owner UI action after deterministic, provenance and genuine browser
  evidence pass. Tests may insert isolated evidence fixtures for pure gate tests, but must not
  introduce a production evidence bypass to support those fixtures.
- Reuse the existing escaped WebDocument renderer through the new pure designed-renderer API;
  never accept client HTML/CSS as output. The owner qualification iframe should be read-only with
  no script, forms, same-origin or top-navigation grants. Drive frame content and actual edits in
  Playwright; hashing the frame source is an identity check, not a substitute for visible content.
- Restore the real owner-only private storefront artifact creation control for the rollback drill;
  a compatibility comment mentioning `qualifyStorefront` is not a control. Create v2 site/landing
  projects through their normal rendered form, snapshot all three immutable artifacts and recipe
  refs, roll back the registry through owner controls, then prove unchanged existing v2 artifacts
  and new v1 resolution. Keep ordinary storefront discovery/public serving false throughout.

## Checks rerun by root

- `pnpm --filter @pikar/backend test -- webRecipeEvals`: 5/5 pass. Inspection above shows these
  checks are insufficient to certify full evaluation; green output does not resolve findings.
- `pnpm --filter @pikar/core test -- webRecipeFixtures webRecipes designKnowledge`: 14/14 pass.
  The core rejection test does independently loop every negative input; the defect is the registry
  evaluator's certification loop, not evidence that those current inputs are accepted by core.
- Earlier `node scripts/check-planning.mjs` invocations exited 0 but silently skipped inspection
  because Git is unavailable. They are not verification. On 2026-09-23 root used the supported
  explicit-root invocation `node scripts/check-planning.mjs . --exit-code`, repaired stale routing,
  Phase 25 counts and scoped Phase 48/open-requirement labels, then obtained a real exit 0.
  `check-playbooks.mjs` also skips without Git: inspect watched paths and changed playbook content
  manually until a real diff-based run is available; do not label a skipped invocation a pass.
- A read-only Node/TypeScript VM diagnostic executed the current evaluator with controlled mock
  dependencies. For a reject group `[reject-first, accepted-later]`, it returned `pass: true` after
  calling only `reject-first`. With the identity predicate forced to accept a changed body, the
  identity assertion threw but the evaluator still returned `pass: true`. These are control-flow
  counterexamples, not a real candidate evaluation; no registry or filesystem writes occurred.

## Cleanup correction review

Accepted 2026-09-23 after one consolidated correction: server-stamped fixture run ownership,
empty-baseline and exact-v1 checks, captured-ID cleanup, explicit loopback server-origin plus
offline-consent guard, six-row deletion/seven-row inspection limits, and duplicate/unmarked/
non-recipe preservation controls. Root reran the three focused tests successfully (196 unrelated
tests skipped); worker reported full 199 tests and backend/web typechecks passing. Direct formatting
and graph-edge extraction completed; full graph refresh remains timed out. See the separate cleanup
review. Evaluator and browser findings are not resolved by accepting this bounded slice.

## Current aggregate gate result

### Evaluator correction accepted; browser integration remains open

On 2026-09-23 root accepted only the deterministic evaluator/standalone designed-renderer slice
after the consolidated correction and source review. The fresh exact-candidate self-check exited
0 at implementation `7e1d50f096a670318e5f4d09a9ae5a5b003303b111f190083afb700c6c07f9e0`.
Worker evidence records 19 core and 10 backend tests and three typechecks passing. The next
serial worker owns the browser repair brief, including persisted profile-aware rendering,
server-observed transcript, trusted runner witness and isolated production-built rollback E2E.
Plan 06 remains unaccepted; prior browser claims remain superseded.

### Required verifier execution controls before integration acceptance

Root reconfirmed the explicit-root planning check exits 0 on 2026-09-23. Source inspection
also confirms that this is a command-mode integrity issue, not merely missing console output:
`check-planning.mjs` catches failed root discovery and exits 0 before reading any planning file;
`check-playbooks.mjs` does the same for root discovery, diff collection and unreadable watch data.
Its successful completion is therefore not available as evidence in this Git-less environment.

At the serial integration boundary, repair strict command-mode verification without turning an
unrelated-directory editor hook into an endless blocker. Required regression controls:

- An explicit nonexistent planning root or failed Git discovery with `--exit-code` must report
  verification unavailable and exit nonzero; an existing explicit root must still inspect files.
- Strict playbook checking must fail visibly when Git/diff/watch inputs cannot be inspected,
  rather than treating an empty fabricated changed-file set as a clean tree.
- Prove the negative paths with subprocess fixtures and explicit exit/output assertions, plus
  a valid-root planning control. Preserve hook-specific behavior separately and label skips.
- Register the new design/evaluator source prefixes in the applicable playbook watch entries;
  the current entries do not cover `webDesignRenderer`, `webRecipeFixtures`, or `webRecipeEvals`.
  Documentation edits alone do not satisfy the missing watch coverage.

This checklist is outstanding implementation, not acceptance or a passing free-gate claim.

`node scripts/check-free-gates.mjs` completed with exit 1 and three problems: the new
`run-web-recipe-evals.mjs --self-check` and `verify-design-knowledge-provenance.mjs --self-test`
are not registered, and the golden evaluator source identity is stale. Direct golden self-check
also exits 1: declared suffix `7a6ea4e5...` differs from computed `32047c0f...`. Refresh exact source
identity only after implementation freeze; no paid rerun is implied. Register and execute both new
gates during Phase 49 integration. Earlier Phase 48 all-green results are historical, not the current
worktree's result.

## Local stack readiness found during review

The earlier summary's unavailable-binary claim is not supported by the current filesystem.
`C:/Users/expert/AppData/Local/convex/binaries/precompiled-2026-09-18-cf8398b/convex-local-backend.exe
--help` exits 0. Its documented flags include `--interface`, `--port`, `--site-proxy-port`, an
explicit SQLite path, `--local-storage`, and `--disable-beacon`. The installed CLI also implements
anonymous local deployments. This is readiness only: no stack was started, no credentials printed,
and no database opened. Use a fresh explicitly scoped disposable directory and loopback binding;
do not point a new process at the existing application database. Revalidate actual deployment,
auth, production web build and provider-free behavior before the browser run.
