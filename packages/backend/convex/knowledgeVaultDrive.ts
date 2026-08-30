/**
 * Phase 29 (KNOW-01) — the VAULT and DRIVE knowledge-source adapters.
 *
 * A thin adapter (CLAUDE.md §1) that turns two landed, bounded retrieval seams into the closed
 * `Evidence` + `KnowledgeSourceState` contract in `@pikar/core/knowledgeSearch`. Every honesty rule
 * — authority, freshness, caps, "unreachable is not empty" — is decided in that pure package; this
 * module only maps provider rows onto it and reports what it could not read.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────
 *
 * **It does not retrieve.** Vault evidence comes from `internal.vaultGround.vaultGroundHydrated`
 * and Drive evidence from `internal.vaultDrive.findInDriveForTenant`, because every bound worth
 * having already lives behind those two doors: hybrid `limit: 8` + `vectorScoreThreshold: 0.2`,
 * folder sealing applied BEFORE graph expansion, `GRAPH_HOP_CAP`, the 1,500-per-doc / 8,000-total
 * hydration budget, and on the Drive side scope-before-refresh, both shared-drive parameters and
 * Drive query-language escaping. Reading either plane any other way would silently drop all of
 * them, so `knowledgeVaultDrive.test.ts` scans this source and fails if it ever tries.
 *
 * **It does not fetch.** There is no `fetch` call in this file and no Drive URL. The only network
 * it can reach is whatever `vaultDrive.ts` already reaches, which is `files.list` with no `method`,
 * i.e. GET. Import, export, reservation, landing and ingest are not merely unused here — they are
 * unreachable, and a source scan over both this module and `runDriveSearch` proves it.
 *
 * **It does not carry the Blueprint spine.** `vaultGroundHydrated` returns one; it is not a
 * document, it has no id, and citing it would attribute the product's own summary of the business
 * to a source that does not exist. It is destructured away and never counted.
 *
 * ── EVIDENCE IDS ──────────────────────────────────────────────────────────────────────────────
 *
 * `evidenceId` is server-minted, local to one run, and namespaced by source (`vault-1`, `drive-1`)
 * so two adapters cannot mint the same id when the coordinator merges them. Uniqueness rests on
 * one source being read once per run, which `clampSearchPlan` already guarantees by admitting at
 * most one plan entry per distinct source.
 */
