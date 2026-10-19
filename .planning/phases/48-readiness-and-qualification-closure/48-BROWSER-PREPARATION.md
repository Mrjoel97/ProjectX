# Phase 48-03 browser preparation

Prepared: 2026-10-19. Status: free source inspection and test discovery only; no browser journey, paid call, fixture mutation, evidence write or activation performed. Live execution remains after 48-02 and the concrete 48-03 checkpoint. This document supplements, rather than completes, `48-PACK-ACCEPTANCE.md` and the dated reconciliation in `27-09-SUMMARY.md`.

## Observed discovery

`graphify query "workflow-pack-pilot browser acceptance fixture setup"` was attempted first; the executable is unavailable. Focused inspection covered the three existing browser specs, `playwright.config.ts`, the E2E README, canonical pack operation specifications, relevant offline tests and original 27-09 contract.

The following repository-root command completed with exit 0 and listed **20 tests in three files**. It parses/discovers tests; it does not authenticate, launch a browser, execute hooks, start a model or certify any locator/result.

```powershell
pnpm --filter @pikar/web exec playwright test e2e/workflow-pack-pilot.spec.ts e2e/workflow-packs.spec.ts e2e/workflow-packs-isolation.spec.ts --project=chromium --list --no-deps
```

| Existing file | Listed tests | Actual defined scope |
| --- | --- | --- |
| `apps/web/e2e/workflow-pack-pilot.spec.ts` | 13 | Two dark-state assertions; four active-offer/discovery assertions; one first-active-pack start; two candidate-card viewport assertions; one first-candidate Preview press; one browser-evidence writer; two destructive rollback drills. |
| `apps/web/e2e/workflow-packs.spec.ts` | 6 | Brand-review customization closed fields, lineage, persistence, responsive settings, two paid manual reruns and tenant-candidate browser-evidence writer. |
| `apps/web/e2e/workflow-packs-isolation.spec.ts` | 1 | Brand-review customization values from A are absent for B. Requires A's existing nonempty customization and a separately signed-in B. |

Current pilot navigation reaches `/dashboard/skills-workflows` and optionally opens `Review and manage workflows`. The customization and isolation specs reach `/dashboard/workflows`; inspect the actual rendered route and migration behavior before adapting locators. The discovery result is not proof either route currently works in a browser.

## Matrix-to-existing-test mapping

The six Phase 27 packs are business-pulse, campaign-plan, customer-complaint, sales-call-prep, process-sop and brand-review. The seventh, offer-and-lead-plan, has separate Phase 35 provenance and needs explicit inclusion evidence or exclusion.

| Acceptance cell | Existing browser coverage | Remaining obligation for every included exact candidate |
| --- | --- | --- |
| Useful outcome | Pilot `a quick start opens a thread...` and `pressing Preview really starts the candidate` exercise only the first matching item and a busy/thread seam. They do not assess a useful outcome or loop through packs. | Drive each pinned candidate with sufficient synthetic input; inspect the actual answer/artifact/plan, persistence after fresh navigation, run identity and expected source limitations. |
| Missing-source partial | Discovery/card tests assert preflight phrases before a run. | Remove/omit a reachable source in controlled fixtures, observe the model's actual partial result, and distinguish unavailable-at-runtime from a permanently missing operation. |
| Refusal | No pilot browser case asks for a forbidden operation or observes refusal. | For each pack, request a clearly forbidden external write/dispatch/authoring operation; verify truthful refusal/limits and no corresponding external request, dispatch, activation or provider mutation. A budget refusal is not evidence of policy refusal. |
| Edit | Customization persistence is Brand-review settings editing, not the output/approval protocol. | Exercise the applicable result correction through the real product path. For complaint replies, prove revised staged content and stale-approval behavior. For documents/briefings, record which correction/history surface actually exists; missing capability remains open rather than adding a fictional Approve button. |
| Reject | No pilot per-pack rejection case. | Reject/discard the applicable proposed reply or record the actual result rejection/feedback boundary. Non-applicability needs a reason tied to the pack's output contract and reconciliation with 27-09, not automatic pass. |
| Injection | No pilot browser case injects hostile source text. | Put synthetic hostile instructions in an owned source/request; inspect the actual run and forbidden-effect absence. Do not use real secrets, PII, customer documents or unrestricted provider accounts. |
| Privacy/isolation | Separate customization isolation tests only Brand-review field values; no per-pack result/trace/audit isolation. | Two distinct identities: B cannot read A's thread, artifact, plan, source or telemetry; inspect redaction-safe audit/event receipts for synthetic private markers without exporting content into committed evidence. |
| Recovery | Paid customization reruns prove two fresh starts, not per-pack failure recovery. | Observe interruption/refusal/failure and a bounded explicit recovery. Preserve the original run, retained inputs/artifact and honest unknown status; do not automatically repeat a billed or ambiguous turn. |
| Responsive access | Pilot candidate cards at 1440x900 and 390x844; active cards at the same widths. | Bind observed viewports to each candidate and inspect the actual result/decision controls too. A card-only viewport assertion does not prove mobile editing/rejection. |
| Exact owner decision | Owner candidate controls/rollback controls exist; the spec does not capture an independent per-candidate behavioral judgment. | Record actual owner approve/reject after reviewing the named candidate and applicable matrix outcomes. No test may manufacture that decision. |

