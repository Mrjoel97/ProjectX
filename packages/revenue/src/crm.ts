/**
 * Deterministic CRM attention ranking and customer pulse (REVN-04).
 *
 * THE REQUIREMENT IS MOSTLY A LIST OF THINGS THIS MUST NOT DO. REVN-04 asks for lead triage, call
 * lists, pipeline review and customer pulse "without creating a second CRM or fabricating deal
 * values/stages". Every rule below exists to hold one of those two lines:
 *
 *   • NO SECOND CRM. Nothing here takes a name, an email, a company or a stage LABEL. The inputs
 *     are Phase 19 contact IDs and opaque provider refs. A ranking function that accepted a display
 *     name would be the first row of the second CRM, and the second row would follow within a
 *     phase.
 *   • NO FABRICATION. An absent amount is `unknown`, never zero. An absent stage is `null`, never
 *     "new". An absent activity date is `null`, never "today". A contact with no deal is NOT an
 *     opportunity. The whole class of bug this prevents is a confident number the business acts on
 *     that no source ever provided.
 *
 * PURE, and Convex-free: `revenueCrm.ts` is the thin adapter that fetches and calls in (CLAUDE.md
 * §1). Everything here is total over its inputs and orders ties by a code-owned key, so the same
 * facts always produce the same list — a ranking that reordered between reads is a ranking nobody
 * can act on.
 */
import type { MoneyFigure } from "./contracts";

/** Where a fact came from. Kept separate all the way through — see `AttentionRow.provenance`. */
export type FactSource = "pikar" | "provider";

/**
 * One person under consideration. IDs and dates only.
 *
 * `contactId` is Phase 19's local id and is the ONLY identity in play; `providerRef` is an opaque
 * HubSpot object id joined through `contactProviderRefs`. Neither is a person's details.
 */
export type AttentionInput = {
  contactId: string;
  /** Opaque provider object id, or null when this contact exists only in Pikar. */
  providerRef: string | null;
  /**
   * TERMINAL. A suppressed contact is do-not-contact, full stop — it is not ranked lower, it is
   * not ranked at all. Ranking it "last" would still put it on a call list at the bottom of a
   * short day.
   */
  suppressed: boolean;
  /** Earliest OPEN follow-up due date from Phase 19, or null. */
  followUpDueAt: number | null;
  /** Last outbound or inbound activity Pikar knows about, or null. Unknown is not "never". */
  lastActivityAt: number | null;
  /** Source-provided deal facts. Absent means no deal, which is NOT an opportunity of value 0. */
  deal: AttentionDeal | null;
  /** Payment trouble seen on a payment rail: an open dispute or an overdue receivable. */
  paymentFlag: "dispute" | "overdue" | null;
};

export type AttentionDeal = {
  /** Opaque. Never a label — a stage NAME is the provider's vocabulary, not a shared enum. */
  stageId: string | null;
  /** Whether the provider's own stage metadata says this stage is closed. `null` = it did not say. */
  stageClosed: boolean | null;
  closeAt: number | null;
  amount: MoneyFigure;
};

/** Why a row is on the list. A closed set, so a UI cannot invent a reason. */
export type AttentionReason =
  | "follow_up_overdue"
  | "follow_up_due"
  | "payment_dispute"
  | "payment_overdue"
  | "deal_closing"
  | "gone_quiet";

export type AttentionRow = {
  contactId: string;
  /** Highest first. A code-owned integer, not a score anybody tunes at runtime. */
  priority: number;
  /** Every reason that fired, in a stable order. An empty list means the row is not returned. */
  reasons: readonly AttentionReason[];
  /** Which side each fact came from, so a reader can tell Pikar's own record from the provider's. */
  provenance: { pikar: boolean; provider: boolean };
};

/**
 * Weights, and they are DELIBERATELY COARSE.
 *
 * These are ordering buckets, not a scoring model. A fine-grained score invites tuning, and tuning
 * a number nobody can explain is how a list stops being defensible to the person working it. Each
 * reason either fires or it does not; the sum decides the bucket and `contactId` breaks ties.
 */
const WEIGHTS: Record<AttentionReason, number> = {
  follow_up_overdue: 100,
  payment_dispute: 80,
  payment_overdue: 60,
  deal_closing: 40,
  follow_up_due: 20,
  gone_quiet: 10,
};

/** Reason order for display. Fixed here so two callers cannot disagree. */
const REASON_ORDER: readonly AttentionReason[] = [
  "follow_up_overdue",
  "payment_dispute",
  "payment_overdue",
  "deal_closing",
  "follow_up_due",
  "gone_quiet",
];

