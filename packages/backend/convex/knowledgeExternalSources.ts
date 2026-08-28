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
//     `KnowledgeSourceState` has no `returned` field, and `unavailableRead` (@pikar/core) is the
//     only constructor of it, so it always returns an EMPTY evidence array with it.
//
//     THE STRUCTURAL ARGUMENT ONLY EVER HELD FOR FAILURES THE PROVIDER LAYER NAMED. It said
//     nothing about a provider layer that did not name one: `gmail.knowledgeQuery` checked neither
//     fetch's status nor its own, so an HTTP 500/429/403 parsed as `{}`, `messages` came back
//     undefined and this adapter reported `{status:"available", source:"inbox", returned:0}` — the
//     exact sentence above, produced by the exact path above. The read verb now returns
//     `provider_error` for a non-2xx or a rejected fetch, and drops (and reports) a message whose
//     body hydration failed instead of shipping an evidence row of two empty strings.
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
//  4. THE TENANT IS AN ARGUMENT, WHICH IS ONLY SAFE BECAUSE NOTHING PUBLIC LIVES HERE. Every
//     reader is an `internalAction` taking `tenantId: v.string()` — the landed
//     `hubspotReadForTenant` / `vaultGroundHydrated` convention, needed because the plan-29-06
//     coordinator runs without a live identity. The argument IS the tenant scope, so the
//     coordinator MUST pass `ctx.tenantId` from a tenant wrapper and never a caller-supplied
//     value, and NO function in this module may ever become a `tenantAction`/`action`/`query` —
//     that would let any caller name any tenant. `knowledgeExternalSources.test.ts` scans both
//     adapter modules for exactly that, because nothing else records it.
//
// THE KNOWN BOUNDARY, STATED RATHER THAN PAPERED OVER: the LANDED toolless firewall (the static
// scans in `llmRedaction.test.ts`) is BODY-scoped, not CONTENT-scoped. Sender display names and
// subject lines are deliberately admitted into today's tool-bearing briefing loop. This module is
// STRICTLY TIGHTER than that boundary — it returns no sender at all, and its subjects and bodies
// reach only the synthesis plane — and it must never be loosened toward it.

import {
  authorityFor,
  type Evidence,
  type KnowledgeAdapterResult,
  type KnowledgeSource,
  SEARCH_CAPS,
  settleRead,
  type UnavailableReason,
  unavailableRead,
  validateSourceRef,
} from "@pikar/core";
import type { Projection } from "@pikar/revenue";
import type { HubSpotDeal, HubSpotRow } from "@pikar/revenue/providers/hubspot";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { DEFAULT_WINDOW_DAYS, readHubSpotDataset } from "./hubspot";
import type { AccessTokenResult } from "./hubspotAuth";

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

