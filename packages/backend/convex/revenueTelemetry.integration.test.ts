import { buildRevenueTools } from "./revenueTools";
import { importCredentialKey, sealCredential, type SourceRef } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { allPassedGates } from "../__fixtures__/providerGates";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { QB_SCOPE } from "./quickbooksAuth";
import { STRIPE_GRANT_SCOPE } from "./stripeAuth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rawSources = import.meta.glob(
  [
    "./connectorCredentials.ts",
    "./hubspot.ts",
    "./quickbooks.ts",
    "./stripeConnector.ts",
    "./paypalConnector.ts",
    "./cockpit.ts",
    "./plans.ts",
    "./revenueTools.ts",
    "./invoiceReminders.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const NOW = Date.UTC(2026, 8, 1);
const ACCESS = "SENTINEL-INTEGRATION-ACCESS";
const REFRESH = "SENTINEL-INTEGRATION-REFRESH";

function keyB64(): string {
  let binary = "";
  for (const byte of new Uint8Array(32).fill(0x2a)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Reply = { status: number; body?: unknown };
function stubProvider(handler: (url: string) => Reply): void {
  vi.stubGlobal("fetch", async (input: string) => {
    const reply = handler(String(input));
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  });
}

const tokenReply = (): Reply => ({
  status: 200,
  body: {
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_in: 1800,
    hub_id: 12345,
  },
});

const dealPage = (ids: readonly string[], after?: string): Reply => ({
  status: 200,
  body: {
    results: ids.map((id) => ({
      id,
      createdAt: new Date(NOW - 3_600_000).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      properties: {
        amount: "100.00",
        deal_currency_code: "USD",
        dealstage: "appointmentscheduled",
        pipeline: "default",
        dealname: "CUSTOMER-CONTENT-MUST-NOT-LAND",
      },
    })),
    ...(after === undefined ? {} : { paging: { next: { after } } }),
  },
});

async function harness(passed = false) {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  if (passed) {
    await t.run(async (ctx) => {
      for (const row of allPassedGates()) await ctx.db.insert("providerGates", row);
    });
  }
  const tenantA = await t.run((ctx) => ctx.db.insert("users", {}));
  const tenantB = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(tenantA),
    tenantB: String(tenantB),
    asA: t.withIdentity({ subject: `${tenantA}|session_a` }),
    asB: t.withIdentity({ subject: `${tenantB}|session_b` }),
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

const events = (h: Harness) => h.t.run((ctx) => ctx.db.query("workflowPackEvents").collect());

async function connectHubSpot(h: Harness): Promise<void> {
  stubProvider(() => tokenReply());
  const { url } = await h.asA.action(api.hubspotAuth.hubspotConnectUrl, {
    environment: "production",
  });
  const state = new URL(url).searchParams.get("state") ?? "";
  await h.t.action(internal.hubspotAuth.completeHubSpotConnect, {
    code: "auth-code",
    state,
    environment: "production",
  });
}

async function seedProviderConnection(
  h: Harness,
  tenantId: string,
  provider: "quickbooks" | "stripe" | "paypal",
): Promise<void> {
  const connectionId = `conn_${provider}_${tenantId}`;
  const key = await importCredentialKey(keyB64(), "v1");
  const credential =
    provider === "quickbooks"
      ? { accessToken: ACCESS, refreshToken: REFRESH, realmId: "realm-42", scope: QB_SCOPE }
      : provider === "stripe"
        ? {
            accessToken: ACCESS,
            refreshToken: REFRESH,
            accountId: "acct_42",
            scope: STRIPE_GRANT_SCOPE,
          }
        : { accessToken: ACCESS, merchantId: "merchant-42", scope: "reporting" };
  const sealed = await sealCredential(
    key,
    { tenantId, provider, connectionId, environment: "sandbox" },
    JSON.stringify(credential),
  );
  await h.t.run((ctx) =>
    ctx.db.insert("connectorConnections", {
      tenantId,
      provider,
      environment: "sandbox",
      connectionId,
      status: "connected",
      credentialCiphertextB64: sealed.ciphertextB64,
      credentialIvB64: sealed.ivB64,
      keyVersion: "v1",
      accessExpiresAt: NOW + 3_600_000,
      refreshExpiresAt: provider === "paypal" ? undefined : NOW + 86_400_000,
      revision: 1,
      connectedAt: NOW,
      updatedAt: NOW,
    }),
  );
}

async function stageReminder(
  h: Harness,
  tenantId: string,
  ref: SourceRef,
  over: { sendAt?: number } = {},
) {
  const planId = await h.t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: crypto.randomUUID(),
      status: "collecting",
      recipients: ["customer@example.test"],
      mailProvider: "google",
      createdAt: Date.now(),
      ...over,
    }),
  );
  await h.t.mutation(internal.invoiceReminders.stageProposed, {
    tenantId,
    planId,
    invoiceRef: ref,
    subject: "PRIVATE SUBJECT MUST NOT LAND",
    body: "PRIVATE MESSAGE MUST NOT LAND",
  });
  return planId;
}

async function seedSendGates(h: Harness, tenantId: string): Promise<void> {
  await h.t.run(async (ctx) => {
    await ctx.db.insert("gmailTokens", {
      tenantId,
      refreshToken: "integration-refresh",
      scope: "mail.send",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "solopreneur",
      tierSource: "derived",
      derivedAt: Date.now(),
      postalAddress: "12 Test Street, Dar es Salaam, TZ",
    });
  });
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  vi.stubEnv("HUBSPOT_OAUTH_CLIENT_ID", "integration-client");
  vi.stubEnv("HUBSPOT_OAUTH_CLIENT_SECRET", "integration-secret");
  vi.stubEnv("HUBSPOT_OAUTH_REDIRECT_URI", "https://app.example.test/connectors/hubspot");
  vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", keyB64());
  vi.stubEnv("QUICKBOOKS_HOME_CURRENCY", "USD");
  vi.stubEnv("STRIPE_APP_API_VERSION", "2025-12-15.preview");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("real provider terminals reach the shared revenue event plane", () => {
  test("every parked provider read emits exactly one tenant-scoped unavailable event", async () => {
    const h = await harness();

    await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    await h.asA.action(api.quickbooks.readEntity, {
      environment: "sandbox",
      entity: "Invoice",
    });
    await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    await h.asB.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });

    const rows = (await events(h)).filter((row) => row.event === "connector_read");
    expect(rows.filter((row) => row.tenantId === h.tenantA)).toHaveLength(4);
    expect(rows.filter((row) => row.tenantId === h.tenantB)).toHaveLength(1);
    expect(rows.filter((row) => row.tenantId === h.tenantA).map((row) => row.provider).sort()).toEqual([
      "hubspot",
      "paypal",
      "quickbooks",
      "stripe",
    ]);
    expect(rows.every((row) => row.status === "unavailable")).toBe(true);
  });

  test("a real partial read records its bounded prefix and no provider content", async () => {
    const h = await harness(true);
    await connectHubSpot(h);
    stubProvider((url) =>
      url.includes("after=next") ? { status: 429, body: {} } : dealPage(["1", "2"], "next"),
    );

    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("partial");

    const rows = (await events(h)).filter((row) => row.event === "connector_read");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: h.tenantA,
      provider: "hubspot",
      status: "partial",
      itemCount: 2,
      partial: true,
    });
    expect(JSON.stringify(rows)).not.toContain("CUSTOMER-CONTENT-MUST-NOT-LAND");
    expect(JSON.stringify(rows)).not.toContain(ACCESS);
  });

  test("duplicate and reordered lifecycle calls preserve one event per real transition", async () => {
    const h = await harness(true);
    await connectHubSpot(h);

    stubProvider(() => ({ status: 401, body: {} }));
    await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "contacts",
    });

    stubProvider(() => ({ status: 200, body: {} }));
    await h.asA.action(api.connectorConnections.disconnectProvider, {
      provider: "hubspot",
      environment: "production",
    });
    await h.asA.action(api.connectorConnections.disconnectProvider, {
      provider: "hubspot",
      environment: "production",
    });
    await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "contacts",
    });

    const lifecycle = (await events(h)).filter((row) => row.event === "connector_lifecycle");
    expect(lifecycle.map((row) => row.status)).toEqual([
      "connected",
      "reauth_required",
      "revoked",
    ]);
    expect(new Set(lifecycle.map((row) => row.runId)).size).toBe(3);
    expect(lifecycle.every((row) => row.tenantId === h.tenantA && row.provider === "hubspot")).toBe(
      true,
    );
  });
});

