# Current capability and qualification inventory

Initial inventory: 2026-10-19, source baseline b4deef8bba42347e31df638b828443eb11407138. Current evidence reconciliation: 2026-10-22.
Method: three parallel read-only source/planning investigations plus integration review. graphify unavailable; focused source reads used. The initial inventory created no provider/paid/live evidence. This reconciliation reads existing dated staging artifacts and summaries only; it performs no new live check or production row read.

| Capability | Implemented / accepted scope | Qualification limit and next action | Sources |
|---|---|---|---|
| User-authored skills | Candidate-only tenant publication, exact-row evaluation, owner activation, rollback and tenant invisibility. SKILL-01 accepted 2026-08-20. | Preserve acceptance; stricter synthetic-author runtime attribution remains an accepted limitation. Ordinary-user draft UI is owner-restricted; address setup access in 49-05 without widening activation authority. | Phase 21 VERIFICATION; skills.ts; SkillAuthoringPanel; library page. |
| Agent-authored skills | Executive authoring, provenance, candidate-only writer, held-out gate, separate owner activation and rollback mechanisms. Plan 23-06 completed; current PR82 staging handoff exists. | Phase 23 is 6/9. Both historical paid 23-07 attempts are partial and normally closed. The later PR81 c663 approval was consumed by a startup-only read transport failure; complete bounded native ledger evidence confirms zero new work, with no budget/run/root/evidence. No eval/live-result exists. PR82 released helper 825ef and validated handoff e7ee now supply the next input; fresh paid approval and exact-state admission remain required before another attempt, then 08–09. Historical September 14 failure is preserved, not the current next step. | [23-06 summary](../23-agent-authored-skills/23-06-SUMMARY.md); [23-07 partial summary](../23-agent-authored-skills/23-07-SUMMARY.md); [current handoff](../23-agent-authored-skills/handoffs/2026-10-21-pr82/23-LIVE-HANDOFF.json). |
| Curated workflows | Seven registry ids; active-only discovery, source preflight, leaf grants, correlated runs, owner preview/rollback/deactivation. Historical six-pilot activations exist. | Six-pack positive/partial/refused/edit/reject/injection/privacy/recovery and explicit exact-candidate review remain open in 27-09. Seventh pack needs separate inclusion evidence. Current active rows are not attested here. | workflowPacks.ts; workflowPackBinding; workflowPackDiscovery; 27-09 dated reconciliation. |
| Vertical workflows | Six candidates, forty-case native corpus, deterministic Data validation, review console and independent disable/release checks. | Dormant/unqualified in latest records; all connector variants blocked. Source pin refresh is not live semantic evaluation. Keep excluded. | vertical-packs playbook; Phase 30; verticalEvalEvidence. |
| Shared agent runtime | Phase 38 ToolContext/grantsFor; exact-name filtering; Executive dispatch; durable specialist workflow with paid retry:false. | Curated pack starts are separate authenticated paths; no shared managed-service config/run boundary yet. Do not rewrite registry or widen leaf grants. | toolGrants.ts; llm.ts; cockpit.startWorkflowPack; dispatchRun.ts. |
| User service interface | Library launches a workflow conversation; skills history and owner controls exist. | No configure-once operational service lifecycle. New setup should reuse facts, explain readiness and supervise results. | skills-workflows/page.tsx; workflows/page.tsx. |
| Buffer | Registered tenant app OAuth/GraphQL publishing, selected channels, exact revision human approval, refresh/claim fences. | Hosted grant cannot supply insights. Current adapter has no queued-post cancel operation. Real post authority is exact-content approval; connection is not standing publish consent. | ADR-059; bufferTools; buffer; bufferActions. |
| Zernio | Customer-owned encrypted reporting key, selected Instagram/TikTok, opt-in daily refresh, bounded cached report. | Two accounts/up to500 posts over90 UTC publication dates; agent sees20/account sample. Lifetime snapshots, missing fields, stale data and publisher attribution limits remain. Latest snapshot alone is not historical outcome evidence. | ADR-060; zernio.ts; zernioActions; zernio core. |
| General recurring work | Time arithmetic, existing DST probe/collector and ADR-046; specific weekly/provider/system jobs exist. | defer remains. Eligibility command produced14 problems. Collector refresh-only OAuth evidence does not prove human reconnect acceptance. Earn current evidence, then explicit new decision before runtime. | 29 decision; 46 ADR; 47 research; collector; routines.test; crons. |
| Brain / agenda | Phase 34 persistent gap lifecycle, goal text by segment and weekly staging of one proposal. Context spine and provenance-tagged facts exist. | No full goal/service/run/outcome join or bounded historical service measurements. acted is operational state, not business improvement. | goal-engine design; agenda; proactiveReview; blueprint; workflowPackOutcomes. |

## Evidence hierarchy and current admission

1. Source proves a mechanism exists. Tests prove their exercised scope. Historical acceptance remains accepted at its recorded scope.
2. Neither this inventory nor refreshed source fingerprints assert current provider/tenant rows or certify changed code against an old live receipt.
3. Phase 49 admission waits for 48-04's completed readiness seal. Later implementations require fresh affected qualification; the seal is not permanent certification.
4. Phase 21's accepted limitation is retained. Phase 23/27 protocols are not silently narrowed. Vertical release, broader autonomy and unsupported provider mutations are excluded.

## Current commands and actual results