import {
  authorityFor,
  type Evidence,
  type KnowledgeAdapterResult,
  settleRead,
  unavailableRead,
  validateSourceRef,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// THE RESULT CONTRACT IS NOT DEFINED HERE. `KnowledgeAdapterResult`, `settleRead` and
// `unavailableRead` live in `@pikar/core` beside `clampEvidence` and the closed state union
// (CLAUDE.md §1), because this module and `knowledgeExternalSources.ts` each had their own
// structurally-identical copy, written three minutes apart, and the copies had ALREADY drifted on
// the question that matters — one clamped at the admission boundary and the other applied
// hand-written slices. One type, two constructors, four adapters.

// ── Vault ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Vault evidence: the tenant's own documents, through the landed hybrid + graph retrieval.
 *
 * Identity-less with an EXPLICIT `tenantId`, the `vaultGroundHydrated` / `gmail.search` convention,
 * because the coordinator that calls this runs without a live identity.
 */
export const searchVaultKnowledge = internalAction({
  args: { tenantId: v.string(), query: v.string() },
  handler: async (ctx, { tenantId, query }): Promise<KnowledgeAdapterResult> => {
    const now = Date.now();
    // A SEARCH THAT WAS NEVER SENT IS NOT AN EMPTY VAULT. `clampSearchPlan` refuses a query with no
    // searchable term upstream, but this action's own argument is a bare `v.string()` and this is
    // the trust boundary, so it fails closed on its own terms rather than on a claim about another
    // module. `unplanned` is the honest word: no search of the vault happened.
    if (query.trim() === "") return unavailableRead("vault", "unplanned");

    // UNREACHABLE IS NOT EMPTY, AND A THROW IS NOT A STATE. `vaultGroundHydrated` reaches
    // OpenRouter for embeddings and `internal.vault.getDoc` for hydration, and either can reject —
    // no key, a network fault, a document raced out from under the read. Every landed caller of
    // this action wraps it for exactly that reason (`llm.ts`, `evaluations.ts`); without this the
    // adapter was the only one that did not, and the failure escaped the internalAction instead of
    // coming back as the governed gap the whole contract exists to produce.
    let hydrated: Awaited<
      ReturnType<typeof ctx.runAction<typeof internal.vaultGround.vaultGroundHydrated>>
    >;
    try {
      hydrated = await ctx.runAction(internal.vaultGround.vaultGroundHydrated, { tenantId, query });
    } catch {
      // The error itself is deliberately not carried out: it can hold provider prose, and the
      // search plane's `reason` is a code-owned enum that reaches a stored row (CLAUDE.md §4).
      return unavailableRead("vault", "provider_error");
    }
    // The spine is destructured away and never named again — see the module header.
    const { docIds, titles, kinds, origins, sourceUpdatedAt, truncated, driveOwned, chunks } =
      hydrated;

    const raw: Evidence[] = [];
    let cap = false;
    let providerError = false;

    for (let i = 0; i < docIds.length; i++) {
      const docId = docIds[i] ?? "";
      const text = chunks[i] ?? "";
      // A hit with no text is dropped either way — a row with no text can be cited and never
      // verified (`validateSynthesis` checks excerpts against the cited text, and there would be
      // none) — but WHY it is empty decides the reason, and the two causes are different facts
      // about the read. `truncated` true means the whole-run budget ran out before this document:
      // a real cap. `truncated` false over an empty string means the document simply has no
      // extracted text (`vaultDocuments.text` is optional and `getDoc` returns `text ?? ""`), which
      // is an unusable row, not a bound we hit. Reporting the second as `cap` told the user we hit
      // a retrieval limit that never applied.
      if (text === "") {
        if (truncated[i] === true) cap = true;
        else providerError = true;
        continue;
      }
      // Read in part, not in full: the loop saw the first 1,500 characters of a longer document.
      // That is a PARTIAL read of the vault, and saying so is the whole point of the contract.
      if (truncated[i] === true) cap = true;
      // Fail closed on a ref that is not a ref. Unreachable for a Convex id today; the check costs
      // nothing and is the §4 boundary this whole contract rests on.
      if (!validateSourceRef(docId).ok) {
        providerError = true;
        continue;
      }
      const updated = sourceUpdatedAt[i];
      raw.push({
        evidenceId: `vault-${raw.length + 1}`,
        source: "vault",
        sourceRef: docId,
        label: titles[i] ?? "",
        text,
        // From the row's own facts, never from the model. ANY row carrying an `origin` is the
        // agent's own word — including a `folder_digest`, which is `vaultDigest.ts`'s MODEL-WRITTEN
        // summary and is retrievable because that insert calls `startIngest`.
        //
        // ⚠ AND THE ABSENCE OF AN `origin` PROVES NOTHING. `authorityFor` used to read it as proof
        // of a tenant upload, but `evaluations.ts:1150` (`persistNextStepMemo`), `voice.ts:349`
        // (`persistBrief`) and `onboarding.ts:492` all ingest LLM prose with no origin at all, so
        // the agent's memo, brief and profile were cited at `tenant_owned` — the strongest class,
        // the owner's own word. Authorship is now established POSITIVELY from `docKind` against
        // `TENANT_AUTHORED_DOC_KINDS`, and an unrecognised kind fails to the weaker class. The
        // real fix is an explicit `origin: "agent"` at those three write sites, which are three
        // other modules' to change.
        //
        // `driveOwned` CLOSES THE CROSS-PLANE DIVERGENCE. A file a stranger shared into the
        // tenant's Drive read `third_party_research` on the Drive plane and `tenant_owned` the
        // moment the folder import copied it here — one document, two provenances. `landFile` now
        // decides Drive's tristate at the write site and `vaultGroundHydrated` carries it; `null`
        // means the row is not a Drive import at all, which is NOT a downgrade (see `authorityFor`).
        authority: authorityFor("vault", {
          docKind: kinds[i],
          origin: origins[i],
          ...(driveOwned[i] === null || driveOwned[i] === undefined
            ? {}
            : { ownedByMe: driveOwned[i] as boolean }),
        }),
        ...(typeof updated === "number" ? { sourceUpdatedAt: updated } : {}),
        retrievedAt: now,
      });
    }

    return settleRead("vault", raw, { cap, providerError });
  },
});

// ── Drive ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Every way the Drive read can fail to happen, mapped onto the closed `UnavailableReason` set.
 * `drive_error` becomes `provider_error`; the three token states keep their own names, so "you
 * never connected Drive" and "your grant needs widening" stay different sentences to the user.
 */
const DRIVE_UNAVAILABLE = {
  not_connected: "not_connected",
  reauth: "reauth",
  refresh_failed: "refresh_failed",
  drive_error: "provider_error",
} as const;

/**
 * Drive evidence: file METADATA over the existing read-only grant. No bytes, ever.
 *
 * **THE EVIDENCE TEXT IS THE FILE'S OWN NAME AND TYPE, AND THAT IS THE HONEST CEILING.** Drive
 * search returns metadata; a snippet of a document's contents would require downloading or
 * exporting it, which is the import rail's paid path and is exactly what this adapter must be
 * incapable of. So a Drive citation says "a file called X, of type Y, last modified Z matched your
 * search" and never pretends to quote it. Stating that in the text is what stops a synthesizer
 * treating a file NAME as a finding about the business.
 *
 * ponytail: no content snippet. Upgrade path if one is ever wanted, and it is not free: it needs a
 * separate, explicitly-costed export of a single user-chosen file, not a search-time download.
 */
export const searchDriveKnowledge = internalAction({
  args: { tenantId: v.string(), query: v.string() },
  handler: async (ctx, { tenantId, query }): Promise<KnowledgeAdapterResult> => {
    const now = Date.now();
    // A DRIVE SEARCH THAT WAS NEVER SENT IS NOT AN EMPTY DRIVE. `runDriveSearch` short-circuits a
    // blank needle to `{ok: true, rows: []}` with ZERO network calls, which arrived here as
    // `{status: "available", returned: 0}` — "we looked at your Drive and there is nothing there"
    // for a read that never happened. Refused at the boundary instead.
    if (query.trim() === "") return unavailableRead("drive", "unplanned");

    // A rejected `fetch` — DNS, TLS, timeout — is not one of `findInDriveForTenant`'s four modelled
    // failures; it propagates through `driveFetch` and out of this action. Caught, so a transport
    // fault is the same governed gap as an HTTP 500.
    let result: Awaited<
      ReturnType<typeof ctx.runAction<typeof internal.vaultDrive.findInDriveForTenant>>
    >;
    try {
      result = await ctx.runAction(internal.vaultDrive.findInDriveForTenant, { tenantId, query });
    } catch {
      return unavailableRead("drive", "provider_error");
    }

    // Unreachable is NOT empty. The unavailable arm of `KnowledgeSourceState` carries no count at
    // all, so "Drive needs reconnecting" can never be rendered as "there are no such files".
    if (!result.ok) return unavailableRead("drive", DRIVE_UNAVAILABLE[result.reason]);

    const raw: Evidence[] = [];
    let providerError = false;

    for (const row of result.rows) {
      // A folder is not a document. It has no content of any kind, so it can only ever be cited as
      // "a folder with a matching name exists", which is not evidence about the business.
      if (row.kind !== "file") continue;
      if (!validateSourceRef(row.id).ok) {
        providerError = true;
        continue;
      }
      raw.push({
        evidenceId: `drive-${raw.length + 1}`,
        source: "drive",
        sourceRef: row.id,
        label: row.name,
        text: `Google Drive file "${row.name}" (${row.mimeType}) matched this search. Pikar read its file listing only — the contents were not opened.`,
        // OWNERSHIP DECIDES AUTHORITY, AND THE SEARCH IS NOT OWNERSHIP-SCOPED. `runDriveSearch`
        // passes `includeItemsFromAllDrives` and has no `'me' in owners` restriction, so a file a
        // stranger shared into the tenant's Drive matches — and every hit was stamped
        // `tenant_owned` over a `files.list` that did not even ASK for the ownership field.
        // Anything but `ownedByMe: true` is now third-party (see `authorityFor`).
        authority: authorityFor("drive", { ownedByMe: row.ownedByMe }),
        ...(row.modifiedTime === undefined ? {} : { sourceUpdatedAt: row.modifiedTime }),
        retrievedAt: now,
      });
    }

    // `truncated` is Drive's own `nextPageToken`: there were more matches than one page held.
    return settleRead("drive", raw, { cap: result.truncated, providerError });
  },
});
