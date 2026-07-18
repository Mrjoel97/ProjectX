# Playbook: Knowledge Vault & GraphRAG

> Last verified: 2026-07-18 (3) — Transcription timeout + pinned modal actions (owner-reported): a 21 MB mp4 failed with `TimeoutError` — `vaultTranscribe`'s 45s `CALL_TIMEOUT_MS` (copied from intake.ts, tuned for seconds-long mic clips) can't cover upload+transcription of a near-cap video; raised to 480s (under Convex's 10-min node-action limit). Timeout errors now map to the static reason `transcribe_timeout`. Verified live: the failed 21 MB video re-ran to `ready`. PreviewModal's detail panel restructured to fixed header / scrollable middle / PINNED actions footer — documents with many extracted entities were scrolling Download/Delete/Open-in-workspace out of sight (media docs, with few entities, kept theirs visible — the reported asymmetry). Prior: 2026-07-18 (2) — Soundless-video honesty + preview media containment (owner-reported): a second mp4 failed on whisper-1 with `AI_APICallError: The audio file could not be decoded` — byte-level mp4 box inspection proved the file has ONE track (`vide`/avc1, NO audio track), so there is nothing to transcribe. `transcribeDoc`'s catch now maps that decode error to the static reason `no_audio_track_or_undecodable` (card renders "no audio track or undecodable"); other errors stay `transcribe_failed`. PreviewModal media are now contained: img/video get `object-fit: contain` + `max-height: 62vh` (full image visible, never cropped at the card edge), and stacked mode bounds both rows (`minmax(0,1.3fr) minmax(0,1fr)`) so tall media can't push the detail panel past the card's overflow-hidden edge. Ops note: vitest false-reds (`crypto is not defined` in convex-test workers) appear under CPU saturation — kill runaway processes and re-run `--maxWorkers=1` before trusting a red. Prior: 2026-07-18 — Video transcription fix (owner-reported: a 6 MB mp4 failed): `transcribeDoc` now transcribes with `whisper-1` instead of `gpt-4o-transcribe`, which rejects video-container mp4 (`AI_APICallError: This model does not support the format you provided`). whisper-1 demuxes the audio track; both bill at 0.006/min so the cost model is unchanged. Verified live on the shared local deployment: the failed 6 MB mp4 re-transcribed to `ready` + embedded. The terminal catch-all now `console.error`s the API error message (refs-safe) so a `transcribe_failed` is no longer a silent dead-end. `intake.ts` intentionally stays on gpt-4o-transcribe (its inputs are mic audio, which that model supports + transcribes more accurately). Prior: 2026-07-18 — Post-3.8 human-verify tuning (owner-reported during phase-close): the per-file cap became per-kind — `VAULT_FILE_CAP_BYTES` raised 8 MiB → **100 MiB** for docs/images, new `VAULT_VIDEO_CAP_BYTES` = **25 MB** for video (the transcription API's hard limit). Enforced at the `vaultUpload` chokepoint (per-kind branch, specific messages) and mirrored in `Dropzone.tsx` as a fast pre-upload guard (two local numbers + sync comment — no new web dep on the Node-oriented `@pikar/vault` barrel). `PreviewModal.tsx` no longer overlaps on narrow screens: the two-pane grid moved to `.vault-preview-grid`/`.vault-preview-main` in `globals.css` and STACKS to one column below 48rem (divider flips right→bottom border), and the extracted-text pane now shows a 1500-char snippet with a "Show full text" expander instead of dumping the whole document. Video >25 MB and large-doc extraction memory/time logged under Known gaps. Verified: `@pikar/vault` cap/category tests green, `@pikar/backend` `vault.test.ts` + `vaultTranscribe.test.ts` green (26 incl. new per-kind cap tests), web typecheck clean, biome clean on all touched files. Prior: 2026-07-18 — Phase 3.8 Wave 3 (03.8-06 integration): all four Wave-2 lanes merged to `main` and the merged whole proven green. Lane 1 (`vaultExtract.ts` — PDF text-layer-first + hosted OCR + image), Lane 2 (`packages/vault/src/officeText.ts` — DOCX/XLSX/PPTX flatten), Lane 3 (`vaultSweep.ts` backlog sweep + `retryExtraction` + the vault-route lifecycle UI + `vault.spec.ts` E2E), and Lane 4 (`vaultTranscribe.ts` — video/audio transcription rail) are now the real dispatcher end to end: `vaultUpload` → `extractDoc`/`transcribeDoc` (kind-dispatched, self-gated via preCall, scan-then-audit refs-only, char-capped) → `ingestExtractedText` seam → embed + graph. The two EXTR-H rows in `apps/web/e2e/vault.spec.ts` are now UN-skip-guarded (Wave-0 stubs are real, so the SMOKE::extract:: pdf + SMOKE::transcribe:: mp4 walks assert a clean pending_extraction → ready terminal, not the old `failed("not_implemented")` branch). Verified on merged `main`: backend vitest 317/318 (only red = pre-existing `audit.test.ts` auditCounts-unregistered, documented since Phase 2), `@pikar/vault` 42/42 (officeText 15/15), web typecheck clean, `biome lint` clean on all merged vault files, `check-playbooks` green. `_generated/` regenerated (`npx convex codegen`) so `api.d.ts` carries all four modules. Append-only singletons (STATE/ROADMAP/vault.md/deferred-items) resolved keep-both per PARALLELIZATION §"three shared singletons". Prior: 2026-07-18 — Phase 3.8 Wave 0 (03.8-01): the extraction CONTRACT landed on `main` — `vaultDocuments.status` grew `extracting` (+ `extractionTruncated` optional flag), `vaultUpload` now schedules `internal.vaultExtract.extractDoc` / `internal.vaultTranscribe.transcribeDoc` by `extractionKindFor(mimeType, filename)` for non-searchable binaries (TXT/MD/CSV path untouched), and the scheduler-safe internal seam `ingestExtractedText` + `markExtracting` + `getDocForExtraction` sit next to markReady/markFailed. `@pikar/vault` gained `extractKind.ts` (classifier + caps consts, on the barrel) and the `officeText.ts` stub (subpath-only — keeps fflate out of the V8 bundle). `unpdf@1.6.2`/`fflate@0.8.3` pinned; the lockfile, both package.jsons, `schema.ts`, `vault.ts`, and `watch.json` are FROZEN for the rest of the phase (see `## Extraction lifecycle (Phase 3.8)` + `.planning/PARALLELIZATION.md`). Prior: 2026-07-17 — overflow containment fix (user-reported): long unbroken filenames painted past the doc cards. In `DocGrid.tsx` grid (column) view the info span's cross-axis shrink-to-fit sized it to the full nowrap-title width (min-content = max-content for nowrap text), so the ellipsis never engaged — capped with `maxWidth: 100%`; `PreviewModal.tsx`'s title `h2` got `minWidth: 0` so `flex: 1` can actually shrink it and `break-word` wraps instead of pushing past the panel. Visual containment only — no data/query/status changes; web typecheck clean. Prior: 2026-07-15 — owner-directed shell fusion + glass/clay uniformity, in two passes. Pass 1 fused the route full-bleed: `(app)/layout.tsx`'s `is-bleed` match widened to `/^\/dashboard\/(workspace|vault)/`, so `<main>` drops its canvas padding and locks overflow, and `vault/page.tsx`'s root became a `.vault-surface.pane-canvas` (the workspace canvas's teal aura) with an inner `.vault-scroll` owning its own scroll (is-bleed locks `<main>`). Pass 2 gave the board pieces the actual glass-over-clay treatment (the fusion alone left the tiles flat): shared `globals.css` classes `.clay-card` (frosted translucent pane + `backdrop-filter` blur + extruded shadows — an outer drop, an inner top light edge, a soft inner bottom shade; hover-lift for `button.clay-card`), `.clay-badge` (extruded icon badge mirroring `.rail-logo`), and `.clay-dropzone` (lighter frosted panel). Applied by className to the VaultStats tiles + their icon badges, the CategoryTabs container, the DocGrid search bar + doc cards + card icon badges, and the Dropzone panel + its icon (each dropped its inline `var(--card)`/border/flat-shadow; radius + layout stay inline). The `backdrop-filter` frosts the aura, so these only read right on `.pane-canvas`. PreviewModal is intentionally left solid — it sits on a dark scrim, not the aura, so frosting would just muddy the scrim. Internal vault behavior and all `vault.spec.ts` selectors unchanged; web typecheck clean. Prior: 05-07b — LIVE browser human-verify (real user, Claude-in-Chrome): the vault route renders a 1:1 brand match; a pasted Brain Dump ingested end-to-end through the REAL pipeline (embed → graph-extract → upsert → `ready`), and the preview modal surfaced the correctly-extracted entities (Meridian Health/CareLink/Vantage Systems `org`, Alan Ford/Nina Osei `person`) + a typed `led by` relationship. The live run CAUGHT + FIXED a P0 the offline SMOKE suite could not: `vaultRag.ts` passed a spec-"v4" `openai.embedding(...)` model to RAG's ai@6 (`AI_UnsupportedModelVersionError`) — replaced with a v2 `openaiEmbeddingV2` REST adapter (+ a `vaultRedaction.test.ts` static guard). Also surfaced: ingest needs `skills:seedSkills` run against the deployment (`NO_ACTIVE_SKILL: graph-extractor` otherwise).
>
> Prior: 05-07 — phase close (VALT-01/03/04): the Playwright vault E2E (`apps/web/e2e/vault.spec.ts` — honest-zero → paste a `SMOKE::graph::` Brain Dump → processing→ready reactively → search → preview with entity chips → delete → empty, over the OFFLINE SMOKE:: ingest, Playwright-discovered + type-loads) and the live `smoke:vault` gate (`packages/backend/scripts/run-smoke-vault.mjs` + `packages/backend/convex/vaultSmoke.ts`: seed 2 briefs sharing an entity with a REAL `rag.add` embed → poll ready → assert live hybrid `rag.search` returns the seed → assert `vaultGround`'s live path merges the graph neighbor reached via the shared entity → assert no raw brief text in any audit/deadLetters row §4; a try/finally purge). The human-verify against `brand-024242`/`brand-024258` is the phase gate. `vaultSmoke.ts` is a smoke-only internal helper (explicit `tenantId` — the CLI carries no identity); its live run is the runnable check (no colocated convex-test — the rag/workflow components don't run under it).
> Prior: 05-06 — the Knowledge Vault UI route landed (VALT-04): `apps/web/app/(app)/dashboard/vault/` — `page.tsx` (headline + teal Refresh + Loading pill + lifted category/selected state), `VaultStats.tsx` (4 tiles), `CategoryTabs.tsx` (the 6 tabs), `Dropzone.tsx` (generateUploadUrl→vaultUpload + Brain-Dump paste→vaultIngestText), `DocGrid.tsx` (search via `vaultSearch` + N ITEMS + grid/list), and `PreviewModal.tsx` (in-place Esc/X modal: text/image/video preview + metadata + this-doc `docEntities` chips/edges + on-demand `vaultDownloadUrl` browser download + `deleteVaultDoc` reactive-remove + Open-in-workspace link). A signed download/media URL is rendered into `<img>`/`<video>`/`<a>` ONLY, never logged (§4). Nav entry added in `(app)/layout.tsx`; tokens only (globals.css)
> Prior: 05-05 — the READ plane landed: `vaultGround.ts` (`vaultGround` tenantAction — `rag.search` hybrid seeds → map entries to docIds → hop-capped `expand` → `fuse`, `namespace=tenantId` + tenant-scoped expand isolation, `SMOKE::<docId,…>` offline seam via `ownedDocsMeta`) and the `vault.ts` read surfaces (`listVaultDocs`/`vaultStats`/`vaultDownloadUrl` bearer-capability guard/`docEntities`/`vaultSearch` — the same `rag.search` hybrid primitive post-filtered to a category), covered by `vaultGround.test.ts`
> Prior: 05-04 — the durable ingest spine: `vault.ts` (tenant `vaultIngestText`/`vaultUpload` hash-dedup + accept-but-defer + `deleteVaultDoc` cascade/orphan-GC; internal `getDoc`/`markReady`/`markFailed`), `vaultIngest.ts` (`workflow.define` store→embed→extract→upsertGraph→recordSpend→ready with a `preCall` gate), and `vaultRag.embedDoc` (rag.add + hash dedup + `SMOKE::` bypass), covered by `vault.test.ts` + the `vaultRedaction.test.ts` §4 static scan
> Prior: 05-03 — the graph plane: `vaultLlm.ts` (V8 `extractGraph` — redact-then-extract + registry prompt + `SMOKE::graph::` seam) and `vaultGraph.ts` (`upsertGraph` cross-doc dedup + degree; `expand` hop-capped tenant-scoped BFS over `bfsNeighbors`)
> Build history: `.planning/phases/05-knowledge-vault-graphrag/` · Related ADRs: [001](../decisions/001-convex-data-orchestration-plane.md), [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

A per-user **Knowledge Vault** with **GraphRAG** grounding (VALT-01..04). Briefs/documents are
stored, embedded, and entity/relationship-extracted at ingestion; requests can be grounded via
**hybrid vector + hop-capped graph retrieval** scoped to the requesting user; and the user can
browse, preview, search, and download their own vault contents through the committed brand UI
(`docs/design/brand/brand-024242.png` / `brand-024258.png`). Built on the installed
`@convex-dev/rag@0.7.5` (vector + hybrid search) + `@convex-dev/workflow` durable ingest + a
bespoke Convex graph plane (`graphNodes`/`graphEdges`), with domain logic in the pure-TS
`@pikar/vault` package.

## Key files

Pure packages:
- `packages/vault/src/normalize.ts` — `normalizeName` (case/whitespace collapse → cross-doc dedup key).
- `packages/vault/src/categories.ts` — `categoryFor(source, mimeType)` (→ one of 6 vault categories), `isSearchable(mimeType)` (Phase-5 searchable set TXT/MD/CSV), `VAULT_CATEGORIES` (the fixed-6 runtime tuple → the `vaultStats.categories` count + UI tabs).
- `packages/vault/src/traversal.ts` — `bfsNeighbors(adjacency, seeds, hopCap)` (pure hop-capped BFS, no Convex import).
- `packages/vault/src/fusion.ts` — `fuse(...)` vector-seed + graph-expand merge/dedupe/rank.
- `packages/vault/src/constants.ts` — `VAULT_FILE_CAP_BYTES` (100 MiB, docs/images), `VAULT_VIDEO_CAP_BYTES` (25 MB, the transcription-API ceiling), `GRAPH_HOP_CAP` (= 2).
- `packages/vault/src/index.ts` — re-exports the package surface.

Backend adapters (thin):
- `packages/backend/convex/vaultRag.ts` — the single `rag` construction site (05-02).
- `packages/backend/convex/vaultGraph.ts` — `upsertGraph` (cross-doc dedup on `(tenantId, type, normalizedName)` + degree bookkeeping) + `expand` (hop-capped tenant-scoped BFS delegating to `@pikar/vault` `bfsNeighbors`).
- `packages/backend/convex/vaultLlm.ts` — the DEFAULT-runtime (V8) `extractGraph` (NEVER a second `"use node"` module): registry prompt, `scanText` fail-closed BEFORE the model call, `generateObject` → `{nodes,edges,costUsd}`, `SMOKE::graph::` offline seam. Holds a temporary `getDocText` reader; `internal.vault.getDoc` (05-04) is the canonical richer reader the embed step uses.
- `packages/backend/convex/vaultRag.embedDoc` (05-04) — the ingest embed step: reads the doc via `internal.vault.getDoc`, `scanText` fail-closed BEFORE `rag.add`, hash-dedups on `(namespace=tenantId, key=contentHash)`, `SMOKE::` bypass (no network). Returns `{entryId, costUsd}`.
- `packages/backend/convex/vault.ts` (05-04/05-05) — the tenant ingest mutations (`vaultIngestText` paste/late-text seam + `vaultUpload` accept-but-defer, both hash-dedup), `deleteVaultDoc` cascade (row + rag chunks + graphEdges, orphan-node GC), the internal lifecycle (`getDoc`/`markReady`/`markFailed`), and (05-05) the READ plane: `listVaultDocs`/`vaultStats` (cheap, no vectors), `vaultDownloadUrl` (owner-only signed URL, bearer capability, never logged §4), `docEntities` (owner-guarded per-doc nodes/edges), `vaultSearch` (the `rag.search` hybrid primitive post-filtered to a category), and `ownedDocsMeta` (the tenant-scope resolve seam shared by grounding + search). SOLE starter of the ingest workflow.
- `packages/backend/convex/vaultIngest.ts` (05-04) — `ingestDoc = workflow.define(...)`: `preCall` gate (governed stop → `markFailed`, never a DLQ throw) → `embedDoc` → `extractGraph` → `upsertGraph` → `recordSpend` → `markReady`.
- `packages/backend/convex/vaultGround.ts` (05-05) — the standalone grounding action `vaultGround({query})`: `rag.search` hybrid seeds → map entries to `vaultDocuments` ids → hop-capped `internal.vaultGraph.expand` → `fuse` merge/dedupe/rank → one context block. `namespace=tenantId` + tenant-scoped expand = a different tenant's corpus never enters. `SMOKE::<docId,…>` offline seam resolves seeds through the tenant-scoped `ownedDocsMeta` (no embedding call). Cockpit/pipeline call-site DEFERRED (Lane A).

Phase gate (05-07):
- `apps/web/e2e/vault.spec.ts` — the Playwright browse/search/preview/delete loop (VALT-04) over the offline `SMOKE::graph::` ingest (paste → processing→ready → entity chips → delete). Under the shared e2e harness (also cockpit.md's watch); the live green run may defer to `/gsd:verify-work` (auth-harness precedent).
- `packages/backend/scripts/run-smoke-vault.mjs` + `packages/backend/convex/vaultSmoke.ts` — the live-deployment gate (VALT-01/03): REAL embed + hybrid `rag.search` + `vaultGround` graph-neighbor merge for tenant "smoke", refs-only §4 scan, failure-proof purge. Internal-only (the CLI has no identity), so every helper takes `tenantId` explicitly.

Frontend (05-06):
- `apps/web/app/(app)/dashboard/vault/` — the Knowledge Vault route + components (match the brand screenshots 1:1): `page.tsx` (composition + lifted category/selected state, Refresh re-subscribes via a `nonce` key), `VaultStats.tsx`, `CategoryTabs.tsx`, `Dropzone.tsx` (upload + Brain-Dump paste), `DocGrid.tsx` (search + N ITEMS + grid/list; exports `VaultDoc`/`fmtSize`), `PreviewModal.tsx` (in-place preview + `docEntities` + on-demand download + reactive delete), `icons.tsx` (inline SVGs, no icon library).

## Dependencies & blast radius

Run `graphify query "vault"` for the current subgraph. Couplings graphify cannot see:
- `@convex-dev/rag@0.7.5` (pinned, §6) — `namespace = tenantId` per-user isolation (VALT-03).
- `@convex-dev/workflow@0.4.4` (pinned, §6) — durable `store → embed → extract → ready` ingest.
- `convex/lib/functions.ts` tenant wrappers (§2), `convex/lib/hash.ts` `contentHash` dedup, `convex/guardrails.ts` + `@convex-dev/rate-limiter` + `packages/cost` (governance), `packages/pii` `scanText` (redaction).
- The `graph-extractor` registry skill (§5) — versioned skill row, no hardcoded prompt.

## Data flow

1. Ingest mutation writes a `vaultDocuments` row `status:'processing'` + stores text (raw content lives ONLY here + rag chunks — the tenant-scoped content plane, NOT the §4 honeypot).
2. `@convex-dev/workflow` runs `store → embed → extract → ready`: `pii.scanText` (fail-closed) → embed `safeText` via rag → `vaultLlm` graph-extractor emits typed entities/relationships → upsert `graphNodes`/`graphEdges`.
3. Grounding: `vaultGround({query})` → rag vector search (top-K seed chunks) → map to graph nodes → `bfsNeighbors` hop-capped expansion → `fuse` merge/dedupe/rank → one grounding context block.
4. Delete cascades: remove the row + rag chunks + `graphEdges` with `sourceDocId = doc`; nodes whose `degree` hits 0 are garbage-collected.

## Extraction lifecycle (Phase 3.8)

Binary uploads (PDF/image/Office/video/audio) get their text extracted server-side and fed into
the SAME ingest workflow TXT uploads ride. The Wave-0 contract (03.8-01) fixed these rules:

- **Status walk:** `pending_extraction → extracting → processing → ready | failed(+failureReason)`.
  The row stays `pending_extraction` at insert; the extraction ACTION flips it to `extracting`
  via `markExtracting` when work actually starts (honest pill). `processing` onward is the
  existing embed→graph half, unchanged.
- **The seam invariant:** an extraction action produces TEXT and calls
  `internal.vault.ingestExtractedText({docId, tenantId, text, truncated})` — it NEVER writes
  embeddings, rag entries, or graph rows itself. The seam patches text/hash/size, flips to
  `processing`, and starts `internal.vaultIngest.ingestDoc` (mirrors the public `vaultIngestText`
  docId path; internal because scheduler-invoked actions have no identity). Fail-closed tenant
  guard. Stores RAW extracted text (consistent with TXT uploads — the content plane holds the
  user's own data; downstream model paths re-scan).
- **Caps (from `@pikar/vault` `extractKind.ts`):** `VAULT_EXTRACT_CHAR_CAP = 400_000` chars
  stored via the seam (under Convex's ~1 MiB doc cap — pass `truncated: true` when it bites,
  which sets `extractionTruncated` for the UI's honesty note); `VAULT_EXTRACT_PAGE_CAP = 50`
  pages sent hosted for scanned PDFs; `MIN_CHARS_PER_PAGE = 25` garbage-text-layer threshold;
  `TRANSCRIBABLE_CONTAINER_MIME` = the containers the transcription endpoint accepts (NOT
  `video/quicktime` — unsupported containers `markFailed("unsupported_video_container")`).
- **Redact-then-audit ordering (§4):** `scanText` runs on the extracted output FAIL-CLOSED
  BEFORE any audit write (the intake.ts ordering); audit payloads carry refs/ids/counts ONLY
  (`vaultDocId`, `kind`, `path`, `piiCounts`, `charCount`, `truncated`) — never text.
- **Governance:** every extraction action opens with `internal.guardrails.preCall` (kill switch +
  daily budget); a governed stop is a RETURN + `markFailed(reason)`, never a throw/DLQ.
- **Bytes via storage, never args:** actions load bytes with `ctx.storage.get(storageId)`
  (resolved via `getDocForExtraction`) — node-action args cap at 5 MiB, vault files go up to
  100 MiB (video 25 MB), so bytes MUST travel through storage, never mutation/action args.

### Lane ownership (Phase 3.8)

Four parallel Wave-2 worktree lanes fill the Wave-0 stubs. Each lane appends its build notes
ONLY inside its own subsection below (keeps the Stop hook satisfied per-lane with no cross-lane
merge conflicts). See `.planning/PARALLELIZATION.md` for the branch/ownership table.

#### Lane 1 — PDF + images (`convex/vaultExtract.ts` + test)

SHIPPED (03.8-02, 2026-07-18). `extractDoc` is the real dispatcher: preCall gate (governed
stop = RETURN + `markFailed(reason)`) → `markExtracting` → bytes via `ctx.storage.get` →
`SMOKE::extract::` sniff (intake grammar; `PII_POISON::` routes scanText's own Err branch) →
dispatch by `extractionKindFor`: pdf = unpdf text-layer first (free, `path: "text_layer"`),
hosted gpt-4o-mini fallback when the `MIN_CHARS_PER_PAGE` garbage heuristic trips (sliced to
`VAULT_EXTRACT_PAGE_CAP` via pdf-lib `copyPages` first); image = hosted with the real
mediaType (extractVisual shape verbatim, attachment-extractor skill, priceUsage→recordSpend);
office = `@pikar/vault/officeText` subpath (its throw → `office_parse_failed` — Lane 2's merge
needs zero Lane-1 changes) → scanText FAIL-CLOSED before any audit write → refs/counts-only
audit (`vault.extracted` / `vault.extraction_failed`) → `VAULT_EXTRACT_CHAR_CAP` truncation →
`ingestExtractedText` seam (raw post-gate text). Whole body try/caught → `extract_error:` reason.

Lane-1 gotchas locked in by `vaultExtract.test.ts` (static scans + convex-test):
- **`Promise.withResolvers` polyfill sits before any unpdf usage** (Pitfall 1 — Convex node
  actions default to Node 20; only the deployed smoke can surface this).
- **pdf.js detaches the buffer it is handed** — `getDocumentProxy(bytes.slice())`, never the
  original, or the hosted-fallback slice reads a zeroed buffer (caught offline).
- Tests run under **fake timers** (the seam's `workflow.start` otherwise retry-loops against
  vitest's torn-down module runner for minutes on Windows) and use word-shaped truncation
  filler (a 400k unbroken alphanumeric run makes the pii email regex backtrack O(n²)).
- Hosted-branch selection is observed offline via the unseeded registry's fail-closed
  `NO_ACTIVE_SKILL` (no model call is ever attempted in tests).

#### Lane 2 — Office parsers (`packages/vault/src/officeText.ts` + test)

Wave-0 stub in place (throws `office_parse_not_implemented`). Lane 2 replaces the body: fflate
`unzipSync` + attribute-tolerant XML text-walk for DOCX/XLSX/PPTX (entity decode, sharedStrings
indirection, numeric slide sort). Pure TS, zero Convex edits, NOT on the index barrel.

**Landed (03.8-03, 2026-07-18):** `extractOfficeText(bytes, mimeType)` is real — one
`unzipSync` + one attribute-tolerant regex text-walk (`<tag ...>...</tag>`, Pitfall 7) shared by
all three formats; entities decoded (5 named + numeric dec/hex). DOCX: `word/document.xml`,
runs joined per `</w:p>` paragraph, newline-separated. XLSX: optional `xl/sharedStrings.xml`
`<t>` index, `t="s"` cells resolved / literal `<v>` kept, tab-joined rows, `Sheet N` headers,
numeric filename sort (sheet2 < sheet10). PPTX: `ppt/slides/slide*.xml` numeric sort, `Slide N`
headers, `<a:t>` runs newline-joined. Every failure throws `office_parse_failed: ...` (not a
zip / missing part / unrecognized mime) — the Lane-1 dispatcher converts to
`markFailed("office_parse_failed")`. Deterministic (asserted per format). All fixtures built
in-test with `zipSync`/`strToU8` — no binary fixtures in repo. Verify:
`pnpm --filter @pikar/vault test` + `tsc -p . --noEmit` (strict-index clean). Known ceiling
(`ponytail:` comment in source): a rich-text `<si>` with multiple runs indexes as multiple
sharedStrings entries; per-`<si>` grouping is the upgrade if real workbooks surface it.

#### Lane 3 — Sweep + UI + E2E (`convex/vaultSweep*.ts` + `apps/web/.../dashboard/vault/` + `apps/web/e2e/vault.spec.ts`)

No stub (new files are Lane 3's to create): migrations-based backlog sweep + `retryExtraction`
tenantMutation; DocGrid/PreviewModal `extracting` pill + Retry + truncation note; offline E2E.

LANDED (03.8-04, 2026-07-18): `vaultSweep.ts` — `sweepPendingExtraction`
(`migrations.define` over `vaultDocuments`: `pending_extraction` + `storageId` + recognized
`extractionKindFor(mimeType, title)` → kind-dispatched `scheduler.runAfter` onto the frozen
stub names; each scheduled action self-gates via `preCall`, so the sweep needs no separate
rate-limit config), `runSweep` operator one-shot (`npx convex run vaultSweep:runSweep` — the
production run is 03.8-06's job post-merge), and `retryExtraction` (tenantMutation: owner +
`failed|pending_extraction` + storageId + kind guards, clears `failureReason` +
`extractionTruncated`, re-schedules by kind, refs-only `{ok}` return). `vaultSweep.test.ts`
(10 cases) drives the migration directly in its documented one-batch mode
(`{cursor: null, oneBatchOnly: true}` — no component round-trip) and asserts scheduled names
off `_scheduled_functions`. UI: `DocGrid` gained the `extracting` chip + a failed-card Retry
rendered as a SIBLING button in a relative wrapper (never nested inside the card button —
invalid HTML); `PreviewModal` gained the failed panel (human-readable `failureReason` +
Retry) + the `extractionTruncated` honesty note (calm, no amber — §2) + extracting preview
copy; `page.tsx` resolves the LIVE row for the modal so a panel Retry flips reactively;
`Dropzone` copy is honest again (PPTX searchable; images/videos extracted + searchable).
`vault.spec.ts` gained the two EXTR-H SMOKE:: upload rows (`SMOKE::extract::` pdf +
`SMOKE::transcribe::` mp4, sentinel bytes chaining into the `SMOKE::graph::` ingest seam)
with a self-cleaning skip-guard while the Wave-0 stubs return `not_implemented` — remove the
guard at 03.8-06 integration.

#### Lane 4 — Video transcription (`convex/vaultTranscribe.ts` + test)

Wave-0 stub in place (`transcribeDoc` → `markFailed("not_implemented")`). Lane 4 replaces the
body: preCall → markExtracting → load bytes → SMOKE::transcribe:: sniff →
`TRANSCRIBABLE_CONTAINER_MIME` check (honest failure on e.g. `.mov`) → `experimental_transcribe`
(intake shape, duration-priced spend) → scan gate → refs-only audit → seam. No skill, no dep.

**Built (03.8-05, 2026-07-18):** `transcribeDoc` is live — the full spine above, structured as
one `internalAction` with a terminal catch-all (`markFailed("transcribe_failed")`, static
refs-only reason). Invariants proven offline by `vaultTranscribe.test.ts` (6 sentinel tests, no
video fixtures): the `SMOKE::transcribe::` walk to `processing` via `ingestExtractedText`;
`audio/*` rides the same spine; `VAULT_EXTRACT_CHAR_CAP` truncation with `truncated: true`
through the seam; mime-only `video/quicktime` rejection (`unsupported_video_container`) before
any byte/API work; kill switch as a RETURN (`failed`/`kill_switch`, no throw); `scanText` Err →
`pii_scan_failed` + exactly ONE refs-only `vault.extraction_failed` audit row. Success audit
`vault.extracted` carries `{ vaultDocId, kind: "video", durationSeconds, charCount, truncated }`
— counts only, needle-scanned in-test for transcript absence (§4). The transcription call is a
COPY of intake.ts's `transcribeAudio` shape (never an import — §96 "use node" rule). Duration
ceiling is deliberate (`ponytail:` comment): the 25 MB video cap (`VAULT_VIDEO_CAP_BYTES`) sits at
the API's 25 MB limit and is enforced at upload, so every video that enters fits the API; audio
extraction/chunking is the upgrade path for >25 MB video. Known shared-code ceiling found during this lane:
`@pikar/pii` `scanText` is quadratic on long UNBROKEN uniform character runs (~6 min at 400k
chars; natural-language text of the same size scans in ~10ms) — logged in the phase's
`deferred-items.md`, not fixed here (out of lane).

## Invariants — what must never break

- **Domain logic in `@pikar/vault`, thin `convex/vault*` adapters (§1)** — the pure package has ZERO Convex imports; enforced by the colocated `packages/vault` tests running with no backend.
- **`namespace = tenantId` per-user isolation (VALT-03)** — every rag `add/search/delete` is namespaced by the tenant; reads/writes go through the `tenantQuery/tenantMutation/tenantAction` wrappers.
- **rag runtime split** — `rag.add/search/delete` are ACTION-only; `addAsync/deleteAsync/list/getEntry/findEntryByContentHash` are mutation/query-safe.
- **The graph-extractor lives in a DEFAULT-runtime (V8) `vaultLlm.ts`** — NEVER a second `"use node"` module.
- **Redact-then-extract (§4)** — the extractor receives `safeText`; graph/audit/deadLetter payloads carry refs + hashes + counts ONLY. Raw text lives ONLY in `vaultDocuments.text` + rag chunks.
- **Cross-doc dedup** — same entity across docs upserts to ONE node on `(tenantId, type, normalizedName)` via `normalizeName`, so the graph actually connects documents.
- **Hop cap = 2 (`GRAPH_HOP_CAP`)** — `bfsNeighbors` never expands past the cap; enforced by `traversal.test.ts`.
- **Pinned `rag`/`workflow` versions must not be bumped (§6)** — pre-1.0 API churn.

## How to change safely

- **New graph traversal / fusion behavior** → change `@pikar/vault`, add a colocated test, keep it Convex-free. The Convex `vaultGraph.expand` query builds the adjacency and calls `bfsNeighbors`; `vaultGround` calls `fuse`.
- **New category / searchable format** → edit `categories.ts` + its test; do NOT scatter category strings into adapters.
- **New ingest step** → add a durable workflow step; keep the redact-before-LLM ordering.
- **Schema change** → new tables / optional fields, no migration (prior-phase discipline).

## How to verify

- `pnpm --filter @pikar/vault test` — pure-domain tests (normalize, categories, traversal, fusion).
- `pnpm --filter @pikar/vault typecheck` — clean.
- `pnpm --filter @pikar/backend test vault vaultGround` — the Convex adapter tests: ingest/dedup/cascade + the read plane (grounding fusion, hop-cap, cross-tenant isolation, browse/stats/download-guard/docEntities/category-search). Windows note: convex-test files crash on parallel-fork teardown ("Cannot set properties of undefined (setting 'exit')") → false red; each file passes run alone.
- `pnpm --filter @pikar/backend smoke:vault` — the live-deployment gate (VALT-01/03): REAL embed + hybrid search + `vaultGround` graph-neighbor merge on a running `convex dev` deployment (needs its OPENAI_API_KEY).
- `pnpm --filter @pikar/web exec playwright test vault --list` — the vault E2E is Playwright-discovered + type-loads; a full green run needs the running local stack + the auth harness (may defer to verify-work).

## Operational notes

- Embedding model `text-embedding-3-small` @ 1536 dims (under Convex's 2048 cap).
- **RAG needs a v2-spec embedding model.** `@convex-dev/rag@0.7.5` bundles ai@6, whose `embedMany` accepts ONLY an `EmbeddingModelV2` (`specificationVersion: "v2"`). The backend's `@ai-sdk/openai@4` produces a spec-**"v4"** model (correct for ai@7 / `llm.ts`), which RAG REJECTS at ingest time with `AI_UnsupportedModelVersionError` — a runtime skew a `as unknown as` type-cast silences but does NOT fix. `vaultRag.ts` therefore hands RAG a hand-rolled v2 adapter (`openaiEmbeddingV2`) that calls OpenAI's `/v1/embeddings` REST API directly. NEVER pass `openai.embedding(...)` straight into the RAG constructor (guarded by the `vaultRedaction.test.ts` v2-spec static scan). Drop the adapter when the pinned RAG realigns to ai@7 (§6).
- Ingest requires the `graph-extractor` skill SEEDED in the deployment (`skills:seedSkills`) — an unseeded deployment fails the extract step with `NO_ACTIVE_SKILL: graph-extractor` (a seeding step, not a code defect; runs at boot).
- **Video transcription uses `whisper-1`, NOT `gpt-4o-transcribe`.** gpt-4o-transcribe rejects video-container mp4 (`AI_APICallError: This model does not support the format you provided` — it wants audio-only input); whisper-1 demuxes the audio track from mp4/webm/mpeg. Both bill at `TRANSCRIPTION_PRICING` (0.006/min). `intake.ts` (voice/mic audio — webm/wav) stays on gpt-4o-transcribe on purpose: its inputs are audio, where gpt-4o-transcribe is both supported and more accurate. The `transcribeDoc` terminal catch-all `console.error`s the API error message (refs-safe) so a `transcribe_failed` is diagnosable in the function log; the `failureReason`/audit stay refs-only (§4).
- Per-file cap is per-kind: `VAULT_FILE_CAP_BYTES` (100 MiB) for docs/images, `VAULT_VIDEO_CAP_BYTES`
  (25 MB) for video (the transcription-API ceiling). Enforced at the `vaultUpload` chokepoint AND
  mirrored client-side in `Dropzone.tsx` for a fast pre-upload message. No per-tenant total quota
  this phase (single-owner beta).
- Phase-5 wires TXT/MD/CSV + Brain Dumps end-to-end; PDF/DOCX/XLSX/PPTX/Images are accept-but-defer (stored + `pending extraction`), their text arriving via the `vaultIngestText` seam when Phase 4 lands.

## Known gaps & deferred work

- The `vaultGround` cockpit/pipeline call-site is deferred (Lane A integration phase).
- **Video > 25 MB** is rejected at upload (the transcription API's hard 25 MB limit). Supporting
  larger video needs an audio-extract/compress (or chunk) step before transcription — deferred.
- **Large-doc extraction memory/time** — the 100 MiB doc cap lets a very large PDF reach the
  extraction action; `unpdf`/OCR on such a file may approach Convex action memory/time limits. The
  page cap (`VAULT_EXTRACT_PAGE_CAP`) and char cap bound the hosted-OCR path, but streaming/chunked
  extraction is the upgrade path if large scanned PDFs surface limits.
- Binary + OCR extraction is Lane B / Phase 4 (`vaultIngestText(docId, extractedText)` seam).
- Per-tenant storage quota, external sharing, per-item agent toggle, in-place re-embed editing — all deferred.