- graphify query: unavailable executable; focused source fallback used.
- Recurrence eligibility: fails14 problems on the unchanged decision, including provider-read citation no longer meeting collected-evidence validation.
- No auth state, credentials, raw provider data or email identifiers were collected.
- Planning consistency and plan structure checks: see 48-01-SUMMARY.md for the executed result.

## Existing evidence pointers

- [Current PR82 release](48-STAGING-PR82-RELEASE-2026-10-21.json), SHA256 `3113664464004c54d805023d965fcbdd59e1a77cfa4f43e09f94f7cc7872b60f`: source `821b097ceae440730bc51988af0425fb878687fb`, CI `39663077579`, release `39668142870`/job `119458556492`; configuration/registry/retention and historical bills preserved.
- [Current PR82 handoff](../23-agent-authored-skills/handoffs/2026-10-21-pr82/23-LIVE-HANDOFF.json), SHA256 `e7ee9d75acf644ab20d8e72e708b92941649b20b026b8778738b3f371ebf4b62`; [refresh](../23-agent-authored-skills/handoffs/2026-10-21-pr82/23-HANDOFF-REFRESH.json), SHA256 `f94d17cf0457952c3c035755d23683f55374bfbf682f7dd9677afd98fb62f59c`. Fresh native A owner/B non-owner, NOT_STARTED, native keyboard, actual 1280x720/390x900 views and six matching reads qualify this handoff scope only; paidReady/paidAuthorized remain false.
- [Historical PR81 staging release](48-STAGING-PR81-RELEASE-2026-10-21.json), SHA256 `499a08b00c0bf5e64927351782fb4bc1b982afcb0c6b629768850dadaba19f73`: source `cafde7c6c7d65924b7a48433cf4938983d91707c`, CI`39615369973`, merge`821c3206e47eb4cec0ebcf3d99cf943358f2910a`, successful release`39618889468`/job`119286711355`. Configuration, registry and protected retention hashes are preserved; no production promotion.
- [Historical PR81 handoff](../23-agent-authored-skills/handoffs/2026-10-21-pr81/23-LIVE-HANDOFF.json), SHA256 `39dfb14558a96cdbede3ca7d0641ee33ed09edaec0526510950528a19a48a930`, binds the unchanged candidate and current5867/5dbe46-case suite. Fresh native A owner/B non-owner, NOT_STARTED, direct1280x720/embedded390x900 views, native keyboard draft/diff and six stable final reads are observed. Embedded controls, physical-device/touch testing and new authoring/refusal replay are not claimed. PaidReady/paidAuthorized remain false.
- [Historical PR79 staging release](48-STAGING-PR79-RELEASE-2026-10-20.json) and [PR79 handoff](../23-agent-authored-skills/handoffs/2026-10-20-pr79/23-LIVE-HANDOFF.json), SHA256`ce31e352302bab168ba81bc564fbec90e76b2ab3eeafac402bbfa65792857d61`, retain their oldb107/d122 scope. Original handoff, refresh and both partial attempts remain unchanged. Neither closed attempt is a passing evaluation or reusable paid authority.
- [Phase 21 acceptance](../21-user-authored-skills-and-routines/21-VERIFICATION.md)
- [Phase 23 execution preparation](../23-agent-authored-skills/23-EXECUTION-PREPARATION.md) and plans06–09; read the later STATE history continuation before recovery.
- [Phase 27 dated partial reconciliation](../27-curated-knowledge-work-pack-pilot/27-09-SUMMARY.md)
- [Preserved September STATE snapshot](../../archive/STATE-history-2026-10-19.md)
- [Service programme](../../design/managed-services-programme.md)

## Historical PR81 terminal attempt

[The immutable PR81 startup observation](../23-agent-authored-skills/23-07-STARTUP-2026-10-21-PR81.json) (SHA256 `8815857b7e559e24c4daf42a2092f0e0ae7b163d329ea0c12b67e3abb851bb2c`) records consumed c663 authority, zero judged cases and complete bounded native zero new spend/envelopes/evaluation movements. The deployed caf/5867/39df chain remains valid only for its original source; offline golden 825ef/vertical 01d6 have not been staged. Both held-out corpora are unchanged. No passing evidence, public B mutation, activation or cleanup followed.

## Next action

48-02 remains partial: revalidate the released PR82 source/current handoff and obtain fresh exact-run consent before another full 23-07 attempt; do not replay 23-06 or reuse either closed interrupted envelope. The successful PR82 release and new handoff do not authorize a paid run. Plans 23-08/09 remain dependent on complete passing evidence and their owner-action boundary. Free 48-03 protocol preparation can be reviewed without filling its behavioral matrix; live execution retains its separate prerequisites and scope. Phase 49 stays blocked on 48-04's readiness seal. Work cannot be reported qualified from a generated checklist.

## 2026-10-23 source delivery: built-in attended slice

PR86 adds the local built-in social draft/report engine, safe interruption recovery, goal/outcome/history views and field-level source-aware Ledger/context. ADR066 scopes code-owned attended admission to the already-runnable unique global cockpit instruction with exact native pins/accounts/budget/control. This slice uses its own current-source CI and native public-start acceptance; it does not wait for unrelated offer-architect or pack qualification. It is not a Phase48 composite seal or a production deployment. Authored overrides, packs, business review and verticals retain their prior unqualified/unavailable status. ADR063's recurring adapter remains disabled, with activation/live evidence outstanding. Historical source/evidence dispositions above are not rewritten.