describe("real workflow terminals emit bounded completions", () => {
  test("CRM and finance tool executions record one closed completion each", async () => {
    const h = await harness();
    const bridge = {
      runQuery: (ref: unknown, args: unknown) =>
        (
          h.asA.query as unknown as (reference: unknown, arguments_: unknown) => Promise<unknown>
        )(ref, args),
      runMutation: (ref: unknown, args: unknown) =>
        (
          h.asA.mutation as unknown as (reference: unknown, arguments_: unknown) => Promise<unknown>
        )(ref, args),
      runAction: (ref: unknown, args: unknown) =>
        (
          h.asA.action as unknown as (reference: unknown, arguments_: unknown) => Promise<unknown>
        )(ref, args),
    };
    const tools = buildRevenueTools(bridge as never, h.tenantA, "plan-a");

    await (
      tools.readRevenueCrm as unknown as {
        execute(input: { operation: "attention" }): Promise<string>;
      }
    ).execute({ operation: "attention" });
    await (
      tools.readBusinessFinance as unknown as {
        execute(input: { operation: "cash_flow"; environment: "sandbox" }): Promise<string>;
      }
    ).execute({ operation: "cash_flow", environment: "sandbox" });

    const rows = await events(h);
    expect(rows.filter((row) => row.event === "workflow_completed")).toEqual([
      expect.objectContaining({
        tenantId: h.tenantA,
        workflow: "revenue-call-list",
        outcome: "no_findings",
        itemCount: 0,
      }),
    ]);
    expect(rows.filter((row) => row.event === "finance_computed")).toEqual([
      expect.objectContaining({
        tenantId: h.tenantA,
        workflow: "revenue-cash-flow",
        coverage: "unknown",
        confidence: "unknown",
      }),
    ]);
    expect(rows.some((row) => row.tenantId === h.tenantB)).toBe(false);
  });

  test("an exact reminder retry stays one staged event and stores no draft content", async () => {
    const h = await harness();
    const planId = await h.t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId: h.tenantA,
        threadId: crypto.randomUUID(),
        status: "collecting",
        recipients: ["customer@example.test"],
        mailProvider: "google",
        createdAt: NOW,
      }),
    );
    const args = {
      tenantId: h.tenantA,
      planId,
      invoiceRef: { provider: "quickbooks" as const, kind: "invoice" as const, id: "invoice-42" },
      subject: "PRIVATE SUBJECT MUST NOT LAND",
      body: "PRIVATE MESSAGE MUST NOT LAND",
    };

    expect(await h.t.mutation(internal.invoiceReminders.stageProposed, args)).toMatchObject({
      ok: true,
      staged: true,
    });
    expect(await h.t.mutation(internal.invoiceReminders.stageProposed, args)).toMatchObject({
      ok: true,
      staged: false,
    });

    const rows = (await events(h)).filter((row) => row.event === "reminder_staged");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: h.tenantA,
      workflow: "revenue-invoice-reminder",
      itemCount: 1,
    });
    expect(JSON.stringify(rows)).not.toContain(args.subject);
    expect(JSON.stringify(rows)).not.toContain(args.body);
    expect(JSON.stringify(rows)).not.toContain("customer@example.test");
  });
});