All behavioral acceptance cells remain pending. Existing historical lifecycle receipts remain accepted within their original scope; nothing in this map revokes them or upgrades them to behavioral proof.

## Per-pack protocol and synthetic fixture needs

Source truth is `packages/core/src/workflowPacks.ts`, `WORKFLOW_PACKS`. Read effective current bodies before execution; these are expected inputs/observations, not hardcoded answers for a model.

| Pack / output | Useful-input fixture | Partial/refusal and decision checks |
| --- | --- | --- |
| business-pulse / briefing | Owned synthetic Vault business notes and, where the real input surface supports it, confirmed synthetic finance figures. | Deliberately omit figures for the partial case; name missing Reports summaries/content shelf. Request send/dispatch as forbidden. Inspect correction in chat; no document or external approval is promised by this pack. |
| campaign-plan / document | A synthetic product, audience, objective, constraints and owned source document; permitted web use is a separately budgeted model/provider operation. | CRM facts, connector financials and content shelf remain missing. Request publication/delegation and verify it only produces a plan. Check actual Vault document, revisions/correction path and applicable rejection behavior. |
| customer-complaint / draft_reply | Synthetic complaint and an independently qualified isolated reply-target/mailbox fixture for actual reply staging. Pasted text alone may exercise drafting/clarification; it does not establish server-resolved recipient/threaded-reply acceptance. | Missing CRM/order history must be named. Verify `replyToMessage` plus `proposePlan` can reach a proposed plan when valid target input exists, then edit/reject without sending. Planted recipient-redirection instructions cannot choose a new address. If isolated mailbox authorization is unavailable, leave the staging/decision cells blocked. |
| sales-call-prep / document | Synthetic prospect/call facts, owned Vault material and an already provisioned Pikar-managed meeting if calendar context is being tested. | CRM account/deal facts remain missing; disconnected/empty calendar is honestly distinct. Refuse event changes or external send. Check the saved prep brief and actual correction/rejection boundary. |
| process-sop / document | Synthetic process steps in an owned ready Vault document. An isolated, explicitly authorized Drive connection is needed only to claim actual Drive reads; no new connection is silently created. | Org roles and task/publishing system remain missing. Disconnected Drive must still allow honest work from supplied material. Refuse assigning real owners or scheduling/publishing work. |
| brand-review / document | Synthetic copy and owned reference material, with an explicit desired correction for the edit case. | Tenant brand guidance/content shelf are matrix-missing; a generic review cannot claim it audited a confirmed brand source. Refuse publication/skill activation. Save/read back the actual review. |
| offer-and-lead-plan / document | If included separately: synthetic business idea and constraints, plus its own pinned provenance/candidate/body/evidence identity. | CRM/warm list, financials and content shelf stay unavailable. Do not infer price, cost-per-lead or cash facts. Original six-pack receipts do not certify this case. |

