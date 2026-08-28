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
  SEARCH_CAPS,
  type UnavailableReason,
  validateSourceRef,
} from "@pikar/core";
import { formatMoneyAmount, type Projection } from "@pikar/revenue";
import type { HubSpotDeal, HubSpotRow } from "@pikar/revenue/providers/hubspot";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { readHubSpotDataset } from "./hubspot";

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
  "crm-facts": "readCrmKnowledge",
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

// ── The CRM (HubSpot, landed 28-05) ────────────────────────────────────────────────────────
//
// WHY THIS SOURCE IS SEARCHABLE WHILE THE PACK PLANE STILL CALLS IT MISSING: the two planes ask
// different questions. `MISSING_PACK_SOURCES` means "no agent-reachable read TOOL", and owner
// decision A (2026-08-23, binding) says not to add one. Phase 29's search plane is TOOLLESS by
// design, so a landed toolless adapter makes the CRM searchable without giving any workflow pack a
// CRM tool. `KNOWLEDGE_ADAPTERS` in `@pikar/core` is where that distinction is code-owned.
//
// THE QUERY IS DELIBERATELY NOT FORWARDED. `HUBSPOT_READ_PATHS` has no search endpoint — CRM
// Search is excluded from HubSpot's own rate-limit budget and needs its own decision (28-05), so
// it is not on the allow-list. A CRM knowledge read is therefore a WINDOWED LIST of recent deals,
// and the model filters them during synthesis. Passing the planner's phrase into a HubSpot request
// is not merely unnecessary here, it is unreachable: `connectorFetch` hardcodes GET against the
// allow-list and `hubspot.ts` builds the query string from a compile-time property list.
//
// NO VENDOR FREE TEXT EXISTS TO LEAK. `HUBSPOT_DEAL_PROPERTIES` never asks HubSpot for `dealname`,
// a contact name, an email or a phone number, so a `HubSpotDeal` is ids, stage keys, timestamps
// and a money figure — nothing else. The evidence `text` below is therefore COMPOSED IN CODE from
// those structured fields; there is no provider string in it at all, which is a stronger property
// than "we redact the provider strings".

/** The one dataset a knowledge question can use. Owners and pipelines are configuration, contacts
 *  and companies carry only timestamps — none of the three answers a business question. */
const CRM_DATASET = "deals" as const;

/** Environments probed, in order. Production first, so a tenant connected to both reads live. */
const CRM_ENVIRONMENTS = ["production", "sandbox"] as const;

/**
 * The credential layer's closed reason set, mapped onto the search plane's closed reason set.
 *
 * A CLOSED RECORD, and `projection.because` is NEVER forwarded: it is a provider-adjacent string
 * and the search plane's `reason` is a code-owned enum that reaches a stored row (CLAUDE.md §4).
 * An unrecognised value falls through to `provider_error` — fail closed, never "available".
 */
const CRM_UNAVAILABLE_REASON: Readonly<Record<string, UnavailableReason>> = {
  not_connected: "not_connected",
  // A revoked grant and a dead refresh both need the user to reconnect. `refresh_failed` is
  // deliberately NOT used: it reads as transient, and neither of these is.
  revoked: "reauth",
  reauth: "reauth",
  // A refresh lease held by a concurrent read. Transient, and honestly a provider-layer problem.
  busy: "provider_error",
  provider_error: "provider_error",
};

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * One deal as a sentence, composed ENTIRELY from structured fields. Ids and stage keys are opaque
 * HubSpot keys, never labels — HubSpot's label for a stage is free text this rail never requests.
 */
function dealText(deal: HubSpotDeal): string {
  const amount =
    deal.amount.state === "known"
      ? `${formatMoneyAmount(deal.amount.value)} ${deal.amount.value.currency}`
      : // A deal with no amount, or an amount with no currency, is UNKNOWN — never zero.
        "an unrecorded amount";
  const parts = [
    `HubSpot deal ${deal.ref.id} is worth ${amount}`,
    `pipeline ${deal.pipelineId ?? "unknown"}`,
    `stage ${deal.stageId ?? "unknown"}`,
    `created ${isoDay(deal.createdAt)}`,
    deal.closeAt === null ? "no close date" : `closing ${isoDay(deal.closeAt)}`,
  ];
  return `${parts.join(", ")}.`;
}

const isDeal = (row: HubSpotRow): row is HubSpotDeal => "stageId" in row;

/**
 * Bounded CRM evidence.
 *
 * `query` is accepted so every adapter in this module has one signature, and is deliberately
 * UNUSED — see the header above. It is named `_query` so that is visible at the call site rather
 * than only in prose.
 *
 * Explicit return type (guidelines §96) — never inferred through the internal graph.
 */
export const readCrmKnowledge = internalAction({
  args: { tenantId: v.string(), query: v.string() },
  handler: async (ctx, { tenantId }): Promise<ExternalKnowledgeResult> => {
    // Probe production, then sandbox. `ensureHubSpotAccessToken` answers `not_connected` from the
    // row lookup alone, so an unconnected environment costs no network call and no money.
    let projection: Projection<HubSpotRow> | null = null;
    for (const environment of CRM_ENVIRONMENTS) {
      const read = await readHubSpotDataset(ctx, {
        tenantId,
        environment,
        dataset: CRM_DATASET,
      });
      projection = read.projection;
      if (!(projection.state === "unavailable" && projection.because === "not_connected")) break;
    }
    if (projection === null || projection.state === "unavailable") {
      const because = projection === null ? "not_connected" : projection.because;
      return unavailableResult("crm-facts", CRM_UNAVAILABLE_REASON[because] ?? "provider_error");
    }

    const retrievedAt = Date.now();
    const ranked = projection.items
      .filter(isDeal)
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));

    const evidence: Evidence[] = [];
    let dropped = 0;
    for (const deal of ranked.slice(0, SEARCH_CAPS.maxEvidencePerSource)) {
      // Namespaced, so a CRM ref can never be mistaken for a Drive file id or a vault docId.
      const sourceRef = `${deal.ref.provider}:${deal.ref.kind}:${deal.ref.id}`;
      if (!validateSourceRef(sourceRef).ok) {
        dropped += 1;
        continue;
      }
      evidence.push({
        evidenceId: `crm-facts:${evidence.length}`,
        source: "crm-facts",
        sourceRef,
        // A code-composed label. There is no vendor string to use even if we wanted one.
        label: `Deal ${deal.ref.id}`,
        text: dealText(deal),
        // `system_of_record` from the code-owned table. NOT `@pikar/revenue`'s `supplemental` —
        // that authority answers "may this figure be summed into a revenue total" (no, it may
        // not), which is a different question from "how much may this be believed as a fact about
        // the pipeline". The two vocabularies are not interchangeable and are not merged.
        authority: authorityFor("crm-facts", {}),
        sourceUpdatedAt: deal.updatedAt ?? deal.createdAt,
        retrievedAt,
      });
    }

    const lost: PartialReason | null =
      dropped > 0
        ? "provider_error"
        : // A capped or partial provider read, or more deals than the per-source evidence cap:
          // presenting eight of two hundred as a complete read of the pipeline is the same lie as
          // presenting an unreachable CRM as an empty one.
          projection.state === "partial" || ranked.length > evidence.length
          ? projection.state === "partial" && !projection.meta.capped
            ? "provider_error"
            : "cap"
          : null;
    return answeredResult("crm-facts", evidence, lost);
  },
});
