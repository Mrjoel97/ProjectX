// Deterministic CRM attention and pulse (28-10 Task 1, REVN-04).
//
// The requirement is mostly a list of things this must NOT do, so most of these tests are negative:
//
//  1. NO SECOND CRM. Nothing in the input or output carries a name, an email or a stage LABEL.
//  2. NO FABRICATION. Absent means absent: an unknown amount is not zero, an unknown stage is not
//     "open", and no last-activity date is not "never contacted".
//  3. SUPPRESSION IS TERMINAL. A do-not-contact person is REMOVED, not ranked last.
//  4. THE SAME FACTS ALWAYS PRODUCE THE SAME LIST, including ties.
import { describe, expect, test } from "vitest";
import {
  type AttentionInput,
  CLOSING_SOON_MS,
  customerPulse,
  type PulseSignals,
  QUIET_AFTER_MS,
  rankAttention,
} from "./crm";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const contact = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  contactId: "c1",
  providerRef: null,
  suppressed: false,
  followUpDueAt: null,
  lastActivityAt: null,
  deal: null,
  paymentFlag: null,
  ...over,
});

/**
 * An amount the provider did not give. NOT `null` and NOT zero: `MoneyFigure` is a four-state
 * figure, and "unknown" is one of its states precisely so an absent deal value can never be summed
 * as nothing. `tsc` caught this — the runtime suite was green with `null` because no assertion ever
 * read the amount.
 */
const UNKNOWN_AMOUNT = { state: "unknown", needs: "provider did not supply an amount" } as const;

const ids = (rows: readonly { contactId: string }[]) => rows.map((r) => r.contactId);

describe("suppression is terminal, not a low rank", () => {
  test("a suppressed contact is REMOVED even with every reason firing", () => {
    const rows = rankAttention(
      [
        contact({
          contactId: "suppressed",
          suppressed: true,
          followUpDueAt: NOW - DAY,
          paymentFlag: "dispute",
          lastActivityAt: NOW - 90 * DAY,
        }),
      ],
      NOW,
    );
    // Ranking it last still puts it on a call list at the bottom of a short day.
    expect(rows).toEqual([]);
  });

  test("suppression removes only that row, never the list", () => {
    const rows = rankAttention(
      [
        contact({ contactId: "a", suppressed: true, followUpDueAt: NOW - DAY }),
        contact({ contactId: "b", followUpDueAt: NOW - DAY }),
      ],
      NOW,
    );
    expect(ids(rows)).toEqual(["b"]);
  });
});

describe("a row with no reason is not on the list", () => {
  test("a contact with nothing known about it does not appear", () => {
    expect(rankAttention([contact()], NOW)).toEqual([]);
  });

  test("a contact with a deal but no closing date and no other signal does not appear", () => {
    const rows = rankAttention(
      [
        contact({
          deal: { stageId: "s1", stageClosed: false, closeAt: null, amount: UNKNOWN_AMOUNT },
        }),
      ],
      NOW,
    );
    // A deal is not, by itself, a reason to call someone today.
    expect(rows).toEqual([]);
  });
});