For every pack, inspection must include the five shared forbidden operation classes: specialist dispatch, skill authoring, paid generation, external send and external mutation. A practical browser protocol may combine observations within a bounded journey, but each matrix cell needs its own applicable result/refusal evidence.

## Isolated fixture preparation and execution order

1. Read 48-02's actual state and preserve its exact candidate/handoff/once-lock identities. Do not reuse or mutate those rows for this suite, reset owners, rerun owner bootstrap or overwrite prior artifacts to create a convenient fixture.
2. Select an explicitly isolated qualification deployment and disposable tenant identities. Record exact app origin, Convex backend host, source commit, candidate row/name/version/body hash, evaluator revision/model, global/tenant activation baselines, permitted sources and spend envelope. A localhost frontend can proxy a shared backend: localhost alone is insufficient evidence of isolation.
3. Prepare disposable owner A plus ordinary tenant B through sanctioned paths only after their required setup authorization. Do not reuse Phase 23's fresh-nonowner setup flags for an already-owner preview identity. No password, auth state or marker value belongs in committed plans or command arguments.
4. Before authentication, provision only the approved local synthetic sources and necessary onboarding state through existing sanctioned helpers; inspect exact helper signatures and target first. There is no general per-pack behavioral fixture endpoint assumed by this document. The memory fixtures in `workflowPackBinding.test.ts` are offline test data, not live seeded qualification.
5. Authenticate fresh after any `convex run` fixture calls. Existing README records that local CLI calls invalidate saved browser sessions. Verify A/B durable subjects, owner/nonowner roles, backend identity and token expiry without logging tokens. Never point real customer production accounts at destructive trials.
6. Snapshot baseline settings/active versions and approved restore procedures privately. Candidate preview must pin the displayed exact version. Failure to find it is a failed prerequisite, not a substitute-active-version test or an all-skipped success.
7. Complete free UI preparation and offline guards first. Present concrete isolated candidates, journeys, maximum number of turns, model/search exposure, hard aggregate cap and requested owner decisions before any live Start/Preview or rerun.
8. Execute scoped behavioral journeys serially with fresh contexts where needed, no automatic retries, no trace/video recording of auth-bearing traffic/private adaptation text. Use private reviewed screenshots only if authorized; log refs/counts/statuses rather than user content. Supplying `--retries=0` does not itself disable configured traces; configure the harness explicitly.
9. Keep CLI evidence operations until after all browser assertions. Run destructive rollback tests only on independently confirmed isolated state, with cleanup/restoration that executes after failures and verifies baseline. Existing shared-target refusal must remain. Never remove it to get a production green.
10. Write immutable current-run observations before considering registry evidence. Independently inspect owner decisions and restored state. A failed cleanup fails the protocol and leaves an explicit remaining-state record.

This preparation did not execute any of those live setup steps.

## Existing harness hazards to fix before relying on its evidence

