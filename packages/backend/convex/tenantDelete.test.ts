import { deletableTables, type TenantDeletionCursor } from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// 2026-09-08: erasure now deletes the tenant's CHAT THREADS, which live in the `agent`
// component, so every harness that drives `deleteTenantData` must register it. The page-walk
// harnesses do not need it — the cascade is a one-shot in the ACTION, deliberately.
const agentModules = import.meta.glob(
  "../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts",
);
const deleteTenantDataPage = makeFunctionReference<
  "mutation",
  { tenantId: string; userId: Id<"users">; cursor?: TenantDeletionCursor },
  {
    table: string;
    deleted: number;
    nextCursor: TenantDeletionCursor | null;
  }
>("tenantDelete:deleteTenantDataPage");
type ProviderResult = {
  provider: "google" | "microsoft" | "billing" | "hubspot" | "quickbooks" | "stripe" | "paypal";
  localRowDeleted: boolean;
  revokedAtProvider: boolean;
  failure: boolean;
  revokeUpstream?: "confirmed" | "attempted_failed" | "unsupported" | "not_attempted";
};
const deleteTenantData = makeFunctionReference<
  "action",
  { confirmation: string },
  { deletedByTable: Record<string, number>; providers: ProviderResult[] }
>("tenantDelete:deleteTenantData");

afterEach(() => vi.unstubAllGlobals());

async function deleteAll(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  userId: Id<"users">,
  start?: TenantDeletionCursor,
) {
  let cursor = start;
  const counts: Record<string, number> = {};
  do {
    const page = await t.mutation(deleteTenantDataPage, {
      tenantId,
      userId,
      ...(cursor ? { cursor } : {}),
    });
    counts[page.table] = (counts[page.table] ?? 0) + page.deleted;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return counts;
}

async function seedTwoTenants() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("agent", agentSchema, agentModules);
  const seeded = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("users", {
      email: "tenant-a-delete@example.test",
      owner: true,
    });
    const tenantB = await ctx.db.insert("users", {
      email: "tenant-b-keep@example.test",
      owner: true,
    });
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert("demoItems", { tenantId: tenantA, label: `A-delete-${i}` });
    }
    await ctx.db.insert("demoItems", { tenantId: tenantB, label: "B-must-survive" });
    const auditA = await ctx.db.insert("audit", {
      tenantId: tenantA,
      correlationId: "audit-a-immutable",
      eventType: "test.before_delete",
      actor: "test",
      payload: { ref: "audit-a" },
      ts: 1_786_830_200_000,
    });
    const auditB = await ctx.db.insert("audit", {
      tenantId: tenantB,
      correlationId: "audit-b-immutable",
      eventType: "test.before_delete",
      actor: "test",
      payload: { ref: "audit-b" },
      ts: 1_786_830_200_001,
    });
    return { tenantA, tenantB, auditA, auditB };
  });
  return { t, ...seeded };
}

describe("tenant data deletion pages", () => {
  test("cannot reach audit/global tables and preserves immutable audit rows", async () => {
    const { t, tenantA, auditA, auditB } = await seedTwoTenants();
    expect(deletableTables()).not.toContain("audit");

    await deleteAll(t, String(tenantA), tenantA);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(auditA)).toMatchObject({ correlationId: "audit-a-immutable" });
      expect(await ctx.db.get(auditB)).toMatchObject({ correlationId: "audit-b-immutable" });
      expect(await ctx.db.query("audit").collect()).toHaveLength(2);
    });
  });

  test("deletes bounded pages and resumes idempotently after interruption", async () => {
    const { t, tenantA } = await seedTwoTenants();
    const first = await t.mutation(deleteTenantDataPage, {
      tenantId: String(tenantA),
      userId: tenantA,
    });

    expect(first.deleted).toBeLessThanOrEqual(2);
    expect(first.nextCursor).not.toBeNull();
    const resumed = await deleteAll(t, String(tenantA), tenantA, first.nextCursor ?? undefined);
    expect(Object.values(resumed).every((count) => count <= 5)).toBe(true);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tenantA)).toBeNull();
      expect(
        await ctx.db
          .query("demoItems")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantA))
          .collect(),
      ).toEqual([]);
    });
  });

  test("never touches another tenant's rows", async () => {
    const { t, tenantA, tenantB } = await seedTwoTenants();

    await deleteAll(t, String(tenantA), tenantA);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tenantB)).toMatchObject({ email: "tenant-b-keep@example.test" });
      expect(
        await ctx.db
          .query("demoItems")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantB))
          .collect(),
      ).toHaveLength(1);
    });
  });

  test("succeeds quietly for a tenant with no owned rows beyond its user", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "empty-delete@example.test", owner: true }),
    );

    const counts = await deleteAll(t, String(userId), userId);

    expect(counts.users).toBe(1);
    expect(
      Object.entries(counts)
        .filter(([table]) => table !== "users")
        .every(([, n]) => n === 0),
    ).toBe(true);
  });
});

