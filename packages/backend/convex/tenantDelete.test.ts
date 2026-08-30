import { deletableTables, type TenantDeletionCursor } from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
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
  provider: "google" | "microsoft" | "billing";
  localRowDeleted: boolean;
  revokedAtProvider: boolean;
  failure: boolean;
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
