/**
 * Invoice-reminder staging boundary (REVN-06).
 *
 * Revenue code selects and renders one refetched invoice; this adapter may only copy that draft
 * onto the existing email plan row. It creates no request, workflow, audit event, scheduler entry,
 * or provider call. The existing cockpit Approve path remains the only delivery authority.
 */
import {
  buildInvoiceReminderDraft,
  type Invoice,
  type Projection,
  type ReminderInvoice,
  type SourceRef,
  selectInvoiceReminderInput,
} from "@pikar/revenue";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

type ReminderProvider = "quickbooks" | "stripe";
type ConnectorEnvironment = "sandbox" | "production";

export type InvoiceReminderStageArgs = {
  tenantId: string;
  planId: Id<"plans"> | string;
  intent: "explicit_user_request" | "missing";
  invoiceRef: SourceRef;
  environment: ConnectorEnvironment;
  now: number;
};

type ProposedStageResult =
  | { ok: true; planId: string; staged: boolean }
  | { ok: false; reason: string };

export type InvoiceReminderStageDeps = {
  readInvoices(args: {
    provider: ReminderProvider;
    environment: ConnectorEnvironment;
  }): Promise<Projection<Invoice>>;
  stageProposed(args: {
    tenantId: string;
    planId: Id<"plans"> | string;
    invoiceRef: SourceRef;
    subject: string;
    body: string;
  }): Promise<ProposedStageResult>;
};

/**
 * The connector reads are already narrowed to receivable invoices. Preserve that server-side fact
 * explicitly for the pure reminder boundary; a zero balance is paid and can never be reminded.
 * Stripe rejects draft/void/uncollectible rows before this point, and QuickBooks exposes no
 * disputed reminder state on its normalized invoice contract.
 */
function withPaymentState(source: Projection<Invoice>): Projection<ReminderInvoice> {
  if (source.state === "unavailable") return source;
  const items = source.items.map((invoice) => ({
    ...invoice,
    paymentState: invoice.outstanding.minor > 0 ? ("open" as const) : ("paid" as const),
  }));
  return source.state === "ready"
    ? { ...source, items }
    : { ...source, items, missing: source.missing };
}

/** Refetch, revalidate, render in code, then cross the one inert plan-write seam. */
export async function stageInvoiceReminderFromSource(
  deps: InvoiceReminderStageDeps,
  args: InvoiceReminderStageArgs,
): Promise<ProposedStageResult> {
  if (args.intent !== "explicit_user_request") {
    return { ok: false, reason: "explicit_intent_required" };
  }
  if (args.invoiceRef.provider !== "quickbooks" && args.invoiceRef.provider !== "stripe") {
    return { ok: false, reason: "unsupported_invoice_provider" };
  }

  const source = await deps.readInvoices({
    provider: args.invoiceRef.provider,
    environment: args.environment,
  });
  const selected = selectInvoiceReminderInput({
    requestedRef: args.invoiceRef,
    source: withPaymentState(source),
    now: args.now,
  });
  if (!selected.ok) return { ok: false, reason: selected.error };

  const draft = buildInvoiceReminderDraft(selected.value);
  return await deps.stageProposed({
    tenantId: args.tenantId,
    planId: args.planId,
    invoiceRef: selected.value.source,
    subject: draft.subject,
    body: draft.body,
  });
}

const invoiceRefArg = v.object({
  provider: v.union(v.literal("quickbooks"), v.literal("stripe")),
  kind: v.literal("invoice"),
  id: v.string(),
});

/**
 * The only persistence this module owns: collecting email plan -> proposed email plan.
 * Exact retries are inert. Any other plan content or lifecycle state is left untouched.
 */
export const stageProposed = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    invoiceRef: invoiceRefArg,
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { tenantId, planId, invoiceRef, subject, body }): Promise<ProposedStageResult> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== tenantId) throw new Error("plan not found");

    const validDraft =
      invoiceRef.id.trim() !== "" &&
      subject.trim() !== "" &&
      subject.length <= 998 &&
      body.trim() !== "" &&
      body.length <= 100_000;
    if (!validDraft) return { ok: false, reason: "invalid_reminder_draft" };
    if ((plan.recipients?.length ?? 0) === 0) return { ok: false, reason: "recipient_required" };

    const exactRetry =
      plan.kind === undefined &&
      plan.status === "proposed" &&
      plan.subject === subject &&
      plan.body === body;
    if (exactRetry) return { ok: true, planId, staged: false };

    const draftInProgress =
      plan.kind !== undefined ||
      plan.status !== "collecting" ||
      Boolean(plan.subject) ||
      Boolean(plan.body) ||
      (plan.attachments?.length ?? 0) > 0;
    if (draftInProgress) return { ok: false, reason: "plan_in_progress" };

    await ctx.db.patch(planId, { subject, body, status: "proposed" });
    return { ok: true, planId, staged: true };
  },
});
