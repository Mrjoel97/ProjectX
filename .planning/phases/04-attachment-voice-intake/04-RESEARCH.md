# Phase 4: Attachment & Voice-Dictation Intake — Research

**Researched:** 2026-07-14
**Domain:** Inbound file ingestion (classify → OCR/extract/transcribe) + one-shot voice dictation, both merged into the governed cockpit pipeline
**Lane:** B (`lane-b/intake-voice` worktree) — parallel to Lane A (cockpit send) and Lane C (vault)
**Confidence:** HIGH (stack + seams verified against the live codebase and pinned dependency graph; extraction-engine decision reasoned from logged precedents)

> ⚠️ The three files in `.planning/research/` (STACK.md, PITFALLS.md, ARCHITECTURE.md, dated 2026-07-08) predate the Convex pivot. They describe Postgres/Inngest/Presidio/pgvector/Better-Auth — **all since killed or replaced** (see STATE.md: Convex substrate, pure-TS `packages/pii`, direct-OpenAI transport, no Python sidecars). Treat them as historical. STATE.md decisions bind. This document supersedes them for Phase 4.

---

## Binding Constraints (read first — the planner MUST honor these)

These are locked from PARALLELIZATION.md (the lane contract), STATE.md decisions, and CLAUDE.md. There is no CONTEXT.md for this phase; these constraints stand in for it.

### Lane B ownership (edit freely)
- `services/*` (only if a sidecar were chosen — **it is not**, see the Decision below)
- **New** intake Convex module(s): `convex/intake.ts` (+ a sibling `convex/intakeDb.ts` for DB helpers — see the use-node constraint)
- **New** extraction `packages/*`: `packages/extraction`
- Intake-specific UI component(s) (new files)
- Your OWN append-only blocks in the three shared singletons

### Lane B must NOT touch (cross-lane — belongs to A/C)
- `convex/llm.ts` cockpit tools + `runCockpitAgent` (Lane A)
- `convex/cockpit.ts`, `convex/plans.ts`, `convex/gmail.ts`, `packages/core/src/emailIntent.ts` (Lane A)
- Cockpit `apps/web/.../cards.tsx` / `ChatPane.tsx` (Lane A)
- Vault packages / `convex/vault*.ts` (Lane C)

### Append-only singletons (additive, region-scoped — never reorder others' blocks)
1. `convex/schema.ts` — add your `intakeArtifacts` table in your OWN block. **Prefer a new table over new fields on shared tables.**
2. `convex/skills.ts` `seedSkills` list — **append** your `attachment-extractor` row; don't touch others'.
3. `.planning/STATE.md` + `ROADMAP.md` — additive ticks only.

### CLAUDE.md invariants that shape every task
- **§1** domain logic in `packages/*`; `convex/` is a thin adapter (classification/framing = pure `packages/extraction`; `intake.ts` only orchestrates).
- **§2** no raw `query/mutation/action` imports — use tenant wrappers from `convex/lib/functions.ts`.
- **§4** audit/deadLetters/log payloads carry refs/hashes/counts/ids ONLY — never extracted text or raw bytes. **Redact-then-write.**
- **§5** no hardcoded prompts — the OCR/vision extraction prompt is a skills-registry row (5-file mirror), loaded at runtime.
- **§6** pinned pre-1.0 versions — do not bump. Everything Phase 4 needs is already installed (see Stack).
- **§8** ponytail — the extraction-engine decision below is a rung-1 ("does this need to be built at all?") ruling.
- **§9** playbooks/ADRs — a NEW `docs/playbooks/intake.md` + `watch.json` entry is required (new code under `packages/`/`convex/` that no existing playbook covers).

---

## Summary

Phase 4 makes two new inbound paths flow through the **same** governed cockpit pipeline built in Phases 2/3/3.x: (a) a user attaches an image / PDF / audio / document and the system classifies it, extracts/OCRs/transcribes it, and merges the result into the conversation context (INTK-02); (b) a user dictates a request by voice (record → transcribe), which enters the conversation exactly like a typed message (INTK-03). "Done" means a delivered email whose content originated from an attachment or a dictation, having passed the same PII/cost/review guardrails (SC3).

The critical architectural fact discovered in the codebase: **the live UX is the cockpit** (`cockpit.sendCockpitMessage({threadId, text})` → `runCockpitAgent` tool-loop → `plans` row → `executePlan` fan-out). The retired `/submit` form and `requests.submit` are NOT the live door. Therefore intake's "merge into the pipeline" seam is: **extract → redact → call `api.cockpit.sendCockpitMessage` with the redacted, framed text.** This requires ZERO edits to `cockpit.ts` or `llm.ts` — a new `convex/intake.ts` module CALLS the existing public action. That is the boundary-clean design the lane contract asks for.