describe("absent facts are never invented", () => {
  // "We have no record of contact" and "we have not spoken in 40 days" are different facts, and
  // only the second is a reason to call. A null date must not become an infinitely old one.
  test("a null lastActivityAt never fires gone_quiet", () => {
    const rows = rankAttention([contact({ lastActivityAt: null, followUpDueAt: NOW + DAY })], NOW);
    expect(rows[0]?.reasons).not.toContain("gone_quiet");
  });

  test("a known-old lastActivityAt DOES fire it — so the rule above is not vacuous", () => {
    const rows = rankAttention([contact({ lastActivityAt: NOW - QUIET_AFTER_MS - 1 })], NOW);
    expect(rows[0]?.reasons).toEqual(["gone_quiet"]);
  });

  // Silence in the provider's stage metadata is not "open". Treating it as open puts won and lost
  // deals back on a working list forever.
  test("stageClosed null is NOT treated as open", () => {
    const rows = rankAttention(
      [
        contact({
          deal: { stageId: "s", stageClosed: null, closeAt: NOW + DAY, amount: UNKNOWN_AMOUNT },
        }),
      ],
      NOW,
    );
    expect(rows).toEqual([]);
  });

  test("stageClosed false with a near close date DOES fire — the rule above is not vacuous", () => {
    const rows = rankAttention(
      [
        contact({
          deal: { stageId: "s", stageClosed: false, closeAt: NOW + DAY, amount: UNKNOWN_AMOUNT },
        }),
      ],
      NOW,
    );
    expect(rows[0]?.reasons).toEqual(["deal_closing"]);
  });

  test("an explicitly CLOSED stage never fires, whatever its date", () => {
    const rows = rankAttention(
      [
        contact({
          deal: { stageId: "s", stageClosed: true, closeAt: NOW + DAY, amount: UNKNOWN_AMOUNT },
        }),
      ],
      NOW,
    );
    expect(rows).toEqual([]);
  });

  test("a deal closing beyond the window does not fire", () => {
    const rows = rankAttention(
      [
        contact({
          deal: {
            stageId: "s",
            stageClosed: false,
            closeAt: NOW + CLOSING_SOON_MS + 1,
            amount: UNKNOWN_AMOUNT,
          },
        }),
      ],
      NOW,
    );
    expect(rows).toEqual([]);
  });

  // A deal whose close date has PASSED is not "closing soon"; it is a stale record.
  test("a deal whose close date is in the past does not fire", () => {
    const rows = rankAttention(
      [
        contact({
          deal: { stageId: "s", stageClosed: false, closeAt: NOW - DAY, amount: UNKNOWN_AMOUNT },
        }),
      ],
      NOW,
    );
    expect(rows).toEqual([]);
  });
});

describe("overdue and upcoming follow-ups are different reasons", () => {
  test("a past due date is overdue and outranks everything else", () => {
    const rows = rankAttention(
      [
        contact({ contactId: "quiet", lastActivityAt: NOW - 90 * DAY }),
        contact({ contactId: "overdue", followUpDueAt: NOW - 1 }),
      ],
      NOW,
    );
    expect(ids(rows)).toEqual(["overdue", "quiet"]);
  });

  test("a future due date is due, not overdue", () => {
    const rows = rankAttention([contact({ followUpDueAt: NOW + DAY })], NOW);
    expect(rows[0]?.reasons).toEqual(["follow_up_due"]);
  });

  // Exactly-now is overdue: a follow-up due at this instant is one you are late for, not one you
  // have time to plan.
  test("a due date of exactly now is overdue", () => {
    expect(rankAttention([contact({ followUpDueAt: NOW })], NOW)[0]?.reasons).toEqual([
      "follow_up_overdue",
    ]);
  });
});

describe("the order is stable and code-owned", () => {
  test("ties break on contactId, so two runs give the same list", () => {
    const inputs = ["c", "a", "b"].map((contactId) =>
      contact({ contactId, paymentFlag: "overdue" }),
    );
    expect(ids(rankAttention(inputs, NOW))).toEqual(["a", "b", "c"]);
    expect(ids(rankAttention([...inputs].reverse(), NOW))).toEqual(["a", "b", "c"]);
  });

  test("reasons come back in a fixed order regardless of how they fired", () => {
    const rows = rankAttention(
      [
        contact({
          followUpDueAt: NOW - DAY,
          paymentFlag: "dispute",
          lastActivityAt: NOW - 90 * DAY,
        }),
      ],
      NOW,
    );
    expect(rows[0]?.reasons).toEqual(["follow_up_overdue", "payment_dispute", "gone_quiet"]);
  });

  test("a dispute outranks an overdue invoice, which outranks a closing deal", () => {
    const rows = rankAttention(
      [
        contact({
          contactId: "deal",
          deal: { stageId: "s", stageClosed: false, closeAt: NOW + DAY, amount: UNKNOWN_AMOUNT },
        }),
        contact({ contactId: "dispute", paymentFlag: "dispute" }),
        contact({ contactId: "overdue", paymentFlag: "overdue" }),
      ],
      NOW,
    );
    expect(ids(rows)).toEqual(["dispute", "overdue", "deal"]);
  });
});

