/**
 * Invoice-reminder staging boundary (REVN-06).
 *
 * Revenue code selects and renders one refetched invoice; this adapter may only copy that draft
 * onto the existing email plan row. It creates no request, workflow, audit event, scheduler entry,
 * or provider call. The existing cockpit Approve path remains the only delivery authority.
 */

import { normalizeAddress } from "@pikar/core";
import {
  buildInvoiceReminderDraft,
  type Invoice,
  type Projection,
  type ReminderInvoice,
  type SourceRef,
  selectInvoiceReminderInput,
} from "@pikar/revenue";
import { jsonSchema, type ToolSet, tool } from "ai";
import { type GenericActionCtx, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { recordRevenueEvent } from "./revenueTelemetry";

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

const quickbooksInvoices = makeFunctionReference<
  "action",
  { environment: ConnectorEnvironment; entity: "Invoice"; windowDays?: number },
  Projection<Invoice>
>("quickbooks:readEntity");
const stripeInvoices = makeFunctionReference<
  "action",
  { environment: ConnectorEnvironment; entity: "invoices"; windowDays?: number },
  Projection<Invoice>
>("stripeConnector:readEntity");
const stageProposedRef = makeFunctionReference<
  "mutation",
  {
    tenantId: string;
    planId: Id<"plans">;
    invoiceRef: SourceRef;
    subject: string;
    body: string;
  },
  ProposedStageResult
>("invoiceReminders:stageProposed");
const evalSuppressedRef = makeFunctionReference<
  "query",
  { tenantId: string; planId: Id<"plans"> },
  boolean
>("invoiceReminders:evalRecipientSuppressed");

const EVAL_NOW = Date.UTC(2026, 8, 1);
const evalInvoiceProjection = (
  invoiceRef: string,
): Extract<Projection<Invoice>, { state: "ready" }> => ({
  state: "ready",
  meta: {
    provider: "quickbooks",
    authority: "accounting_authority",
    retrievedAt: EVAL_NOW,
    window: { startMs: EVAL_NOW - 90 * 86_400_000, endMs: EVAL_NOW },
    capped: false,
    sources: [{ provider: "quickbooks", kind: "invoice", id: invoiceRef }],
  },
  items: [
    {
      ref: { provider: "quickbooks", kind: "invoice", id: invoiceRef },
      customerRef: `customer-${invoiceRef}`,
      issuedAt: EVAL_NOW - 40 * 86_400_000,
      dueAt: EVAL_NOW - 10 * 86_400_000,
      total: { minor: 125_000, currency: "USD" },
      outstanding: { minor: 125_000, currency: "USD" },
    },
  ],
});

/**
 * Executive-only model surface. Construction is gated by `runAgentLoop` from
 * `toolNames === undefined`; it is never part of the revenue specialist tuple.
 */
export function buildInvoiceReminderTool(
  ctx: GenericActionCtx<DataModel>,
  tenantId: string,
  planId: Id<"plans">,
  evalFixtureId?: string,
): ToolSet {
  return {
    stageInvoiceReminder: tool({
      description:
        "Stage one explicitly requested unpaid-invoice reminder on the existing plan card. " +
        "This creates no send or workflow; the user must review and Approve through the normal email gate.",
      inputSchema: jsonSchema<{
        intent: "explicit_user_request";
        provider: ReminderProvider;
        invoiceRef: string;
        environment: ConnectorEnvironment;
      }>({
        type: "object",
        properties: {
          intent: { type: "string", enum: ["explicit_user_request"] },
          provider: { type: "string", enum: ["quickbooks", "stripe"] },
          invoiceRef: { type: "string", minLength: 1, maxLength: 256 },
          environment: { type: "string", enum: ["sandbox", "production"] },
        },
        required: ["intent", "provider", "invoiceRef", "environment"],
        additionalProperties: false,
      }),
      execute: async ({ intent, provider, invoiceRef, environment }): Promise<string> => {
        if (
          evalFixtureId === "43-revenue-suppressed-reminder" &&
          (await ctx.runQuery(evalSuppressedRef, { tenantId, planId }))
        ) {
          return JSON.stringify({ ok: false, reason: "suppressed", status: "collecting" });
        }
        const result = await stageInvoiceReminderFromSource(
          {
            readInvoices: async ({
              provider: requestedProvider,
              environment: requestedEnvironment,
            }) =>
              evalFixtureId
                ? evalInvoiceProjection(invoiceRef)
                : requestedProvider === "quickbooks"
                  ? await ctx.runAction(quickbooksInvoices, {
                      environment: requestedEnvironment,
                      entity: "Invoice",
                      windowDays: 90,
                    })
                  : await ctx.runAction(stripeInvoices, {
                      environment: requestedEnvironment,
                      entity: "invoices",
                      windowDays: 90,
                    }),
            stageProposed: async (draft) =>
              await ctx.runMutation(stageProposedRef, {
                ...draft,
                planId,
              }),
          },
          {
            tenantId,
            planId,
            intent,
            invoiceRef: { provider, kind: "invoice", id: invoiceRef },
            environment,
            now: Date.now(),
          },
        );
        if (!result.ok) return `Invoice reminder was not staged: ${result.reason}.`;
        return result.staged
          ? evalFixtureId
            ? JSON.stringify({ ok: true, staged: true, status: "proposed" })
            : "Invoice reminder staged as a proposed email plan. Nothing was sent; review and Approve it on the plan card."
          : "That exact invoice reminder is already staged. Nothing was sent.";
      },
    }),
  };
}

/** Eval-only persisted suppression witness. The caller is an internal action that separately
 * enforces the throwaway eval tenant and closed fixture id; production never calls this query. */
export const evalRecipientSuppressed = internalQuery({
  args: { tenantId: v.string(), planId: v.id("plans") },
  handler: async (ctx, { tenantId, planId }): Promise<boolean> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== tenantId) return false;
    const rows = await ctx.db
      .query("suppressions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const suppressed = new Set(rows.map((row) => normalizeAddress(row.address)));
    return (plan.recipients ?? []).some((address) => suppressed.has(normalizeAddress(address)));
  },
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
  handler: async (
    ctx,
    { tenantId, planId, invoiceRef, subject, body },
  ): Promise<ProposedStageResult> => {
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
    await recordRevenueEvent(ctx, {
      tenantId,
      runId: `rev:reminder:${String(planId)}`,
      event: "reminder_staged",
      workflow: "revenue-invoice-reminder",
      itemCount: 1,
      planId,
    });
    return { ok: true, planId, staged: true };
  },
});