// THE RESULT CONTRACT IS NOT DEFINED HERE. `KnowledgeAdapterResult`, `unavailableRead` and
// `settleRead` come from `@pikar/core`, beside `clampEvidence` and the closed state union
// (CLAUDE.md §1). This module and `knowledgeVaultDrive.ts` each defined their own
// structurally-identical copy, three minutes apart in the same wave, and the copies had already
// drifted on the question that matters: 29-02's ran the repo's admission clamp and this one relied
// on hand-written slices, so `evidenceTextCharCap` was enforced for a mail body (in `gmail.ts`) and
// not at all for a CRM row. Now every adapter in every module goes through `settleRead`, which
// clamps and then reports what it cut.

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
  handler: async (ctx, { tenantId, query }): Promise<KnowledgeAdapterResult> => {
    const read = await ctx.runAction(internal.gmail.knowledgeQuery, { tenantId, query });
    // Every one of the read verb's failures is a NAMED `UnavailableReason` — including
    // `provider_error` for a non-2xx or a rejected fetch, and `unplanned` for a phrase that
    // escaped to an empty Gmail query. None of them can arrive as an empty successful read.
    if (!read.ok) return unavailableRead("inbox", read.reason);

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

    // BOTH are honest, and `provider_error` outranks `cap` inside `settleRead`: a malformed ref
    // or a message Gmail refused to hand over is a provider problem, while a cap is our own bound
    // working as designed. `read.hydrationFailed` is the second kind — the list succeeded and one
    // or more body reads did not, so this read is short for a reason that is not a budget.
    return settleRead("inbox", evidence, {
      providerError: dropped > 0 || read.hydrationFailed,
      cap: read.more || read.listed > evidence.length || read.messages.some((m) => m.bodyTruncated),
    });
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
// NO VENDOR FREE TEXT IS REQUESTED. `HUBSPOT_DEAL_PROPERTIES` never asks HubSpot for `dealname`,
// a contact name, an email or a phone number, so a `HubSpotDeal` is ids, stage keys, timestamps and
// a money figure — nothing else.
//
// THE EVIDENCE TEXT IS COMPOSED IN CODE, BUT IT IS NOT PROVIDER-STRING-FREE, AND AN EARLIER VERSION
// OF THIS COMMENT CLAIMED IT WAS. `pipelineId` and `stageId` are HubSpot's own `pipeline` and
// `dealstage` property values: opaque keys in every real portal, but unbounded provider strings on
// the wire, and a portal is free to put prose in them. They were interpolated verbatim into text
// carrying the second-strongest authority class. They now go through `validateSourceRef` — the same
// §4 ref-shape rule the `sourceRef` uses — so a value that is not id-shaped is reported as
// `unknown` rather than repeated, and `settleRead` caps the composed sentence like any other row.

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
/**
 * DERIVED FROM `ensureHubSpotAccessToken`'S OWN RETURN TYPE, so a member that is added, removed or
 * renamed there is a COMPILE ERROR here. It was `Record<string, UnavailableReason>`, which the
 * compiler cannot see a gap in: deleting the `reauth` entry left both the suite and `tsc` green,
 * and a dead refresh was then reported as the transient `provider_error` instead of asking the
 * user to reconnect.
 */
type CrmUnavailableCause = Extract<AccessTokenResult, { ok: false }>["reason"];

const CRM_UNAVAILABLE_REASON: Readonly<Record<CrmUnavailableCause, UnavailableReason>> = {
  not_connected: "not_connected",
  // A revoked grant and a dead refresh both need the user to reconnect. `refresh_failed` is
  // deliberately NOT used: it reads as transient, and neither of these is.
  revoked: "reauth",
  reauth: "reauth",
  // A refresh lease held by a concurrent read. Transient, and honestly a provider-layer problem.
  busy: "provider_error",
  provider_error: "provider_error",
};

/** Fail CLOSED at runtime AND at compile time: the record is exhaustive over the token verb's
 *  union, and a value from anywhere else still lands on `provider_error`, never on "available". */
const crmReason = (because: string): UnavailableReason =>
  (CRM_UNAVAILABLE_REASON as Readonly<Record<string, UnavailableReason | undefined>>)[because] ??
  "provider_error";

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * One deal as a sentence, composed ENTIRELY from structured fields — and WITHOUT THE MONEY.
 *
 * **THE AMOUNT IS THE RESTRICTED FIELD AND IT IS NOT IN FREE TEXT.** `@pikar/revenue` classifies a
 * HubSpot deal amount as `supplemental` — "colour only ... Never a total" — and
 * `hubspotProjection` hardcodes that authority so no caller can promote it. Interpolating the
 * figure into prose handed the model everything it needs to sum a pipeline total and cite it: the
 * constraint restated in a comment and dropped in code, which is this repo's named
 * provenance-laundering shape. The ABSENCE IS STATED rather than silent, so "no amount here" can
 * never be read as "zero".
 *
 * ponytail: no amount at all, rather than a structured non-summable figure field. Ceiling — a
 * knowledge answer cannot say what a deal is worth. Upgrade path, and it is not one line: a typed
 * `Evidence.figure` the synthesizer's schema has no arithmetic for, plus a claim-level rule in
 * `validateSynthesis` refusing a claim that cites more than one of them. That is a design, and it
 * belongs with the revenue rail rather than smuggled in through prose.
 *
 * THE WINDOW IS STATED FOR THE SAME REASON: `readHubSpotDataset` filters to `DEFAULT_WINDOW_DAYS`,
 * so this row is one of the RECENT deals and never one of all of them.
 */
function dealText(deal: HubSpotDeal): string {
  // A provider key is only usable as a key if it is SHAPED like one. Prose in a stage field is
  // content, not an identifier, and content from a provider does not belong in a code-composed
  // sentence — it is dropped rather than truncated, because half a sentence of somebody else's
  // text reads exactly like the rest of ours.
  const key = (value: string | null | undefined): string =>
    typeof value === "string" && validateSourceRef(value).ok ? value : "unknown";
  const parts = [
    `HubSpot deal ${deal.ref.id}`,
    `pipeline ${key(deal.pipelineId)}`,
    `stage ${key(deal.stageId)}`,
    `created ${isoDay(deal.createdAt)}`,
    deal.closeAt === null ? "no close date" : `closing ${isoDay(deal.closeAt)}`,
  ];
  return (
    `${parts.join(", ")}. Pikar does not carry deal amounts into a knowledge answer: a HubSpot ` +
    `figure is colour, not the books. This read covers deals created in the last ` +
    `${DEFAULT_WINDOW_DAYS} days only.`
  );
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
  handler: async (ctx, { tenantId }): Promise<KnowledgeAdapterResult> => {
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
      return unavailableRead("crm-facts", crmReason(because));
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
        // THE PROVIDER LAYER'S OWN AUTHORITY IS HONOURED, NOT OVERRIDDEN. `hubspotProjection`
        // hardcodes `supplemental` so no caller can promote a deal into accounting authority; this
        // adapter discarded it and re-stamped every row `system_of_record`, the second-strongest
        // class, so a claim built on HubSpot read back at nearly the strength of the books. The
        // two vocabularies are still separate — `authorityFor` relates them in ONE direction, as a
        // downgrade, and can never raise a source above its code-owned class.
        authority: authorityFor("crm-facts", { providerAuthority: projection.meta.authority }),
        sourceUpdatedAt: deal.updatedAt ?? deal.createdAt,
        retrievedAt,
      });
    }

    // A capped or partial provider read, or more deals than the per-source evidence cap:
    // presenting eight of two hundred as a complete read of the pipeline is the same lie as
    // presenting an unreachable CRM as an empty one. A projection that is `partial` for a reason
    // that is NOT its own cap is a provider problem, and `settleRead` ranks that above a cap.
    // A WINDOWED READ IS A PARTIAL READ, ALWAYS. `readHubSpotDataset` filters deals to
    // `DEFAULT_WINDOW_DAYS` and this adapter never passes a `windowDays`, so the default always
    // applies — and a question about deals older than that was getting a complete-LOOKING answer
    // built from a slice, with nothing naming the coverage that had been dropped. `cap` is the
    // honest reason: the window is our own bound working as designed, not a provider failure.
    return settleRead("crm-facts", evidence, {
      providerError: dropped > 0 || (projection.state === "partial" && !projection.meta.capped),
      cap: true,
    });
  },
});
