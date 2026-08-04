# Playbook: Knowledge Vault & GraphRAG

> Last verified: 2026-08-04 (15.4-03 — **connected Nord Edge preview and import surfaces with
> governed controls intact.**) `PreviewModal` still loads `vaultDocText`, `docEntities` and media
> URLs lazily, mints a fresh signed URL only when Download is pressed, and writes identity through
> `setDocIdentity`. Removal is now a two-step presenter state: the destructive `deleteVaultDoc`
> adapter is absent until the user opens the explicit irreversible-action confirmation.
>
> **Preview state matrix:** ready extracted text, expandable long text, server-truncated extraction,
> ready image/video, unsupported/no-inline-preview, missing stored bytes, lazy loading, each
> processing stage and extraction failure are explicit pure states. A missing/foreign projection
> fails closed with no identity, citation, download, delete, retry or voice capability. Failure
> retains the reason-specific copy and retry; ready text and binary documents retain Download when
> `storageId` exists, provenance/entities, workspace navigation and identity correction.
>
> **Dialog and import invariants:** the labelled modal traps Tab, closes on Escape/backdrop/X,
> locks background scroll and restores the invoking grid control on unmount. Upload, directory
> pre-flight and the custom Drive breadcrumb browser use the existing Plan-02 Vault-scoped tokens.
> Do not replace the Drive browser with Google's Picker SDK, and do not reorder folder pricing:
> estimate from the pick, upload sequentially, then reserve using the original manifest; Drive
> remains scope-check → enumerate metadata → reserve → download.
>
> **Focused verification:** `pnpm --filter @pikar/web test -- vault` (43/43),
> `pnpm --filter @pikar/web typecheck`, `pnpm --filter @pikar/web build`, then
> `node scripts/check-playbooks.mjs`. `PreviewControls.test.ts` deliberately uses
> `React.createElement` plus `renderToStaticMarkup`: the web Vitest include remains `.test.ts`-only,
> with no DOM dependency or shared runner widening.
>
> **Rollback:** revert the three 15.4-03 task commits together. No schema, stored-document,
> dependency, Drive scope, budget/reservation or backend rollback is required.

> Last verified: 2026-08-04 (15.4-02 — **connected Nord Edge root/folder browse with honest
> state handling and retained real actions.**) `/dashboard/vault` now uses a Vault-scoped plain
> canvas, paper cards, semantic stat accents, responsive category/action rails and explicit
> focus/disabled/reduced-motion states. The global `.pane-canvas` and `.clay-card` contracts were
> not changed; every visual override is below `.vault-nord-edge` or uses a `vault-*` class.
>
> **Browse state matrix:** initial list loading, list failure, root empty, category empty, folder
> empty, search loading, search failure and no search results are separate content states.
> Processing/failed members are an independent partial-ingest axis, and unincorporated folder
> members independently produce a stale-digest state, so warnings remain visible beside content.
>
> **Retained live controls:** single-file upload, folder upload, Google Drive browse/import, folder
> open/cancel, failed-document retry, digest rebuild, Refresh, preview and load-bound copy remain
> connected to the existing handlers. Folder search sends `folderId`; its request identity also
> includes the folder so an older folder/query response cannot repaint the current scope. Category
> tabs intentionally carry no counts because the backend exposes only bounded root statistics.
>
> **Focused verification:** `pnpm --filter @pikar/web test -- vault` (28/28),
> `pnpm --filter @pikar/web typecheck`, `pnpm --filter @pikar/web build`, then
> `node scripts/check-playbooks.mjs`. The retained-controls test is
> `VaultBrowseControls.test.ts` (not `.tsx`) because the web Vitest include is intentionally
> `.ts`-only; it uses `React.createElement` and `renderToStaticMarkup` with no new DOM dependency.
>
> **Rollback:** revert the 15.4-02 UI composition and scoped-style commits together. No schema,
> stored-document, dependency or backend rollback is required; the Phase 15.4-01 optional
> `folderId` search contract remains backward-compatible for older callers.

> Last verified: 2026-08-04 (15.4-01 — **Vault search now honors the folder being browsed without
> changing root search or the schema.**) `vaultSearch` accepts an optional `folderId`; its bounded
> hybrid candidates resolve through search-only metadata, then pass tenant ownership, ingesting-folder
> sealing, folder equality and optional category intersection before the public refs-only projection.
> A foreign and a missing folder ID both return `[]`, so the widened contract is not an ownership
> oracle. Omitting `folderId` preserves tenant-wide root search and candidate order.
>
> **Public shape and shared-resolver invariant:** results remain exactly `{ _id, title, category }` —
> never `text`, `tenantId`, content hashes, filenames or resolver-only `folderId`. Grounding's shared
> `ownedDocsMeta` resolver is unchanged because its order is index-parallel with title arrays.
>
> **Focused verification:**
> `pnpm --filter @pikar/backend test -- vault.test.ts vaultFolders.test.ts vaultSealing.test.ts`
> (61/61). Mutation proof: deleting only `d.folderId === folderId` returned folder B from a folder-A
> search and made the same-tenant cross-folder test red. Backend typecheck and
> `node scripts/check-playbooks.mjs` are the static gates.
>
> **Rollback:** revert the 15.4-01 search implementation and regression-test commits together. No
> migration, backfill, index or stored-document rollback is required; callers that omit `folderId`
> retain the prior contract throughout.

> Last verified: 2026-08-05 (15.3-09 follow-up 2 — **THE PICKER NOW SHOWS THE FILES, from the SAME
> single request.**)
>
> The folder-only browse threw away exactly the information the user needs to choose: there was no
> way to tell an empty folder from one holding 200 documents until you pressed Import and were told
> `empty_folder`. Two real folders were probed that way during the live run before this landed. The
> fix is CHEAPER than what it replaces — drop the `mimeType='...folder'` filter, keep ONE
> `files.list` per level, and split folders from files server-side.
>
> Files are SHOWN, never clickable: the unit of import is the folder, so a pressable file row would
> promise a selection this rail does not have. Each file carries a `readable` verdict from
> `classifyOne` — **the SAME function the import runs**, extracted from `classify` for this reuse.
> That is what stops the picker and the import from disagreeing, and a test pins `classifyOne` at
> three-plus call sites so growing a second copy goes red.
>
> **⚠ THE COUNT IS THE LEVEL; THE IMPORT IS THE TREE.** Enumeration recurses, so the copy reads
> "N files here, plus everything inside M subfolders — importing takes all of it". Print the count
> alone beside that button and it is a quiet lie.
>
> **⚠ THE MUTATION THAT CAUGHT THE TEST, AND THE RULE IT LEAVES.** Restoring the folder-only filter
> left all 13 tests GREEN. A stub answers with whatever it was told to answer, so asserting on the
> RESPONSE cannot see a query that changed — the split is client-side and the fixture was unchanged.
> The test now reads the `q` parameter off `fetchSpy.mock.calls` and asserts the folder filter is
> absent. **When a stubbed test covers behaviour that lives in the REQUEST, assert on the request.**
> Same class as the shared-drive params, which is why those are a source scan rather than a stub.

> Last verified: 2026-08-05 (15.3-09 follow-up — **WE RENDER THE DRIVE PICKER OURSELVES, and the
> link-paste entry point is DELETED.**)
>
> The first cut shipped a "paste a Drive folder link" field. That was the wrong kind of lazy: if the
> user has to open Drive, navigate to the folder and copy its URL, they are already in Drive and may
> as well download the files and drag them in. The integration only earns its place if the folders
> are reachable from inside the vault. `DriveBrowser.tsx` replaces it — a breadcrumb plus a list, one
> level at a time, backed by `vaultDrive.listDriveFolders`.
>
> **WHY WE DO NOT MOUNT GOOGLE'S PICKER SDK, and why that is not a compromise.** The Picker exists to
> make the NARROW `drive.file` scope usable: that scope grants access only to files the user hands
> over through the Picker itself. We took `drive.readonly`, so we can ask `files.list` for the
> folders directly and draw them with our own tokens. Mounting Google's would mean an external
> `apis.google.com` script plus an API key and an app id, for a list we can already read — a CSP
> hole and a third-party dependency bought for nothing. **The scope choice is what made the picker
> cheap; do not "restore" the Picker without re-opening the scope decision first.**
>
> **⚠ THE ROOT LEVEL IS THREE LISTS, NOT ONE, and this is the bug waiting for the next editor.**
> Drive has three separate places a folder can live and `'root' in parents` sees exactly one of
> them: a folder shared WITH you is not in your root, and a shared drive is not a file at all — it is
> unreachable through `files.list` under any query, which is why `drives.list` has its own endpoint
> and its own URL builder (`drivesUrl`, deliberately WITHOUT the shared-drive params, because a
> `drives` endpoint has no items to include). Collapse those three calls into one and a user whose
> company runs on a shared drive is told they have no folders. `drives.list` 403s on a personal
> Google account, which is an ordinary shape of this feature and degrades to an empty list, never to
> an error.
>
> `listDriveFolders` repeats the import's ordering exactly — scope check → `reauth` BEFORE
> `freshAccessToken` — and `dispatchGuard.test.ts` now loops over BOTH actions rather than pinning
> the import alone. That matters more here than there: the browse is what a pre-widening tenant hits
> FIRST, so getting the ordering right only in the import would have put the 403 on the very first
> click. Mutation RUN on `listDriveFolders` specifically → RED.
>
> A browse level is deliberately ONE page of 100 folders with no pagination: a level is a human
> reading a list, and 100 folders in one directory is already past what anyone scans. ponytail
> ceiling, stated — upgrade is a "load more" and a `pageToken`.
>
> **LIVE-VERIFIED 2026-08-05** against a real Google account: the root listed ten real folders, and
> drilling into `ISO9001-QMS` returned its real subfolders with the breadcrumb and the armed
> `Import "ISO9001-QMS"` button. **STILL UNPROVEN: the shared-drive half.** That account surfaced no
> shared drives, so `drives.list` returned nothing to render and the `supportsAllDrives` /
> `includeItemsFromAllDrives` parameters — the ones the source scan exists to protect — have still
> never been exercised against a real shared drive.

> Last verified: 2026-08-04 (15.3-09 — **the Google Drive rail lands, and a refused folder now
> refuses before it downloads anything.**) `convex/vaultDrive.ts` imports a Drive folder as an
> ordinary vault folder over the EXISTING Google grant — no new secret, no new HTTP route, no second
> token table. The reservation is taken from `files.list` METADATA, before any byte is exported, so
> refuse-intact is proven by absence rather than asserted. Two locked decisions were corrected on
> facts: the per-file byte cap DOES apply (non-native files download into a ~512 MB action), and
> Drive does not report `size` for Google-native docs (`estimatedBytesFor` never returns 0 — the one
> check keeping the reservation invariant true on this rail). The shared-drive parameters are the
> detail to protect: omit either and Drive answers 200 with an empty file list, which reads as
> "imported 0 files, folder complete". `vaultFolders.tryComplete` is now exported for the Drive
> fan-in's reuse. Full detail, the deviations and the five mutations RUN: the `### 15.3-09` section
> below. **NO LIVE RUN YET** — every Drive response in the suite is a stub.

> Last verified: 2026-08-04 (test-infrastructure, owner-directed — **two standing gaps closed.**
> (1) **`apps/web` HAS A TEST RUNNER AT LAST**, so a test file placed there is no longer
> decoration; `preflightCopy.test.ts` moved back beside its module and the cross-package
> behavioural import is gone from `vaultSurface.test.ts`. (2) **The `crypto is not defined` flake
> is FIXED, and it was never an environment problem:** `vault.test.ts` started 20 ingest workflows
> and mocked only the ingest pool, so the WORKFLOW component's scheduled runs escaped the file and
> retry-looped inside whichever file ran next — which is why the victim was always the innocent
> `onboarding.test.ts`, and why neither serialising nor switching pool helped. 3-in-8 failures ->
> 0 in 8. See *the flake* below for the two rules it leaves behind.)

> Last verified: 2026-08-04 (15.3-08 verify pass — **three defects, and the sharpest one is that
> `identityLine` was the ONE field passed RAW from the model.** `docType` was coerced through
> `isDocType`; `identityLine` was not, and the AI SDK's `jsonSchema()` without a `validate` fn does
> not check the model object at runtime — so a missing or non-string value sailed through into
> `applyClassification`'s `v.string()`, which throws INSIDE `step.runMutation`, OUTSIDE
> `classifyDoc`'s try/catch. That fails the whole document: exactly the rule the try/catch exists
> to keep, broken by the one field nobody coerced. Also fixed: `PreviewModal`'s seed guard was a
> BOOLEAN on a modal rendered without a `key`, so switching documents kept the previous one's
> identity in the form and Save would write A's identity onto B; and a still-`processing` row that
> had already been classified seeded an EMPTY form, whose Save then blanked and permanently locked
> it. See *the verify pass* in `### 15.3-08`.)

> Last verified: 2026-08-03 (15.3-08 — **every document now carries a machine-derived `docType`
> and a human-readable identity line, and a user-set one is never overwritten.** ONE classify step
> at the single ingest convergence point, so single-file uploads are classified too — not only
> folder members. Three facts that read backwards if you skim: `classifyDoc` is the one action in
> this codebase that **NEVER THROWS** — `getActiveSkill` is fail-closed by contract everywhere
> else, and here it must not be, because the fallback is a degraded LABEL and not a degraded
> grounding corpus; the offline gate is the bare `SMOKE::`, **not** `SMOKE::classify::`, and
> narrowing it to the classify prefix is a real-money leak on every existing fixture; and the
> user-set guarantee is an **ABSENCE** — no branch anywhere writes over `identityUserSet === true`.
> See `### 15.3-08` at the END of this file.)

> Last verified: 2026-08-03 (15.3-07 verify pass — **the surface shipped green with FOUR major
> defects, and the theme is that `apps/web` HAS NO TEST RUNNER.** (1) A `preflightCopy.test.ts`
> sat next to the module executing nowhere — no `test` script, no vitest dep, no config — so the
> plan's "only observable check of the must-name-numbers rule" was dead text that READ as
> coverage. (2) The estimate/reserve parity the plan's own <verification> block names was
> asserted by nothing. (3) The Start loop awaited `reserveFolder` OUTSIDE any try/catch in a
> fire-and-forget handler, so one dropped socket froze the panel forever with members parked at
> `pending_extraction` under a folder no sweep will touch. (4) Per-file failures were accumulated
> and then discarded on the partial-success path. All four fixed and now mutation-verified. See
> *the verify pass* in `### 15.3-07`.)

> Last verified: 2026-08-03 (15.3-07 — **the folder surface: picking, the always-on inline
> pre-flight, the refusal that names both numbers, sealed progress, drill-in, and the stale-digest
> rebuild.** Three facts that are one edit away from silent breakage: every atom a user would be
> angry to lose (`currentFolderId`, `picked`, `phase`) lives in `VaultPage`, because `nonce` is
> `VaultBody`'s remount KEY and a remount destroys — not re-renders — everything below it;
> `reserveFolder` gets `picked.manifest` VERBATIM AND UNFILTERED, which is the whole of
> estimate/reserve parity; and naming both figures in the refusal is the DEFAULT branch with a
> three-reason deny-list, not a per-reason opt-in. The pre-flight is an INLINE panel, not a modal,
> and that is an a11y decision — this app has no shared dialog pattern to inherit. Zero amber
> anywhere (BRAND §2). See `### 15.3-07` at the END of this file.)

> Last verified: 2026-08-03 (15.3-06 verify pass — **three defects found AFTER the suite was green,
> all three the same root cause: the digest has no `folderId`, so it is invisible to every
> mechanism that finds work by folder membership.** (1) `folderDigestState`'s staleness read bounded
> ROWS but not BYTES and could throw the drill-in page; it now streams like `readVaultPage`.
> (2) `cancelFolder` left the digest alive and unreachable — it now dies with its folder.
> (3) A budget refusal was completely silent — it now writes one refs-only audit row. Plus the
> digest's own re-ingest was charging the COCKPIT token rail. See *the verify pass* in
> `### 15.3-06`.)

> Last verified: 2026-08-03 (15.3-06 — **the folder digest is a vault document, and it grounds
> ONLY because its insert calls `startIngest`.** `origin: "folder_digest"` is INERT — there is no
> origin predicate anywhere in retrieval, so the observable check is `ragEntryId != null`, never
> the literal. The digest carries NO `folderId` (the recursion guard), and staleness is a set
> difference bounded by the folder's OWN `memberCount`, never the global 100-row drift cap. See
> `### 15.3-06` at the END of this file. Proven by `convex/vaultDigest.test.ts` — 9 tests, EIGHT
> mutations actually run RED, including the one that leaves every origin-literal assertion green. THREE of those nine came from an ADVERSARIAL PASS after the first cut was already green — see *the verify pass* at the end of the section; all three are consequences of the same correct design decision.)