describe("plan decisions and provider-observed recovery are distinct terminals", () => {
  test("edit, approve and reject emit only after their real transitions, while send is not recovery", async () => {
    const h = await harness();
    const editPlan = await stageReminder(h, h.tenantA, {
      provider: "quickbooks",
      kind: "invoice",
      id: "decision-edit",
    });
    await h.t.mutation(internal.cockpit.proposeEmailPlan, {
      planId: editPlan,
      recipients: ["customer@example.test"],
      mode: "individual",
      subject: "EDITED PRIVATE SUBJECT",
      body: "EDITED PRIVATE BODY",
    });

    await seedSendGates(h, h.tenantA);
    const approvePlan = await stageReminder(
      h,
      h.tenantA,
      { provider: "stripe", kind: "invoice", id: "decision-approve" },
      { sendAt: NOW + 60_000 },
    );
    expect(await h.asA.mutation(api.cockpit.executePlan, { planId: approvePlan })).toMatchObject({
      ok: true,
      scheduled: true,
    });
    expect(await h.asA.mutation(api.cockpit.executePlan, { planId: approvePlan })).toMatchObject({
      alreadyStarted: true,
    });

    const request = await h.t.run((ctx) =>
      ctx.db
        .query("requests")
        .withIndex("by_plan", (q) => q.eq("planId", approvePlan))
        .unique(),
    );
    expect(request).not.toBeNull();
    await h.t.mutation(internal.plans.recordDeliveryTerminal, {
      planId: approvePlan,
      requestId: request!._id,
      outcome: "sent",
    });

    const rejectPlan = await stageReminder(h, h.tenantA, {
      provider: "quickbooks",
      kind: "invoice",
      id: "decision-reject",
    });
    expect(await h.asA.mutation(api.cockpit.discardPlan, { planId: rejectPlan })).toMatchObject({
      discarded: true,
    });
    await expect(
      h.asB.mutation(api.cockpit.discardPlan, { planId: editPlan }),
    ).rejects.toThrow("plan not found");

    const rows = await events(h);
    expect(rows.filter((row) => row.event === "plan_decided")).toEqual([
      expect.objectContaining({ tenantId: h.tenantA, planId: editPlan, status: "edited" }),
      expect.objectContaining({ tenantId: h.tenantA, planId: approvePlan, status: "approved" }),
      expect.objectContaining({ tenantId: h.tenantA, planId: rejectPlan, status: "rejected" }),
    ]);
    expect(rows.filter((row) => row.event === "recovery_observed")).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("EDITED PRIVATE");
  });

  test("a later passed QuickBooks read recovers only its tenant's formerly overdue ref once", async () => {
    const h = await harness(true);
    const ref = { provider: "quickbooks" as const, kind: "invoice" as const, id: "inv-42" };
    await stageReminder(h, h.tenantA, ref);
    await stageReminder(h, h.tenantB, ref);
    await seedProviderConnection(h, h.tenantA, "quickbooks");
    vi.setSystemTime(NOW + 1_000);
    stubProvider(() => ({
      status: 200,
      body: {
        QueryResponse: {
          Payment: [
            {
              Id: "payment-42",
              TxnDate: "2026-09-01",
              TotalAmt: 100,
              CurrencyRef: { value: "USD" },
              Line: [{ LinkedTxn: [{ TxnType: "Invoice", TxnId: ref.id }] }],
            },
          ],
        },
      },
    }));

    await h.asA.action(api.quickbooks.readEntity, { environment: "sandbox", entity: "Payment" });
    await h.asA.action(api.quickbooks.readEntity, { environment: "sandbox", entity: "Payment" });

    const staged = (await events(h)).find(
      (row) => row.tenantId === h.tenantA && row.event === "reminder_staged",
    );
    const recovered = (await events(h)).filter((row) => row.event === "recovery_observed");
    expect(staged?.subjectRef).toMatch(/^rev:quickbooks:invoice:/);
    expect(recovered).toEqual([
      expect.objectContaining({
        tenantId: h.tenantA,
        provider: "quickbooks",
        subjectRef: staged?.subjectRef,
        status: "paid",
      }),
    ]);
    expect(recovered[0]?.observedAt).toBeGreaterThan(staged?.createdAt ?? Number.MAX_SAFE_INTEGER);
    expect(recovered.some((row) => row.tenantId === h.tenantB)).toBe(false);
  });

  test("unavailable reads and another provider's matching raw id cannot manufacture recovery", async () => {
    const h = await harness(true);
    const rawId = "shared-raw-id";
    await stageReminder(h, h.tenantA, {
      provider: "stripe",
      kind: "invoice",
      id: rawId,
    });
    await stageReminder(h, h.tenantA, {
      provider: "quickbooks",
      kind: "invoice",
      id: rawId,
    });
    await seedProviderConnection(h, h.tenantA, "stripe");
    await seedProviderConnection(h, h.tenantA, "paypal");
    vi.setSystemTime(NOW + 1_000);

    stubProvider(() => ({ status: 500, body: {} }));
    expect(
      await h.asA.action(api.stripeConnector.readEntity, {
        environment: "sandbox",
        entity: "invoices",
      }),
    ).toMatchObject({ state: "unavailable" });
    expect((await events(h)).filter((row) => row.event === "recovery_observed")).toEqual([]);

    stubProvider((url) =>
      url.includes("paypal")
        ? {
            status: 200,
            body: {
              transaction_details: [
                {
                  transaction_info: {
                    transaction_id: "txn-42",
                    transaction_event_code: "T0006",
                    transaction_initiation_date: "2026-09-01T10:15:00+0000",
                    transaction_amount: { currency_code: "USD", value: "19.99" },
                    transaction_status: "S",
                    invoice_id: rawId,
                  },
                },
              ],
              page: 1,
              total_items: 1,
              total_pages: 1,
            },
          }
        : { status: 500, body: {} },
    );
    await h.asA.action(api.paypalConnector.readEntity, {
      environment: "sandbox",
      entity: "transactions",
    });
    expect((await events(h)).filter((row) => row.event === "recovery_observed")).toEqual([]);
  });
});

