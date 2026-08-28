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
  clampEvidence,
  type Evidence,
  type KnowledgeSource,
  type KnowledgeSourceState,
  validateSourceRef,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/** What every knowledge-source adapter returns: what was read, and how the read ended. */
export type KnowledgeAdapterResult = {
  readonly state: KnowledgeSourceState;
  readonly evidence: readonly Evidence[];
};

/**
 * The one place a raw adapter row becomes admitted evidence.
 *
 * `degraded` is the adapter's own honest report that something was lost BEFORE this point (a
 * provider page cap, a hit with no usable text). `clampEvidence` then applies the repo-owned per-
 * source and per-run bounds and reports anything IT cut. Either kind of loss makes the read
 * `partial` — a capped read is never reported as a complete one.
 *
 * `provider_error` outranks `cap` because an unusable row is a different problem from a full one,
 * and collapsing the two would hide it.
 */
function settle(
  source: KnowledgeSource,
  raw: readonly Evidence[],
  degraded: { readonly cap: boolean; readonly providerError: boolean },
): KnowledgeAdapterResult {
  const { evidence, capped } = clampEvidence(raw);
  const cut = degraded.cap || capped.includes(source);
  const state: KnowledgeSourceState = degraded.providerError
    ? { status: "partial", source, returned: evidence.length, reason: "provider_error" }
    : cut
      ? { status: "partial", source, returned: evidence.length, reason: "cap" }
      : { status: "available", source, returned: evidence.length };
  return { state, evidence };
}

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
    // The spine is destructured away and never named again — see the module header.
    const { docIds, titles, kinds, origins, sourceUpdatedAt, truncated, chunks } =
      await ctx.runAction(internal.vaultGround.vaultGroundHydrated, { tenantId, query });

    const raw: Evidence[] = [];
    let cap = false;
    let providerError = false;

    for (let i = 0; i < docIds.length; i++) {
      const docId = docIds[i] ?? "";
      const text = chunks[i] ?? "";
      // A hit whose text the whole-run budget squeezed to nothing. It is a REAL match, so the loss
      // is reported rather than swallowed — but it is not shipped as evidence, because a row with
      // no text can be cited and never verified (`validateSynthesis` checks excerpts against the
      // cited text, and there would be none).
      if (text === "") {
        cap = true;
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
        // From the row's own facts, never from the model: a `web_research` document is third-party
        // research wherever it is stored, and an `agent_promoted` one is the agent's own word.
        authority: authorityFor("vault", { docKind: kinds[i], origin: origins[i] }),
        ...(typeof updated === "number" ? { sourceUpdatedAt: updated } : {}),
        retrievedAt: now,
      });
    }

    return settle("vault", raw, { cap, providerError });
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
    const result = await ctx.runAction(internal.vaultDrive.findInDriveForTenant, {
      tenantId,
      query,
    });

    // Unreachable is NOT empty. The unavailable arm of `KnowledgeSourceState` carries no count at
    // all, so "Drive needs reconnecting" can never be rendered as "there are no such files".
    if (!result.ok)
      return {
        state: { status: "unavailable", source: "drive", reason: DRIVE_UNAVAILABLE[result.reason] },
        evidence: [],
      };

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
        authority: authorityFor("drive", {}),
        ...(row.modifiedTime === undefined ? {} : { sourceUpdatedAt: row.modifiedTime }),
        retrievedAt: now,
      });
    }

    // `truncated` is Drive's own `nextPageToken`: there were more matches than one page held.
    return settle("drive", raw, { cap: result.truncated, providerError });
  },
});