The Convex file-upload flow (`ctx.storage.generateUploadUrl()` + client POST → `storageId`) and an `attachments` table already exist from INTK-01/Phase 3.3, and the AI SDK transcription + multimodal-vision APIs are already in the pinned dependency graph (`ai@7.0.20` `experimental_transcribe`; `@ai-sdk/openai@4.0.11` `.transcription(...)` and multimodal `gpt-4o-mini`). Almost nothing new needs installing.

**Primary recommendation:** Path A (hosted API, NO sidecar). Audio → OpenAI transcription through the same direct-OpenAI transport the cockpit already uses; image/PDF → the same multimodal `DEFAULT_MODEL` (gpt-4o-mini) via a registry-loaded `attachment-extractor` skill; plain text/markdown read as UTF-8 directly; classification + framing in a pure `packages/extraction`. Extracted text is redacted through `@pikar/pii` `scanText` (fail-closed) **before** it reaches the cockpit agent, audit, or any downstream model call.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support (what enables it) |
|----|-------------|-----------------------------------|
| **INTK-02** | Attachments classified (image/PDF/audio/document) and OCR'd/extracted/transcribed, results merged into request context | `packages/extraction` classifier + `convex/intake.ts` extraction actions (transcribe/vision/text) → `scanText` redact → merge via `api.cockpit.sendCockpitMessage`. Convex storage upload flow already exists. |
| **INTK-03** | User dictates a request by voice (record → transcribe → same pipeline) | Browser `MediaRecorder` → upload blob → `intake.dictateToThread` → `experimental_transcribe` → redact → `sendCockpitMessage`. Distinct from Phase 6 WebRTC (one-shot only). |
</phase_requirements>

---

## Extraction Engine Decision (THE key open decision — RESOLVED)

**Recommendation: Path A — Hosted API, NO Python sidecar. Decisively.**

The roadmap goal text (line 202) mentions a "Python sidecar," but that line is stale phrasing inherited from the pre-Convex plan. Every force in this project points to Path A:

| Force | Path A (hosted API, no sidecar) | Path B (Python `services/*`: Whisper + tesseract) |
|-------|--------------------------------|---------------------------------------------------|
| **Ponytail rung 1** ("does this need to be built at all?") | No new plane. Reuses the transport the cockpit already runs. | Builds a whole deployment/ops plane for extraction. |
| **Project precedent** | Matches the two logged sidecar-kills: PII went pure-TS `packages/pii` ("a deployment plane for one function"); SkillOpt became a no-sidecar batch runner. | **Contradicts** both precedents — the exact pattern the project has twice rejected. |
| **CASA / restricted-scope surface** | Adds NO new data processor: OpenAI is already the disclosed processor (zero-retention/no-training contract already a hard constraint). Audio/image is a new *data category* to an *existing* processor → a privacy-policy disclosure update, not a new CASA vendor. | Keeps bytes off third parties (smaller processor list) — the ONLY point in B's favor — but at the cost of a self-hosted GPU/compute plane the Convex+Vercel stack has nowhere to run. |
| **Compute reality** | OpenAI hosts the model; Convex actions just call it. | Convex/Vercel have no GPU; self-hosted Whisper needs infra that does not exist in this stack. |
| **Time-to-beta (~3 weeks left)** | Days: the APIs are already in the dependency graph. | Weeks: new service, Dockerfile, deploy target, ops, secrets plane. |
| **§6 / dependency discipline** | Zero new backend deps for audio+image (see Stack). | New runtime + new language + new failure modes. |

