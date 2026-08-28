/**
 * Phase 29 (KNOW-01) — the VAULT knowledge-source adapter. The DRIVE adapter joins it here in
 * plan 29-02 task 2.
 *
 * A thin adapter (CLAUDE.md §1) that turns two landed, bounded retrieval seams into the closed
 * `Evidence` + `KnowledgeSourceState` contract in `@pikar/core/knowledgeSearch`. Every honesty rule
 * — authority, freshness, caps, "unreachable is not empty" — is decided in that pure package; this
 * module only maps provider rows onto it and reports what it could not read.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────
 *
 * **It does not retrieve.** Vault evidence comes from `internal.vaultGround.vaultGroundHydrated`,
 * because every bound worth having already lives behind that one door: hybrid `limit: 8` +
 * `vectorScoreThreshold: 0.2`, folder sealing applied BEFORE graph expansion, `GRAPH_HOP_CAP` and
 * the 1,500-per-doc / 8,000-total hydration budget. Reading the vault any other way would silently
 * drop all of them, so `knowledgeVaultDrive.test.ts` scans this source and fails if it ever tries.
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
