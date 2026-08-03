/**
 * The per-file vault upload ceiling for documents/images: 200 MB (decimal — the copy reads
 * "200 MB", so the number is declared the way it is spoken). Raised from 100 MiB in 15.3-02, safe
 * only because 15.2's extraction fan-out bounded per-action memory.
 *
 * THE ONE DECLARATION. It used to be re-typed as a literal in five places — `Dropzone.tsx` consts,
 * two of its error strings, its helper copy, and two server messages — so raising the server cap
 * alone produced a client that rejected files the backend would have accepted.
 *
 * ponytail: the cap is REACHABLE ONLY ON A FAST LINK. Convex's upload POST times out at 2 minutes
 * per file, so 200 MB needs ~13.3 Mbit/s sustained upstream; a slower connection sees an upload
 * failure, not a cap refusal. Plan 15.3-04 owns recording that outcome in the folder manifest —
 * until then a timed-out single file simply fails loudly at the fetch, which is honest but terse.
 */
export const VAULT_FILE_CAP_BYTES = 200 * 1000 * 1000;

/**
 * The per-file ceiling for VIDEO uploads: 25 MB (decimal, strictly under the transcription
 * API's hard 25 MB limit — see vaultTranscribe.ts). A video is the one kind whose size ceiling
 * is bounded by a downstream service, not our own storage — so it caps lower than documents.
 */
export const VAULT_VIDEO_CAP_BYTES = 25 * 1000 * 1000;

/**
 * Render a byte CAP as the whole decimal MB it was declared as — "200 MB", "25 MB". Both caps are
 * decimal by construction, so `fmtSize` (binary, `DocGrid.tsx`) would print "190.7 MB" for the same
 * constant and quietly contradict every place the product says 200. This is the formatter that
 * agrees with the number; `fmtSize` stays the formatter for actual file sizes.
 */