> Last verified: 2026-08-03 (15.3-05 — **sealing: a folder's members are excluded from retrieval
> until the folder is `complete` — at THREE sites, not one.** One predicate (`vaultFolders.sealedIn`)
> applied to grounding seeds AND graph neighbours, to the browse search box, and to the blueprint
> drift count. See `### 15.3-05` at the END of this file — in particular why a MISSING folder row
> means folder-less rather than sealed, which is one word away from sealing every cancelled
> folder's documents forever.)

> Last verified: 2026-08-03 (15.3-04 repair — **an empty manifest could price a folder at 0 cents and walk past the budget wall.** `reserveFolder` now refuses a manifest shorter than `memberCount` (`manifest_short`): dedup only ever REMOVES files, so a real manifest can never be shorter than the folder it describes. The sweep rails were the other half — `sweepPendingExtraction` and `retryExtraction` now both route through one `ingestRailFor` helper, so only an `ingesting` folder spends the pre-paid rail and a `reserving` folder is skipped entirely rather than dispatched against a reservation that does not exist yet.)
>
> Last verified: 2026-08-03 (15.3-04 — **folder ingest is orchestrated: a named pool, a
> work-start watchdog, counter-based completion, and a cancel that writes no document rows.**
> Extraction left the raw scheduler for `vaultIngestPool`; the 15-minute stall clock now starts
> when work starts, not when it is queued. See `### 15.3-04` at the END of this file — in
> particular why `pool.cancelAll` is NOT used, which is the one place the plan text and the
> shipped component disagree.)

> Last verified: 2026-08-03 (15.3-03 — **folder ingest no longer spends the cockpit's budget.**
> An OPTIONAL `rail`/`reserved` selector is threaded from `startIngest` and `scheduleExtraction`
> to all six ingest spend sites; reserved folder work checks the KILL SWITCH ONLY. Single-file
> uploads are unchanged. See `### 15.3-03` at the END of this file.)

> Last verified: 2026-08-03 (15.3-02 — **the vault read plane is bounded and projected, and the
> size cap is declared in ONE place.** `listVaultDocs`/`vaultStats` stopped `.collect()`ing the
> tenant partition with every `text` blob attached; the per-file cap is 200 MB and no longer
> re-typed in five places. **This is the first change in this phase a user can SEE.** See
> `### 15.3-02` at the END of this file.)

> Last verified: 2026-08-03 (15.3-01 — **the vault schema is now folder-aware, and every byte of
> it is inert.** `vaultFolders` + six optional `vaultDocuments` fields + two indexes + the
> `folder_digest` origin literal landed as a PURE WIDENING: no behaviour, no backfill, no
> migration, no test result changed. See `## Phase 15.3 — vault folders` at the END of this file
> — in particular the INERT-LITERAL warning, which is the single most misreadable fact in the
> phase.)

> Last verified: 2026-08-02 (18-07 — **agent-authored documents carry provenance in the grid, and
> the vault-search ceiling on them is REAL.** Documenting shipped surface that landed WITHOUT a
> playbook bump; `check-playbooks` was green only because a foreign lane had bumped this file.)
>
> **The `AGENT` chip** (`DocGrid.tsx:101`, rendered at `:340`) is gated on `doc.origin !== undefined`
> — deliberately a PRESENCE test, not an equality test, so `agent_promoted` keeps its provenance too
> (`:88`). Teal lives in the chip FILL with the label on `--ink`, per BRAND §6 — see `cockpit.md`
> for why the in-file `ConfChip` precedent was NOT followed.
>
> ⚠ **KNOWN CEILING, annotated at the site (`DocGrid.tsx:148`): agent-CREATED documents BROWSE but
> are NOT RETRIEVABLE.** `listVaultDocs` has no kind/status/origin filter, so they appear in the grid
> for free. They will NEVER match `vault.vaultSearch` — same rag primitive — because they are
> deliberately never ingested. **That absence IS the retrieval exclusion**, not an oversight.
>
> **Do NOT close this by ingesting them.** The upgrade path, if it is ever wanted, is a ~3-line
> title-substring fallback unioned into `hitIds` right at that site. Whether to take it is an OPEN
> OWNER QUESTION parked at 18-09’s gate — ingesting agent-authored text would put model output back
> into the retrieval corpus that grounds the model, which is the loop this exclusion exists to break.
>
> Related, and the same principle one plane over: 16-09’s floor refuses to write a `web_research`
> document at all when `webSearchCalls === 0`, because a never-searched answer must not become
> retrievable. See `cockpit.md`. The `startIngest` call-site count in `vault.ts` remains the counted
> exclusion invariant at **5** — `onboarding:__seedOnboardedTenant` was written to avoid becoming a
> sixth.
>
> Last verified: 2026-08-02 (22.1-03 — ⚠ **date bumped for a BEHAVIOUR-FREE sweep; the
> subsystem below was NOT re-verified.**) The dead-directive sweep (`72dd652`) deleted one line
> — `// @ts-expect-error import.meta.glob …` — from watched test files (vaultExtract.test.ts, vaultSweep.test.ts, vaultTranscribe.test.ts).
> It suppressed nothing: `tsconfig.json` includes `vitest.config.mts`, which pulls Vite's global
> types in, so TypeScript reported all 100 occurrences as TS2578 *unused directive*. Deletions
> only, zero additions, no assertion, invariant or product line touched anywhere. Backend
> typecheck 150 → 50; full suite 54/54.
> **Re-verified 2026-08-02** (a later session, closing the ⚠ above for THIS subsystem): vaultExtract.test.ts + vaultSweep.test.ts + vaultTranscribe.test.ts run green under vitest as part of a 10-file, 212/212 pass. The sweep's claim of behaviour-freedom now has evidence here, not just a typecheck delta.
>
> Last verified: 2026-08-01 (22.1-02 — per-tenant budget keying). The spend rail is now TWO windows (`guardrails.ts`): `dailySpendCents` keyed PER TENANT (`{ key: tenantId }` on every check/limit/getValue) and `deploymentSpendCents`, a deliberately KEYLESS ceiling. `prepare`/`preCall` check both — tenant first, so a tenant that is personally out is told so rather than blamed for a global pause — and `recordSpend` consumes both. Two distinct refusals now exist: `daily_budget_exhausted` (this tenant is done today) and `deployment_budget_exhausted` (everyone is paused). For THIS subsystem: `extractDoc` → `extractPdf` → `extractHosted` now thread a `tenantId` (both were private helpers with no tenant in scope), as do `vaultIngest.ingestDoc` and `vaultTranscribe.transcribeDoc`. **15.2-06's per-page fan-out guard still stands** — its static-scan regexes in `vaultExtract.test.ts` were widened for the inserted parameter, NOT relaxed: the hosted call must still receive `pages[...]`, never the sliced whole document. `failureCopy.ts` gained a `deployment_budget_exhausted` entry mapping to the same PAUSED copy. Consequence worth knowing: a large fan-out extraction now bills ONE tenant's rail, so a big upload can exhaust that tenant's day — previously it drained everyone's.
>
> PRIOR 2026-07-30 (26) — **THE CONFIRMED BLUEPRINT IS A DELIBERATE NON-INGESTED VAULT DOCUMENT.** Phase 17.1 plan 08 writes one `business_blueprint` row directly at `ready`, patches it in place on re-confirm, and starts no ingest workflow. It is never embedded or graph-extracted; a byte-less `ready` row is outside the extraction sweep. See the Phase 17.1 section and the explicit ingest-invariant exception below.
>
> Last verified: 2026-07-30 (25) — **THE BLUEPRINT SPINE IS STANDING CONTEXT, NEVER A SEARCH
> RESULT.** Phase 17.1 plan 07 adds it as the fourth `vaultGroundHydrated` field, outside the three
> parallel retrieval arrays and outside `TOTAL_CHAR_CAP`; see `## Phase 17.1 — two-seam blueprint
> grounding` at the end of this playbook.
>
> PRIOR (24) — **THE LAST LEGACY-XLS DATE CEILING IS CLOSED WITH A REAL
> EXCEL-AUTHORED BIFF FILE.** `Zainab_Blowing_Operators_KPIs_Feb_2026.xls` has the OLE2 signature,
> 31 numeric date cells, raw serial `46232`, and Excel's
> `[$-F800]dddd\,\ mmmm\ dd\,\ yyyy` number-format record. The production `xlsText` path emitted
> *"Wednesday, July 29, 2026"* **31 times** and `46232` **zero times**, across 346,692 extracted
> characters. The prior `46067` result remains true only for the SheetJS-written test fixture,
> whose BIFF writer omits the format record. No parser change and no binary fixture were needed.
>
> PRIOR (23) — **A NEW DOCUMENT CLASS LANDS IN THE VAULT: `kind: "web_research"`,
> written by the DISPATCHER (`convex/research.ts` ← `dispatch.runResearch`), never by the specialist
> that produced the prose.** One row per successful research run, through the SOLE legal starter
> (`startIngest`), carrying the D7 freshness stamp as a stored `retrievedAt` number. The stored text
> is **provenance header → 16-03's `<research_findings …>` fence → limits footer**, and the
> zero-source *"insufficient evidence"* verdict is decided by CODE, not by the model's prose. Read
> `### Phase 16 — 16-07` for the containment boundary this class actually has (per-CHUNK containment
> is `searchVault`'s outer fence; the header and inner fence only ride the FIRST chunk) and for what
> a persist failure does and does not cost.
>
> PRIOR (22) — **THE FALSE-READY FAMILY IS CLOSED, and a KPI deck now reads the
> numbers in its CHARTS.** `officeText.ts`'s `Sheet N` / `Slide N` headers were emitted
> unconditionally, so 100%-scaffolding output was non-empty, `empty_extraction` never fired and a
> document holding nothing reported **`ready`**. `labelled()` now binds every structural header to
> its body — **no body, no label, no part** — and a text-free archive returns `""`, which the
> EXISTING `empty_extraction` guard turns into the plain-language remedy that already ships. The
> rule, found FIVE times in this phase: **never let a non-empty string stand in for "we got
> content"; the success signal is a COUNT** (`okPages` → `okSheets` → `parts.length`). Second half:
> `pptxText` now routes each slide's `_rels` to the chart / SmartArt / notes entries **already in
> the same unzip result** — an ALLOW-LIST of three part types, with `diagrams/drawingN.xml` (a
> byte-duplicate that doubles the text) and all layout/master boilerplate deliberately excluded.
> **LIVE: the owner's deck went 356 → 1,182 chars and its Entities panel went from empty to 5 nodes
> / 4 edges, including the three plant codes that exist only in the chart series names.** Details in
> `### Phase 15.2 — 15.2-08`.
>
> PRIOR (21) — **LEGACY `.xls` READS ITS NUMBERS: SheetJS is in, pinned from the
> vendor's CDN (`xlsx-0.20.3.tgz`, EXACT, no caret) and NOT npm `xlsx@0.18.5` (CVE-2023-30533,
> CVE-2024-22363 — this parses untrusted uploads).** The Pitfall-9 spike was run BEFORE the parser
> was written and it is a **GO**: rebuilt under Convex's own esbuild flags, SheetJS carries **19 real
> named exports**, while the `pdf-lib` **control still collapses to 1 (`default`)** under the same
> harness — so the probe demonstrably detects a collapse and did not see one here. **Pitfall 9 is now
> a GENERAL rule: the predictor is the absence of an `exports` map with a real ESM build, not the
> import form; offline green is NOT evidence.** `xlsText` is **subpath-only** (~1 MB into ONE node
> action) and gates on `sniffContainer` first, because SheetJS's `read()` otherwise falls back to a
> DSV guesser and turns **64 bytes of noise into a one-cell sheet of mojibake** that would clear
> `empty_extraction`. Its success signal is **`okSheets`, a COUNT** — so it is deliberately NOT a
> third instance of the `Slide N`/`Sheet N` false-ready family. **LIVE: a real legacy `.xls`
> reached `ready` with its numbers visible — OWNER APPROVED, SC#3's XLS half CLOSED** (evidence
> level: the owner's direct confirmation of the checkpoint criterion — `ready`, numbers present,
> not headings-only; **no figures were transcribed back or diffed against Excel**). **The
> date-serial ceiling was not closed by that approval; it was closed later on 2026-07-29 by a real
> Excel-authored workbook with 31 date cells. The SheetJS-written `.xls` still yields `46067`
> because its fixture writer omits the format record. The
> generalised Pitfall-9 rule now lives in `## Invariants` and the dependency-selection note in
> `## Dependencies & blast radius`, not only in the phase narrative. See
> `### Phase 15.2 — 15.2-07` at the END of this file. PRIOR (20) —
> **SCANNED PDFs ARE NOW TRANSCRIBED, NOT SUMMARISED.** The hosted
> branch sends **ONE PAGE PER CALL** (`fanOutPages`, 6 in flight, page-ordered reassembly, 60 s per
> page, 7-min budget) reusing `attachment-extractor` **unchanged** — §5 satisfied by REUSE: the
> prompt was always right, the INPUT was wrong. Live on `local-joel_feruzi-pikar_ai_50c69-1`: the
> 12-page deck went **2,161 → 7,868 chars**, `Page 1`…`Page 12`, zero `[unreadable]`, 13¢ / 12 calls,
> no OCC. **Owner APPROVED from the row data + excerpts — NOT from a browser (the `:3000` server was
> still stale).** `extractionTruncated` on long scans is now EXPECTED, not a regression. **Anyone
> collapsing this back into one whole-document call reintroduces the defect AND the offline suite
> stays green** — it proves shape, not verbatimness. See `### Phase 15.2 — 15.2-06` at the END of
> this file. PRIOR (19) — **THE LIVE GATE PAID: the stranded `.xlsm` is `ready` with
> 256,439 chars of real spreadsheet text on `local-joel_feruzi-pikar_ai_50c69-1`, and a fresh
> `.pptx` upload auto-progressed to `ready` unattended.** Owner APPROVED but **PARTIALLY OBSERVED** —
> **15.2-04's `failureCopy` is still UNVERIFIED LIVE** (the junk-file path was never run), as are
> legacy `.doc`/`.ppt`/`.xls`. **`vaultSweep:runSweep` is a COMPLETED @convex-dev/migrations
> migration and is a NO-OP on a bare invocation** — it needs `'{"reset": true}'` to see any row
> uploaded after it last finished (2026-07-18). **NEW KNOWN GAP: PPTX extracts titles only, and
> scaffolding-only output (`Slide N`/`Sheet N` headers, emitted unconditionally) reports `ready`
> instead of firing `empty_extraction` — a false-ready one layer below the scheduler; plan 15.2-08.**
> See `### Phase 15.2 — 15.2-05` at the END of this file. PRIOR (18) — **THE HONESTY PLAN, STILL OFFLINE-ONLY.** Three closes, no schema change. (1) **Stale attempt state can no longer survive into a success:** `markExtracting` clears `failureReason` + `extractionTruncated` at the START of every attempt, and `markReady` clears `failureReason` ONLY — clearing `extractionTruncated` there would erase the flag `ingestExtractedText` set on the CURRENT attempt moments earlier, i.e. it would break truncation reporting for every large document that succeeds. The locked 15.2-CONTEXT wording asked for both at `markReady`; that half is a defect and is deliberately NOT implemented. (2) **`extractGraph` has an input cap for the first time** — `GRAPH_EXTRACT_CHAR_CAP` (120k chars) applied as `capGraphText(safeText)` immediately before `generateObject`. Ordering is REDACT-then-CAP, never cap-then-redact, and the SMOKE short-circuit stays above the cap. Ceiling: a HEAD SLICE, not chunk-wise fan-out — tail entities in a very long document are missed, and nothing persists a "graph truncated" flag. (3) **`apps/web/.../vault/failureCopy.ts` is the ONE place a reason code becomes prose** — 21 codes → a plain-language title + an actionable remedy, rendered on both vault surfaces; the raw code is NEVER shown to a user (it rides in `title=` only). The hardcoded "scanned or image-only PDFs" sentence in `PreviewModal` is DELETED: it was wrong for most of 15.2-03's new vocabulary (a legacy `.xls` is not an image-only PDF). `unsupported_legacy_spreadsheet`'s remedy ("re-save as .xlsx") is what lets the SheetJS spike in 15.2-07 fail without taking SC#3 with it. Offline gates only: `@pikar/vault` 114/114 (was 108), backend `vault.test` 28/28 (was 24), `tsc --noEmit` 52 errors ALL in test files and ZERO in any non-test file (the pre-existing baseline, unchanged), `pnpm --filter web build` green, biome at the touched files' pre-existing baseline. **NOTHING LIVE WAS PROVEN — no upload was re-run, no failure card was viewed in a browser; SC#7 is still 15.2-05's gate.** See `### Phase 15.2 — 15.2-04` below. Prior: 2026-07-27 (17) — **THE WIRING PLAN: the first 15.2 plan to touch `convex/`, and still OFFLINE-ONLY.** `vault.scheduleExtraction` is now the SOLE scheduling path for all three callers (`vaultUpload`, the recovery sweep, the user's Retry button); it schedules UNCONDITIONALLY and arms `vaultSweep.watchdogStalled` at +15 min per attempt, so `pending_extraction`/`extracting` finally have the governor `processing` has had since 2026-07-20. `vaultExtract.extractDoc` dispatches on `resolveRail(bytes, ...)` — zip / legacy_doc / legacy_ppt / legacy_xls / rtf / markup / text / pdf / image — so `fail("unsupported_format")`, which has existed unreachable since 03.8-02, is REACHABLE for the first time, and a new `empty_extraction` guard stops a 0-char extraction from being stored as a ready document. `extractionKindFor` no longer appears in `vault.ts`, `vaultSweep.ts` or `vaultExtract.ts`. Offline gates only: `vaultSweep` 19/19 (was 10), `vaultExtract` 28/28 (was 16), `tsc --noEmit` with ZERO non-test errors, seven mutation checks confirmed RED before revert. **NOTHING LIVE WAS PROVEN — no upload was re-run and the owner's stranded `.xlsm` has NOT been recovered; that is plan 15.2-05 and it is a separate gate.** See `### Phase 15.2 — 15.2-03` below. Prior: 2026-07-27 (15) — **FORMAT COVERAGE, PURE LAYER ONLY — NOTHING LIVE WAS PROVEN BY THIS CHANGE EITHER.** Phase 15.2 plan 02 turned `extractOfficeText` from a MIME-dispatched three-format function into a self-identifying ZIP-ENTRY dispatcher taking ONE argument (DOCX/DOCM, XLSX/**XLSM**, PPTX/PPTM, ODT/ODS/ODP, EPUB), and added `packages/vault/src/rawText.ts` (`rtfText` / `markupText` / `oleText`) for the non-ZIP recovery formats — **with zero new dependencies; `pnpm-lock.yaml` is untouched**. **ZERO `convex/` files were touched**, so this entry asserts nothing about any deployment: no upload was re-run, no stranded row was recovered, no rail was exercised end to end. Known TRANSIENT: `vaultExtract.ts:193` still calls `extractOfficeText(bytes, meta.mimeType)` and therefore fails `@pikar/backend` typecheck until plan 15.2-03's first task — that is expected and must NOT be "fixed" by restoring an ignored second parameter. Offline gates only: `@pikar/vault` **108/108** (was 77), `tsc --noEmit` exit 0, `check-playbooks` exit 0, three mutation batches confirmed RED before revert. See `### Phase 15.2 — 15.2-02` below. Prior: 2026-07-27 (14) — **PURE RECOGNITION LAYER ONLY — NOTHING LIVE WAS PROVEN BY THIS CHANGE.** Phase 15.2 plan 01 added `packages/vault/src/sniff.ts` (`sniffContainer` / `ole2Kind` / `resolveRail`) and `schedulingRailFor` in `extractKind.ts`, with their tests. **ZERO `convex/` files were touched**, so this entry asserts nothing about any deployment: no upload was re-run, no stranded row was recovered, no extraction rail was exercised end to end. The wiring (the three `kind === null` call sites) is plan 15.2-03's; until it lands, `resolveRail` has no production caller. Offline gates only: `@pikar/vault` **77/77** (was 42), `tsc --noEmit` exit 0, `check-playbooks` exit 0. See `## Phase 15.2 — universal format recognition` below. Prior: 2026-07-26 (13) — **NO SCANNED PDF COULD EVER EXTRACT — pdf-lib was reached by a DYNAMIC import** (owner-reported: a 14.4 MB, 12-page PDF yielded nothing). The live row read `failed` / `extract_error: Cannot read properties of undefined (reading 'load')`. ROOT CAUSE: `slicePdfToPageCap` did `const { PDFDocument } = await import("pdf-lib")`. pdf-lib ships `main: cjs/index.js` with **no `exports` map**, so it resolves to its CJS build; Convex bundles node actions with esbuild `platform: "node", format: "esm", splitting: true`, and across a dynamic-import CHUNK boundary esbuild cannot synthesize a CJS module's named exports — the namespace carries ONLY `default`, so `PDFDocument` destructured to `undefined` and `.load` threw. Reproduced offline by rebuilding a probe with Convex's exact esbuild flags (read out of `convex/dist/esm/bundler/debugBundle.js`): dynamic `pdf-lib` → `undefined`, namespace key count 1; STATIC `import { PDFDocument } from "pdf-lib"` → `function`; dynamic `unpdf` → fine (unpdf is ESM-only, so its namespace has real named exports). **This is why only SCANNED PDFs broke:** `slicePdfToPageCap` sits exclusively on the hosted-OCR fallback, so text-layer PDFs (unpdf only) were always `ready` and the defect stayed invisible. It was invisible OFFLINE too — Node/vitest recover CJS named exports via `cjs-module-lexer`, so `vaultExtract.test.ts`'s page-cap test passed against a production path that could never run (the Pitfall-1 class: only the deployed run proves it). FIX: pdf-lib is now a STATIC top-level import (exactly what `llm.ts` already does for `markdownToPdf`, which works in production), documented as **Pitfall 9** in source and locked by a new static scan in `vaultExtract.test.ts` asserting no dynamic `pdf-lib` import and a static one present. Verified: the fix rebuilt under Convex's exact bundler flags parses the REAL 14.4 MB PDF (`pageCount = 12`) where the old shape threw; `vaultExtract.test.ts` 6 passed vs 5 at baseline with the SAME 10 pre-existing `_generated`-glob reds (no regression); `vaultExtract.ts` typecheck clean; biome byte-identical to baseline (3 pre-existing CRLF/style reds on both). **SECOND defect, unmasked by the first and then observed live:** with pdf-lib working the run reached the hosted call and died at `extract_error: The operation was aborted due to timeout` — `CALL_TIMEOUT_MS` was 45s, copied from intake.ts (small email attachments), which cannot cover ~19 MB of base64 on the wire plus OCR of 12 full-page images. Raised to **480s**, the identical ceiling `vaultTranscribe.ts` already adopted for a 21 MB video, still under Convex's 10-minute node-action limit. After both fixes the owner's document re-ran live to **`ready`** (extracted → embedded → graph). **THIRD defect, still OPEN (not fixed here):** the run yields only ~2.2k chars / 292 words for a 12-slide deck, and it is a SUMMARY ("Here's a breakdown…", "These slides encompass…") even though the `attachment-extractor` skill body — verified byte-identical between the repo `.md` and the seeded row, so NOT a stale-registry problem — explicitly says "extract ALL of it VERBATIM" and "Never summarize". Cause is the CALL SHAPE, not the prompt: that skill's own contract is written for "a **single** image or document (PDF page…)", and `extractPdf` hands the model ALL pages as ONE file part in ONE request, so it digests instead of transcribing. The fix is per-page fan-out (pdf-lib can already emit 1-page PDFs via `copyPages`, matching the skill's single-page contract) — deferred because it changes the cost/latency profile of every scanned upload and a 50-page `VAULT_EXTRACT_PAGE_CAP` scan cannot run 50 sequential hosted calls inside one action's 10-minute limit; it needs batching or a workflow step, not a one-liner. Prior: 2026-07-26 (12) — **A READY DOCUMENT IS NOW A VOICE-SESSION ENTRY POINT** (Phase 14, DOCV-01). `DocGrid` cards and the `PreviewModal` footer carry a "Discuss by voice" control linking to `/dashboard/voice?doc=<id>`, gated honestly on `status`: `ready` enables it; `processing`/`extracting`/`pending_extraction` render a REAL `disabled` button ("Reading…") rather than a dead-styled link, because a screen reader must not announce an actionable control that does nothing; `failed` offers **no voice action at all** and the modal explainer now says why in the user's terms plus what to do next (scanned/image-only PDFs are the usual cause). We do not open a grounded conversation the agent has nothing to ground in, and a silent degradation to "chat about it anyway" would be worse than the refusal. **THE GATE IS SUBSCRIPTION-DRIVEN AND MUST STAY THAT WAY:** `listVaultDocs` is a live Convex query returning whole rows, so the control re-renders enabled on its own the instant extraction flips the status — there is no poll, no timer and no second query, and none should be added. The control is a SIBLING of the card `<button>`, never nested inside it (nested interactive elements are invalid HTML and break keyboard order) — it reuses the failed-card Retry's absolute-positioning precedent and shares the corner, since the two statuses are mutually exclusive. Voice-side reads use `voiceDoc.docContext`, a three-field projection, NOT `listVaultDocs`: that query `.collect()`s whole rows including `text`, and the voice page has no business pulling a book-sized blob to render a title (RESEARCH Open Question 6 remains an observation — deliberately NOT fixed here). Prior: 2026-07-25 (11) — **CHUNK-PRECISE HYDRATION** (owner question: "can the vault read a 50–100 page document completely, or does it skip parts?"). It could not. `vaultGroundHydrated` hydrated every doc with `text.slice(0, PER_DOC_CHAR_CAP)` — the document's FIRST 1500 characters — discarding the passage `rag.search` had just matched. Storage and search were never the problem (the full extracted text is chunked and embedded, and search locates any passage); the loss was entirely at the final hop, so the agent effectively read ~250 words from the top of every document regardless of length. Observed: a 300-page book grounded as its COPYRIGHT PAGE. FIX (the `ponytail:` upgrade path this file already named, now taken): `runVaultGround` collects the matched `content[].text` per docId into a new `matchedByDoc` record — concatenating in score order, so several hits in ONE long doc contribute several passages — and `vaultGroundHydrated` prefers it, reserving the `getDoc` slice for graph NEIGHBOURS (no matched chunk by definition) and the `SMOKE::` seam. Char budgets are UNCHANGED (`PER_DOC_CHAR_CAP` 1500 / `TOTAL_CHAR_CAP` 8000) — the same budget now buys relevant text instead of front matter. The PUBLIC `vaultGround` shape is unchanged: its handler destructures to `{docIds, context}` so `matchedByDoc` cannot leak into the tool/fixture contract, with a new test asserting exactly those two keys (golden fixtures 25/26 and `searchVault` ride this shape). Verified live on the owner's deployment: querying "scarcity urgency bonuses guarantee naming the offer" now returns the book's actual "ENHANCING THE OFFER: BONUSES" chapter instead of its title page. `vaultGround.test.ts` 13/13; full backend 481/482 with only the pre-existing `audit.test.ts` red. Extraction ceilings are SEPARATE and unchanged — a text-layer PDF extracts ALL pages via unpdf, but a SCANNED PDF is sliced to `VAULT_EXTRACT_PAGE_CAP` (50) pages before hosted OCR, and any doc is capped at `VAULT_EXTRACT_CHAR_CAP` (400k) with the `extractionTruncated` honesty flag. Prior: 2026-07-25 (10) — NEW internal query `profileSeedDocs(tenantId)`: the tenant's own profile-shaped docs, newest first, capped at 3 and `PROFILE_SEED_CHAR_CAP` (4000) each. Exists because pure similarity retrieval cannot answer "evaluate MY business" — `rag.search` takes top-K by CHUNK, so one large reference PDF occupied every seed slot and the evaluation engine's grounding returned a single 300-page book (measured live), never the user's own profile. The evaluation engine prepends these as an AUTHORITATIVE seed; `vaultGround` itself is deliberately unchanged (it also serves `searchVault` + golden fixtures 25/26). Recognition is the `- **Persona:**` marker `serializeProfile` always writes, OR `kind === "business_profile"` — so it catches both the onboarding-committed profile AND an uploaded profile-format markdown. CHEAP BY CONSTRUCTION: the metadata pre-filter (`business_profile` kind, or `text/markdown`) keeps PDFs out, so a book's text is never loaded just to test it for the marker; only `status: "ready"` docs with text qualify. Ceiling: newest-wins, so several profile-shaped docs blend (the newest supplies each field first) — fine for one profile plus uploads, revisit if multi-business support lands. Prior: 2026-07-25 (9) — NEW internal seam `ingestFromAttachment` closes the Phase-2/Phase-5 gap: a file attached in the COCKPIT now also becomes a vault doc (owner-reported that cockpit uploads never reached the vault). An internal twin of `vaultIngestText` rather than a caller of it, for the two reasons this file already documents on `ingestExtractedText` — the public mutation throws UNAUTHENTICATED from an action (Pitfall 3), and it accepts no `storageId`. Explicit `tenantId` (the `recordScorecardAnswerInternal` precedent); no public tenantMutation is loosened. Body mirrors `vaultIngestText`: hash-dedup on `by_tenant_contentHash` → insert → `startIngest`. Row shape: `kind`/`source` = `"upload"`, real `mimeType`, `storageId` carried through so the doc stays downloadable from the vault UI, `text` = the RAW extracted text (consistent with every other vault doc — `runIntake` keeps the redacted `safeText` for the conversation). **No new `VaultSource` value was needed**: `categoryFor({ source: "upload", mimeType })` already routes documents to `my-uploads` and lets an image/video mimeType win into `images`/`videos`, so an attachment lands in the same category as the identical direct upload. Dedup means re-attaching a file already in the vault reuses that row — no duplicate, no re-embed, no second embedding spend. The caller (`intake.ts` step 8b) is fail-open; this mutation itself is unchanged in its throw behaviour. Verified: `intake.test.ts` 10/10 incl. 5 new seam tests, full backend 479/480 (only the pre-existing `audit.test.ts` red), `vault.ts` typecheck clean. Spec: `docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md`. Prior: 2026-07-25 (8) — MIME extension-fallback DE-DUPLICATED to one shared helper (owner-reported: the cockpit refused a `.md` upload). ROOT CAUSE: `File.type` is `""` for `.md` on Windows (no registered OS MIME type), and the cockpit's `AttachmentPicker.tsx` checked `MIME_ALLOWLIST.has(file.type)` on that RAW value — so a file whose type (`text/markdown`) IS allow-listed was rejected as "unsupported file type". `Dropzone.tsx` had already solved this locally with its own `resolveMime()` + `EXT_MIME` map, so the vault route worked and the cockpit did not — two copies of one rule, one of them missing. FIX: the fallback moved to `resolveMimeType(filename, browserType)` in `@pikar/core/validateSubmit` (beside the `MIME_ALLOWLIST` it must agree with, §1 pure-TS); `Dropzone.tsx` now imports it and its local `EXT_MIME`/`resolveMime` are deleted (vault behaviour byte-identical — same map, same `application/octet-stream` fallback, so `isSearchable()` still sees `text/markdown` and starts the ingest workflow), and `AttachmentPicker.tsx` resolves BEFORE the allow-list check and sends the resolved type as both the upload `Content-Type` and the stored `mimeType` (previously it stored `""` for any untyped file). An unknown extension still resolves to `application/octet-stream`, which is NOT allow-listed — the fallback widens nothing. Verified: `packages/core` 195/195 green incl. 4 new `resolveMimeType` cases (browser type wins, `.md`/`.markdown`/`.csv`/`.TXT` fallback, untyped `.md` passes the allow-list, unknown ext stays opaque and fails it); web typecheck clean. Prior: 2026-07-24 (7) — Hydrated grounding path (10-01, VGND-01): `vaultGround.ts`'s retrieval logic now lives in a shared module-level helper `runVaultGround(ctx, tenantId, query)` — the tenant is read from an EXPLICIT `tenantId` PARAMETER (not `ctx.auth`), and BOTH entry points call it: the public `vaultGround` tenantAction passes `ctx.tenantId` (its args/name/`{docIds,context}` return + SMOKE:: seam + ranking byte-for-byte unchanged — both pre-existing public tests stay green), and the NEW `vaultGroundHydrated` internalAction passes its explicit `tenantId` arg (the identity-less `internal.gmail.search`/`internal.llm.digestInbox` convention — the cockpit tool loop + eval harnesses carry no live identity, so Plan 02's `runCockpitAgent` calls it as `internal.vaultGround.vaultGroundHydrated({ tenantId, query })`). `vaultGroundHydrated` hydrates the fused docIds into three PARALLEL arrays `{ docIds, titles, chunks }`: titles via the tenant-scoped batch `internal.vault.ownedDocsMeta` (a cross-tenant/missing id drops out — VALT-03), chunk TEXT via `internal.vault.getDoc` (fail-closed cross-tenant), each slice bounded by `PER_DOC_CHAR_CAP` (1500) with a running `TOTAL_CHAR_CAP` (8000) so a large fused corpus never blows the agent-loop context. The hydrated text is returned into the tool loop ONLY — never into any audit/DLQ/telemetry payload (§4; Plan 02's `searchVault` tool owns the refs-only `vault.searched` audit). A foreign explicit `tenantId` yields empty parallel arrays (VALT-03 holds through the hydrated surface — the explicit arg is the only scope; no identity to fall back on). Ceiling (`ponytail:` in source): doc-level text, not chunk-precise — upgrade path is threading `rag.search` result `content` for the vector seeds and reserving `getDoc` for graph neighbors only. Verified: `pnpm --filter @pikar/backend vitest run vaultGround` 12/12 green (hydration parity, per-doc + total caps, cross-tenant empty via explicit tenantId, both unchanged public engine tests); `vaultGround.ts`/`vaultGround.test.ts` typecheck clean; `packages/vault/src/fusion.ts` untouched. The `internalAction` import needs no Biome allow-list change (§2's `noRestrictedImports` bans only `query`/`mutation`/`action`, not the `internal*` builders). Prior: 2026-07-20 (6) — Stranded-"processing" bug FIXED (owner-reported: a voice brief + a PDF stuck "processing" 5+ min, never finishing; an image succeeded). ROOT CAUSE: all five `ingestDoc` start sites called `workflow.start` WITHOUT an `onComplete`, so when an ingest step died (here: this session's repeated backend restarts exhausted the in-flight embed/extract retries) the workflow ended but NOTHING marked the doc — it sat at `processing` forever (only success→`markReady` or a governed stop→`markFailed` ever wrote a terminal status). Two 6-day-old brain-dumps were stranded the same way. FIX: `vaultIngest.startIngest(ctx, {...})` is now the SOLE ingest starter — it wraps `workflow.start` with `onComplete: internal.vaultIngest.onIngestComplete`, which on a failed/canceled run flips a still-`processing` doc to `failed` (idempotent; success + already-terminal untouched). All 5 sites (vault.ts ×4, voice.ts ×1) route through it, so a 6th cannot reintroduce the omission. `retryStuckIngests` re-queues stranded docs (recovered the 4 live). Verified: 4 new `onIngestComplete` tests + full vault/voice suites (32) green, backend typecheck clean, the 4 stranded docs recovered on the live deployment. Prior: 2026-07-18 (5) — Media fit + image full-screen (owner-directed): the media pane is `overflow: hidden` (a single image/video always FITS the pane — media never scrolls; text keeps `auto` because reading scrolls), and images gained a "View full screen" pill that calls the native `requestFullscreen()` on the img — the same full-view the video player's control already offers. Prior: 2026-07-18 (4) — Preview modal FIXED geometry (owner-reported: buttons cut off at the card edge, inconsistently per doc): `max-height` alone let tall content size the card past the viewport cap, and the `overflow: hidden` edge then amputated the pinned actions footer — per-doc, which read as "sometimes the buttons are missing". `.vault-preview-grid` now has an explicit `height: min(85vh, 56rem)` + `grid-template-rows: minmax(0, 1fr)` (stacked mode already bounds its two rows), so EVERY card — text, image, video, any content length — has identical geometry with the actions footer always in the same visible place. Media panes center their content (`place-items: center`) and img/video size to the definite pane height (`max-height: 100%`, `object-fit: contain`). Prior: 2026-07-18 (3) — Transcription timeout + pinned modal actions (owner-reported): a 21 MB mp4 failed with `TimeoutError` — `vaultTranscribe`'s 45s `CALL_TIMEOUT_MS` (copied from intake.ts, tuned for seconds-long mic clips) can't cover upload+transcription of a near-cap video; raised to 480s (under Convex's 10-min node-action limit). Timeout errors now map to the static reason `transcribe_timeout`. Verified live: the failed 21 MB video re-ran to `ready`. PreviewModal's detail panel restructured to fixed header / scrollable middle / PINNED actions footer — documents with many extracted entities were scrolling Download/Delete/Open-in-workspace out of sight (media docs, with few entities, kept theirs visible — the reported asymmetry). Prior: 2026-07-18 (2) — Soundless-video honesty + preview media containment (owner-reported): a second mp4 failed on whisper-1 with `AI_APICallError: The audio file could not be decoded` — byte-level mp4 box inspection proved the file has ONE track (`vide`/avc1, NO audio track), so there is nothing to transcribe. `transcribeDoc`'s catch now maps that decode error to the static reason `no_audio_track_or_undecodable` (card renders "no audio track or undecodable"); other errors stay `transcribe_failed`. PreviewModal media are now contained: img/video get `object-fit: contain` + `max-height: 62vh` (full image visible, never cropped at the card edge), and stacked mode bounds both rows (`minmax(0,1.3fr) minmax(0,1fr)`) so tall media can't push the detail panel past the card's overflow-hidden edge. Ops note: vitest false-reds (`crypto is not defined` in convex-test workers) appear under CPU saturation — kill runaway processes and re-run `--maxWorkers=1` before trusting a red. Prior: 2026-07-18 — Video transcription fix (owner-reported: a 6 MB mp4 failed): `transcribeDoc` now transcribes with `whisper-1` instead of `gpt-4o-transcribe`, which rejects video-container mp4 (`AI_APICallError: This model does not support the format you provided`). whisper-1 demuxes the audio track; both bill at 0.006/min so the cost model is unchanged. Verified live on the shared local deployment: the failed 6 MB mp4 re-transcribed to `ready` + embedded. The terminal catch-all now `console.error`s the API error message (refs-safe) so a `transcribe_failed` is no longer a silent dead-end. `intake.ts` intentionally stays on gpt-4o-transcribe (its inputs are mic audio, which that model supports + transcribes more accurately). Prior: 2026-07-18 — Post-3.8 human-verify tuning (owner-reported during phase-close): the per-file cap became per-kind — `VAULT_FILE_CAP_BYTES` raised 8 MiB → **100 MiB** for docs/images, new `VAULT_VIDEO_CAP_BYTES` = **25 MB** for video (the transcription API's hard limit). Enforced at the `vaultUpload` chokepoint (per-kind branch, specific messages) and mirrored in `Dropzone.tsx` as a fast pre-upload guard (two local numbers + sync comment — no new web dep on the Node-oriented `@pikar/vault` barrel). `PreviewModal.tsx` no longer overlaps on narrow screens: the two-pane grid moved to `.vault-preview-grid`/`.vault-preview-main` in `globals.css` and STACKS to one column below 48rem (divider flips right→bottom border), and the extracted-text pane now shows a 1500-char snippet with a "Show full text" expander instead of dumping the whole document. Video >25 MB and large-doc extraction memory/time logged under Known gaps. Verified: `@pikar/vault` cap/category tests green, `@pikar/backend` `vault.test.ts` + `vaultTranscribe.test.ts` green (26 incl. new per-kind cap tests), web typecheck clean, biome clean on all touched files. Prior: 2026-07-18 — Phase 3.8 Wave 3 (03.8-06 integration): all four Wave-2 lanes merged to `main` and the merged whole proven green. Lane 1 (`vaultExtract.ts` — PDF text-layer-first + hosted OCR + image), Lane 2 (`packages/vault/src/officeText.ts` — DOCX/XLSX/PPTX flatten), Lane 3 (`vaultSweep.ts` backlog sweep + `retryExtraction` + the vault-route lifecycle UI + `vault.spec.ts` E2E), and Lane 4 (`vaultTranscribe.ts` — video/audio transcription rail) are now the real dispatcher end to end: `vaultUpload` → `extractDoc`/`transcribeDoc` (kind-dispatched, self-gated via preCall, scan-then-audit refs-only, char-capped) → `ingestExtractedText` seam → embed + graph. The two EXTR-H rows in `apps/web/e2e/vault.spec.ts` are now UN-skip-guarded (Wave-0 stubs are real, so the SMOKE::extract:: pdf + SMOKE::transcribe:: mp4 walks assert a clean pending_extraction → ready terminal, not the old `failed("not_implemented")` branch). Verified on merged `main`: backend vitest 317/318 (only red = pre-existing `audit.test.ts` auditCounts-unregistered, documented since Phase 2), `@pikar/vault` 42/42 (officeText 15/15), web typecheck clean, `biome lint` clean on all merged vault files, `check-playbooks` green. `_generated/` regenerated (`npx convex codegen`) so `api.d.ts` carries all four modules. Append-only singletons (STATE/ROADMAP/vault.md/deferred-items) resolved keep-both per PARALLELIZATION §"three shared singletons". Prior: 2026-07-18 — Phase 3.8 Wave 0 (03.8-01): the extraction CONTRACT landed on `main` — `vaultDocuments.status` grew `extracting` (+ `extractionTruncated` optional flag), `vaultUpload` now schedules `internal.vaultExtract.extractDoc` / `internal.vaultTranscribe.transcribeDoc` by `extractionKindFor(mimeType, filename)` for non-searchable binaries (TXT/MD/CSV path untouched), and the scheduler-safe internal seam `ingestExtractedText` + `markExtracting` + `getDocForExtraction` sit next to markReady/markFailed. `@pikar/vault` gained `extractKind.ts` (classifier + caps consts, on the barrel) and the `officeText.ts` stub (subpath-only — keeps fflate out of the V8 bundle). `unpdf@1.6.2`/`fflate@0.8.3` pinned; the lockfile, both package.jsons, `schema.ts`, `vault.ts`, and `watch.json` are FROZEN for the rest of the phase (see `## Extraction lifecycle (Phase 3.8)` + `.planning/PARALLELIZATION.md`). Prior: 2026-07-17 — overflow containment fix (user-reported): long unbroken filenames painted past the doc cards. In `DocGrid.tsx` grid (column) view the info span's cross-axis shrink-to-fit sized it to the full nowrap-title width (min-content = max-content for nowrap text), so the ellipsis never engaged — capped with `maxWidth: 100%`; `PreviewModal.tsx`'s title `h2` got `minWidth: 0` so `flex: 1` can actually shrink it and `break-word` wraps instead of pushing past the panel. Visual containment only — no data/query/status changes; web typecheck clean. Prior: 2026-07-15 — owner-directed shell fusion + glass/clay uniformity, in two passes. Pass 1 fused the route full-bleed: `(app)/layout.tsx`'s `is-bleed` match widened to `/^\/dashboard\/(workspace|vault)/`, so `<main>` drops its canvas padding and locks overflow, and `vault/page.tsx`'s root became a `.vault-surface.pane-canvas` (the workspace canvas's teal aura) with an inner `.vault-scroll` owning its own scroll (is-bleed locks `<main>`). Pass 2 gave the board pieces the actual glass-over-clay treatment (the fusion alone left the tiles flat): shared `globals.css` classes `.clay-card` (frosted translucent pane + `backdrop-filter` blur + extruded shadows — an outer drop, an inner top light edge, a soft inner bottom shade; hover-lift for `button.clay-card`), `.clay-badge` (extruded icon badge mirroring `.rail-logo`), and `.clay-dropzone` (lighter frosted panel). Applied by className to the VaultStats tiles + their icon badges, the CategoryTabs container, the DocGrid search bar + doc cards + card icon badges, and the Dropzone panel + its icon (each dropped its inline `var(--card)`/border/flat-shadow; radius + layout stay inline). The `backdrop-filter` frosts the aura, so these only read right on `.pane-canvas`. PreviewModal is intentionally left solid — it sits on a dark scrim, not the aura, so frosting would just muddy the scrim. Internal vault behavior and all `vault.spec.ts` selectors unchanged; web typecheck clean. Prior: 05-07b — LIVE browser human-verify (real user, Claude-in-Chrome): the vault route renders a 1:1 brand match; a pasted Brain Dump ingested end-to-end through the REAL pipeline (embed → graph-extract → upsert → `ready`), and the preview modal surfaced the correctly-extracted entities (Meridian Health/CareLink/Vantage Systems `org`, Alan Ford/Nina Osei `person`) + a typed `led by` relationship. The live run CAUGHT + FIXED a P0 the offline SMOKE suite could not: `vaultRag.ts` passed a spec-"v4" `openai.embedding(...)` model to RAG's ai@6 (`AI_UnsupportedModelVersionError`) — replaced with a v2 `openaiEmbeddingV2` REST adapter (+ a `vaultRedaction.test.ts` static guard). Also surfaced: ingest needs `skills:seedSkills` run against the deployment (`NO_ACTIVE_SKILL: graph-extractor` otherwise). ALSO 2026-07-27 (16-01, Lane R — concurrent phase, keep-both merge): Phase-16 Wave-0 freeze — the web_research document class, vaultDocuments.retrievedAt, and the ADR-006 trust-assumption change (a web-derived doc is NOT the user own corpus). PREVIOUSLY: 2026-07-26 (13) — **NO SCANNED PDF COULD EVER EXTRACT — pdf-lib was reached by a DYNAMIC import** (owner-reported: a 14.4 MB, 12-page PDF yielded nothing). The live row read `failed` / `extract_error: Cannot read properties of undefined (reading 'load')`. ROOT CAUSE: `slicePdfToPageCap` did `const { PDFDocument } = await import("pdf-lib")`. pdf-lib ships `main: cjs/index.js` with **no `exports` map**, so it resolves to its CJS build; Convex bundles node actions with esbuild `platform: "node", format: "esm", splitting: true`, and across a dynamic-import CHUNK boundary esbuild cannot synthesize a CJS module's named exports — the namespace carries ONLY `default`, so `PDFDocument` destructured to `undefined` and `.load` threw. Reproduced offline by rebuilding a probe with Convex's exact esbuild flags (read out of `convex/dist/esm/bundler/debugBundle.js`): dynamic `pdf-lib` → `undefined`, namespace key count 1; STATIC `import { PDFDocument } from "pdf-lib"` → `function`; dynamic `unpdf` → fine (unpdf is ESM-only, so its namespace has real named exports). **This is why only SCANNED PDFs broke:** `slicePdfToPageCap` sits exclusively on the hosted-OCR fallback, so text-layer PDFs (unpdf only) were always `ready` and the defect stayed invisible. It was invisible OFFLINE too — Node/vitest recover CJS named exports via `cjs-module-lexer`, so `vaultExtract.test.ts`'s page-cap test passed against a production path that could never run (the Pitfall-1 class: only the deployed run proves it). FIX: pdf-lib is now a STATIC top-level import (exactly what `llm.ts` already does for `markdownToPdf`, which works in production), documented as **Pitfall 9** in source and locked by a new static scan in `vaultExtract.test.ts` asserting no dynamic `pdf-lib` import and a static one present. Verified: the fix rebuilt under Convex's exact bundler flags parses the REAL 14.4 MB PDF (`pageCount = 12`) where the old shape threw; `vaultExtract.test.ts` 6 passed vs 5 at baseline with the SAME 10 pre-existing `_generated`-glob reds (no regression); `vaultExtract.ts` typecheck clean; biome byte-identical to baseline (3 pre-existing CRLF/style reds on both). **SECOND defect, unmasked by the first and then observed live:** with pdf-lib working the run reached the hosted call and died at `extract_error: The operation was aborted due to timeout` — `CALL_TIMEOUT_MS` was 45s, copied from intake.ts (small email attachments), which cannot cover ~19 MB of base64 on the wire plus OCR of 12 full-page images. Raised to **480s**, the identical ceiling `vaultTranscribe.ts` already adopted for a 21 MB video, still under Convex's 10-minute node-action limit. After both fixes the owner's document re-ran live to **`ready`** (extracted → embedded → graph). **THIRD defect, still OPEN (not fixed here):** the run yields only ~2.2k chars / 292 words for a 12-slide deck, and it is a SUMMARY ("Here's a breakdown…", "These slides encompass…") even though the `attachment-extractor` skill body — verified byte-identical between the repo `.md` and the seeded row, so NOT a stale-registry problem — explicitly says "extract ALL of it VERBATIM" and "Never summarize". Cause is the CALL SHAPE, not the prompt: that skill's own contract is written for "a **single** image or document (PDF page…)", and `extractPdf` hands the model ALL pages as ONE file part in ONE request, so it digests instead of transcribing. The fix is per-page fan-out (pdf-lib can already emit 1-page PDFs via `copyPages`, matching the skill's single-page contract) — deferred because it changes the cost/latency profile of every scanned upload and a 50-page `VAULT_EXTRACT_PAGE_CAP` scan cannot run 50 sequential hosted calls inside one action's 10-minute limit; it needs batching or a workflow step, not a one-liner. Prior: 2026-07-26 (12) — **A READY DOCUMENT IS NOW A VOICE-SESSION ENTRY POINT** (Phase 14, DOCV-01). `DocGrid` cards and the `PreviewModal` footer carry a "Discuss by voice" control linking to `/dashboard/voice?doc=<id>`, gated honestly on `status`: `ready` enables it; `processing`/`extracting`/`pending_extraction` render a REAL `disabled` button ("Reading…") rather than a dead-styled link, because a screen reader must not announce an actionable control that does nothing; `failed` offers **no voice action at all** and the modal explainer now says why in the user's terms plus what to do next (scanned/image-only PDFs are the usual cause). We do not open a grounded conversation the agent has nothing to ground in, and a silent degradation to "chat about it anyway" would be worse than the refusal. **THE GATE IS SUBSCRIPTION-DRIVEN AND MUST STAY THAT WAY:** `listVaultDocs` is a live Convex query returning whole rows, so the control re-renders enabled on its own the instant extraction flips the status — there is no poll, no timer and no second query, and none should be added. The control is a SIBLING of the card `<button>`, never nested inside it (nested interactive elements are invalid HTML and break keyboard order) — it reuses the failed-card Retry's absolute-positioning precedent and shares the corner, since the two statuses are mutually exclusive. Voice-side reads use `voiceDoc.docContext`, a three-field projection, NOT `listVaultDocs`: that query `.collect()`s whole rows including `text`, and the voice page has no business pulling a book-sized blob to render a title (RESEARCH Open Question 6 remains an observation — deliberately NOT fixed here). Prior: 2026-07-25 (11) — **CHUNK-PRECISE HYDRATION** (owner question: "can the vault read a 50–100 page document completely, or does it skip parts?"). It could not. `vaultGroundHydrated` hydrated every doc with `text.slice(0, PER_DOC_CHAR_CAP)` — the document's FIRST 1500 characters — discarding the passage `rag.search` had just matched. Storage and search were never the problem (the full extracted text is chunked and embedded, and search locates any passage); the loss was entirely at the final hop, so the agent effectively read ~250 words from the top of every document regardless of length. Observed: a 300-page book grounded as its COPYRIGHT PAGE. FIX (the `ponytail:` upgrade path this file already named, now taken): `runVaultGround` collects the matched `content[].text` per docId into a new `matchedByDoc` record — concatenating in score order, so several hits in ONE long doc contribute several passages — and `vaultGroundHydrated` prefers it, reserving the `getDoc` slice for graph NEIGHBOURS (no matched chunk by definition) and the `SMOKE::` seam. Char budgets are UNCHANGED (`PER_DOC_CHAR_CAP` 1500 / `TOTAL_CHAR_CAP` 8000) — the same budget now buys relevant text instead of front matter. The PUBLIC `vaultGround` shape is unchanged: its handler destructures to `{docIds, context}` so `matchedByDoc` cannot leak into the tool/fixture contract, with a new test asserting exactly those two keys (golden fixtures 25/26 and `searchVault` ride this shape). Verified live on the owner's deployment: querying "scarcity urgency bonuses guarantee naming the offer" now returns the book's actual "ENHANCING THE OFFER: BONUSES" chapter instead of its title page. `vaultGround.test.ts` 13/13; full backend 481/482 with only the pre-existing `audit.test.ts` red. Extraction ceilings are SEPARATE and unchanged — a text-layer PDF extracts ALL pages via unpdf, but a SCANNED PDF is sliced to `VAULT_EXTRACT_PAGE_CAP` (50) pages before hosted OCR, and any doc is capped at `VAULT_EXTRACT_CHAR_CAP` (400k) with the `extractionTruncated` honesty flag. Prior: 2026-07-25 (10) — NEW internal query `profileSeedDocs(tenantId)`: the tenant's own profile-shaped docs, newest first, capped at 3 and `PROFILE_SEED_CHAR_CAP` (4000) each. Exists because pure similarity retrieval cannot answer "evaluate MY business" — `rag.search` takes top-K by CHUNK, so one large reference PDF occupied every seed slot and the evaluation engine's grounding returned a single 300-page book (measured live), never the user's own profile. The evaluation engine prepends these as an AUTHORITATIVE seed; `vaultGround` itself is deliberately unchanged (it also serves `searchVault` + golden fixtures 25/26). Recognition is the `- **Persona:**` marker `serializeProfile` always writes, OR `kind === "business_profile"` — so it catches both the onboarding-committed profile AND an uploaded profile-format markdown. CHEAP BY CONSTRUCTION: the metadata pre-filter (`business_profile` kind, or `text/markdown`) keeps PDFs out, so a book's text is never loaded just to test it for the marker; only `status: "ready"` docs with text qualify. Ceiling: newest-wins, so several profile-shaped docs blend (the newest supplies each field first) — fine for one profile plus uploads, revisit if multi-business support lands. Prior: 2026-07-25 (9) — NEW internal seam `ingestFromAttachment` closes the Phase-2/Phase-5 gap: a file attached in the COCKPIT now also becomes a vault doc (owner-reported that cockpit uploads never reached the vault). An internal twin of `vaultIngestText` rather than a caller of it, for the two reasons this file already documents on `ingestExtractedText` — the public mutation throws UNAUTHENTICATED from an action (Pitfall 3), and it accepts no `storageId`. Explicit `tenantId` (the `recordScorecardAnswerInternal` precedent); no public tenantMutation is loosened. Body mirrors `vaultIngestText`: hash-dedup on `by_tenant_contentHash` → insert → `startIngest`. Row shape: `kind`/`source` = `"upload"`, real `mimeType`, `storageId` carried through so the doc stays downloadable from the vault UI, `text` = the RAW extracted text (consistent with every other vault doc — `runIntake` keeps the redacted `safeText` for the conversation). **No new `VaultSource` value was needed**: `categoryFor({ source: "upload", mimeType })` already routes documents to `my-uploads` and lets an image/video mimeType win into `images`/`videos`, so an attachment lands in the same category as the identical direct upload. Dedup means re-attaching a file already in the vault reuses that row — no duplicate, no re-embed, no second embedding spend. The caller (`intake.ts` step 8b) is fail-open; this mutation itself is unchanged in its throw behaviour. Verified: `intake.test.ts` 10/10 incl. 5 new seam tests, full backend 479/480 (only the pre-existing `audit.test.ts` red), `vault.ts` typecheck clean. Spec: `docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md`. Prior: 2026-07-25 (8) — MIME extension-fallback DE-DUPLICATED to one shared helper (owner-reported: the cockpit refused a `.md` upload). ROOT CAUSE: `File.type` is `""` for `.md` on Windows (no registered OS MIME type), and the cockpit's `AttachmentPicker.tsx` checked `MIME_ALLOWLIST.has(file.type)` on that RAW value — so a file whose type (`text/markdown`) IS allow-listed was rejected as "unsupported file type". `Dropzone.tsx` had already solved this locally with its own `resolveMime()` + `EXT_MIME` map, so the vault route worked and the cockpit did not — two copies of one rule, one of them missing. FIX: the fallback moved to `resolveMimeType(filename, browserType)` in `@pikar/core/validateSubmit` (beside the `MIME_ALLOWLIST` it must agree with, §1 pure-TS); `Dropzone.tsx` now imports it and its local `EXT_MIME`/`resolveMime` are deleted (vault behaviour byte-identical — same map, same `application/octet-stream` fallback, so `isSearchable()` still sees `text/markdown` and starts the ingest workflow), and `AttachmentPicker.tsx` resolves BEFORE the allow-list check and sends the resolved type as both the upload `Content-Type` and the stored `mimeType` (previously it stored `""` for any untyped file). An unknown extension still resolves to `application/octet-stream`, which is NOT allow-listed — the fallback widens nothing. Verified: `packages/core` 195/195 green incl. 4 new `resolveMimeType` cases (browser type wins, `.md`/`.markdown`/`.csv`/`.TXT` fallback, untyped `.md` passes the allow-list, unknown ext stays opaque and fails it); web typecheck clean. Prior: 2026-07-24 (7) — Hydrated grounding path (10-01, VGND-01): `vaultGround.ts`'s retrieval logic now lives in a shared module-level helper `runVaultGround(ctx, tenantId, query)` — the tenant is read from an EXPLICIT `tenantId` PARAMETER (not `ctx.auth`), and BOTH entry points call it: the public `vaultGround` tenantAction passes `ctx.tenantId` (its args/name/`{docIds,context}` return + SMOKE:: seam + ranking byte-for-byte unchanged — both pre-existing public tests stay green), and the NEW `vaultGroundHydrated` internalAction passes its explicit `tenantId` arg (the identity-less `internal.gmail.search`/`internal.llm.digestInbox` convention — the cockpit tool loop + eval harnesses carry no live identity, so Plan 02's `runCockpitAgent` calls it as `internal.vaultGround.vaultGroundHydrated({ tenantId, query })`). `vaultGroundHydrated` hydrates the fused docIds into three PARALLEL arrays `{ docIds, titles, chunks }`: titles via the tenant-scoped batch `internal.vault.ownedDocsMeta` (a cross-tenant/missing id drops out — VALT-03), chunk TEXT via `internal.vault.getDoc` (fail-closed cross-tenant), each slice bounded by `PER_DOC_CHAR_CAP` (1500) with a running `TOTAL_CHAR_CAP` (8000) so a large fused corpus never blows the agent-loop context. The hydrated text is returned into the tool loop ONLY — never into any audit/DLQ/telemetry payload (§4; Plan 02's `searchVault` tool owns the refs-only `vault.searched` audit). A foreign explicit `tenantId` yields empty parallel arrays (VALT-03 holds through the hydrated surface — the explicit arg is the only scope; no identity to fall back on). Ceiling (`ponytail:` in source): doc-level text, not chunk-precise — upgrade path is threading `rag.search` result `content` for the vector seeds and reserving `getDoc` for graph neighbors only. Verified: `pnpm --filter @pikar/backend vitest run vaultGround` 12/12 green (hydration parity, per-doc + total caps, cross-tenant empty via explicit tenantId, both unchanged public engine tests); `vaultGround.ts`/`vaultGround.test.ts` typecheck clean; `packages/vault/src/fusion.ts` untouched. The `internalAction` import needs no Biome allow-list change (§2's `noRestrictedImports` bans only `query`/`mutation`/`action`, not the `internal*` builders). Prior: 2026-07-20 (6) — Stranded-"processing" bug FIXED (owner-reported: a voice brief + a PDF stuck "processing" 5+ min, never finishing; an image succeeded). ROOT CAUSE: all five `ingestDoc` start sites called `workflow.start` WITHOUT an `onComplete`, so when an ingest step died (here: this session's repeated backend restarts exhausted the in-flight embed/extract retries) the workflow ended but NOTHING marked the doc — it sat at `processing` forever (only success→`markReady` or a governed stop→`markFailed` ever wrote a terminal status). Two 6-day-old brain-dumps were stranded the same way. FIX: `vaultIngest.startIngest(ctx, {...})` is now the SOLE ingest starter — it wraps `workflow.start` with `onComplete: internal.vaultIngest.onIngestComplete`, which on a failed/canceled run flips a still-`processing` doc to `failed` (idempotent; success + already-terminal untouched). All 5 sites (vault.ts ×4, voice.ts ×1) route through it, so a 6th cannot reintroduce the omission. `retryStuckIngests` re-queues stranded docs (recovered the 4 live). Verified: 4 new `onIngestComplete` tests + full vault/voice suites (32) green, backend typecheck clean, the 4 stranded docs recovered on the live deployment. Prior: 2026-07-18 (5) — Media fit + image full-screen (owner-directed): the media pane is `overflow: hidden` (a single image/video always FITS the pane — media never scrolls; text keeps `auto` because reading scrolls), and images gained a "View full screen" pill that calls the native `requestFullscreen()` on the img — the same full-view the video player's control already offers. Prior: 2026-07-18 (4) — Preview modal FIXED geometry (owner-reported: buttons cut off at the card edge, inconsistently per doc): `max-height` alone let tall content size the card past the viewport cap, and the `overflow: hidden` edge then amputated the pinned actions footer — per-doc, which read as "sometimes the buttons are missing". `.vault-preview-grid` now has an explicit `height: min(85vh, 56rem)` + `grid-template-rows: minmax(0, 1fr)` (stacked mode already bounds its two rows), so EVERY card — text, image, video, any content length — has identical geometry with the actions footer always in the same visible place. Media panes center their content (`place-items: center`) and img/video size to the definite pane height (`max-height: 100%`, `object-fit: contain`). Prior: 2026-07-18 (3) — Transcription timeout + pinned modal actions (owner-reported): a 21 MB mp4 failed with `TimeoutError` — `vaultTranscribe`'s 45s `CALL_TIMEOUT_MS` (copied from intake.ts, tuned for seconds-long mic clips) can't cover upload+transcription of a near-cap video; raised to 480s (under Convex's 10-min node-action limit). Timeout errors now map to the static reason `transcribe_timeout`. Verified live: the failed 21 MB video re-ran to `ready`. PreviewModal's detail panel restructured to fixed header / scrollable middle / PINNED actions footer — documents with many extracted entities were scrolling Download/Delete/Open-in-workspace out of sight (media docs, with few entities, kept theirs visible — the reported asymmetry). Prior: 2026-07-18 (2) — Soundless-video honesty + preview media containment (owner-reported): a second mp4 failed on whisper-1 with `AI_APICallError: The audio file could not be decoded` — byte-level mp4 box inspection proved the file has ONE track (`vide`/avc1, NO audio track), so there is nothing to transcribe. `transcribeDoc`'s catch now maps that decode error to the static reason `no_audio_track_or_undecodable` (card renders "no audio track or undecodable"); other errors stay `transcribe_failed`. PreviewModal media are now contained: img/video get `object-fit: contain` + `max-height: 62vh` (full image visible, never cropped at the card edge), and stacked mode bounds both rows (`minmax(0,1.3fr) minmax(0,1fr)`) so tall media can't push the detail panel past the card's overflow-hidden edge. Ops note: vitest false-reds (`crypto is not defined` in convex-test workers) appear under CPU saturation — kill runaway processes and re-run `--maxWorkers=1` before trusting a red. Prior: 2026-07-18 — Video transcription fix (owner-reported: a 6 MB mp4 failed): `transcribeDoc` now transcribes with `whisper-1` instead of `gpt-4o-transcribe`, which rejects video-container mp4 (`AI_APICallError: This model does not support the format you provided`). whisper-1 demuxes the audio track; both bill at 0.006/min so the cost model is unchanged. Verified live on the shared local deployment: the failed 6 MB mp4 re-transcribed to `ready` + embedded. The terminal catch-all now `console.error`s the API error message (refs-safe) so a `transcribe_failed` is no longer a silent dead-end. `intake.ts` intentionally stays on gpt-4o-transcribe (its inputs are mic audio, which that model supports + transcribes more accurately). Prior: 2026-07-18 — Post-3.8 human-verify tuning (owner-reported during phase-close): the per-file cap became per-kind — `VAULT_FILE_CAP_BYTES` raised 8 MiB → **100 MiB** for docs/images, new `VAULT_VIDEO_CAP_BYTES` = **25 MB** for video (the transcription API's hard limit). Enforced at the `vaultUpload` chokepoint (per-kind branch, specific messages) and mirrored in `Dropzone.tsx` as a fast pre-upload guard (two local numbers + sync comment — no new web dep on the Node-oriented `@pikar/vault` barrel). `PreviewModal.tsx` no longer overlaps on narrow screens: the two-pane grid moved to `.vault-preview-grid`/`.vault-preview-main` in `globals.css` and STACKS to one column below 48rem (divider flips right→bottom border), and the extracted-text pane now shows a 1500-char snippet with a "Show full text" expander instead of dumping the whole document. Video >25 MB and large-doc extraction memory/time logged under Known gaps. Verified: `@pikar/vault` cap/category tests green, `@pikar/backend` `vault.test.ts` + `vaultTranscribe.test.ts` green (26 incl. new per-kind cap tests), web typecheck clean, biome clean on all touched files. Prior: 2026-07-18 — Phase 3.8 Wave 3 (03.8-06 integration): all four Wave-2 lanes merged to `main` and the merged whole proven green. Lane 1 (`vaultExtract.ts` — PDF text-layer-first + hosted OCR + image), Lane 2 (`packages/vault/src/officeText.ts` — DOCX/XLSX/PPTX flatten), Lane 3 (`vaultSweep.ts` backlog sweep + `retryExtraction` + the vault-route lifecycle UI + `vault.spec.ts` E2E), and Lane 4 (`vaultTranscribe.ts` — video/audio transcription rail) are now the real dispatcher end to end: `vaultUpload` → `extractDoc`/`transcribeDoc` (kind-dispatched, self-gated via preCall, scan-then-audit refs-only, char-capped) → `ingestExtractedText` seam → embed + graph. The two EXTR-H rows in `apps/web/e2e/vault.spec.ts` are now UN-skip-guarded (Wave-0 stubs are real, so the SMOKE::extract:: pdf + SMOKE::transcribe:: mp4 walks assert a clean pending_extraction → ready terminal, not the old `failed("not_implemented")` branch). Verified on merged `main`: backend vitest 317/318 (only red = pre-existing `audit.test.ts` auditCounts-unregistered, documented since Phase 2), `@pikar/vault` 42/42 (officeText 15/15), web typecheck clean, `biome lint` clean on all merged vault files, `check-playbooks` green. `_generated/` regenerated (`npx convex codegen`) so `api.d.ts` carries all four modules. Append-only singletons (STATE/ROADMAP/vault.md/deferred-items) resolved keep-both per PARALLELIZATION §"three shared singletons". Prior: 2026-07-18 — Phase 3.8 Wave 0 (03.8-01): the extraction CONTRACT landed on `main` — `vaultDocuments.status` grew `extracting` (+ `extractionTruncated` optional flag), `vaultUpload` now schedules `internal.vaultExtract.extractDoc` / `internal.vaultTranscribe.transcribeDoc` by `extractionKindFor(mimeType, filename)` for non-searchable binaries (TXT/MD/CSV path untouched), and the scheduler-safe internal seam `ingestExtractedText` + `markExtracting` + `getDocForExtraction` sit next to markReady/markFailed. `@pikar/vault` gained `extractKind.ts` (classifier + caps consts, on the barrel) and the `officeText.ts` stub (subpath-only — keeps fflate out of the V8 bundle). `unpdf@1.6.2`/`fflate@0.8.3` pinned; the lockfile, both package.jsons, `schema.ts`, `vault.ts`, and `watch.json` are FROZEN for the rest of the phase (see `## Extraction lifecycle (Phase 3.8)` + `.planning/PARALLELIZATION.md`). Prior: 2026-07-17 — overflow containment fix (user-reported): long unbroken filenames painted past the doc cards. In `DocGrid.tsx` grid (column) view the info span's cross-axis shrink-to-fit sized it to the full nowrap-title width (min-content = max-content for nowrap text), so the ellipsis never engaged — capped with `maxWidth: 100%`; `PreviewModal.tsx`'s title `h2` got `minWidth: 0` so `flex: 1` can actually shrink it and `break-word` wraps instead of pushing past the panel. Visual containment only — no data/query/status changes; web typecheck clean. Prior: 2026-07-15 — owner-directed shell fusion + glass/clay uniformity, in two passes. Pass 1 fused the route full-bleed: `(app)/layout.tsx`'s `is-bleed` match widened to `/^\/dashboard\/(workspace|vault)/`, so `<main>` drops its canvas padding and locks overflow, and `vault/page.tsx`'s root became a `.vault-surface.pane-canvas` (the workspace canvas's teal aura) with an inner `.vault-scroll` owning its own scroll (is-bleed locks `<main>`). Pass 2 gave the board pieces the actual glass-over-clay treatment (the fusion alone left the tiles flat): shared `globals.css` classes `.clay-card` (frosted translucent pane + `backdrop-filter` blur + extruded shadows — an outer drop, an inner top light edge, a soft inner bottom shade; hover-lift for `button.clay-card`), `.clay-badge` (extruded icon badge mirroring `.rail-logo`), and `.clay-dropzone` (lighter frosted panel). Applied by className to the VaultStats tiles + their icon badges, the CategoryTabs container, the DocGrid search bar + doc cards + card icon badges, and the Dropzone panel + its icon (each dropped its inline `var(--card)`/border/flat-shadow; radius + layout stay inline). The `backdrop-filter` frosts the aura, so these only read right on `.pane-canvas`. PreviewModal is intentionally left solid — it sits on a dark scrim, not the aura, so frosting would just muddy the scrim. Internal vault behavior and all `vault.spec.ts` selectors unchanged; web typecheck clean. Prior: 05-07b — LIVE browser human-verify (real user, Claude-in-Chrome): the vault route renders a 1:1 brand match; a pasted Brain Dump ingested end-to-end through the REAL pipeline (embed → graph-extract → upsert → `ready`), and the preview modal surfaced the correctly-extracted entities (Meridian Health/CareLink/Vantage Systems `org`, Alan Ford/Nina Osei `person`) + a typed `led by` relationship. The live run CAUGHT + FIXED a P0 the offline SMOKE suite could not: `vaultRag.ts` passed a spec-"v4" `openai.embedding(...)` model to RAG's ai@6 (`AI_UnsupportedModelVersionError`) — replaced with a v2 `openaiEmbeddingV2` REST adapter (+ a `vaultRedaction.test.ts` static guard). Also surfaced: ingest needs `skills:seedSkills` run against the deployment (`NO_ACTIVE_SKILL: graph-extractor` otherwise).
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
- `packages/backend/convex/vault.ts` (05-04/05-05) — the tenant ingest mutations (`vaultIngestText` paste/late-text seam + `vaultUpload` accept-but-defer, both hash-dedup), `deleteVaultDoc` cascade (row + rag chunks + graphEdges, orphan-node GC), the internal lifecycle (`getDoc`/`markReady`/`markFailed`), and (05-05) the READ plane: `listVaultDocs`/`vaultStats` (cheap, no vectors), `vaultDownloadUrl` (owner-only signed URL, bearer capability, never logged §4), `docEntities` (owner-guarded per-doc nodes/edges), `vaultSearch` (the `rag.search` hybrid primitive post-filtered to a category), and `ownedDocsMeta` (the tenant-scope resolve seam shared by grounding + search). Starts ingest ONLY via `vaultIngest.startIngest` (never a bare `workflow.start`).
- `packages/backend/convex/vaultIngest.ts` (05-04; failure-handling 2026-07-20) — `ingestDoc = workflow.define(...)`: `preCall` gate (governed stop → `markFailed`, never a DLQ throw) → `embedDoc` → `extractGraph` → `upsertGraph` → `recordSpend` → `markReady`. Plus `startIngest` (the SOLE ingest starter — `workflow.start` + the `onComplete`), `onIngestComplete` (failed/canceled run → `markFailed`, so a dead run can never strand the doc at `processing`), and `retryStuckIngests` (re-queue stranded docs).
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
- `xlsx` (SheetJS) **pinned to the vendor CDN tarball** `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, EXACT, no caret (§6). **NOT npm `xlsx@0.18.5`** — the last registry publish carries CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS), and this code parses untrusted uploads. Subpath-only (`@pikar/vault/xlsText`) so ~1 MB enters ONE node action. Also a DEV-only dep of `@pikar/backend` for test fixtures; nothing in production imports it from there.
- **Adding a dependency to a node action?** Check its `package.json` for an `exports` map + a real ESM build FIRST — see the STATIC-import invariant below. That one fact predicts whether it will silently break in the deployed bundle while every test stays green.

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
- **Pitfall 9 — pdf-lib MUST be a STATIC import; a dynamic one silently yields `undefined`.**
  pdf-lib has no `exports` map (`main: cjs/index.js`), and Convex bundles node actions with
  esbuild `format: "esm", splitting: true`, which cannot synthesize a CJS module's named exports
  across a dynamic-import chunk — the namespace is `{ default }` only. Node/vitest hide this via
  `cjs-module-lexer`, so it is a DEPLOY-ONLY failure. `unpdf` may stay dynamic (ESM-only).
  Locked by the `pdf-lib is a STATIC import` static scan in `vaultExtract.test.ts`.
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

## Phase 15.2 — universal format recognition

One container section for the phase. Each plan appends ONLY its own `### Phase 15.2 — 15.2-0N`
subsection below and bumps `Last verified`; nobody rewrites another plan's subsection. On merge
conflict, keep both (`.planning/PARALLELIZATION.md` § Lane V).