describe("tenant deletion provider truth", () => {
  test("reports the disconnect results per provider without token or content escape", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await t.run(async (ctx) => {
      await ctx.db.insert("gmailTokens", {
        tenantId: tenantA,
        refreshToken: "GOOGLE_DELETE_CROWN_JEWEL",
        accessToken: "GOOGLE_ACCESS_CROWN_JEWEL",
        scope: "gmail.modify",
        updatedAt: 1,
      });
      await ctx.db.insert("microsoftCalendarTokens", {
        tenantId: tenantA,
        refreshToken: "MICROSOFT_DELETE_CROWN_JEWEL",
        accessToken: "MICROSOFT_ACCESS_CROWN_JEWEL",
        expiresAt: 2,
        scope: "Calendars.ReadWrite",
        updatedAt: 1,
      });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    const result = await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });
    const bytes = JSON.stringify(result);

    expect(result.providers).toEqual([
      {
        provider: "google",
        localRowDeleted: true,
        revokedAtProvider: true,
        failure: false,
      },
      {
        provider: "microsoft",
        localRowDeleted: true,
        revokedAtProvider: false,
        failure: false,
      },
      // 28.1-08 APPENDED a third arm. The two above keep their positions and their values, so
      // this is the array growing rather than an assertion being re-baselined.
      {
        provider: "billing",
        localRowDeleted: false,
        revokedAtProvider: false,
        failure: false,
      },
    ]);
    expect(bytes).not.toMatch(/refreshToken|accessToken|CROWN_JEWEL/);
    await t.run(async (ctx) => {
      const audits = await ctx.db.query("audit").collect();
      const completion = audits.filter((row) => row.eventType === "tenant.deleted");
      expect(completion).toHaveLength(1);
      expect(completion[0]?.payload).toMatchObject({
        deleted_demoItems: 5,
        deleted_users: 1,
        googleLocalRowDeleted: true,
        googleRevokedAtProvider: true,
        microsoftLocalRowDeleted: true,
        microsoftRevokedAtProvider: false,
      });
      expect(completion[0]?.payload.tenantIdHash).toMatch(/^[a-f0-9]{64}$/);
      const auditBytes = JSON.stringify(audits);
      expect(auditBytes).not.toMatch(/refreshToken|accessToken|CROWN_JEWEL/);
    });
  });

  test("continues local erasure and records failure when Google revocation throws", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await t.run(async (ctx) => {
      await ctx.db.insert("gmailTokens", {
        tenantId: tenantA,
        refreshToken: "FAILURE_REFRESH_SECRET",
        accessToken: "FAILURE_ACCESS_SECRET",
        scope: "gmail.modify",
        updatedAt: 1,
      });
      await ctx.db.insert("microsoftCalendarTokens", {
        tenantId: tenantA,
        refreshToken: "MS_FAILURE_REFRESH_SECRET",
        accessToken: "MS_FAILURE_ACCESS_SECRET",
        expiresAt: 2,
        scope: "Calendars.ReadWrite",
        updatedAt: 1,
      });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("provider token leak"))),
    );

    const result = await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    expect(result.providers[0]).toEqual({
      provider: "google",
      localRowDeleted: true,
      revokedAtProvider: false,
      failure: true,
    });
    expect(result.providers[1]).toEqual({
      provider: "microsoft",
      localRowDeleted: true,
      revokedAtProvider: false,
      failure: false,
    });
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("gmailTokens")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantA))
          .unique(),
      ).toBeNull();
      expect(
        await ctx.db
          .query("microsoftCalendarTokens")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantA))
          .unique(),
      ).toBeNull();
      expect(JSON.stringify(await ctx.db.query("audit").collect())).not.toContain(
        "provider token leak",
      );
    });
  });
});