export const capMB = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`;

/** Hop cap for GraphRAG neighbor expansion — captures indirect context without exploding. */
export const GRAPH_HOP_CAP = 2;

/**
 * How many `vaultDocuments` rows ONE vault read may touch. **A READ-CAP BOUND, NOT A UX
 * PREFERENCE** — do not raise it because a grid "should show more".
 *
 * Convex has no projection: reading a row reads the whole row, and a `vaultDocuments` row carries
 * up to VAULT_EXTRACT_CHAR_CAP (400,000) chars of `text`. An unbounded `.collect()` here therefore
 * walks into the 16 MiB per-transaction read cap at ~40 max-size rows — which is exactly how the
 * vault page hard-failed once a tenant's vault grew past a handful of large documents.
 */
export const VAULT_GRID_PAGE = 200;

/**
 * The SECOND half of that bound, and the half that actually makes the guarantee true: a row cap
 * alone does not bound BYTES. 200 × 400 KB is ~80 MB, still 5× over the 16 MiB read cap, so a
 * page-of-200 rule would keep failing on exactly the folder this phase exists to ingest.
 *
 * A vault read therefore stops on WHICHEVER bound hits first — VAULT_GRID_PAGE rows or this many
 * bytes of `text`. 8 MiB is half the transaction cap, leaving room for the one row that trips it
 * plus every other read in the same transaction. The page always renders; with enormous documents
 * it renders fewer cards and says so (`capped`).
 */
export const VAULT_GRID_READ_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * How long a doc may stay `extracting` AFTER ITS WORK ACTUALLY STARTED before a watchdog calls it
 * stalled. 15 min is comfortably above the worst legitimate RUN — the 480 s per-call ceiling plus
 * Convex's 10-minute node-action limit bound any single honest attempt — so it can never kill live
 * work.
 *
 * ⚠ MEASURED FROM WORK-START, NOT FROM SCHEDULE (15.3-04, CONTEXT §B2). It used to be armed by
 * `vault.scheduleExtraction`, i.e. when the attempt was QUEUED. That was survivable while every
 * upload was a single file; at folder scale, 400 documents behind `VAULT_INGEST_PARALLELISM`
 * sit queued for an hour and a perfectly healthy document was marked `extraction_stalled` — a
 * failure that never happened, written into the manifest the folder promises is honest. The
 * 15-minute justification was ALWAYS about run time; the clock now starts where the justification
 * always pointed (`vault.markExtracting`).
 */
export const EXTRACTION_WATCHDOG_MS = 15 * 60_000;

/**
 * How many folder-ingest extractions may run at once. **WE set this number** — that is the whole
 * reason ingest moved off the raw scheduler onto a named `vaultIngestPool` (15.3-CONTEXT §B15):
 * the raw scheduler is bounded only by the DEPLOYMENT's scheduled-job concurrency class, so 400
 * queued extractions sat in front of every delivery and cron job in the deployment.
 *
 * ⚠ MUST STAY STRICTLY BELOW 8, the smallest class Convex offers (S16). The deployment class is a
 * CEILING, not the setting — and this project has no cloud deployment to read a class from
 * (`convex deployments` reports Type: local), so staying under the smallest one is what makes the
 * number safe everywhere. Raising it above 8 is a deployment-class decision, not a tuning
 * decision; the bound is asserted in `constants.test.ts`.
 *
 * The pre-flight "ready in" estimate is computed from THIS number, never from an assumed class.
 * ponytail: a hand-picked constant calibrated against observed throughput, not derived on paper —
 * provisioning a cloud deployment is the point at which it may be revisited.
 */
export const VAULT_INGEST_PARALLELISM = 6;

/**
 * How many folder members ONE transaction may walk when the folder is dispatched (or refused).
 * A TRANSACTION BOUND, not a tuning knob — the same rule as VAULT_GRID_PAGE next door: Convex has
 * no projection, so reading a member reads its whole row, and a folder has up to several hundred
 * of them. Batches beyond the first are self-scheduled (`scheduler.runAfter(0, self)`).
 *
 * ponytail: a ROW bound, not the rows-OR-bytes bound `readVaultPage` uses. A folder member has no
 * extracted `text` yet (that is the point — it has not been dispatched), so the rows are small;
 * the one shape that could still trip the read cap is a client that passes megabytes of `text` on
 * a searchable member. Upgrade path: copy `readVaultPage`'s second bound in.
 */
export const VAULT_FOLDER_MEMBER_BATCH = 20;

/**
 * Chars of document text sent to the graph extractor. ~120k chars ≈ 30k tokens, well inside the
 * 128k window even for token-dense content (tab-joined spreadsheet rows tokenize far worse than
 * prose) and leaving room for the schema + system prompt. Before this cap, extractGraph was the
 * ONE uncapped model call in the repo: VAULT_EXTRACT_CHAR_CAP lets 400k chars be STORED, and all
 * of it was SENT. That relationship (graph cap strictly below extraction cap) is asserted in
 * constants.test.ts — invert it and this constant is dead code.
 *
 * ponytail: a HEAD SLICE, not chunk-wise fan-out — entities that appear only in the tail of a very
 * long document are missed, and nothing persists a "graph truncated" flag (no schema change this
 * phase). Deliberate: a 254k-char row is observed working today, so this is a guard against the
 * cliff, not a recall improvement. Upgrade path: chunk-wise extraction with node/edge union across
 * chunks, deferred until entity recall is observed to suffer.
 */
export const GRAPH_EXTRACT_CHAR_CAP = 120_000;

/** Head-slice a graph-extraction prompt to GRAPH_EXTRACT_CHAR_CAP. */
export function capGraphText(text: string): string {
  return text.length > GRAPH_EXTRACT_CHAR_CAP ? text.slice(0, GRAPH_EXTRACT_CHAR_CAP) : text;
}

/**
 * Chars of document text sent to the document CLASSIFIER (15.3-08, VALT-12). Deliberately ~15×
 * smaller than the graph cap next door, and NOT a reuse of it: the two calls ask different
 * questions. The extractor wants every entity in the document, so it wants as much of the document
 * as the window allows; the classifier only has to answer "what IS this" — a title block, a
 * letterhead, a statement header, the first rows of a table. That lives in the first page or two,
 * so ~8k chars (≈2k tokens) is the whole useful signal and sending 120k would be a 15× bill for
 * text that cannot change the answer. Classification runs on EVERY document on EVERY ingest path,
 * so this is the multiplier that decides whether the feature costs cents or dollars per folder.
 *
 * That relationship (classify cap strictly below the graph cap) is asserted in constants.test.ts —
 * raise it past the graph cap and the cheaper call has become the expensive one.
 *
 * ponytail: a HEAD SLICE, same shape as capGraphText. Ceiling — a document whose identity only
 * becomes clear later (a scan with a cover sheet, a spreadsheet whose header row is buried) reads
 * as `unclassified`, and the user's own edit is the recovery path. Upgrade path: head + tail slice,
 * or a second pass on `unclassified` rows, once that miss is actually observed.
 */
export const DOC_CLASSIFY_CHAR_CAP = 8_000;

/** Head-slice a classification prompt to DOC_CLASSIFY_CHAR_CAP. */
export function capClassifyText(text: string): string {
  return text.length > DOC_CLASSIFY_CHAR_CAP ? text.slice(0, DOC_CLASSIFY_CHAR_CAP) : text;
}