describe("provenance keeps Pikar's record and the provider's apart", () => {
  test("a local-only contact is marked pikar, not provider", () => {
    const rows = rankAttention([contact({ followUpDueAt: NOW - DAY, providerRef: null })], NOW);
    expect(rows[0]?.provenance).toEqual({ pikar: true, provider: false });
  });

  test("a provider-linked contact carries both when both contributed", () => {
    const rows = rankAttention([contact({ followUpDueAt: NOW - DAY, providerRef: "hs_123" })], NOW);
    expect(rows[0]?.provenance).toEqual({ pikar: true, provider: true });
  });

  // §4 and "no second CRM": the output is ids and closed enums. If a name could reach a row, the
  // second CRM has already started.
  test("no output field can carry a person's details", () => {
    const rows = rankAttention(
      [contact({ contactId: "c1", providerRef: "hs_1", followUpDueAt: NOW - DAY })],
      NOW,
    );
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "contactId",
      "priority",
      "provenance",
      "reasons",
    ]);
  });
});

// ── Customer pulse ────────────────────────────────────────────────────────────────────────

describe("customer pulse is unknown unless the reads actually covered it", () => {
  const signals = (over: Partial<PulseSignals> = {}): PulseSignals => ({
    disputeOpen: false,
    invoiceOverdue: false,
    followUpOverdue: false,
    lastActivityAt: NOW - DAY,
    coverage: "ready",
    ...over,
  });

  // THE MOST DANGEROUS POSSIBLE OUTPUT: "healthy" computed from a read that did not happen is
  // indistinguishable from a real all-clear.
  test("an unavailable read is UNKNOWN, never healthy", () => {
    expect(customerPulse(signals({ coverage: "unavailable" }), NOW)).toBe("unknown");
  });

  test("a partial read cannot produce healthy either", () => {
    expect(customerPulse(signals({ coverage: "partial" }), NOW)).toBe("unknown");
  });

  // ...but a dispute is knowable from a partial read, and silence about it would be worse.
  test("a dispute is at_risk even on a partial read", () => {
    expect(customerPulse(signals({ coverage: "partial", disputeOpen: true }), NOW)).toBe("at_risk");
  });

  test("an unavailable read reports unknown even with a dispute — nothing was read", () => {
    expect(customerPulse(signals({ coverage: "unavailable", disputeOpen: true }), NOW)).toBe(
      "unknown",
    );
  });

  test("no last-activity date is unknown, not healthy", () => {
    expect(customerPulse(signals({ lastActivityAt: null }), NOW)).toBe("unknown");
  });

  test("a full read with recent activity and no flags is healthy", () => {
    expect(customerPulse(signals(), NOW)).toBe("healthy");
  });

  test("an overdue invoice is watch; a dispute outranks it to at_risk", () => {
    expect(customerPulse(signals({ invoiceOverdue: true }), NOW)).toBe("watch");
    expect(customerPulse(signals({ invoiceOverdue: true, disputeOpen: true }), NOW)).toBe(
      "at_risk",
    );
  });

  test("an overdue follow-up is watch", () => {
    expect(customerPulse(signals({ followUpOverdue: true }), NOW)).toBe("watch");
  });

  test("a long silence on a full read is watch", () => {
    expect(customerPulse(signals({ lastActivityAt: NOW - QUIET_AFTER_MS }), NOW)).toBe("watch");
  });

  test("all four statuses are reachable", () => {
    const seen = new Set([
      customerPulse(signals({ coverage: "unavailable" }), NOW),
      customerPulse(signals(), NOW),
      customerPulse(signals({ invoiceOverdue: true }), NOW),
      customerPulse(signals({ disputeOpen: true }), NOW),
    ]);
    expect(seen).toEqual(new Set(["unknown", "healthy", "watch", "at_risk"]));
  });
});