// GOVN-03: erasure is a RIGHT every user holds over their own data (GDPR Art. 17), not an
// administrative privilege of the deployment owner. Every other fixture in this file seeds
// `owner: true`, which made the `authorizeTenantDeletion` owner clause unreachable — the suite was
// 6/6 green while the control was broken for every real signup. Production request
// `9a23216e3f16ebe8` threw `OWNER_REQUIRED` at `tenantDelete.ts:48` with `databaseWriteBytes: 0`.
// `owner` is `v.optional(v.boolean())`, so omitting it below is exactly what a real signup looks
// like — that omission is the whole point of the fixture and must not be "tidied up".
describe("tenant deletion is the tenant's own right, not an owner privilege", () => {
  test("a NON-owner tenant erases its own data and still cannot reach another tenant's", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    t.registerComponent("agent", agentSchema, agentModules);
    const { tenantA, tenantB } = await t.run(async (ctx) => {
      const tenantA = await ctx.db.insert("users", { email: "non-owner@example.test" });
      const tenantB = await ctx.db.insert("users", { email: "bystander@example.test" });
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("demoItems", { tenantId: tenantA, label: `A-erase-${i}` });
      }
      await ctx.db.insert("demoItems", { tenantId: tenantB, label: "B-must-survive" });
      return { tenantA, tenantB };
    });

    const result = await t
      .withIdentity({ subject: `${tenantA}|non-owner-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    expect(result.deletedByTable.demoItems).toBe(3);
    expect(result.deletedByTable.users).toBe(1);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tenantA)).toBeNull();
      // the negative that matters: a non-owner erasure must not widen into anyone else's data
      expect(await ctx.db.get(tenantB)).not.toBeNull();
      const survivors = await ctx.db.query("demoItems").collect();
      expect(survivors.map((row) => row.label)).toEqual(["B-must-survive"]);

      // the completion record must not claim an owner performed this
      const completion = (await ctx.db.query("audit").collect()).filter(
        (row) => row.eventType === "tenant.deleted",
      );
      expect(completion).toHaveLength(1);
      expect(completion[0]?.actor).toBe("user");
    });
  });
});

describe("erasure removes the sign-in binding, not just the data", () => {
  /**
   * Regression for a PRODUCTION lockout (2026-08-16). Erasure deleted the `users` row and left the
   * `authAccounts` row pointing at it, so every later Google sign-in resolved the orphan, called
   * `defaultCreateOrUpdateUser` against a missing document and threw "the user has been deleted but
   * their account has not" — a 500 on the OAuth callback, and permanent, because re-registering
   * matched the same orphan. The erased person must not be left holding a credential binding.
   */
  test("deletes the erased user's auth account/session/token rows and leaves other users' alone", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    t.registerComponent("agent", agentSchema, agentModules);

    const seeded = await t.run(async (ctx) => {
      const erased = await ctx.db.insert("users", { email: "erased@example.test" });
      const survivor = await ctx.db.insert("users", { email: "survivor@example.test" });

      for (const userId of [erased, survivor]) {
        await ctx.db.insert("authAccounts", {
          userId,
          provider: "google",
          providerAccountId: `google-${userId}`,
        });
        const session = await ctx.db.insert("authSessions", {
          userId,
          expirationTime: 1_786_830_300_000,
        });
        await ctx.db.insert("authRefreshTokens", {
          sessionId: session,
          expirationTime: 1_786_830_400_000,
        });
      }
      return { erased, survivor };
    });

    await deleteAll(t, seeded.erased, seeded.erased);

    await t.run(async (ctx) => {
      const accounts = await ctx.db.query("authAccounts").collect();
      const sessions = await ctx.db.query("authSessions").collect();
      const tokens = await ctx.db.query("authRefreshTokens").collect();

      // The erased identity keeps NO credential binding — this is the lockout guard.
      expect(accounts.filter((r) => r.userId === seeded.erased)).toHaveLength(0);
      expect(sessions.filter((r) => r.userId === seeded.erased)).toHaveLength(0);

      // ...and erasure is still scoped: a bulk "delete every auth row" would also pass the two
      // assertions above, so the survivor's rows are what make this test non-vacuous.
      expect(accounts.filter((r) => r.userId === seeded.survivor)).toHaveLength(1);
      expect(sessions.filter((r) => r.userId === seeded.survivor)).toHaveLength(1);
      expect(tokens).toHaveLength(1);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 28.1-08 (BILL-06) — the BILLING arm. Before this, `tenantDelete.ts` said nothing about billing:
// erasing a tenant left a live subscription charging a card belonging to nobody.
//
// ORDERING IS THE WHOLE TASK. `billingCustomers` is `tenant_owned`, so the page loop DELETES the
// row holding the `subscriptionId` the cancellation needs. An arm added after the loop would find
// nothing to cancel and would report `hadSubscription: false` — a silent, permanent leak that
// looks exactly like a tenant who never subscribed.
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe("the billing arm cancels before the walk erases the row it needs", () => {
  const SUB = "sub_SENTINELSUBSCRIPTION";

  async function withSubscription(t: ReturnType<typeof convexTest>, tenantId: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("billingCustomers", {
        tenantId,
        stripeCustomerId: "cus_SENTINELCUSTOMER",
        subscriptionId: SUB,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("billingUnapplied", {
        tenantId,
        stripeObjectId: "cus_SENTINELCUSTOMER",
        amountMinor: 2500,
        currency: "USD",
        observedAt: 1,
        amountAt: 1,
      });
      // `audit_immutable`: EXCLUDED from the deletion walk by construction. The pair of assertions
      // below is the whole privacy/accounting tradeoff, and it must be visible in a test.
      await ctx.db.insert("billingCoverage", { tenantId, coverageStartedAt: 1 });
      await ctx.db.insert("billingEvents", {
        tenantId,
        phase: "actual",
        amountMinor: 4900,
        currency: "USD",
        correlationId: "billing/pi_SENTINEL",
        kind: "invoice-paid",
        stripeObjectId: "pi_SENTINEL",
        createdAt: 1,
      });
    });
  }

  const arm = (result: { providers: ProviderResult[] }, provider: string) =>
    result.providers.find((p) => p.provider === provider);

  beforeEach(() => {
    // The arm refuses with `billing_not_configured` when the key is absent — deliberately, so a
    // no-op cancel can never read as done. These cases are about the CANCELLATION, so the rail is
    // configured; the unconfigured refusal has its own test in `billing.test.ts`.
    vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_SENTINEL");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("the subscription is cancelled, and only reading it BEFORE the walk makes that possible", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await withSubscription(t, tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("/v1/subscriptions/")) {
          return new Response(JSON.stringify({ id: SUB, status: "canceled" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(null, { status: 200 });
      }),
    );

    const result = await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    // THIS IS THE ORDERING PROOF, and it needs no call-sequence bookkeeping: the subscription id
    // lives ONLY on the `billingCustomers` row, and the walk deletes that row. `revokedAtProvider`
    // can only be true if the read happened while the row still existed.
    expect(arm(result, "billing")).toEqual({
      provider: "billing",
      localRowDeleted: true,
      revokedAtProvider: true,
      failure: false,
    });

    await t.run(async (ctx) => {
      const gone = async (table: "billingCustomers" | "billingUnapplied" | "billingPeriods") =>
        (
          await ctx.db
            .query(table)
            .withIndex("by_tenant", (q) => q.eq("tenantId", tenantA))
            .collect()
        ).length;
      // `tenant_owned` — erased.
      expect(await gone("billingCustomers")).toBe(0);
      expect(await gone("billingUnapplied")).toBe(0);
      expect(await gone("billingPeriods")).toBe(0);
      // `audit_immutable` — SURVIVES. Erasing a tenant removes the mapping and the working rows;
      // it does not rewrite Pikar's financial book. Deliberate, and asserted so it stays deliberate.
      const events = await ctx.db.query("billingEvents").collect();
      const coverage = await ctx.db.query("billingCoverage").collect();
      expect(events.filter((r) => r.tenantId === tenantA)).toHaveLength(1);
      expect(coverage.filter((r) => r.tenantId === tenantA)).toHaveLength(1);
    });
  });

  test("a tenant with no billing customer reports the arm, no failure, and no Stripe call", async () => {
    const { t, tenantA } = await seedTwoTenants();
    // Typed param, so `mock.calls[n][0]` is a string rather than an empty tuple.
    const fetchMock = vi.fn(async (_input: string) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    expect(arm(result, "billing")).toEqual({
      provider: "billing",
      localRowDeleted: false,
      revokedAtProvider: false,
      failure: false,
    });
    // Never subscribed is not a failure, and it must not provoke a request either.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/v1/subscriptions/");
    }
  });

  test("a Stripe cancel failure is recorded AND the erasure still completes", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await withSubscription(t, tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("/v1/subscriptions/")) {
          return new Response(JSON.stringify({ error: { code: "api_error" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(null, { status: 200 });
      }),
    );

    const result = await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    expect(arm(result, "billing")).toMatchObject({ revokedAtProvider: false, failure: true });
    // An erasure that stops because Stripe is down is a worse outcome than one that completes with
    // a recorded failure. Every tenant_owned table is still empty.
    await t.run(async (ctx) => {
      expect(await ctx.db.query("billingCustomers").collect()).toHaveLength(0);
      expect(
        (await ctx.db.query("demoItems").collect()).filter((r) => r.tenantId === tenantA),
      ).toHaveLength(0);
    });
  });

  test("the tenant.deleted audit row carries the billing arm, ids and booleans ONLY", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await withSubscription(t, tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: SUB }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await t
      .withIdentity({ subject: `${tenantA}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

    await t.run(async (ctx) => {
      const audits = await ctx.db.query("audit").collect();
      const completion = audits.filter((row) => row.eventType === "tenant.deleted");
      expect(completion).toHaveLength(1);
      expect(completion[0]?.payload).toMatchObject({
        billingLocalRowDeleted: true,
        billingRevokedAtProvider: true,
        billingFailure: false,
      });
      // No Stripe object, no email, no name — the audit log must never become a PII honeypot
      // (CLAUDE.md §4), and a customer id is exactly the kind of thing that rides in by accident.
      const bytes = JSON.stringify(completion[0]);
      expect(bytes).not.toContain("cus_");
      expect(bytes).not.toContain("sub_");
      expect(bytes).not.toMatch(/@/);
    });
  });

  test("authorizeTenantDeletion reports billingActive beside the two connectors", async () => {
    const { t, tenantA, tenantB } = await seedTwoTenants();
    await withSubscription(t, tenantA);

    const authorize = makeFunctionReference<
      "mutation",
      { tenantId: string; userId: Id<"users"> },
      { googleConnected: boolean; microsoftConnected: boolean; billingActive: boolean }
    >("tenantDelete:authorizeTenantDeletion");

    expect(await t.mutation(authorize, { tenantId: tenantA, userId: tenantA })).toMatchObject({
      billingActive: true,
    });
    expect(await t.mutation(authorize, { tenantId: tenantB, userId: tenantB })).toMatchObject({
      billingActive: false,
    });
    // The self-check is UNCHANGED by this plan and stays the whole authorization.
    await expect(t.mutation(authorize, { tenantId: tenantB, userId: tenantA })).rejects.toThrow(
      /TENANT_SELF_REQUIRED/,
    );
  });
});

