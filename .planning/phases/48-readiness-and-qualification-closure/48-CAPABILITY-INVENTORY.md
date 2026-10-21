# Current capability and qualification inventory

Initial inventory: 2026-10-19, source baseline b4deef8bba42347e31df638b828443eb11407138. Current evidence reconciliation: 2026-10-21.
Method: three parallel read-only source/planning investigations plus integration review. graphify unavailable; focused source reads used. The initial inventory created no provider/paid/live evidence. This reconciliation reads existing dated staging artifacts and summaries only; it performs no new live check or production row read.

| Capability | Implemented / accepted scope | Qualification limit and next action | Sources |
|---|---|---|---|
| User-authored skills | Candidate-only tenant publication, exact-row evaluation, owner activation, rollback and tenant invisibility. SKILL-01 accepted 2026-08-20. | Preserve acceptance; stricter synthetic-author runtime attribution remains an accepted limitation. Ordinary-user draft UI is owner-restricted; address setup access in 49-05 without widening activation authority. | Phase 21 VERIFICATION; skills.ts; SkillAuthoringPanel; library page. |
| Agent-authored skills | Executive authoring, provenance, candidate-only writer, held-out gate, separate owner activation and rollback mechanisms. Plan 23-06 completed; current PR79 staging handoff exists. | Phase 23 is 6/9. The original 23-07 attempt is partial and normally closed; no eval-result/live-result or new paid consent exists. Revalidate the versioned current handoff before the separate 23-07 checkpoint, then 08–09. Historical September 14 failure is preserved, not the current next step. | [23-06 summary](../23-agent-authored-skills/23-06-SUMMARY.md); [23-07 partial summary](../23-agent-authored-skills/23-07-SUMMARY.md); [current handoff](../23-agent-authored-skills/handoffs/2026-10-20-pr79/23-LIVE-HANDOFF.json); [refresh scope](../23-agent-authored-skills/handoffs/2026-10-20-pr79/23-HANDOFF-REFRESH.json). |
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

- [PR79 staging release](48-STAGING-PR79-RELEASE-2026-10-20.json): source `b10740d6466db155c48519aba6323d5b0c27c406`, CI `39446162910`, successful release `39460078883`; no production promotion.
- Current versioned handoff SHA256 `ce31e352302bab168ba81bc564fbec90e76b2ab3eeafac402bbfa65792857d61`; companion refresh SHA256 `6b86ddbe2ad61dc4f331024a0e08b3fdb3420c0771bdbb28a5a38c3161cc31c8`. The refresh records six stable current reads, native A owner/B non-owner and measured responsive/direct-keyboard scope. Embedded controls, physical-device/touch testing and new authoring/refusal replay are not claimed. It supersedes only the next-input reference; original handoff/partial bytes remain unchanged. PaidReady/paidAuthorized remain false.
- [Phase 21 acceptance](../21-user-authored-skills-and-routines/21-VERIFICATION.md)
- [Phase 23 execution preparation](../23-agent-authored-skills/23-EXECUTION-PREPARATION.md) and plans06–09; read the later STATE history continuation before recovery.
- [Phase 27 dated partial reconciliation](../27-curated-knowledge-work-pack-pilot/27-09-SUMMARY.md)
- [Preserved September STATE snapshot](../../archive/STATE-history-2026-10-19.md)
- [Service programme](../../design/managed-services-programme.md)

## Next action

48-02 remains partial: revalidate the current versioned handoff and source/auth/cost prerequisites before the separate fresh full 23-07 paid checkpoint; do not replay 23-06 or reuse the closed interrupted envelope. Plans 23-08/09 remain dependent on complete passing evidence and their owner-action boundary. Free 48-03 protocol preparation can be reviewed without filling its behavioral matrix; live execution retains its separate prerequisites and scope. Phase 49 stays blocked on 48-04's readiness seal. Work cannot be reported qualified from a generated checklist.