**The one genuine tension** (Path B's advantage) is that raw bytes reach OpenAI. This is unavoidable in ANY design that extracts content the user hasn't yet redacted — **the extraction call is the chicken-and-egg exception to GRDL-01**: you cannot redact bytes before you have read them. The mitigation is the ordering contract (below): the extraction call goes ONLY to the zero-retention-contracted OpenAI processor, and its OUTPUT is redacted before it touches the agent, audit, or any further model call. Path B would not remove this exception for the *downstream* pipeline; it would only move the *first* read in-house — not worth a rejected deployment plane for a private beta.

**Decision for the planner:** build `packages/extraction` (pure) + `convex/intake.ts` (thin adapter). Do NOT create `services/*`. Log this as a STATE.md decision amending ROADMAP Phase 4's "Python sidecar" phrasing (per the process rule: a decision names the line it amends).

---

## Standard Stack (everything is already installed)

### Core (no new install needed)
| Capability | API / Model | Package (pinned) | Notes |
|-----------|-------------|------------------|-------|
| Audio transcription | `experimental_transcribe({ model, audio })` | `ai@7.0.20` | Verified exported. |
| Transcription model | `openai.transcription('gpt-4o-transcribe')` (or `whisper-1`, `gpt-4o-mini-transcribe`) | `@ai-sdk/openai@4.0.11` | `.transcription(id)` factory verified; reads `OPENAI_API_KEY`. |
| Image/PDF OCR & extraction | `generateText({ model, messages:[{role:'user', content:[{type:'text',...},{type:'file'|'image', ...}]}] })` | `ai@7.0.20` + `@ai-sdk/openai@4.0.11` | `DEFAULT_MODEL` = `openai/gpt-4o-mini` is **multimodal** — accepts image parts. Image tokens price as input tokens via existing `priceUsage`. |
| Provider transport | `openai(id.replace(/^openai\//,''))` | already the `resolveModel` pattern in `llm.ts` | Direct OpenAI (STATE.md: gateway REVERSED to direct for cost). Mirror the pattern; do NOT import from `llm.ts`. |
| PII redaction | `scanText(unknown) → Result<PiiScanResult, PiiScanError>` | `@pikar/pii` | Fail-closed; `counts` is the only log-safe summary; `entities` never logged (§4). |
| Cost | `priceUsage(model, usage)`, `recordSpend` | `@pikar/cost`, `guardrails.recordSpend` | See the transcription-pricing gap below. |
| File storage + upload | `ctx.storage.generateUploadUrl()` / `ctx.storage.get(id)` | `convex@1.42.1` | Client POSTs the file to the returned URL → `{storageId}`. Pattern already in `requests.ts:generateUploadUrl`. |
| Voice capture (browser) | `MediaRecorder` Web API | native | No dependency. One-shot record→stop→Blob. |

### Possibly-new (evaluate against ponytail before adding)
| Need | Lazy default (rung 3–5, no new dep) | Escalation (only if the default fails) |
|------|-------------------------------------|----------------------------------------|
| PDF text extraction | Send the PDF as a `file` content part to the multimodal model (same code path as images) — **zero new dep** | `unpdf` (serverless-friendly pdfjs wrapper) IF token cost/accuracy of vision-on-PDF proves poor for text-heavy PDFs. Mark with a `ponytail:` comment. |
| `.docx`/`.xlsx` documents | Out of the "leanest beta" set — treat plain-text/`.md`/`.txt` natively (UTF-8 read) and route binary Office docs through the multimodal model or defer | `mammoth` (docx) only on demonstrated need |
| MIME/type classification | ~40-line pure-TS magic-byte + mime + extension sniff in `packages/extraction` (testable offline) | `file-type` lib only if the hand-rolled sniff proves insufficient |

**Do NOT add:** any Python/Docker sidecar, Presidio, tesseract.js (the model does OCR), a separate STT vendor (Deepgram/ElevenLabs), or a heavyweight document-parser suite. All contradict ponytail + the no-new-processor CASA posture.

---

## Architecture & File Map (Lane-B-clean)

```
packages/extraction/                 # NEW pure-TS package (§1). No Convex/API imports.
  src/classify.ts                    #   classify(bytes, mimeType, filename) → {kind: image|pdf|audio|document|unknown}
  src/frame.ts                       #   frameForConversation(kind, filename, safeText) → the synthetic user turn
  src/*.test.ts                      #   colocated unit tests (magic-byte fixtures, framing)
  src/index.ts

packages/contracts/skills/attachment-extractor.md          # NEW canonical prompt (§5)
packages/contracts/src/skills/attachmentExtractor.ts       # NEW byte-identical derived body const + name const
                                                            # (drift test row + seedSkills row — see below)

packages/backend/convex/
  intake.ts        # NEW "use node" action module (ACTIONS ONLY — Convex constraint §):
                   #   generateUploadUrl (tenantMutation? NO — mutations can't be in a use-node module;
                   #     put generateUploadUrl in intakeDb.ts) 
                   #   attachToThread(threadId, storageId, filename, mimeType, size)  [tenantAction]
                   #   dictateToThread(threadId, storageId)                            [tenantAction]
                   #   internal helpers: transcribe(), extractVisual() — call OpenAI, load skill, recordSpend
                   #   → classify (packages/extraction) → extract → scanText → audit(counts) → persist → merge
  intakeDb.ts      # NEW sibling: generateUploadUrl (tenantMutation), insertArtifact/patchArtifact
                   #   (internalMutation), byThread/getArtifact (query). Reached via ctx.runQuery/runMutation.
  schema.ts        # APPEND intakeArtifacts table in a Lane-B block (see below)
  skills.ts        # APPEND { name: ATTACHMENT_EXTRACTOR_SKILL, body: attachmentExtractorSkillBody } to seedSkills

apps/web/.../                        # NEW intake-specific UI component (Lane B owns "intake-specific UI")
  IntakeControls.tsx                 #   attach picker + MediaRecorder dictation button; calls generateUploadUrl
                                     #   + POST + intake actions. NEEDS a 1-line mount in ChatPane.tsx → CROSS-LANE NOTE.

docs/playbooks/intake.md             # NEW playbook (§9) + register its watched paths in watch.json
```

### The Convex use-node constraint (STATE.md §, guidelines §96)
A `"use node"` module may contain **ONLY actions**. DB-touching helpers (mutations/queries) live in a **separate** module (`intakeDb.ts`) reached via `ctx.runQuery`/`ctx.runMutation`. This mirrors the existing `wormCursor.ts`/`worm.ts` and `plans.ts`/`llm.ts` split. Also: adding a new use-node action module can tip sibling use-node actions past TS's circular-inference limit → put **explicit return-type annotations** on every `intake.ts` action and on `runQuery`/`runAction` results (`Promise<{threadId: string}>` etc.), same remedy as `gmail.ts`/`llm.ts`.

### intakeArtifacts table (Lane-B schema block — append-only)
```ts
// ── Phase-4 inbound intake plane (Lane B) ────────────────────────────
// INBOUND ingestion — distinct from OUTBOUND plans.attachments (CKPT-02) and the
// request-scoped `attachments` table. Thread-scoped: ingestion happens DURING the
// cockpit conversation, before any request/plan exists. `extracted` holds REDACTED
// safeText only (never raw); raw bytes live in _storage, referenced by storageId.
intakeArtifacts: defineTable({
  tenantId: v.string(),
  threadId: v.string(),
  storageId: v.id("_storage"),
  filename: v.string(),
  mimeType: v.string(),
  size: v.number(),
  kind: v.union(v.literal("image"), v.literal("pdf"), v.literal("audio"),
                v.literal("document"), v.literal("unknown")),
  status: v.union(v.literal("uploaded"), v.literal("extracting"),
                  v.literal("extracted"), v.literal("failed")),
  extracted: v.optional(v.string()),   // REDACTED safeText (content plane; §4 keeps it out of audit)
  createdAt: v.number(),
}).index("by_thread", ["tenantId", "threadId"]),
```

**Reuse note vs. the existing `attachments` table:** `attachments` already carries an `extracted: v.optional(v.string())` field whose comment reads *"filled by Phase 4 (INTK-02)"* — the original design intended to reuse it. BUT that table is **request-scoped** (`requestId`), and the live cockpit is **thread-scoped** with no request row until `executePlan` fan-out. Rather than add a `threadId` field to the shared `attachments` table (append-only discipline prefers a new table over new fields on shared tables), create the thread-scoped `intakeArtifacts` table. Leave `attachments.extracted` for a possible request-scoped future; do not delete it.

---

## Reuse Analysis

### vs. Phase 3.3 OUTBOUND attachments (just completed)
| Phase 3.3 artifact | Reusable for Phase 4? | Verdict |
|--------------------|-----------------------|---------|
| `attachments` table `{storageId, filename, mimeType, size}` | Shape is a good template | REUSE shape as template; NEW `intakeArtifacts` table (thread-scoped + `kind` + `extracted`). |
| `ctx.storage.store(Blob)` / `plans.attachments` / `recordAttachments` | OUTBOUND generation path | DO NOT reuse — inbound is a different direction (CKPT-02 note explicitly: distinct from INTK-02). |
| `attachmentUrls` (`storage.getUrl`, bearer capability) | Signed-URL download | Not needed inbound (we read bytes server-side via `ctx.storage.get`, never hand the client a URL). |
| `PLAN_ATTACHMENT_CAP_BYTES` (8 MiB) | Byte cap | REUSE the *pattern*: cap inbound upload size (define an `INTAKE_UPLOAD_CAP_BYTES`; audio may warrant a larger cap than 8 MiB — decide per format). |
| `markdownToPdf` / pdf-lib | PDF **writing** | Irrelevant — inbound needs PDF **reading**, a different problem (see Don't Hand-Roll). |
| `SMOKE::` offline sentinel discipline | Offline determinism | REUSE the convention (see Validation Architecture). |

### vs. Phase 2 pipeline entry
- `requests.submit` / `validateSubmit` / `pipelineWorkflow` are the RETIRED `/submit` door. The cockpit superseded them (STATE.md). **Do not route intake through `requests.submit`.**
- `requests.generateUploadUrl` proves the Convex upload flow (client POST → storageId). REUSE the *pattern* in `intakeDb.generateUploadUrl` (don't edit `requests.ts`).
- The governed guarantees (audit refs-only, cost recordSpend, PII fail-closed, human Approve gate) are inherited **automatically** because intake feeds `sendCockpitMessage`, which runs the same `runCockpitAgent` → `proposePlan` → `executePlan` spine. Intake does not re-implement any of it.

---

## The Guardrail Merge Point (SC3 — exact ordering)

Extracted/transcribed text is **UNTRUSTED user content**. The ordering contract, per redact-then-write (§4) and GRDL-01:

```
1. Client uploads file/audio  →  ctx.storage  →  storageId              (raw bytes at rest, tenant-owned)
2. intake action loads bytes  →  ctx.storage.get(storageId)
3. classify(bytes, mime, filename)  →  kind                             (pure packages/extraction; no model)
4. EXTRACTION MODEL CALL  (the GRDL-01 chicken/egg exception):
      audio → experimental_transcribe(openai.transcription(...))
      image/pdf → generateText(gpt-4o-mini, file/image part, attachment-extractor skill body as system)
      text/md → UTF-8 decode (NO model)
   → rawText.   ← the ONLY place un-redacted content reaches a model; allowed ONLY to the
                  zero-retention/no-training OpenAI processor. recordSpend the priced usage.
5. scanText(rawText)  →  Result<safeText, error>   FAIL-CLOSED: on Err/unknown, mark artifact
                  status="failed", write NO safeText, surface a conversational error, STOP.       (GRDL-01)
6. persist intakeArtifacts.extracted = safeText     (content plane; NEVER audit)                   (§4)
7. audit "intake.extracted" { artifactId, kind, piiCounts, charCount }   — refs/counts ONLY        (§4)
8. MERGE:  api.cockpit.sendCockpitMessage({ threadId, text: frameForConversation(kind, filename, safeText) })
                  → runCockpitAgent sees ONLY safeText; downstream draft re-scans per its own contract.
```

**Load-bearing points:**
- Redaction (step 5) precedes BOTH the audit write (step 7) AND the merge into the agent (step 8). Extracted content never becomes a PII honeypot and never reaches the agent model un-redacted.
- The extraction call (step 4) is the sole exception and is explicitly bounded to the disclosed zero-retention processor. Flag this exception in the playbook so a future reviewer understands why "a model call on un-redacted content" is intentional here and nowhere else.
- Cost: step 4 must `recordSpend` so transcription/vision spend counts against the daily budget + kill switch (GRDL-03/06). **Gap:** `@pikar/cost` `PRICING` only has `gpt-4o-mini` + `gpt-4.1-nano` (token-based). Vision-via-`gpt-4o-mini` prices correctly out of the box (image tokens = input tokens). **Transcription is priced per audio-minute** and returns `Err` from `priceUsage` for an unknown model → the planner must add an additive transcription-pricing entry/helper to `@pikar/cost` (append-only, pure) OR record a conservative flat per-call estimate. Recommend: add a `TRANSCRIPTION_PRICING` per-minute constant + `priceTranscription(seconds)` helper in `@pikar/cost` (additive, low-conflict).

---

## Voice Dictation (INTK-03) — one-shot only

- Browser `MediaRecorder`: `getUserMedia({audio:true})` → `new MediaRecorder(stream)` → `start()` / `stop()` → collect `dataavailable` chunks → `Blob`. Record → stop → upload. No dependency.
- Upload the audio Blob via `generateUploadUrl` (same flow as attachments) → `intake.dictateToThread(threadId, storageId)` → transcription path (steps 4–8 above).
- **KEEP DISTINCT FROM PHASE 6.** Phase 6 (VOIC-01) is LIVE bidirectional WebRTC voice with a 15-min server watchdog. Phase 4 is one-shot dictation only (record → stop → transcribe → text). **Do NOT pull WebRTC, ephemeral tokens, or realtime streaming forward.** The dictation transcript IS the user's request text — feed it to `sendCockpitMessage` verbatim (after redaction), no special framing needed (unlike an attachment, which gets a "here is the attached file's content" frame).

---

## Classification

Pure-TS in `packages/extraction/classify.ts`. Inputs: leading bytes (magic number), the browser-provided `mimeType`, and the filename extension (defense in depth — mime is spoofable/absent). Map to four buckets + `unknown`:
- **image**: `\x89PNG`, `\xFF\xD8\xFF` (JPEG), `GIF8`, `RIFF....WEBP`, mime `image/*`.
- **pdf**: `%PDF` (`\x25\x50\x44\x46`), mime `application/pdf`.
- **audio**: `RIFF....WAVE`, `ID3`/`\xFF\xFB` (mp3), `OggS`, `\x1A\x45\xDF\xA3` (webm/matroska — what MediaRecorder produces), `ftyp` box (m4a/mp4), mime `audio/*`.
- **document**: mime `text/*` / `.txt` / `.md` → UTF-8 read; Office `PK\x03\x04` (zip-based docx/xlsx) → route to model or defer.
- **unknown** → reject with a conversational message; write NO model call.

Prefer the one-line/pure sniff over a `file-type` dependency (ponytail rung 6/3). ~40 lines, fully offline-testable with tiny byte fixtures.

---

## The `attachment-extractor` skill (§5, 5-file mirror)

The image/PDF OCR call needs a system prompt ("Extract all text from this document verbatim, preserving structure; if there is no text, describe the content factually. Output plain text only."). Per §5 this is NOT hardcoded — it is a skills-registry row via the 5-file mirror (mirror `document-drafter`/`cockpit-agent`):
1. `packages/contracts/skills/attachment-extractor.md` — canonical prompt.
2. `packages/contracts/src/skills/attachmentExtractor.ts` — byte-identical derived `attachmentExtractorSkillBody` const + `ATTACHMENT_EXTRACTOR_SKILL` name const.
3. `seedSkills` row appended in `skills.ts` (Lane-B append).
4. drift `test.each` row asserting `.md` ↔ `.ts` byte-identity + active-seed.
5. `skill-registry.md` playbook "Current skills" + `Last verified` bump (§9) — its `watch.json` already covers `packages/contracts/skills/` and `skills.ts`, so **no new watch entry for the skill** (but the playbook file itself must be edited same-turn).

**Transcription needs NO skill** — audio→text is not a generative prompt. (gpt-4o-transcribe accepts an optional context `prompt`; keep it empty or a trivial non-generative hint — do NOT route it through the registry.)

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Speech-to-text | A DSP/ASR pipeline | `experimental_transcribe` + `openai.transcription` | Already installed; ASR is a research field. |
| OCR / image text | A vision/OCR model or tesseract wiring | Multimodal `gpt-4o-mini` via `generateText` file/image parts | `DEFAULT_MODEL` is already multimodal; zero new dep, prices via existing `priceUsage`. |
| PDF text extraction | A PDF content-stream/font-encoding parser | multimodal file-part first; `unpdf` only if needed | PDF text extraction (glyph maps, CID fonts, layout) is deceptively hard — a classic rewrite trap. |
| PII redaction | A regex/NER redactor | `@pikar/pii` `scanText` (fail-closed) | Exists, tested, §4-compliant. |
| File upload plumbing | A multipart/base64 upload endpoint | `ctx.storage.generateUploadUrl()` + client POST | Convex-native; pattern already in `requests.ts`. |
| Audio capture | Anything beyond the native API | `MediaRecorder` | Browser-native, no dep. |

**Key insight:** in this domain the "extraction engine" is a set of hosted model calls, not code you write. The only genuinely-yours code is classification (trivial pure sniff), the redaction ordering, and the merge seam.

---

## Common Pitfalls

### Pitfall 1: Extracted content reaching the model or audit un-redacted (SC3 breach)
Feeding step-4 `rawText` straight into `sendCockpitMessage` (which passes it to the agent model) or into an audit payload. **Avoid:** redact (step 5) before step 7 and step 8. Warning sign: any `sendCockpitMessage`/`audit.log` call whose text argument is the extraction output, not `safeText`.

### Pitfall 2: Treating the extraction call as a GRDL-01 violation and blocking it
The extraction call reads un-redacted bytes by necessity. **Avoid:** scope GRDL-01 to *downstream* calls; document the extraction call as the bounded exception (zero-retention processor only). Warning sign: a plan that tries to `scanText` audio bytes or a PDF before transcribing/reading it (impossible).

### Pitfall 3: use-node module contains a mutation/query
Convex rejects a DB helper inside `"use node"`. **Avoid:** `intakeDb.ts` sibling for all mutations/queries; `intake.ts` holds actions only, reaches DB via `ctx.runQuery`/`runMutation` with explicit return types (§96 circular-inference cliff).

### Pitfall 4: Editing a Lane A file to wire the UI
The attach/dictate controls need a mount in `ChatPane.tsx` (Lane A). **Avoid:** ship `IntakeControls.tsx` fully in Lane B; leave the one-line mount as a cross-lane note, do not design the edit into Lane B's plans.

### Pitfall 5: Transcription cost silently unpriced
`priceUsage('gpt-4o-transcribe', …)` → `Err` (per-minute pricing not in the token table) → spend under-counted, kill switch bypassed. **Avoid:** add the additive transcription-pricing helper to `@pikar/cost`.

### Pitfall 6: Pulling WebRTC forward into dictation
Scope creep from Phase 6. **Avoid:** one-shot MediaRecorder only; no realtime, no ephemeral tokens, no 15-min watchdog.

### Pitfall 7: Unbounded upload / huge transcript
A 2-hour audio file or a 500-page PDF blows cost and Convex limits. **Avoid:** enforce `INTAKE_UPLOAD_CAP_BYTES` at upload (mirror the 8 MiB pattern; size audio cap deliberately) and consider a transcript char cap before merge.

---

## State of the Art / notes

- `DEFAULT_MODEL = openai/gpt-4o-mini` is multimodal — no separate vision model needed. (`llm.ts` `resolveModel` strips the `openai/` prefix for the provider; pricing keeps the full id.)
- OpenAI transcription models available in the pinned provider: `gpt-4o-transcribe` (best WER), `gpt-4o-mini-transcribe` (cheaper), `whisper-1` (legacy). Recommend `gpt-4o-transcribe` for quality, `gpt-4o-mini-transcribe` if cost matters.
- Convex `generateUploadUrl` uses **POST** (client `fetch(url,{method:'POST',headers:{'Content-Type':file.type},body:file})`). The comment in `requests.ts` says "PUT" but the Convex contract is POST — follow POST.

---

## Suggested Wave / Plan Decomposition (planner finalizes)

**Wave 1 — pure + additive foundations (parallel, no cross-deps):**
- P1: `packages/extraction` — pure classifier + framing + tests (TDD).
- P2: `attachment-extractor` skill (5-file mirror) + `skill-registry.md` bump.
- P3: `schema.ts` `intakeArtifacts` block (Lane-B) + `@pikar/cost` transcription-pricing helper (additive).

**Wave 2 — backend intake spine (depends on W1):**
- P4: `convex/intakeDb.ts` (generateUploadUrl + artifact mutations/queries) + `convex/intake.ts` extraction actions (transcribe / vision / text), classify → scanText → recordSpend → audit(counts) → persist. SMOKE:: sentinels. Explicit return types (§96).
- P5: the merge — intake actions call `api.cockpit.sendCockpitMessage` with framed safeText; end-to-end offline `convex-test` proving an artifact drives a conversation turn (attachment) and a dictation drives a request turn.

**Wave 3 — UI (depends on W2):**
- P6: `IntakeControls.tsx` (attach picker + MediaRecorder dictation) → generateUploadUrl → POST → intake actions; Playwright E2E over SMOKE:: sentinels. Cross-lane mount note for Lane A.

**Wave 4 — close:**
- P7: `docs/playbooks/intake.md` + `watch.json` (§9); live smoke + CKPT human-verify (real file + real mic + real delivery); STATE.md decision log (sidecar-killed) + ROADMAP tick; phase close.

---

## Validation Architecture

> `nyquist_validation` is `true` in `.planning/config.json` — this section is required. The plan-phase workflow greps for this exact heading.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (unit + `convex-test@0.0.54` for Convex) + Playwright 1.61.1 (E2E) |
| Config file | `packages/backend/vitest.config.*`, `packages/extraction/vitest.config.*` (Wave 0 if absent), `apps/web/playwright.config.*` |
| Quick run command | `pnpm --filter @pikar/extraction test` (pure) / `pnpm --filter @pikar/backend test -- intake` |
| Full suite command | `pnpm test` (all packages) + `pnpm --filter @pikar/web exec playwright test` |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | Exists? |
|-----|----------|-----------|-------------------|---------|
| INTK-02 | classify image/pdf/audio/document/unknown from magic bytes+mime+ext | unit (pure) | `pnpm --filter @pikar/extraction test` | ❌ Wave 0 (new pkg) |
| INTK-02 | extract → **redact** → persist safeText; raw never in audit | convex-test | `pnpm --filter @pikar/backend test -- intake` (assert `intakeArtifacts.extracted` is redacted; assert `audit` payload has counts only) | ❌ Wave 2 |
| INTK-02 | fail-closed: `scanText` Err → status=failed, no safeText, no merge | convex-test | same, `SMOKE::extract::` + a PII-poison fixture | ❌ Wave 2 |
| INTK-02 | cost recorded for extraction call (kill-switch respected) | convex-test | assert `recordSpend` invoked / budget decremented | ❌ Wave 2 |
| INTK-02 | attachment safeText drives a cockpit turn (merge seam) | convex-test | assert `sendCockpitMessage` advances the plan from framed text | ❌ Wave 2 |
| INTK-03 | dictation transcript → conversation turn like a typed request | convex-test | `SMOKE::transcribe::<goal>` blob → `dictateToThread` → plan reflects the goal | ❌ Wave 2 |
| INTK-02/03 | UI: record/attach → upload → visible result in the conversation | E2E (Playwright) | `playwright test intake` over SMOKE:: | ❌ Wave 3 |
| SC3 | delivered email reflects attachment/dictation content past guardrails | **manual live** | human-verify checkpoint (Wave 4) | ❌ manual |

### Sampling Rate
- **Per task commit:** the relevant quick command (pure `@pikar/extraction` tests run in <1s; `intake` convex-test subset).
- **Per wave merge:** `pnpm test` (all packages) green.
- **Phase gate:** full suite + Playwright green before `/gsd:verify-work`; live smoke + human-verify before phase close.

### SMOKE:: sentinel design (offline determinism — mirror `llm.ts`/`gmail.ts`)
The extraction inputs are stored blobs, so the offline path inspects the blob's leading bytes for an ASCII `SMOKE::` prefix and short-circuits with NO real API call (mirrors `SMOKE::route=` / `SMOKE::agent::`):
- **Transcription:** a blob whose bytes decode to `SMOKE::transcribe::send an email to bob@x.com about lunch` → `transcribe()` returns the text after the sentinel, no OpenAI call. E2E uploads exactly this tiny blob.
- **Vision/OCR:** `SMOKE::extract::<verbatim text>` → `extractVisual()` returns the fixed text, no model call.
- **Classification** is pure — tested directly with byte fixtures, no sentinel.
- **Framing/redaction** run for real offline (`scanText` is pure; a fixture with a fake email/SSN asserts the merged text is `[EMAIL_1]`-style redacted and the audit payload carries counts only).
This keeps the REAL intake spine (classify → redact → cost → audit → merge) in the offline loop with zero real API cost, exactly as Phase 2/3.3 did.

### Wave 0 gaps
- [ ] `packages/extraction/` package scaffold + `vitest.config` + first `classify.test.ts`.
- [ ] `packages/backend` intake convex-test file + a `conftest`-equivalent seed helper (register components already used by cockpit tests).
- [ ] No framework install needed (Vitest/convex-test/Playwright all present).

### The one genuinely-live human-verify checkpoint (Wave 4)
Required because SC1/SC2/SC3 depend on real model behavior (real OCR/transcription accuracy) + real Gmail delivery that the offline suite cannot exercise. Script: on the live backend, (1) attach a REAL PDF and a REAL image → see them classified and their content summarized into the conversation; (2) click record, DICTATE a request into the mic → see the transcript enter as a request turn; (3) let the agent propose → Approve → confirm the delivered email reflects the attached/dictated content, with audit refs-only. Mirrors the Phase 3.3 CKPT-02 human-verify.

---

## Cross-Lane Notes (changes that belong to Lane A/C — do NOT design edits into Lane B plans)

1. **[Lane A] Mount point in `ChatPane.tsx`:** the intake attach + dictation controls need one line mounting `<IntakeControls threadId={...} />` into the cockpit composer (and access to the lifted `threadId`). Lane B ships the component fully; Lane A adds the mount. Flag at merge.
2. **[Lane A, optional] `sendCockpitMessage` framing awareness:** none required — intake frames the text itself. Only note if Lane A later wants to distinguish "attachment-originated" turns visually (a display concern, not a Phase-4 requirement).
3. **[Shared `@pikar/cost`] transcription pricing:** additive helper (append-only, pure package) — low conflict, but announce it so Lane A/C rebase cleanly.
4. **[Lane C hand-off, later]:** Phase 5 (vault) will consume extraction output for ingestion — build extraction cleanly behind `packages/extraction` so the vault can call it. No coordination needed now (PARALLELIZATION.md sequencing note).

---

## Sources

### Primary (HIGH — verified against the live codebase / dependency graph)
- `packages/backend/convex/{requests,pipeline,cockpit,llm,schema,skills}.ts` — pipeline entry, cockpit seam, SMOKE conventions, storage flow, schema, skill mirror.
- `packages/backend/node_modules/ai@7.0.20` d.ts — `experimental_transcribe`/`transcribe` exported.
- `packages/backend/node_modules/@ai-sdk/openai@4.0.11` d.ts — `.transcription('gpt-4o-transcribe'|'whisper-1'|'gpt-4o-mini-transcribe')`, multimodal provider.
- `packages/cost/src/cost.ts` — PRICING keys (gpt-4o-mini multimodal, no transcription entry → gap).
- `packages/pii/src/index.ts` — `scanText` fail-closed contract.
- `.planning/STATE.md` — sidecar-kill precedents, direct-OpenAI transport, restricted-scope/CASA constraints, use-node §96, SMOKE discipline.
- `.planning/PARALLELIZATION.md` — Lane B boundary + append-only singletons.
- `CLAUDE.md` — §1/§2/§4/§5/§6/§8/§9.

### Secondary (MEDIUM)
- `.planning/research/{STACK,PITFALLS,ARCHITECTURE}.md` — **historical**, pre-Convex; used only for the transcription-model landscape (gpt-4o-transcribe WER/pricing, Realtime-vs-dictation split) and the PII/cache/audit pitfalls that still hold conceptually.

### Confidence breakdown
- Extraction-engine decision (Path A): **HIGH** — reasoned from logged precedents + verified dependency graph + CASA/compute reality.
- Stack/APIs: **HIGH** — exports verified in `node_modules`.
- Merge seam (no cockpit.ts edit): **HIGH** — `sendCockpitMessage` signature read directly.
- Transcription cost handling: **MEDIUM** — the gap is identified; the exact pricing helper shape is the planner's to finalize.
- `.docx`/Office handling: **LOW** — deliberately deferred; recommend text/md + model-fallback for beta.

**Research date:** 2026-07-14 · **Valid until:** ~30 days (stable stack; re-verify OpenAI transcription model ids if bumped).

## RESEARCH COMPLETE