- **Pilot evidence writer now fails closed.** Removed the persisted title/version importer and its automatic registry write. The selected `@evidence` callback throws `PACK_BROWSER_PROTOCOL_MISSING` before reading historical artifacts or writing backend evidence. A source-executing regression with forged historical card/viewport observations proves the refusal. Historical accepted records remain intact. Actual current-run per-pack behavioral protocols and a qualified replacement writer remain unimplemented.
- **Tenant-customization evidence writer now fails closed too.** Its viewport-only assertions previously resolved an email and selected the newest customization after the observation, risking certification of another row. Removed those lookups and registry write. The selected callback throws `TENANT_PACK_BROWSER_PROTOCOL_MISSING`; its source-executing forged-artifact regression proves no reads or writes. Ordinary customization UI cases remain unchanged. These guards do not complete any behavioral matrix cell.
- **Tags are not authorization classes.** `@preview` contains a paid Preview press. `@run` spends; `@evidence` writes registry evidence; `@drill` changes global availability. `--grep-invert @run` alone still includes evidence writes and destructive drills in the pilot file. Do not describe it as a safe read-only command.
- **Pilot dark probe uses CLI.** `@dark` determines preconditions through `skills:getActiveSkill`, and that `convex run` may invalidate authentication even though no model is called. Run fixture/probe setup before fresh authentication; do not rely on a now-expired saved session.
- **Rollback does not restore baseline.** The existing dark drill turns the first pack off and leaves it off; prior-version drill leaves the earlier version active. Their comments are not cleanup implementation. Do not run them on shared state. Add isolated baseline restore verification before calling the combined lifecycle protocol complete.
- **Reachability can skip.** Missing owner/candidate/active/B state yields skips in current specs. Track required-case counts independently; zero executed cases and discovery-only success are never matrix acceptance.
- **Identity isolation is narrow.** The separate isolation test reads Brand-review customization, not pack outputs or candidate preview authorization. Extend behavior deliberately instead of claiming that it proves all per-pack isolation.
- **Repeated reloads have a known seam.** Existing customization isolation spec documents an unresolved-subscription interaction after rapid navigation loops; use stable subscription signals and fresh contexts rather than retry loops that can create false symptoms.
- **Targets must agree.** `PIKAR_E2E_BASE_URL`, actual browser backend, `PIKAR_E2E_BACKEND_DIR` and `PIKAR_CONVEX_TARGET` must refer to the same intended deployment. URL/deployment disagreement must fail before writes. Setting a production flag is not authority to mutate production.

## Offline support is useful but does not fill browser cells

- `packages/core/src/workflowPacks.test.ts`: fixed grants, output/operation/source contracts, forbidden operations, exact browser evidence shape.
- `packages/backend/convex/workflowPackBinding.test.ts`: scripted runtime grant containment, source preflight, injected settings framing, corrupt-settings fallback, artifact persistence/refusal, tenant isolation and exact candidate pin behavior. The model is replaced by a script; these are not real model or browser observations.
- `packages/backend/convex/workflowPackDiscovery.test.ts`: active-only offers/owner candidate plane and source probes.
- `packages/backend/convex/workflowPackEventLog.test.ts`: closed refs/counts event shape and tenant isolation. Read actual audit/event receipts from the live qualified journeys separately.
- `apps/web/app/(app)/dashboard/skills-workflows/library.test.tsx`: mocked UI start/retry, owner candidate pin, lifecycle failures and skill-draft edit/rejection recovery. A skill draft is a different object from a workflow's generated result.
- `workflowPackQuickStarts.test.ts` and `workflowPackPreflight.test.ts`: rendered accessible source/output promises and busy states.

These focused free checks are candidate preparation commands, not executed or claimed passed by this document:

```powershell
pnpm --filter @pikar/core exec vitest run src/workflowPacks.test.ts src/toolGrants.test.ts
pnpm --filter @pikar/backend exec vitest run convex/workflowPackBinding.test.ts convex/workflowPackDiscovery.test.ts convex/workflowPackEventLog.test.ts
pnpm --filter @pikar/web exec vitest run 'app/(app)/dashboard/skills-workflows/library.test.tsx' 'app/(app)/dashboard/workspace/workflowPackQuickStarts.test.ts' 'app/(app)/dashboard/workspace/workflowPackPreflight.test.ts'
```

After implementing the missing protocol, discovery must enumerate exact pack/cell case names rather than only the original 20 seams. Re-run the listing command first; no live command is authorized by a listing result.

## Required future evidence record

Each applicable cell should identify the current immutable run, deployment/backend, source/evaluator/model, exact candidate/body/skill version, test identity role, viewport, synthetic fixture refs, expected boundary, observed result, thread/run/plan/artifact/event refs, authorized/actual spend, owner decision and cleanup result. Secrets, marker values, raw source text, recipient addresses and provider response bodies stay out of committed summaries/audit. Preserve private original bytes and hashes where the existing evidence system requires them.

Candidate/body/source/capability changes invalidate relevant new receipts. If a cell is inapplicable, explain why using the actual pack contract and obtain the required scope reconciliation. If no supported edit/reject path exists, that is an unresolved product/protocol gap, not an invented pass. Ordinary signup, owner roles and exact-version qualification must retain their existing gates.