// ── THE CONNECTOR ARM (Phase 28) ─────────────────────────────────────────────────────────────
//
// Before this, `tenantDelete.ts` deleted the four providers' rows and never asked any of them to
// revoke — an erasure that left up to four live grants into a business's CRM, books and payment
// account, with nothing in the record to say so. The playbook had it as "Flagged, not fixed"; no
// Phase 28 plan claimed it.
//
// SAME ORDERING CONSTRAINT AS BILLING. `connectorConnections` is `tenant_credential`, so the page
// loop deletes the row holding the sealed blob the revocation needs.
//
// WHAT IS DIFFERENT FROM BILLING, and it is the whole design: Stripe cancels for real, whereas only
// ONE of these four providers documents a revocation endpoint a platform can call. The arm must
// report a documented absence WITHOUT calling it a failure and WITHOUT calling it a revocation.
describe("the connector arm revokes what it can and refuses to overstate the rest", () => {
  const connectorArm = (result: { providers: ProviderResult[] }, provider: string) =>
    result.providers.find((p) => p.provider === provider);

  async function seedGrant(
    t: ReturnType<typeof convexTest>,
    tenantId: string,
    provider: "hubspot" | "quickbooks" | "stripe" | "paypal",
    over: {
      sealed?: boolean;
      environment?: "sandbox" | "production";
      /** Ciphertext present, IV absent: still `sealed` to the arm, but `revokeGrant` cannot open it
       *  and returns WITHOUT throwing — the only way to get two different upstream answers for
       *  one provider, which is what the collapse below has to be tested against. */
      ivMissing?: boolean;
    } = {},
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("connectorConnections", {
        tenantId,
        provider,
        environment: over.environment ?? "production",
        connectionId: `conn_${provider}_${over.environment ?? "production"}`,
        status: "connected" as const,
        keyVersion: "v1" as const,
        revision: 1,
        updatedAt: 1,
        ...(over.sealed === false
          ? {}
          : {
              // A SENTINEL: nothing below decrypts it, and the audit assertion searches for this
              // exact string to prove no ciphertext reaches the log.
              credentialCiphertextB64: "CIPHERTEXT_SENTINEL_NEVER_IN_A_LOG",
              ...(over.ivMissing ? {} : { credentialIvB64: "IV_SENTINEL" }),
            }),
      });
    });
  }

  const erase = (t: ReturnType<typeof convexTest>, tenantId: string) =>
    t
      .withIdentity({ subject: `${tenantId}|delete-session` })
      .action(deleteTenantData, { confirmation: "DELETE MY DATA" });

  // THE REGRESSION GUARD FOR EVERY EXISTING ASSERTION IN THIS FILE. The connector entries are
  // appended and CONDITIONAL, so a tenant who never connected one still gets exactly three.
  test("a tenant with no connector rows still reports exactly the three original arms", async () => {
    const { t, tenantA } = await seedTwoTenants();
    const result = await erase(t, tenantA);
    expect(result.providers.map((p) => p.provider)).toEqual(["google", "microsoft", "billing"]);
  });

  // PayPal and Stripe make ZERO upstream requests by design — neither documents a revocation a
  // platform can perform — so `unsupported` is the permanent, honest answer for both.
  test.each([
    "paypal",
    "stripe",
  ] as const)("%s: the local copy goes, the grant does NOT, and the record says exactly that", async (provider) => {
    const { t, tenantA } = await seedTwoTenants();
    await seedGrant(t, tenantA, provider);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await erase(t, tenantA);
    const armed = connectorArm(result, provider);
    expect(armed?.localRowDeleted).toBe(true);
    // NOT revoked, and NOT a failure. Both halves matter: claiming a revocation would be a lie
    // to the tenant, and calling a documented absence a failure on every erasure would train the
    // reader to ignore the field — which is how a REAL failure goes unnoticed.
    expect(armed?.revokedAtProvider).toBe(false);
    expect(armed?.failure).toBe(false);
    expect(armed?.revokeUpstream).toBe("unsupported");
    // The distinction is legible only because the enum survives; a boolean could not carry it.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ORDERING, PROVEN BY CONSEQUENCE — the 28.1-08 idiom, and there is no call-sequence bookkeeping
  // to drift out of sync with the code.
  //
  // HUBSPOT IS THE ONLY LANE THAT CAN PROVE THIS, and picking the wrong one is how a vacuous
  // ordering test gets written. PayPal and Stripe never read the row at all — they answer
  // `unsupported` from a pure classifier — so a PayPal assertion here would pass with the arm on
  // EITHER side of the loop. `hubspotAuth.revokeGrant` reads the credential row first and returns
  // `not_attempted` immediately when it is absent; when it IS present it reaches decryption, which
  // throws with no `CONNECTOR_CREDENTIAL_KEY_V1` stubbed and is caught as `attempted_failed`.
  //
  // So: arm ABOVE the loop -> `attempted_failed`. Arm BELOW it -> `not_attempted`. Two different
  // observable values, and only one of them is reachable from the correct placement.
  test("the sealed grant was read BEFORE the walk deleted the row holding it", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await seedGrant(t, tenantA, "hubspot");
    const result = await erase(t, tenantA);
    const armed = connectorArm(result, "hubspot");
    // Reached the credential, so the row still existed when the arm ran.
    expect(armed?.revokeUpstream).toBe("attempted_failed");
    // The value an arm below the loop would have produced instead.
    expect(armed?.revokeUpstream).not.toBe("not_attempted");
    // And the erasure still completed.
    const left = await t.run((ctx) => ctx.db.query("connectorConnections").collect());
    expect(left.filter((r) => r.tenantId === tenantA)).toHaveLength(0);
  });

  // A row whose ciphertext was already cleared is a grant Pikar no longer holds. Re-revoking it
  // would report a second revocation of a credential that is already gone.
  test("an already-disconnected row is not revoked again", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await seedGrant(t, tenantA, "paypal", { sealed: false });
    const result = await erase(t, tenantA);
    const armed = connectorArm(result, "paypal");
    expect(armed?.localRowDeleted).toBe(true);
    expect(armed?.revokeUpstream).toBe("not_attempted");
    expect(armed?.failure).toBe(false);
  });

  // QuickBooks reads its deployment configuration and throws BY NAME when it is absent. That is a
  // real fault and must be recorded as one WITHOUT stopping the erasure: an erasure that halts
  // because a vendor is unreachable is a worse outcome than one that completes with the failure on
  // the record.
  test("a throwing disconnect is recorded as attempted_failed AND the erasure still completes", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await seedGrant(t, tenantA, "quickbooks");
    const result = await erase(t, tenantA);
    const armed = connectorArm(result, "quickbooks");
    expect(armed?.failure).toBe(true);
    // NOT `unsupported`: we tried and do not know the grant is dead. Saying `unsupported` here
    // would blame the vendor for our own missing configuration.
    expect(armed?.revokeUpstream).toBe("attempted_failed");
    expect(armed?.revokedAtProvider).toBe(false);
    const survivors = await t.run((ctx) => ctx.db.query("demoItems").collect());
    expect(survivors.every((row) => row.tenantId !== tenantA)).toBe(true);
  });

  // Two grants for ONE provider must collapse to one entry, and the entry must NOT round up.
  //
  // THE FIRST VERSION OF THIS TEST WAS VACUOUS AND A MUTATION CAUGHT IT. It paired a sealed grant
  // with an UNSEALED one — but an unsealed grant is never called, so it contributes no upstream
  // value and the list had exactly one element. `leastReassuring` degraded to "take the first"
  // survives that happily. A real disagreement needs two grants that are both CALLED and answer
  // DIFFERENTLY, which is what `ivMissing` buys: `revokeGrant` cannot open the blob, so it returns
  // `not_attempted` (severity 1) instead of throwing into `attempted_failed` (severity 3).
  //
  // The mild one is seeded FIRST on purpose, so "take the first" and "take the worst" disagree.
  test("sandbox and production disagreeing collapses to the LEAST reassuring answer", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await seedGrant(t, tenantA, "hubspot", { environment: "sandbox", ivMissing: true });
    await seedGrant(t, tenantA, "hubspot", { environment: "production" });
    const result = await erase(t, tenantA);
    const entries = result.providers.filter((p) => p.provider === "hubspot");
    // ONE entry, or the audit payload keys would be written twice and silently overwrite.
    expect(entries).toHaveLength(1);
    // `attempted_failed` beats `not_attempted`, even though `not_attempted` came first.
    expect(entries[0]?.revokeUpstream).toBe("attempted_failed");
    expect(entries[0]?.revokedAtProvider).toBe(false);
  });

  // §4, and the reason `revokeUpstream` had to reach the payload at all: after the walk deletes
  // `connectorConnections`, this row is the ONLY surviving record of what happened upstream.
  test("the tenant.deleted audit row carries the upstream truth and no ciphertext", async () => {
    const { t, tenantA } = await seedTwoTenants();
    await seedGrant(t, tenantA, "paypal");
    await erase(t, tenantA);
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const deleted = rows.find((r) => r.eventType === "tenant.deleted");
    expect(deleted).toBeDefined();
    const payload = deleted?.payload as Record<string, unknown>;
    expect(payload.paypalLocalRowDeleted).toBe(true);
    expect(payload.paypalRevokedAtProvider).toBe(false);
    expect(payload.paypalRevokeUpstream).toBe("unsupported");
    // A provider with no row contributes NO keys — the payload describes what happened, not a
    // fixed template with blanks.
    expect(payload.hubspotRevokeUpstream).toBeUndefined();
    const serialized = JSON.stringify(deleted);
    expect(serialized).not.toContain("CIPHERTEXT_SENTINEL_NEVER_IN_A_LOG");
    expect(serialized).not.toContain("IV_SENTINEL");
  });
});