const DAY = 86_400_000;
/** A deal closing inside this window is worth attention. */
export const CLOSING_SOON_MS = 7 * DAY;
/** No activity for this long is "gone quiet" — only ever computed from a date we actually have. */
export const QUIET_AFTER_MS = 30 * DAY;

function reasonsFor(input: AttentionInput, now: number): AttentionReason[] {
  const reasons: AttentionReason[] = [];

  if (input.followUpDueAt !== null) {
    reasons.push(input.followUpDueAt <= now ? "follow_up_overdue" : "follow_up_due");
  }
  if (input.paymentFlag === "dispute") reasons.push("payment_dispute");
  if (input.paymentFlag === "overdue") reasons.push("payment_overdue");

  // A deal is "closing" only when the provider gave a date AND did not say the stage is closed.
  // `stageClosed === null` means the provider's metadata was silent, and silence is not "open" —
  // treating it as open would put won and lost deals back on a working list forever.
  if (
    input.deal !== null &&
    input.deal.closeAt !== null &&
    input.deal.stageClosed === false &&
    input.deal.closeAt - now <= CLOSING_SOON_MS &&
    input.deal.closeAt >= now
  ) {
    reasons.push("deal_closing");
  }

  // NEVER fired from an absent date. "We have no record of contact" and "we have not spoken in
  // 40 days" are different facts, and only the second one is a reason to call someone.
  if (input.lastActivityAt !== null && now - input.lastActivityAt >= QUIET_AFTER_MS) {
    reasons.push("gone_quiet");
  }

  return REASON_ORDER.filter((r) => reasons.includes(r));
}

/**
 * Rank who needs attention. Suppressed contacts are REMOVED, and rows with no reason are removed —
 * a call list padded with people there is no reason to call is a list that stops being read.
 *
 * Ties break on `contactId` ascending: arbitrary, but STABLE, which is the property that matters.
 */
export function rankAttention(
  inputs: readonly AttentionInput[],
  now: number,
): readonly AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const input of inputs) {
    if (input.suppressed) continue;
    const reasons = reasonsFor(input, now);
    if (reasons.length === 0) continue;
    rows.push({
      contactId: input.contactId,
      priority: reasons.reduce((sum, r) => sum + WEIGHTS[r], 0),
      reasons,
      provenance: {
        pikar: input.followUpDueAt !== null || input.lastActivityAt !== null,
        provider: input.providerRef !== null,
      },
    });
  }
  return rows.sort((a, b) =>
    b.priority !== a.priority ? b.priority - a.priority : a.contactId.localeCompare(b.contactId),
  );
}

// ── Customer pulse ────────────────────────────────────────────────────────────────────────

/**
 * How a customer relationship is doing, from BOUNDED TYPED SIGNALS ONLY.
 *
 * No CRM note, no email body, no free text of any kind reaches this function — REVN-04 names that
 * explicitly. A pulse computed from notes is a sentiment model wearing a status label, and it
 * would be read as fact.
 */
export type PulseSignals = {
  /** Open dispute on a payment rail. */
  disputeOpen: boolean;
  /** Receivable past its due date. */
  invoiceOverdue: boolean;
  /** An OPEN follow-up that is already late. */
  followUpOverdue: boolean;
  lastActivityAt: number | null;
  /** Whether the provider projections backing this pulse were complete. */
  coverage: "ready" | "partial" | "unavailable";
};

/**
 * `unknown` is a first-class answer and the DEFAULT when coverage fails.
 *
 * A pulse of "healthy" computed from an unavailable read is the single most dangerous output this
 * module could produce: it is indistinguishable from a real all-clear.
 */
export type PulseStatus = "unknown" | "healthy" | "watch" | "at_risk";

export function customerPulse(signals: PulseSignals, now: number): PulseStatus {
  if (signals.coverage === "unavailable") return "unknown";

  // A dispute is at-risk whatever else is true, and it is knowable from a partial read.
  if (signals.disputeOpen) return "at_risk";
  if (signals.invoiceOverdue) return "watch";
  if (signals.followUpOverdue) return "watch";

  // Silence is only "quiet" if we know when the last activity was. With a partial read we may
  // simply not have fetched it, so the honest answer stays `unknown` rather than `healthy`.
  if (signals.lastActivityAt === null) return "unknown";
  if (signals.coverage === "partial") return "unknown";
  if (now - signals.lastActivityAt >= QUIET_AFTER_MS) return "watch";
  return "healthy";
}
