// Phase 29 (KNOW-01) — the EXTERNAL knowledge adapters: the mailbox, and the landed CRM rail.
//
// A THIN adapter (CLAUDE.md §1). Every bound, every authority class and every honesty rule lives
// in `@pikar/core/knowledgeSearch`; this module's whole job is to turn one provider read into one
// `KnowledgeSourceState` plus bounded `Evidence`, and to make the dishonest answers unspellable.
//
// THREE RULES, and they are why the file exists rather than the coordinator calling the providers
// directly:
//
//  1. UNREACHABLE IS NEVER EMPTY. A missing module, a missing connection, a dead token or a
//     provider failure comes back as `unavailable` WITH A REASON. There is no path in this file
//     from a failed read to `{status:"available", returned:0}` — the `unavailable` arm of
//     `KnowledgeSourceState` has no `returned` field, and `unavailableResult` is the only
//     constructor of it here, so it always returns an EMPTY evidence array with it.
//
//  2. PARTIAL IS NEVER A SMALLER COMPLETE. A hit list longer than what was hydrated, a further
//     provider page, a truncated body, a dropped malformed ref: each makes the read `partial` with
//     a named reason. Presenting five of twenty-five messages as a complete read of the mailbox is
//     the same lie as presenting an unreachable CRM as an empty one.
//
//  3. UNTRUSTED CONTENT GOES ONE WAY ONLY. `Evidence.label` (a subject line) and `Evidence.text`
//     (a message body) are attacker-controlled and are for the TOOLLESS synthesis plane alone.
//     This module writes NO audit row, NO telemetry row, NO dead letter and NO `agentSteps` row —
//     not "writes them carefully", writes none at all, which is what
//     `knowledgeExternalSources.test.ts` scans for. The one refs-only `knowledge.searched` event
//     belongs to the plan-29-06 coordinator, which sees counts and never content.
//
// THE KNOWN BOUNDARY, STATED RATHER THAN PAPERED OVER: the LANDED toolless firewall (the static
// scans in `llmRedaction.test.ts`) is BODY-scoped, not CONTENT-scoped. Sender display names and
// subject lines are deliberately admitted into today's tool-bearing briefing loop. This module is
// STRICTLY TIGHTER than that boundary — it returns no sender at all, and its subjects and bodies
// reach only the synthesis plane — and it must never be loosened toward it.

import {
  authorityFor,
  type Evidence,
  type KnowledgeSource,
  type KnowledgeSourceState,
  type PartialReason,
  type UnavailableReason,
  validateSourceRef,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * The external knowledge sources THIS module serves, mapped to the action that serves each.
 *
 * A CODE-OWNED REGISTRY, not a comment: `knowledgeExternalSources.test.ts` scans it in BOTH
 * directions against `@pikar/core`'s landed-source set — a key here for a source the search plane
 * reports as `not_landed` is dead code the product will never call, and a landed external source
 * with no key here is a source the coordinator cannot read. Vault and Drive are landed too and are
 * served by their own module (plan 29-02); they are absent here on purpose.
 */
export const EXTERNAL_KNOWLEDGE_READERS = {
  inbox: "readInboxKnowledge",
} as const satisfies Partial<Record<KnowledgeSource, string>>;

/** What every adapter in this module returns. */
export type ExternalKnowledgeResult = {
  readonly state: KnowledgeSourceState;
  /** ALWAYS empty when `state.status === "unavailable"` — see rule 1. */
  readonly evidence: readonly Evidence[];
};

/**
 * The ONE constructor of an unavailable answer. Centralised so "unreachable" can never acquire a
 * result count or a row: both are structurally impossible from here.
 */
function unavailableResult(
  source: KnowledgeSource,
  reason: UnavailableReason,
): ExternalKnowledgeResult {
  return { state: { status: "unavailable", source, reason }, evidence: [] };
}

/** The ONE constructor of an answered read. `partial` iff something was lost, with the reason. */
function answeredResult(
  source: KnowledgeSource,
  evidence: readonly Evidence[],
  lost: PartialReason | null,
): ExternalKnowledgeResult {
  return {
    state:
      lost === null
        ? { status: "available", source, returned: evidence.length }
        : { status: "partial", source, returned: evidence.length, reason: lost },
    evidence,
  };
}

// ── The mailbox ────────────────────────────────────────────────────────────────────────────

/**
 * Bounded mailbox evidence for one decomposed query.
 *
 * The provider work — escaping the query into Gmail's language, the list cap, the smaller
 * hydration cap, the per-body truncation — belongs to `gmail.knowledgeQuery` (`cockpit.md` owns
 * that module). This is the mapping into the search plane's contract, and the honesty rules.
 *
 * Explicit return type (guidelines §96) — never inferred through the internal graph.
 */
export const readInboxKnowledge = internalAction({
  args: { tenantId: v.string(), query: v.string() },
  handler: async (ctx, { tenantId, query }): Promise<ExternalKnowledgeResult> => {
    const read = await ctx.runAction(internal.gmail.knowledgeQuery, { tenantId, query });
    if (!read.ok) return unavailableResult("inbox", read.reason);

    const retrievedAt = Date.now();
    // A provider id is untrusted input like any other. A ref that is not ref-shaped is DROPPED
    // rather than repaired — a "ref" carrying content is how prose reaches a log plane that is
    // allowed to store refs (CLAUDE.md §4) — and the drop is REPORTED, never silent.
    const evidence: Evidence[] = [];
    let dropped = 0;
    for (const message of read.messages) {
      if (!validateSourceRef(message.id).ok) {
        dropped += 1;
        continue;
      }
      evidence.push({
        // Server-minted and local to this source's read. The model cites these; it cannot mint one.
        evidenceId: `inbox:${evidence.length}`,
        source: "inbox",
        sourceRef: message.id,
        label: message.subject,
        text: message.body,
        // From the code-owned table, never from the provider and never from the model. Mail is
        // `correspondence`: what somebody said, not a record of anything.
        authority: authorityFor("inbox", {}),
        sourceUpdatedAt: message.internalDate,
        retrievedAt,
      });
    }

    // Order matters only in that BOTH are honest; `provider_error` is named first because a
    // malformed ref is a provider problem, while a cap is our own bound working as designed.
    const lost: PartialReason | null =
      dropped > 0
        ? "provider_error"
        : read.more || read.listed > evidence.length || read.messages.some((m) => m.bodyTruncated)
          ? "cap"
          : null;
    return answeredResult("inbox", evidence, lost);
  },
});
