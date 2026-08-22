# ADR-025: An explicit, human-initiated promotion admits agent-authored artifacts to the retrieval corpus — and the attribution is preserved rather than the trust withheld

- **Status**: **Accepted** — 2026-08-22, recorded at the Phase-26 CONT-01 gate (plan 26-11)
- **Recorded**: 2026-08-22, from the code this plan shipped. The owner closed the open question
  this ADR turns on (see *Decision*, point 0) in the same session.
- **Cites, and does NOT supersede**: [ADR-006](ADR-006-vault-chunks-trusted-as-own.md). ADR-006
  grants vault chunks *trusted-as-own* status on the stated premise that they are **the user's OWN
  uploads**, and requires every future grounding surface to decide, citing it, between
  trusted-as-own and a toolless firewall. This ADR is that decision for one new surface. ADR-006 is
  left **byte-unchanged** — ADRs are never edited after acceptance.
- **Phases**: 18 built the rails (both `origin` literals, no writer for the second); 26 (plan 26-11)
  ships the writer.

## Context

Phase 18 made agent-created artifacts **structurally unreachable by retrieval**, and did it without
a filter. `vault.insertCreatedDoc` deliberately does not call `startIngest`, so a created document
has **no rag entry and no graph node** — and therefore cannot be found by either half of
`runVaultGround` (vector search joined on `entry.metadata.vaultDocId`, then the hop-capped graph
expand). The exclusion is the **absent call**, not a predicate. That is why no `origin !== "agent"`
term exists anywhere in retrieval, and why none may be added: there is nothing to forget to apply at
a future call site.

The cost was that an artifact the owner genuinely wanted as reference material could never become
one. `schema.ts` anticipated this from the start — it registered `origin: "agent_promoted"` as an
**inert literal** with the note that *"the DEFERRED promote control is a patch + a button"*.

Two things stood in the way, and both were real:

1. `docs/playbooks/vault.md` recorded the opposite instruction — **"Do NOT close this by ingesting
   them"** — and parked the choice as an *OPEN OWNER QUESTION at 18-09's gate*, on the correct
   reasoning that putting model output into the corpus that grounds the model is the self-grounding
   loop the exclusion exists to break.
2. Promotion opens a **provenance-laundering** path. The evaluation engine's `fillVault` stamped
   every grounded chunk `{ docId, title, confidence: "high", source: "vault" }` — the identical
   label the owner's own uploaded P&L receives. Once agent text can be promoted, a figure the model
   invented in its own `createDocument` output would be scanned by the financial patterns, written
   into the Scorecard, and **cited back to the owner as their own source**. This repository has
   shipped that defect class more than once, which is why it is named here rather than discovered
   later.

## Decision

0. **The owner closed the parked question on 2026-08-22**, confirming the reading that the playbook
   note refused **blanket** ingestion of agent output — not an explicit per-row act. That refusal
   stands unchanged: nothing ingests an `origin:"agent"` row automatically, ever.

1. **`api.vault.promoteToReference` is the single promotion surface.** It accepts only a row this
   tenant owns whose `origin` is `"agent"` (or `"agent_promoted"` and stranded at `failed`), flips
   `origin` to `agent_promoted` and `status` to `processing`, and calls the existing `startIngest`
   exactly once. Every foreign, missing or ineligible outcome returns the same `ineligible` result,
   so the mutation is not an existence oracle for another tenant's ids. 26-12 and 26-13 call it
   directly and **project** its result; neither may re-wrap the guard in a second mutation, because
   a duplicated guard is how one of the two paths ends up unguarded.

2. **The guard is a positive whitelist, never a negation.** `origin` ABSENT means user-supplied and
   `"folder_digest"` is already ingested, so `origin !== undefined` would wrongly accept both.

3. **The trust is granted; the attribution is preserved.** A promoted artifact keeps
   `origin: "agent_promoted"` on the row, and that origin now travels with the text:
   `vault.ownedDocsMeta` returns it, `vaultGroundHydrated` returns a parallel `origins` array from
   the batch read it already performed, the evaluation engine cites such a chunk as
   **`source: "agent-relayed"`** rather than `"vault"`, and the cockpit's `searchVault` fence marks
   the in-fence label the model reads. `confidence` deliberately stays `"high"`: the owner promoted
   the artifact on purpose, so only the ATTRIBUTION changes, never the weight. The defect is
   crediting the owner with the model's words — not using the value.

4. **`origins` labels; it never filters.** No caller may use it to decide what is retrieved. The
   retrieval-side origin predicate remains banned.

## Consequences

- **Promotion is a one-way door.** `patchCreatedDoc` refuses any row whose `origin !== "agent"`, so
  a promoted artifact can never be revised in-thread again and the only reversal is
  `deleteVaultDoc`, which destroys it. Widening that guard is **not** the fix: it would leave a
  stale rag entry keyed on the superseded content hash. Accepted; recorded in `vault.md`. Every UAT
  promotion must therefore target a **fresh** created document.
- **A stranded promotion is recoverable, and only that one.** A promoted row whose ingest FAILED may
  be re-promoted. Without that clause the artifact is lost for good: `retryStuckIngests` skips
  non-`processing` rows, the origin guard refuses an already-promoted row, and `patchCreatedDoc`
  refuses it too. This is the sole exception to idempotence.
- **Un-promoted agent output remains structurally excluded**, exactly as before — no rag entry, no
  graph node, nothing to filter.
- **The counted `startIngest` invariant in `vault.ts` moves from 5 to 6.** Promotion is the
  legitimate sixth call site.
- **Ingest-once cannot be evidenced by the obvious signals.** `origin === "agent_promoted"` is the
  inert literal, `ragEntryId` is deduped by content hash, and `spendLedger` writes nothing at $0 —
  each passes while promotion is broken. The evidence is a counted `workflow.start` spy.
- **`searchVault` labels but does not firewall.** A promoted chunk still enters the tool loop as
  reference text inside the existing untrusted-reference fence, now carrying who wrote it. Routing
  vault chunks through a toolless schema-validated digest (the `digestInbox` mirror named as
  `vaultSearch`'s ponytail ceiling) remains the upgrade path if labelling proves insufficient.
- **Promotion writes no audit row, and that is a deliberate consequence of an older decision.**
  `vaultRedaction.test.ts` asserts by static scan that `vault.ts`, `vaultIngest.ts`, `vaultGraph.ts`
  and `vaultLlm.ts` emit **no** log-plane call or insert: the vault content plane is the one place
  raw document text lives, so it is kept log-free **by construction** rather than by inspecting a
  payload. A carefully-shaped payload there is one careless edit away from carrying `doc.title`; an
  absent call site is not. The caller audits instead — the shipped precedent is `vault.searched`,
  written by `llm.ts`. **26-13 owns the promotion audit** when it builds the control. Until then the
  record that a promotion happened is the row itself (`origin: "agent_promoted"`), plus the ingest
  workflow's own trail.
- **No UI ships in this phase.** The mutation is API-only; 26-13 builds the control. Until then
  "rollback" means deleting the export, not flipping a switch — there is no runtime presentation
  kill-switch (recorded in 26-10).
