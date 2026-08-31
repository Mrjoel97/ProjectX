/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import type { Invoice, Projection, SourceRef } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  buildInvoiceReminderTool,
  stageInvoiceReminderFromSource,
  type InvoiceReminderStageDeps,
} from "./invoiceReminders";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const REF: SourceRef = { provider: "quickbooks", kind: "invoice", id: "inv_42" };

function source(over: Partial<Invoice> = {}): Projection<Invoice> {
  const invoice: Invoice = {
    ref: REF,
    customerRef: "customer_7",
    issuedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    dueAt: Date.parse("2026-08-21T00:00:00.000Z"),
    total: { minor: 125_050, currency: "USD" },
    outstanding: { minor: 25_050, currency: "USD" },
    ...over,
  };
  return {
    state: "ready",
    meta: {
      provider: "quickbooks",
      authority: "accounting_authority",
      retrievedAt: NOW - 1_000,
      window: { startMs: NOW - 90 * 86_400_000, endMs: NOW },
      capped: false,
      sources: [invoice.ref],
    },
    items: [invoice],
  };
}

function deps(read: () => Promise<Projection<Invoice>>): {
  deps: InvoiceReminderStageDeps;
  staged: ReturnType<typeof vi.fn>;
} {
  const staged = vi.fn(async () => ({ ok: true as const, planId: "plan_1", staged: true }));
  return { deps: { readInvoices: read, stageProposed: staged }, staged };
}

describe("invoice reminder source-to-plan staging", () => {
  test("the executive staging schema is closed, capped, and names no delivery choice", () => {
    const tools = buildInvoiceReminderTool({} as never, "tenant_a", "plan_1" as Id<"plans">);
    expect(Object.keys(tools)).toEqual(["stageInvoiceReminder"]);
    const schema = tools.stageInvoiceReminder.inputSchema as unknown as {
      jsonSchema: {
        properties: Record<string, { enum?: string[]; maxLength?: number }>;
        required: string[];
        additionalProperties: boolean;
      };
    };
    expect(schema.jsonSchema.properties.intent?.enum).toEqual(["explicit_user_request"]);
    expect(schema.jsonSchema.properties.provider?.enum).toEqual(["quickbooks", "stripe"]);
    expect(schema.jsonSchema.properties.environment?.enum).toEqual(["sandbox", "production"]);
    expect(schema.jsonSchema.properties.invoiceRef?.maxLength).toBe(256);
    expect(schema.jsonSchema.required.sort()).toEqual([
      "environment",
      "intent",
      "invoiceRef",
      "provider",
    ]);
    expect(schema.jsonSchema.additionalProperties).toBe(false);
    expect(schema.jsonSchema.properties).not.toHaveProperty("recipients");
    expect(schema.jsonSchema.properties).not.toHaveProperty("sendAt");
    expect(schema.jsonSchema.properties).not.toHaveProperty("gmail");
  });

  test("requires an explicit user request and refetches the exact opaque invoice ref", async () => {
    const readInvoices = vi.fn(async () => source());
    const seam = deps(readInvoices);

    const refused = await stageInvoiceReminderFromSource(seam.deps, {
      tenantId: "tenant_a",
      planId: "plan_1",
      intent: "missing",
      invoiceRef: REF,
      environment: "sandbox",
      now: NOW,
    });
    expect(refused).toEqual({ ok: false, reason: "explicit_intent_required" });
    expect(readInvoices).not.toHaveBeenCalled();
    expect(seam.staged).not.toHaveBeenCalled();

    const result = await stageInvoiceReminderFromSource(seam.deps, {
      tenantId: "tenant_a",
      planId: "plan_1",
      intent: "explicit_user_request",
      invoiceRef: REF,
      environment: "sandbox",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, staged: true });
    expect(readInvoices).toHaveBeenCalledOnce();
    expect(readInvoices).toHaveBeenCalledWith({
      provider: "quickbooks",
      environment: "sandbox",
    });
    expect(seam.staged).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant_a",
        planId: "plan_1",
        invoiceRef: REF,
        subject: "Reminder: invoice inv_42 is past due",
        body: expect.stringContaining("USD 250.50"),
      }),
    );
  });

  test("refetches on a retry and refuses changed payment state before any plan write", async () => {
    const readInvoices = vi
      .fn<() => Promise<Projection<Invoice>>>()
      .mockResolvedValueOnce(source())
      .mockResolvedValueOnce(source({ outstanding: { minor: 0, currency: "USD" } }));
    const seam = deps(readInvoices);
    const args = {
      tenantId: "tenant_a",
      planId: "plan_1",
      intent: "explicit_user_request" as const,
      invoiceRef: REF,
      environment: "sandbox" as const,
      now: NOW,
    };

    expect(await stageInvoiceReminderFromSource(seam.deps, args)).toMatchObject({ ok: true });
    expect(await stageInvoiceReminderFromSource(seam.deps, args)).toEqual({
      ok: false,
      reason: expect.stringContaining("paid"),
    });
    expect(readInvoices).toHaveBeenCalledTimes(2);
    expect(seam.staged).toHaveBeenCalledOnce();
  });
});