// ══ ERASURE DELETES THE BYTES, NOT JUST THE ROWS THAT POINT AT THEM (2026-09-08) ═════════════
//
// Until this commit the walk was `.take()` + `ctx.db.delete(row._id)` and nothing else — a
// case-insensitive grep of `tenantDelete.ts` for "storage" returned ZERO. So erasure deleted a
// user's POINTERS and left their FILES, and because the pointer went first the bytes were then
// unreachable AND unremovable by any product path. `DataControls.tsx` promised the opposite:
// "removes your account data and content — your profile, vault documents, contacts, plans,
// approvals, generated media and stored connection grants."
//
// THE ASSERTION IS ON THE BLOB, NEVER ON THE ROW. Every row-count assertion in this file stayed
// green through the entire defect — that is exactly why it went unnoticed for months — so a test
// that counted rows again would prove nothing.
//
// SCOPE: this proves the WALK deletes whatever `storageIdsIn` returns, using `plans` (which alone
// carries a top-level field AND the nested `attachments[]` path) plus a second table to show it is
// not plans-specific. That the MAP covers every `_storage` field in `schema.ts` is a different
// question, and it is answered where it can be answered exhaustively and for free — the drift
// guard in `packages/core/src/tenantData.test.ts`, which parses the schema.
describe("erasure deletes stored files (2026-09-08)", () => {
  test("the walk deletes a row's blobs — nested ones too — and spares another tenant's", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    t.registerComponent("agent", agentSchema, agentModules);

    const seeded = await t.run(async (ctx) => {
      const tenantA = await ctx.db.insert("users", { email: "blob-a@example.test", owner: true });
      const tenantB = await ctx.db.insert("users", { email: "blob-b@example.test", owner: true });

      const reel = await ctx.storage.store(new Blob(["reel"]));
      const sidecar = await ctx.storage.store(new Blob(["sidecar"]));
      const planPdf = await ctx.storage.store(new Blob(["plan-attachment"]));
      const asset = await ctx.storage.store(new Blob(["media-asset"]));
      const survivor = await ctx.storage.store(new Blob(["tenant-b-must-survive"]));

      await ctx.db.insert("plans", {
        tenantId: tenantA,
        threadId: "thread_blob",
        status: "done",
        renderStorageId: reel,
        sidecarStorageId: sidecar,
        // NESTED, and it is the largest class of generated file in the product. A top-level-only
        // extractor satisfies every other assertion here and misses exactly this one.
        attachments: [
          { storageId: planPdf, filename: "brief.pdf", mimeType: "application/pdf", size: 4 },
        ],
        createdAt: Date.now(),
      });
      // A SECOND TABLE, so a fix that special-cased `plans` cannot pass.
      await ctx.db.insert("attachments", {
        tenantId: tenantA,
        storageId: asset,
        filename: "second-table.pdf",
        mimeType: "application/pdf",
        size: 4,
      });
      // TENANT B's blob, on a row the walk never visits. Erasure must be a scalpel.
      await ctx.db.insert("plans", {
        tenantId: tenantB,
        threadId: "thread_keep",
        status: "done",
        renderStorageId: survivor,
        createdAt: Date.now(),
      });
      return { tenantA, mine: [reel, sidecar, planPdf, asset], survivor };
    });

    const urls = (ids: Id<"_storage">[]) =>
      t.run(async (ctx) => Promise.all(ids.map((id) => ctx.storage.getUrl(id))));

    // NON-VACUITY FLOOR: all four blobs really exist before the walk. Without this the test passes
    // just as happily against a `ctx.storage.store` that silently did nothing.
    expect((await urls(seeded.mine)).filter((u) => u !== null)).toHaveLength(4);

    await deleteAll(t, seeded.tenantA, seeded.tenantA);

    // MUTATION: drop the `ctx.storage.delete` loop from `deleteTenantDataPage` → all four survive.
    expect(
      (await urls(seeded.mine)).filter((u) => u !== null),
      "these blobs survived erasure — the user's files are still on disk",
    ).toEqual([]);
    // …and the neighbour's file is untouched.
    expect((await urls([seeded.survivor])).filter((u) => u !== null)).toHaveLength(1);
  });
});
