/**
 * Deterministic invoice-reminder selection and drafting (REVN-06).
 *
 * This module is deliberately Convex-free and LLM-free. A provider adapter supplies normalized
 * rows; this boundary selects one exact source ref, rejects anything unsafe to remind from, and
 * copies the financial facts into an immutable template input. The model never receives operands
 * from which it could invent a balance, currency, due date, or lateness calculation.
 */
import { err, ok, type Result } from "@pikar/core/result";
import {
  type Invoice,
  type Projection,
  type SourceRef,
  validateProjection,
  validateSourceRef,
} from "./contracts";
import { formatMoneyAmount, moneyFromMinor } from "./money";

const DAY_MS = 86_400_000;
export const REMINDER_SOURCE_MAX_AGE_MS = 15 * 60_000;

export const REMINDER_PAYMENT_STATES = ["open", "paid", "void", "disputed"] as const;
export type ReminderPaymentState = (typeof REMINDER_PAYMENT_STATES)[number];

/** Provider state that normalization intentionally does not put on the shared finance Invoice. */
export type ReminderInvoice = Invoice & { paymentState: ReminderPaymentState };

/** Facts safe for the code-owned template. Values are copied, not references into a projection. */
export type InvoiceReminderInput = Readonly<{
  source: Readonly<SourceRef>;
  customerRef: string;
  amountMinor: number;
  currency: string;
  issuedAt: number;
  dueAt: number;
  daysPastDue: number;
  sourceRetrievedAt: number;
}>;

export type SelectInvoiceReminderInput = {
  requestedRef: SourceRef;
  source: Projection<ReminderInvoice>;
  now: number;
};

const exactRef = (left: SourceRef, right: SourceRef): boolean =>
  left.provider === right.provider && left.kind === right.kind && left.id === right.id;

/**
 * Select one invoice for a reminder, failing closed on every coverage and financial ambiguity.
 * `ready` is required: a partial page cannot prove the selected row is current or unique.
 */
export function selectInvoiceReminderInput({
  requestedRef,
  source,
  now,
}: SelectInvoiceReminderInput): Result<InvoiceReminderInput, string> {
  const refCheck = validateSourceRef(requestedRef);
  if (!refCheck.ok || requestedRef.kind.toLowerCase() !== "invoice") {
    return err("A reminder needs a valid invoice ref.");
  }
  if (requestedRef.provider !== "quickbooks" && requestedRef.provider !== "stripe") {
    return err("That source provider does not supply reminder-safe invoices.");
  }
  if (!Number.isFinite(now) || now < 0) return err("A reminder needs a valid server time.");
  if (source.state === "unavailable") return err("The invoice source is unavailable.");
  if (source.state === "partial") return err("A partial invoice source cannot stage a reminder.");

  const projectionCheck = validateProjection(source);
  if (!projectionCheck.ok) return err(`The invoice source is invalid: ${projectionCheck.error}`);
  if (source.meta.provider !== requestedRef.provider) {
    return err("The invoice ref and source provider do not match.");
  }
  if (source.meta.retrievedAt > now || now - source.meta.retrievedAt > REMINDER_SOURCE_MAX_AGE_MS) {
    return err("The invoice source is stale; refetch it before staging a reminder.");
  }

  const matches = source.items.filter((candidate) => exactRef(candidate.ref, requestedRef));
  if (matches.length !== 1) return err("The exact invoice ref was not found in the fresh source.");
  const selected = matches[0]!;
  if (selected.paymentState !== "open") {
    return err(`A ${selected.paymentState} invoice cannot receive a reminder.`);
  }
  if (selected.dueAt === null || !Number.isFinite(selected.dueAt) || selected.dueAt < 0) {
    return err("An invoice reminder needs the source due date.");
  }
  if (!Number.isFinite(selected.issuedAt) || selected.issuedAt < 0) {
    return err("An invoice reminder needs the source issue date.");
  }
  if (selected.customerRef.trim() === "") {
    return err("An invoice reminder needs an opaque customer ref.");
  }
  const total = moneyFromMinor(selected.total.minor, selected.total.currency);
  const outstanding = moneyFromMinor(selected.outstanding.minor, selected.outstanding.currency);
  if (!total.ok || !outstanding.ok) return err("The invoice carries an invalid amount.");
  if (total.value.currency !== outstanding.value.currency) {
    return err("The invoice total and unpaid balance use different currency codes.");
  }
  if (outstanding.value.minor <= 0) {
    return err("The invoice has no unpaid balance to remind about.");
  }
  if (total.value.minor < outstanding.value.minor) {
    return err("The unpaid balance exceeds the invoice total.");
  }

  const sourceRef = Object.freeze({ ...selected.ref });
  return ok(
    Object.freeze({
      source: sourceRef,
      customerRef: selected.customerRef,
      amountMinor: outstanding.value.minor,
      currency: outstanding.value.currency,
      issuedAt: selected.issuedAt,
      dueAt: selected.dueAt,
      daysPastDue: Math.max(0, Math.floor((now - selected.dueAt) / DAY_MS)),
      sourceRetrievedAt: source.meta.retrievedAt,
    }),
  );
}

const isoDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** A toolless, code-owned template. No LLM call exists or is accepted as an argument. */
export function buildInvoiceReminderDraft(input: InvoiceReminderInput): {
  subject: string;
  body: string;
} {
  const amount = formatMoneyAmount({ minor: input.amountMinor, currency: input.currency });
  const timing =
    input.daysPastDue > 0
      ? `It was due on ${isoDay(input.dueAt)} and is ${input.daysPastDue} ${input.daysPastDue === 1 ? "day" : "days"} past due.`
      : `It is due on ${isoDay(input.dueAt)}.`;
  return {
    subject: `Reminder: invoice ${input.source.id} ${input.daysPastDue > 0 ? "is past due" : "is due soon"}`,
    body:
      `Hello,\n\nThis is a reminder that invoice ${input.source.id} has an outstanding balance of ` +
      `${input.currency} ${amount}. ${timing}\n\n` +
      "Please review the invoice and arrange payment if it remains outstanding.\n",
  };
}