async function insertPlan(
  t: ReturnType<typeof convexTest>,
  over: { tenantId?: string; recipients?: string[]; status?: "collecting" | "proposed" } = {},
): Promise<Id<"plans">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId: over.tenantId ?? "tenant_a",
      threadId: crypto.randomUUID(),
      status: over.status ?? "collecting",
      recipients: over.recipients ?? ["customer@example.com"],
      mailProvider: "google",
      createdAt: NOW,
    }),
  );
}

describe("existing proposed-plan persistence", () => {
  test("is idempotent and creates zero requests, workflows, or delivery evidence", async () => {
    const t = convexTest(schema, modules);
    const planId = await insertPlan(t);
    const args = {
      tenantId: "tenant_a",
      planId,
      invoiceRef: REF,
      subject: "Reminder: invoice inv_42 is past due",
      body: "Hello, this exact invoice is overdue.\n",
    };

    const first = await t.mutation(internal.invoiceReminders.stageProposed, args);
    const second = await t.mutation(internal.invoiceReminders.stageProposed, args);
    expect(first).toEqual({ ok: true, planId, staged: true });
    expect(second).toEqual({ ok: true, planId, staged: false });

    const snapshot = await t.run(async (ctx) => ({
      plan: await ctx.db.get(planId),
      requests: await ctx.db.query("requests").collect(),
      audit: await ctx.db.query("audit").collect(),
      workflows: await ctx.db.query("workflowPackRuns").collect(),
    }));
    expect(snapshot.plan).toMatchObject({
      status: "proposed",
      recipients: ["customer@example.com"],
      subject: args.subject,
      body: args.body,
    });
    expect(snapshot.requests).toEqual([]);
    expect(snapshot.audit).toEqual([]);
    expect(snapshot.workflows).toEqual([]);
  });

  test("refuses a foreign tenant, an empty recipient plan, and conflicting proposed content", async () => {
    const t = convexTest(schema, modules);
    const foreign = await insertPlan(t, { tenantId: "tenant_b" });
    const empty = await insertPlan(t, { recipients: [] });
    const proposed = await insertPlan(t, { status: "proposed" });
    await t.run(async (ctx) => {
      await ctx.db.patch(proposed, { subject: "A different draft", body: "Do not replace me." });
    });
    const base = {
      tenantId: "tenant_a",
      invoiceRef: REF,
      subject: "Reminder",
      body: "Reminder body",
    };

    await expect(
      t.mutation(internal.invoiceReminders.stageProposed, { ...base, planId: foreign }),
    ).rejects.toThrow(/plan not found/i);
    expect(
      await t.mutation(internal.invoiceReminders.stageProposed, { ...base, planId: empty }),
    ).toEqual({ ok: false, reason: "recipient_required" });
    expect(
      await t.mutation(internal.invoiceReminders.stageProposed, { ...base, planId: proposed }),
    ).toEqual({ ok: false, reason: "plan_in_progress" });
  });
});

describe("the existing delivery boundary remains the only terminal", () => {
  test("Phase 28 adds no Gmail, workflow, scheduler, provider-write, or alternate delivery arm", () => {
    const source = readFileSync(new URL("./invoiceReminders.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/internal\.(gmail|graph|delivery)\./);
    expect(source).not.toMatch(/deliverApprovedPlan|workflow\.start|scheduler\.(run|runAfter|runAt)/);
    expect(source).not.toMatch(/\b(fetch|POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toMatch(/ACTION_TYPES|EXTERNAL_TARGETS/);
    expect(source.match(/ctx\.db\.patch\(/g)).toHaveLength(1);
    expect(source).toContain('status: "proposed"');
  });

  test("immediate, scheduled, and legacy sends converge on the shared suppression/footer guard", () => {
    const cockpit = readFileSync(new URL("./cockpit.ts", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("./deliverApprovedPlan.ts", import.meta.url), "utf8");
    const pipeline = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");
    const delivery = readFileSync(new URL("./delivery.ts", import.meta.url), "utf8");
    const gmail = readFileSync(new URL("./gmail.ts", import.meta.url), "utf8");
    const graph = readFileSync(new URL("./graph.ts", import.meta.url), "utf8");
    const contacts = readFileSync(new URL("./contacts.ts", import.meta.url), "utf8");

    expect(cockpit.match(/await workflow\.start\(/g)).toHaveLength(1);
    expect(cockpit).toContain("internal.deliverApprovedPlan.deliverApprovedPlan");
    expect(cockpit).toContain("await startFanout(ctx, args)");
    expect(workflow).toContain("internal.delivery.send");
    expect(pipeline).toContain("internal.delivery.send");
    expect(delivery).toContain("internal.gmail.send");
    expect(delivery).toContain("internal.graph.send");
    expect(gmail).toContain("internal.contacts.isSuppressed");
    expect(gmail).toContain("internal.contacts.footerFor");
    expect(gmail).toContain("prepareGovernedMessage(ctx, req)");
    expect(graph).toContain("prepareGovernedMessage(ctx, req)");
    expect(contacts).toContain(".map(normalizeAddress)");
    expect(contacts).toContain("for (const address of recipientMembers(recipient))");
    expect(contacts).toContain("if (await suppressionByAddress(ctx, tenantId, address)) return true");
  });
});
