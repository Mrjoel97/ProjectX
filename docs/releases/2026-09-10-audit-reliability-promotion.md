# Audit reliability release — 2026-09-10

The owner requested production promotion of all pending repository work after the merged-audit
review. This manifest describes the release candidate; the successful GitHub `ci` and
`deploy-production` runs for its exact `[deploy]` commit establish promotion, not this document.

## Release scope

Baseline repository HEAD: `3caa762bbfe7e40558f6acc2aa91cbfb8dc7eda3`.
Previous successful production workflow: `34398859030`, revision `5b6ef9944e03c9d3024177098d5c53f3f0a9153d`.
Target: the existing Convex/Vercel production application, `https://www.pikar-ai.com`.

- Transactional audit-export queue, frozen bounded upload batches and acknowledged checkpoint
  advancement under ADR-048. WORM remains off.
- Durable folder-digest workflow, explicit failure/retry state and idempotent completion.
- Persisted successful research page-read observations and honest source presentation.
- Cross-thread running-work visibility and indexed Gmail reconnect-warning deduplication.
- Shared tracing redaction, including provider errors and tool-call identifiers.
- Phase 23 evidence validation, authorization-boundary tooling and opt-in browser preparation.
- Phase 30 native controls, source-pinned dormant candidates, deterministic Data profiling,
  owned Design image input, confirmed-workload UI, governed observation collection and offline
  semantic-review preparation. These remain subject to native release gates.
- Planning corrections, source provenance and the preexisting graph artifacts, whose refresh
  remains explicitly partial. No local credentials, databases or scratch output are included.

The detailed comparison and test record live in
[the audit report](../../.planning/audits/2026-09-10-merged-audit-codebase-review.md).

## Qualification and rollout

The final local qualification passed 4,264 backend tests plus 31 subsequently added review tests,
16 UI tests, twelve TypeScript projects, 988-file Biome CI, twenty free gates, source provenance,
planning checks and a 31-page production build. Browser control specs list but have not established
authenticated workflow acceptance. Native Convex code generation and the production dry-run passed;
the generated API now includes all seven new modules in native order. Backend and web typechecks
passed again after regeneration. The deployment workflow also rejects generated-file drift.

Three independent release reviews checked backend compatibility, file hygiene and browser-smoke
preparation. The production readiness query returned `ready: true`, no missing required names,
no active fixture seams, no non-durable origins and no unseeded runtime skills. `WORM_BUCKET`
is absent. These are names/flags-only observations, not exported configuration values.

Follow the existing GitHub pipeline: push the `[deploy]` commit to main, pass CI, build and upload
the staged web artifact, dry-run and deploy Convex, seed/verify the existing registry, probe the
staged web artifact, promote it and verify the durable production URL. Do not bypass a failed step.
The ordinary seed does not publish or activate the new vertical candidates.

Schema changes are additive: optional fields, indexes and the audit-export queue. Deploy the
schema and transactional writer together. Keep WORM off through old-writer drainage; future
legacy backfill/arming requires its own retention and Object Lock evidence. Drain old direct
digest actions before intentionally triggering rebuilds that could overlap them.

Backend deployment precedes web promotion. If a later step fails, inspect both revisions. Once
new fields or queue rows exist, retain the additive schema and transactional writer during any
recovery; redeploying the older strict schema is not a safe rollback.

## What follows this release

1. Verify this exact deployment's configuration, shell/profile/Vault views and desktop/mobile
   behavior. Then qualify actual digest/research/media terminals and two real isolated users'
   first useful results. Free navigation checks do not establish paid workflow correctness.
2. Complete Phase 23's real author/evaluate/activate/rollback evidence and Phase 30's semantic
   evidence producer, independent method reviews, exact-version model evaluations, all-six
   authenticated workflow acceptance and lifecycle drills. Keep unqualified verticals dark.
3. Implement Phase 31's remaining marketing product plans; resolve Phase 32 and revenue-provider
   prerequisites according to their independent gates. Free invite-only beta remains the policy.
4. Preserve Phase 47's recurrence defer decision until real DST/OAuth traces and accepted gate
   supersession permit its schedule/run implementation. Deployment does not imply that approval.
