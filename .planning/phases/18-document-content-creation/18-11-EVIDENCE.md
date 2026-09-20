# Phase 18 Plan 11 — Current Document Lifecycle Evidence

**Recorded:** 2026-09-20  
**Repository HEAD at Task 1:** `e035a858789a8d9fe1f4d2378e1ad7b0d9aac548`  
**Scope:** repository-controlled Tasks 1–2 only; no provider, paid-model, deployment, production, tenant, send, or publish action is authorized.

## 17.1-11 Blueprint baseline pin

| Fact | Exact value |
|---|---|
| Path | `.planning/phases/17.1-business-blueprint-corpus-synthesis-and-agent-spine/17.1-11-BASELINE.json` |
| File SHA-256 | `1fb23734582140d5d6fb0e785a4682866cbeefd2b96a9d7c1e1352616ae033fe` |
| File length | `10617` bytes |
| `accepted` | `false` |
| Recorded revision | `d78cbb10a8c466b2c36d92ae7a23ef7db446f0cc` |
| Recorded deployment | `local:local-joel_feruzi-pikar_ai_50c69-1` (`non-production`, `http://127.0.0.1:3210`) |
| Cited source set | `5` required, `5` observed, `5` document ids with content hashes |
| Spine | `b80ece37e4fa9757291a92954cf2ccb76a35ca28ec085061af0839dd38a91848`; run-start length `401`, reconciled length `516` |
| Active skill identity recorded | `cockpit-agent@26`, skill id `kh7aj0ek1v7cwqbb127zsar3hx8chgbn`; the baseline does **not** record a body hash for this pin |
| Blueprint skill identity recorded | `business-blueprint@1`, body SHA-256 `0a1ecdd5c65b22c0a3ae4bc511fc9900e9567150beeef55d8ec04547220e4aa2` |
| Evaluation | run `bc1d1a74`; `partial_non_certifying_paid_call_unresolved`; `7/46` executable cases passed before the unresolved call |
| Founder verdicts | cockpit `not_owner_verified`; contradiction `not_owner_verified`; voice `not_owner_verified` |

The baseline is parseable and its boolean acceptance state is pinned, but it is not an accepted
Blueprint baseline. Its recorded revision also differs from the Task 1 repository HEAD. Therefore
this file is dependency evidence only: it does not certify current deployment identity, conclusive
evaluation, an active `cockpit-agent` body hash, or founder acceptance.

## Gate disposition

- Task 2 deterministic repository verification is permitted by the revised plan and proceeds without
  consuming or changing Blueprint construction.
- Tasks 3–6 are prohibited while `accepted:false`; no live UAT, browser acceptance, owner verdict,
  deployment claim, cleanup claim, or ACTN-04 closure may be inferred.
- `packages/backend/convex/blueprint.ts`, Blueprint tests, Blueprint playbooks, the baseline JSON,
  and its cited source/spine identities remain read-only.
- Re-entry requires a newly hash-pinned `17.1-11-BASELINE.json` with `accepted:true`, exact candidate
  revision/deployment identity, non-empty cited source hashes, exact spine hash/length, active skill
  version and body hash, conclusive evaluation evidence, and approved cockpit/contradiction/voice
  verdicts.

## Six-layer disposition after Task 1

| Layer | Status | Evidence boundary |
|---|---|---|
| implemented | green for repository-controlled lifecycle | Current source plus the refused-replacement storage repair below; Blueprint construction unchanged. |
| offline-tested | green for the exact deterministic Task 2 commands | Unit/integration suites and Playwright discovery passed; this is not a browser run. |
| deployed | open | The baseline names a historical non-production deployment, not this candidate HEAD. |
| live-observed | open / blocked | Upstream run is partial and non-certifying; document UAT is not authorized. |
| owner-accepted | open / blocked | No current document workflow or BRAND verdict exists. |
| externally-enabled | not authorized and not required for offline proof | SAVE is not SEND; no external delivery or publishing is claimed. |

## Task 1 verification

```text
node -e "... if(typeof j.accepted!=='boolean') ...; console.log('accepted='+j.accepted)"
accepted=false
```

## Task 2 lifecycle matrix