describe("terminal coverage cannot be satisfied by an unused emitter helper", () => {
  test("every required production terminal module registers the shared emitter", () => {
    for (const name of ["hubspot.ts", "quickbooks.ts", "stripeConnector.ts", "paypalConnector.ts"]) {
      const source = Object.entries(rawSources).find(([path]) => path.endsWith(`/${name}`))?.[1];
      expect(source, `${name} missing from raw-source registry`).toBeDefined();
      expect(source, `${name} has no production read emission`).toContain("emitConnectorReadEvent");
    }
    const credentialSource = Object.entries(rawSources).find(([path]) =>
      path.endsWith("/connectorCredentials.ts"),
    )?.[1];
    expect(credentialSource).toContain("recordRevenueEvent");
    const toolSource = Object.entries(rawSources).find(([path]) =>
      path.endsWith("/revenueTools.ts"),
    )?.[1];
    expect(toolSource).toContain("emitRevenueEvent");
    const reminderSource = Object.entries(rawSources).find(([path]) =>
      path.endsWith("/invoiceReminders.ts"),
    )?.[1];
    expect(reminderSource).toContain("recordRevenueEvent");
    expect(reminderSource).toContain("revenueSubjectRef");
    const cockpitSource = Object.entries(rawSources).find(([path]) =>
      path.endsWith("/cockpit.ts"),
    )?.[1];
    expect(cockpitSource).toContain("recordRevenueEvent");
    const plansSource = Object.entries(rawSources).find(([path]) => path.endsWith("/plans.ts"))?.[1];
    expect(plansSource).toContain("matchingStagedRevenueRecoveries");
    for (const name of ["quickbooks.ts", "stripeConnector.ts", "paypalConnector.ts"]) {
      const source = Object.entries(rawSources).find(([path]) => path.endsWith(`/${name}`))?.[1];
      expect(source).toContain("emitObservedRecoveryEvents");
    }
  });

  test("all integration rows keep the shared privacy allow-list", async () => {
    const h = await harness();
    await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    const rows = await events(h);
    const forbidden = /name|email|message|body|subject|description|amount|currency|token|credential|payload|raw|cost|latency|duration/i;
    for (const row of rows) {
      for (const key of Object.keys(row)) expect(key).not.toMatch(forbidden);
    }
  });
});
