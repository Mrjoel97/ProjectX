# Cockpit attachments persist to the Knowledge Vault

- **Date:** 2026-07-25
- **Status:** Approved (owner), ready for implementation
- **Related:** CLAUDE.md §1 (thin adapter), §4 (redaction), ADR-006 (vault chunks trusted-as-own),
  playbooks `intake.md`, `vault.md`

## Problem

A file attached in the cockpit is extracted, PII-scanned, injected into that one conversation, and
then effectively discarded. It is never embedded, never graph-extracted, never retrievable, and it
does not appear in the vault UI. Open a new thread and it is gone.

Owner report: *"I uploaded the document in the cockpit and it didn't register in the knowledge
vault. Why do I have to upload documents directly in the knowledge vault? … Instead of the agent
just putting all of it in the prompt."*

Verified in `packages/backend/convex/intake.ts` `runIntake` (steps 1–9): the spine writes to
`intakeArtifacts`, then step 9 calls `respond(frameForConversation(...))` and returns. There is no
`vaultDocuments` write on the path.

**Cause is a phase seam, not a decision.** INTK-02 (cockpit attachments) shipped in Phase 2. The
Knowledge Vault shipped in Phase 5. Two ingestion paths built three phases apart, never unified.

## Decisions (owner-approved)

| Question | Decision |
|---|---|
| Which uploads persist? | **Every attached file.** Dictation excluded — a voice note IS the request, not a document. |
| What text does the vault copy hold? | **Raw text**, matching every other vault doc. The conversation still receives redacted `safeText`. |
| Sequencing | Build before closing Phase 12, test together. |

Rationale for raw text: the vault deliberately stores raw (`vault.ts:443` — *"the content plane
holds the user's own data; scanText at extraction time is the lanes' fail-closed gate, and every
downstream model path re-scans"*). Storing redacted text here would mean the same file yields
different vault content depending on which surface it entered through, and redacted names/figures
degrade grounding — the evaluation engine reads exactly these chunks.

## Design

One new step in `runIntake`, between the audit (step 8) and the conversational merge (step 9):

```
attachToThread → runIntake
  1-6  gate → bytes → classify → extract → PII scan (FAIL-CLOSED)
  7-8  persist safeText on intakeArtifacts → refs-only audit
  NEW  vault write: rawText → dedup → insert row → startIngest    (FAIL-OPEN)
  9    respond(frameForConversation(..., safeText))               (unchanged)
```

Two planes keep their existing contracts: the **conversation** gets redacted `safeText` (GRDL-01
untouched); the **vault** gets `rawText`.

### New function

`internal.vault.ingestFromAttachment({ tenantId, storageId, filename, mimeType, size, text })`
— an internal mutation mirroring `vaultIngestText`'s body: hash-dedup on `by_tenant_contentHash`
→ insert with `storageId` set → `startIngest`.

An **internal twin** rather than reusing the public `vaultIngestText` because (a) `vault.ts:441`
documents that the public mutation throws `UNAUTHENTICATED` when invoked from actions, and (b) it
accepts no `storageId`. Follows the `recordScorecardAnswerInternal` precedent from plan 12-04:
explicit `tenantId`, shared insert logic, no loosening of a public tenant mutation.

Row fields: `kind: "upload"`, `source: "upload"`, real `mimeType`, `storageId`, `text: rawText`,
`status: "processing"`. `categoryFor({ source: "upload", mimeType })` already routes docs to
`my-uploads` and lets an image/video mimeType win into `images`/`videos`, so **no new
`VaultSource` value is needed**.

### Properties that fall out of reuse

- **Dedup** — `by_tenant_contentHash` exists; attaching a file already in the vault reuses that
  row. No duplicate, no re-embed, no double spend.
- **Downloadable** — `storageId` carried through, so the doc opens/downloads from the vault UI.
- **Groundable** — `startIngest` runs the same embed + graph-extract workflow, so an attachment
  grounds a *later* evaluation. This is the point of the change.

### Failure handling

The vault write is wrapped **fail-open**: if ingest cannot start, the user still gets their answer.
An attachment's first job is answering the question in front of it, and a failed vault write must
never become a failed conversation. Mirrors how `runIntake` already treats every governed stop as
conversational data rather than a throw.

The PII scan stays **fail-closed** and stays upstream, so content failing the scan never reaches
the vault.

## Testing

- Attaching a document creates exactly one `vaultDocuments` row with raw text + `storageId`
- The same file attached twice creates one row (dedup)
- The conversation still receives redacted `safeText`, not raw
- A failing vault write still produces a conversational reply (fail-open)
- Dictation creates no vault row
- A PII-scan failure creates no vault row

## Out of scope

- **`frameForConversation` untouched** — it feeds the conversation text the 27 golden fixtures
  assert against; changing it risks eval-gate churn for a cosmetic gain.
- **No "saved to vault" confirmation message**, same reason. The doc appearing in the vault is the
  feedback. Revisit if it feels invisible.
- **No backfill** of previously attached files.

## Known cost

Every attachment now runs an embedding + graph extraction where previously it ran neither. This
applies to casual attachments too — a screenshot pasted for a throwaway question becomes a
permanent embedded vault doc. Dedup limits repeat cost, not first cost. Owner accepted this when
choosing "every attached file"; flagged here as the most likely thing to revisit after use.