### Phase 15.2 — 15.2-01 (pure recognition layer)

Landed 2026-07-27: `packages/vault/src/sniff.ts` + `schedulingRailFor` in `extractKind.ts`, plus
their tests and the Lane V ownership contract. **No `convex/` file was touched, so this plan proves
nothing about a live deployment** — it is the offline half of SC#1 and the first half of SC#4.

Invariants this establishes (trust this file over the plans):

- **Recognition is CONTENT-FIRST.** `resolveRail(bytes, mimeType, filename?)` reads the bytes; the
  MIME/extension answer from `extractionKindFor` survives only as the FALLBACK behind it. A wrong,
  renamed or ABSENT MIME type no longer decides anything on its own — an `.xlsx` renamed
  `budget.dat` with an empty MIME resolves to the zip rail, and an OLE2 blob is told apart
  (doc/ppt/xls) from its own UTF-16LE directory stream names. The sniff is an OVERRIDE, not a
  replacement: `image/webp` bytes the magic table does not enumerate still reach the image rail
  through the fallback.
- **The scheduling decision is TOTAL.** `schedulingRailFor` cannot answer "nothing" — its return
  type is `"transcribe" | "extract"`, pinned by a property test over ~20 assorted MIME strings. The
  `kind === null → don't schedule` branch is the root cause of the 2026-07-26 `.xlsm` stranding
  (~20 h at `pending_extraction`, 0 chars, no `failureReason`), and it is gone BY CONSTRUCTION
  rather than by patching the reported call site. RESEARCH §3 lists all three sites that carried it:
  `vault.vaultUpload`, `vaultSweep.sweepPendingExtraction`, and `vaultSweep.retryExtraction` — the
  last being the user's Retry button, where a press produced nothing observable.
- **Why the sniff is NOT at the scheduling gate.** `ctx.storage.get` is ACTION-ONLY (queries and
  mutations get `getUrl`/`getMetadata`), so a magic-byte sniff physically cannot run inside
  `vaultUpload` or a migration mutation. Recorded here so nobody "improves" the design by moving
  the sniff back to the gate, where it cannot work. We schedule permissively and let the ONE place
  that can read bytes decide.
- **Why client-side sniffing is NOT the authority.** `Dropzone.tsx` holds the real `File` and could
  sniff it, but that is untrusted input at a trust boundary. Acceptable only as a fast pre-upload
  error message, mirroring the duplicated size caps at `Dropzone.tsx:25-26` — never as the decision.

Ponytail ceilings taken (both named in source):

- **OLE2 discrimination is an 8 KiB needle scan**, not a real CFB directory walk. Upgrade path:
  parse the FAT/DIFAT if a real file ever hides its directory past 8 KiB.
- **JSON / YAML / TSV / LOG ride the `"text"` rail** instead of widening the searchable-MIME
  allow-list, which is DUPLICATED (`packages/vault/src/categories.ts:24` and the vault
  `Dropzone.tsx:28`). Widening two allow-lists while this phase deletes a third is the wrong
  direction; the `"text"` rail gives the same user-visible outcome at the cost of one $0, no-model
  extraction action per upload. Upgrade path: widen both sets if that round-trip ever shows up as
  latency the user notices.

`sniff.ts` is dep-free (no `fflate`, no `node:*`) and is therefore re-exported from the
`@pikar/vault` index barrel — unlike `officeText.ts`, which stays subpath-only for V8-bundle
hygiene. Verify with `pnpm --filter @pikar/vault test` + `typecheck`.

### Phase 15.2 — 15.2-02 (format coverage, pure layer)

Landed 2026-07-27: `extractOfficeText` rewritten as a ZIP-entry dispatcher, plus the new dep-free
`packages/vault/src/rawText.ts`. **No `convex/` file was touched, so — exactly as with 15.2-01 —
this plan proves NOTHING about a live deployment.** It is the offline half of SC#2 and the
dependency-free half of SC#3. No dependency was added; `pnpm-lock.yaml` is untouched.

Invariants this establishes (trust this file over the plans):

- **`extractOfficeText` takes ONE argument.** It unzips once and dispatches on the MARKER ENTRY it
  finds. Adding `mimeType` back is a REGRESSION: it reintroduces the enumeration that lost the
  owner's `.xlsm`. Note what that file actually needed — **no new parser, only routing**. An
  `.xlsm` is byte-structurally an `.xlsx`: same ZIP, same entries, same walker. That is why the
  defect looked far larger than it was, and why entry dispatch makes coverage true BY CONSTRUCTION
  rather than by a list that is always one format behind.
- **The marker-entry table**, checked in this order (OOXML markers FIRST — an archive carrying both
  a `word/document.xml` and an ODF `mimetype` resolves deterministically to DOCX, and is pinned by
  a test):

  | Marker entry | Format |
  |---|---|
  | `word/document.xml` | DOCX / DOCM |
  | `xl/workbook.xml` | XLSX / **XLSM** |
  | `ppt/presentation.xml` | PPTX / PPTM |
  | `mimetype` starting `application/vnd.oasis.opendocument.` | ODT / ODS / ODP |
  | `META-INF/container.xml` | EPUB |

  No marker at all throws `office_parse_failed: unrecognized zip` — the message names the ZIP, not a
  mime type, because there is no longer a mime type to name.
- **The barrel rule is about DEPENDENCIES, not about which file it is.** A module that imports
  `fflate` or `node:*` is subpath-only, to keep those out of the V8 Convex bundle; a dep-free module
  is barrel-safe. Today that means `officeText.ts` stays subpath-only (`@pikar/vault/officeText`)
  while `sniff.ts` and `rawText.ts` are on the barrel. Any NEW parser module follows whichever side
  of that rule its dependencies put it on.
- **`oleText` THROWS rather than returning `""`.** An empty extraction that "succeeds" becomes a
  `ready` document with 0 chars — a plausible failure, which is worse than a failure, and is the
  exact silent-plausible class this phase exists to remove. `rtfText` throws on the same condition
  for the same reason. This is the same reasoning that rejects a printable-text sweep for BIFF.
- **`decodeEntities` now lives ONLY in `rawText.ts`**; `officeText.ts` imports it from there. One
  entity decoder, three callers — a future entity fix lands in exactly one place. The ODF and EPUB
  walkers likewise REUSE `runsOf` / `markupText` rather than adding a second XML walker.
- **The OLE2 stop-list is matched on the WHOLE run, never as a substring.** A substring rule would
  delete any sentence containing the word "Data". The `0x05` prefix on the two SummaryInformation
  streams is not a printable byte, so those runs already surface as the bare name and match exactly.
- **`TextDecoder("windows-1252")` is constructed LAZILY**, never at module scope. `rawText.ts` is on
  the barrel, and that constructor throws `RangeError` on a runtime built without full ICU; a throw
  at import time would take down every module that touches the barrel, whereas a throw inside
  `rtfText`/`oleText` is one honest `failed` document.

Ponytail ceilings taken (both named in source):