| Surface/state | Current offline proof |
|---|---|
| PDF create/download | Long-form `createDocument` writes one tenant-scoped markdown artifact of record plus real `application/pdf` stored bytes; the Output card opens the selected row and mints the only download URL only for selected PDF bytes. |
| HTML | `generateAttachment({format:"html"})` stores escaped, self-contained `text/html` bytes with an `.html` filename. Hostile title, heading, paragraph, list and table content remains inert text. |
| XLSX | Attachment and `form:"sheet"` paths store a real OOXML workbook with `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; parsed workbook rows prove the bytes are not a renamed PDF. |
| Short content | `form:"short"` uses `content-drafter`, writes `created_content`, retains `text/markdown`, and stores no download bytes or `storageId`. |
| Filename/MIME truth | `formatSpec` is the single extension/MIME mapping for PDF, HTML and XLSX; collision suffixes are format-local and `formatForMime` round-trips only supported formats. |
| View | The Output card follows the newest artifact unless the user explicitly selects another, then opens the exact tenant-scoped Vault document. |
| Regenerate | Attachment regeneration preserves stored HTML/XLSX format, replaces the slot, and deletes superseded bytes. |
| Replace | `createDocument(replace:N)` patches the same Vault row without count inflation, refreshes the append-only card, deletes superseded bytes, and now deletes newly rendered bytes when the server-owned index refuses. |
| Loading/empty/partial | The Output card has explicit loading, missing-artifact, missing-download, summary-only partial, and empty-preview copy. Missing PDF storage falls back to saved text while naming the unavailable download. |
| Renderer/draft refusal | Forced attachment render failure stores no ref, records `attachmentError`, and blocks proposal; missing drafter, budget/kill-switch, no-table spreadsheet and bad-format paths return bounded refusal sentences without half-written artifacts. |
| Audit | `document.created` is exactly one refs-only row with `topicHash`, closed `form`, `vaultDocId`, and `hasPdf`; neither topic nor generated prose is present. |
| Tenant isolation | Tenant B cannot list/read/replace tenant A's created row; replacement also refuses user uploads. |
| External effects | The `createDocument` tool contains no send/dispatch/workflow side effect. UI copy is exact: `Saved to your vault. Nothing was sent.` |

## Reproduced defect and permanent repair

**[Rule 1 — Bug] Refused replacement orphaned newly rendered storage bytes.**

- **Reproduction:** after one accepted long document, request `replace:5` with another long draft.
  `patchCreatedDoc` correctly refused and no Vault/card/audit row changed, but `_storage` grew from
  one object to two because rendering occurred before the server-owned index check.
- **Failing check:** focused `cockpitTools.test.ts` run reported the unexpected second storage id.
- **Repair:** on any `patchCreatedDoc` refusal, delete the newly rendered PDF/XLSX `storageId`
  before returning the honest “nothing was changed” sentence. This applies equally to missing,
  foreign-tenant, and user-upload replacement refusals.
- **Regression:** the storage system-table ids must remain byte-for-byte identical across a refused
  replacement; the focused test and the complete 169-test cockpit suite pass.

**[Rule 2 — Missing critical honesty] Output-card degradation was silent.**

- The prior PDF-storage miss silently fell through to markdown/snippet rendering, so a user could
  not distinguish a healthy download from a partial artifact.
- The card now names missing artifact, missing download bytes, summary-only partial, empty preview,
  and loading independently, while preserving the saved-not-sent boundary.

## Exact deterministic verification (2026-09-20)

| Command | Result |
|---|---|
| `pnpm --filter @pikar/core test -- documentGen` | PASS — 1 file, 27 tests |
| `pnpm --filter @pikar/backend exec vitest run convex/createdDocs.test.ts convex/documentDraft.test.ts convex/cockpitTools.test.ts convex/runCockpitAgent.test.ts` | PASS — 4 files, 228 tests |
| `pnpm --filter @pikar/web exec vitest run "app/(app)/dashboard/workspace/outputCard.test.ts"` | PASS — 1 file, 13 tests |
| `pnpm --filter @pikar/web exec playwright test e2e/cockpit-created-document.spec.ts --list` | PASS — 3 discovered tests in 2 files (setup plus 2 Chromium cases); **not executed** |
| `pnpm --filter @pikar/web exec tsc --noEmit` | PASS — exit 0 |
| `node scripts/check-playbooks.mjs` | PASS after updating `docs/playbooks/cockpit.md` with the repository-only repair |

The backend suite emits its known convex-test diagnostic when the optional Workflow component is
not registered in two scheduled-test paths; all four files and all 228 assertions pass. This output
is not treated as a document failure.

## Cleanup and remaining gate

Tasks 1–2 performed no tenant, provider, deployment, production, live-model, send, publish, or
external write, so there is no live cleanup inventory. Convex test state is in-memory and disposable.
The new regression proves rejected replacement bytes are deleted rather than orphaned.

Task 3 remains the next plan step, but execution stops here because the upstream baseline is still
`accepted:false`. The single re-entry condition is a newly hash-pinned, accepted 17.1-11 baseline
with exact release/skill/evaluation identities; live UAT then still requires its own bounded
authorization and founder BRAND judgment. No current deployment, live observation, owner acceptance,
external enablement, send, or publish claim is made.