- **Legacy DOC/PPT is a printable-run SWEEP**, deliberately imperfect — no field codes, no table
  structure, no reading-order guarantee, and a UTF-16LE character outside Latin-1 is skipped. A
  downstream LLM structures the text; we are not round-tripping the file. Upgrade path if fidelity
  complaints surface: `word-extractor` for DOC, SheetJS for PPT/XLS (plan 15.2-07's spike).
- **EPUB reads its `(x)html` entries in ENTRY-NAME sorted order**, not OPF spine order — a book
  whose files are not lexicographically ordered reads out of order. Upgrade path: parse
  `content.opf`'s `<spine>`. Sorting (rather than trusting object key order) is what makes the
  output deterministic, and there is a test for that.

Verify with `pnpm --filter @pikar/vault test` + `typecheck`.

### Phase 15.2 — 15.2-03 (permissive scheduling + in-action dispatch)

Landed 2026-07-27: the first plan of this phase to touch `convex/`. `vault.scheduleExtraction`,
`vaultSweep.watchdogStalled`, and a rail-driven dispatch inside `vaultExtract.extractDoc`. This is
what gives 15.2-01's `resolveRail` and 15.2-02's parsers a production caller.

Invariants this establishes (trust this file over the plans):

- **`vault.scheduleExtraction` is the ONLY way an extraction is scheduled.** Three callers:
  `vaultUpload`, `vaultSweep.sweepPendingExtraction` (the recovery sweep) and
  `vaultSweep.retryExtraction` (the user's Retry button). It ALWAYS schedules and it ALWAYS arms a
  watchdog. **A fourth caller that schedules `extractDoc` directly reopens the defect** — route it
  through the helper, exactly as `vaultIngest.startIngest` is the sole ingest starter.
  Two things it deliberately does NOT do: it does not SNIFF (`ctx.storage.get` is action-only, so a
  mutation physically cannot see the bytes), and it does not decide SUPPORTABILITY (that decision
  belongs to the one runtime that can read bytes, and its refusal is terminal).
- **Every non-terminal status has exactly ONE governor, and they cannot fight:**

  | Status | Governor | Armed by |
  |---|---|---|
  | `pending_extraction` | `vaultSweep.watchdogStalled` at +15 min | `scheduleExtraction`, per attempt |
  | `extracting` | `vaultSweep.watchdogStalled` at +15 min | the same scheduled call |
  | `processing` | `vaultIngest.onIngestComplete` | `startIngest`'s `onComplete` (the 2026-07-20 stranding fix) |
  | `ready` / `failed` | terminal — nothing may re-flip them | — |

  `watchdogStalled` NEVER touches `processing` (two governors on one status is how you get a flip
  war) and NEVER overwrites an existing `failureReason` — a watchdog firing one second after a
  success, or after an honest `unsupported_format`, changes nothing. Its guard is the
  `onIngestComplete` guard, and it writes through `internal.vault.markFailed` so the terminal
  failure write stays in one place.
- **The watchdog is a SCHEDULED FUNCTION, not a cron.** There is no "status began at" field:
  `createdAt` is UPLOAD time, so a `createdAt`-based cutoff would kill a Retry on a 20-hour-old row
  on its very first tick. Per-attempt scheduling is correct where a table scan is not, needs no
  schema change, and is a native Convex durability feature rather than new code.
  `EXTRACTION_WATCHDOG_MS` is 15 min — above any honest attempt (the 480 s per-call ceiling and
  Convex's 10-minute node-action limit both bound one run), so it can never kill live work.
- **The rail is resolved from the BYTES, inside the action** — `resolveRail(bytes, mimeType, title)`
  after `ctx.storage.get`. `extractionKindFor` no longer appears in `vaultExtract.ts` at all, and a
  static scan enforces that: a byte-sniffed rail and a MIME guess disagreeing is how "it works
  except when it doesn't" gets built. The SMOKE short-circuit stays AHEAD of the dispatch
  (`vaultSmoke.ts` depends on it) — also pinned by a static scan.
- **A sniffed image with a wrong or EMPTY MIME is sent with a real `mediaType`.** Otherwise SC#1
  would "work" right up to the point the model call was silently malformed.
- **The failure-reason vocabulary now visible to a user**, and what each one means:

  | Reason | Meaning |
  |---|---|
  | `unsupported_format` | the bytes are not something any rail can read |
  | `unsupported_legacy_spreadsheet` | legacy BIFF `.xls`; remedy: re-save as `.xlsx` (SheetJS pending in 15.2-07) |
  | `office_parse_failed` | a ZIP-based office document that would not flatten |
  | `legacy_parse_failed` | an OLE2 DOC/PPT the printable-run sweep could not read |
  | `raw_parse_failed` | RTF that would not parse |
  | `empty_extraction` | the extraction succeeded and recovered ZERO characters |
  | `extraction_stalled` | still non-terminal 15 minutes after its attempt was scheduled |

- **`empty_extraction` exists on purpose.** A `ready` row with 0 chars is a PLAUSIBLE failure — the
  agent then grounds confidently on nothing — which is worse than a failure. Same reasoning as
  `oleText` throwing instead of returning `""`. Do not "fix" it by storing the empty string.
- **The corrected reading of the spec's "terminal `failed` at the `vaultUpload` chokepoint".** The
  INVARIANT holds exactly as written — an unresolvable format is terminal `failed`, never a silent
  `pending_extraction`. Its LOCATION is the action, not the chokepoint, because `ctx.storage.get`
  is action-only. This is recorded here so a future reader does not file it as a deviation.

Two test fixtures were content-LIES that content-first recognition exposed, and were corrected
rather than worked around: the PNG fixture wrote `\x89` in a JS string, which the Blob encodes as
UTF-8 `0xC2 0x89` — decodable text, not a PNG — and printable `SMOKE::extract::` bytes honestly
sniff as the `text` rail, so the audit `kind` on those rows reads `"text"`. The audit payload keeps
its `kind` KEY (existing readers unaffected) and now carries the rail: a label, refs/counts only,
never document text (§4).

**NOT YET PROVEN.** Everything above is offline-green only. This subsystem has two consecutive
incidents on record — Pitfall 9 (dynamic `pdf-lib`), then the 480 s timeout — where a green suite
sat on top of a production path that could never run. The `.xlsm` recovery is verified in plan
15.2-05 against the real deployment; nothing in this subsection should be read as live-verified
until that subsection exists.

Verify with `pnpm --filter @pikar/backend test vaultSweep -- --maxWorkers=1`,
`pnpm --filter @pikar/backend test vaultExtract -- --maxWorkers=1`, and
`grep -c "extractionKindFor" packages/backend/convex/vault.ts packages/backend/convex/vaultSweep.ts packages/backend/convex/vaultExtract.ts`
(expect 0 for all three).

### Phase 15.2 — 15.2-04 (staleness, the graph cap, failure copy)

Landed 2026-07-27. Three honesty gaps that are not about parsing. Offline-green only.

**Where stale attempt state is cleared — and why NOT elsewhere.**

| Mutation | Clears | Why there |
|---|---|---|
| `vault.markExtracting` | `failureReason` **and** `extractionTruncated` | runs at the START of every attempt (`vaultExtract.ts:165`, before any parsing). A new attempt has neither a failure nor a truncation yet. |
| `vault.markReady` | `failureReason` **ONLY** | the backstop for the seam that never passes through `markExtracting` |

**THE TRAP, written down so nobody "restores" it.** The locked 15.2-CONTEXT decision reads
*"`markReady` clears `failureReason` + `extractionTruncated`"*. Clearing `extractionTruncated` at
`markReady` is a **defect** and is deliberately not implemented: `internal.vault.ingestExtractedText`
(`vault.ts:552`) writes that flag on the CURRENT attempt, moments before the ingest workflow reaches
`markReady`, so clearing it there erases a TRUE truncation flag on every successful large-document
ingest — and `extractionTruncated` is the only thing telling a downstream consumer that the grounded
text is a head slice. A regression test pins it: a doc whose current attempt truncated reaches
`ready` with `extractionTruncated` still `true`.

`markReady` keeps its half rather than relying on `markExtracting` alone because the late-text
`docId` seam in `vaultIngestText` reaches `processing` → `markReady` **without** passing through
`markExtracting`; a previously-failed doc rescued that way would otherwise keep its old reason.

**`extractGraph` is capped — `GRAPH_EXTRACT_CHAR_CAP` = 120_000 chars (`@pikar/vault` barrel).**
Before this, it was the ONE uncapped model call in the repo: `VAULT_EXTRACT_CHAR_CAP` (400k) bounds
what is STORED, and all of it was SENT. A test asserts `GRAPH_EXTRACT_CHAR_CAP <
VAULT_EXTRACT_CHAR_CAP` — the relationship is the point; lower the extraction cap below the graph cap
and the graph cap becomes dead code.

- **Ordering is REDACT-then-CAP, never cap-then-redact.** `scanText` must see the WHOLE document, or
  PII in the tail escapes both the scan and the audit counts. `capGraphText` is applied to
  `safeText`, after the fail-closed scan.
- **The SMOKE short-circuit stays ABOVE the cap**, so the offline fixture path is unaffected.
- `ponytail:` ceiling — a HEAD SLICE, not chunk-wise fan-out. Entities appearing only in the tail of
  a very long document are missed, and **nothing persists a "graph truncated" flag** (no schema
  change was permitted this phase). Upgrade path: chunk-wise extraction with node/edge union across
  chunks, deferred until entity recall is observed to suffer.

**`apps/web/app/(app)/dashboard/vault/failureCopy.ts` is the ONE place a reason code becomes prose.**
Reason codes stay refs-only labels in `convex/` (§4); the user-facing wording lives in the surface
that renders it. Two callers — `DocGrid`'s failed card (title only, one truncated line, rendered as
card TEXT so the screen reader keeps the filename in the accessible name) and `PreviewModal`'s
failure block (title + remedy). **The raw code is never shown to a user** — it rides in a `title=`
attribute as a debugging affordance only. `PreviewModal`'s hardcoded "scanned or image-only PDFs"
sentence is DELETED; it was wrong for most of 15.2-03's vocabulary. The DOCV-01 clause that a failed
document offers no voice action is unrelated to the reason and survives verbatim.

**If you add a `fail("...")` anywhere in `vaultExtract` / `vaultTranscribe` / `vaultIngest` /
`vaultSweep`, you owe a row here** — otherwise the user reads the generic fallback.

| Reason | User-facing title |
|---|---|
| `unsupported_format` | We couldn't recognise this file's format. |
| `unsupported_legacy_spreadsheet` | This is a legacy Excel workbook (.xls). |
| `unsupported_video_container` | We can't transcribe this video format. |
| `no_audio_track_or_undecodable` | This recording has no audio we could transcribe. |
| `transcribe_timeout` | Transcribing this recording took too long, so we stopped. |
| `transcribe_failed` | We couldn't transcribe this recording. |
| `not_implemented` (legacy rows) | This file type wasn't supported when you uploaded it. |
| `empty_extraction` | We opened this file but found no readable text. |
| `extraction_stalled` | Reading this file took too long, so we stopped. |
| `office_parse_failed` / `legacy_parse_failed` / `raw_parse_failed` | We couldn't read inside this file. |
| `pii_scan_failed` | We stopped before storing this file's contents. |
| `kill_switch` / `daily_budget_exhausted` | Processing is paused right now. |
| `no_stored_bytes` / `missing_blob` / `missing_bytes` | The uploaded file couldn't be found. |
| `ingest_failed` / `ingest_canceled` | Something went wrong while indexing this file. |
| `extract_error: …`, unknown, absent | We couldn't read this file. (the generic row) |

`unsupported_legacy_spreadsheet`'s remedy — *"Open it in Excel and re-save as .xlsx, then upload it
again"* — is what makes the **SheetJS spike in 15.2-07 OPTIONAL**. If that plan never lands, this is
what the user sees, and it is actionable.

**NOT YET PROVEN.** Everything above is offline-green only: no upload was re-run and no failure card
has been viewed in a browser. `pnpm --filter web build` proves it compiles, not that it reads well.

Verify with `pnpm --filter @pikar/vault test`,
`pnpm --filter @pikar/backend test vault.test -- --maxWorkers=1`, and `pnpm --filter web build`.

## Invariants — what must never break

- **Domain logic in `@pikar/vault`, thin `convex/vault*` adapters (§1)** — the pure package has ZERO Convex imports; enforced by the colocated `packages/vault` tests running with no backend.
- **`namespace = tenantId` per-user isolation (VALT-03)** — every rag `add/search/delete` is namespaced by the tenant; reads/writes go through the `tenantQuery/tenantMutation/tenantAction` wrappers.
- **rag runtime split** — `rag.add/search/delete` are ACTION-only; `addAsync/deleteAsync/list/getEntry/findEntryByContentHash` are mutation/query-safe.
- **The graph-extractor lives in a DEFAULT-runtime (V8) `vaultLlm.ts`** — NEVER a second `"use node"` module.
- **Redact-then-extract (§4)** — the extractor receives `safeText`; graph/audit/deadLetter payloads carry refs + hashes + counts ONLY. Raw text lives ONLY in `vaultDocuments.text` + rag chunks.
- **Cross-doc dedup** — same entity across docs upserts to ONE node on `(tenantId, type, normalizedName)` via `normalizeName`, so the graph actually connects documents.
- **Hop cap = 2 (`GRAPH_HOP_CAP`)** — `bfsNeighbors` never expands past the cap; enforced by `traversal.test.ts`.
- **Pinned `rag`/`workflow` versions must not be bumped (§6)** — pre-1.0 API churn.
- **Every package reached from a `"use node"` action is a STATIC top-level import (Pitfall 9, generalised 2026-07-27).** Never `await import(...)`. Convex bundles node actions with esbuild `platform:"node", format:"esm", splitting:true`, and across a **dynamic-import chunk boundary** esbuild cannot synthesise a CJS module's named exports — the namespace carries only `default`. **THE DISCRIMINATOR IS THE PACKAGE MANIFEST, NOT THE IMPORT FORM:** a package with **no `exports` map and no real ESM build** collapses (`pdf-lib` → 1 key, `PDFDocument` undefined, live defect 2026-07-26); one shipping `"exports": { ".": { "import": "./x.mjs" } }` survives both forms (`unpdf`; `xlsx` 0.20.3 → 19 named exports either way, measured). **So: before adding ANY dependency to a node action, read its `package.json` for an `exports` map + ESM build — that single fact predicts the failure.** **A GREEN OFFLINE SUITE IS NOT EVIDENCE** — Node and vitest recover CJS named exports via `cjs-module-lexer`, so the broken production path is invisible in the suite (proven on demand: making the SheetJS import dynamic turns the scan red while **all 10 behaviour tests stay green**). Verify by rebuilding a probe with Convex's own flags from `convex/dist/esm/bundler/debugBundle.js` **and include a known-collapsing control**, or by a deployed run. Enforced by two static scans: `pdf-lib` in `vaultExtract.test.ts`, SheetJS in `xlsText.test.ts`.
- **An ingest run can NEVER strand a doc at `processing`.** `ingestDoc` writes a terminal status only on success (`markReady`) or a governed stop (`markFailed`); a DEAD run (step retries exhausted, backend interruption) writes neither. So every ingest MUST start via `vaultIngest.startIngest`, which attaches `onComplete: onIngestComplete` — a failed/canceled run flips a still-`processing` doc to `failed` (idempotent; success + already-terminal untouched). A bare `workflow.start(ingestDoc)` is the bug (five sites once did it → infinite "processing" spinners). Enforced by: the 4 `onIngestComplete` cases in `vault.test.ts`; recover any historical strands with `retryStuckIngests`.
- **The confirmed `business_blueprint` is explicitly NOT an ingest run.** `confirmBlueprint`
  writes the content-plane row directly at `status: "ready"` and deliberately starts no workflow,
  so the “every ingest starts through `vaultIngest.startIngest`” invariant remains intact. The
  Blueprint is neither embedded nor graph-extracted: retrieval cannot duplicate the standing
  spine, and the document cannot feed its own entities back into the next rebuild's degree ranking.
  `vaultSweep.sweepPendingExtraction` touches only `pending_extraction` rows that carry a
  `storageId`; the Blueprint is `ready` and byte-less, so it is never swept.

## How to change safely

- **New graph traversal / fusion behavior** → change `@pikar/vault`, add a colocated test, keep it Convex-free. The Convex `vaultGraph.expand` query builds the adjacency and calls `bfsNeighbors`; `vaultGround` calls `fuse`.
- **New category / searchable format** → edit `categories.ts` + its test; do NOT scatter category strings into adapters.
- **New ingest step** → add a durable workflow step; keep the redact-before-LLM ordering.
- **Schema change** → new tables / optional fields, no migration (prior-phase discipline).

## How to verify

- `pnpm --filter @pikar/vault test` — pure-domain tests (normalize, categories, traversal, fusion).
- `pnpm --filter @pikar/vault typecheck` — clean.
- `pnpm --filter @pikar/backend test vault vaultGround` — the Convex adapter tests: ingest/dedup/cascade + the read plane (grounding fusion, hop-cap, cross-tenant isolation, browse/stats/download-guard/docEntities/category-search). Windows note: convex-test files crash on parallel-fork teardown ("Cannot set properties of undefined (setting 'exit')") → false red; each file passes run alone.
- `pnpm --filter @pikar/backend test vaultExtract -- --maxWorkers=1` — the extraction dispatcher: rail dispatch, the per-page fan-out's SHAPE (batch width, page order, per-page isolation, the deadline), and the static scans (pdf-lib static import; the hosted branch not sending the whole document as one call). **Green here does NOT mean scanned PDFs are transcribed** — see the hosted-path check below.
- **The hosted (scanned-PDF) path is LIVE-ONLY.** The offline suite proves batching shape, and shape stays green when the model digests instead of transcribing. To verify it for real: re-extract a scanned PDF on a running deployment (`npx convex run internal.vaultExtract.extractDoc '{"vaultDocId":"…","tenantId":"…"}'` from `packages/backend`) and read the stored text — it must carry `Page 1`…`Page N` headers and **read like the document**, not like a description of it. `internal.vault.getDoc` returns the text without dumping the 20 MB `vaultDocuments` table.
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
- **Scanned/image-only PDFs extract a SUMMARY, not verbatim text** (~2.2k chars for a 12-slide
  deck, measured live 2026-07-26). `extractPdf` sends the WHOLE PDF as one file part in one
  gpt-4o-mini call, but the `attachment-extractor` skill's contract is written for "a single image
  or document (PDF page…)" — given 12 pages at once the model digests instead of transcribing,
  despite the prompt's explicit "extract ALL of it VERBATIM" / "Never summarize". The prompt and the
  seeded registry row are correct and byte-identical; the CALL SHAPE is the defect. Upgrade path:
  per-page fan-out (pdf-lib `copyPages` already emits 1-page PDFs, which is exactly the shape the
  skill documents), concatenated in page order. Needs batching/a workflow step rather than a plain
  loop — `VAULT_EXTRACT_PAGE_CAP` (50) sequential hosted calls will not fit one action's 10-minute
  limit. Text-layer PDFs are UNAFFECTED (unpdf returns the real text layer, free and complete).
- **Large-doc extraction memory/time** — the 100 MiB doc cap lets a very large PDF reach the
  extraction action; `unpdf`/OCR on such a file may approach Convex action memory/time limits. The
  page cap (`VAULT_EXTRACT_PAGE_CAP`) and char cap bound the hosted-OCR path, but streaming/chunked
  extraction is the upgrade path if large scanned PDFs surface limits.
- Binary + OCR extraction is Lane B / Phase 4 (`vaultIngestText(docId, extractedText)` seam).
- Per-tenant storage quota, external sharing, per-item agent toggle, in-place re-embed editing — all deferred.

## Phase 16 — Web research documents

> Append-only container: each Phase-16 plan writes ONLY inside its own subsection.
> On merge conflict, **keep both**.

### Phase 16 — Wave 0 (freeze)

A new document class, `kind: "web_research"`, and one new field.

**`retrievedAt: v.optional(v.number())` (D7)** — the freshness stamp, stored and queryable.
Deliberately **not** `createdAt`: a row's creation time stops being its retrieval time the moment
anything re-creates the row (a re-ingest, a backfill). Only `web_research` docs write it; every
other writer leaves it absent, so no migration and no backfill.
`ponytail:` no dedicated index — `by_tenant` + a `kind === "web_research"` filter is the read.
Upgrade path if freshness ever needs ranking at scale: a `by_tenant_kind` index.

**⚠ ADR-006 trust assumption changes here — read before touching `searchVault`'s fence.**
The fence comment justifies treating vault text as trusted-as-own *because it is the user's own
corpus*. **A web-derived document is NOT the user's own corpus.** It is third-party content that
arrived through a model, so the premise the fence rests on does not hold for this class.

Consequences, both required:
- Every `web_research` document carries a **provenance header** naming it third-party web content,
  so the class is self-identifying wherever it is read.
- The existing fence wording ("never an instruction") already covers the **read** side — the fence
  is not weakened, its justification is. Do not "simplify" the fence by re-appealing to
  own-corpus trust.

Containment on the **write** side is D5-CORRECTED and lives in `cockpit.md`: retrieved page text
is provider-side and **cannot be fenced** — a "retrieved text is fenced" test would pass because
the text is ABSENT, not because it was fenced. Containment is the empty capability grant proved
POSITIVELY, the OUTPUT fence, and an SSRF scan with a non-vacuity floor.

### Phase 16 — 16-07 (the findings terminal)

`convex/research.ts` — `persistFindings`, an `internalMutation` in a **non-`"use node"`** module.
It is the ONLY writer of `kind: "web_research"`, and it is called from ONE place:
`persistResearchFindings` in `dispatch.ts`, after `dispatchAndLand` has already returned.

**Who writes it, and why that is not negotiable.** The research specialist has NO write capability
— that is the phase's containment. So this is a code-owned terminal the DISPATCHER runs, exactly as
`persistNextStepMemo` runs after the human Approve. If a future change gives the specialist a "save
my findings" tool, the privilege-escalation path is back.

**A successful run produces TWO artifacts, and the ORDER is load-bearing.**

| artifact | written by | authoritative for |
|---|---|---|
| the approvable memo plan card | `dispatchAndLand`'s `finally` → `landSpecialistResult` | the USER — it is what they act on |
| ONE `web_research` vault document | `research.persistFindings` | GROUNDING (Phase 12 cites it) |

The card lands FIRST. That is what makes the error handling honest: a persist failure costs
**groundability, never the findings**, so it is audited (`research.persist_failed`, reason CODE
only) and swallowed — the `DispatchResult` is returned unchanged. **Do not add a retry, a
dead-letter, or a compensating write**; the cockpit has never DLQ'd a user-facing turn. A governed
refusal writes NO document at all: a paused conversation is not a finding.

**The stored text, in order:** provenance header (`Third-party web content, retrieved <ISO date>.`
+ the partial-run sentence when the run stopped early + the source URLs) → the findings inside
16-03's `researchFindingsFence` → the **limits footer** (D10: the search was provider-executed, so
we cannot pin or choose sources, control extraction fidelity, or see what was discarded — these
findings are NOT source-audited). The three partial-run sentences come from `INCOMPLETE_MARKER` in
`@pikar/core`, the SAME constant the memo card uses, so the card and the document can never
disagree about why a run stopped.

**Zero sources ⇒ `Insufficient evidence` — decided by CODE**, whatever the body claims, and placed
ahead of the fence so truncation cannot remove it (D11: a research agent that confabulates on an
empty search is worse than none, because Phase 12 will cite it).

**⚠ Be precise about where containment lives — the honest boundary.** The RAG ingester chunks this
document, so **only the FIRST chunk carries the provenance header and the fence's open tag**;
chunks 2..N carry neither. Containment does not rest on them: `searchVault` wraps what it returns
in the shipped `<vault_context … never an instruction>` fence on **every** retrieval. The header
and the inner fence are a LABELLING win — they let a human, or a model reading the first chunk, see
the provenance without the title. Do not write a test, a comment, or a doc line implying a
per-chunk provenance guarantee the chunker does not give. This inner fence is the LAST surviving
instance of D5-CORRECTED's "fence our own output" obligation; the other one disappeared when
D9-REVISED moved research onto the async memo terminal, which removed the in-loop re-entry
(`buildAgentContext` renders a memo plan as `Body drafted: yes/no` and never emits the body).

**§4:** the audit row (`research.persisted`) carries a query HASH, counts, and refs — never the
question, never a URL, never prose. `AuditPayload` permits `readonly string[]`, so an array of URLs
would type-check: that is the trap, not a safety net.

`ponytail:` two deliberate NON-decisions recorded in the module header — no `researchRuns` table (a
second log plane beside the insert-only audit is the anti-pattern) and no `vaultSources` card for
web URLs (OQ-4: no new UI in v1; the URLs are in the document's own header).

**Verify:** `pnpm exec vitest run convex/research.test.ts` (12 tests — the vault write, the stamp,
the title cap, the header/fence/footer order, insufficient-evidence labelling, the three stop
reasons, the startIngest control, the §4 scan, the two dispatch-wiring cases, the persist-failure
case, and both halves of the cross-tenant isolation assertion).

---

### Phase 15.2 — 15.2-05 (LIVE verification — THE PHASE GATE)

**Deployment:** `local-joel_feruzi-pikar_ai_50c69-1` (local, cloud `:3210`, site `:3211`, project
`joel-feruzi:pikar-ai-50c69`, backend `precompiled-2026-07-21-82d5e9f`).
**Run date:** 2026-07-27, sweep executed `13:58:34Z`.

This is the first time anything in Phase 15.2 was proven against a running deployment. Plans
15.2-01 through 15.2-04 were all offline-green and each said so explicitly.

#### The target row — before and after, verbatim

`_id: mx725hvxy1vsjvtaa4hza18pms8b8gp4` · `Zainab_Blowing_Operators_KPIs_Feb_2026.xlsm` ·
`mimeType: application/vnd.ms-excel.sheet.macroEnabled.12` · created
`2026-07-26T21:33:43.121Z` (16.4 h stranded at the moment of the sweep).

| Field | BEFORE | AFTER |
| ----- | ------ | ----- |
| `status` | `pending_extraction` | **`ready`** |
| `text` | empty (0 chars) | **256,439 chars** (256,569 UTF-8 bytes) |
| `failureReason` | **absent** — the silent park | absent |
| `size` | `803281` | `256569` |
| `contentHash` | `e0a2d8bf…f75dcc` | `a8cd427e…97d913` |
| `ragEntryId` | empty | populated (`j97dq2n5rz…`) |
| `storageId` | `kg25zcy00acer8rt6gnwk55ph98b8d80` | **unchanged** |

**The extraction is substantive, not plausible.** 46 `Sheet N` markers, 3,084 lines, 2,313
numeric-bearing lines, and real cell values — `Zan Aqua 1.5 Ltr *6 → 80000 / 4800 /
16.666666666666668 / 600000`, with `#DIV/0!` spreadsheet error strings preserved verbatim. Headers
AND numbers survived; this is the shape SC#3's XLS half is warned about failing (headers alone ⇒
the parser silently degraded) and it is NOT that shape.

**`size` and `contentHash` change on every successful extraction, and this is PRE-EXISTING, not a
15.2 regression.** `vault.ts:632-633` (`ingestExtractedText`) writes `size: byteLen(text)` and
`contentHash: await contentHash(text)` — after ingest, `size` describes the EXTRACTED TEXT, not the
uploaded file. Consequence worth knowing: **the 803,281-byte fingerprint that identifies this row in
every Phase-15.2 planning document no longer matches the row.** Search by `_id` or `title`, and do
not conclude the row was deleted. Hash-dedup is keyed on the text hash by design (`by_tenant_contentHash`).

**No collateral damage.** A full row-by-row diff of `vaultDocuments` before vs after
(55 rows before, 55 after) shows **exactly one changed row** — the target. No row created, none
lost, no other `status` / `failureReason` / `size` altered.

#### ⚠ THE GATE'S OWN COMMAND IS A NO-OP — read this before trusting a sweep

`npx convex run vaultSweep:runSweep` **did nothing** on first invocation:

```
{ "Status": "Migration already done.", "lastFinished": "2026-07-18T03:35:23.430Z", "processed": 12 }
```

`runSweep` is `migrations.runner(internal.vaultSweep.sweepPendingExtraction)` — a
`@convex-dev/migrations` migration that records completion and **refuses to re-run**. It last
finished **2026-07-18**; the `.xlsm` was uploaded **2026-07-26**, eight days later, so it was never
in that run's cursor range and a bare `runSweep` will never look at it again. The recovery required
the argument the component's own output advertises as `toStartOver`:

```
npx convex run vaultSweep:runSweep '{"reset": true}'
→ { "Status": "Migration was started and finished in one batch.", "processed": 55 }
```

`reset: true` sets the cursor to null and re-scans the whole table. That is **safe here by
construction**: `migrateOne` early-returns unless `status === "pending_extraction" && storageId`,
so a full re-scan schedules extraction for exactly the rows that are stuck and touches nothing else
(observed: 55 processed, 1 changed).

**Operational rule going forward:** the documented one-shot `npx convex run vaultSweep:runSweep` in
`vaultSweep.ts`'s header comment is only correct the FIRST time. Any later backlog recovery must
pass `'{"reset": true}'`, or it will report success having done nothing — a silent no-op, which is
the same class of failure this entire phase exists to delete. The header comment in `vaultSweep.ts`
still shows the bare form.

#### Environment — the deployment was DOWN and had to be recovered first

The deployment was not running when this plan started, and this cost the first part of the run:

- Nothing listening on `:3210`/`:3211`; **no `convex-local-backend` process at all**.
- Three orphaned convex CLI processes from the previous day, all idle (0.00 s CPU delta over 12 s):
  a `dev --once --configure existing` hung since `21:51` (18 min after the `.xlsm` was uploaded, and
  the likely cause of the outage — cf. the untracked `.env.local.bak-before-configure` /
  `.bak-pre-repair` files), plus a `convex dev` that had burned **860 s of CPU** against a dead
  backend — the retry-storm signature, already burnt out.
- Recovery (owner-approved): kill exactly those three PIDs, verify the ports are free and nothing
  respawns, then **one** `convex dev --run skills:seedSkills` from `packages/backend`.
- **Seeding in the same push is not optional.** The ingest workflow's graph-extract step loads
  `graph-extractor` from the skill registry and fails closed with `NO_ACTIVE_SKILL` when unseeded,
  which would land the row at `failed` for a reason with nothing to do with extraction. Push
  reported `Convex functions ready! (36.14s)` with no bundler or type error before anything was read
  as a result.

Catch-up noise on restart, benign and recorded so it is not misread next time: `crons:purge` timed
out on system operations, and two `vault:deleteVaultDoc` calls threw `UNAUTHENTICATED`.

#### Still UNPROVEN after this plan — do not read the gate as broader than it is

- **SC#5 (verbatim scanned-PDF output) — UNPROVEN.** Plan 15.2-06 owns it. The 12-page deck is row
  `mx78ake083gn575pg43sw9j66x8b86eb`, still `ready` at **2,191 chars** carrying a stale
  `extract_error: The operation was aborted due to timeout`. (It is `ready` WITH a `failureReason`
  because 15.2-04's staleness fix only clears on the NEXT attempt — pre-existing rows keep theirs.)
- **SC#3's XLS half — UNPROVEN.** Plan 15.2-07 owns it. Legacy `.xls` still refuses with
  `unsupported_legacy_spreadsheet`, which is the honest interim answer, not a bug.
- This gate proves the **recovery** path (sweep over a stranded row). The **fresh-upload** path
  (`vaultUpload`) and the junk-file failure path are UI-only and are recorded below.

#### UI half — owner verdict: APPROVED, but only PARTIALLY OBSERVED

The owner approved the checkpoint. **Not every step was run, and the unrun ones are listed here
rather than rounded up into the approval.**

**OBSERVED — PASSED.** The owner uploaded a **`.pptx`** (the ZIP-family auto-progression test). It
**auto-progressed to `ready` with no button pressed**, and the preview rendered extracted text plus
the "No entities extracted for this document." empty state. This is the **first live confirmation of
the 15.2-01/02/03 spine on a NEW upload rather than a recovered row** — permissive scheduling and
byte-sniff rail dispatch working end to end on a format that was never in the old three-entry MIME
allow-list. That is a distinct proof from the sweep and is worth keeping separate.

**NOT OBSERVED — explicitly unverified live, do not read the approval as covering these:**

- **The `.xlsm` preview PANE contents were not reported.** The row-level 256,439-char result above
  stands on its own evidence; the **UI render** of it does not.
- **The junk-file → plain-English `failed` + remedy path was NOT run. 15.2-04's `failureCopy`
  remains UNVERIFIED LIVE.** No failure card has been viewed in a browser at any point in this
  phase. Compounding this: the `:3000` server is `next start` launched `2026-07-26 21:35:06` while
  `.next` was rebuilt `2026-07-27 16:22:39` — a process predating its own build, the Phase-14 trap
  recorded in `voice.md`. **Unless that process was restarted, even a later casual glance at that
  surface may be reading a stale bundle.** Restart before believing any vault-UI symptom.
- **Legacy `.doc`/`.ppt` (step 6) and legacy `.xls` (step 7) were not run.**

#### ⚠ KNOWN GAP — PPTX extracts TITLES ONLY, and scaffolding-only output reports `ready`

The owner's `.pptx` upload surfaced a real defect. **It is NOT a Wave-5 regression** — the
scheduling and dispatch spine did its job; the defect is one layer down, in the parser.

Row `mx7a40n7460cj3d1ww97bms6wd8bb9zg` (`Rejection Review- Mar 2026.pptx`), `status: ready`,
`ragEntryId` populated (full ingest including `extractGraph` + `upsertGraph` ran), **`size: 356` —
that is the ENTIRE extracted text**:

```
Slide 1\n-March 2026\nMonthly Rejection Overview\n\nSlide 2\nMonthly Rejection Overview- March 2026\n\nSlide 3\nTrend 2026…
```

**Root cause:** `pptxText` (`packages/vault/src/officeText.ts:70-76`) reads `<a:t>` runs from
`ppt/slides/slideN.xml` and nothing else. The deck's actual KPI content lives in
`ppt/charts/chart*.xml`, embedded worksheets and images — **entries already present in the same
`unzipSync` result, never opened.** The entity graph came back empty because it was handed 356 chars
of headings, not because the graph plane is broken. Do not go debugging `extractGraph` for this.

**The trap, and why it belongs in this playbook:** line 74 emits the `` `Slide ${n}` `` header
**UNCONDITIONALLY**, so a deck with zero extractable runs still produces non-empty text,
**`empty_extraction` never fires, and the row reports `ready`.** That is a **false-ready of exactly
the family this phase exists to delete** — the honesty gap was closed at the scheduler (15.2-03) and
is **still open one layer down, in the parsers**. `xlsxText` has the same shape at **line 65**
(`` `Sheet ${n}` `` emitted unconditionally), so the gap is a family, not a single site: any
scaffolding-only output passes the `empty_extraction` guard because the scaffolding itself is text.

**Disposition (owner):** new scope, sequenced as plan **15.2-08 after 15.2-07**, covering BOTH
halves — (a) walk chart / diagram / notes text, and (b) make scaffolding-only output fail honestly
instead of reporting `ready`. **Not fixed here by design**; a verification plan does not smuggle in
an edit.

---

### Phase 15.2 — 15.2-06 (per-page fan-out: scanned PDFs are TRANSCRIBED, not summarised)

**THE INVARIANT: the hosted branch sends ONE PAGE PER CALL.** `extractHosted`'s signature is
**unchanged** and is reused per page; the `attachment-extractor` skill row is **unchanged**. §5 is
satisfied by **REUSE**, not by a new prompt — the prompt was always right ("extract ALL of it
VERBATIM", "Never summarize"); the **input** was wrong. Its contract is written for *a single image
or document (PDF page…)*, so handing it a 12-page deck as one file part asked it to do something the
prompt never promised, and it did the reasonable thing: it digested.

**Anyone "optimising" this back into a single whole-document call reintroduces the defect — and the
offline suite will stay GREEN, because it proves batching *shape*, not verbatimness.** That is what
the static scan *"the hosted branch no longer sends the WHOLE DOCUMENT as one call"* in
`vaultExtract.test.ts` exists to stop.

#### The four constants, and why each number is what it is

| Constant | Value | Why |
| -------- | ----- | --- |
| `PAGE_BATCH_SIZE` | 6 | A bounded fan-out, not a throughput knob. Each page is its own hosted call **and** its own `recordSpend` write against **one keyless `dailySpendCents` window** (`guardrails.ts:166-173`), so the batch width is also the **OCC-contention width**. 6, not 50. |
| `PAGE_TIMEOUT_MS` | 60 s | `CALL_TIMEOUT_MS` (480 s) is **PER CALL** and was tuned for ONE whole-document call. Under fan-out every page would inherit all 480 s, letting **one stuck page eat the entire 10-minute action ceiling**. ~10 s/page is the measured norm — 60 s is 6× headroom. |
| `FANOUT_BUDGET_MS` | 420 s | The whole fan-out's wall-clock budget, under Convex's 10-min node-action limit with room for the surrounding scan/audit/seam work. Checked **before each batch**; expiry returns `truncated`. |
| `VAULT_EXTRACT_PAGE_CAP` | 50 | Unchanged and **still binding** — `pdfPages` applies it, so the cap survives the fan-out. |

`fanOutPages` reassembles into a **pre-sized array indexed BY PAGE**, so ordering is *structural*
rather than a sort someone has to remember. A failing or timed-out page contributes an
**`[unreadable]` marker, never a throw** (§4 — no SDK string, no parser string, no document
content). **`okPages` is the success signal, NOT the text being non-empty:** a document made
entirely of markers is non-empty, so `empty_extraction` would never fire on it — that is the same
false-ready family as the `Slide N`/`Sheet N` gap above. `okPages === 0` throws
`hosted_extract_failed` into `extractDoc`'s existing outer catch.

#### `recordSpend` fan-out — RESOLVED BY OBSERVATION (closes RESEARCH §11 item 4)

N spend writes where there was 1, against one keyless rate-limit window. It **cannot under-count**
(`reserve: true` lets the window go negative) and it **cannot throw** (the return value is ignored),
so the only exposure was OCC-retry latency at the batch width. **Observed live: 12 pages, 2 batches
of 6, zero OCC/write-conflict errors, zero new `deadLetters` rows, 77 s wall clock. Spend delta 13
cents** (`remainingDailyCents` 440 → 427, ≈1.08¢/page). Not assumed — measured.

#### `ponytail:` ceilings (named, not built)

- **`Promise.race`, not a threaded `AbortSignal`.** `extractHosted`'s contract is reused UNCHANGED
  and owns its own 480 s `abortSignal`, so a raced-out page's request **lingers in the background**
  — it just stops *blocking* the batch, and `FANOUT_BUDGET_MS` bounds the whole fan-out regardless.
  Upgrade path: thread an optional `timeoutMs` through `extractHosted` (one optional parameter;
  every existing call site unchanged).
- **Batching inside ONE action, not a durable workflow.** Beyond the page cap this needs a workflow
  or the already-installed `@convex-dev/workpool`.

#### ⚠ `extractionTruncated` will now start appearing on long scans — EXPECTED, not a regression

A verbatim 50-page transcription is **far** more likely to reach `VAULT_EXTRACT_CHAR_CAP` (400k)
than a summary ever was. 15.2-04 made sure the flag survives into `ready`. Do not "fix" it.

#### Live result — 2026-07-27, `local-joel_feruzi-pikar_ai_50c69-1`

Row `mx78ake083gn575pg43sw9j66x8b86eb` — `The_AI_Executive_OS.pdf`, 12 pages, no text layer.

| | BEFORE | AFTER |
| --- | --- | --- |
| `charCount` (audit) | **2,161** | **7,868** (3.64×) |
| shape | one whole-document call → a digest | 12 per-page calls → `Page 1`…`Page 12` |
| `[unreadable]` markers | n/a | **0** |
| per-page chars | n/a | 344–986, evenly distributed |
| `status` | `ready` (stale `extract_error: … aborted due to timeout`) | `ready` |
| spend | 1 call | 13¢ / 12 calls, no OCC |

Content is **verbatim, not descriptive**: slide copy, a reproduced comparison table, and specific
figures preserved (`$53.2B`, `44.9% CAGR`, `2,136 commits`, `www.pikar-ai.com`). No digest tell
("Here's a breakdown…", "The document discusses…") appears anywhere in the 7,868 characters.

**OWNER VERDICT: ✅ APPROVED — "the text reads as transcription, not summary."** SC#5's substance is
**CLOSED** on the owner's own reading. (The block above was written BEFORE the blocking checkpoint,
marked PENDING, on the 15.2-05 precedent — a session limit cut 15.2-04 mid-task, and a verification
living only in a chat transcript did not happen.)

**Exactly what the verdict rests on, stated so nobody reads it as broader than it is:** the owner
read the **Page 3 and Page 11 excerpts** plus the character-count / page-header / no-digest-tells
evidence above, and judged it transcription. **The verdict was given from the recorded row data and
those excerpts, NOT from a browser session** — at verdict time the `:3000` server was still the
stale `next start` (PID 14512, launched 2026-07-26 21:35:06, against a `.next` built 2026-07-27
16:22:39), the same staleness 15.2-05 reported. **No vault-UI check happened here.** The preview
pane's rendering of a fanned-out scan remains unobserved, exactly as `failureCopy` does.

Two properties of the new hosted path to carry forward:

- **`extractionTruncated` is now EXPECTED on long scans.** A verbatim 50-page transcription is far
  likelier to hit the 400k `VAULT_EXTRACT_CHAR_CAP` than a summary was. **That is not a regression.**
- **13¢ across 12 calls is the new per-scan cost shape** (≈1.08¢/page), replacing one call per
  document. A 50-page scan is ~50 calls. The daily budget (`DAILY_BUDGET_CENTS` 500) is unchanged
  and still the ceiling.

---

### Phase 15.2 — 15.2-07 (legacy XLS / SheetJS)

**SPIKE RESULT: GO — and the live round trip is CLOSED.** SheetJS survives a bundle built with
Convex's exact esbuild flags, the `.xls` rail now runs the real parser instead of 15.2-03's honest
refusal, and **a real legacy `.xls` uploaded to the deployment reached `ready` with its numbers
visible. OWNER VERDICT: APPROVED. SC#3's XLS half is CLOSED.**

**Exactly what that verdict rests on, stated so nobody reads it as broader than it is:** the owner
confirmed the checkpoint's stated criterion directly — the file reached `ready` and the preview
showed **numbers, not headings-only**. **No individual figures were transcribed back to me and no
cell values were diffed against Excel**, and no failure reason was reported. The claim this
supports is "the round trip works and did not degrade to header recovery" — not "every value was
verified correct".

(The rest of this block was written BEFORE the blocking checkpoint, marked PENDING, on the
15.2-05/06 precedent: a verification living only in a chat transcript did not happen.)

#### The pinned dependency, and why NOT npm

```
xlsx: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

**EXACT, no caret (§6), and doubly so because it is not a registry package.** The vendor's own CDN
is the only supported channel. **npm `xlsx@0.18.5` — the last registry publish — is NOT an option
to "just try first":** CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS). This code
parses **untrusted uploads**, so the registry version is disqualified on input, not on preference.
Treat it like the other pinned pre-1.0 components: do not bump casually.

#### The spike, with the numbers — reusable for ANY future dependency in a node action

The single fact that predicts the hazard is the installed package's own manifest:

| Package | `main` | `exports` map | ESM build |
| --- | --- | --- | --- |
| `pdf-lib` (the 2026-07-26 defect) | `cjs/index.js` | **NONE** | none |
| `xlsx` 0.20.3 | `xlsx.js` | **YES** — `"import": "./xlsx.mjs"` | **yes** |

Rebuilt with Convex's flags read out of `convex/dist/esm/bundler/debugBundle.js` (`innerEsbuild`)
and the `platform: "node"` call site in `cli/lib/config.js` — `bundle, platform:"node",
format:"esm", target:"esnext", conditions:["convex","module"], splitting:true, treeShaking,
minifySyntax, minifyIdentifiers, keepNames`, no `convex.json` so no external-package allow-list.
esbuild 0.27.0. **Observed namespace keys:**

| Probe | Chunks | Namespace keys | Result |
| --- | --- | --- | --- |
| SheetJS **STATIC** import | 1 | **19** — `CFB, SSF, default, parse_xlscfb, parse_zip, read, readFile, readFileSync, set_cptable, set_fs, stream, utils, write, …` | `typeof read === "function"`, `typeof utils.sheet_to_csv === "function"` PASS |
| SheetJS **dynamic** `await import()` | 3 | **19** — also survives | PASS |
| **CONTROL** `pdf-lib` dynamic | 3 | **1** — `default` only | `typeof PDFDocument === "undefined"` FAIL |

**The control is the point.** Without it, "SheetJS was fine" is indistinguishable from "the probe
cannot see a collapse". The pdf-lib control still collapses under the identical harness, so the
SheetJS result is a measurement rather than a reassurance.

#### Pitfall 9 restated as a GENERAL rule (it is not a pdf-lib quirk)

> **Any package reached from a Convex node action must be a STATIC top-level import.** The
> predictor of collapse is **the absence of an `exports` map with a real ESM build**, not the
> import form: a CJS-only package crossing a dynamic-import chunk boundary loses its named exports
> because esbuild cannot synthesise them there. **Offline green is NOT evidence** — Node and vitest
> recover CJS named exports via `cjs-module-lexer`, so the broken production path is invisible in
> the suite. Only a deployed run, or a rebuild under Convex's own flags, proves it.

SheetJS is the **`unpdf` case** (real ESM, survives both forms), not the `pdf-lib` case. The static
import is used anyway: it is the shape that was actually proven, it costs nothing, and a version
bump could drop the ESM build without a single test going red. **Two static scans now lock this
rule** — `pdf-lib` in `vaultExtract.test.ts` and SheetJS in `xlsText.test.ts`. The xlsText scan
strips comments before matching, because that file deliberately spells out the banned form.

#### Why a text sweep was NEVER an option for BIFF

Legacy `.xls` stores numbers as **binary doubles**. A printable-run sweep (`oleText`) recovers the
column headers and **silently loses every value** — a spreadsheet that reads as a document with no
data in it. That is a *plausible* failure, which is worse than a failure, and is the exact shape
this phase exists to delete. **`oleText` must never be pointed at `.xls`.** `xlsText.test.ts`'s
headline case is named *"numbers survive — the exact thing a text sweep silently loses"* precisely
so the distinction stays visible.

#### Shape of the code

- **`packages/vault/src/xlsText.ts` is SUBPATH-ONLY** (`@pikar/vault/xlsText`), never on the barrel
  — the `officeText.ts` rule, for ~1 MB instead of a few KB. It enters exactly one node action.
  The barrel's NOTE comment now states the rule where someone would otherwise add the export.
- **REJECTED, do not re-propose:** consolidating all spreadsheet handling onto SheetJS and deleting
  the `fflate` XLSX path. It removes code but adds ~1 MB to a deliberately lean bundle, and the
  fflate path is shipped and tested.
- **TRUST-BOUNDARY GUARD — a measured hazard, not a defensive flourish.** SheetJS's `read()` falls
  back to a **DSV/plain-text guesser** for unrecognised bytes, so **64 bytes of noise come back as a
  workbook holding one cell of mojibake** — non-empty, so it would clear `empty_extraction` and be
  stored as a `ready` document. `xlsText` therefore gates on `sniffContainer(bytes)` (dep-free,
  already on the barrel — reuse, not new code) and accepts only `ole2` or `zip`.
- **The success signal is `okSheets`, a COUNT** — the 15.2-06 `okPages` rule. The `Sheet N` header
  is emitted **only for a sheet that actually yielded content**, so **this file is deliberately NOT
  a third instance of the `Slide N`/`Sheet N` false-ready family** (`officeText.ts:65` and `:74`
  emit theirs unconditionally — still open, plan 15.2-08).
- Throws `xls_parse_failed: <reason>` — **our string, never SheetJS's** (§4). Never returns `""`.

#### ponytail ceilings, all MEASURED against 0.20.3

- **DATES:** in a **SheetJS-written** `.xls` a date surfaces as the Excel **serial** (`46067`), not
  `2/14/26`, because its BIFF8 *writer* emits no date number-format record; **`cellDates: true` does
  not change it** (measured). The same workbook as `.xlsb`/`.xlsx` renders the date. **CLOSED
  2026-07-29 on a real Excel-authored `.xls`:** 31 numeric date cells stored raw serial `46232`
  plus Excel's `[$-F800]dddd\,\ mmmm\ dd\,\ yyyy` format record; `xlsText` emitted
  *"Wednesday, July 29, 2026"* 31 times and the raw serial zero times. If another real file reports
  serial dates, the upgrade path is a per-cell `t === "d"` walk instead of `sheet_to_csv`.
- **FORMULAE:** the cached **value** appears, not the formula string; the `.xls` round-trip drops
  the formula entirely.
- **MERGED CELLS:** value once, blanks for the spanned cells (`sheet_to_csv` default).
- **XLSB:** supported by SheetJS's writer, so it is covered by a real fixture rather than a guess.
- **No cell/sheet cap** — `VAULT_EXTRACT_CHAR_CAP` downstream is what bounds a huge workbook.

#### Two honest terminal endings on the XLS rail, one earlier than you would guess

| Input | Reason | Why |
| --- | --- | --- |
| OLE2 with a `Workbook` stream but no BIFF content | `xls_parse_failed` | reaches the parser, which throws |
| A real `.xls` **truncated in half** | **`unsupported_format`** | halving removes the CFB **directory sector**, so `ole2Kind` can no longer find `Workbook` and the **dispatcher refuses one rail earlier** — `xlsText` is never called |

Both are terminal and both are pinned. **Do not "fix" the second reason to the one that reads
better** — it describes what actually happens.

`unsupported_legacy_spreadsheet` is no longer produced by this rail. **Its `failureCopy` row STAYS**
— historical rows still carry the code, and deleting the row would render them as a raw code.

#### What was proven live, and what was not

Deployment `local-joel_feruzi-pikar_ai_50c69-1`, 2026-07-27.

- **Watch-mode freshness PROVED, not assumed:** touch probe on `vaultExtract.ts` gave **2.984 s CPU
  vs 0.000 s idle**. `npx convex dev --once` **refuses while the local backend holds `:3210`** ("A
  local backend is still running on port 3210") — so an explicit one-shot push verdict is
  unavailable without stopping the owner's `convex dev`, which was not done unilaterally.
- **THE DEPLOYED MODULE LOADS WITH SHEETJS IN IT.** A throwaway row was created on a throwaway
  tenant (`vaultSmoke:insertBrief`, tenant `smoke-15207`, no `storageId`), then
  `vaultExtract:extractDoc` was invoked **on the deployment**: it returned cleanly and drove the
  spine to a terminal `failed` (`no_stored_bytes` — the only branch reachable without a
  `storageId`). **A bundle that could not carry SheetJS would have failed at module load**, which is
  the failure mode a static top-level import has. Row purged afterwards; **$0**, no model call, no
  owner data touched.
- **THE ROUND TRIP: PROVEN.** A real legacy `.xls` uploaded to `/dashboard/vault` reached `ready`
  with its **numbers** present in the preview — **owner-APPROVED**. The offline suite proved the
  parser and the probe proved the import; **only this upload proved the two compose.** Evidence
  level: the owner's direct confirmation against the checkpoint criterion (reached `ready`, numbers
  present, not headings-only). **No figures were transcribed back and nothing was diffed against
  Excel** — so "the numbers are there" is proven; "every number is correct" is not claimed.
- **POST-PLAN CLOSURE, 2026-07-29:** a real Excel-authored `.xls` containing 31 numeric date cells
  was measured through the production `xlsText` function. Raw BIFF value `46232` plus the stored
  date format rendered as *"Wednesday, July 29, 2026"* 31 times; the raw serial appeared zero
  times. This closes the evidence gap without a parser change.

#### Gates

`@pikar/vault` **125/125** (was 114), `vaultExtract` **47/47** (was 41), backend `test vault`
**121/121** (was 115), `@pikar/vault` tsc exit 0, backend tsc **52 errors, ALL in `*.test.ts`,
ZERO non-test** (baseline held exactly), biome at the pre-existing 2 findings.

**Three mutation-checks, each confirmed applied and each reverted green:**

| Mutation | Result |
| --- | --- |
| SheetJS import made dynamic | **1 RED (the scan) — and ALL 10 behaviour tests stayed GREEN**, i.e. Pitfall 9 reproduced on demand |
| `sniffContainer` container guard removed | **1 RED** (64 bytes of noise came back as mojibake) |
| `Sheet N` header emitted unconditionally | **2 RED** (the no-header case and the empty-workbook throw) |

**`xlsx` is also a DEV-only dependency of `@pikar/backend`** so the convex-test fixture can be
written by SheetJS rather than committed as a binary — it does not resolve there otherwise, the
same arrangement that keeps `fflate` out of the V8 bundle. **Nothing in production imports `xlsx`
from `@pikar/backend`**; the only production path is `@pikar/vault/xlsText`.

---

### Phase 15.2 — 15.2-08 (the false-ready FAMILY, and the entries already in the archive)

#### INVARIANT — never let a non-empty string stand in for "we got content"

**This bug shape was found FIVE times in one phase.** A structural header (`Sheet 3`, `Slide 7`,
`Page 12`) is **SCAFFOLDING**. Emitted unconditionally it makes an empty extraction *non-empty*, so
`vaultExtract.ts`'s `empty_extraction` guard never fires and a document holding nothing readable
reports **`ready`** — a plausible failure, which is worse than a failure.

**The rule outlives the two sites it was found at.** The success signal is a **COUNT of parts that
yielded content**, never the truthiness of the joined string:

| Where | Signal |
| --- | --- |
| `vaultExtract.ts` per-page PDF fan-out (15.2-06) | `okPages` |
| `xlsText.ts` legacy BIFF (15.2-07) | `okSheets` |
| `officeText.ts` XLSX + PPTX (15.2-08) | `labelled()` returning `null`, then `parts.length` |

`labelled(label, body)` returns `null` for a blank body: **no body, no label, no part.** `trim()` is
the TEST, never a rewrite — the body is emitted exactly as it came in, so a part whose first row is
blank still renders that blank row and every pre-existing expectation stayed byte-identical.
**Anyone adding a new walker starts from the count.** A static scan in `officeText.test.ts` asserts
that every `Sheet ${n}` / `Slide ${n}` literal in the file is an argument to `labelled(`.

#### INVARIANT — `""`, not a throw, and the two endings must not be merged

A text-free ZIP office document returns `""`. It does **not** throw.

- The archive **parsed fine**, so `office_parse_failed` ("the archive is broken") would be a lie
  about a perfectly valid chart-only or password-protected deck.
- `vaultExtract.ts:392` already turns `""` into **`empty_extraction`**, which is accurate and
  already carries user-facing copy: *"We opened this file but found no readable text."* + a remedy.
  A throw here would be a **second failure mechanism** for a case the existing one already
  describes correctly (the 15.2-06 rung-2 decision).

**Do not merge these two:** *no worksheets / no slides at all* is a **broken archive** and THROWS;
*worksheets / slides with nothing in them* is an **empty document** and returns `""`. Different
facts, different endings. Both are pinned by tests.

#### INVARIANT — the PPTX entry list, positive AND negative

`pptxText` is **routing, not parsing**: every part it reads is already in the same `unzipSync`
result it holds. Attachment is via `ppt/slides/_rels/slideN.xml.rels` (`Target="../charts/chart1.xml"`,
a leading `../` resolving to `ppt/`), so a chart's values land under the slide that shows them.

**READ (an ALLOW-LIST of exactly three content part types):**

| Entry | Walker |
| --- | --- |
| `ppt/slides/slideN.xml` | `<a:t>` runs, minus `<a:fld>` blocks |
| `ppt/charts/chartN.xml` | `<a:t>` title runs, then ONE tab-joined line per `<c:ser>` of its `<c:v>` values |
| `ppt/diagrams/dataN.xml` | `<a:t>` runs (SmartArt) |
| `ppt/notesSlides/notesSlideN.xml` | `<a:t>` runs, minus `<a:fld>` |

**NEVER READ, and each for a measured reason:**

- **`ppt/diagrams/drawingN.xml`** — a **byte-duplicate** of `dataN.xml`, and BOTH are referenced
  from the same slide's rels. Reading it doubles every SmartArt phrase. Matched as
  `^ppt/diagrams/data\d+\.xml$`, never `diagrams/*`. Pinned by a test that asserts a **COUNT**
  (`text.split("Agenda:").length - 1 === 1`) — `toContain` passes on duplicated text.
- **`ppt/slideLayouts/*`, `slideMasters/*`, `notesMasters/*`, `handoutMasters/*`** — boilerplate.
  Measured on the owner's deck: **15 such parts holding ~110 runs**, so a naive "read every `<a:t>`
  in the archive" would inject *"Click to edit Master title style"* and the deck title ~22 times and
  bury the real content. A rels file points at plenty of scaffolding, which is exactly why the
  dispatch is an allow-list and not "whatever the `Target` says".

`<a:fld>` blocks (slide-number / date / footer FIELDS) are stripped everywhere. Measured: a field is
the **entire** `<a:t>` content of all three of this deck's notes slides. A `Set` of consumed paths
emits a twice-referenced part once, and an **orphan sweep** emits any chart/diagram no slide
references as its own part labelled by entry path — so a rels file that fails to parse degrades to
"the numbers are present but unattached", never back to titles-only.

#### The measured ceilings, each with its upgrade path

- **PICTURE-ONLY SLIDES ARE UNREADABLE BY ANY TEXT WALKER.** Slides 6 and 7 of the owner's deck are
  image exports (`image1.png`, two `.wmf`); they yield a title run and nothing else. **This is a
  ceiling, not coverage.** Upgrade path: render the slide and route it through the hosted OCR rail
  15.2-06 built — a different rail with a real per-page cost.
- **CACHED CHART VALUES ARE EMITTED VERBATIM.** Categories come back as Excel **date serials**
  (`46023 / 46054 / 46082` = the Jan/Feb/Mar 2026 month ends) and percentages as full-precision
  floats (`4.7100000000000003E-2`, displayed as 4.71%). This matches the SheetJS-written fixture's
  `46067`, not the now-proven Excel-authored BIFF path, because the chart cache does not carry the
  workbook cell's usable formatting. Upgrade path: read `<c:formatCode>` and apply it.
  **Observed asymmetry: only the chart whose categories
  are a `<c:numCache>` shows serials — the two charts whose categories are a `<c:strCache>` came
  back as `Jan-26 / Feb-26 / Mar-26`.**
- **EMBEDDED WORKSHEETS ARE OUT OF SCOPE BY MEASUREMENT, NOT OMISSION.** This deck has **no
  `ppt/embeddings/` directory at all**; its charts declare `externalData` pointing at a `file:///`
  path on the AUTHOR'S machine, so the cached `<c:v>` values are the complete numeric truth inside
  the archive. If a deck ever surfaces `ppt/embeddings/*.xlsx` the upgrade is one line — recurse
  `extractOfficeText` on that entry, since it is a self-identifying ZIP. **An `externalData` target
  must NEVER be dereferenced: it is an attacker-controlled path/URL in an untrusted upload.**

#### Live result — 2026-07-27, `local-joel_feruzi-pikar_ai_50c69-1`

Row `mx7a40n7460cj3d1ww97bms6wd8bb9zg` — `Rejection Review- Mar 2026.pptx`, re-extracted from its
stored bytes via `internal.vaultExtract.extractDoc` (**$0** — the pure `zip` rail; only the re-embed
costs, and `remainingDailyCents` read **499** after).

| | BEFORE | AFTER |
| --- | --- | --- |
| audit `charCount` | **356** | **1,182** (3.3×) |
| Slide 2 | title only | Objective + Agenda block, **once** |
| Slide 3/4/5 | title only | `Rej %` + `ZBIJ / ZBBW / ZBFL` × `Jan-26 / Feb-26 / Mar-26` with values |
| Slide 6/7 | title only | title only — **the picture-export ceiling, unchanged** |
| `Click to edit` | n/a | **0 occurrences** |
| `status` | `ready` | `ready` |
| `graphEdges` for this doc | the Entities panel read *"No entities extracted"* | **4 edges, 5 nodes** — `Monthly Rejection Overview` (topic, degree 4), `March 2026` (date), and **`ZBIJ` / `ZBBW` / `ZBFL`** |

The three plant codes are entities **only because the chart series names now reach the extractor** —
they exist nowhere in the 356-char titles-only text. The graph plane was never broken; the parser
had starved it.

**Deployment freshness was PROVED before the run, not assumed:** a touch probe on
`packages/vault/src/officeText.ts` moved the `convex dev` watcher (PID 14684) **1.97 s CPU vs
0.000 s idle**. Worth carrying forward — this is the first time the watcher was shown to react to a
file **outside `packages/backend/convex/`**, i.e. `packages/vault` edits do reach the deployment.

The live text is **byte-identical** to the offline one-shot measurement against the same file on
disk, and the stored 356-char BEFORE text matched the offline slide-only runs byte for byte, which
is what identifies the row as that file.

**OWNER VERDICT: APPROVED.** The owner approved the complete blocking checkpoint as presented:
the rejection figures appeared under Slides 3/4/5, the Objective/Agenda block appeared once, the
Entities & Relationships panel was no longer empty, and the titles-only ceiling on picture-export
Slides 6/7 was accepted. The `pikar-false-ready-probe.pptx` upload landed as **failed** and rendered
*"We opened this file but found no readable text."* with the expected plain-language remedy and no
raw reason code.

**Evidence level:** the owner's response was `Approved` to the complete presented checkpoint. No
individual figure values were transcribed back, and the remedy's exact words were not separately
quoted. This closes the browser round trip and confirms that `failureCopy` rendered; it does not
claim a value-by-value comparison against the source deck.

---

## Phase 17.1 — two-seam blueprint grounding

The confirmed Business Blueprint is standing business context, not a retrieval hit. It reaches
agents through two explicit seams:

1. The cockpit turn prompt carries it on every turn, whether or not the model calls `searchVault`.
2. `vaultGroundHydrated` returns `{docIds, titles, chunks, spine}` and the evaluation and voice-doc
   consumers read `spine` explicitly.

The fourth field is load-bearing. Putting the blueprint at entry 0 of the parallel retrieval arrays
would make `searchVault`'s `docIds.length === 0` no-match branch unreachable, inflate every
`vault.searched.resultCount`, and render a "Business blueprint" source chip on every search.
`spine` is therefore fetched only after the retrieval hydration loop and is budgeted outside
`TOTAL_CHAR_CAP`; retrieval retains the full 8,000-character budget. No confirmed blueprint or any
blueprint read failure yields `spine: null` while the three retrieval arrays stay unchanged.

The Blueprint document is neither embedded nor graph-extracted. It can never appear as a
`rag.search` hit, cannot be duplicated by retrieval plus the standing seam, and cannot feed its own
entities back into `graphNodes` to inflate the degree ranking used by the next rebuild.

**Phase 17.1 Pitfall 9 — the Blueprint appears in the user's vault UI.** `listVaultDocs` has no
kind filter, and `categoryFor({ source: "agent" })` places this row in `workspace-docs`. The card is
therefore previewable and user-deletable through the normal vault cascade. This is intentional and
matches the committed profile document. Deletion leaves `tenantProfiles.blueprintDocId` dangling;
`liveForTenant` already treats a missing target as no live Blueprint and fails open to `null`, so
the cockpit, evaluation, voice, and profile reads continue rather than crashing.

Verify with `pnpm --filter @pikar/backend test vaultGround --maxWorkers=1`. The BLPR-02 cases compare
all three arrays and their total character count before and after confirmation, retain a full-object
empty-result equality including `spine: null`, pin cross-tenant null behavior, and keep the public
`vaultGround` action at exactly `{context, docIds}`.

`searchVault` needed **no source change** for this design. Its existing `docIds.length === 0`,
`vault.searched.resultCount`, and `vaultSources` card logic continue to see retrieval hits only.
`searchVaultSpine.test.ts` drives the real tool through `internal.llm.__invokeCockpitTool` and pins
the honest Blueprint-bearing no-match at count 0 plus a matched card containing only the actual
retrieval document. Those tests are intended to fail if anyone later "simplifies" the Blueprint
back into the parallel arrays; the required mutation proof moves it there temporarily and confirms
that the no-match, count, budget, full-object shape, and array-invariance guards all turn red.

## Phase 15.3 — vault folders

One container section for the phase. Each plan appends ONLY its own `### 15.3-0N` subsection
below and bumps `Last verified`; nobody rewrites another plan's subsection. On merge conflict,
keep both. Same append-only shared-singleton rule as `## Phase 15.2` above.

### 15.3-01 — schema

Every schema change the phase needs, landed in ONE plan before any behaviour, so no later wave
edits `schema.ts` and no two plans can race on the repo's highest-collision file. Every addition
is a new table or an optional field, so this is a **pure widening**: it ships and sits inert, with
zero backfill, zero migration and no test result changed.

**`vaultFolders`** (`schema.ts`, directly after `vaultDocuments`) — tenant-scoped folder row:
`source` (`upload` | `drive`), `status`, the `memberCount`/`terminalCount`/`failedCount` counters,
`reservedCents`/`spentCents`/`reservedAt`, the `digestDocId`/`digestSourceDocIds`/`digestBuiltAt`
trio, and a `by_tenant` index. A NEW TABLE needs no migration (the `convex-migration-helper` skill
lists it under *When Not to Use*).

**There is no `cancelled` status, deliberately.** Cancel DELETES the row. The seal is read THROUGH
the folder row, so a folder merely *marked* cancelled would keep its members sealed forever —
inverting the locked decision that cancelled documents become groundable immediately. The
consequence, which is also deliberate: members keep a dangling `folderId` that resolves to nothing,
so **every folder read must treat an unresolvable id as "no folder"** (a lenient join), never as a
missing one. Deleting the row is also what keeps cancel migration-free — actively clearing
`folderId` on 400 rows does not fit one mutation, because a patch rewrites the whole document,
`text` blob included.

**The widening on `vaultDocuments`** — `folderId`, `docType`, `identityLine`, `identityUserSet`,
`driveFileId`, `driveModifiedTime`, all `v.optional`. **`folderId` ABSENT ⇒ folder-less ⇒ exactly
today's behaviour** for every row that exists: no shipped read changes, nothing is backfilled.
`docType` is a `v.union` and NOT `v.string()` on purpose — `category` next door is `v.string()` and
the table's own comment records that 4 of 11 insert sites already store out-of-union values; every
future member costing a schema edit IS the point. `identityUserSet: true` means the user typed the
identity and **no code path may ever overwrite it** (the label feeds the digest and grounding, so a
wrong guess left standing is a permanent lie in the grounding corpus); there is deliberately no
`docTypeSource` union, because one boolean is the whole decision.

**⚠ THE INERT-LITERAL WARNING — the single most misreadable fact in this phase.** The `origin`
union gained `folder_digest`, and **it excludes nothing and includes nothing.** There is ZERO
`origin` predicate anywhere in retrieval: the `origin: "agent"` exclusion is the ABSENT
`startIngest` call (`vault.ts:627-634`), not a filter. **A digest is groundable ONLY because its
insert calls `startIngest`.** Forget that call and the digest is silently ungroundable while every
test asserting `origin === "folder_digest"` still passes — so **the observable check is
`ragEntryId != null`, never the literal.** Do NOT add an origin-based filter anywhere; the literal
is provenance only. The one consumer, `patchCreatedDoc`'s `doc.origin !== "agent"` guard
(`vault.ts:723`), already refuses non-`"agent"` and therefore correctly makes a digest
un-revisable — that is right as it stands, do not "fix" it.

**`by_tenant_folder` read discipline.** The index serves BOTH the drill-in listing and the digest's
stale set-difference (there is no `by_tenant_folder_status`: completion is counted on the folder
row, never by a status query). **NEVER `.collect()` on it.** Rows carry `text` up to 400k chars, so
~40 max-size rows exhaust the 16 MiB per-transaction read cap — the same defect class that already
breaks `listVaultDocs`/`vaultStats` at folder scale. Use a bounded `.take()` and project `text`
away; `ownedDocsMeta` (`vault.ts:438`) is the shipped refs-only precedent. `by_tenant_driveFileId`
is the Drive re-import primary key, added here for the same reason: so no later wave touches this
file.

`watch.json` gained `vaultFolders.ts`, `vaultDigest.ts` and `vaultDrive.ts` under this playbook in
wave 1 — a plan blocked at its own Stop hook cannot commit, and doing it once here keeps every
later plan off a shared file.

Verify with `npx convex codegen` + `npx tsc --noEmit -p tsconfig.json` from `packages/backend`
(errors must stay confined to `convex/*.test.ts`, zero in `schema.ts`), and by confirming there is
still no `origin` predicate in any retrieval path.

### 15.3-02 — read-surface survivability + cap single-source

The first 15.3 plan a user can SEE. Two shipped defects, one of which would have stopped the
phase's own acceptance demo from rendering.

**THE READ-CAP DEFECT (B1).** `listVaultDocs` (`vault.ts:270`) and `vaultStats` (`:285`) each
`.collect()`ed the tenant's whole `vaultDocuments` partition — **including every `text` blob**, up
to `VAULT_EXTRACT_CHAR_CAP` (400,000) chars per row. Convex has **no projection**: reading a row
reads the whole row. At 200–400 documents that is 20–160 MB against a **16 MiB** per-transaction
read cap; ~40 max-size rows already exhaust it. The vault page therefore hard-failed the moment a
tenant's vault grew large — before any folder feature existed. Folder ingest does not cause this,
it merely reaches it on day one. Same defect class as the `onboarding.status` timeout fixed
2026-08-02.

**The fix: `readVaultPage`, the ONE bounded read.** Both browse surfaces go through it, so the
ceiling is stated once and cannot drift between the grid and the stat tiles. It streams the index
(`by_tenant`, or `by_tenant_folder` when a `folderId` is given) newest-first and stops on
**whichever bound bites first**:

- `VAULT_GRID_PAGE` (200) rows, and
- `VAULT_GRID_READ_BUDGET_BYTES` (8 MiB) of `text`.

⚠ **The byte budget is the half that makes the guarantee true, and it is the easy one to delete.**
A row cap ALONE does not bound bytes: 200 × 400 KB is ~80 MB, still 5× over the read cap. A
"simplification" that drops the byte budget and keeps `.take(200)` restores the original defect
while looking bounded. `constants.test.ts` asserts both directions — budget + one max-size row fits
16 MiB, and `VAULT_GRID_PAGE × VAULT_EXTRACT_CHAR_CAP` does NOT.

**`VAULT_GRID_PAGE` IS A READ-CAP BOUND, NOT A UX PREFERENCE.** Do not raise it because a grid
"should show more". Upgrade path, in ascending cost: (1) `.paginate()` with a cursor, which the
grid can adopt with no change to what the query returns; (2) move `text` to a side table keyed by
docId — the only change that makes a whole-partition read cheap again, and a real migration,
deliberately out of scope for this phase.

**THE PROJECTION IS A CONTRACT CHANGE.** `listVaultDocs` now returns metadata only — and **never
`text`** (nor `tenantId`/`contentHash`). `ownedDocsMeta` (`vault.ts:438`) was the shipped refs-only
precedent; this is the same rule applied to the whole grid row. It is also a §4 improvement: raw
document content stopped being shipped to the browser to render a card, a status pill and a size.

One document's text now comes from **`vault.vaultDocText`** — a tenant-scoped, fail-closed-as-null
one-doc read. Three surfaces were repaired onto it: `PreviewModal` (the preview pane), the
onboarding intake poll, and the voice `AbnormalBriefBanner`. **The banner is the cautionary one:**
it cast the query result to a local type, so dropping `text` would have compiled cleanly and seeded
an EMPTY plan at runtime. The cast is gone (the row type comes from the query), and the handler now
refuses rather than seeding an empty plan. Any future consumer that needs a document's words asks
`vaultDocText`; a field added back to the projection to serve one screen is how this regresses.

**`vaultStats` honesty.** The tiles derive from the same window and return `capped: boolean`. The
contract: **the stats tiles must never be the reason the page fails to load.** When capped the UI
renders `200+` and one plain sentence ("Showing your newest documents — this vault holds more than
one page"), because a "+" alone encodes meaning in a glyph (BRAND §6). An exact figure would need a
maintained counter row, i.e. a schema field — and `schema.ts` is closed for this phase.

**Known ceiling, accepted:** the `category` filter runs over the bounded window, not the partition
(there is no `by_tenant_category` index). A tenant past the window can see fewer rows on a narrow
tab than exist. Upgrade path: that index, or folder drill-in.

**THE CAP DUPLICATION (B11), deleted.** `VAULT_FILE_CAP_BYTES` was re-typed as a literal in FIVE
places — `Dropzone.tsx:25,26` (consts), `:56,:58` (error strings), `:174` (helper copy) — plus two
server messages in `vault.ts:171,173`. A server-only raise therefore yielded a client that silently
rejected files the backend would have accepted. All five are gone: `Dropzone.tsx` imports
**`@pikar/vault/constants` — the SUBPATH, never the barrel** (the barrel pulls `xlsx` ~1 MB and
`fflate` into the client bundle), and `apps/web` gained `"@pikar/vault": "workspace:*"` following
the `@pikar/voice` precedent (no `transpilePackages` entry needed). Error strings and helper copy
are derived via `capMB()`, which lives beside the caps: the caps are DECIMAL by construction, so
`DocGrid`'s binary `fmtSize` would print "190.7 MB" for the same constant.

**The cap is now 200 MB (was 100 MiB).** ⚠ **`VAULT_VIDEO_CAP_BYTES` is UNCHANGED at 25 MB** —
bounded by the transcription API's hard limit (`vaultTranscribe.ts:43`), not by our storage. Do not
"tidy" it upward to match. `categories.test.ts` pins both values AND the strict `video < file`
relationship, with the reason; before this plan it asserted only "a positive integer", under which
the raise would have been silently unverified.

⚠ **200 MB is reachable only on a fast link.** Convex's upload POST times out at **2 minutes** per
file, so 200 MB needs ~13.3 Mbit/s sustained upstream; a slower connection sees an upload failure,
not a cap refusal. Recorded at the constant. Plan 15.3-04 owns surfacing that outcome in the folder
manifest; until then a timed-out single file fails loudly at the `fetch`, which is honest but terse.

**THE GUARD (B16): `packages/core/src/vaultSurface.test.ts`.** Before this plan there was ZERO test
coverage of the vault UI — grep `dashboard/vault` across every `*.test.ts`: no hits. That absence
is exactly how the cap came to be duplicated. The scan reads the whole route FOLDER (`surfaceOf`,
`businessProfile.test.ts:569-576`), so the FolderCard/pre-flight split later waves ship does not
turn it red. It lives in `@pikar/core` because the backend vitest environment is `edge-runtime`
with no `node:fs`.

It guards: the `@pikar/vault/constants` import, no cap literal and no cap spelled out in copy, no
`doc.text` on the surface (the projection contract), and no `setInterval`/`setTimeout` poll (the
status gate is subscription-driven — `DocGrid.tsx:349-353`).

⚠ **Every guard in it is a `not.toContain`, which passes forever over an empty string.** That is
why the file OPENS with non-vacuity assertions (`src.length > 500`, `"use client"`, and the
per-file anchors `api.vault.listVaultDocs` / `api.vault.vaultSearch` / `export function DocGrid`).
If an anchor stops matching, fix THAT first — everything below it has been green over the wrong
text since it broke. **Mutation-verified on 2026-08-03:** reintroducing `100 * 1024 * 1024` and
`max 100 MB` in `Dropzone.tsx` turned 2 of the 6 tests RED; reverted, back to 6/6. A guard that does
not break under its own mutation is not a guard — re-run that mutation if you change this file.

**How to verify.** `npx vitest run src/vaultSurface.test.ts` from `packages/core`; `npx vitest run`
from `packages/vault`; `npx vitest run --maxWorkers=1 convex/vaultGround.test.ts convex/vault.test.ts
convex/createdDocs.test.ts convex/research.test.ts` from `packages/backend` (the read-plane block in
`vaultGround.test.ts` seeds 50 × 200k-char rows and asserts the returned objects carry **no `text`
property** — a SHAPE assertion, which is cheaper and more durable than a size assertion — plus
`stats.capped === true` and a returned row count below 50, i.e. the BYTE bound biting). Then
`npx tsc --noEmit` from `apps/web`, which is what catches a component reaching for a field the
projection no longer returns.

### 15.3-03 — the budget rail selector (ingest stops spending the cockpit's $5)

**The defect this closed.** Every paid step of vault ingest charged `dailySpendCents`, the
COCKPIT's $5/day window, at six sites:

| gate (`preCall`) | charge (`recordSpend`) |
|---|---|
| `vaultIngest.ingestDoc` step 1 | `vaultIngest.ingestDoc` step 5 (embed + graph) |
| `vaultExtract.extractDoc` step 1 | `vaultExtract.extractHosted` — **once per OCR page** |
| `vaultTranscribe.transcribeDoc` step 1 | `vaultTranscribe.transcribeDoc` (per-minute) |

So an ingest both starved the agent the user relies on for actual work AND could be refused
halfway by an unrelated cockpit turn. The money rail itself lives in
`docs/playbooks/guardrails.md` §15.3-03 — read that for the window, the reservation and the
refund. What lives HERE is how the selector reaches the vault's six sites.

**The seam.** `preCall` and `recordSpend` take an OPTIONAL `rail?: "ingest"` plus
`reserved?: boolean`. It is threaded:

- `vaultIngest.startIngest({ rail, reserved })` -> the `ingestDoc` workflow args -> its `preCall`
  gate and its `recordSpend`. Eight existing call sites pass neither and are unchanged.
- `vault.scheduleExtraction({ spendRail, reserved })` -> the scheduler args of
  `vaultExtract.extractDoc` / `vaultTranscribe.transcribeDoc` -> their gate, and down through
  `extractPdf` into `extractHosted` so each OCR page charges the right rail.

⚠ **`scheduleExtraction` now has TWO things called a rail.** `spendRail` is the BUDGET rail; the
local `rail` is the SCHEDULING rail (`schedulingRailFor` -> transcribe vs extract), and
`vaultExtract` has a third (`resolveRail`, the FORMAT rail read from magic bytes). They are
unrelated. The budget one is spelled `spendRail` at every vault site for exactly this reason.

**Reserved folder work checks the KILL SWITCH ONLY.** This is the whole "a folder can never be
refused halfway" guarantee: a whole-folder reservation takes the tenant's ingest window to 0 by
design, so a mid-run window check would refuse the run because of its own reservation. It still
CHARGES the ingest window — `reserved` skips the check, never the charge — or settle would release
against a window that never saw what the folder really cost.

**ABSENT means exactly today's behaviour.** Folder-less single-file uploads deliberately stay on
the token rail (15.3-CONTEXT puts only FOLDER ingest on the $25 window), and `dispatch.ts`'s
sub-agent envelope sizing still reads `remainingDailyCents` over the token rail, untouched.

**`retryStuckIngests` derives the rail from the row.** A swept folder member re-derives
`rail: "ingest", reserved: true` from its `folderId`, so an ops recovery does not silently push a
folder document back onto the cockpit's budget. ponytail ceiling, named at the site: the folder's
reservation may already have been settled, so a swept retry can spend the ingest window without a
live reservation. 15.3-04 owns the folder watchdog and the better fix (read `reservedCents`).

**What is NOT covered.** `vaultSweep.sweepPendingExtraction` / `retryExtraction` still call
`scheduleExtraction` without a rail, so a swept EXTRACTION (as opposed to a swept ingest) charges
the token rail. Left deliberately: those two are pre-15.3 recovery paths with no folder context in
scope, and 15.3-04 rebuilds the fan-out onto a named workpool anyway.

**How to verify.**

```bash
cd packages/backend
npx vitest run convex/guardrails.test.ts      # 18/18 — incl. the cross-rail isolation trio
npx vitest run --maxWorkers=1 convex/vaultExtract.test.ts convex/vaultTranscribe.test.ts \
  convex/vaultSweep.test.ts convex/vault.test.ts
```

The isolation block in `guardrails.test.ts` is the one that matters, and it has THREE arms because
two were not enough: the control (no rail -> refused, i.e. the old behaviour), the
rail-without-`reserved` arm (-> still refused, so `reserved` is load-bearing), and the reserved arm
(-> runs). **A first draft drained only the cockpit rail and stayed GREEN when `preCall`'s reserved
branch was deleted**, because the untouched ingest window answered the check. The fixture now
drains BOTH rails through a real `reserveFolder`. If you change this seam, re-run that mutation.


---

### 15.3-04 — folder orchestration (VALT-05, VALT-06, VALT-08)

**What changed.** The fan-out mechanism already existed — each file is its own `vaultUpload`
scheduling its own extraction. What was wrong at folder scale was throttling, the watchdog, and the
absence of a folder object. This plan added `vaultFolders.ts`, moved extraction onto a named
workpool, moved the watchdog's clock to work-start, and hooked completion into the two terminal
writers.

#### 1. `vaultIngestPool` — and why the shared `WorkflowManager` was left alone

`vault.scheduleExtraction` used `ctx.scheduler.runAfter(0, ...)`, which is bounded only by the
DEPLOYMENT's scheduled-job concurrency class. 400 queued extractions therefore sat in front of every
delivery and cron job in the deployment: "never starve the cockpit" arriving as latency rather than
as budget.

`@convex-dev/workpool@0.4.7` moved from `devDependencies` to `dependencies` (exact pin, §6),
`app.use(workpool, { name: "vaultIngestPool" })`, and the client lives in `convex/index.ts` beside
`workflow` and `retrier`. **`{ name }` is required** — the component declares itself
`defineComponent("workpool")`, so without it the identifier is `components.workpool`.

- **`maxParallelism` is EXPLICIT.** `WorkpoolOptions.maxParallelism` is optional and defaults to 10,
  which is silently above the smallest deployment class. `VAULT_INGEST_PARALLELISM = 6` lives in
  `@pikar/vault` and `constants.test.ts` asserts it stays strictly below 8. **This project has no
  cloud deployment** (`convex deployments` reports `Type: local`), so there is no class to read; the
  bound is what makes the number safe on every class. Provisioning a cloud deployment is the point
  at which it may be revisited, and the pre-flight "ready in" estimate is computed from THIS number,
  never from an assumed class.
- **Do NOT raise the `WorkflowManager` instead.** It is shared by every workflow in the app
  (`executePlan`, `deliverApprovedPlan`, `pipelineWorkflow`, `ingestDoc`), so widening it widens the
  delivery spine. Correct its number while you are here: `@convex-dev/workflow@0.4.4` declares its
  OWN `DEFAULT_MAX_PARALLELISM = 25` and resolves `opts ?? config ?? 25` — **workpool's default of
  10 is never reached**, and the `?? 10` in `workflowMutation.ts` is the per-EXECUTION step channel,
  not a cross-workflow cap. Platform guidance: keep total parallelism under ~100.
- **`retryActionsByDefault` is deliberately left `false`** on this pool (the WorkflowManager sets it
  `true` for workflow steps; do not copy that across). `extractDoc` charges OCR pages via
  `recordSpend` before it reaches the ingest seam, so it is not idempotent with respect to spend.
- **A folder-level WORKFLOW was rejected**: the journal caps at 8 MiB, steps pass <=1 MB total, and
  400 sequential `step.runAction` calls serialise the folder behind the shared pool with determinism
  risk on redeploy. One workflow per document; the folder is a row plus counters.
- **Honest qualifier:** the pool throttles the extraction ACTION. `ingestDoc` still runs on the
  shared manager at 25. It is indirectly bounded (at most `VAULT_INGEST_PARALLELISM` extractions
  reach the seam at once), but workflow retries and the pre-existing backlog are not.

**Testing consequence.** A workpool writes its `work` row and schedules its main loop INSIDE the
component's namespace, and convex-test scopes `_scheduled_functions` per component with no
component-scoped `t.run`. So the enqueue is unobservable from a root-scoped test. `vault.test.ts`
and `vaultSweep.test.ts` therefore assert the SCHEDULING DECISION through a `vi.spyOn` on the pool;
`vaultExtract.test.ts`, `vaultTranscribe.test.ts` and `guardrails.test.ts` register
`vaultIngestPool` and drive the REAL pool end to end. Do not "restore" the system-table helper — it
returns `[]` and every assertion built on it silently inverts.

#### 2. The watchdog measures WORK time, not queue time

`EXTRACTION_WATCHDOG_MS` (15 min) was armed by `scheduleExtraction`, i.e. when the attempt was
QUEUED. With 400 documents behind a concurrency of 6 a document sits queued for an hour and is
marked `extraction_stalled` while perfectly healthy — **failures that never happened, written into
the manifest this phase promises is honest.** The arm moved to `vault.markExtracting`, the ONE point
every extraction rail passes through when work actually starts (`extractDoc` and `transcribeDoc` are
its only non-test callers, and `scheduleExtraction` can only ever dispatch those two, so no rail
lost its backstop).

**COUPLED DECISION, and the two halves are one change:** `watchdogStalled` narrowed from
`pending_extraction`+`extracting` to `extracting` only. Once the arm fires from `markExtracting`
the row is `extracting` in the SAME transaction, so a fire that finds `pending_extraction` can only
mean a Retry or the sweep re-queued the row after this clock started — and killing that is the same
fabricated failure through a different door (a healthy retry queued behind 400 folder members).

**What that gives up, stated rather than hidden:** a row that is enqueued and whose action never
reaches its handler body (a deployment restart, a dropped job) now parks at `pending_extraction`
with no automatic backstop. Narrower than what it closes — the pool always dispatches, both actions
wrap their whole body in try/catch into `markFailed`, and a cancelled folder's members are failed
honestly at work-start. **The recovery is `npx convex run vaultSweep:runSweep`**, which re-queues
exactly the `pending_extraction` rows the watchdog no longer touches; a cron over it is the upgrade
path if this ever needs to be automatic.

Watchdog arms also accumulate (one per attempt, and a Retry is another attempt) because nothing
persists the scheduled-function id. Every fire is status-idempotent, so extras are harmless; the
upgrade path is `voice.ts`'s `watchdogFnId` pattern, which needs a schema field this phase does not
have.

#### 3. The lifecycle, and why RESERVE IS STEP 3

```
createFolder  -> "reserving"    members may be added; NOTHING may spend
  vaultUpload({ folderId })      inserts the row, bumps memberCount, DISPATCHES NOTHING
reserveFolder -> "ingesting"     takes the money, THEN dispatches every member
  markReady / markFailed         bumpFolder -> terminalCount
              -> "complete"      settle, digest, unseal — exactly once
cancelFolder                     settle, DELETE the row, zero document writes
```

Two invariants force that ordering, and the plan text left it implicit:

1. **"Reserve before the first cent"** (CONTEXT §A4). The reservation is taken off the probed
   manifest, so no member may be dispatched at upload time.
2. **"A folder completes exactly once, only after its last member goes terminal."** `memberCount`
   GROWS one upload at a time. If the folder were already `ingesting` while members were still
   arriving, a 3-file folder whose first file finished before its second was uploaded would see
   `terminalCount === memberCount` at 1 === 1, settle its reservation and synthesise a digest over
   one third of itself. **A status CAS does not prevent this** — it only prevents a SECOND
   completion. `reserveFolder` is therefore also the CLOSE SIGNAL: after it, `memberCount` is fixed
   and `vaultUpload` refuses further members with `folder not open for members`.

`reserveFolder` calls `reserveFolderInner` (the plain-function half) so the reservation and the row
that records it commit in ONE transaction — a reservation in a different transaction from its row is
a reservation that can leak, and there is no folder-level watchdog.

**On refusal** the folder goes `refused` and every member it collected is failed `folder_refused`.
Nothing was ingested — refuse-intact is proven by absence — but the rows exist, and leaving them at
`pending_extraction` would be exactly the silent parking 15.2 abolished.

Member dispatch and member refusal both run through `vaultFolders.walkFolderMembers`, a bounded,
self-scheduling batch (`VAULT_FOLDER_MEMBER_BATCH = 20`): Convex has no projection, so reading a
member reads its whole row against a 16 MiB read cap, and `.paginate()` may be called only once per
execution — hence a cursor argument and a fresh scheduled call rather than a loop. Every batch
re-reads the folder and stops if it is gone or has left the status the walk was started for, which
is what makes cancel mid-dispatch free.

#### 4. Completion rides the TWO terminal writers, never `onIngestComplete`

`vault.markReady` and `vault.markFailed` are the only two terminal writers for every rail — extract
fail, transcribe fail, `unsupported_format`, `pii_scan_failed`, `empty_extraction`,
`watchdogStalled`, `onIngestComplete`'s failed arm, and workflow success. One hook in those two
handlers covers all nine call sites.

**Do NOT hang folder logic on `onIngestComplete`**: it returns immediately on success and never
fires for a document that failed before the workflow started.

- **`countTerminal` takes the PRIOR ROW, not the id, and that is the whole correctness argument.**
  Neither writer is idempotent (both are a bare `patch`) and a workflow mutation whose journal write
  fails is re-run, so a post-state test ("is it terminal now?") is TRUE on every replay and counts
  the same member twice. Counting only the non-terminal -> terminal TRANSITION is what makes
  "exactly once" hold under replay.
- **A counter, never a status-index probe.** `by_tenant_folder` returns whole rows including `text`;
  ~40 max-size members exhaust the read cap. `vaultFolders.test.ts` proves both halves under
  convex-test's real `transactionLimits`: the counter completes a 50-member folder fine, and the
  probe it replaces throws.
- **The completion transition is three things in this order:** settle (IN this transaction, never
  scheduled — its CAS is `reservedCents > 0` read here and the next step flips the status), the
  digest hand-off (plan 06 fills the named slot, together with 17.1 Stage-2, which needs an
  `internalAction` sibling of the `tenantAction` `blueprint.buildBlueprintDraft`), then the flip to
  `complete` — **last, because that flip is the unseal.**
- **An all-duplicate folder still completes**: zero rows inserted means `bumpFolder` is never
  called, so `reserveFolder` evaluates completion itself at the close signal.
- **Known and accepted:** `retryExtraction` puts a `failed` row back to `pending_extraction`, a
  genuine un-terminalling. The counters do not decrement, so a completed folder keeps its historical
  `failedCount` even if a member is later rescued by hand. The folder CAS still stops a second
  settle or a second digest.

#### 5. Hash-dedup — the trap that stops folders completing

`vaultUpload` returns an EXISTING row on a `contentHash` match and starts NO workflow, so a
duplicate produces no terminal event.

1. `memberCount` counts **rows actually inserted**, never files submitted. A folder counting to
   "files picked" never completes.
2. **A dedup hit is NEVER assigned a `folderId`.** Patching it would silently annex a pre-existing
   document into the folder and seal a document the user could ground on yesterday. It is reported
   as `deduped: true` instead (`vaultUpload` now returns `{ vaultDocId, deduped }`, the
   `ingestFromAttachment` shape — non-breaking at every call site).
3. A document already carrying a `folderId` is never re-parented.
4. `by_tenant_contentHash` is **not unique over time**: `ingestExtractedText` overwrites
   `contentHash` with the hash of the EXTRACTED text, so a binary's hash changes once extraction
   lands. Do not build counter logic that assumes hash uniqueness.

**Server-side hashing for the folder rail.** `vault.vaultUploadFolderFile` (a `tenantAction`) reads
the bytes back from `ctx.storage`, hashes them there, and calls the public `vaultUpload` — the
identity propagates through `ctx.runMutation` from an authenticated action, so no internal twin is
needed (the `ingestExtractedText` twins exist because their callers are SCHEDULED actions, which
have no identity). The dedup check and the insert stay together in `vaultUpload`'s one serializable
transaction; only the HASH moved. The single-file path keeps its client hash.

- **Correct the record on why:** this does not save an upload. `Dropzone.ingestOne` already POSTs
  the bytes before it calls `vaultUpload`, so the client hash never skipped a transfer. What it buys
  is browser heap — and it RELOCATES the whole-file buffer to the action rather than removing it
  (`crypto.subtle.digest` has no streaming API on either side). Safe only because the client drives
  these sequentially. **Do not move hashing onto `vaultIngestPool`**: 6 x 200 MB does not fit a
  ~512 MB action.

#### 6. Cancel — and why `pool.cancelAll` is NOT used

**THIS IS THE ONE PLACE THE PLAN TEXT AND THE SHIPPED COMPONENT DISAGREE, and the disagreement is
resolved in favour of the component.** The plan said cancel should call `pool.cancelAll` "for the
folder's enqueued work". No such scoping exists: `Workpool.cancelAll` takes `{ before?, limit? }`
and NOTHING else — it pages the pool's entire `work` table and cancels every pending item in it, for
every folder, every tenant, and every single-file upload queued in the same instant. Per-item
`pool.cancel` needs the `WorkId` the enqueue returns, and nothing persists one (`schema.ts` is
closed for this phase). Calling `cancelAll` would also strand foreign members at
`pending_extraction` — with the watchdog now armed at work-start, work cancelled before it starts
has no clock — so one user's cancel would permanently strand another user's reservation.

**The stop lives one layer down instead.** `vault.markExtracting` refuses to start work whose
`folderId` no longer resolves and fails the row `folder_cancelled`. That is a strictly better
"no NEW spend": folder-scoped and tenant-scoped by construction, one `db.get` per attempt, and it
cannot touch another tenant's queue. The row is failed rather than left pending because it is a
real, honest outcome and because Retry then re-queues it as the ordinary folder-less document cancel
promises it now is.

**Cancel DELETES the folder row.** A `cancelled` status would keep members sealed forever, because
the seal is read THROUGH the folder row — the exact inverse of the locked "cancelled documents
become groundable immediately".

- **Every folder read treats an unresolvable id as "no folder"** — a lenient join. `getFolder`
  returns `null` (the drill-in routes back to the flat grid); `readVaultPage`'s folder branch is
  index equality, so `listVaultDocs({ folderId })` still returns the members, which is correct —
  they are ordinary documents now. **`vaultIngest.retryStuckIngests` used to test `d.folderId` for
  TRUTHINESS**, reading a dangling id as "still reserved" and re-starting the member with
  `rail:"ingest" + reserved:true` — unbounded spend on the $25 window with no reservation and no
  folder to settle against. It now resolves the id. If you add a folder read, resolve, never test.
- **Why not clear `folderId` on the members:** a `patch` rewrites the whole document, `text`
  included. At the 400,000-char cap the 16 MiB written-per-transaction cap is reached at **41 rows**,
  and a 400-member folder is ~9.5x over it. It would need a batched `scheduler.runAfter(0, self)`
  loop to achieve exactly what the dangling id achieves for free.
- **The refund settles AT THE CLICK, and the plan's "after the last in-flight action" is not
  implementable** alongside deleting the row (`settleFolder` returns `no_folder` once it is gone).
  Settling at the click is arithmetically safe: `reserveFolderInner` debited the estimate,
  `recordSpend` debits the ACTUAL cents as they happen, and `refundableCents` clamps the credit to
  `capacity - currentValue` — at that instant exactly the estimate minus what has been spent.
  Trailing in-flight spend then debits normally. **Residual cost, stated:** a second folder reserved
  in that gap shrinks the clamp, so the first tenant can be UNDER-refunded. Fail-closed; money is
  never minted.
- **In-flight work is not killable.** `startIngest` discards the workflow id, so a member already
  past extraction runs its embed -> graph -> recordSpend -> markReady to completion. Cancel means
  "no NEW spend", not "no spend".
- **`settleFolder` has NO tenant guard of its own** (it takes a bare `folderId` and reads
  `folder.tenantId` for the limiter key). `cancelFolder` asserts ownership itself before settling or
  deleting. Do not remove that check.
- **Ordering is load-bearing: settle THEN delete.** Reversed, the reservation is stranded
  permanently and nothing can release it.
- **Consequence, deliberate, do not "fix" it:** cancelling makes N `ready` members instantly
  "unincorporated", so `blueprint.unincorporatedFor` inflates the drift banner on the next cockpit
  turn. That follows directly from the locked decision that cancelled documents are groundable.
- Already-armed watchdogs are not cancellable (nothing persists their ids), so a member killed
  mid-`extracting` is flipped to `failed(extraction_stalled)` 15 minutes later with no folder left
  to explain it. Correct — it really was killed mid-flight — but expect it in UAT.

#### 7. Dead field

`vaultFolders.spentCents` has **zero writers**. `recordSpend` moves rate-limiter windows only and
has no `folderId` to write with. Whoever renders a per-folder spend figure (plan 07/08) must either
thread a `folderId` into `recordSpend` or show nothing.

#### How to verify

```bash
cd packages/backend
npx vitest run convex/vaultFolders.test.ts    # 12 — completion, dedup, cancel, watchdog, read cap
npx vitest run --maxWorkers=1 convex/vault.test.ts convex/vaultSweep.test.ts \
  convex/vaultExtract.test.ts convex/vaultTranscribe.test.ts convex/guardrails.test.ts
npx tsc --noEmit -p tsconfig.json
cd ../vault && npx vitest run                 # VAULT_INGEST_PARALLELISM < 8
```

`pnpm boot:check` cannot be used here: `scripts/boot-check.mjs` runs `npx convex codegen`, which
fails in this environment with a 30 s startup timeout, and `convex dev --once` would kill the
persistent local backend. Save `convex.config.ts` and let the running `npx convex dev` codegen and
push, then typecheck.

**Every `Mutation RUN:` comment in `vaultFolders.test.ts` names a mutation that was applied to the
source, observed RED and reverted.** If you change this seam, re-run them — a green suite that does
not sample its guarantee is how this phase shipped two false positives already.


### 15.3-05 — sealing (VALT-07)

**The locked rule: a folder's members are excluded from retrieval until the folder is `complete`.**

Sealing could not be done the way `origin: "agent"` exclusion is done. That works by never calling
`startIngest` — but folder members must genuinely embed and graph-extract *during* the sealed window,
or the folder would not be groundable the moment it lands. So sealing is an explicit **filter**, and
a filter has to be applied everywhere a doc id can reach a reader.

#### The predicate

```
sealed(doc) === doc.folderId != null && folderRow(doc.folderId)?.status === "ingesting"
```

Lives once, in `vaultFolders.sealedIn` (a plain `QueryCtx` helper) with `vaultFolders.sealedDocIds`
as the registered hop for the two ACTION call sites, which cannot read `ctx.db`.

**The status test is POSITIVE, and that is the whole design.** Written as
`folder?.status !== "complete"` it is a one-word bug: `cancelFolder` DELETES the folder row and
writes zero document rows, so a cancelled folder's members stay as ordinary documents carrying a
**dangling `folderId`**. `undefined !== "complete"` is `true`, so every one of them would be sealed
FOREVER — silently, with no row left anywhere to explain why the user's documents stopped answering.
A missing folder means folder-less, never sealed: the same lenient join `readVaultPage` and
`getFolder` already make.

`"reserving"` needs no seal and `"refused"` needs no special case. `vault.vaultUpload` inserts a
folder member at `pending_extraction` and dispatches nothing until `reserveFolder` (`vault.ts`:
`status: searchable && !folderId ? "processing" : "pending_extraction"`), so members in either status
carry no `ragEntryId` and no graph edges — structurally unreachable by every retrieval path.
`ingesting` is exactly the window in which a member is embedded but must not yet be read.
`schema.ts` says the same thing on the table itself: `ingesting` is annotated *"SEALED from
retrieval"*, `complete` *"unsealed"*.

Folder lookups are batched through a Map. A per-document `ctx.db.get` in a retrieval hot path is the
read amplification this phase has already been bitten by twice.

#### Three sites, and why one is not enough

1. **`runVaultGround` seeds** — filtered BEFORE `internal.vaultGraph.expand`, not after. Filtering
   after would still let a sealed document's entities pull unsealed neighbours into the answer: the
   sealed folder steering the result without appearing in it. Note `hits` is filtered too, not just
   `seedDocIds` — `fuse` builds its output from the hit list, so dropping the seed alone removes
   nothing.
2. **`runVaultGround` graph neighbours** — `vaultGraph.expand` resolves neighbours straight out of
   `graphEdges` with **no status, origin or folder filter of its own**. It is an INDEPENDENT leak
   path and a seeds-only fix does not close it.
3. **`blueprint.unincorporatedFor`** — the easiest to miss and the most expensive to miss. Members
   reach `status: "ready"` at ingest step 6 *during* the sealed window, and `spineForTenant` runs
   this helper on EVERY grounding call. Without it, uploading a folder makes the blueprint spine
   announce drift the user cannot act on, on every cockpit turn, for the whole ingest window.

Plus **`vault.vaultSearch`**, the browse search box — the same rag primitive on a separate code
path. Without it the browse surface shows documents the agent cannot see, which reads as a bug in
whichever of the two surfaces the user checks second.

#### What was deliberately NOT done

- **Not inside `ownedDocsMeta`**, the shared resolver both grounding paths funnel through.
  `vaultGroundHydrated` keeps a `titles` array index-parallel to `docIds`; silently dropping rows
  there desyncs titles from documents.
- **Not a `rag.search` filter.** `vaultRag.ts` declares no `filterNames`, and a filter baked in at
  embed time cannot change when a folder unseals without re-embedding every member.
- **Not a `sealed` status.** Sealing is a property of the FOLDER. A status would seal nothing,
  because retrieval never consults document status.

#### Accepted limitation — structural, not content

Ingest step 4 (`upsertGraph`) writes a sealed member's entities into the SHARED tenant graph, so a
sealed folder still raises `graphNodes.degree` (which feeds `blueprint.topEntities`) and can create
an edge joining two UNSEALED documents. **No sealed text and no sealed doc id ever reaches a
reader** — the locked decision says "excluded from retrieval", which the doc-id filter satisfies
literally. Closing the metadata half means deferring `upsertGraph` to folder completion, which
breaks the per-document ingest workflow. That is the upgrade path, not a bug fix.

#### How to verify

```bash
cd packages/backend && npx vitest run convex/vaultSealing.test.ts   # 6/6, offline, $0
```

Every `Mutation RUN:` comment in `vaultSealing.test.ts` names a mutation that was applied to the
source, observed RED and reverted — all five, each hitting exactly the test it names. **This plan is
entirely made of ABSENCES, and an absence test passes for free when the thing it guards was never
reachable.** That is why every test first proves the document IS reachable (the unseal half, the
unsealed-neighbour control, the pre-folder count) before proving it is not — and it is not
decoration: the graph-neighbour test was VACUOUS on first run and its own control caught it.
`upsertGraph` dedups edges cross-doc, so two documents given the identical entity pair leave the
second with no `graphEdges` row at all; documents must be linked by a SHARED NODE
(`A(Alice—Bob)`, `B(Bob—Carol)`), the chain fixture `vaultGraph.test.ts` already uses.


### 15.3-06 — the folder digest (`convex/vaultDigest.ts`)

One completed folder → ONE synthesised vault document, plus the staleness diff that drives the
Rebuild banner. `buildFolderDigest` (V8 `internalAction`, no `"use node"`) is scheduled from
`vaultFolders.tryComplete` and from `rebuildDigest`; nothing else schedules it.

#### ⚠ `origin: "folder_digest"` IS INERT — `startIngest` is the whole feature

There is ZERO `origin` predicate anywhere in retrieval. The `origin: "agent"` exclusion works by
the ABSENT `startIngest` call (`vault.ts:950-999`), not by a filter. So the digest is groundable
**only** because `writeDigest` calls `startIngest` — delete that one line and the feature is
silently dead **with every `origin === "folder_digest"` assertion still green**. The observable
check is `ragEntryId != null`. Do not add an origin-based filter anywhere to "fix" this.

#### The recursion guard is an ABSENT FIELD, not a predicate

The digest carries **no `folderId`**; the folder points at it via `digestDocId`. Two things follow,
and both are why no predicate is needed at any read site:

- a digest can never enter a `by_tenant_folder` member query, so it can never be an input to its
  own next synthesis, and it can never appear in its own stale set;
- `vault.countTerminal` is gated on `before.folderId`, so the digest's own ingest completing can
  never bump its folder's `terminalCount` past `memberCount`.

#### The three-part contract, and part 3 is the one that gets dropped

The `folder-digest` skill body (registry row, §5 — never hardcoded, fails closed unseeded) requires
`## What this folder is`, `## What it says`, and `## What could not be read`. Part 3 names every
non-ready member with the reason the manifest gives. It is stated in the OUTPUT CONTRACT, not in
guidance prose, precisely because a long digest crowds it out otherwise — and a digest that
silently drops a document it could not read makes the reader assume full coverage.

Parts 1 and 3 are built from PROJECTED metadata only (title, kind, docType, identityLine, status,
failureReason, size, createdAt). Part 2 gets a bounded head slice per member under a running total
(`DIGEST_PER_DOC_CHARS` / `DIGEST_TOTAL_CHARS`, mirroring `vaultGround.ts:29-30`). An ABSENT
`docType` renders as `not classified` and is NOT collapsed into the `"unclassified"` literal
(schema.ts:900 — never classified is not the same as classified and unplaceable).

**Never `.collect()` the members.** `digestMembersPage` paginates at `VAULT_FOLDER_MEMBER_BATCH`,
one page per transaction, and the ACTION carries the cursor. Convex has no projection, so a member
read pulls its whole row including up to 400k chars of `text` — ~40 max-size rows exhaust the
16 MiB per-transaction read cap, on the very feature meant to make a big folder usable.

#### Staleness is bounded by the folder, never by the global drift cap

`unincorporatedForFolder` clones `blueprint.unincorporatedFor`'s shape (a pure set difference, no
detector, no cron) with three changes: index `by_tenant_folder`, filter
`status === "ready" && !sourceSet.has(_id)`, and **`.take(folder.memberCount + 1)`**. Cloning
blueprint's `DRIFT_SCAN_CAP = 100` onto a 300-member folder inspects an arbitrary hundred and can
report 0 stale while dozens are — the banner then silently never fires. (`DRIFT_SCAN_CAP` is
module-private to `blueprint.ts` and not importable anyway.) No `sealedIn` filter: a folder with a
digest is `complete`, so nothing in it is sealed.

Accepted ceiling, named in a `ponytail:` comment at the helper: those rows still carry `text`, so a
folder of several hundred MAX-SIZE members can reach the read cap. Upgrade path is the same one
`blueprint.unincorporatedFor` names — a maintained counter on `vaultFolders`, bumped when a member
reaches `ready` outside the source set.

The only shipped way a COMPLETE folder gains a new `ready` member is `vaultSweep.retryExtraction`
(`vault.ts:205-211` refuses a new member on any folder that is not `reserving`), which is why the
source set is exactly the READY members at build time.

#### Money and ordering

- Completion order is fixed and unchanged: **settle → schedule digest → flip to `complete`**. The
  flip IS the unseal, so it stays last. The digest is SCHEDULED, so it observes the folder as
  `complete` and its reservation already zeroed — `buildFolderDigest` therefore asserts `complete`
  and must never assert `ingesting`.
- The digest is folder work: `preCall`/`recordSpend` both pass `rail: "ingest"`, so it never eats
  the cockpit's token window. It passes **no `reserved: true`** — the reservation is gone by then,
  so `reserved` would wave the call through on the kill switch alone with no money behind it
  (`guardrails.ts:294-298`). One small call can afford the honest two-window check.
- A refused gate is a governed STOP: a typed `{ ok: false, reason }` return, never a throw.
- **No model call fires until the user clicks.** `folderDigestState` is a pure read and nothing
  reacts to it; `rebuildDigest` is a `tenantMutation` that SCHEDULES the action (a mutation cannot
  run one).

#### The offline seam

`SMOKE::digest::` anywhere in the ASSEMBLED prompt (`.includes`, not `startsWith`) returns a
deterministic fixture with NO model call. It may ride in the folder NAME, a member TITLE, or a
member's TEXT — the name/title routes matter because a folder whose only member FAILED contributes
no excerpt at all. **The fixture must start with `SMOKE::graph::`**: the digest is itself ingested,
and that ingest's `vaultLlm.extractGraph` is only free when its text starts with that prefix at
position 0 (`vaultRag.embedDoc` is free on any `SMOKE::`).

#### Gotchas

- The skill is DELIBERATELY UNGATED and its version is **never pinned**: `seedSkills` lands a new
  name at v1/active only when `rows.length === 0`, otherwise `maxVersion + 1`. Verify with
  `getActiveSkill`, never assert a number.
- A rebuild PATCHES the row the folder already points at rather than inserting a second digest —
  two digests for one folder would both be groundable and the stale one would keep answering. The
  previous rag entry is NOT deleted (`rag.add` keys on `contentHash`), so a stale PASSAGE of a
  fresh document can still surface; ceiling named in a `ponytail:` comment, upgrade path is
  `rag.deleteAsync` on the old `ragEntryId`.
- convex-test never executes a `scheduler.runAfter` entry created inside the same test. Assert the
  `_scheduled_functions` row matching `/buildFolderDigest/`, then invoke
  `internal.vaultDigest.buildFolderDigest` directly. The harness must register `rateLimiter`
  (preCall/recordSpend) and `workflow` + `workflow/workpool` (startIngest).

#### How this is VERIFIED — `convex/vaultDigest.test.ts`

Five guarantees, one describe block each: groundability, non-recursion, staleness fires and clears,
staleness is exact at folder scale, and part 3 is present. Plus a sixth test pinning the fail-closed
skill load. All offline, zero spend — the folder NAME carries `SMOKE::digest::`.

**THE ONE SUITE IN THIS REPO THAT DRIVES THE INGEST WORKFLOW TO COMPLETION, and it has to.** Every
other vault suite produces a `ready` row by calling `internal.vault.markReady` by hand
(vault.test.ts, vaultFolders.test.ts, vaultSealing.test.ts). Doing that here would make
`ragEntryId != null` VACUOUS — it would pass with the `startIngest` call deleted, which is exactly
the defect the assertion exists to catch. So the digest test runs the real
`vaultIngest.ingestDoc` instead:

```ts
beforeEach(() => vi.useFakeTimers());        // workpool steps go through the scheduler
await t.action(internal.vaultDigest.buildFolderDigest, { tenantId, folderId });
await t.finishAllScheduledFunctions(vi.runAllTimers);   // ← the whole chain actually runs
```

This QUALIFIES the "convex-test never runs a `scheduler.runAfter` entry" note above: that is true
of a bare `runAfter` under real timers (vaultFolders.test.ts:84-88), and the digest scheduled by
`tryComplete` is still asserted as a `_scheduled_functions` row and then invoked directly. But the
workflow's own steps DO run under fake timers + `finishAllScheduledFunctions(vi.runAllTimers)`,
and that is what turns `ragEntryId` into a real observable. Every step is free:
`preCall` → `embedDoc` (SMOKE:: ⇒ fake entryId) → `extractGraph` (SMOKE::graph:: ⇒ fixture) →
`upsertGraph` → `recordSpend($0)` → `markReady`.

Skills are seeded with the REAL `internal.skills.seedSkills` and read back through
`getActiveSkill` — no hand-written `skills` row, no version literal anywhere in the file.

The staleness generator is the honest one: a member that was `failed` at build time and is later
rescued, simulated through the terminal mutation `vaultSweep.retryExtraction` ends in
(`internal.vault.markReady`). A raw insert into a `complete` folder would test a state the app
cannot reach (`vault.ts:205-211`).

The 120-member cap test depends on insert order BEING index order: `by_tenant_folder` is
`["tenantId", "folderId"]`, so members order by `_creationTime` within the folder. The five that go
stale are seeded last, which is why a `.take(100)` clone cannot see them.

#### Mutations actually run against this section (not reasoned about)

| Mutation | Observed |
| --- | --- |
| delete `await startIngest(...)` from `writeDigest` | `origin === "folder_digest"` **GREEN**, `ragEntryId` **RED** at the very next line. Grounding still returned the doc — the offline `SMOKE::` seam resolves seeds via `ownedDocsMeta` and never touches the index, so `ragEntryId` is the primary check and grounding the secondary one. |
| add `folderId` to the digest insert | 3 RED. `folderDigestState` reads `stale` the instant the build finishes — the banner fires forever, and each rebuild creates the row that keeps it firing. |
| `.take(folder.memberCount + 1)` → `.take(100)` | 1 RED, and ONLY the 120-member test: count `0` instead of `5`, reported as `fresh`. Exactly the silent "your digest is up to date" the bound exists to prevent. |
| drop `!sourceSet.has(doc._id)` from the filter | 3 RED — every ready member reads as unincorporated forever. |
| drop `failureReason` from `digestMembersPage`'s projection | 1 RED — the digest still NAMES the unreadable document but reports a bare status instead of the reason. Part 3 half-dies rather than disappearing, which is why the test asserts the reason string and not just the title. |

Re-run: `cd packages/backend && npx vitest run convex/vaultDigest.test.ts` (6 passed).

#### The verify pass — three defects found after the suite was already green

An adversarial review ran against the shipped code (not the reports) once
`vaultDigest.test.ts` was 6/6. It found three, and **all three are consequences of the one design
decision this plan is proudest of: the digest carries NO `folderId`.** That absence is the correct
recursion guard — and it also makes the digest invisible to every mechanism in the folder plane that
locates work by folder membership. Read that as the general lesson: *a deliberate absence needs its
own sweep of everything that used to find the thing by the field you removed.*

**1. The staleness read bounded ROWS, not BYTES** (`unincorporatedForFolder`). `.take(memberCount + 1)`
is a row bound; Convex has no projection, so each row arrives with its whole `text` (up to
VAULT_EXTRACT_CHAR_CAP = 400,000 chars). ~40 max-size members already exhaust the 16 MiB
per-transaction cap — and this runs inside `folderDigestState`, the drill-in **banner** read, so the
failure was **the folder page throwing**, not a wrong number. This is the identical defect
`readVaultPage` was written for in 15.3-02, on the identical index, so it now streams the identical
way: stop on whichever bites first, rows or `VAULT_GRID_READ_BUDGET_BYTES`. **Newest-first
(`.order("desc")`) is what makes the byte bound honest rather than merely safe** — unincorporated
members are by construction the ones added since the last build, so they sort to the front and an
early stop has already seen them. Residual, stated: a member rescued `failed → ready` by
`vaultSweep.retryExtraction` is newly unincorporated but OLD by `_creationTime`, so in a folder whose
text exceeds the budget it can be missed until the next build. **Under-reporting a rescued member is
a stale banner; throwing is a dead page.**

**2. `cancelFolder` orphaned the digest.** There is no status guard on cancel, so a `complete`
folder — the only kind that HAS a digest — is cancellable, and `walkFolderMembers` keys on
`folderId`, which the digest does not carry. The digest survived as a `ready`, embedded,
**groundable** document answering questions about a folder the user had deleted (including the
identity lines of members the walk had just failed as `folder_cancelled`), unreachable from every
folder surface because the `digestDocId` pointer died with the row. `cancelFolder` now cascades it
through `vault.deleteVaultDoc` BEFORE deleting the folder row. No counter moves: `bumpFolder` fires
on `before.folderId`, which a digest has none of.

**3. A refused build was completely silent.** `buildFolderDigest` is reached by
`scheduler.runAfter` from `tryComplete`, which discards the return value, so a `preCall` refusal on
the ingest rail left NO trace anywhere: `digestBuiltAt` unset (so the `already_built` belt does not
apply and nothing retries) and the folder reading `complete` with no `digestDocId` — indistinguishable
from a digest never attempted. A large folder that just drained the ingest window it holds no
reservation against lands exactly there. The gate-refusal branch now writes ONE
`folder.digest_refused` audit row, refs and ids only (§4). It is the only refusal audited, because
it is the only one that leaves no other evidence.

**Also fixed: the digest's own re-ingest was on the COCKPIT rail.** `vaultIngest.retryStuckIngests`
derives the spend rail by resolving `d.folderId` — null for a digest — so an operator-run sweep
would have charged `embedDoc` + `extractGraph` to the $5 token window. It now takes the ingest rail
via `origin === "folder_digest"`, but deliberately **without** `reserved`: there is no reservation
behind a digest, and `reserved` would wave it past the budget on the kill switch alone.

Ruled SAFE by the same pass, with evidence, so nobody re-litigates them: the sealing interaction
(three independent reasons a mid-ingest digest cannot leak — the action refuses a non-`complete`
folder, the schedule commits with the transaction that flips the status, and the row is
`processing` until `markReady` writes `ragEntryId`); the recursion guard on the REBUILD path as well
as the first build; §2/§4/§5 compliance.

**One test-seam wart, deliberately left.** The cancel test clears the digest's `ragEntryId` before
cancelling. The offline embed returns a `smoke::<hash>` sentinel that is not an id of the rag
component's `entries` table, so `deleteVaultDoc`'s `rag.deleteAsync` half rejects it with a validator
error that cannot happen against a real entry id. The guarantee under test is that cancel REACHES
the digest; the cascade itself is `deleteVaultDoc`'s own contract, covered in `vault.test.ts`.

Re-run: `cd packages/backend && npx vitest run convex/vaultDigest.test.ts` (**9 passed**).

### 15.3-07 — the folder surface (VALT-05, VALT-06, VALT-08, VALT-10, VALT-11)

The user-facing half of folders: a directory picker, an always-on pre-flight card, the refusal that
names both numbers, folder cards with sealed progress and cancel, drill-in, and the stale-digest
rebuild. Seven files — `vaultFolders.folderEstimate` (the only backend addition), `preflightCopy.ts`
(+ its test), `PreFlight.tsx`, `FolderBreadcrumb.tsx`, and edits to `Dropzone.tsx`, `DocGrid.tsx`,
`page.tsx`. The app still has **no component library** (BRAND §8, `globals.css:4-5`): inline style
objects, `globals.css` tokens, `clay-*` classes. Do not add one to change this surface.

#### The pre-flight is an INLINE PANEL, never a modal — and that is an a11y decision

`PreFlight` renders in the Dropzone's slot as a `clay-card`, not a portal. It is not a style
preference. There is **no shared dialog pattern in this app to inherit**: only two `aria-modal`
blocks exist, neither is shared, `PreviewModal` has Esc + scroll-lock but **no focus trap**, and
`DisconnectGoogle.tsx:25-27` documents that absence deliberately. A modal here would have owed a
focus trap, a scroll lock, an Esc handler and a return-focus target — four things nothing in this
codebase provides — so an inline step was the shortest path that also inherits **no** gap. A second
reason it cannot be a portal: `.clay-card`'s `backdrop-filter` frosts the `.pane-canvas` teal aura
(`globals.css:884-886`), so a portalled panel renders against nothing.

If someone later wants this in a dialog, that is a dialog-pattern plan for the whole app, not a
vault plan.

#### Every atom that must survive Refresh lives in `VaultPage`, because `key={nonce}` DESTROYS `VaultBody`

Refresh does not re-fetch — it bumps `nonce`, which is `VaultBody`'s **remount key**
(`page.tsx:41`). React does not re-render on a key change; it unmounts the subtree and every
`useState` in it. `page.tsx:19-21` already said this about `category`. This plan added three more
atoms to the shell, each for a failure a user would actually hit:

| State | Owner | What a remount would have done |
| --- | --- | --- |
| `currentFolderId` | `VaultPage` | Teleported the user out of the folder they were reading, silently, back to the flat grid |
| `picked` (File handles + manifest) | `VaultPage` | Forced a re-pick of a 1.5 GB directory — File handles cannot be re-derived |
| `phase` (idle/uploading/refused/failed/started) | `VaultPage` | Wiped a reserve **refusal** whose folder is already `refused` server-side, so the user presses Start again and re-uploads 1.5 GB into a second folder |
| `selected` (preview modal) | `VaultBody` — **deliberately left** | Nothing: it is one click to re-open, and discarding it on Refresh is existing behaviour |

Belt AND braces on the upload: the Refresh button carries `disabled={phase.kind === "uploading"}`
with an honest `title` (BRAND §1). Lifting `phase` keeps the *result* alive; disabling the only
remount trigger is what stops the async loop — which RUNS inside `PreFlight`, inside `VaultBody` —
being orphaned mid-flight (setState on an unmounted tree, half-created folder). Refresh is
meaningless during an upload anyway: every vault query is already live.

**The rule to carry forward: anything new on this surface that a user would be angry to lose belongs
in `VaultPage`.** Putting it in `VaultBody` is not a bug you will see in a test — it is a bug you see
once, in production, after an 8-minute upload.

#### Inside a folder the breadcrumb REPLACES `CategoryTabs` — one ternary, in the same slot

A folder is a **provenance scope, not a category**; they are different axes. Leaving the tabs live
inside a folder lets a user select "Videos" in a folder that has none and stare at an empty grid with
no explanation — the tab says one thing, the folder says another, and the surface explains neither.
So the slot is one ternary: `currentFolderId ? <FolderBreadcrumb …> : <CategoryTabs …>`.

The same logic gates the upload slot on `!currentFolderId`: a sealed folder takes no new members
(`vault.ts:205-211`), so offering a Dropzone inside one would promise what the server refuses.

Presence of the `folders` prop is the scope signal, and it is load-bearing for the empty state:
an ARRAY (possibly empty) at the top level, `undefined` inside a folder — which is what lets `DocGrid`
say "This folder is empty." with no extra prop. `folders ?? []` at the top level means a *loading*
folder list never misreads as "in a folder". `getFolder` returning `null` (the lenient join,
`vaultFolders.ts:507-512`) routes back out; `undefined` (loading) must NOT, or a slow first paint
bounces the user out of the folder.

#### READY IN is TWO terms, and processing dominates transfer

```
transferSec = ingestBytes / UPSTREAM_BYTES_PER_SEC
processSec  = ceil(docCount / VAULT_INGEST_PARALLELISM) * SECONDS_PER_DOC
readySec    = transferSec + processSec
```

Showing transfer time alone is the dishonest version: 400 documents at concurrency 6 is **tens of
minutes**, not the four minutes the bytes suggest. BRAND §1 ("honest about limits") makes that a
brand rule, not a nicety.

`VAULT_INGEST_PARALLELISM = 6` is real (`constants.ts:90`, whose own comment says the ready-in
estimate is computed from THIS number, never an assumed deployment class). **The other two do not
exist anywhere in the repo and were invented**, declared locally in `PreFlight.tsx` beside their only
consumer with a `ponytail:` comment. That is the trap to know about: *every* time-shaped constant in
the ingest path is a CEILING — `EXTRACTION_WATCHDOG_MS` (15 min), `CALL_TIMEOUT_MS` (480 s),
`PAGE_TIMEOUT_MS` (60 s), `FANOUT_BUDGET_MS` (420 s) — and using one as a duration gives ~16 hours
for 400 documents. Upgrade path, when anyone wants it real: measure elapsed `markExtracting` →
terminal, then move both into `packages/vault/src/constants.ts`.

#### The refusal sentence has ONE writer, and naming the numbers is the DEFAULT

`preflightCopy.ts` is a **sibling** of `failureCopy.ts`, not a row in it, for a mechanical reason:
`failureCopy` is a flat `Record<string, {title, remedy}>` of frozen literals with no number
parameter, so it cannot interpolate. Both obey the same boundary — codes stay in `convex/`, prose
lives in the surface (`failureCopy.ts:3-5`, `:17-18`, CLAUDE.md §4). **The template must never appear
in `vaultFolders.ts`**; the runnable form of that rule is the single-writer assertion in
`vaultSurface.test.ts` (which must `readFileSync` `preflightCopy.ts` explicitly — `surfaceOf()`
globs `.tsx` only, so a `.ts` module is invisible to `src` and any assertion against it would be
vacuously green).

The locked shape:

> This folder needs about $3.40 and you have $1.10 left today.

**Naming both numbers is the DEFAULT branch, not a per-reason opt-in.** Only three reasons are on the
no-figure deny-list, because their numbers are meaningless: `kill_switch` (the switch stops BEFORE
pricing, so both figures are 0 — `guardrails.ts:510-511`), and the two state guards `not_reserving` /
`manifest_short` (`vaultFolders.ts:112-128`), which are zero-valued. Everything else — **including a
refusal code added later** — names both. That direction is deliberate and fail-safe: a new code that
falls through to a default names real figures instead of going silently quiet.

`skipCopy(reason)` returns `null` for a non-skip reason, and that `null` IS the membership test — it
keeps the skip vocabulary (`empty_file` / `over_video_cap` / `over_file_cap`) in the one module that
already owns code→prose, so `PreFlight` needs no literal set of its own. Its copy contains no digits
at all: `vaultSurface.test.ts` bans `/100 MB/` across the surface, so a skip line says "too large to
read", never a size.

#### Estimate/reserve parity — what keeps the on-screen figure equal to the money taken

Three things, and all three matter:

1. **`folderEstimate` is a `tenantQuery` that consumes nothing** (modelled on `media.jobEstimate`). It
   replays `reserveFolderInner`'s checks in the SAME ORDER, steps 1-4, and stops before the two
   `rateLimiter.limit(..., reserve: true)` calls. `rateLimiter.check` takes a `RunQueryCtx`, so this
   is real parity, not an approximation.
2. **The ceilings PRECEDE the two `check` calls.** `check()` does not return `{ok:false}` above
   capacity — it THROWS (`guardrails.ts:485-488`). Get the order wrong and a governed plain-language
   refusal becomes a stack trace on the pre-flight card.
3. **`reserveFolder` receives `picked.manifest` VERBATIM AND UNFILTERED** — the identical array the
   card priced, so `estimateFolderCents` runs over the same input and the cents cannot drift. Do NOT
   rebuild it from the upload results: that drifts the number *and* risks `manifest_short`, since
   reserve refuses when `files.length < folder.memberCount`. The manifest is always ≥ `memberCount`
   because `memberCount` counts only rows actually INSERTED (dedup hits and failures never bump it).

The manifest carries **no filename** — `vFileManifest` mirrors `EstimateInput` and nothing else
(`guardrails.ts:464-466`). `folderEstimate.perFile` is index-aligned with `files` and refs-only, so
the surface zips it against its own local `File[]` for names. Never add `name` to that validator.

**The reserve can refuse with FRESHER numbers than the card showed** — the card is read at T, the
reserve happens at T+8 minutes of transfer — so that is a designed state, not an edge case. On
`!ok` the panel HOLDS, re-renders `refusalCopy()` over the RESERVE's figures, visibly replaces the
EST. COST tile, and adds "Nothing was read." (the folder is already `refused` server-side with its
members failed). Start is never re-enabled on that `folderId`: `reserveFolder` CASes on status
`reserving` and would only answer `not_reserving`.

#### The rebuild is the 17.1 idiom REUSED, not a new banner

Staleness renders as an unincorporated COUNT beside the folder name plus the **same** Rebuild button
flipping secondary→primary — one label, one handler, only the emphasis changes
(`BlueprintPanel.tsx:141-150`, `:188`) — with a `<p role="status" aria-live="polite">` outcome line
whose no-op wording is the established "Nothing has changed" (`:115`, `:116`, `:125`). Staleness is
DERIVED from `unincorporatedCount > 0` at read time (`blueprint.ts:450-457` shape), never a stored
flag, and nothing auto-triggers the rebuild — `vaultDigest.ts:556-557`: *the rebuild is the user's
click, never a reaction to this read.*

**`ReconnectBanner` is the wrong model and must not be copied.** Four disqualifiers:

1. **It is dismissible, and dismissal is client-only `localStorage`.** A stale digest is not a notice
   you acknowledge — it is a state of the data that only rebuilding clears. Dismissal would leave a
   folder whose digest is permanently, silently wrong in one browser and correct in another. The 17.1
   idiom needs no dismiss: when the count hits 0 the affordance disappears on its own.
2. It renders nothing until after mount (flash-avoidance for a page-chrome strip) — dead weight
   inline, and it would fail a first-paint scan.
3. It is a full-bleed strip mounted in the app shell; the digest state belongs beside the folder
   header, reporting on a folder the user is actually in.
4. **It uses amber, hardcoded** (`#fef3c7` / `#f59e0b` / `#92400e`) — see below.

No `aria-live` on the ticking sealed counters (`ChatPane.tsx:208` precedent); only the terminal
rebuild outcome is announced.

#### Amber is the approval gate's alone (BRAND §2)

Nothing on this surface renders `--held` or `--held-text`, and nothing hand-rolls an amber.
BRAND.md:50: *"The approval gate ONLY — amber = 'held, awaiting release'. Spend amber in exactly one
place."* BRAND.md:114-115 adds that `--held` is ~1.9:1 on light paper and fails WCAG for text at all
— so `ReconnectBanner`'s `#92400e` is already a hand-rolled dodge of the token rule, which is a
second reason not to copy it.

The refusal uses the established failure palette — `#fef2f2` bg / `#fecaca` border / `#991b1b` text,
cloned from `PreviewModal.tsx:345-371`, licensed by `connect-gmail/page.tsx:28-31`: *"Red stays
hardcoded: BRAND defines no error token."* A one-line inline note uses the `#dc2626` `role="alert"`
form already shipped in `Dropzone.tsx:187`; the panel palette is for the governed refusal BLOCK only.

Two related traps:

- The sealed-folder progress chip reuses `StatusChip` with an existing `statusBadge` key plus a
  `label` override ("12 of 300 read"), and deliberately maps `ingesting` to the neutral
  `pending_extraction` palette — NOT `processing`, which is amber-LOOKING (`#fef3c7`/`#92400e`). Zero
  new hexes, and the COUNT carries the meaning (BRAND §6: never colour alone).
- **An amber guard in `vaultSurface.test.ts` must match TOKEN NAMES** (`--held`, `#f0a22e`,
  `#8f5406`), never "amber-ish hexes" — `#fef3c7`/`#92400e` already ship for the `processing` chip
  and are explicitly sanctioned at `DocGrid.tsx:20-23`.

#### Sealed progress and the wait control

Progress is read straight off the live `listFolders` row (`terminalCount` / `memberCount`) — **no
poll, no timer, no second query** (`DocGrid.tsx:349-353`; `vaultSurface.test.ts:86-89` bans
`setInterval` and the literal `setTimeout(` across every `.tsx` on this surface, so a debounce, a
retry delay or an auto-dismissing toast turns a green test red). The sealed folder's Discuss control
is the REAL `disabled` + `aria-disabled="true"` + `title` + `aria-label` button, never an `<a>` and
never `pointer-events:none`. Cancel sits in the sibling-absolute slot Retry uses, driven by a NEW
`cancellingId` lock — sharing `retryingId` would cross-disable every failed document's Retry
(`:390` is a global one-at-a-time lock).

Both counters that would have started lying were fixed: the header reads `3 FOLDERS · 12 ITEMS`
(prefix suppressed at zero), and the zero test became "nothing at all to show" — gating on
`rows.length` alone would have suppressed the whole grid container and every folder card with it.

#### Known ceilings and gotchas

- **No cap on how many files a directory pick may contain.** There is no `VAULT_FOLDER_FILE_CAP`
  (`VAULT_FOLDER_MEMBER_BATCH = 20` is a transaction read bound, not a limit). A 5,000-file pick
  sends a 5,000-element array as `folderEstimate`'s query args on every subscription and drives a
  5,000-iteration sequential upload loop. Deliberately not invented here; the fix is a constant in
  `packages/vault/src/constants.ts` plus an honest client-side refusal at pick time.
- **`vaultStats` is not folder-scoped.** It reads the unscoped `readVaultPage` (`vault.ts:528`), so
  inside a folder the four KPI tiles still describe the whole vault, and at the top level TOTAL FILES
  disagrees with the grid's new "N FOLDERS · M ITEMS" line by the folder count. The in-surface
  mitigation is that explicit two-count line; making the tiles folder-aware needs an optional
  `folderId` on `vaultStats`.
- **Cancel is only reachable from the folder card**, not from inside the folder — the breadcrumb
  deliberately carries no `cancelFolder`. Back out to cancel.
- **`webkitdirectory` is non-standard and cannot go on the existing input** (it makes an input
  directory-ONLY), so there is a SECOND hidden input, with the attribute applied via
  `ref.setAttribute` because React/TS does not type it. **There is no directory-DROP support at all**
  — `e.dataTransfer.files` is empty for a dropped folder, which used to look like nothing happening;
  the drop handler now detects it and says to use the Folder button. `ponytail:` upgrade path is
  `webkitGetAsEntry()` + paginated `readEntries()`.
- **The folder rail does not hash in the browser.** `vault.vaultUploadFolderFile` hashes server-side
  (plan 04); `ingestOne`'s `crypto.subtle` path stays on the single-file route only. Hashing 400
  files client-side means 400 full-file `arrayBuffer()` reads.
- `Dropzone.handleFiles` no longer collapses nine failures into one message: it accumulates a
  `FileOutcome[]` and the loop continues past a throw.
- **`preflightCopy.test.ts` runs NOWHERE as written.** `apps/web` has no vitest dependency, no
  config, no `test` script and no root workspace, and `pnpm test` is `turbo run test`. The file is at
  the mandated path but the CI-visible assertion is the one in `packages/core/src/vaultSurface.test.ts`
  — which is also where any future pure-copy check belongs (that package already reads `apps/web`
  sources off disk, and its `edge-runtime` sibling in `convex/` has no `node:fs`).

#### How this is VERIFIED

```
cd apps/web && npx tsc --noEmit                     # 0 errors
cd packages/backend && npx convex codegen --typecheck disable && npx tsc --noEmit -p tsconfig.json
cd packages/core && npx vitest run src/vaultSurface.test.ts
pnpm --filter @pikar/web build
cd apps/web && npx playwright test --list           # 25 tests in 16 files — LIST ONLY, never a run
```

Two harness facts worth not rediscovering: `npx playwright test --list` works only from `apps/web`
(the root-relative `--config` form resolves a second playwright module and reports 0 tests), and a
real e2e run needs convex dev plus `:3111`, which is not a thing this repo starts for you.


#### The verify pass — four defects the green suite could not see

Three adversarial lenses ran against the shipped code once everything was green and the build
passed. **The unifying cause is infrastructural: `apps/web` has no unit-test runner at all** — no
`test` script, no vitest dependency, no config at the app or repo root, and `pnpm test` is
`turbo run test`, which skips a workspace that declares no `test` script. Anything asserted inside
`apps/web` is asserted by nobody.

**1. A test file that never ran.** `preflightCopy.test.ts` was written beside its module and
executed nowhere. That is worse than no test: the file reads as coverage in a diff and in review.
Deleted; its assertions now live in `packages/core/src/vaultSurface.test.ts`, which really runs, as
the **only behavioural import in that otherwise source-scanning file** — `preflightCopy.ts` imports
nothing, so it crosses the package boundary cleanly. **A source scan cannot prove this rule and
must not pretend to:** the scan checks the template lives in one file, and stays green if someone
drops the remaining-cents interpolation while leaving the words "left today" in place.
Mutation-verified — that exact edit takes the four numbered arms RED while every text anchor still
matches.

**2. Estimate/reserve parity was asserted by nothing.** The plan's `<verification>` block names it
("the pre-flight `totalCents` equals what `reserve` consumes") and names its precedent
(`media.test.ts`'s `jobEstimate` describe), and the folder clone was never written. Parity was held
only by two hand-maintained copies of the same checks — `folderEstimate` and `reserveFolderInner` —
plus a comment asserting they match. **That rots silently in exactly one edit:** add a refusal check
to the reserve, or reorder the ceilings, and nothing goes red, because `vaultSurface.test.ts` only
greps text and nothing else called the query. Three tests now live in `vaultFolders.test.ts`: cents
parity against the *window*, not just the return value; the estimate consumes nothing across five
calls; and a refusal arm where both sides must agree on the reason. Two mutations run RED.
**Fixture trap worth knowing:** a folder whose `memberCount` is still 0 reserves and immediately
completes (`terminalCount === memberCount` at 0 === 0), which settles and REFUNDS inside the same
call — the window ends up untouched and a parity assertion passes for the wrong reason. Upload the
members first.

**3. The Start loop's money path was unguarded.** `createFolder` and each per-file upload were in
try/catch; `reserveFolder` and both `cancelFolder` calls were bare, inside a fire-and-forget
`void start()` handler. A slept tab or one transient socket error after a 20-minute 1.5 GB upload
rejected into the void: `onPhase` never fired again, the panel froze on "Sending 400 of 400…" with
Start disabled and Cancel a no-op, and 400 members sat at `pending_extraction` under a folder **no
sweep will touch** (`vaultSweep` deliberately skips `reserving`, and there is no folder-level cron).
That is the silent parking this phase abolished, re-introduced in the browser. Now: a `safeCancel`
helper that can never itself throw on the refund path, and a guarded reserve whose failure names
the manual exit.

**4. Per-file failures were built and then thrown away.** The accumulator exists because
`handleFiles` used to collapse every failure into one `error` string. It kept every outcome — and
then the partial-success path called `onClear()`, which unmounts the panel and takes the local
`outcomes` state with it. A 10-file pick where 8 landed reported "8 documents" and never named the
other two. Now the panel only auto-clears on a CLEAN run; a partial success holds it open on the
`started` arm (previously a dead union member written and read by nothing) with a Done control.

Also fixed, smaller: Cancel mirrors its ref into state so it says "Cancelling…" instead of sitting
inert for a whole file; the EST. COST tile renders an em-dash rather than a confident zero on the
two refusal arms that carry no `estCents`; the dropped-folder message names the control's real
label ("Choose a folder", not "the Folder button"); the breadcrumb reads "3 added since the last
digest" rather than the truncated "3 added since"; a search matching no document now SAYS so even
when folder cards remain on screen (folders are not searched); and the pre-folder empty-state
wording is byte-identical outside a folder, because "a tenant with no folders sees a vault page
identical to today's" includes the words.

**Deliberately NOT fixed, and why.** The new folder-card Cancel pill is 0.72rem bold white on
`--teal-600` (3.67:1, below the 4.5:1 that applies under 18.66px). It is a **byte-identical clone
of two already-shipped pills** — Retry and Discuss, same size, same fill — and BRAND §6 sanctions
teal-600 for white-text button fills. Fixing one of three makes the surface inconsistent without
making it accessible; it needs a surface-wide pass over all three, tracked here as a known gap.
Likewise `remainingCents` is `min(tenant, deployment)`, so "you have X left today" can be reporting
a shared constraint; the refusal REASON already distinguishes the deployment arms ("for everyone
today"), and showing the tenant's own untouched allowance while refusing would be worse. And
`npx playwright test --list` fails from the repo ROOT with a two-versions-of-@playwright/test
module-resolution error — **pre-existing, unrelated to this wave**; from `apps/web` it reports 25
tests in 16 files, matching the baseline.

**The standing lesson: `apps/web` cannot hold a runnable check.** Until it gets a runner, anything
that must be observable about the web surface belongs in `packages/core/src/vaultSurface.test.ts`
(a source scan, or a behavioural import when the module has no React/Next dependency) or in a
backend suite. A test file placed under `apps/web` is decoration.

### 15.3-08 — document identity (VALT-12)

Every document gets a machine-derived `docType` off a closed 12-member union and a human-readable
identity line — *"2025 P&L"*, not *"a spreadsheet"* — that the user can correct and that nothing
ever overwrites. `packages/core/src/docType.ts` (the union), a `document-classifier` registry row,
`vaultLlm.classifyDoc` + one new step in `vaultIngest.ingestDoc`, `vault.applyClassification` +
`vault.setDocIdentity`, and the grid/preview surfaces.

#### The union lives in `packages/core`, NOT `packages/vault`

`apps/web` renders a `<select>` over `DOC_TYPES` and its labels, and the shipped precedent for
exactly that shape is `ShapePanel.tsx` importing `REVENUE_STAGES` from `@pikar/core`. The vault
package is the wrong home for a union the web surface drives: `Dropzone.tsx` and `CategoryTabs.tsx`
both record that `apps/web` deliberately did not depend on `@pikar/vault`, and the **duplicated
size caps** that 15.3-02 had to collapse into one declaration are the defect that split produced.
Plan 02 has since added `@pikar/vault` as a web dep for constants, and the union still goes in core
— *do not create a third local re-declaration.*

The literals exist in two places by necessity, not by accident: the schema's `v.union` (the
database's closed set) and `DOC_TYPES` (the domain's). They are bound by a **two-direction compile
bridge** in `vaultLlm.ts` beside the classifier — `_docTypeToDoc` / `_docToDocType`, both wrapped
in `NonNullable<>` because the schema field is `v.optional`. Without the wrap, `undefined` joins
the array type and the bind passes in one direction while failing in the other. It lives in the
convex file rather than in core because it needs the generated `Doc<>` type and core must stay
Convex-free (§1). Mutation-verified: adding a literal to one side and not the other is a
**typecheck failure**, not a runtime surprise.

#### The skill row is DELIBERATELY UNGATED — and that is a mechanism, not an opinion

`DOCUMENT_CLASSIFIER_SKILL` is **absent from `GATED_SKILLS`**, pinned by
`expect(isGatedSkill(DOCUMENT_CLASSIFIER_SKILL)).toBe(false)` so a future *"tidy up the gate list"*
edit fails in the suite rather than in production. The reason is the same deadlock three other
skills already carry: `run-eval-golden.mjs` derives its `--skill` list FROM `GATED_SKILLS` and
drives `runCockpitAgent` over TEXT fixtures. No fixture reaches vault ingest — this skill runs
inside the `ingestDoc` workflow against a stored document's redacted head slice — so gating it
would strand it at v1 on its first body edit, with a candidate no eval run could ever certify.
Revisit when a fixture exists.

As a NEW name it takes `seedSkills`' `rows.length === 0` branch and lands at v1 `active`: no eval
cycle, no paid run. **Never pin a version anywhere** — an existing name gets `maxVersion + 1`.

#### `classifyDoc` NEVER THROWS — the one deliberate inversion of the fail-closed rule

Everywhere else in this codebase `getActiveSkill` failing closed is the point: an unseeded registry
must stop the work rather than let a hardcoded prompt sneak in. Inside `classifyDoc` the same throw
would be a catastrophe of a different order, and the blast radius is worth spelling out because
nothing about it is visible at the call site:

1. `step.runAction` retries on the shared `WorkflowManager`'s default behaviour — `maxAttempts: 3`,
   `retryActionsByDefault: true` — so a throw is **three** attempts, not one.
2. Attempts exhausted ⇒ the run terminates `failed`, and the later steps never run. `markReady` is
   never reached, so the document keeps no `ragEntryId`: it loses its **embedding and its graph**,
   not just its label.
3. `onIngestComplete` then flips the still-`processing` row via `markFailed`, which calls
   `countTerminal` ⇒ `bumpFolder(…, failed)` — **inflating the folder's failure count in the very
   manifest the digest promises is honest.**

One unseeded skill row would do all of that to EVERY document in the deployment, for a cosmetic
label. So the whole handler sits in a try/catch and any throw returns
`{docType: "unclassified", identityLine: "", costUsd: 0}`. **The fallback is a degraded LABEL, never
a degraded grounding corpus.** The catch wraps the whole body and not merely the model call on
purpose — the unseeded-registry throw comes from the skill LOAD, and that is the case the behaviour
is specified against (*unseeded ⇒ the document still reaches `ready`, labelled `unclassified`*).

The load still happens FIRST, and still BEFORE the offline seam (the `vaultDigest.ts:282` ordering)
— the SMOKE path has to exercise the registry too, or the seam hides an unseeded backend. Only the
*consequence* of the failure is degraded, never the ordering.

`ponytail:` the failure is swallowed, not recorded — an unseeded deployment looks identical to a
vault of genuinely unplaceable documents. Upgrade path is an ops query counting `unclassified`
rows (the row is already re-classifiable), not a new column.

#### A model string never reaches the database

The `jsonSchema` carries `enum: [...DOC_TYPES]` so the PROVIDER constrains the output rather than
the prompt's prose alone — but the TS type of that field is deliberately `string`, not `DocType`.
Typing it `DocType` would make the compiler believe the provider and render the
`isDocType(x) ? x : "unclassified"` coercion vacuous. The enum is a request; this file's job is to
not believe it. The offline fixture's `docType` runs through the SAME guard — a hand-written
fixture naming a type nobody defined must not be the one path that writes an out-of-union value.

This matters beyond tidiness: the arg validator on `applyClassification` is the schema's closed
`v.union`, so an uncoerced string throws *"invalid argument"* INSIDE the workflow — i.e. it takes
the whole document down the failure path described above.

#### The offline gate is the bare `SMOKE::`, not `SMOKE::classify::`

The fixture grammar is `SMOKE::classify::<docType>|<identity line>`, but the test that decides
*"no model call"* is the bare prefix — the `vaultRag.embedDoc` precedent. Classification now runs
on every document on every ingest path, so **every existing offline fixture flows through here**,
including the folder digest's own markdown, which is REQUIRED to start with `SMOKE::graph::` so the
extractor stays free. A classify-only `startsWith` would miss all of them and drop each into a real
`generateObject` call: green in convex-test with no API key (the try/catch swallows it) while
silently attempting network I/O, and **actual money on the dev deployment, on exactly the path the
seam exists to keep free.** Any other `SMOKE::` document is simply UNIDENTIFIED at zero cost.

Narrowing that gate is a one-word edit with a spend consequence and no currently-red test outside
the one written for it. Treat it as load-bearing.

#### User-set precedence is an ABSENCE, and the paths that make it load-bearing already ship

`applyClassification` reads `if (doc.identityUserSet === true) return null;` and only then patches.
**The guarantee is that NO branch anywhere writes `docType`/`identityLine` over a user-set row —
that absence is the guarantee**, in the exact sense `packages/core/src/blueprint.ts:356-374` records
for `mergeBlueprint`: *a merge rule in a prompt is a request, a function with no overwrite branch is
a guarantee.* (Note: the plan text points at `blueprint.ts:358-364`, which in the CONVEX file is an
unrelated `vaultDocuments` insert. The precedent is the core file.)

Re-classification is not hypothetical. `vault.ingestExtractedText` restarts `ingestDoc` on an
EXISTING row for every deferred binary, and `vaultSweep.retryExtraction` re-enters the same node
via `scheduleExtraction`. A user who names a document and then hits Retry must not lose the name.

Verified as a repo-wide property, not a local one: of the vault-document insert/patch sites in
`convex/`, **only** `setDocIdentity` and `applyClassification` write any of the three identity
fields; ZERO insert sites write them (every row is born with all three absent); and `ctx.db.replace(`
appears nowhere in `convex/`, so nothing can clobber them wholesale.

Two smaller traps in the same pair of mutations:

- `applyClassification` deliberately does **not** call `countTerminal`. A label is not a terminal
  event and must never move a folder's read/unread manifest.
- The schema field is `v.optional`, and Convex reads an explicit `undefined` in a `patch` as a field
  **DELETE**. Both mutations therefore write `docType: docType ?? doc.docType`. Anyone
  "simplifying" that to a bare `docType` reintroduces silent un-classification on an omitted arg.
- Neither mutation throws on a missing or foreign row — they return. A throw from a workflow step
  is the failure path above.

#### The identity line is a TRUST BOUNDARY, not a cosmetic field

It is rendered into the folder digest's manifest and therefore **into a model prompt**, so it is
sanitised at the write boundary by `sanitizeIdentityLine` (cap 120), with `sanitizeAgentName`'s
exact op order — strip `\p{C}` → collapse `\s+` → trim → slice → **trim again**, so a cut landing
mid-whitespace cannot leave a dangling separator. Stripping control/format characters removes the
two things that make an injected line dangerous: a newline lets it open what looks like a fresh
instruction block, and a bidi override lets it render as something other than what it is.

It is applied to **both** writers — the user's line AND the model's. The plan only named the user
path, but both land in the same digest-prompt field, and one guard in the shared writer is smaller
than a guard in each caller. `ponytail:` ceiling — it does not detect a plausible-English
instruction; the structural defence is that the line sits in a LABELLED manifest field, never
concatenated as a bare directive. Upgrade path: one exported `sanitizeLine(raw, max)` in
`@pikar/core` when a third caller appears.

`IDENTITY_LINE_MAX` is currently module-private in `convex/vault.ts`, which is why the preview
`<input>` carries **no `maxLength`** — re-typing `120` in the web file would be the same
single-source defect 15.3-02 fought over, and `packages/core/src/vaultSurface.test.ts` exists to
punish exactly that. Export the cap from `@pikar/core` and the input can honour it.

#### `"unclassified"` is NOT the same as ABSENT — and only the digest can tell

ABSENT ⇒ never classified (every pre-15.3 row). `"unclassified"` ⇒ classified and genuinely
unplaceable: *a document matching nothing is never forced to a nearest match, because a wrong type
is worse than no type.*

**The grid cannot distinguish them, on purpose.** `docLabel(doc) = doc.identityLine || doc.title`
falls back to the filename for both, and the doc-type chip renders nothing for both — a chip reading
"Unclassified" on every pre-15.3 row is noise. The only surface where the distinction is visible is
the folder digest's manifest, which names each member's type or says it has none. If a future
feature needs the difference (an ops count of what the classifier gave up on, a re-classify sweep),
read the FIELD — do not add a third state, and do not backfill absent rows to `"unclassified"`,
which would erase the distinction permanently.

#### ONE `recordSpend` — a second call costs $3 per 300 documents in rounding alone

`identity.costUsd` is folded into `ingestDoc`'s existing single `recordSpend` sum
(`embed + graph + identity`). It is not a style preference: `guardrails.recordSpend` does
`Math.ceil(costUsd * 100)`, so a separate call for ~$0.00034 rounds to **a full cent every time** —
300 documents would charge **$3.00** against a $25 ingest window for $0.10 of real spend. Folded in,
the classifier's cost rides inside the same ceil. Real cost ≈ $0.10 per 300 docs ≈ 0.4% of the
window.

For the same reason `classifyDoc` calls **neither** `preCall` nor `recordSpend` itself: the
workflow's step (1) gate and its single spend call already cover it, and re-selecting the rail
inside the action would let a pre-paid folder's classify spend land on the wrong window.

#### Reach: this is not just uploads

The plan says *"single-file uploads too"*, which understates it. `startIngest` is the sole
`workflow.start` wrapper and its callers converge from `vault.ts` (×5, including
`ingestExtractedText`), `vaultIngest.retryStuckIngests`, `vaultFolders`, `voice.ts`, `research.ts`,
`onboarding.ts`, `evaluations.ts` — **and `vaultDigest.writeDigest`, so a folder digest classifies
itself.** Anything that changes classifier cost, latency or failure behaviour changes it for voice
transcripts, research reports and onboarding documents as well.

#### Where the observable checks belong

Behavioural claims (user-set-wins with its ABSENT twin, unseeded-degrades-not-fails, the union
coercion, the offline end-to-end) live in `packages/backend/convex/vaultClassify.test.ts`. Anything
about the WEB surface goes in `packages/core/src/vaultSurface.test.ts` — **`apps/web` still has no
test runner**, and a `*.test.ts` placed there is decoration (the standing lesson from `### 15.3-07`).
The compile guarantees — the label-table totality pair and the two-direction bridge — are sampled by
`tsc --noEmit`, NOT by a green vitest run; a suite that passes says nothing about them.

Two guards worth adding to `vaultSurface.test.ts` if they are not there yet, both one line and both
currently unobserved: `a.download = doc.title` / `alt={doc.title}` must survive (a find-and-replace
of `doc.title` → `docLabel(doc)` silently breaks *"the downloaded file keeps its real filename"*),
and the `d.identityLine || d.title` fallback must keep its `||` or every unclassified card renders a
blank primary line.

#### Known gaps

- `voice/DocPicker.tsx` still renders `doc.title`, so the voice picker shows FILENAMES while the
  vault grid and preview show identity lines. Out of scope for this plan. `docLabel` is exported
  from `DocGrid.tsx` and `projectVaultDoc` already returns `identityLine`, so it is a one-line
  drop-in whenever the voice surface is next opened. Filed here so it arrives as a known gap rather
  than a bug report.
- The preview's seed-once guard has **two** arming paths, and both are needed. Classification lands
  DURING `processing`, so a plain mount-time seed pins both fields empty forever; arming only when
  the row goes terminal means a document that finishes reading mid-edit seeds over what the user
  typed. So it refuses to arm until `status` is `ready`/`failed`, AND arms on the first keystroke.
  The next person to "simplify" that to a bare `useRef` once-guard reintroduces one of the two bugs.



#### The verify pass — three defects, and one flake that is NOT ours

**1. `identityLine` was passed raw from the model.** `classifyDoc` coerced `docType` through
`isDocType` and returned `identityLine: object.identityLine` untouched. The AI SDK's `jsonSchema()`
is called without a `validate` fn, so **the SDK does not check the model object at runtime** — the
inferred `string` type is a promise TypeScript makes and the provider keeps only usually. A missing
or non-string value reaches `applyClassification`'s `identityLine: v.string()`, which throws inside
`step.runMutation` — and that call sits **outside** `classifyDoc`'s try/catch. The throw exhausts
the workflow's retries and `onIngestComplete` marks the document `failed`. Now coerced beside
`docType`, where the trust-boundary comment already lived. **The lesson generalises: when you
coerce one field out of a model object, coerce every field of it — the uncoerced sibling is the
one that fails the document.**

**2. The seed guard was per-MOUNT, not per-DOCUMENT.** `PreviewModal` is rendered from `page.tsx`
without a `key`, so React reconciles same-type-same-position and switching the selected document
reuses the same instance — a boolean `identitySeeded` stayed armed, and the form kept document A's
type and identity line while displaying document B. Save would then write A's identity onto B. It
is reachable without closing the modal: there is no focus trap (recorded at `PreFlight.tsx`'s
header), so Shift+Tab reaches a grid card behind it and Enter re-opens with a different document.
The ref now holds the seeded `doc._id`. Keying the guard inside the component rather than adding a
`key` at the call site is deliberate: a future caller cannot reintroduce the bug by forgetting it.

**3. A classified-but-still-`processing` row seeded an empty form — and Save locked it.** The seed
gate was `status === "ready" || "failed"`, but `applyClassification` patches `docType` and
`identityLine` while the row is still `processing` (the classify step runs before `markReady`). A
row that stalls there — precisely what `vaultSweep` exists to recover — showed empty fields despite
carrying a classifier answer, and pressing Save wrote `identityLine: ""` with
`identityUserSet: true`, blanking it and locking it against every future re-classification. The
gate is now "terminal OR already classified".

#### The `crypto is not defined` flake is PRE-EXISTING — do not chase it into this wave

The backend suite fails intermittently — roughly 3 runs in 8 — with `ReferenceError: crypto is not
defined` (and sometimes `process is not defined`) inside `convex/onboarding.test.ts`, taking three
profile tests down. The verify pass reported it as correlated with this wave's new 61st test file.
**That correlation does not hold.** Reproduced with ONLY pre-existing files:

```bash
cd packages/backend && npx vitest run convex/onboarding.test.ts convex/vaultDigest.test.ts
# run 2 of 3 failed with BOTH `crypto is not defined` and `process is not defined`
```

No 15.3-08 file is involved. It is a load-dependent `edge-runtime` instability: async work outlives
the VM context and then executes against a disposed global scope, so the symptom surfaces in
whichever file the worker runs next rather than in the one that caused it. Adding a test file makes
it more likely to appear; it does not create it. The config comment in `vitest.config.mts` already
records an earlier load-dependent flake in this same suite (timeouts crossing 5 s under parallel
load) — this is the second of that family.

**Two hypotheses were tested and are wrong, so nobody re-tests them:** it is not leaked fake timers
(`vaultClassify.test.ts` pairs `beforeEach(vi.useFakeTimers)` with `afterEach(vi.useRealTimers)`,
as `vaultDigest.test.ts` does), and stubbing `globalThis.process` does not fix it (the failing
global is `crypto`, reached through `lib/hash.ts`'s `crypto.subtle.digest`). **A real fix means
serialising file execution (`fileParallelism: false` or a single fork), which roughly doubles a
140 s suite — an owner call, not a side effect of a feature wave.** Until then, a red
`onboarding.test.ts` with a `not defined` ReferenceError is this flake, not a regression: re-run
before investigating.


#### `apps/web` has a test runner (2026-08-04)

It previously had none — no `test` script, no vitest dependency, no config — and `pnpm test` is
`turbo run test`, which skips a workspace that declares none. **Anything asserted inside
`apps/web` was asserted by nobody**, which is how 15.3-07 shipped a `preflightCopy.test.ts` that
executed nowhere while reading as coverage in the diff and in review.

The runner is deliberately narrow: `environment: "node"`, `include` is **`.ts` only, never
`.tsx`**. It runs the pure modules beside the components — copy builders, formatters, pure
derivations. No jsdom, no testing-library, so React components still cannot be rendered.
`passWithNoTests: false` on purpose: an empty run is the exact condition the config exists to
make visible.

**Where a vault UI guarantee belongs now:**

| The guarantee is about… | Put it in |
| --- | --- |
| a pure module's OUTPUT (`refusalCopy` naming both figures) | `apps/web/**/*.test.ts`, beside the module |
| the SHAPE of the surface (single writer, no poll, no amber, state above the remount key) | `packages/core/src/vaultSurface.test.ts` |
| a rendered component's behaviour | still nowhere — needs jsdom, a deliberate two-dependency decision |

**The division is not arbitrary.** A source scan proves the refusal template has exactly one
writer and *cannot* prove it names both numbers — drop the remaining-cents interpolation while
leaving the words "left today" in place and every text anchor still matches. Both halves exist, in
different packages, for that reason.

#### The `crypto is not defined` flake — FIXED, and the cause was not what it looked like

**Root cause: `vault.test.ts` leaked workflow work.** It starts ingest 20 times and spies on the
ingest POOL — but `startIngest` goes through `workflow.start`, which schedules the **workflow**
component's own workpool functions via the scheduler, a completely separate path that file mocked
nothing on. Under real timers those runs fired *after* the file finished and the workflow component
retry-looped (`Run …runs failed, retrying in 800 ms`) against a torn-down module runner. The retry
executed inside whichever test file the worker had moved on to, and threw
`ReferenceError: crypto is not defined` / `process is not defined` out of perfectly innocent code.

**That is why every earlier theory failed.** The victim (`onboarding.test.ts`) had nothing wrong
with it — it was simply the file most often running when someone else's orphaned retry landed. And
it is why neither `fileParallelism: false` nor `pool: "threads"` helped: both change how files are
*scheduled*, and the leak is work escaping a file's lifetime entirely.

**The fix** is the guard `vaultExtract.test.ts` already documented and credited to `vault.test.ts`:
`beforeEach(vi.useFakeTimers)` / `afterEach(vi.useRealTimers)` in every suite that reaches
`startIngest` and asserts only synchronous effects. Applied to `vault.test.ts`, `gapAction`,
`intake`, `onboarding`, `research`, `vaultSweep`, `vaultTranscribe`. Suites that DRAIN instead
(`cockpit`, `vaultDigest`, `vaultFolders`, `vaultClassify`, `evaluations` — `finishAllScheduledFunctions`)
were already correct and are untouched.

**`dispatch.test.ts` is the one exception: it needs real timers** (one test fails under fake ones),
so it still leaks a little. That is the residual — two runs in eight printed a `not defined` line on
stderr while every test passed. If the flake ever returns, `dispatch.test.ts` is where to look
first, and the fix there is draining rather than freezing.

**Measured, because a 1-in-3 flake shows clean runs by luck:**

| | full-suite failures |
| --- | --- |
| before | 3 in 8 |
| after `vault.test.ts` alone | 2 in 10 |
| after all seven | **0 in 8**, stderr noise 0 in the last 4 |

**Two rules this leaves behind.** (1) **A test that calls `startIngest` owns the work it starts** —
either freeze the clock or drain the scheduler; doing neither pushes a failure into someone else's
file, where it is nearly undiagnosable. (2) **Validate a flake fix on the FULL suite, never a
subset.** Both wrong theories here looked confirmed on a two-file reproducer — `fileParallelism:
false` went 6/6 and `pool: threads` went 9/9 on the pair, and both still failed the full suite.

### 15.3-09 — the Google Drive rail (VALT-13)

`packages/backend/convex/vaultDrive.ts` + `packages/vault/src/driveEstimate.ts`.

**A SCOPE-WIDENING OF THE EXISTING GOOGLE GRANT, NOT A SECOND INTEGRATION.** No new secret, no new
HTTP route, no second token table, no second refresh POST — exactly as Calendar was.
`DRIVE_READONLY_SCOPE` is appended to `GOOGLE_SCOPES` in `packages/core/src/calendar.ts`, and the
token plane is `gmailAuth` + `gmail.freshAccessToken` reused verbatim.

**THE ORDER IS THE DESIGN, AND IT IS NOT THE UPLOAD RAIL'S ORDER.**

1. scope check → `reauth`, BEFORE `freshAccessToken` and before any network call;
2. enumerate (metadata only — no bytes);
3. **RESERVE, from that metadata**;
4. only then download anything.

Step 3 before step 4 is the one place this rail is deliberately ordered differently. On the upload
rail the browser has already sent the bytes by the time a manifest exists, so the reservation is
necessarily last. `files.list` returns count, size and type BEFORE a byte is exported, so a refused
Drive folder is refused without downloading a gigabyte first — refuse-intact stops being a property
we assert and becomes one proven by absence.

**TWO LOCKED DECISIONS WERE CORRECTED HERE, ON FACTS, NOT PREFERENCE (CONTEXT §A6/§A7).**

- **§A6 — the byte cap DOES apply.** "Nothing is uploaded, so the cap is irrelevant" was wrong:
  non-native files are DOWNLOADED, into a ~512 MB action, and a 600 MB video OOMs the action before
  any cap could refuse it. `classify()` applies `VAULT_VIDEO_CAP_BYTES`/`VAULT_FILE_CAP_BYTES`
  against `size` metadata during pre-flight, so the count the user approves is the count that
  imports.
- **§A7 — Drive metadata has no `size` for Google-native docs.** `estimatedBytesFor` falls back to
  `DRIVE_NATIVE_ASSUMED_BYTES` per kind and **NEVER returns 0**. Reading a missing size as 0 prices
  a 500-Doc folder at $0, reserves nothing, and the folder then trips the budget wall halfway
  through — the half-ingested folder this phase exists to forbid. `driveEstimate.test.ts` tests that
  exact branch; it is the single check keeping the reservation invariant true on this rail.

**⚠ THE SHARED-DRIVE PARAMETERS ARE THE HIGHEST-CONSEQUENCE, LOWEST-VISIBILITY DETAIL IN THE FILE.**
`supportsAllDrives=true` on every call (set ONCE, in `driveUrl`) and `includeItemsFromAllDrives=true`
on every `files.list`. Omit either and a shared-drive folder does not error — it returns **HTTP 200
with an empty `files` array**, and the product says "imported 0 files, folder complete". A lying
folder is worse than a failed one. There is NO behavioural test for this (a stub returns whatever it
likes), so it is pinned by a SOURCE SCAN in `dispatchGuard.test.ts`. A zero-child result on a folder
the user explicitly picked is additionally surfaced as `empty_folder`, never as a completed import.

**EXPORT TARGETS ARE LOAD-BEARING FOR DEDUP, not formatting.** Docs → `text/plain`, Slides →
`text/plain` (both deterministic, both in `SEARCHABLE_MIME`, so they skip extraction), Sheets →
**xlsx, NOT `text/csv`** — csv export is FIRST SHEET ONLY and silently drops every other tab.

**THE RE-IMPORT KEY IS `driveFileId + modifiedTime`, AND `contentHash` CANNOT BE IT.** OOXML is a
zip carrying timestamps and generated ids, so two exports of an UNCHANGED Sheet are not
byte-identical; a contentHash key would re-hash differently every refresh and duplicate the whole
folder. A changed file UPDATES ITS EXISTING ROW IN PLACE so the member set and `digestSourceDocIds`
stay stable. An unchanged listing issues **zero export fetches and creates zero rows** —
`diffImport` decides that before the reservation is even attempted.

**THE DUP EARLY-RETURN TRAP.** `vault.vaultUpload`'s dedup branch returns `{vaultDocId}` and does
nothing else — correct there, WRONG here. Copied verbatim, a file whose bytes the tenant already
holds gets no `driveFileId` (so it re-exports forever) and no `folderId` (so the folder reports N
files while owning fewer). `landFile` therefore **attaches identity without attaching membership**:
it patches `driveFileId`/`driveModifiedTime` and deliberately does NOT set `folderId`, because
annexing a pre-existing document into an `ingesting` folder would SEAL a document the user could
ground on yesterday (CONTEXT §B7).

**THE FAN-IN, AND WHY IT NEEDS TWO NEW FOLDER FIELDS.** On the upload rail the browser knows when it
has sent the last file and calls `reserveFolder` itself. Here the last file lands inside a SCHEDULED
action with no identity and no knowledge of its siblings, so "everyone has landed" is a counter:
`driveLandedCount` counts every terminal landing outcome — inserted, deduped, updated **or failed to
export** — and the folder leaves `reserving` only at `driveExpectedCount`. **Counting only
insertions would hang the folder in `reserving` forever the first time one export 404s**, holding a
reservation nothing settles, because there is no folder-level watchdog. The folder stays `reserving`
while files land precisely because `tryComplete` refuses to fire on anything but `ingesting` — that
is the structural guard against a fast first file completing a folder whose second file is still in
flight. `tryComplete` is now EXPORTED from `vaultFolders.ts` for this one reuse; do not inline a copy.

**`vaultDrive.ts` IS DELIBERATELY NOT `"use node"`**, unlike `gmail.ts`/`calendar.ts`. Those are
actions-only modules and the 01-07 rule is that a `"use node"` module holds ONLY actions — but this
rail's fan-in is a mutation. Nothing here needs a Node builtin (`fetch`, `Blob`, `TextDecoder`,
`crypto.subtle` are all in the V8 runtime). Adding `"use node"` later would silently break the
mutations, not just relocate them.

**DEVIATIONS FROM THE PLAN, STATED.** (1) The plan specified a self-scheduling enumeration
continuation to survive the 10-minute action limit; instead the walk is BOUNDED below that limit by
`DRIVE_MAX_FILES` (2,000) / `DRIVE_MAX_FOLDERS` (200) with an explicit `ponytail:` note and an
upgrade path — at `pageSize=1000` the caps are a handful of round-trips, not minutes. (2) The plan
did not name the folder-id validation; the id is interpolated into Drive's `q=` SEARCH EXPRESSION,
which percent-encoding does not protect, so `DRIVE_ID_RE` guards it at the trust boundary. (3)
Export-time failure codes go to `audit` (`vault.drive.unreadable`), not to the folder card — the
ceiling and its upgrade path are stated at the site.

**Verification.** `vaultDrive.test.ts` 11/11 and `dispatchGuard.test.ts` 14/14, with FIVE mutations
RUN: drop `supportsAllDrives` → RED; drop `includeItemsFromAllDrives` → RED; move `hasScope` below
`freshAccessToken` → RED in BOTH the static pin and the behavioural "fetch was never called" test;
add a file name to an audit payload → RED; bypass the `driveFileId` lookup → two rows instead of one.
**The name-leak scan initially PASSED that mutation** — it tested for `name:` and the shorthand
`name,` walked straight through. Fixed; if you add a forbidden key to that list, use the same
property-position regex, not `includes`.

**NOT DONE, AND OWED: no live run.** Every Drive response in the suite is a stub, so what is proven
is that we SEND both shared-drive parameters, never that Google honours them for a real shared
drive. One real import against a real shared-drive folder, confirming a non-zero file count, is the
gate — and it is the ONLY thing that can settle it.
